/** Self-update support: check this plugin's GitHub repo (main-branch
    package.json version vs the installed version — the repo publishes releases
    as plain version bumps, no tags/releases are maintained) and, on request,
    atomically swap the checked source tarball into the installed package
    directory.

    Transport note: MANY machines redirect github.com / api.github.com /
    raw.githubusercontent.com to a local TLS proxy via hosts entries (GitHub
    accelerators); Node's own CA store rejects that proxy's certificate while
    codeload.github.com is never redirected. The whole check + install path
    therefore uses ONLY codeload.github.com, so the feature works on such
    machines. The check downloads the main-branch tarball and CACHES the
    extracted payload; the install consumes exactly those cached bytes
    (verified again), so no check→install race exists and no commit pin is
    needed.

    The running process keeps executing the OLD code until dsh is restarted,
    so the check reports restartPending (on-disk version vs the version this
    loaded module was built with) for the UI to surface a restart notice. */
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { HttpError } from './errors.js'
import { writeJsonAtomic } from './drafts.js'

export const PACKAGE_NAME = '@yishengjun8/dsh-workspace-studio'
const GITHUB_REPO = 'yishengjun8/dsh-workspace-studio'
const GITHUB_BRANCH = 'main'
const USER_AGENT = 'dsh-workspace-studio-updater'
const CHECK_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_TARBALL_BYTES = 50 * 1024 * 1024
const SEMVER_RE = /^\d+\.\d+\.\d+$/
/* Reuse window for the cached check payload: the settings group's mount
   auto-check skips the (~MB) re-download while the cache is fresh; every
   explicit user action (检查更新 / 重试) forces a fresh download. */
const CHECK_CACHE_TTL_MS = 15 * 60_000
const CHECK_BASE = join(homedir(), '.dsh-plugin', 'dsh-workspace-studio', 'updates')
const CHECKED_META = 'checked.json'
const CHECKED_CONTENT = 'checked-content'

let updateInProgress = false
/* Serialize the checked-content directory exchange: two concurrent
   downloadAndCache calls (a forced check + a download, or two tabs) would
   otherwise interleave their rename(old→aside) / rename(new→content) pairs —
   on Windows the second rename fails (the target exists) and the request
   errors out, and a worse interleaving can leave the meta pointing at
   content that was renamed over. The downloads themselves may run
   concurrently (wasteful but harmless); only the exchange is serialized. */
let contentSwapChain = Promise.resolve()

/** Own installed package directory. Everything in the host bundle is inlined
    into lib/index.js (bundled layout: one level below the package root; dev
    source sits at src/host/, two levels below), so the root is located by
    walking up from this module's file until a package.json naming this plugin
    is found — import.meta.url always points at the bundle the user's profile
    actually loads, so the swap below targets the INSTALLED copy (in the dev
    layout it targets the checkout, which is exactly what a dev would expect). */
export function ownPackageDir() {
  let dir = fileURLToPath(new URL('.', import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (typeof pkg?.name === 'string' && pkg.name === PACKAGE_NAME) return dir
    } catch {
      /* keep walking */
    }
    dir = dirname(dir)
  }
  return fileURLToPath(new URL('.', import.meta.url))
}

