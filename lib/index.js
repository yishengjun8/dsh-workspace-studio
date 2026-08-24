import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { homedir, release as osRelease } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import z from '@deepseek-ai/schemastery'
import iconv from 'iconv-lite'

const execFileAsync = promisify(execFile)

/** Stable Cordis plugin name. */
export const name = 'workspace-studio'

/** Host services required by the workspace browser route. */
export const inject = ['webServer', 'workspaceRegistry', 'webRuntime', 'sessions']

/** Host-side limits. All bounds are deployment-configurable in cordis.patch.yml. */
export const Config = z.object({
  maxEntriesPerDirectory: z.natural().min(1).max(10_000).default(1000),
  maxPreviewBytes: z.natural().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  // Cap on bytes the browser may upload when a user drags a non-workspace file
  // into the preview pane. The preview display still truncates to maxPreviewBytes.
  maxExternalUploadBytes: z.natural().min(1024).max(256 * 1024 * 1024).default(8 * 1024 * 1024),
  maxContextBytes: z.natural().min(1024).max(1024 * 1024).default(64 * 1024),
  maxPromptContextBytes: z.natural().min(4096).max(2 * 1024 * 1024).default(68 * 1024),
  maxContextSourceBytes: z.natural().min(1024).max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  enableEditing: z.boolean().default(false),
  maxEditableBytes: z.natural().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  maxEntryNameBytes: z.natural().min(1).max(1024).default(255),
  maxMutationBodyBytes: z.natural().min(128).max(64 * 1024).default(4096),
  searchExcludeDirs: z.array(z.string()).default(['.git', 'node_modules']),
  maxSearchFileBytes: z.natural().min(1024).max(64 * 1024 * 1024).default(1024 * 1024),
  maxSearchFiles: z.natural().min(1).max(10_000).default(10_000),
  maxSearchMatches: z.natural().min(1).max(100_000).default(2000),
  maxMatchesPerFile: z.natural().min(1).max(10_000).default(100),
  searchConcurrency: z.natural().min(1).max(64).default(16),
  maxSearchQueryLength: z.natural().min(1).max(4096).default(1024),
})

const API_PREFIX = '/workspace-studio/api'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
}
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function canonicalAuthority(authority, parsed) {
  const port = parsed.port !== '' ? parsed.port : new URL(`https://${authority}`).port
  return port === '' ? parsed.hostname : `${parsed.hostname}:${port}`
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '[::1]'
    || normalized === '::1'
    || /^127(?:\.[0-9]{1,3}){3}$/.test(normalized)
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const parsed = parseAuthority(entry)
    if (parsed === undefined) return false
    return canonicalAuthority(entry, parsed) === parsed.hostname
      ? parsed.hostname === hostUrl.hostname
      : parsed.host === hostUrl.host
  })
}

/** Apply the same Host/Origin/Fetch-Metadata fence used by the built-in /api route. */
function isTrustedRequest(req, trustedHosts) {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function sendJson(req, res, status, value, extraHeaders = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': String(body.byteLength),
    ...extraHeaders,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

function sendError(req, res, status, code, message, extraHeaders) {
  sendJson(req, res, status, { error: { code, message } }, extraHeaders)
}

function requiredQuery(url, name) {
  const value = url.searchParams.get(name)
  if (value === null || value === '') throw new HttpError(400, 'invalid-request', `缺少查询参数 ${name}`)
  return value
}

function normalizeRelativePath(value) {
  if (value === '') return ''
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)
    || value.includes('\\') || value.startsWith('/') || isAbsolute(value)) {
    throw new HttpError(400, 'invalid-path', '文件路径必须是工作区内的相对路径')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new HttpError(400, 'invalid-path', '文件路径包含无效段')
  }
  return parts.join('/')
}

function isInside(root, target) {
  const tail = relative(root, target)
  return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail))
}

async function resolveWorkspacePath(root, relativePath) {
  const candidate = relativePath === '' ? root : resolve(root, ...relativePath.split('/'))
  let target
  try {
    target = await realpath(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new HttpError(404, 'path-not-found', '文件或目录不存在')
    throw error
  }
  if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝访问工作区之外的路径')
  return target
}

/** Whether the Linux host is Windows Subsystem for Linux (WSL). */
function isWslHost() {
  const env = process.env
  return (env.WSL_DISTRO_NAME !== undefined && env.WSL_DISTRO_NAME !== '')
    || (env.WSL_INTEROP !== undefined && env.WSL_INTEROP !== '')
    || osRelease().toLowerCase().includes('microsoft')
}

/** Translate a Linux path to the Windows path WSL exposes it under. */
async function translateToWindowsPath(path) {
  let stdout
  try {
    ({ stdout } = await execFileAsync('wslpath', ['-w', path]))
  } catch {
    // wslpath missing or failing is a host configuration problem, not a
    // missing path; report it as a clear reveal failure instead of letting
    // the raw ENOENT surface as a misleading path-not-found.
    throw new HttpError(500, 'wsl-translate-failed', '无法将路径转换为 Windows 路径')
  }
  const translated = stdout.replace(/[\r\n]+$/, '')
  if (translated === '') throw new HttpError(500, 'wsl-translate-failed', '无法将路径转换为 Windows 路径')
  return translated
}

/**
 * Resolve the native "reveal in file manager" command for one path.
 * Directories open in place; files reveal inside their containing folder.
 * Returns undefined on platforms with no desktop file manager.
 */
async function revealCommandFor(target, directory, platform = process.platform) {
  if (platform === 'win32') {
    return { file: 'explorer.exe', args: directory ? [target] : [`/select,${target}`] }
  }
  if (platform === 'darwin') {
    return { file: 'open', args: ['-R', target] }
  }
  if (platform === 'linux') {
    if (isWslHost()) {
      const windowsPath = await translateToWindowsPath(target)
      return { file: 'explorer.exe', args: directory ? [windowsPath] : [`/select,${windowsPath}`] }
    }
    return { file: 'xdg-open', args: [directory ? target : dirname(target)] }
  }
  return undefined
}

/** Spawn a detached native reveal command and wait for it to actually launch. */
function launchNativeReveal(command) {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch()
    })
  })
}

/** Open one workspace-confined path in the operating system's file manager. */
async function revealInExplorer(workspace, relativePath) {
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, relativePath)
  const targetStat = await stat(target)
  try {
    const command = await revealCommandFor(target, targetStat.isDirectory())
    if (command === undefined) {
      throw new HttpError(501, 'unsupported-platform', '当前系统没有可用的桌面文件管理器')
    }
    await launchNativeReveal(command)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(500, 'reveal-failed', '无法在资源管理器中打开该路径')
  }
  return { workspaceId: String(workspace.id), path: relativePath, opened: true }
}

function entryPath(parent, name) {
  return parent === '' ? name : `${parent}/${name}`
}

function parentPath(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function normalizeEntryName(value, maxEntryNameBytes) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-path', '文件名必须是工作区内的单个名称')
  const name = value.trim()
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(name)) {
    throw new HttpError(400, 'invalid-path', '文件名必须是工作区内的单个名称')
  }
  if (Buffer.byteLength(name, 'utf8') > maxEntryNameBytes) {
    throw new HttpError(413, 'entry-name-too-large', `文件名不能超过 ${maxEntryNameBytes} 字节`)
  }
  return name
}

async function describeEntry(root, directory, parent, dirent) {
  const base = { name: dirent.name, path: entryPath(parent, dirent.name), symlink: dirent.isSymbolicLink() }
  if (dirent.isDirectory()) return { ...base, kind: 'directory' }
  if (dirent.isFile()) return { ...base, kind: 'file' }
  if (!dirent.isSymbolicLink()) return { ...base, kind: 'other' }
  try {
    const linked = await realpath(resolve(directory, dirent.name))
    if (!isInside(root, linked)) return { ...base, kind: 'blocked' }
    const linkedStat = await stat(linked)
    if (linkedStat.isDirectory()) return { ...base, kind: 'directory' }
    if (linkedStat.isFile()) return { ...base, kind: 'file' }
    return { ...base, kind: 'other' }
  } catch {
    return { ...base, kind: 'blocked' }
  }
}

function compareEntries(left, right) {
  const rank = { directory: 0, file: 1, other: 2, blocked: 3 }
  const byKind = rank[left.kind] - rank[right.kind]
  return byKind || left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' })
}

function describeCreatedEntry(workspace, relativePath, kind) {
  return {
    workspaceId: String(workspace.id),
    path: relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    kind,
    symlink: false,
  }
}

async function listTree(workspace, relativePath, maxEntriesPerDirectory) {
  const root = await realpath(workspace.path)
  const directory = await resolveWorkspacePath(root, relativePath)
  const directoryStat = await stat(directory)
  if (!directoryStat.isDirectory()) throw new HttpError(400, 'not-a-directory', '所选路径不是目录')
  const raw = await readdir(directory, { withFileTypes: true })
  const entries = await Promise.all(raw.map(dirent => describeEntry(root, directory, relativePath, dirent)))
  entries.sort(compareEntries)
  const truncated = entries.length > maxEntriesPerDirectory
  return {
    workspaceId: String(workspace.id),
    path: relativePath,
    entries: entries.slice(0, maxEntriesPerDirectory),
    truncated,
  }
}

const SEARCH_WINDOW_BEFORE = 120
const SEARCH_WINDOW_AFTER = 240

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Literal substring search over one decoded file window, one entry per match. */
function findMatches(content, query, caseSensitive, cap) {
  let re
  try {
    re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi')
  } catch {
    return []
  }
  const results = []
  const lines = content.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length && results.length < cap; lineIndex += 1) {
    const raw = lines[lineIndex]
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    re.lastIndex = 0
    let match
    while (results.length < cap && (match = re.exec(text)) !== null) {
      const start = match.index
      const length = match[0].length
      const trimmed = text.length > SEARCH_WINDOW_BEFORE + length + SEARCH_WINDOW_AFTER
      const from = trimmed ? Math.max(0, start - SEARCH_WINDOW_BEFORE) : 0
      const to = trimmed ? Math.min(text.length, start + length + SEARCH_WINDOW_AFTER) : text.length
      results.push({
        line: lineIndex + 1,
        text: `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`,
        // Columns relative to the displayed snippet window (used to highlight
        // the hit inside the snippet)…
        startColumn: start - from + 1,
        endColumn: start - from + length + 1,
        // …plus absolute 1-based columns within the FULL line, so the client
        // can reveal/select the true match position in the editor even when
        // the snippet window is truncated (startColumn would otherwise be
        // pinned near column 121 for any match beyond the window).
        startLineColumn: start + 1,
        endLineColumn: start + length + 1,
        lineTruncated: trimmed,
      })
    }
  }
  return results
}

async function searchFile(root, relativePath, query, caseSensitive, config) {
  const target = resolve(root, ...relativePath.split('/'))
  let targetStat
  try {
    targetStat = await stat(target)
  } catch {
    return null
  }
  if (!targetStat.isFile() || targetStat.size === 0) return null
  const truncated = targetStat.size > config.maxSearchFileBytes
  const searchBytes = await readPrefix(target, Math.min(targetStat.size, config.maxSearchFileBytes))
  if (containsNul(searchBytes)) return null
  const content = decodeUtf8(searchBytes, truncated)
  if (content === undefined) return null
  const matches = findMatches(content, query, caseSensitive, config.maxMatchesPerFile)
  if (matches.length === 0) return null
  return {
    path: relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    matches,
    truncated,
  }
}

/**
 * Walk the workspace (skipping symlinks and configured directories), search the
 * same per-file preview window the browser can display, and return matches
 * grouped by file with 1-based line numbers and match columns.
 */
async function searchWorkspace(workspace, query, caseSensitive, config) {
  const root = await realpath(workspace.path)
  const files = []
  const excluded = new Set(config.searchExcludeDirs.map(name => name.toLowerCase()))
  const walk = async (directory, relativePath) => {
    let raw
    try {
      raw = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of raw) {
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        if (excluded.has(dirent.name.toLowerCase())) continue
        await walk(resolve(directory, dirent.name), entryPath(relativePath, dirent.name))
      } else if (dirent.isFile()) {
        files.push(entryPath(relativePath, dirent.name))
      }
    }
  }
  await walk(root, '')
  files.sort()
  const results = []
  const fileCap = Math.min(files.length, config.maxSearchFiles)
  let index = 0
  let matchCount = 0
  let truncated = false
  const worker = async () => {
    while (index < fileCap && matchCount < config.maxSearchMatches) {
      const relativePath = files[index]
      index += 1
      const found = await searchFile(root, relativePath, query, caseSensitive, config)
      if (found === null) continue
      if (results.length >= config.maxSearchFiles) {
        truncated = true
        break
      }
      results.push(found)
      matchCount += found.matches.length
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(config.searchConcurrency, fileCap); i += 1) workers.push(worker())
  await Promise.all(workers)
  /* The result is incomplete exactly when the scan stopped before visiting
     every file (a file-cap or match-cap interruption while files remained).
     Hitting the match cap EXACTLY after the last file is complete, so the old
     `matchCount >= maxSearchMatches` term falsely marked such a search as
     truncated. Each worker's check-then-push is synchronous, so `results`
     never overshoots maxSearchFiles. */
  if (index < files.length) truncated = true
  results.sort((left, right) => left.path.localeCompare(right.path, 'en', { numeric: true, sensitivity: 'base' }))
  return {
    workspaceId: String(workspace.id),
    query,
    caseSensitive,
    files: results,
    matchCount,
    fileCount: results.length,
    truncated,
  }
}

function containsNul(bytes) {
  for (const byte of bytes) if (byte === 0) return true
  return false
}

function decodeUtf8(bytes, mayEndMidCharacter) {
  const maxTrim = mayEndMidCharacter ? Math.min(3, bytes.byteLength) : 0
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - trim))
    } catch {
      // A truncated valid code point can occupy up to four bytes; try the next shorter prefix.
    }
  }
  return undefined
}

