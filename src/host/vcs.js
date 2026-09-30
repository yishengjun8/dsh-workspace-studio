/** Read-only Git / SVN working-copy status for the workspace file browser.
 *
 * The browsing pane is snapshot-based, so this module answers one "what is the
 * working-copy state of this workspace" question per request and is cached by a
 * short TTL. It never writes to the repository (no index lock, no hook, no
 * credential prompt) and never touches the network: `git status` runs with
 * `--no-optional-locks` + GIT_OPTIONAL_LOCKS=0, `svn status` runs without `-u`.
 *
 * Every degradation (missing CLI, timeout, unexpected failure) is reported in
 * the payload's `error` field with a 200 so the client always receives the full
 * shape and can keep showing its last good result; only the request fence
 * (untrusted origin, unknown workspace) fails with a real HTTP error.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { Buffer } from 'node:buffer'
import { HttpError } from './errors.js'

const execFileAsync = promisify(execFile)

/** How long a resolved executable stays cached (a missing CLI is not re-probed per request). */
const PROBE_TTL_MS = 300_000
/** How long repository detection (kind / branch / WC revision) stays cached. */
const DETECT_TTL_MS = 60_000
/** Hard cap on one tool invocation's stdout: an oversized working copy truncates instead of buffering.
 *  It doubles as the execFile maxBuffer, whose overflow is handled as truncation. */
export const VCS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
/** Hard cap on the folded ignored-path prefix list. */
export const VCS_IGNORED_MAX = 1000
const PROBE_TIMEOUT_MS = 4000
const MAXBUFFER_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

const probeCache = new Map()
const detectCache = new Map()
const statusCache = new Map()
const inFlight = new Map()

/** Decode tool stdout as UTF-8; undecodable bytes become U+FFFD instead of throwing. */
function decodeText(bytes) {
  return Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '')
}
function trimOutput(bytes) {
  return decodeText(bytes).replace(/[\r\n]+$/, '')
}
/** Forward-slash form of a repository-reported path. */
function toForward(value) {
  return value.replace(/\\/g, '/')
}
/** One path inside `list` that is `path` itself or an ancestor directory of it. */
function hasPrefix(list, path) {
  return list.some(prefix => prefix === path || (prefix.endsWith('/') && path.startsWith(prefix)))
}
async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Run one tool with the plugin's fixed env: no terminal prompt, no optional index lock. */
async function runTool(file, args, { cwd, timeout, maxBuffer = VCS_MAX_OUTPUT_BYTES }) {
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      encoding: 'buffer',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      maxBuffer,
      timeout,
      windowsHide: true,
    })
    return { ok: true, stdout: result.stdout }
  } catch (error) {
    /* A maxBuffer overflow still carries the partial stdout: report it as usable-with-truncation instead of a failure. */
    const overflow = error?.code === MAXBUFFER_CODE
    return { ok: false, stdout: error?.stdout, overflow, error }
  }
}
/** Classify a failed invocation: 'missing' (no such executable), 'timeout' (killed by the watchdog), 'failed' (non-zero exit). */
function failureKind(result) {
  const error = result.error
  if (error?.code === 'ENOENT') return 'missing'
  if (error?.killed === true || (error?.signal !== null && error?.signal !== undefined)) return 'timeout'
  return 'failed'
}

/** Absolute-path candidates for a tool the PATH lookup could not resolve.
 *  GUI-launched desktop shells inherit a minimal PATH on macOS, so the usual
 *  install prefixes are probed as a capability fallback (never a shell branch). */
function candidatePaths(tool, platform = process.platform, env = process.env) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(root => typeof root === 'string' && root !== '')
  if (platform === 'win32') {
    if (tool === 'git') return roots.map(root => join(root, 'Git', 'cmd', 'git.exe'))
    return roots.flatMap(root => [join(root, 'TortoiseSVN', 'bin', 'svn.exe'), join(root, 'Subversion', 'bin', 'svn.exe')])
  }
  const prefixes = platform === 'darwin'
    ? ['/usr/local/bin', '/opt/homebrew/bin', '/opt/local/bin', '/usr/bin']
    : ['/usr/bin', '/usr/local/bin', '/bin']
  return prefixes.map(prefix => join(prefix, tool))
}

/** Resolve a usable executable for one tool (configured name, PATH, then platform candidates); undefined when nothing works.
 *  An explicitly configured name that differs from the tool's own name is authoritative: the user
 *  named a binary, so silently running a different one from a well-known install prefix would make
 *  the setting look ignored (it degrades to "command not found" instead). */