function readOwnPackageJson() {
  try {
    return JSON.parse(readFileSync(join(ownPackageDir(), 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/* Version captured when THIS module loaded = the version of the running code.
   After a successful swap the on-disk package.json differs from it — exactly
   the "update installed, restart required" signal. */
const LOADED_VERSION = readOwnPackageJson()?.version ?? null

function parseSemver(value) {
  if (typeof value !== 'string' || !SEMVER_RE.test(value.trim())) return null
  return value.trim().split('.').map(Number)
}

/** -1 | 0 | 1, or null when either side is not a plain x.y.z version. */
export function compareVersions(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === null || pb === null) return null
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/** Install mode: 'file' when the profile manifest pins this package with a
    file: spec (local checkout — the swap only replaces the profile copy, the
    checkout stays untouched), 'git' when pinned from GitHub, 'other' when the
    package is not laid out under a profile at all. */
async function detectInstallMode() {
  const scopeDir = dirname(ownPackageDir()) // .../node_modules/@yishengjun8
  const nmDir = dirname(scopeDir) // .../node_modules
  const profileDir = dirname(nmDir) // .../profiles/<profile>
  if (basename(dirname(profileDir)) !== 'profiles') return 'other'
  try {
    const manifest = JSON.parse(await fsp.readFile(join(profileDir, 'package.json'), 'utf8'))
    const spec = manifest?.dependencies?.[PACKAGE_NAME] ?? manifest?.devDependencies?.[PACKAGE_NAME]
    if (typeof spec === 'string') {
      if (spec.startsWith('file:')) return 'file'
      if (spec.startsWith('github:')) return 'git'
      return 'other'
    }
  } catch {
    /* not a profile layout — fall through */
  }
  return 'other'
}

function readCheckedMeta() {
  try {
    /* readFileSync comes from node:fs (imported above) — the promises API
       (fsp) has no readFileSync, and calling it would throw a TypeError that
       this catch swallows, making the check cache permanently empty (every
       settings open re-downloaded the tarball). */
    const meta = JSON.parse(readFileSync(join(CHECK_BASE, CHECKED_META), 'utf8'))
    if (typeof meta?.version === 'string' && typeof meta?.at === 'number') return meta
  } catch {
    /* no cache yet */
  }
  return { version: null, at: 0 }
}

async function cachedContentValid(meta) {
  try {
    const pkg = JSON.parse(await fsp.readFile(join(CHECK_BASE, CHECKED_CONTENT, 'package.json'), 'utf8'))
    return pkg?.name === PACKAGE_NAME && pkg?.version === meta.version
  } catch {
    return false
  }
}

/** Download the main-branch tarball, extract, verify, and atomically refresh
    the checked cache (extracted payload + meta). Returns the checked version. */
async function downloadAndCache(timeoutMs) {
  await fsp.mkdir(CHECK_BASE, { recursive: true })
  const staging = await fsp.mkdtemp(join(CHECK_BASE, 'dl-'))
  try {
    let response
    try {
      response = await fetch(`https://codeload.github.com/${GITHUB_REPO}/tar.gz/${GITHUB_BRANCH}`, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
    } catch {
      throw new HttpError(502, 'update-check-failed', '无法连接 GitHub，请检查网络后重试')
    }
    if (!response.ok) {
      throw new HttpError(502, 'update-check-failed', `GitHub 下载失败（HTTP ${response.status}）`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_TARBALL_BYTES) {
      throw new HttpError(413, 'update-check-failed', '更新包过大，已拒绝下载')
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_TARBALL_BYTES) {
      throw new HttpError(413, 'update-check-failed', '更新包过大，已拒绝下载')
    }
    const tarballPath = join(staging, 'update.tar.gz')
    await fsp.writeFile(tarballPath, bytes)
    /* The tarball extracts to <repo>-<ref>/; resolve the single top-level dir. */
    const extractRoot = join(staging, 'content')
    await fsp.mkdir(extractRoot, { recursive: true })
    await extractTarball(tarballPath, extractRoot)
    const topEntries = (await fsp.readdir(extractRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
    if (topEntries.length !== 1) {
      throw new HttpError(502, 'update-check-failed', '更新包结构无效')
    }
    const extracted = join(extractRoot, topEntries[0].name)
    let pkg
    try {
      pkg = JSON.parse(await fsp.readFile(join(extracted, 'package.json'), 'utf8'))
    } catch {
      throw new HttpError(502, 'update-check-failed', '更新包缺少有效的 package.json')
    }
    if (pkg?.name !== PACKAGE_NAME || typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
      throw new HttpError(502, 'update-check-failed', '更新包不是本插件或版本无效')
    }
    const version = pkg.version
    await verifyPackage(extracted, version)
    /* Atomically replace the cached payload: old content aside → new in →
       drop the old; the meta is written only after the content landed, so a
       crash mid-swap leaves a stale meta whose content check fails (→ the
       next check re-downloads). The exchange runs under the module-level
       swap chain so concurrent downloadAndCache callers cannot interleave
       their renames. */
    const contentDir = join(CHECK_BASE, CHECKED_CONTENT)
    const runSwap = contentSwapChain.then(async () => {
      const oldContent = join(CHECK_BASE, `${CHECKED_CONTENT}.old-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
      try {
        await fsp.rename(contentDir, oldContent)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      try {
        await fsp.rename(extracted, contentDir)
      } catch (error) {
        try { await fsp.rename(oldContent, contentDir) } catch { /* best-effort restore */ }
        throw error
      }
      try {
        await fsp.rm(oldContent, { recursive: true, force: true })
      } catch { /* best-effort cleanup */ }
    })
    contentSwapChain = runSwap.catch(() => {})
    await runSwap
    await writeJsonAtomic(join(CHECK_BASE, CHECKED_META), { version, at: Date.now() })
    return version
  } finally {
    try { await fsp.rm(staging, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
  }
}

/** Query the repo (codeload tarball, cached for CHECK_CACHE_TTL_MS unless
    force) and compare against the installed version. Never mutates the
    installation. */
export async function checkForUpdate(ctx, config, force) {
  if (config.enableUpdateCheck === false) return { enabled: false }
  let fresh = false
  const meta = readCheckedMeta()
  if (force !== true && meta.version !== null && Date.now() - meta.at < CHECK_CACHE_TTL_MS) {
    fresh = await cachedContentValid(meta)
  }
  let latest = fresh ? meta.version : await downloadAndCache(CHECK_TIMEOUT_MS)
  let disk = readOwnPackageJson()
  if (disk === null) {
    throw new HttpError(500, 'update-check-failed', '无法读取插件自身的 package.json')
  }
  const current = typeof disk?.version === 'string' ? disk.version : null
  const cmp = compareVersions(latest, current ?? '0.0.0')
  return {
    enabled: true,
    current,
    latest,
    updateAvailable: cmp !== null && cmp > 0,
    installMode: await detectInstallMode(),
    /* On-disk version differs from the version this loaded module was built
       with: an update (or a host rebuild) landed after startup, so the running
       code is stale until the user restarts dsh. */
    restartPending: current !== null && LOADED_VERSION !== null && current !== LOADED_VERSION,
  }
}

function readTarString(block, offset, length) {
  const end = block.indexOf(0, offset)
  const limit = end === -1 ? offset + length : Math.min(end, offset + length)
  return block.subarray(offset, limit).toString('utf8')
}

function parseOctal(block, offset, length) {
  const raw = readTarString(block, offset, length).trim()
  if (raw === '') return 0
  if (!/^[0-7]+$/.test(raw)) return -1
  return parseInt(raw, 8)
}

function parsePaxRecords(data) {
  const records = []
  let cursor = 0
  while (cursor < data.length) {
    const space = data.indexOf(0x20, cursor)
    if (space === -1) break
    const length = Number(data.subarray(cursor, space).toString('ascii'))
    if (!Number.isInteger(length) || length <= 0 || cursor + length > data.length) break
    const record = data.subarray(space + 1, cursor + length).toString('utf8')
    const eq = record.indexOf('=')
    if (eq !== -1) {
      /* pax record values are newline-terminated ("len key=value\n"); the
         trailing newline is part of the record framing, NOT the value — a
         'path' value carrying it would extract a file name with an embedded
         newline (ENOENT on Windows, a wrong name on POSIX). */
      records.push({ key: record.slice(0, eq), value: record.slice(eq + 1).replace(/\r?\n$/, '') })
    }
    cursor += length
  }
  return records
}

/* Tar-entry path guard: pax/GNU overrides come from the archive itself, so
   every extracted path is validated against traversal before touching disk. */
function validEntryPath(path) {
  if (typeof path !== 'string' || path === '') return false
  if (path.startsWith('/') || path.includes('\\')) return false
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return false
  return true
}

/** Minimal tar extraction: gunzip (node:zlib) + a ustar reader that also
    understands pax extended headers ('x' — git archive emits these for long
    paths) and GNU long names ('L'). Regular files and directories only; any
    other entry type or an invalid path fails the archive. */
export async function extractTarball(tarballPath, destDir) {
  let tar
  try {
    tar = gunzipSync(await fsp.readFile(tarballPath))
  } catch {
    throw new HttpError(502, 'update-check-failed', '下载的更新包无法解压')
  }
  let offset = 0
  let pendingPath = null // pax 'path' / GNU longname for the NEXT entry
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512)
    if (block.every(byte => byte === 0)) break // end-of-archive zero blocks
    const rawName = readTarString(block, 0, 100)
    const type = String.fromCharCode(block[156])
    const size = parseOctal(block, 124, 12)
    const prefix = readTarString(block, 345, 155)
    const dataStart = offset + 512
    if (size < 0 || dataStart + size > tar.length) {
      throw new HttpError(502, 'update-check-failed', '更新包格式无效')
    }
    const data = tar.subarray(dataStart, dataStart + size)
    offset = dataStart + size + (size % 512 === 0 ? 0 : 512 - (size % 512))
    if (type === 'x' || type === 'g') {
      for (const record of parsePaxRecords(data)) {
        if (record.key === 'path') pendingPath = record.value
      }
      continue
    }
    if (type === 'L') {
      pendingPath = readTarString(data, 0, data.length)
      continue
    }
    const entryPath = (pendingPath !== null ? pendingPath : (prefix !== '' ? `${prefix}/${rawName}` : rawName)).replace(/\/+$/, '')
    pendingPath = null
    if (!validEntryPath(entryPath)) {
      throw new HttpError(502, 'update-check-failed', '更新包包含非法路径')
    }
    const target = join(destDir, ...entryPath.split('/'))
    if (type === '5') {
      await fsp.mkdir(target, { recursive: true })
    } else if (type === '0' || type === '\0') {
      await fsp.mkdir(dirname(target), { recursive: true })
      await fsp.writeFile(target, data)
    } else {
      throw new HttpError(502, 'update-check-failed', `更新包包含不支持的条目（${type}）`)
    }
  }
}

export async function verifyPackage(dir, expectedVersion) {
  let pkg
  try {
    pkg = JSON.parse(await fsp.readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    throw new HttpError(502, 'update-verify-failed', '更新包缺少有效的 package.json')
  }
  if (pkg?.name !== PACKAGE_NAME) {
    throw new HttpError(502, 'update-verify-failed', '更新包不是本插件')
  }
  if (pkg?.version !== expectedVersion) {
    throw new HttpError(502, 'update-verify-failed', `更新包版本与检查结果不一致（${String(pkg?.version)} ≠ ${expectedVersion}）`)
  }
  for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    try {
      if (!(await fsp.stat(join(dir, required))).isFile()) throw new Error('not a file')
    } catch {
      throw new HttpError(502, 'update-verify-failed', `更新包缺少 ${required}`)
    }
  }
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Atomic swap: rename the installed package dir aside, move the verified new
    copy into place, re-verify the installed copy, then KEEP the backup (a
    dev-layout install — dsh loading the plugin straight from a checkout —
    would otherwise destroy the previous working copy, including any
    uncommitted changes, the moment the swap succeeds). Any failure rolls back
    to the backup before surfacing. */
async function swapPackage(extractedDir, version) {
  const packageDir = ownPackageDir()
  const parent = dirname(packageDir)
  const base = basename(packageDir)
  const backup = join(parent, `.${base}.bak-${uniqueSuffix()}`)
  try {
    await fsp.rename(packageDir, backup)
  } catch (error) {
    throw new HttpError(409, 'update-swap-failed', `无法移动当前安装（可能正被占用）：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await fsp.rename(extractedDir, packageDir)
  } catch (error) {
    try { await fsp.rename(backup, packageDir) } catch { /* best-effort restore */ }
    throw new HttpError(409, 'update-swap-failed', `无法写入新版本：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await verifyPackage(packageDir, version)
    /* Keep the backup directory (do NOT rm it): the previous copy is the
       user's only rollback if the new version misbehaves, and in a dev
       layout it holds the checkout's uncommitted work. Log its location so
       it can be removed manually once the new version is confirmed. */
    console.warn(`[workspace-studio] update installed; previous copy kept at ${backup} (remove it once the new version is confirmed)`)
  } catch (error) {
    try {
      await fsp.rm(packageDir, { recursive: true, force: true })
      await fsp.rename(backup, packageDir)
    } catch { /* give up on rollback */ }
    throw error
  }
}

/** Install the version the client received from the check: the payload is the
    CACHED checked tarball content (re-verified), fetched again only when the
    cache is missing or its version no longer matches — in which case the user
    must re-check first. The staging/swap happens on the same volume as the
    install in the standard layout (both under the user home); a cross-volume
    failure surfaces as a clear swap error and the backup rollback keeps the
    old install intact. */
export async function downloadUpdate(ctx, config, payload) {
  if (config.enableUpdateCheck === false) {
    throw new HttpError(403, 'update-disabled', '已禁用检查更新')
  }
  const version = typeof payload?.version === 'string' && SEMVER_RE.test(payload.version) ? payload.version : null
  if (version === null) {
    throw new HttpError(400, 'update-invalid-request', '更新请求缺少有效的版本信息')
  }
  if (updateInProgress) {
    throw new HttpError(409, 'update-in-progress', '已有更新任务正在进行')
  }
  updateInProgress = true
  try {
    const contentDir = join(CHECK_BASE, CHECKED_CONTENT)
    const meta = readCheckedMeta()
    if (!(meta.version === version && await cachedContentValid(meta))) {
      /* The checked payload is gone or stale (e.g. a cleared updates dir, or
         the user checked a long time ago): re-check NOW and compare — the
         install must match the version the user was shown. */
      const fresh = await downloadAndCache(DOWNLOAD_TIMEOUT_MS)
      if (fresh !== version) {
        throw new HttpError(409, 'update-version-changed', '检查结果已过期，请重新检查后再更新')
      }
    }
    const installMode = await detectInstallMode()
    await swapPackage(contentDir, version)
    return { ok: true, version, installMode }
  } catch (error) {
    if (error instanceof HttpError) throw error
    try { ctx.logger?.warn?.(`[workspace-studio] update failed: ${String(error)}`) } catch { /* no logger */ }
    throw new HttpError(500, 'update-swap-failed', `更新失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    updateInProgress = false
  }
}