function revisionFor(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Supported text encodings. `id` is the canonical identifier the API and the
 * Web client exchange; `decodeLabel` feeds the WHATWG TextDecoder used for
 * decoding, and `encode` the iconv-lite name used when writing. UTF-8 BOM and
 * UTF-16 LE/BE BOM are written by the encoder itself rather than by callers.
 */
const ENCODINGS = Object.freeze([
  { id: 'utf-8', label: 'UTF-8', decodeLabel: 'utf-8', encode: 'utf8' },
  { id: 'utf-8-bom', label: 'UTF-8（带 BOM）', decodeLabel: 'utf-8', encode: 'utf8' },
  { id: 'utf-16le', label: 'UTF-16 LE', decodeLabel: 'utf-16le', encode: 'utf16-le' },
  { id: 'utf-16be', label: 'UTF-16 BE', decodeLabel: 'utf-16be', encode: 'utf16-be' },
  { id: 'gbk', label: 'GBK', decodeLabel: 'gbk', encode: 'gbk' },
  { id: 'gb18030', label: 'GB18030', decodeLabel: 'gb18030', encode: 'gb18030' },
  { id: 'big5', label: 'Big5', decodeLabel: 'big5', encode: 'big5' },
  { id: 'shift_jis', label: 'Shift_JIS', decodeLabel: 'shift_jis', encode: 'shift_jis' },
  { id: 'euc-jp', label: 'EUC-JP', decodeLabel: 'euc-jp', encode: 'euc-jp' },
  { id: 'euc-kr', label: 'EUC-KR', decodeLabel: 'euc-kr', encode: 'euc-kr' },
  { id: 'iso-8859-1', label: 'ISO-8859-1（Latin-1）', decodeLabel: 'iso-8859-1', encode: 'latin1' },
  { id: 'windows-1252', label: 'Windows-1252', decodeLabel: 'windows-1252', encode: 'windows-1252' },
  { id: 'windows-1251', label: 'Windows-1251（西里尔）', decodeLabel: 'windows-1251', encode: 'windows-1251' },
  { id: 'ascii', label: 'ASCII', decodeLabel: 'ascii', encode: 'ascii' },
])

function encodingById(id) {
  const found = ENCODINGS.find(encoding => encoding.id === id)
  if (found === undefined) throw new HttpError(400, 'unsupported-encoding', '不支持的编码格式')
  return found
}

function hasBom(bytes, encodingId) {
  if (encodingId === 'utf-16le') return bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  if (encodingId === 'utf-16be') return bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  return bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/**
 * Decode bytes strictly as `encodingId`. UTF-8 keeps its existing trim-aware
 * decoder; other encodings use a fatal TextDecoder, retrying progressively
 * shorter prefixes so a truncated trailing character does not fail the read.
 */
function decodeBytes(bytes, encodingId, mayEndMidCharacter) {
  if (encodingId === 'utf-8' || encodingId === 'utf-8-bom') {
    return decodeUtf8(bytes, mayEndMidCharacter)
  }
  const spec = encodingById(encodingId)
  const maxTrim = mayEndMidCharacter ? Math.min(4, bytes.byteLength) : 0
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return new TextDecoder(spec.decodeLabel, { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - trim))
    } catch {
      // A truncated multi-byte sequence can occupy up to four bytes; try the next shorter prefix.
    }
  }
  return undefined
}

/* Code-point -> byte maps for the single-byte encodings, built from the same
 * WHATWG TextDecoder instances decodeBytes uses. Round-tripping through
 * iconv-lite is lossy in the 0x80..0x9F range (its code points differ from the
 * TextDecoder mapping), which silently corrupted those bytes on save; encoding
 * through the inverse decoder map keeps save-as identical to the preview. */
const SINGLE_BYTE_ENCODE_MAPS = (() => {
  const maps = new Map()
  for (const id of ['ascii', 'iso-8859-1', 'windows-1252', 'windows-1251']) {
    const spec = encodingById(id)
    const decoder = new TextDecoder(spec.decodeLabel)
    const map = new Map()
    for (let byte = 0; byte < 256; byte += 1) {
      const decoded = decoder.decode(Uint8Array.of(byte))
      if (decoded.length === 1) map.set(decoded.codePointAt(0), byte)
    }
    maps.set(id, map)
  }
  return maps
})()

/**
 * Encode text into bytes for `encodingId`. ASCII and the other single-byte
 * encodings replace unmappable characters with '?' (lenient), preserving every
 * byte the decoder itself can produce. UTF-16 encodings add their BOM here.
 */
function encodeText(text, encodingId) {
  if (encodingId === 'utf-8') return Buffer.from(text, 'utf8')
  if (encodingId === 'utf-8-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  }
  const singleByteMap = SINGLE_BYTE_ENCODE_MAPS.get(encodingId)
  if (singleByteMap !== undefined) {
    const bytes = Buffer.allocUnsafe(text.length)
    for (let index = 0; index < text.length; index += 1) {
      const byte = singleByteMap.get(text.codePointAt(index))
      bytes[index] = byte === undefined ? 0x3f : byte
    }
    return bytes
  }
  const spec = encodingById(encodingId)
  let body = iconv.encode(text, spec.encode)
  if (encodingId === 'utf-16le') body = Buffer.concat([Buffer.from([0xff, 0xfe]), body])
  else if (encodingId === 'utf-16be') body = Buffer.concat([Buffer.from([0xfe, 0xff]), body])
  return body
}

/** The encoding id to save back with, preserving a UTF-8 BOM when present. */
function effectiveReadEncoding(requestedId, bom) {
  if (requestedId === 'utf-8' && bom) return 'utf-8-bom'
  return requestedId
}

function textMetadata(bytes, content, encodingId = 'utf-8') {
  const bom = hasBom(bytes, encodingId)
  const crlf = (content.match(/\r\n/g) ?? []).length
  const withoutCrlf = content.replace(/\r\n/g, '')
  const lf = (withoutCrlf.match(/\n/g) ?? []).length
  const cr = (withoutCrlf.match(/\r/g) ?? []).length
  let lineEnding = 'none'
  const kinds = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0)
  if (kinds > 1) lineEnding = 'mixed'
  else if (crlf > 0) lineEnding = 'crlf'
  else if (lf > 0) lineEnding = 'lf'
  else if (cr > 0) lineEnding = 'cr'
  return { bom, lineEnding }
}

async function hasSymlinkComponent(root, relativePath) {
  let current = root
  for (const part of relativePath.split('/')) {
    current = resolve(current, part)
    if ((await lstat(current)).isSymbolicLink()) return true
  }
  return false
}

async function readPrefix(target, length) {
  const buffer = Buffer.alloc(length)
  const handle = await open(target, 'r')
  let offset = 0
  try {
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
  } finally {
    await handle.close()
  }
  return buffer.subarray(0, offset)
}

async function readPreview(workspace, relativePath, config, encodingId = 'utf-8') {
  if (relativePath === '') throw new HttpError(400, 'not-a-file', '请选择要预览的文件')
  const spec = encodingById(encodingId)
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, relativePath)
  const targetStat = await stat(target)
  if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '所选路径不是普通文件')
  const requested = Math.min(targetStat.size, config.maxPreviewBytes)
  const previewBytes = await readPrefix(target, requested)
  const truncated = targetStat.size > config.maxPreviewBytes
  const isUtf16 = encodingId === 'utf-16le' || encodingId === 'utf-16be'
  if (!isUtf16 && containsNul(previewBytes)) throw new HttpError(415, 'binary-file', '该文件包含二进制内容，无法进行文本预览')
  const content = decodeBytes(previewBytes, encodingId, truncated)
  if (content === undefined) throw new HttpError(415, 'invalid-encoding', `该文件不是有效的 ${spec.label} 编码，无法预览`)
  const metadata = textMetadata(previewBytes, content, encodingId)
  const effectiveEncoding = effectiveReadEncoding(encodingId, metadata.bom)
  let readOnlyReason
  if (!config.enableEditing) readOnlyReason = 'editing-disabled'
  else if (truncated) readOnlyReason = 'preview-truncated'
  else if (targetStat.size > config.maxEditableBytes) readOnlyReason = 'file-too-large'
  else if (metadata.lineEnding === 'mixed') readOnlyReason = 'mixed-line-endings'
  else if (await hasSymlinkComponent(root, relativePath)) readOnlyReason = 'symlink-path'
  const result = {
    workspaceId: String(workspace.id), path: relativePath, content, size: targetStat.size,
    truncated, encoding: effectiveEncoding, editable: readOnlyReason === undefined,
    readOnlyReason: readOnlyReason ?? null, maxContextBytes: config.maxContextBytes, ...metadata,
  }
  if (!truncated) result.revision = revisionFor(previewBytes)
  return result
}

/**
 * Preview a non-workspace file the browser uploaded after a drag-and-drop into
 * the preview pane. Browsers never expose the absolute path of a dropped file,
 * so the client uploads the raw bytes and this route decodes them with the same
 * pipeline as readPreview. The result is always read-only: there is no known
 * disk location to write back to.
 */
async function readExternalPreview(url, config, req) {
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'application/octet-stream' && contentType !== 'text/plain' && contentType !== 'text/plain;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '外部文件上传必须使用二进制或文本内容')
  }
  const encodingId = url.searchParams.get('encoding') ?? 'utf-8'
  encodingById(encodingId)
  const rawName = url.searchParams.get('name') ?? ''
  const name = typeof rawName === 'string' ? rawName.split(/[\\/]/).pop() ?? '' : ''
  if (name !== '' && Buffer.byteLength(name, 'utf8') > config.maxEntryNameBytes) {
    throw new HttpError(413, 'entry-name-too-large', '文件名过长')
  }
  const bytes = await readBody(
    req,
    config.maxExternalUploadBytes,
    'file-too-large',
    `外部文件不能超过 ${config.maxExternalUploadBytes} 字节`,
  )
  if (bytes.byteLength === 0) throw new HttpError(400, 'empty-file', '文件内容为空')
  const previewBytes = bytes.subarray(0, Math.min(bytes.byteLength, config.maxPreviewBytes))
  const truncated = bytes.byteLength > config.maxPreviewBytes
  const isUtf16 = encodingId === 'utf-16le' || encodingId === 'utf-16be'
  if (!isUtf16 && containsNul(previewBytes)) throw new HttpError(415, 'binary-file', '该文件包含二进制内容，无法进行文本预览')
  const content = decodeBytes(previewBytes, encodingId, truncated)
  if (content === undefined) throw new HttpError(415, 'invalid-encoding', `该文件不是有效的 ${encodingById(encodingId).label} 编码，无法预览`)
  const metadata = textMetadata(previewBytes, content, encodingId)
  const effectiveEncoding = effectiveReadEncoding(encodingId, metadata.bom)
  return {
    name,
    content,
    size: bytes.byteLength,
    truncated,
    encoding: effectiveEncoding,
    editable: false,
    readOnlyReason: 'external-file',
    ...metadata,
  }
}

function readBody(
  req,
  maximum,
  tooLargeCode = 'file-too-large',
  tooLargeMessage = `请求正文不能超过 ${maximum} 字节`,
  abortedMessage = '请求在正文接收完成前中断',
) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.byteLength
      if (size > maximum) {
        settled = true
        reject(new HttpError(413, tooLargeCode, tooLargeMessage))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) resolveBody(Buffer.concat(chunks, size))
    })
    req.on('aborted', () => {
      if (settled) return
      settled = true
      reject(new HttpError(400, 'request-aborted', abortedMessage))
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

async function serializeWrite(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  queues.set(key, current)
  try {
    return await current
  } finally {
    if (queues.get(key) === current) queues.delete(key)
  }
}

/** Serialize every source-workspace mutation through one queue. A workspace-wide
 * lock is deliberately coarse: save/create/rename/copy/move/delete can affect
 * overlapping source paths and target names that are not known until canonical
 * checks run. Keeping those checks inside this lock makes plugin-originated
 * mutations deterministic and lets destination allocation cover every suffix. */
function serializeWorkspaceMutation(queues, workspace, operation) {
  return serializeWrite(queues, `workspace:${String(workspace.id)}`, operation)
}

async function saveFile(workspace, relativePath, config, queues, req, encodingId = 'utf-8') {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (relativePath === '') throw new HttpError(400, 'not-a-file', '请选择要保存的文件')
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'text/plain' && contentType !== 'text/plain;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '保存请求必须使用 text/plain UTF-8 内容')
  }
  const ifMatch = header(req.headers, 'if-match')
  if (ifMatch === undefined || !/^[a-f0-9]{64}$/.test(ifMatch)) {
    throw new HttpError(428, 'revision-required', '保存请求必须提供有效的 If-Match 修订版本')
  }
  const declaredLength = header(req.headers, 'content-length')
  let declared
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new HttpError(400, 'invalid-content-length', 'Content-Length 必须是有效的非负整数')
    }
    declared = Number(declaredLength)
    if (!Number.isSafeInteger(declared) || declared > config.maxEditableBytes) {
      throw new HttpError(413, 'file-too-large', `保存内容不能超过 ${config.maxEditableBytes} 字节`)
    }
  }
  const bytes = await readBody(
    req,
    config.maxEditableBytes,
    'file-too-large',
    `保存内容不能超过 ${config.maxEditableBytes} 字节`,
  )
  if (declared !== undefined && bytes.byteLength !== declared) {
    throw new HttpError(400, 'content-length-mismatch', '请求正文长度与 Content-Length 不一致')
  }
  const text = decodeUtf8(bytes, false)
  if (text === undefined || containsNul(bytes)) {
    throw new HttpError(415, 'invalid-text', '保存内容必须是无二进制数据的有效 UTF-8 文本')
  }
  const outBytes = encodeText(text, encodingId)

  // This in-process route provides application-level containment for trusted local UI actions.
  // Canonical checks run inside the workspace mutation queue so every plugin-originated rename,
  // delete, or save observes one serial history. Kernel isolation of hostile local code remains
  // the Harness sandbox's responsibility.
  return serializeWorkspaceMutation(queues, workspace, async () => {
    const root = await realpath(workspace.path)
    const candidate = resolve(root, ...relativePath.split('/'))
    if (!isInside(root, candidate)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
    const target = await realpath(candidate)
    if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    const targetStat = await lstat(candidate)
    if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '只能保存已存在的普通文件')
    if (targetStat.size > config.maxEditableBytes) throw new HttpError(413, 'file-too-large', '现有文件超过可编辑大小限制')
    const current = await open(candidate, 'r')
    let currentBytes
    try {
      currentBytes = await current.readFile()
    } finally {
      await current.close()
    }
    const isUtf16 = encodingId === 'utf-16le' || encodingId === 'utf-16be'
    if (containsNul(currentBytes) && !isUtf16) {
      throw new HttpError(415, 'binary-file', '现有文件包含二进制内容，不能保存')
    }
    if (encodingId === 'utf-8' && decodeUtf8(currentBytes, false) === undefined) {
      throw new HttpError(415, 'binary-file', '现有文件不是可编辑的 UTF-8 文本')
    }
    if (revisionFor(currentBytes) !== ifMatch) throw new HttpError(409, 'file-conflict', '文件已被修改，请重新加载后再保存')

    const parent = dirname(candidate)
    const realParent = await realpath(parent)
    if (!isInside(root, realParent) || await hasSymlinkComponent(root, relativePath)) {
      throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
    }
    const temp = resolve(parent, `.${randomBytes(16).toString('hex')}.dsh-write.tmp`)
    let tempHandle
    let tempCreated = false
    try {
      tempHandle = await open(temp, 'wx', targetStat.mode & 0o777)
      tempCreated = true
      await tempHandle.chmod(targetStat.mode & 0o777)
      await tempHandle.writeFile(outBytes)
      await tempHandle.sync()
      await tempHandle.close()
      tempHandle = undefined
      if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
      const latest = await open(candidate, 'r')
      let latestBytes
      try {
        latestBytes = await latest.readFile()
      } finally {
        await latest.close()
      }
      if (revisionFor(latestBytes) !== ifMatch) throw new HttpError(409, 'file-conflict', '文件已被修改，请重新加载后再保存')
      await rename(temp, candidate)
    } finally {
      if (tempHandle !== undefined) await tempHandle.close().catch(() => {})
      if (tempCreated) {
        await unlink(temp).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
      }
    }
    return { workspaceId: String(workspace.id), path: relativePath, revision: revisionFor(outBytes), size: outBytes.byteLength, encoding: encodingId, bom: hasBom(outBytes, encodingId) }
  })
}