async function resolveExecutable(tool, configured, platform, env) {
  const explicit = typeof configured === 'string' && configured.trim() !== '' && configured.trim() !== tool
    ? configured.trim()
    : undefined
  const cacheKey = `${tool}:${explicit ?? ''}`
  const cached = probeCache.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.at < PROBE_TTL_MS) return cached.value
  const names = explicit === undefined ? [tool] : [explicit]
  let value
  for (const name of names) {
    const result = await runTool(name, ['--version'], { timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 })
    if (result.ok) { value = name; break }
    if (explicit === undefined && failureKind(result) === 'missing') {
      /* Not on PATH: try the platform's absolute install locations for the same binary name. */
      for (const candidate of candidatePaths(tool, platform, env)) {
        const probe = await runTool(candidate, ['--version'], { timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 })
        if (probe.ok) { value = candidate; break }
      }
      if (value !== undefined) break
    }
  }
  probeCache.set(cacheKey, { at: Date.now(), value })
  return value
}

/** Git's `--show-prefix` form: repo-root-relative prefix of the current directory, always a trailing-slash directory path. */
function normalizePrefix(raw) {
  const value = toForward(raw.trim())
  if (value === '') return ''
  return value.endsWith('/') ? value : `${value}/`
}

/** Short git label: the current branch, else the detached short revision, else empty. */
async function readGitLabel(file, root) {
  const branch = await runTool(file, ['branch', '--show-current'], { cwd: root, timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 })
  if (branch.ok) {
    const name = trimOutput(branch.stdout)
    if (name !== '') return name
  }
  const revision = await runTool(file, ['rev-parse', '--short', 'HEAD'], { cwd: root, timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 })
  return revision.ok ? trimOutput(revision.stdout) : ''
}

async function detectGit(file, root) {
  const top = await runTool(file, ['rev-parse', '--show-toplevel'], { cwd: root, timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 })
  if (!top.ok) return null
  const repoRoot = trimOutput(top.stdout)
  if (repoRoot === '') return null
  const prefixResult = await runTool(file, ['rev-parse', '--show-prefix'], { cwd: root, timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 })
  return {
    kind: 'git',
    available: true,
    file,
    repoRoot: resolve(repoRoot),
    prefix: prefixResult.ok ? normalizePrefix(decodeText(prefixResult.stdout)) : '',
    label: await readGitLabel(file, root),
  }
}

/** Revision label of an `svn info --xml` document (`<commit revision="1234">`), else empty. */
export function parseSvnInfoRevision(xml) {
  const match = /<commit\b[^>]*\brevision="(\d+)"/.exec(xml)
  return match === null ? '' : match[1]
}

async function detectSvn(file, root) {
  const info = await runTool(file, ['info', '--xml'], { cwd: root, timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 })
  if (!info.ok) return null
  const revision = parseSvnInfoRevision(decodeText(info.stdout))
  return { kind: 'svn', available: true, file, repoRoot: root, prefix: '', label: revision === '' ? '' : `r${revision}` }
}

/** Detection for a host whose CLI is missing: the metadata directory alone tells the user why nothing is shown. */
async function detectMetadataOnly(root) {
  if (await pathExists(join(root, '.git'))) return { kind: 'git', available: false, file: undefined, repoRoot: root, prefix: '', label: '' }
  if (await pathExists(join(root, '.svn'))) return { kind: 'svn', available: false, file: undefined, repoRoot: root, prefix: '', label: '' }
  return { kind: null, available: true, file: undefined, repoRoot: root, prefix: '', label: '' }
}

async function detectRepo(workspaceId, root, config) {
  const cached = detectCache.get(workspaceId)
  if (cached !== undefined && Date.now() - cached.at < DETECT_TTL_MS && cached.root === root) return cached.value
  const gitFile = await resolveExecutable('git', config.gitExecutable, config.platform, config.env)
  if (gitFile !== undefined) {
    const git = await detectGit(gitFile, root)
    if (git !== null) {
      detectCache.set(workspaceId, { at: Date.now(), root, value: git })
      return git
    }
  }
  const svnFile = await resolveExecutable('svn', config.svnExecutable, config.platform, config.env)
  if (svnFile !== undefined) {
    const svn = await detectSvn(svnFile, root)
    if (svn !== null) {
      detectCache.set(workspaceId, { at: Date.now(), root, value: svn })
      return svn
    }
  }
  const fallback = await detectMetadataOnly(root)
  detectCache.set(workspaceId, { at: Date.now(), root, value: fallback })
  return fallback
}

/** Convert a repository-reported path (always repo-root-relative for git) into a workspace-relative one; null when it lies outside. */
export function toWorkspaceRelative(rawPath, prefix) {
  const normalized = toForward(rawPath).replace(/^\.\//, '')
  if (normalized === '' || normalized === '.') return null
  if (prefix === '') return normalized
  if (!normalized.startsWith(prefix)) return null
  const tail = normalized.slice(prefix.length)
  return tail === '' ? null : tail
}

/** The single letter a badge shows: the worktree state wins, then the staged state, then "untracked". */
export function gitStatusLetter(indexStatus, worktreeStatus) {
  if (worktreeStatus !== ' ' && worktreeStatus !== '?') return worktreeStatus
  if (indexStatus !== ' ' && indexStatus !== '?') return indexStatus
  if (indexStatus === '?' || worktreeStatus === '?') return '?'
  return ' '
}
/** Unmerged combinations git reports in porcelain v1. */
function isGitConflict(indexStatus, worktreeStatus) {
  if (indexStatus === 'U' || worktreeStatus === 'U') return true
  return (indexStatus === 'A' && worktreeStatus === 'A')
    || (indexStatus === 'D' && worktreeStatus === 'D')
}

/** Parse `git status --porcelain=v1 -z` bytes into workspace-relative entries.
 *  Rename/copy records carry their source path in the NEXT NUL field. A stream
 *  whose last field was cut off by the output cap ends without NUL and has that
 *  fragment dropped. */
export function parseGitPorcelain(stdout, prefix = '') {
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''), 'utf8')
  const complete = bytes.length > 0 && bytes[bytes.length - 1] === 0
  const fields = decodeText(bytes).split('\u0000')
  if (!complete) fields.pop()
  const entries = []
  let index = 0
  while (index < fields.length) {
    const record = fields[index]
    index += 1
    if (record === '' || record.length < 4) continue
    const indexStatus = record[0]
    const worktreeStatus = record[1]
    let from = null
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      const source = fields[index]
      index += 1
      from = source === undefined || source === '' ? null : toWorkspaceRelative(source, prefix)
    }
    const renamed = indexStatus === 'R' || worktreeStatus === 'R'
    const path = toWorkspaceRelative(record.slice(3), prefix)
    if (path === null) continue
    const directory = path.endsWith('/')
    entries.push({
      path: directory ? path.slice(0, -1) : path,
      status: gitStatusLetter(indexStatus, worktreeStatus),
      index: indexStatus,
      worktree: worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      untracked: indexStatus === '?',
      deleted: gitStatusLetter(indexStatus, worktreeStatus) === 'D',
      conflict: isGitConflict(indexStatus, worktreeStatus),
      props: false,
      ignored: false,
      directory,
      from: renamed ? from : null,
    })
  }
  return entries
}

/** Ignored paths (`!!`) from a `--ignored=traditional` run: directories arrive collapsed as `dir/`. */
export function parseGitIgnored(stdout, prefix = '') {
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''), 'utf8')
  const complete = bytes.length > 0 && bytes[bytes.length - 1] === 0
  const fields = decodeText(bytes).split('\u0000')
  if (!complete) fields.pop()
  const paths = []
  for (const record of fields) {
    if (!record.startsWith('!! ')) continue
    const path = toWorkspaceRelative(record.slice(3), prefix)
    if (path !== null) paths.push(path)
  }
  return paths
}

const XML_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })
/** Decode the five XML entities an `svn status --xml` path attribute can carry. */
export function decodeXmlText(value) {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (match, name) => XML_ENTITIES[name] ?? match)
}

/** SVN `wc-status item` values mapped to the badge letter the client understands. */
const SVN_STATUS_LETTERS = Object.freeze({
  added: 'A',
  conflicted: 'C',
  deleted: 'D',
  external: 'E',
  ignored: 'I',
  incomplete: '!',
  merged: 'G',
  missing: '!',
  modified: 'M',
  obstructed: '~',
  replaced: 'R',
  unversioned: '?',
})

/** Parse an `svn status --xml --depth infinity` document into workspace-relative entries.
 *  `svn status` prints CWD-relative paths, so no prefix conversion applies. */