async function readJsonObject(req, config, maximum = config.maxMutationBodyBytes) {
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '请求必须使用 application/json 内容')
  }
  const declaredLength = header(req.headers, 'content-length')
  let declared
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new HttpError(400, 'invalid-content-length', 'Content-Length 必须是有效的非负整数')
    }
    declared = Number(declaredLength)
    if (!Number.isSafeInteger(declared) || declared > maximum) {
      throw new HttpError(413, 'request-too-large', `请求正文不能超过 ${maximum} 字节`)
    }
  }
  const bytes = await readBody(
    req,
    maximum,
    'request-too-large',
    `请求正文不能超过 ${maximum} 字节`,
  )
  if (declared !== undefined && bytes.byteLength !== declared) {
    throw new HttpError(400, 'content-length-mismatch', '请求正文长度与 Content-Length 不一致')
  }
  const text = decodeUtf8(bytes, false)
  if (text === undefined) throw new HttpError(415, 'invalid-json', '请求正文必须是有效 UTF-8 JSON')
  try {
    const value = JSON.parse(text)
    if (!isPlainObject(value)) throw new HttpError(400, 'invalid-json', '请求正文必须是 JSON 对象')
    return value
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid-json', '请求正文必须是有效 JSON')
  }
}

async function createEntry(workspace, relativePath, config, queues, req) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  const payload = await readJsonObject(req, config)
  const kind = payload.kind
  if (kind !== 'file' && kind !== 'directory') throw new HttpError(400, 'invalid-kind', '只能新建文件或文件夹')
  const name = normalizeEntryName(payload.name, config.maxEntryNameBytes)
  return serializeWorkspaceMutation(queues, workspace, async () => {
    const root = await realpath(workspace.path)
    const directory = await resolveWorkspacePath(root, relativePath)
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接修改目录')
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory()) throw new HttpError(400, 'not-a-directory', '所选路径不是目录')
    const targetPath = entryPath(relativePath, name)
    const target = resolve(directory, name)
    if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    try {
      if (kind === 'directory') {
        await mkdir(target)
      } else {
        let handle
        try {
          handle = await open(target, 'wx')
        } finally {
          if (handle !== undefined) await handle.close()
        }
      }
    } catch (error) {
      if (error?.code === 'EEXIST') throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
      throw error
    }
    return describeCreatedEntry(workspace, targetPath, kind)
  })
}

async function renameEntry(workspace, relativePath, config, queues, req) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (relativePath === '') throw new HttpError(400, 'invalid-path', '不能重命名工作区根目录')
  const payload = await readJsonObject(req, config)
  const name = normalizeEntryName(payload.name, config.maxEntryNameBytes)
  return serializeWorkspaceMutation(queues, workspace, async () => {
    const root = await realpath(workspace.path)
    const source = await resolveWorkspacePath(root, relativePath)
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝重命名符号链接路径')
    const sourceStat = await lstat(source)
    const kind = sourceStat.isDirectory() ? 'directory' : sourceStat.isFile() ? 'file' : undefined
    if (kind === undefined) throw new HttpError(400, 'invalid-entry-kind', '只能重命名文件或文件夹')
    const currentName = relativePath.slice(relativePath.lastIndexOf('/') + 1)
    if (name === currentName) return describeCreatedEntry(workspace, relativePath, kind)
    const sourceParentPath = parentPath(relativePath)
    const targetPath = entryPath(sourceParentPath, name)
    const parent = dirname(source)
    const realParent = await realpath(parent)
    if (!isInside(root, realParent) || await hasSymlinkComponent(root, sourceParentPath)) {
      throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接修改目录')
    }
    const target = resolve(parent, name)
    if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    let targetCollision
    try {
      targetCollision = await lstat(target)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (targetCollision !== undefined) {
      /* A target that resolves to the SAME entry as the source (only the
         letter case differs, on a case-insensitive filesystem such as NTFS or
         APFS) is a case-only rename, not a collision: nothing is overwritten
         and no data moves. Rename it in place; some filesystems refuse the
         in-place case change, so fall back to a hop through a unique temporary
         name before giving up. A genuinely different entry keeps 409. */
      if (sameEntryIdentity(sourceStat, targetCollision)) {
        try {
          await rename(source, target)
        } catch (error) {
          const temp = resolve(parent, `.${randomBytes(8).toString('hex')}.dsh-case.tmp`)
          try {
            await rename(source, temp)
            await rename(temp, target)
          } catch (renameError) {
            await rename(temp, source).catch(() => {})
            throw renameError
          }
        }
        return {
          workspaceId: String(workspace.id),
          fromPath: relativePath,
          path: targetPath,
          name,
          kind,
          symlink: false,
        }
      }
      throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
    }
    const copied = await copyTreeExclusive(source, target, sourceStat, false, false)
    if (copied === false) throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
    try {
      await verifyTreeSnapshot(copied.sourceSnapshot)
      const settledTarget = await realpath(target)
      if (!isInside(root, settledTarget) || await hasSymlinkComponent(root, targetPath)) {
        throw new HttpError(403, 'symlink-write-denied', '目标路径在重命名期间发生变化，源条目未删除')
      }
    } catch (error) {
      await cleanupCreatedTargets(copied.createdTargets, error)
    }
    try {
      await removeEntryTreeChecked(source, sourceStat, copied.sourceSnapshot)
    } catch (error) {
      throw new HttpError(409, 'file-conflict', '源条目删除失败，完整目标副本已保留，请人工确认源和目标')
    }
    return {
      workspaceId: String(workspace.id),
      fromPath: relativePath,
      path: targetPath,
      name,
      kind,
      symlink: false,
    }
  })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Stable-enough identity for the application boundary. Node exposes dev/ino
 * on Unix; Windows builds can report ino=0, where birth time is the best
 * cross-platform replacement signal available without native openat handles. */
function sameEntryIdentity(expected, current) {
  if (expected.isDirectory() !== current.isDirectory() || expected.isFile() !== current.isFile()) return false
  if (expected.ino !== 0 || current.ino !== 0) return expected.dev === current.dev && expected.ino === current.ino
  return expected.birthtimeMs === current.birthtimeMs && expected.mode === current.mode
}

function sameEntrySnapshot(expected, current) {
  return sameEntryIdentity(expected, current)
    && expected.size === current.size
    && expected.mtimeMs === current.mtimeMs
    && expected.ctimeMs === current.ctimeMs
}

function assertEntrySnapshot(expected, current) {
  if (!sameEntrySnapshot(expected, current)) {
    throw new HttpError(409, 'file-conflict', '源条目在文件操作期间发生变化，请刷新后重试')
  }
}

function directoryFingerprint(entries) {
  const rows = entries.map((entry) => [
    entry.name,
    entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other',
  ])
  rows.sort((left, right) => left[0].localeCompare(right[0], 'en'))
  return JSON.stringify(rows)
}

async function cleanupCreatedTargets(createdTargets, primaryError) {
  const failures = []
  for (let index = createdTargets.length - 1; index >= 0; index -= 1) {
    const created = createdTargets[index]
    try {
      const current = await lstat(created.path)
      if (!sameEntryIdentity(created.stat, current)) {
        failures.push(new Error(`refusing to clean replaced copy target ${created.path}`))
        continue
      }
      if (created.directory) await rmdir(created.path)
      else await unlink(created.path)
    } catch (error) {
      if (error?.code !== 'ENOENT') failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError([primaryError, ...failures], 'failed to clean one or more incomplete copy entries')
  }
  throw primaryError
}

/**
 * Copy one file or directory tree into a path that must not exist. Every file
 * uses COPYFILE_EXCL and every directory uses exclusive mkdir, so an external
 * creator cannot be overwritten between an existence probe and the commit.
 * Symlink children are omitted only for copy. Move/rename reject a tree that
 * contains one, because deleting the source after omission would lose entries.
 * The root call returns a complete source snapshot used again immediately
 * before destructive removal. Cleanup removes only identities this call made,
 * in reverse order, and never recursively erases an externally-added child.
 */
async function copyTreeExclusive(
  source,
  target,
  expectedSource,
  allowCollision,
  skipSymlinks,
  sourceSnapshot = [],
  createdTargets = [],
) {
  const rootCall = expectedSource !== undefined
  try {
    const sourceStat = await lstat(source)
    if (sourceStat.isSymbolicLink()) throw new HttpError(403, 'symlink-write-denied', '拒绝复制符号链接路径')
    if (!sourceStat.isDirectory() && !sourceStat.isFile()) {
      throw new HttpError(400, 'invalid-entry-kind', '只能复制文件或文件夹')
    }
    if (expectedSource !== undefined) assertEntrySnapshot(expectedSource, sourceStat)

    if (sourceStat.isFile()) {
      try {
        await copyFile(source, target, fsConstants.COPYFILE_EXCL)
      } catch (error) {
        if (error?.code === 'EEXIST' && allowCollision) return false
        if (error?.code === 'EEXIST') throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
        try {
          const partial = await lstat(target)
          createdTargets.push({ path: target, stat: partial, directory: partial.isDirectory() })
        } catch {}
        throw error
      }
      const targetStat = await lstat(target)
      createdTargets.push({ path: target, stat: targetStat, directory: false })
      await chmod(target, sourceStat.mode & 0o777)
      await utimes(target, sourceStat.atime, sourceStat.mtime)
      assertEntrySnapshot(sourceStat, await lstat(source))
      sourceSnapshot.push({ path: source, stat: sourceStat, directory: false })
      return rootCall ? { sourceSnapshot, createdTargets } : true
    }

    try {
      await mkdir(target, { mode: sourceStat.mode & 0o777 })
    } catch (error) {
      if (error?.code === 'EEXIST' && allowCollision) return false
      if (error?.code === 'EEXIST') throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
      throw error
    }
    const targetStat = await lstat(target)
    createdTargets.push({ path: target, stat: targetStat, directory: true })
    const before = await readdir(source, { withFileTypes: true })
    const fingerprint = directoryFingerprint(before)
    for (const dirent of before) {
      if (dirent.isSymbolicLink()) {
        if (skipSymlinks) continue
        throw new HttpError(403, 'symlink-write-denied', '目录包含符号链接，不能安全移动或重命名')
      }
      await copyTreeExclusive(
        resolve(source, dirent.name),
        resolve(target, dirent.name),
        undefined,
        false,
        skipSymlinks,
        sourceSnapshot,
        createdTargets,
      )
    }
    const after = await readdir(source, { withFileTypes: true })
    if (fingerprint !== directoryFingerprint(after)) {
      throw new HttpError(409, 'file-conflict', '源目录在复制期间发生变化，请刷新后重试')
    }
    assertEntrySnapshot(sourceStat, await lstat(source))
    await chmod(target, sourceStat.mode & 0o777)
    await utimes(target, sourceStat.atime, sourceStat.mtime)
    sourceSnapshot.push({ path: source, stat: sourceStat, directory: true, fingerprint })
    return rootCall ? { sourceSnapshot, createdTargets } : true
  } catch (error) {
    if (rootCall && createdTargets.length > 0) await cleanupCreatedTargets(createdTargets, error)
    throw error
  }
}

async function verifyTreeSnapshot(sourceSnapshot) {
  for (const entry of sourceSnapshot) {
    let current
    try {
      current = await lstat(entry.path)
      assertEntrySnapshot(entry.stat, current)
      if (entry.directory) {
        const children = await readdir(entry.path, { withFileTypes: true })
        if (directoryFingerprint(children) !== entry.fingerprint) {
          throw new HttpError(409, 'file-conflict', '源目录内容在文件操作期间发生变化，请刷新后重试')
        }
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(409, 'file-conflict', '源条目在文件操作期间发生变化，请刷新后重试')
    }
  }
}

/** Recheck the complete copied source tree immediately before removal. */
async function removeEntryTreeChecked(target, expectedStat, sourceSnapshot) {
  if (sourceSnapshot !== undefined) await verifyTreeSnapshot(sourceSnapshot)
  const current = await lstat(target)
  assertEntrySnapshot(expectedStat, current)
  if (current.isDirectory()) await rm(target, { recursive: true })
  else await unlink(target)
}

/** Append a numeric suffix before the extension (a.txt -> a-1.txt); dotfiles
 * and extension-less names get the suffix at the end (.gitignore-1, dir-1). */
function dedupeName(name, index) {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return `${name.slice(0, dot)}-${index}${name.slice(dot)}`
  return `${name}-${index}`
}

/**
 * Copy or move (cut+paste) one workspace-confined entry. Both operations use
 * exclusive copy primitives; move is intentionally copy-then-delete rather
 * than ordinary rename, because POSIX rename replaces an existing target.
 * Destination allocation and all canonical checks run under the workspace lock.
 */
async function copyEntry(workspace, sourcePath, targetPath, config, queues, cut) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (sourcePath === '') throw new HttpError(400, 'invalid-path', '不能复制工作区根目录')
  if (targetPath === '') throw new HttpError(400, 'invalid-path', '目标不能是工作区根目录')
  return serializeWorkspaceMutation(queues, workspace, async () => {
    if (targetPath.startsWith(`${sourcePath}/`)) {
      throw new HttpError(400, 'invalid-target', '不能复制到自身或其子目录')
    }
    if (cut && targetPath === sourcePath) {
      throw new HttpError(400, 'invalid-target', '不能移动到自身')
    }
    const root = await realpath(workspace.path)
    const source = await resolveWorkspacePath(root, sourcePath)
    if (await hasSymlinkComponent(root, sourcePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝复制符号链接路径')
    const sourceStat = await lstat(source)
    if (!sourceStat.isDirectory() && !sourceStat.isFile()) throw new HttpError(400, 'invalid-entry-kind', '只能复制文件或文件夹')
    const targetParentPath = parentPath(targetPath)
    const targetParent = await resolveWorkspacePath(root, targetParentPath)
    if (await hasSymlinkComponent(root, targetParentPath)) {
      throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接复制文件')
    }
    const targetParentStat = await lstat(targetParent)
    if (!targetParentStat.isDirectory()) throw new HttpError(400, 'not-a-directory', '目标位置不是目录')
    if (sourceStat.isDirectory() && isInside(source, targetParent)) {
      throw new HttpError(400, 'invalid-target', '不能复制到自身或其子目录')
    }
    const targetName = targetPath.slice(targetPath.lastIndexOf('/') + 1)
    const target = resolve(targetParent, targetName)
    if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')

    let chosen
    let chosenPath
    let chosenName
    let chosenSnapshot
    let chosenCreatedTargets
    for (let index = 0; index <= 10000; index += 1) {
      const candidateName = index === 0 ? targetName : dedupeName(targetName, index)
      const candidate = resolve(targetParent, candidateName)
      const copied = await copyTreeExclusive(source, candidate, sourceStat, true, !cut)
      if (copied === false) continue
      try {
        await verifyTreeSnapshot(copied.sourceSnapshot)
        const settledTarget = await realpath(candidate)
        const candidatePath = entryPath(targetParentPath, candidateName)
        if (!isInside(root, settledTarget) || await hasSymlinkComponent(root, candidatePath)) {
          throw new HttpError(403, 'symlink-write-denied', '目标路径在复制期间发生变化，源条目未删除')
        }
      } catch (error) {
        await cleanupCreatedTargets(copied.createdTargets, error)
      }
      chosen = candidate
      chosenName = candidateName
      chosenPath = entryPath(targetParentPath, candidateName)
      chosenSnapshot = copied.sourceSnapshot
      chosenCreatedTargets = copied.createdTargets
      break
    }
    if (chosen === undefined) throw new HttpError(409, 'entry-exists', '同名条目过多，无法自动命名')
    try {
      const settledTarget = await realpath(chosen)
      if (!isInside(root, settledTarget) || await hasSymlinkComponent(root, chosenPath)) {
        throw new HttpError(403, 'symlink-write-denied', '目标路径在复制期间发生变化，源条目未删除')
      }
    } catch (error) {
      await cleanupCreatedTargets(chosenCreatedTargets, error)
    }

    if (cut) {
      try {
        await removeEntryTreeChecked(source, sourceStat, chosenSnapshot)
      } catch (error) {
        // Keep the completed destination as a recoverable copy. Removing it
        // here could destroy the only intact copy if source deletion partially
        // succeeded or an external process changed the tree.
        throw new HttpError(409, 'file-conflict', '源条目删除失败，完整目标副本已保留，请人工确认源和目标')
      }
    }
    return {
      workspaceId: String(workspace.id),
      fromPath: sourcePath,
      path: chosenPath,
      name: chosenName,
      kind: sourceStat.isDirectory() ? 'directory' : 'file',
      symlink: false,
      cut,
    }
  })
}

/** Delete one workspace-confined file or directory tree (root excluded). */
async function deleteEntry(workspace, relativePath, config, queues) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (relativePath === '') throw new HttpError(400, 'invalid-path', '不能删除工作区根目录')
  return serializeWorkspaceMutation(queues, workspace, async () => {
    const root = await realpath(workspace.path)
    const source = await resolveWorkspacePath(root, relativePath)
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝删除符号链接路径')
    const sourceStat = await lstat(source)
    if (!sourceStat.isDirectory() && !sourceStat.isFile()) throw new HttpError(400, 'invalid-entry-kind', '只能删除文件或文件夹')
    const current = await realpath(source)
    if (!isInside(root, current)) throw new HttpError(403, 'path-outside-workspace', '拒绝删除工作区之外的路径')
    await removeEntryTreeChecked(source, sourceStat)
    return { workspaceId: String(workspace.id), path: relativePath, kind: sourceStat.isDirectory() ? 'directory' : 'file' }
  })
}

/** Dispatch the copy/move/delete file operations from the /fs endpoint. */
async function fsOperation(workspace, config, queues, req) {
  const payload = await readJsonObject(req, config)
  const action = payload.action
  if (action !== 'copy' && action !== 'move' && action !== 'delete') {
    throw new HttpError(400, 'invalid-action', '只能执行复制、移动或删除操作')
  }
  if (action === 'delete') {
    const path = typeof payload.path === 'string'
      ? normalizeRelativePath(payload.path)
      : (() => { throw new HttpError(400, 'invalid-path', '删除目标路径无效') })()
    return deleteEntry(workspace, path, config, queues)
  }
  const source = typeof payload.source === 'string'
    ? normalizeRelativePath(payload.source)
    : (() => { throw new HttpError(400, 'invalid-path', '源路径无效') })()
  const target = typeof payload.target === 'string'
    ? normalizeRelativePath(payload.target)
    : (() => { throw new HttpError(400, 'invalid-path', '目标路径无效') })()
  return copyEntry(workspace, source, target, config, queues, action === 'move')
}

/* ---- Draft (staging) file persistence ----
 *
 * While a workspace file is being edited, the temporary edits live in a draft
 * file OUTSIDE the workspace, under the plugin's own long-lived directory
 * (~/.dsh-plugin/dsh-workspace-studio/drafts/<workspaceId>/). The
 * source file is never touched until the user explicitly saves; refreshing the
 * page re-reads the draft. The draft JSON carries the current edit plus the
 * snapshot (base text + base revision) taken when editing began, so restore
 * and the save-time three-way merge need no other storage.
 */

const DRAFT_DIR_NAME = 'dsh-workspace-studio'
const DRAFT_SUB_DIR = 'drafts'

function draftRoot() {
  return join(homedir(), '.dsh-plugin', DRAFT_DIR_NAME, DRAFT_SUB_DIR)
}

/** Stable file name for one workspace-relative path (path-hash based, so no
 *  traversal or illegal characters can leak into the filesystem). */
function draftFileName(relativePath) {
  return `${createHash('sha256').update(relativePath).digest('hex')}.json`
}

function draftWorkspacePart(workspaceId) {
  const value = String(workspaceId)
  // Existing workspace ids are UUIDs. Hash unusual ids rather than allowing a
  // future registry implementation to turn the draft root into a path join.
  return /^[A-Za-z0-9._-]+$/u.test(value)
    ? value
    : createHash('sha256').update(value).digest('hex')
}

function validateDraftOwner(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 256 || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-draft', '暂存 owner 无效')
  }
  return value
}

function draftOwnerPart(owner) {
  return `owner-${createHash('sha256').update(owner).digest('hex')}`
}

function draftWorkspaceDir(workspaceId) {
  return join(draftRoot(), draftWorkspacePart(workspaceId))
}

function draftOwnerDir(workspaceId, owner) {
  return owner === undefined ? draftWorkspaceDir(workspaceId) : join(draftWorkspaceDir(workspaceId), draftOwnerPart(owner))
}

function draftFilePath(workspaceId, relativePath, owner) {
  return join(draftOwnerDir(workspaceId, owner), draftFileName(relativePath))
}

function draftGenerationPath(workspaceId, owner) {
  return join(draftOwnerDir(workspaceId, owner), '.generation.json')
}

async function readJsonFileOrNull(target) {
  let raw
  try {
    raw = await readFile(target, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
  try {
    const value = JSON.parse(raw)
    return isPlainObject(value) ? value : null
  } catch {
    // A corrupt draft is treated as absent so the editor never surfaces a
    // half-written file; the next auto-save recreates it.
    return null
  }
}

async function readOwnerGenerationState(workspaceId, owner) {
  if (owner === undefined) return { generation: -1, operation: undefined }
  const value = await readJsonFileOrNull(draftGenerationPath(workspaceId, owner))
  return {
    generation: Number.isSafeInteger(value?.generation) && value.generation >= 0 ? value.generation : -1,
    operation: typeof value?.operation === 'string' ? value.operation : undefined,
  }
}

async function readOwnerGeneration(workspaceId, owner) {
  return (await readOwnerGenerationState(workspaceId, owner)).generation
}

async function readDraftAtPath(workspaceId, relativePath, owner) {
  const value = await readJsonFileOrNull(draftFilePath(workspaceId, relativePath, owner))
  if (value === null || value.path !== relativePath) return null
  if (owner !== undefined && value.owner !== undefined && value.owner !== owner) return null
  return value
}

async function readDraftFile(workspaceId, relativePath, owner) {
  const owned = await readDraftAtPath(workspaceId, relativePath, owner)
  if (owner === undefined) {
    if (owned === null || owned.deleted === true) return null
    return { ...owned, exists: true }
  }
  const ownerGeneration = await readOwnerGeneration(workspaceId, owner)
  if (owned !== null) {
    if (owned.deleted === true) {
      return { exists: false, owner, generation: owned.generation ?? ownerGeneration, ownerGeneration }
    }
    return { ...owned, exists: true, owner, generation: owned.generation ?? ownerGeneration, ownerGeneration }
  }
  // New owner-aware clients can restore drafts written by older clients. The
  // legacy file is never deleted implicitly, so an old client remains able to
  // see it while the new client has an isolated copy after its first PUT.
  const legacy = await readDraftAtPath(workspaceId, relativePath, undefined)
  if (legacy !== null && legacy.deleted !== true) {
    return { ...legacy, exists: true, legacy: true, owner, generation: ownerGeneration, ownerGeneration }
  }
  return { exists: false, owner, generation: ownerGeneration, ownerGeneration }
}

function parseDraftGeneration(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, 'invalid-draft', '暂存请求必须提供 generation')
    return undefined
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, 'invalid-draft', 'generation 无效')
  }
  return value
}

function parseDraftGenerationQuery(value) {
  if (value === null) return undefined
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new HttpError(400, 'invalid-draft', 'generation 无效')
  return parseDraftGeneration(Number(value))
}

function validateDraftPayload(payload, config, queryPath, queryOwner, queryGeneration) {
  if (!isPlainObject(payload)) throw new HttpError(400, 'invalid-draft', '暂存请求必须是 JSON 对象')
  const relativePath = normalizeRelativePath(payload.path ?? '')
  if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存必须指定文件路径')
  if (queryPath !== undefined && queryPath !== '' && relativePath !== queryPath) {
    throw new HttpError(400, 'invalid-draft', '查询路径与暂存 payload 路径不一致')
  }
  const payloadOwner = validateDraftOwner(payload.owner ?? payload.sessionId)
  if (queryOwner !== undefined && payloadOwner !== undefined && queryOwner !== payloadOwner) {
    throw new HttpError(400, 'invalid-draft', '查询 owner 与暂存 payload owner 不一致')
  }
  const owner = queryOwner ?? payloadOwner
  const payloadGeneration = parseDraftGeneration(payload.generation)
  if (queryGeneration !== undefined && payloadGeneration !== undefined && queryGeneration !== payloadGeneration) {
    throw new HttpError(400, 'invalid-draft', '查询 generation 与暂存 payload generation 不一致')
  }
  const generation = payloadGeneration ?? queryGeneration
  if (owner !== undefined && generation === undefined) {
    throw new HttpError(400, 'invalid-draft', 'owner 暂存写入必须提供 generation')
  }
  const text = (value, name) => {
    if (typeof value !== 'string' || value.includes('\0')) throw new HttpError(400, 'invalid-draft', `${name} 无效`)
    if (Buffer.byteLength(value, 'utf8') > config.maxEditableBytes) {
      throw new HttpError(413, 'draft-too-large', `${name} 超过可编辑大小限制`)
    }
    return value
  }
  const draft = text(payload.draft, 'draft')
  const baseText = text(payload.baseText, 'baseText')
  const baseRevision = payload.baseRevision === undefined || payload.baseRevision === null
    ? null
    : typeof payload.baseRevision === 'string' && /^[a-f0-9]{64}$/.test(payload.baseRevision)
      ? payload.baseRevision
      : (() => { throw new HttpError(400, 'invalid-draft', 'baseRevision 无效') })()
  const encoding = payload.encoding === undefined || payload.encoding === null
    ? 'utf-8'
    : encodingById(String(payload.encoding)).id
  return {
    path: relativePath,
    encoding,
    lineEnding: typeof payload.lineEnding === 'string' ? payload.lineEnding : 'none',
    bom: Boolean(payload.bom),
    baseText,
    baseRevision,
    draft,
    ...(owner === undefined ? {} : { owner }),
    ...(generation === undefined ? {} : { generation }),
  }
}

function draftQueueKey(workspaceId, owner) {
  return owner === undefined
    ? `draft-legacy:${String(workspaceId)}`
    : `draft-owner:${String(workspaceId)}:${draftOwnerPart(owner)}`
}

async function writeJsonAtomic(target, value) {
  await mkdir(dirname(target), { recursive: true })
  const temp = join(dirname(target), `.${randomBytes(16).toString('hex')}.tmp`)
  try {
    await writeFile(temp, `${JSON.stringify(value)}\n`, 'utf8')
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/* ---- Mind-map document (导图) ----
 *
 * A mind map is a persisted, self-contained document keyed by its ROOT session
 * and stored under ~/.dsh-plugin/dsh-workspace-studio/mindmap/. It is
 * the single source of truth for the "导图" conversation view: the trunk (the
 * root session's turns, reverse-parsed from its FULL event log — not the
 * windowed snapshot) plus every fork branch the user cut at a card. Each turn
 * carries a doc-wide display number `n` (so a branch's own turns keep counting
 * after the trunk, e.g. 1-2-3-4-5 with a branch 6-7 off card 3), the actual
 * session turn number `t`, and the turn/end `seq` used as the fork boundary.
 * Branches record their fork boundary (parent session + turn/end seq); the
 * Host re-parses each branch session's full log during sync so new turns are
 * folded in regardless of the client's conversation window.
 */

const MINDMAP_SUB_DIR = 'mindmap'
const MINDMAP_DOC_VERSION = 2
/* Mind-map docs carry every turn's question text (answers are not persisted),
   so they routinely exceed the generic 4 KiB mutation cap; give them a
   dedicated 2 MiB bound. */
const MINDMAP_DOC_MAX_BYTES = 2 * 1024 * 1024
/* In-memory sync cache: keyed by the ROOT session id. The client's periodic
   sync poll (every 2.5 s while a map is open) would otherwise re-read and
   re-parse every family log and re-scan the whole session index on each tick.
   A cheap signature detects "nothing changed" and serves the cached doc
   instead. Every doc mutation path (write, delete, purge) invalidates the
   entry, and the TTL forces a periodic full sync so an in-place log edit that
   the signature cannot see is never missed forever. */
const MINDMAP_SYNC_CACHE_TTL_MS = 30_000
const mindmapSyncCache = new Map() // rootId -> { sig, doc, live, at, refs }

function mindmapRoot() {
  return join(homedir(), '.dsh-plugin', DRAFT_DIR_NAME, MINDMAP_SUB_DIR)
}

function mindmapDocPath(sessionId) {
  return join(mindmapRoot(), `${draftWorkspacePart(sessionId)}.json`)
}

function isValidMindmapDoc(value) {
  return isPlainObject(value)
    && value.version === MINDMAP_DOC_VERSION
    && typeof value.rootSessionId === 'string'
    && Array.isArray(value.trunk)
    && Array.isArray(value.branches)
}

/* Every text block of a content list (reasoning skipped), joined with line
   breaks — the user question may carry multiple text blocks. */
function mindmapQuestionOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block === null || block === undefined) continue
    if (block.kind === 'reasoning') continue
    if (typeof block.text === 'string' && block.text.trim() !== '') parts.push(block.text.trim())
  }
  return parts.join('\n')
}

/* Reverse-parse the FULL event log into completed turns. Each completed turn
   is { t (actual session turn number), seq (turn/end seq), user }. The user
   prompt is the turn's direct human user/message (source.kind === 'user');
   the answer text is deliberately NOT stored (the cards only ever show the
   question, so persisting every answer would double the doc size for nothing).
   Compaction replacement copies (surfaceOp != append) are skipped so the human
   transcript (not the model-only surface) is shown. */
function parseMindmapTurns(events) {
  const turns = []
  if (!Array.isArray(events)) return turns
  let current = null
  for (const event of events) {
    if (event === null || event === undefined) continue
    if (event.type === 'turn/start') {
      current = { t: Number(event.data?.turn), seq: undefined, user: '' }
    } else if (event.type === 'user/message') {
      if (current === null || current.t === undefined) continue
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
      if (event.data?.source?.kind !== 'user') continue
      const text = mindmapQuestionOf(event.data?.content)
      if (text !== '') current.user = current.user === '' ? text : `${current.user}\n${text}`
    } else if (event.type === 'turn/end') {
      if (current !== null && current.t === Number(event.data?.turn)) {
        current.seq = Number(event.seq)
        if (Number.isSafeInteger(current.t) && current.t > 0
          && Number.isSafeInteger(current.seq) && current.seq >= 0) {
          turns.push(current)
        }
      }
      current = null
    }
  }
  return turns
}

/* The LAST in-flight (unended) turn of a session's full log: the live card
   the mind map shows while the assistant is generating. Mirrors
   parseMindmapTurns' filtering (append-only surface ops, human source).
   Returns { turn, question } or null when no turn is open. */