export function parseSvnStatusXml(xml) {
  const entries = []
  const entryPattern = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/g
  let match
  while ((match = entryPattern.exec(xml)) !== null) {
    const pathMatch = /\bpath="([^"]*)"/.exec(match[1])
    if (pathMatch === null) continue
    const statusMatch = /<wc-status\b([^>]*?)\/?>/.exec(match[2])
    if (statusMatch === null) continue
    const itemMatch = /\bitem="([^"]*)"/.exec(statusMatch[1])
    const propsMatch = /\bprops="([^"]*)"/.exec(statusMatch[1])
    const item = itemMatch === null ? 'none' : itemMatch[1]
    const props = propsMatch !== null && propsMatch[1] === 'modified'
    const mapped = SVN_STATUS_LETTERS[item]
    if (mapped === undefined && !props) continue
    const rawPath = decodeXmlText(pathMatch[1])
    const normalized = toForward(rawPath).replace(/^\.\//, '')
    if (normalized === '' || normalized === '.') continue
    const directory = normalized.endsWith('/')
    const path = directory ? normalized.slice(0, -1) : normalized
    const status = mapped ?? 'M'
    entries.push({
      path,
      status,
      index: status,
      worktree: status,
      staged: false,
      untracked: status === '?',
      deleted: status === 'D' || status === '!',
      conflict: status === 'C',
      props,
      ignored: status === 'I',
      directory,
      from: null,
    })
  }
  return entries
}

/** Fold a path list into the smallest set of directory prefixes (a directory already covered is dropped). */
export function foldIgnoredPaths(paths, limit = VCS_IGNORED_MAX) {
  const kept = []
  const sorted = [...new Set(paths)].sort((left, right) => left.localeCompare(right, 'en'))
  for (const path of sorted) {
    if (hasPrefix(kept, path)) continue
    kept.push(path)
    if (kept.length >= limit) break
  }
  return kept
}

/** Counters the status bar shows. */
function summarize(entries) {
  const counts = { total: 0, staged: 0, untracked: 0, conflict: 0, ignored: 0 }
  for (const entry of entries) {
    if (entry.ignored) { counts.ignored += 1; continue }
    counts.total += 1
    if (entry.staged) counts.staged += 1
    if (entry.untracked) counts.untracked += 1
    if (entry.conflict) counts.conflict += 1
  }
  return counts
}

function failurePayload(kind, detection, error) {
  return {
    kind,
    available: detection.available !== false,
    root: '',
    label: detection.label ?? '',
    counts: summarize([]),
    entries: [],
    ignoredPrefixes: [],
    truncated: false,
    error,
  }
}

/** `git status` for the workspace subtree only (`-- .`), bounded by the output cap. */
async function readGitStatus(detection, root, config, includeIgnored) {
  const args = ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']
  const result = await runTool(detection.file, args, { cwd: root, timeout: config.vcsTimeoutMs, maxBuffer: VCS_MAX_OUTPUT_BYTES })
  if (!result.ok && !result.overflow) {
    const kind = failureKind(result)
    return {
      payload: failurePayload('git', detection, {
        code: kind === 'timeout' ? 'vcs-timeout' : 'vcs-failed',
        message: kind === 'timeout' ? 'git status 超时' : `git status 执行失败（${kind}）`,
      }),
    }
  }
  const entries = parseGitPorcelain(result.stdout, detection.prefix)
  let ignoredPrefixes = []
  if (includeIgnored) {
    /* The ignored pass runs with `--untracked-files=normal`, so git collapses an ignored directory
       into ONE `dir/` record instead of listing every file inside it (with `=all`, node_modules
       alone can exceed the output cap). Only the `!!` records are kept. */
    const ignoredArgs = ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--ignored=traditional', '--untracked-files=normal', '--', '.']
    const ignoredResult = await runTool(detection.file, ignoredArgs, { cwd: root, timeout: config.vcsTimeoutMs, maxBuffer: VCS_MAX_OUTPUT_BYTES })
    if (ignoredResult.ok || ignoredResult.overflow) ignoredPrefixes = foldIgnoredPaths(parseGitIgnored(ignoredResult.stdout, detection.prefix))
  }
  return { entries, ignoredPrefixes, truncated: result.overflow === true }
}

async function readSvnStatus(detection, root, config, includeIgnored) {
  const args = ['status', '--xml', '--depth', 'infinity']
  if (includeIgnored) args.push('--no-ignore')
  const result = await runTool(detection.file, args, { cwd: root, timeout: config.vcsTimeoutMs, maxBuffer: VCS_MAX_OUTPUT_BYTES })
  if (!result.ok && !result.overflow) {
    const kind = failureKind(result)
    return {
      payload: failurePayload('svn', detection, {
        code: kind === 'timeout' ? 'vcs-timeout' : 'vcs-failed',
        message: kind === 'timeout' ? 'svn status 超时' : `svn status 执行失败（${kind}）`,
      }),
    }
  }
  /* An overflow cuts the XML document mid-node: the regex parser simply skips an unterminated <entry>. */
  const entries = parseSvnStatusXml(decodeText(result.stdout))
  const ignored = entries.filter(entry => entry.ignored).map(entry => (entry.directory ? `${entry.path}/` : entry.path))
  return { entries, ignoredPrefixes: foldIgnoredPaths(ignored), truncated: result.overflow === true }
}