function mindmapLiveTurnOf(events) {
  if (!Array.isArray(events)) return null
  let current = null
  for (const event of events) {
    if (event === null || event === undefined) continue
    if (event.type === 'turn/start') {
      current = { t: Number(event.data?.turn), question: '' }
    } else if (event.type === 'user/message') {
      if (current === null || current.t === undefined) continue
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
      if (event.data?.source?.kind !== 'user') continue
      const text = mindmapQuestionOf(event.data?.content)
      if (text !== '') current.question = current.question === '' ? text : `${current.question}\n${text}`
    } else if (event.type === 'turn/end') {
      current = null
    }
  }
  return current !== null && Number.isSafeInteger(current.t) && current.t > 0
    ? { turn: current.t, question: current.question }
    : null
}

/* Merge freshly parsed turns into a persisted turn list. Existing turns are
   matched by their owner-session turn/end seq (append-only, so stable) and
   keep their display number; new turns are appended with fresh display numbers
   from the doc-wide counter. Returns { turns, next }. */
function reconcileMindmapTurns(parsed, existing, next) {
  const bySeq = new Map()
  for (const turn of existing ?? []) {
    if (turn !== null && turn !== undefined && Number.isSafeInteger(turn.seq)) bySeq.set(turn.seq, turn)
  }
  const out = []
  let counter = next
  for (const p of parsed) {
    const old = bySeq.get(p.seq)
    if (old !== undefined) {
      out.push({ n: old.n, t: p.t, seq: p.seq, user: p.user })
    } else {
      out.push({ n: counter, t: p.t, seq: p.seq, user: p.user })
      counter += 1
    }
  }
  return { turns: out, next: counter }
}

function mindmapNextOf(doc) {
  let max = 0
  for (const turn of doc.trunk ?? []) {
    if (Number.isSafeInteger(turn?.n) && turn.n > max) max = turn.n
  }
  for (const branch of doc.branches ?? []) {
    for (const turn of branch?.turns ?? []) {
      if (Number.isSafeInteger(turn?.n) && turn.n > max) max = turn.n
    }
  }
  return max + 1
}

/* Latest durable title of a session: the last session/title event in its full
   log (the client's displayTitle is derived from the same events). */
async function mindmapTitleOf(ctx, persistence, sessionId) {
  const events = await eventsOf(ctx, persistence, sessionId)
  if (Array.isArray(events)) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title !== '') {
        return event.data.title
      }
    }
  }
  return undefined
}

/* Full event log of one session: resident instances are free; anything else
 * falls back to the persistence backend, which may be absent or fail. */
async function eventsOf(ctx, persistence, sessionId) {
  const live = ctx.sessions.get(sessionId)
  if (live !== undefined) {
    return Array.isArray(live.events) ? live.events : null
  }
  if (persistence === undefined) return null
  try {
    const inspected = await persistence.inspect(sessionId)
    return Array.isArray(inspected?.events) ? inspected.events : null
  } catch {
    return null
  }
}

/* Build a fresh doc for a session that has never been converted: split its
   full log into trunk turns (display numbers 1..N) with no branches yet. Null
   when the session has no completed turn (nothing to split). */
async function buildMindmapDoc(ctx, persistence, sessionId) {
  /* An archived session must never be converted into a (re)built doc: the map
     was archived away, and the log-based rebuild would resurrect it. */
  if (mindmapArchivedSet(ctx).has(String(sessionId))) return null
  const events = await eventsOf(ctx, persistence, sessionId)
  const turns = parseMindmapTurns(events)
  if (turns.length === 0) return null
  const trunk = turns.map((turn, index) => ({ ...turn, n: index + 1 }))
  const doc = {
    version: MINDMAP_DOC_VERSION,
    rootSessionId: String(sessionId),
    rootTitle: (await mindmapTitleOf(ctx, persistence, sessionId)) ?? '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    next: trunk.length + 1,
    trunk,
    branches: [],
    deleted: [],
  }
  try {
    await writeJsonAtomic(mindmapDocPath(doc.rootSessionId), doc)
  } catch (error) {
    ctx.logger.warn(`[workspace-studio] mindmap doc build write failed: ${String(error)}`)
  }
  return doc
}

/* A doc path may hold either a full document or an alias stub left by a root
   replacement (card-deletion truncation): { version, aliasTo } pointing at the
   new root's doc file. One alias hop is followed so a stale open of the
   archived root resolves to the current document instead of building a fresh
   one (which would split the family into a second mind map). */
async function readMindmapDocFile(sessionId) {
  /* Follow alias stubs (root-replacement markers) through MULTIPLE hops: a
     second root replacement leaves the oldest root's stub pointing at an
     intermediate root whose file is now itself a stub. Each hop is cycle-
     guarded so a corrupt stub loop cannot hang the resolver. */
  let cursor = String(sessionId)
  const seen = new Set()
  while (!seen.has(cursor)) {
    seen.add(cursor)
    const value = await readJsonFileOrNull(mindmapDocPath(cursor))
    if (value === null) return null
    if (isValidMindmapDoc(value)) return value
    if (isPlainObject(value) && typeof value.aliasTo === 'string' && value.aliasTo !== cursor) {
      cursor = value.aliasTo
      continue
    }
    return null
  }
  return null
}

/* The registry's archived set, guarded (a host without the registry treats
   nothing as archived). */
function mindmapArchivedSet(ctx) {
  try {
    const archived = ctx.workspaceRegistry?.archivedSessionIds
    return Array.isArray(archived) ? new Set(archived.map(String)) : new Set()
  } catch {
    return new Set()
  }
}

/* A mind map whose ROOT session is archived is dead: whichever UI archived the
   family (the map toolbar, the sidebar, or the harness's own archive), the doc
   must stop existing — otherwise reopening the map would resurrect every
   archived branch from the document. */
function mindmapDocIsDead(ctx, doc) {
  if (doc === null || doc === undefined) return false
  return mindmapArchivedSet(ctx).has(String(doc.rootSessionId))
}

/* Delete every doc file whose root session is archived, plus dangling alias
   stubs (a root-replacement stub whose target doc no longer exists). Self-
   healing garbage collection: any archive path is swept by the next index poll
   or doc access, so an archived map can never be reopened or listed again. */
async function purgeArchivedMindmapDocs(ctx) {
  const names = await mindmapDocFileNames()
  let purged = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(mindmapRoot(), name)
    const doc = await readJsonFileOrNull(path)
    if (doc === null) continue
    if (isValidMindmapDoc(doc)) {
      if (mindmapDocIsDead(ctx, doc)) {
        try { await unlink(path); purged += 1 } catch { /* best effort */ }
        mindmapSyncCache.delete(String(doc.rootSessionId))
      }
      continue
    }
    if (isPlainObject(doc) && typeof doc.aliasTo === 'string') {
      const target = await readJsonFileOrNull(mindmapDocPath(doc.aliasTo))
      if (target === null || !isValidMindmapDoc(target)) {
        try { await unlink(path); purged += 1 } catch { /* best effort */ }
      }
    }
  }
  return purged
}

/* Resolve the EXISTING doc a session belongs to: the session itself may be a
 * root or a documented branch of another root (a flat scan — cheap, docs are
 * few). Returns null when no doc exists yet (the caller decides whether to
 * build one). */
async function findMindmapDoc(ctx, persistence, sessionId) {
  const direct = await readMindmapDocFile(sessionId)
  if (direct !== null) return mindmapDocIsDead(ctx, direct) ? null : direct
  return findMindmapDocByBranch(ctx, sessionId)
}

async function mindmapDocFileNames() {
  try {
    return await readdir(mindmapRoot())
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
}

async function findMindmapDocByBranch(ctx, sessionId) {
  const names = await mindmapDocFileNames()
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const doc = await readJsonFileOrNull(join(mindmapRoot(), name))
    if (!isValidMindmapDoc(doc)) continue
    if (String(doc.rootSessionId) === String(sessionId)) continue
    if ((doc.branches ?? []).some(branch => String(branch.sessionId) === String(sessionId))) {
      return mindmapDocIsDead(ctx, doc) ? null : doc
    }
  }
  return null
}

/* Parent session of one session from the durable header (live first, then the
   persistence index). Returns undefined when unknown. */
async function mindmapParentOf(ctx, persistence, sessionId) {
  const live = ctx.sessions.get(sessionId)
  if (live?.header?.parentSession !== undefined) return String(live.header.parentSession)
  if (persistence !== undefined) {
    try {
      const headers = await persistence.list()
      for (const header of headers) {
        if (header === null || header === undefined) continue
        if (String(header.id) === String(sessionId) && header.parentSession !== undefined) {
          return String(header.parentSession)
        }
      }
    } catch {
      /* fall through: no persistence index to answer */
    }
  }
  return undefined
}

/* Resolve the doc a session belongs to, walking UP the fork lineage when the
   session itself is not in any doc: a fork descendant whose branch was not
   recorded (a fork whose doc write raced, or an externally forked child) must
   land in its ancestor's document instead of being split off as a brand-new
   root. Returns null only when NO ancestor has a doc (the caller builds). */
async function findMindmapDocWithAncestors(ctx, persistence, sessionId) {
  let cursor = String(sessionId)
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    const direct = await readMindmapDocFile(cursor)
    if (direct !== null) return mindmapDocIsDead(ctx, direct) ? null : direct
    const branchDoc = await findMindmapDocByBranch(ctx, cursor)
    if (branchDoc !== null) return branchDoc
    cursor = await mindmapParentOf(ctx, persistence, cursor)
  }
  return null
}

/* Key of one turn's tombstone (a card the user deleted): the owner session
   and its turn/end seq. Seq is stable per log and survives fork copies, so a
   tombstone stays matchable everywhere the turn could resurface. */
function mindmapTurnKey(sessionId, seq) {
  return `${String(sessionId)}:${String(seq)}`
}

/* The doc's tombstone key set (field `deleted`, added by the client's card
   deletion; optional so legacy docs read as empty). */
function mindmapDeletedKeys(doc) {
  const keys = new Set()
  for (const entry of doc?.deleted ?? []) {
    if (entry === null || entry === undefined) continue
    if (typeof entry.sessionId === 'string' && Number.isSafeInteger(entry.seq)) {
      keys.add(mindmapTurnKey(entry.sessionId, entry.seq))
    }
  }
  return keys
}

/* Reconcile a doc against the CURRENT full logs: re-parse the root's log into
   trunk turns and every branch session's log into its own turns (those after
   its fork turn), keeping display numbers stable. Sessions whose log is
   currently unavailable keep their recorded turns. Mutates the doc (doc.next
   updated) and returns it. */
async function reconcileMindmapDoc(ctx, persistence, doc) {
  let next = Number.isSafeInteger(doc.next) && doc.next > 0 ? doc.next : mindmapNextOf(doc)
  /* Tombstoned turns (deleted cards) never resurface, however the logs shift:
     a re-parse, a fork of the region, or an orphan adoption. */
  const deleted = mindmapDeletedKeys(doc)
  const rootEvents = await eventsOf(ctx, persistence, doc.rootSessionId)
  if (Array.isArray(rootEvents)) {
    const parsed = parseMindmapTurns(rootEvents)
      .filter(turn => !deleted.has(mindmapTurnKey(String(doc.rootSessionId), turn?.seq)))
    const result = reconcileMindmapTurns(parsed, doc.trunk, next)
    doc.trunk = result.turns
    next = result.next
  }
  /* Branches whose session was archived by ANY path (the map toolbar, the
     sidebar, or the harness's own archive) are dead: drop them so the map
     self-heals on the next sync instead of resurrecting archived branches. */
  const archived = mindmapArchivedSet(ctx)
  if (archived.size > 0 && (doc.branches ?? []).some(b => b !== null && b !== undefined && archived.has(String(b?.sessionId)))) {
    doc.branches = (doc.branches ?? []).filter(b => b === null || b === undefined || !archived.has(String(b?.sessionId)))
  }
  for (const branch of doc.branches ?? []) {
    if (branch === null || branch === undefined || typeof branch.sessionId !== 'string') continue
    const branchEvents = await eventsOf(ctx, persistence, branch.sessionId)
    if (!Array.isArray(branchEvents)) continue
    const forkTurn = Number(branch.forkTurn)
    const parsedAll = parseMindmapTurns(branchEvents)
    const ownParsed = (Number.isSafeInteger(forkTurn)
      ? parsedAll.filter(turn => turn.t > forkTurn)
      : parsedAll)
      .filter(turn => !deleted.has(mindmapTurnKey(String(branch.sessionId), turn?.seq)))
    const result = reconcileMindmapTurns(ownParsed, branch.turns, next)
    branch.turns = result.turns
    next = result.next
  }
  doc.next = next
  return doc
}

/* One merged view of every session's lineage facts (parent id, fork seed
   length, subagent marker) from the live store and the persistence index;
   live entries win, persisted entries fill the gaps. */
async function mindmapSessionIndex(ctx, persistence) {
  const byId = new Map()
  const merge = (sessionId, fields) => {
    if (sessionId === undefined || sessionId === null || sessionId === '') return
    const key = String(sessionId)
    const existing = byId.get(key)
    if (existing === undefined) {
      byId.set(key, {
        parent: fields.parent,
        seedLength: fields.seedLength,
        subagent: Boolean(fields.subagent),
      })
      return
    }
    if (existing.parent === undefined && fields.parent !== undefined) existing.parent = fields.parent
    if (existing.seedLength === undefined && fields.seedLength !== undefined) existing.seedLength = fields.seedLength
    if (fields.subagent === true) existing.subagent = true
  }
  try {
    for (const session of ctx.sessions.list()) {
      if (session === null || session === undefined) continue
      const header = session.header
      merge(session.id ?? header?.id, {
        parent: header?.parentSession,
        seedLength: header?.seedLength,
        subagent: header?.origin === 'subagent',
      })
    }
  } catch {
    /* live list unavailable: the persistence index below is the fallback */
  }
  if (persistence !== undefined) {
    try {
      const headers = await persistence.list()
      for (const header of headers) {
        if (header === null || header === undefined) continue
        merge(header.id, {
          parent: header.parentSession,
          seedLength: header.seedLength,
          subagent: header.origin === 'subagent',
        })
      }
    } catch {
      /* fall through: no persistence index to answer */
    }
  }
  return byId
}

/* The documented chain that OWNS a fork boundary turn: walking UP from the
   fork's parent, the first session whose forkTurn is below the boundary turn
   number owns it — a branch's own turns start at forkTurn + 1, every turn it
   inherited has t <= forkTurn, and the root (forkTurn 0) owns the rest.
   Returns { owner, forkTurn } or undefined on a malformed doc lineage. */
function mindmapBoundaryOwner(doc, parentSessionId, t) {
  const branchBySession = new Map()
  for (const branch of doc.branches ?? []) {
    if (branch !== null && branch !== undefined && typeof branch?.sessionId === 'string') {
      branchBySession.set(String(branch.sessionId), branch)
    }
  }
  let cursor = String(parentSessionId)
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    const forkTurn = cursor === String(doc.rootSessionId)
      ? 0
      : Number(branchBySession.get(cursor)?.forkTurn)
    if (Number.isSafeInteger(forkTurn) && forkTurn < t) return { owner: cursor, forkTurn }
    const branch = branchBySession.get(cursor)
    cursor = branch?.parentSessionId
  }
  return undefined
}

/* One adoption pass: adopt fork children whose IMMEDIATE parent is already
   documented into the doc as branches. The harness records the fork cut in
   the child's seedLength (the number of inherited events), so the boundary
   turn — the last turn/end below that cut — is exact even for mid-log forks
   and children that already chatted. Without seedLength (a child created
   outside the fork API) the last completed turn is used, which is the true
   boundary while the child has not chatted yet. Subagent sessions and
   archived sessions are never adopted. Returns the number adopted. */
async function adoptMindmapOrphanPass(ctx, persistence, doc) {
  const known = new Set([String(doc.rootSessionId)])
  for (const branch of doc.branches ?? []) {
    if (branch !== null && branch !== undefined && typeof branch?.sessionId === 'string') {
      known.add(String(branch.sessionId))
    }
  }
  const deleted = mindmapDeletedKeys(doc)
  /* Branch-level tombstones: empty branches pruned by a card deletion have no
     turn tombstones, so their session ids are listed here and never adopted
     back, whatever the archive outcome. */
  const prunedBranches = new Set()
  for (const id of doc?.deletedBranches ?? []) {
    if (typeof id === 'string' && id !== '') prunedBranches.add(id)
  }
  const index = await mindmapSessionIndex(ctx, persistence)
  let archived = new Set()
  try {
    archived = new Set((ctx.workspaceRegistry?.archivedSessionIds ?? []).map(String))
  } catch {
    /* registry unavailable: no archived set to exclude */
  }
  let adopted = 0
  for (const [sessionId, info] of index) {
    if (known.has(sessionId) || info.subagent) continue
    if (archived.has(sessionId) || prunedBranches.has(sessionId)) continue
    const parent = info.parent
    if (parent === undefined || !known.has(String(parent))) continue
    const events = await eventsOf(ctx, persistence, sessionId)
    if (!Array.isArray(events)) continue
    const parsed = parseMindmapTurns(events)
    if (parsed.length === 0) continue
    const seedLength = info.seedLength
    let boundary = undefined
    if (Number.isSafeInteger(seedLength) && seedLength > 0) {
      for (let i = parsed.length - 1; i >= 0; i -= 1) {
        if (Number(parsed[i].seq) < seedLength) { boundary = parsed[i]; break }
      }
    } else {
      /* No seed cut recorded (a child created outside the fork API): the last
         completed turn is the boundary ONLY while the child's log is still
         exactly the inherited seed — verified against the parent's turns, so
         a child that already chatted is skipped instead of being attached at
         the wrong card. */
      const parentEvents = await eventsOf(ctx, persistence, String(parent))
      if (Array.isArray(parentEvents)) {
        const parentParsed = parseMindmapTurns(parentEvents)
        if (parsed.length <= parentParsed.length
          && parsed.every((turn, index) => {
            const other = parentParsed[index]
            return other !== undefined
              && Number(other.t) === Number(turn.t)
              && Number(other.seq) === Number(turn.seq)
              && String(other.user ?? '') === String(turn.user ?? '')
          })) {
          boundary = parsed[parsed.length - 1]
        }
      }
    }
    if (boundary === undefined) continue
    const owned = mindmapBoundaryOwner(doc, String(parent), Number(boundary.t))
    if (owned === undefined) continue
    /* An orphan forked AT a deleted card is not adopted: the card no longer
       exists in the doc, and adoption would re-attach the child at a wrong
       (earlier) boundary card. Its own turns are tombstoned by the deletion,
       so it stays dormant instead of resurfacing. */
    if (deleted.has(mindmapTurnKey(String(owned.owner), Number(boundary.seq)))) continue
    const chain = String(owned.owner) === String(doc.rootSessionId)
      ? doc.trunk
      : ((doc.branches ?? []).find(b => String(b?.sessionId) === String(owned.owner))?.turns ?? null)
    if (chain === null) continue
    const card = chain.find(turn => Number(turn?.t) === Number(boundary.t))
    if (card === undefined) continue
    const branch = {
      id: `b${Date.now()}${adopted}`,
      sessionId: String(sessionId),
      parentSessionId: String(owned.owner),
      parentTurn: Number(card.n),
      forkTurn: Number(boundary.t),
      forkSeq: Number(boundary.seq),
      turns: [],
    }
    /* Fold the child's own turns (those after its fork boundary) with fresh
       display numbers, like the client's forkBranchAt would have done. */
    const ownParsed = parsed.filter(turn => Number(turn.t) > branch.forkTurn)
      .filter(turn => !deleted.has(mindmapTurnKey(String(sessionId), Number(turn.seq))))
    const result = reconcileMindmapTurns(ownParsed, [], doc.next)
    branch.turns = result.turns
    doc.next = result.next
    doc.branches.push(branch)
    known.add(String(sessionId))
    adopted += 1
  }
  return adopted
}

/* Adopt every harness-created fork child of this doc's family (message-bubble
   "在新对话中分支", session-list fork): each pass documents one lineage level,
   so a fork-of-a-fork converges in a few passes. Returns true when the doc
   changed (the caller persists). */
async function adoptMindmapOrphans(ctx, persistence, doc) {
  let adopted = false
  for (let pass = 0; pass < 8; pass += 1) {
    const count = await adoptMindmapOrphanPass(ctx, persistence, doc)
    if (count === 0) break
    adopted = true
  }
  return adopted
}

/* Reconcile the doc against the current full logs, then adopt any harness
   fork children of its family into it, and persist. Returns
   { doc, live } — live carries the in-flight turn ({ turn, question }) of
   liveSessionId when it is a member of the doc family (the client's floating
   map shows it as the streaming card), or null when the session has no doc
   yet (the caller answers { exists: false }). */
async function syncMindmapDoc(ctx, persistence, sessionId, liveSessionId) {
  const doc = await findMindmapDoc(ctx, persistence, sessionId)
  if (doc === null || !isValidMindmapDoc(doc)) return null
  const root = String(doc.rootSessionId)
  const cached = mindmapSyncCache.get(root)
  const now = Date.now()
  /* Cheap "did anything change" check: when the signature is unchanged the
     cached doc is served without re-parsing any log, re-scanning the session
     index or writing the doc back — the periodic poll becomes O(1) while the
     family is idle. */
  const { sig, refs } = await mindmapSyncSignature(ctx, persistence, doc, cached?.refs)
  if (cached !== undefined && cached.at + MINDMAP_SYNC_CACHE_TTL_MS > now && cached.sig === sig) {
    return { doc: cached.doc, live: cached.live ?? null }
  }
  await reconcileMindmapDoc(ctx, persistence, doc)
  await adoptMindmapOrphans(ctx, persistence, doc)
  doc.updatedAt = Date.now()
  try {
    await writeJsonAtomic(mindmapDocPath(doc.rootSessionId), doc)
  } catch (error) {
    ctx.logger.warn(`[workspace-studio] mindmap doc sync write failed: ${String(error)}`)
  }
  let live = null
  if (liveSessionId !== undefined && (String(liveSessionId) === String(doc.rootSessionId)
    || (doc.branches ?? []).some(b => b !== null && b !== undefined && String(b?.sessionId) === String(liveSessionId)))) {
    const liveEvents = await eventsOf(ctx, persistence, String(liveSessionId))
    if (Array.isArray(liveEvents)) live = mindmapLiveTurnOf(liveEvents)
  }
  /* Settle the cached signature against the refs just captured (the family may
     have grown during adoption), so the very next poll is already a hit. */
  const settled = await mindmapSyncSignature(ctx, persistence, doc, refs)
  mindmapSyncCache.set(root, { sig: settled.sig, doc, live, at: Date.now(), refs: settled.refs })
  return { doc, live }
}

/* Cheap signature of everything that could change a doc's sync result, plus
   the live events array references of the family for identity comparison.
   - Family logs: a resident session's events array identity + length (a
     resident session is the only one that can gain turns while the host runs);
     a non-resident family session is treated as immutable (an unloaded session
     cannot be running). In-place edits that keep identity AND length are only
     caught by the TTL.
   - New fork orphans: the live session id set and the persistence index
     length.
   - The archived set reference: archiving a family member changes the doc's
     fate even though no log changed. */
async function mindmapSyncSignature(ctx, persistence, doc, cachedRefs) {
  const family = [String(doc.rootSessionId)]
  for (const branch of doc.branches ?? []) {
    if (branch !== null && branch !== undefined && typeof branch?.sessionId === 'string') family.push(String(branch.sessionId))
  }
  const logs = []
  const refs = new Map()
  for (const id of family) {
    const live = ctx.sessions.get(id)
    if (live !== undefined && Array.isArray(live.events)) {
      const prev = cachedRefs?.get(id)
      logs.push(`L:${id}:${live.events.length}:${prev === live.events ? 'same' : 'new'}`)
      refs.set(id, live.events)
    } else {
      logs.push(`D:${id}`)
    }
  }
  let liveIds = ''
  try {
    liveIds = ctx.sessions.list().map(s => s?.id ?? s?.header?.id).filter(Boolean).sort().join(',')
  } catch {
    /* live list unavailable: no orphan signal from it */
  }
  let persisted = -1
  try {
    if (persistence !== undefined) persisted = (await persistence.list()).length
  } catch {
    /* no persistence index: no orphan signal from it */
  }
  let archivedRef = ''
  try {
    archivedRef = String(ctx.workspaceRegistry?.archivedSessionIds ?? '')
  } catch {
    /* no registry: no archived signal */
  }
  return { sig: `${logs.join('|')}#${liveIds}#${persisted}#${archivedRef}`, refs }
}

/* Leave an alias stub at the old root's path after a root replacement (card
   deletion truncation) so a stale open of the archived root resolves to the
   new doc instead of building a fresh one. */
async function writeMindmapAliasStub(prevSessionId, newRootId) {
  await writeJsonAtomic(mindmapDocPath(prevSessionId), {
    version: MINDMAP_DOC_VERSION,
    aliasTo: String(newRootId),
    updatedAt: Date.now(),
  })
}

/* Persist a client-supplied doc (after a fork, a branch removal, or a root
   replacement). An optional prevSessionId retires the OLD root's doc file:
   the new doc is written and an alias stub replaces the old path in the same
   request, so a root swap can never leave a stale doc behind. */
async function writeMindmapDoc(ctx, persistence, sessionId, doc, prevSessionId) {
  if (!isValidMindmapDoc(doc)) throw new HttpError(400, 'invalid-mindmap-doc', '导图文档无效')
  if (String(doc.rootSessionId) !== String(sessionId)) throw new HttpError(400, 'invalid-mindmap-doc', '导图文档与会话不匹配')
  if (typeof doc.rootTitle !== 'string' || doc.rootTitle === '') {
    const title = await mindmapTitleOf(ctx, persistence, doc.rootSessionId)
    if (title !== undefined) doc.rootTitle = title
  }
  doc.updatedAt = Date.now()
  await writeJsonAtomic(mindmapDocPath(doc.rootSessionId), doc)
  if (prevSessionId !== undefined && prevSessionId !== null
    && String(prevSessionId) !== String(sessionId)) {
    await writeMindmapAliasStub(prevSessionId, doc.rootSessionId)
  }
  /* A client-side doc edit (fork / branch removal / truncation) changes the
     doc without touching any log: invalidate the sync cache so the next sync
     can never serve a stale pre-edit doc. */
  mindmapSyncCache.delete(String(doc.rootSessionId))
  if (prevSessionId !== undefined && prevSessionId !== null) mindmapSyncCache.delete(String(prevSessionId))
  return doc
}

/* Rename ONLY the map's own title (doc.rootTitle) on the persisted doc, in one
   Host step. The sidebar's rename previously round-tripped the whole document
   (GET then POST), which could clobber a turn that a concurrent sync had just
   folded in the window between the two requests; a targeted title update keeps
   the doc untouched otherwise and invalidates the sync cache. */
async function renameMindmapDoc(ctx, persistence, sessionId, title) {
  const doc = await readMindmapDocFile(sessionId)
  if (doc === null || !isValidMindmapDoc(doc) || mindmapDocIsDead(ctx, doc)) {
    throw new HttpError(404, 'mindmap-not-found', '导图文档不存在')
  }
  doc.rootTitle = title
  doc.updatedAt = Date.now()
  await writeJsonAtomic(mindmapDocPath(doc.rootSessionId), doc)
  mindmapSyncCache.delete(String(doc.rootSessionId))
  return { exists: true, doc }
}

/* Remove a doc file (whole mindmap archived). */
async function deleteMindmapDoc(sessionId) {
  const target = mindmapDocPath(sessionId)
  try {
    await unlink(target)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  mindmapSyncCache.delete(String(sessionId))
  return { ok: true }
}

/* Index of every doc on disk: the sidebar mind-map session entries and the
   branch hider both consume it. Archived maps are purged inline in the SAME
   pass (one directory listing + one read per file, not two), so a doc whose
   root was archived (by any path) disappears from the index and from disk
   within one poll. */
async function indexMindmapDocs(ctx) {
  const names = await mindmapDocFileNames()
  const docs = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(mindmapRoot(), name)
    const doc = await readJsonFileOrNull(path)
    if (doc === null) continue
    if (isValidMindmapDoc(doc)) {
      if (mindmapDocIsDead(ctx, doc)) {
        /* An archived map is dead: unlink it here and drop its sync cache
           entry so it can never be served or rebuilt again. */
        try { await unlink(path) } catch { /* best effort */ }
        mindmapSyncCache.delete(String(doc.rootSessionId))
        continue
      }
      docs.push({
        sessionId: String(doc.rootSessionId),
        rootTitle: typeof doc.rootTitle === 'string' ? doc.rootTitle : '',
        branchSessionIds: (doc.branches ?? [])
          .map(branch => (branch === null || branch === undefined ? undefined : String(branch.sessionId)))
          .filter(id => id !== undefined && id !== ''),
        updatedAt: Number(doc.updatedAt) || 0,
      })
      continue
    }
    /* Dangling alias stub (a root-replacement stub whose target doc is gone):
       purge in the same pass. */
    if (isPlainObject(doc) && typeof doc.aliasTo === 'string') {
      const target = await readJsonFileOrNull(mindmapDocPath(doc.aliasTo))
      if (target === null || !isValidMindmapDoc(target)) {
        try { await unlink(path) } catch { /* best effort */ }
      }
    }
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt)
  return { docs }
}

function validateMindmapSession(value) {
  if (typeof value !== 'string' || value === '' || value.length > 256
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-session', '会话标识无效')
  }
  return value
}

async function writeOwnerGeneration(workspaceId, owner, generation, operation) {
  if (owner === undefined) return
  await writeJsonAtomic(draftGenerationPath(workspaceId, owner), {
    version: 2,
    owner,
    generation,
    operation,
  })
}

function draftOperationToken(action, value) {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return `${action}:${digest}`
}

function draftPayloadEqual(left, right) {
  return left?.path === right?.path
    && left?.encoding === right?.encoding
    && left?.lineEnding === right?.lineEnding
    && Boolean(left?.bom) === Boolean(right?.bom)
    && left?.baseText === right?.baseText
    && left?.baseRevision === right?.baseRevision
    && left?.draft === right?.draft
}

async function ownerCurrentGeneration(workspaceId, owner, relativePath) {
  const ownerState = await readOwnerGenerationState(workspaceId, owner)
  const existing = await readDraftAtPath(workspaceId, relativePath, owner)
  const recordGeneration = Number.isSafeInteger(existing?.generation) ? existing.generation : -1
  return { current: Math.max(ownerState.generation, recordGeneration), existing, ownerState }
}