/** Repo root as a workspace-relative forward-slash path (empty when it is the workspace itself or outside it). */
function relativeRepoRoot(root, detection) {
  if (detection.kind !== 'git') return ''
  const tail = toForward(relative(root, detection.repoRoot))
  if (tail === '' || tail.startsWith('..')) return ''
  return tail
}

function emptyPayload(workspaceId, detection) {
  return {
    workspaceId,
    kind: detection.kind,
    available: detection.available !== false,
    root: '',
    label: detection.label ?? '',
    counts: summarize([]),
    entries: [],
    ignoredPrefixes: [],
    truncated: false,
    error: detection.available === false
      ? {
        code: 'vcs-unavailable',
        /* Name the tool the user has to install/configure; the client renders its own localized text and only uses this for logs. */
        message: `未检测到 ${detection.kind} 命令`,
      }
      : undefined,
  }
}

async function buildStatus(workspaceId, root, config, includeIgnored) {
  const detection = await detectRepo(workspaceId, root, config)
  if (detection.kind === null) return { ...emptyPayload(workspaceId, detection), error: undefined }
  if (!detection.available) return emptyPayload(workspaceId, detection)
  const read = detection.kind === 'git'
    ? await readGitStatus(detection, root, config, includeIgnored)
    : await readSvnStatus(detection, root, config, includeIgnored)
  if (read.payload !== undefined) return { workspaceId, ...read.payload }
  const limit = config.vcsMaxEntries
  const truncated = read.truncated || read.entries.length > limit
  const entries = truncated ? read.entries.slice(0, limit) : read.entries
  return {
    workspaceId,
    kind: detection.kind,
    available: true,
    root: relativeRepoRoot(root, detection),
    label: detection.label ?? '',
    counts: summarize(entries),
    entries,
    ignoredPrefixes: read.ignoredPrefixes,
    truncated,
  }
}

/** Configuration view of one request: the caller's config plus the probe seams tests can override. */
function effectiveConfig(config) {
  return {
    enableVcsStatus: config.enableVcsStatus,
    gitExecutable: config.gitExecutable,
    svnExecutable: config.svnExecutable,
    vcsTimeoutMs: config.vcsTimeoutMs,
    vcsCacheTtlMs: config.vcsCacheTtlMs,
    vcsMaxEntries: config.vcsMaxEntries,
    platform: process.platform,
    env: process.env,
  }
}

/** Working-copy status of one workspace. `refresh` bypasses the payload TTL (still deduplicated). */
export async function readVcsStatus(workspace, config, options = {}) {
  const workspaceId = String(workspace.id)
  const settings = effectiveConfig(config)
  if (settings.enableVcsStatus === false) {
    return {
      workspaceId,
      enabled: false,
      kind: null,
      available: true,
      root: '',
      label: '',
      counts: summarize([]),
      entries: [],
      ignoredPrefixes: [],
      truncated: false,
    }
  }
  const key = `${workspaceId}:${options.includeIgnored === true ? 'ignored' : 'plain'}`
  const cached = statusCache.get(key)
  if (options.refresh !== true && cached !== undefined && Date.now() - cached.at < settings.vcsCacheTtlMs) return cached.payload
  const running = inFlight.get(key)
  if (running !== undefined) return running
  const pending = (async () => {
    const root = await realpath(workspace.path)
    const payload = await buildStatus(workspaceId, root, settings, options.includeIgnored === true)
    statusCache.set(key, { at: Date.now(), payload })
    return payload
  })()
  inFlight.set(key, pending)
  try {
    return await pending
  } catch (error) {
    /* A real filesystem failure (the workspace vanished) is the caller's to report; a tool failure never reaches here. */
    if (error instanceof HttpError) throw error
    throw new HttpError(503, 'vcs-failed', '无法读取版本控制状态')
  } finally {
    /* Only clear the slot this call owns: a request that arrived while this one was in flight must not be evicted. */
    if (inFlight.get(key) === pending) inFlight.delete(key)
  }
}