/** Persist one draft. Owner-aware writes are serialized per owner and guarded by
 * a durable owner generation. Legacy requests retain the original workspace/path
 * file and last-write-wins behavior for old clients. */
async function saveDraftFile(workspaceId, payload, config, queues) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  const owner = payload.owner
  const generation = payload.generation
  return serializeWrite(queues, draftQueueKey(workspaceId, owner), async () => {
    let current = -1
    let existing = null
    let state
    if (owner !== undefined && generation !== undefined) {
      const operation = draftOperationToken('put', payload)
      const snapshot = await ownerCurrentGeneration(workspaceId, owner, payload.path)
      current = snapshot.current
      existing = snapshot.existing
      state = snapshot.ownerState
      if (generation < current) throw new HttpError(409, 'draft-generation-conflict', '暂存写入已过期，请重新读取草稿')
      if (generation === current && current >= 0 && state.operation !== undefined && state.operation !== operation) {
        throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用')
      }
      if (generation === current && existing !== null) {
        if (!existing.deleted && draftPayloadEqual(existing, payload)) {
          return { workspaceId: String(workspaceId), path: payload.path, owner, generation, saved: true, idempotent: true }
        }
        throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用')
      }
      if (generation > current) await writeOwnerGeneration(workspaceId, owner, generation, operation)
    }
    const stored = owner === undefined && generation === undefined
      ? payload
      : { version: 2, ...payload }
    await writeJsonAtomic(draftFilePath(workspaceId, payload.path, owner), stored)
    return {
      workspaceId: String(workspaceId),
      path: payload.path,
      ...(owner === undefined ? {} : { owner }),
      ...(generation === undefined ? {} : { generation }),
      saved: true,
    }
  })
}

/** Delete one draft. Owner-aware deletion writes a tombstone rather than
 * unlinking, so a late PUT for a path that did not yet have a draft is still
 * rejected by the owner generation fence. */
async function deleteDraftFile(workspaceId, relativePath, config, queues, owner, generation) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  return serializeWrite(queues, draftQueueKey(workspaceId, owner), async () => {
    const target = draftFilePath(workspaceId, relativePath, owner)
    if (owner === undefined || generation === undefined) {
      await unlink(target).catch((error) => {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      })
      return { workspaceId: String(workspaceId), path: relativePath, ...(owner === undefined ? {} : { owner }), deleted: true }
    }
    const state = await ownerCurrentGeneration(workspaceId, owner, relativePath)
    const operation = draftOperationToken('delete', { path: relativePath })
    if (generation < state.current) throw new HttpError(409, 'draft-generation-conflict', '暂存删除已过期，请重新读取草稿')
    if (generation === state.current && state.current >= 0
      && state.ownerState.operation !== undefined && state.ownerState.operation !== operation) {
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用')
    }
    if (generation === state.current && state.existing?.deleted === true) {
      return { workspaceId: String(workspaceId), path: relativePath, owner, generation, deleted: true, idempotent: true }
    }
    if (generation === state.current && state.existing !== null) {
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用')
    }
    if (generation > state.current) await writeOwnerGeneration(workspaceId, owner, generation, operation)
    await writeJsonAtomic(target, { version: 2, owner, path: relativePath, generation, deleted: true })
    return { workspaceId: String(workspaceId), path: relativePath, owner, generation, deleted: true }
  })
}

function draftPathMatches(path, prefix) {
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`)
}

function rewriteDraftPath(path, from, to) {
  if (path === from) return to
  if (from === '') return to === '' ? path : `${to}/${path}`
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
}

async function listDraftRecords(workspaceId, owner) {
  const directory = draftOwnerDir(workspaceId, owner)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
  const records = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === '.generation.json') continue
    const file = join(directory, entry.name)
    const value = await readJsonFileOrNull(file)
    if (value === null || typeof value.path !== 'string') continue
    if (owner !== undefined && value.owner !== owner) continue
    try {
      normalizeRelativePath(value.path)
    } catch {
      continue
    }
    records.push({ file, value, owner })
  }
  return records
}

/* Owner-aware deletes write a tombstone instead of unlinking. The durable
 * generation fence lives in .generation.json (every write/delete/tree op
 * advances it), so a tombstone's only remaining jobs are suppressing restore
 * of a discarded draft and idempotent duplicate deletes — neither needs the
 * file to live forever. Reclaim tombstones older than the retention window
 * whenever a tree operation already holds the full record list, keeping the
 * draft directory bounded without ever touching the fence. */
const DRAFT_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
async function pruneDraftTombstones(records, owner) {
  if (owner === undefined) return
  const now = Date.now()
  for (const record of records) {
    if (record.value?.deleted !== true || record.value.owner !== owner) continue
    try {
      const fileStat = await stat(record.file)
      if (now - fileStat.mtimeMs <= DRAFT_TOMBSTONE_RETENTION_MS) continue
      await unlink(record.file)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** Move or delete every staged draft below a relative path. Owner-aware calls
 * require a generation and leave tombstones for old paths; this makes a late
 * autosave fail even when that path had no draft at the instant of the tree
 * operation. Legacy calls operate on the old flat files for compatibility. */
async function draftTreeOperation(workspaceId, payload, config, queues) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (!isPlainObject(payload)) throw new HttpError(400, 'invalid-draft', '暂存树请求必须是 JSON 对象')
  const action = payload.action
  if (action !== 'move' && action !== 'delete') throw new HttpError(400, 'invalid-draft', '暂存树操作无效')
  const owner = validateDraftOwner(payload.owner ?? payload.sessionId)
  const generation = parseDraftGeneration(payload.generation, owner !== undefined)
  const fromPath = normalizeRelativePath(payload.fromPath ?? payload.path ?? '')
  const toPath = action === 'move' ? normalizeRelativePath(payload.toPath ?? '') : undefined
  if (action === 'move') {
    if (fromPath === '' || toPath === '') throw new HttpError(400, 'invalid-path', '暂存移动必须指定源和目标目录')
    if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
      throw new HttpError(400, 'invalid-target', '暂存不能移动到自身或其子目录')
    }
  }
  return serializeWrite(queues, draftQueueKey(workspaceId, owner), async () => {
    let state
    let operation
    if (owner !== undefined) {
      state = await readOwnerGenerationState(workspaceId, owner)
      operation = draftOperationToken(`tree-${action}`, { fromPath, toPath, owner })
      if (generation < state.generation) throw new HttpError(409, 'draft-generation-conflict', '暂存树操作已过期，请重新读取草稿')
      if (generation === state.generation && state.generation >= 0
        && state.operation !== undefined && state.operation !== operation) {
        throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用')
      }
      if (generation > state.generation) await writeOwnerGeneration(workspaceId, owner, generation, operation)
    }
    let records = await listDraftRecords(workspaceId, owner)
    if (owner !== undefined) {
      // Claim legacy records lazily when an owner performs a tree operation.
      // An owner tombstone wins over the legacy fallback at the same path.
      const ownedPaths = new Set(records.map(record => record.value.path))
      const legacy = await listDraftRecords(workspaceId, undefined)
      records = [...records, ...legacy.filter(record => !ownedPaths.has(record.value.path))]
    }
    const selected = records.filter(record => record.value.deleted !== true && draftPathMatches(record.value.path, fromPath))
    if (action === 'delete') {
      for (const record of selected) {
        if (record.owner === undefined) await unlink(record.file).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
        if (owner !== undefined) await writeJsonAtomic(draftFilePath(workspaceId, record.value.path, owner), {
          version: 2, owner, path: record.value.path, generation, deleted: true,
        })
      }
      await pruneDraftTombstones(records, owner)
      return {
        workspaceId: String(workspaceId),
        ...(owner === undefined ? {} : { owner, generation }),
        action,
        path: fromPath,
        count: selected.length,
      }
    }

    const sourcePaths = new Set(selected.map(record => record.value.path))
    const destinations = selected.map(record => {
      const path = rewriteDraftPath(record.value.path, fromPath, toPath)
      return {
        record,
        path,
        next: {
          ...record.value,
          path,
          ...(owner === undefined ? {} : { version: 2, owner, generation }),
        },
        complete: false,
      }
    })
    for (const destination of destinations) {
      const collision = records.find(record => record.value.path === destination.path && !sourcePaths.has(record.value.path) && record.value.deleted !== true)
      if (collision === undefined) continue
      if (draftPayloadEqual(collision.value, destination.next)
        && (owner === undefined || collision.value.generation === generation)) {
        destination.complete = true
        continue
      }
      throw new HttpError(409, 'entry-exists', `目标暂存已存在：${destination.path}`)
    }
    for (const destination of destinations) {
      if (!destination.complete) await writeJsonAtomic(draftFilePath(workspaceId, destination.path, owner), destination.next)
    }
    for (const record of selected) {
      if (owner === undefined) {
        await unlink(record.file).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
      } else {
        await writeJsonAtomic(draftFilePath(workspaceId, record.value.path, owner), {
          version: 2, owner, path: record.value.path, generation, deleted: true,
        })
      }
    }
    await pruneDraftTombstones(records, owner)
    return {
      workspaceId: String(workspaceId),
      ...(owner === undefined ? {} : { owner, generation }),
      action,
      fromPath,
      toPath,
      count: selected.length,
    }
  })
}

function requiredText(value, name, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-context', `${name} 无效`)
  }
  return value
}

function requiredInteger(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new HttpError(400, 'invalid-context', `${name} 无效`)
  }
  return value
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function promptContextPosition(content, offset) {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) !== 10) continue
    line += 1
    lineStart = index + 1
  }
  return { line, column: offset - lineStart + 1 }
}

function validateDirtySelection(selection) {
  const logical = normalizeNewlines(selection.text)
  if (selection.to - selection.from !== logical.length) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区偏移与选中文本长度不一致')
  }
  const lines = logical.split('\n')
  const endLine = selection.startLine + lines.length - 1
  const endColumn = lines.length === 1
    ? selection.startColumn + lines[0].length
    : lines[lines.length - 1].length + 1
  if (selection.endLine !== endLine || selection.endColumn !== endColumn) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区行列与选中文本结构不一致')
  }
}

function validatePromptContextPayload(value, config) {
  if (!isPlainObject(value)) throw new HttpError(400, 'invalid-context', '编辑器上下文请求必须是 JSON 对象')
  const sessionId = requiredText(value.sessionId, 'sessionId', 256)
  const workspaceId = requiredText(value.workspaceId, 'workspaceId', 256)
  const path = normalizeRelativePath(requiredText(value.path, 'path', 4096))
  if (path === '') throw new HttpError(400, 'invalid-context', '编辑器上下文必须指定文件路径')
  if (value.mode === 'path') {
    return { sessionId, workspaceId, path, mode: 'path' }
  }
  if (value.mode !== 'selection' || !isPlainObject(value.selection)) {
    throw new HttpError(400, 'invalid-context', '编辑器上下文模式无效')
  }
  if (typeof value.dirty !== 'boolean') throw new HttpError(400, 'invalid-context', 'dirty 无效')
  const revision = value.revision === undefined
    ? undefined
    : typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)
      ? value.revision
      : (() => { throw new HttpError(400, 'invalid-context', 'revision 无效') })()
  if (!value.dirty && revision === undefined) {
    throw new HttpError(409, 'context-revision-required', '未修改的选区必须携带文件修订版本')
  }
  // The decode encoding the client editor used, whitelisted against the
  // supported encodings; absent payloads default to UTF-8 (the historical
  // behaviour). Unknown ids throw via encodingById.
  const encoding = value.encoding === undefined || value.encoding === null
    ? 'utf-8'
    : encodingById(String(value.encoding)).id
  const selection = {
    from: requiredInteger(value.selection.from, 'selection.from', 0),
    to: requiredInteger(value.selection.to, 'selection.to', 1),
    startLine: requiredInteger(value.selection.startLine, 'selection.startLine', 1),
    startColumn: requiredInteger(value.selection.startColumn, 'selection.startColumn', 1),
    endLine: requiredInteger(value.selection.endLine, 'selection.endLine', 1),
    endColumn: requiredInteger(value.selection.endColumn, 'selection.endColumn', 1),
    text: typeof value.selection.text === 'string' ? value.selection.text : '',
  }
  if (selection.text !== value.selection.text || selection.text.includes('\0') || selection.to <= selection.from) {
    throw new HttpError(400, 'invalid-context', '选区内容无效')
  }
  const selectedBytes = Buffer.byteLength(selection.text, 'utf8')
  if (selectedBytes > config.maxContextBytes) {
    throw new HttpError(413, 'context-too-large', `选中文本不能超过 ${config.maxContextBytes} 个 UTF-8 字节`)
  }
  validateDirtySelection(selection)
  return {
    sessionId,
    workspaceId,
    path,
    mode: 'selection',
    encoding,
    dirty: value.dirty,
    ...(revision === undefined ? {} : { revision }),
    selection,
  }
}

async function readPromptContextRequest(req, config) {
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '编辑器上下文请求必须使用 application/json')
  }
  const maximum = Math.min(10 * 1024 * 1024, config.maxContextBytes * 6 + 16 * 1024)
  const bytes = await readBody(
    req,
    maximum,
    'context-request-too-large',
    `编辑器上下文请求不能超过 ${maximum} 字节`,
  )
  const source = decodeUtf8(bytes, false)
  if (source === undefined) throw new HttpError(400, 'invalid-context', '编辑器上下文请求不是有效的 UTF-8 JSON')
  let value
  try {
    value = JSON.parse(source)
  } catch {
    throw new HttpError(400, 'invalid-context', '编辑器上下文请求不是有效的 JSON')
  }
  return validatePromptContextPayload(value, config)
}

async function verifyPromptContextFile(workspace, relativePath) {
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, relativePath)
  if (await hasSymlinkComponent(root, relativePath)) {
    throw new HttpError(403, 'context-symlink-denied', '符号链接文件不能加入对话上下文')
  }
  const targetStat = await stat(target)
  if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '编辑器上下文目标不是普通文件')
  return { root, path: relativePath, target }
}

async function readCleanPromptContext(file, maximum) {
  const handle = await open(file.target, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new HttpError(400, 'not-a-file', '编辑器上下文目标不是普通文件')
    if (opened.size > maximum) {
      throw new HttpError(413, 'context-source-too-large', `上下文源文件不能超过 ${maximum} 字节`)
    }
    if (await hasSymlinkComponent(file.root, file.path)) {
      throw new HttpError(403, 'context-symlink-denied', '符号链接文件不能加入对话上下文')
    }
    const currentTarget = await realpath(file.target)
    if (!isInside(file.root, currentTarget)) {
      throw new HttpError(403, 'path-outside-workspace', '拒绝读取工作区之外的上下文文件')
    }
    const current = await stat(currentTarget)
    if (!current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new HttpError(409, 'context-file-changed', '上下文文件在发送期间发生变化')
    }
    const buffer = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const settled = await handle.stat()
    if (offset !== opened.size || settled.size !== opened.size) {
      throw new HttpError(409, 'context-file-changed', '上下文文件在发送期间发生变化')
    }
    return buffer
  } finally {
    await handle.close()
  }
}

async function verifyCleanSelection(file, context, maximum) {
  const bytes = await readCleanPromptContext(file, maximum)
  if (revisionFor(bytes) !== context.revision) {
    throw new HttpError(409, 'context-revision-conflict', '文件已变化，请重新选择上下文后再发送')
  }
  const encodingId = context.encoding ?? 'utf-8'
  const isUtf16 = encodingId === 'utf-16le' || encodingId === 'utf-16be'
  // UTF-16 text legitimately carries 0x00 bytes; the NUL sniff applies to the
  // other encodings only.
  if (!isUtf16 && containsNul(bytes)) throw new HttpError(415, 'binary-file', '上下文文件不是文本')
  // Decode with the same encoding the client editor displayed, not a hard
  // UTF-8 assumption, so the recomputed selection matches the editor text.
  const content = decodeBytes(bytes, encodingId, false)
  if (content === undefined) {
    const label = encodingById(encodingId).label
    throw new HttpError(415, 'invalid-encoding', `上下文文件不是有效的 ${label} 编码文本`)
  }
  const logical = normalizeNewlines(content)
  const { selection } = context
  if (selection.to > logical.length) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区超出当前文件范围')
  }
  const logicalSlice = logical.slice(selection.from, selection.to)
  // The client maps the editor offsets and the selection text into
  // LF-normalized space before sending (see publishContextState in
  // src/client/index.js), so the slice is compared directly without re-adding
  // the file's original line endings.
  if (logicalSlice !== selection.text) {
    throw new HttpError(409, 'context-content-mismatch', '选中文本与当前文件内容不一致')
  }
  const start = promptContextPosition(logical, selection.from)
  const end = promptContextPosition(logical, selection.to)
  if (start.line !== selection.startLine || start.column !== selection.startColumn
    || end.line !== selection.endLine || end.column !== selection.endColumn) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区行列与当前文件不一致')
  }
}

async function workspaceOwnsSession(ctx, workspace, sessionId) {
  if (workspace.sessionIds.some(candidate => String(candidate) === sessionId)) return true
  const session = ctx.sessions.get(sessionId)
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return false
  try {
    return await realpath(cwd) === await realpath(workspace.path)
  } catch {
    return false
  }
}

async function renderPromptContext(ctx, config, req) {
  const context = await readPromptContextRequest(req, config)
  const workspace = workspaceFor(ctx, context.workspaceId)
  if (!await workspaceOwnsSession(ctx, workspace, context.sessionId)) {
    throw new HttpError(403, 'context-session-denied', '当前会话不属于所选工作区')
  }
  const file = await verifyPromptContextFile(workspace, context.path)
  if (context.mode === 'selection' && !context.dirty) {
    await verifyCleanSelection(file, context, config.maxContextSourceBytes)
  }
  const text = context.mode === 'path'
    ? [
        `<opened_file>The user opened the file ${context.path} in the IDE. This may or may not be related to the current task.</opened_file>`,
      ].join('\n')
    : [
        `<selection>The user selected the lines ${context.selection.startLine} to ${context.selection.endLine} from ${context.path}:`,
        context.selection.text,
        'This may or may not be related to the current task.</selection>',
      ].join('\n')
  const renderedBytes = Buffer.byteLength(text, 'utf8')
  if (renderedBytes > config.maxPromptContextBytes) {
    throw new HttpError(413, 'context-too-large', `完整编辑器上下文不能超过 ${config.maxPromptContextBytes} 个 UTF-8 字节`)
  }
  return { text, bytes: renderedBytes }
}

function workspaceFor(ctx, workspaceId) {
  const workspace = ctx.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new HttpError(404, 'workspace-not-found', '当前工作区不存在')
  return workspace
}

function normalizeFailure(error) {
  if (error instanceof HttpError) return error
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return new HttpError(403, 'path-denied', '没有权限访问该路径')
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return new HttpError(404, 'path-not-found', '文件或目录不存在')
  return new HttpError(500, 'workspace-operation-failed', '工作区操作失败')
}

async function handleRequest(ctx, config, trustedHosts, writeQueues, req, res) {
  if (!isTrustedRequest(req, trustedHosts)) {
    sendError(req, res, 403, 'request-not-trusted', '请求来源未获授权')
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const contextEndpoint = url.pathname === `${API_PREFIX}/context`
    const encodingsEndpoint = url.pathname === `${API_PREFIX}/encodings`
    const entryEndpoint = url.pathname === `${API_PREFIX}/entry`
    const externalFileEndpoint = url.pathname === `${API_PREFIX}/external-file`
    const fileEndpoint = url.pathname === `${API_PREFIX}/file`
    const fsEndpoint = url.pathname === `${API_PREFIX}/fs`
    const treeEndpoint = url.pathname === `${API_PREFIX}/tree`
    const searchEndpoint = url.pathname === `${API_PREFIX}/search`
    const revealEndpoint = url.pathname === `${API_PREFIX}/reveal`
    const draftEndpoint = url.pathname === `${API_PREFIX}/draft`
    const draftTreeEndpoint = url.pathname === `${API_PREFIX}/draft-tree`
    const mindmapDocEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc`
    const mindmapDocIndexEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/index`
    const mindmapDocSyncEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/sync`
    const mindmapDocRenameEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/rename`
    const allowed = contextEndpoint
      ? 'POST'
      : encodingsEndpoint
        ? 'GET, HEAD'
        : entryEndpoint
          ? 'POST, PATCH'
          : externalFileEndpoint
            ? 'POST'
            : fileEndpoint
              ? 'GET, HEAD, PUT'
              : fsEndpoint
                ? 'POST'
                : treeEndpoint
                  ? 'GET, HEAD'
                  : searchEndpoint
                    ? 'GET, HEAD'
                    : revealEndpoint
                      ? 'POST'
                      : draftTreeEndpoint
                        ? 'POST'
                        : mindmapDocIndexEndpoint
                          ? 'GET, HEAD'
                          : mindmapDocSyncEndpoint
                            ? 'POST'
                            : mindmapDocRenameEndpoint
                              ? 'POST'
                              : mindmapDocEndpoint
                                ? 'GET, HEAD, POST, DELETE'
                                : draftEndpoint
                                  ? 'GET, HEAD, PUT, DELETE'
                                  : undefined
    if (allowed !== undefined && !allowed.split(', ').includes(req.method ?? '')) {
      sendError(req, res, 405, 'method-not-allowed', `该接口只允许 ${allowed} 请求`, { allow: allowed })
      return
    }
    if (!contextEndpoint && !encodingsEndpoint && !entryEndpoint && !externalFileEndpoint && !fileEndpoint && !fsEndpoint && !treeEndpoint && !searchEndpoint && !revealEndpoint && !draftEndpoint && !draftTreeEndpoint && !mindmapDocEndpoint && !mindmapDocIndexEndpoint && !mindmapDocSyncEndpoint && !mindmapDocRenameEndpoint) {
      sendError(req, res, 404, 'endpoint-not-found', '接口不存在')
      return
    }
    if (contextEndpoint) {
      sendJson(req, res, 200, await renderPromptContext(ctx, config, req))
      return
    }
    if (encodingsEndpoint) {
      sendJson(req, res, 200, { encodings: ENCODINGS.map(({ id, label }) => ({ id, label })) })
      return
    }
    if (externalFileEndpoint) {
      sendJson(req, res, 200, await readExternalPreview(url, config, req))
      return
    }
    /* Mind-map docs are keyed by session, not workspace, so they are handled
       before the workspaceId requirement below. */
    const persistence = ctx.get('sessionPersistence')
    if (mindmapDocIndexEndpoint) {
      sendJson(req, res, 200, await indexMindmapDocs(ctx))
      return
    }
    if (mindmapDocSyncEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      /* The optional liveSessionId (the floating map's own session) rides the
         query with a body fallback, like the doc endpoints. */
      const liveRaw = url.searchParams.get('liveSessionId') ?? payload?.liveSessionId
      const liveSessionId = liveRaw === undefined || liveRaw === null || liveRaw === ''
        ? undefined
        : validateMindmapSession(liveRaw)
      const result = await syncMindmapDoc(ctx, persistence, validateMindmapSession(payload?.sessionId), liveSessionId)
      sendJson(req, res, 200, result === null ? { exists: false } : { exists: true, doc: result.doc, live: result.live })
      return
    }
    if (mindmapDocRenameEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
      const rawTitle = payload?.title
      if (typeof rawTitle !== 'string' || rawTitle.trim() === '' || rawTitle.trim().length > 200) {
        throw new HttpError(400, 'invalid-title', '导图标题无效')
      }
      sendJson(req, res, 200, await renameMindmapDoc(ctx, persistence, sessionId, rawTitle.trim()))
      return
    }
    if (mindmapDocEndpoint) {
      if (req.method === 'DELETE') {
        const sessionId = validateMindmapSession(url.searchParams.get('sessionId'))
        sendJson(req, res, 200, await deleteMindmapDoc(sessionId))
        return
      }
      if (req.method === 'POST') {
        const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
        /* sessionId comes from the query, falling back to the body (the
           client sends both; the fallback keeps older clients working). */
        const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
        /* Optional prevSessionId (query or body): a root replacement retires
           the old root's doc file in the same request. */
        const prevRaw = url.searchParams.get('prevSessionId') ?? payload?.prevSessionId
        const prevSessionId = prevRaw === undefined || prevRaw === null || prevRaw === ''
          ? undefined
          : validateMindmapSession(prevRaw)
        const doc = await writeMindmapDoc(ctx, persistence, sessionId, payload?.doc, prevSessionId)
        sendJson(req, res, 200, { exists: true, doc })
        return
      }
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId'))
      /* Sweep archived maps first: a doc whose root was archived (by any UI
         path) is dead — reopening it must not resurrect it. */
      await purgeArchivedMindmapDocs(ctx)
      /* Ancestor-aware: a fork descendant always resolves to its ancestor's
         document, so a branch whose write raced cannot be split off as a new
         root. Only a session with NO documented ancestor is converted. */
      const existing = await findMindmapDocWithAncestors(ctx, persistence, sessionId)
      if (existing !== null) {
        /* Fold the latest turns and adopt harness-created fork children so a
           freshly opened map is already complete; the doc is written back
           only when something actually changed (the sidebar entry order keys
           on updatedAt). */
        const before = JSON.stringify({ trunk: existing.trunk, branches: existing.branches, next: existing.next })
        await reconcileMindmapDoc(ctx, persistence, existing)
        const adopted = await adoptMindmapOrphans(ctx, persistence, existing)
        const after = JSON.stringify({ trunk: existing.trunk, branches: existing.branches, next: existing.next })
        if (adopted || before !== after) {
          existing.updatedAt = Date.now()
          try {
            await writeJsonAtomic(mindmapDocPath(existing.rootSessionId), existing)
          } catch (error) {
            ctx.logger.warn(`[workspace-studio] mindmap doc load write failed: ${String(error)}`)
          }
          /* This load path WRITES the doc (an adoption or folded turn) without
             touching any log — invalidate the sync cache just like every other
             doc write path, or the next sync would serve the stale pre-adopt
             doc for up to the TTL (an adopted branch briefly vanishing after a
             reopen). */
          mindmapSyncCache.delete(String(existing.rootSessionId))
        }
        sendJson(req, res, 200, { exists: true, created: false, doc: existing })
        return
      }
      /* First access: reverse-parse the FULL log into trunk turns and persist —
         the conversion step. */
      const built = await buildMindmapDoc(ctx, persistence, sessionId)
      if (built !== null) {
        await adoptMindmapOrphans(ctx, persistence, built)
        if (built.branches.length > 0) {
          built.updatedAt = Date.now()
          try {
            await writeJsonAtomic(mindmapDocPath(built.rootSessionId), built)
          } catch (error) {
            ctx.logger.warn(`[workspace-studio] mindmap doc conversion adoption write failed: ${String(error)}`)
          }
          mindmapSyncCache.delete(String(built.rootSessionId))
        }
      }
      sendJson(req, res, 200, built === null ? { exists: false } : { exists: true, created: true, doc: built })
      return
    }
    const workspaceId = requiredQuery(url, 'workspaceId')
    const workspace = workspaceFor(ctx, workspaceId)
    if (draftTreeEndpoint) {
      const payload = await readJsonObject(req, config)
      sendJson(req, res, 200, await draftTreeOperation(workspaceId, payload, config, writeQueues))
      return
    }
    if (searchEndpoint) {
      const query = requiredQuery(url, 'q')
      if (query.includes('\n') || query.includes('\r')
        || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(query)) {
        throw new HttpError(400, 'invalid-query', '搜索内容不能包含换行或控制字符')
      }
      if (query.length > config.maxSearchQueryLength) {
        throw new HttpError(413, 'query-too-long', `搜索内容不能超过 ${config.maxSearchQueryLength} 个字符`)
      }
      const rawCase = url.searchParams.get('caseSensitive')
      sendJson(req, res, 200, await searchWorkspace(workspace, query, rawCase === 'true' || rawCase === '1', config))
      return
    }
    const relativePath = normalizeRelativePath(url.searchParams.get('path') ?? '')
    const encodingId = url.searchParams.get('encoding') ?? 'utf-8'
    if (draftEndpoint) {
      const owner = validateDraftOwner(url.searchParams.get('owner') ?? url.searchParams.get('sessionId') ?? undefined)
      const generation = parseDraftGenerationQuery(url.searchParams.get('generation'))
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存读取必须指定文件路径')
        const value = await readDraftFile(workspaceId, relativePath, owner)
        sendJson(req, res, 200, value ?? { exists: false })
        return
      }
      if (req.method === 'DELETE') {
        if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存删除必须指定文件路径')
        if (owner !== undefined && generation === undefined) throw new HttpError(400, 'invalid-draft', 'owner 暂存删除必须提供 generation')
        sendJson(req, res, 200, await deleteDraftFile(workspaceId, relativePath, config, writeQueues, owner, generation))
        return
      }
      if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存写入必须指定文件路径')
      const maximum = Math.min(64 * 1024 * 1024, config.maxEditableBytes * 2 + 64 * 1024)
      const body = await readJsonObject(req, config, maximum)
      const payload = validateDraftPayload(body, config, relativePath, owner, generation)
      sendJson(req, res, 200, await saveDraftFile(workspaceId, payload, config, writeQueues))
      return
    }
    if (fsEndpoint) {
      sendJson(req, res, 200, await fsOperation(workspace, config, writeQueues, req))
      return
    }
    if (revealEndpoint) {
      sendJson(req, res, 200, await revealInExplorer(workspace, relativePath))
      return
    }
    if (entryEndpoint && req.method === 'POST') {
      sendJson(req, res, 200, await createEntry(workspace, relativePath, config, writeQueues, req))
    } else if (entryEndpoint) {
      sendJson(req, res, 200, await renameEntry(workspace, relativePath, config, writeQueues, req))
    } else if (treeEndpoint) {
      sendJson(req, res, 200, await listTree(workspace, relativePath, config.maxEntriesPerDirectory))
    } else if (req.method === 'PUT') {
      sendJson(req, res, 200, await saveFile(workspace, relativePath, config, writeQueues, req, encodingId))
    } else {
      sendJson(req, res, 200, await readPreview(workspace, relativePath, config, encodingId))
    }
  } catch (error) {
    const failure = normalizeFailure(error)
    if (failure.status === 500) ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    sendError(req, res, failure.status, failure.code, failure.message)
  }
}

/** Register the workspace-confined browser API. */
export function apply(ctx, config) {
  const trustedHosts = [...ctx.webRuntime.trustedHosts]
  const writeQueues = new Map()
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => handleRequest(ctx, config, trustedHosts, writeQueues, req, res),
    }),
    'workspace-studio: workspace API',
  )
}
