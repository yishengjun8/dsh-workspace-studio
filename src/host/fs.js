/** Workspace read side: tree listing, search, preview reads, reveal. */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { release as osRelease } from 'node:os'
import { dirname, resolve } from 'node:path'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { HttpError } from './errors.js'
import { entryPath, hasSymlinkComponent, isInside, resolveWorkspacePath } from './paths.js'
import { containsNul, decodeBytes, decodeUtf8, effectiveReadEncoding, encodingById, revisionFor, textMetadata } from './encodings.js'
import { header, readBody } from './http.js'

const execFileAsync = promisify(execFile)
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
    // wslpath failure is a host config problem, not a missing path; report a reveal failure, not path-not-found.
    throw new HttpError(500, 'wsl-translate-failed', '无法将路径转换为 Windows 路径')
  }
  const translated = stdout.replace(/[\r\n]+$/, '')
  if (translated === '') throw new HttpError(500, 'wsl-translate-failed', '无法将路径转换为 Windows 路径')
  return translated
}

/** Resolve the native "reveal in file manager" command: dirs open in place,
 * files reveal in their containing folder; undefined on platforms with no
 * desktop file manager. */
async function revealCommandFor(target, directory, platform = process.platform) {
  if (platform === 'win32') {
    /* explorer.exe parses `/select,<path>` by splitting on the FIRST comma, so
       a path containing a comma would be truncated. Fall back to opening the
       containing folder (no selection) for such paths. */
    const selectable = !target.includes(',')
    return {
      file: 'explorer.exe',
      args: directory || !selectable ? [directory ? target : dirname(target)] : [`/select,${target}`],
    }
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
export async function revealInExplorer(workspace, relativePath) {
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

export function describeCreatedEntry(workspace, relativePath, kind) {
  return {
    workspaceId: String(workspace.id),
    path: relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    kind,
    symlink: false,
  }
}

export async function listTree(workspace, relativePath) {
  const root = await realpath(workspace.path)
  const directory = await resolveWorkspacePath(root, relativePath)
  const directoryStat = await stat(directory)
  if (!directoryStat.isDirectory()) throw new HttpError(400, 'not-a-directory', '所选路径不是目录')
  const raw = await readdir(directory, { withFileTypes: true })
  const entries = await Promise.all(raw.map(dirent => describeEntry(root, directory, relativePath, dirent)))
  entries.sort(compareEntries)
  return {
    workspaceId: String(workspace.id),
    path: relativePath,
    entries,
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
        // Columns relative to the displayed snippet window (hit highlighting);
        // …absolute 1-based columns within the full line so the client can
        // select the true match even when the snippet is truncated.
        startColumn: start - from + 1,
        endColumn: start - from + length + 1,
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
  let searchBytes
  try {
    searchBytes = await readPrefix(target, Math.min(targetStat.size, config.maxSearchFileBytes))
  } catch {
    /* The file vanished (or became unreadable) between stat and open: skip it
       instead of failing the whole workspace search. */
    return null
  }
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

/** Walk the workspace (skipping symlinks and configured dirs), search the same
 * per-file preview window the browser displays; matches grouped by file with
 * 1-based line numbers and match columns. */
export async function searchWorkspace(workspace, query, caseSensitive, nameOnly, config) {
  const root = await realpath(workspace.path)
  const files = []
  const directories = []
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
        directories.push(entryPath(relativePath, dirent.name))
        await walk(resolve(directory, dirent.name), entryPath(relativePath, dirent.name))
      } else if (dirent.isFile()) {
        files.push(entryPath(relativePath, dirent.name))
      }
    }
  }
  await walk(root, '')
  files.sort()
  directories.sort()
  /* Name-only mode matches each entry's own name (file or directory) and reads
     no content; content mode keeps the per-file read below. */
  const candidates = nameOnly
    ? [...directories.map(relativePath => ({ kind: 'directory', relativePath })), ...files.map(relativePath => ({ kind: 'file', relativePath }))]
    : null
  const total = nameOnly ? candidates.length : files.length
  const results = []
  const fileCap = Math.min(total, config.maxSearchFiles)
  let index = 0
  let matchCount = 0
  let truncated = false
  const worker = async () => {
    while (index < fileCap && matchCount < config.maxSearchMatches) {
      const item = nameOnly ? candidates[index] : undefined
      const relativePath = nameOnly ? item.relativePath : files[index]
      index += 1
      let found
      if (nameOnly) {
        const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
        const hit = caseSensitive
          ? name.includes(query)
          : name.toLowerCase().includes(query.toLowerCase())
        if (!hit) continue
        found = { kind: item.kind, path: relativePath, name, matches: [], truncated: false }
      } else {
        found = await searchFile(root, relativePath, query, caseSensitive, config)
        if (found === null) continue
      }
      if (results.length >= config.maxSearchFiles) {
        truncated = true
        break
      }
      /* Re-check the match cap synchronously right before the push: the while
         condition is evaluated across an await, so several workers can pass it
         together and overshoot maxSearchMatches by up to (concurrency-1) files. */
      if (matchCount >= config.maxSearchMatches) {
        truncated = true
        break
      }
      results.push(found)
      matchCount += nameOnly ? 1 : found.matches.length
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(config.searchConcurrency, fileCap); i += 1) workers.push(worker())
  await Promise.all(workers)
  /* Incomplete only when the scan stopped before visiting every file (a cap
     interruption while files remained); the old matchCount term falsely marked
     a search truncated when the cap was hit exactly after the last file.
     Worker check-then-push is synchronous, so `results` never overshoots
     maxSearchFiles. */
  if (index < total) truncated = true
  results.sort((left, right) => left.path.localeCompare(right.path, 'en', { numeric: true, sensitivity: 'base' }))
  return {
    workspaceId: String(workspace.id),
    query,
    caseSensitive,
    nameOnly,
    files: results,
    matchCount,
    fileCount: results.length,
    truncated,
  }
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
/* Read a whole open file handle with a hard size cap: the caller's earlier
   stat may be stale (an external writer can grow the file between the check
   and the read), and an unbounded readFile would then buffer an arbitrarily
   large file. The cap is enforced against the handle's OWN stat, and a
   mid-read size change fails the save instead of silently hashing a partial
   file. */
export async function readFileHandleBounded(handle, maximum) {
  const opened = await handle.stat()
  if (opened.size > maximum) throw new HttpError(413, 'file-too-large', '现有文件超过可编辑大小限制')
  const buffer = Buffer.alloc(opened.size)
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset !== opened.size) throw new HttpError(409, 'file-conflict', '文件在保存期间发生变化，请重新加载后再保存')
  return buffer
}
export async function readPreview(workspace, relativePath, config, encodingId = 'utf-8') {
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
    readOnlyReason: readOnlyReason ?? null, maxContextBytes: config.maxContextBytes,
    mtimeMs: targetStat.mtimeMs, sizeBytes: targetStat.size, ...metadata,
  }
  if (!truncated) result.revision = revisionFor(previewBytes)
  return result
}
/* ------------------------------------------------------------------------
 * External file-change checking for clean preview tabs.
 *
 * The browsing pane is snapshot-based (the client re-reads only when the
 * active path or reload token changes). To surface edits by other tools, the
 * client polls a cheap change-check endpoint on a fixed cadence; this helper
 * compares stat fields first and hashes only when they moved. A legacy Host
 * fs.watch push path was removed: it never registered its watcher with a
 * client and the client never subscribed to pushes, so it was dead code that
 * only leaked fs.watch handles. Read-only and scoped to paths already opened
 * in the preview; no directory tree is watched.
 * ---------------------------------------------------------------------- */

/** sha256 of the first maxPreviewBytes bytes, matching readPreview's revision
 * basis so "no change" is authoritative; truncated files always report change. */
async function previewHash(target, maxPreviewBytes) {
  try {
    const requested = Math.min((await stat(target)).size, maxPreviewBytes)
    const bytes = await readPrefix(target, requested)
    return revisionFor(bytes)
  } catch {
    return null
  }
}

/** Cheap change check: stat fields first, hash only when they moved. Returns
 * the new snapshot (null when the file is gone). */
async function fileChangeSnapshot(target, previous, maxPreviewBytes) {
  let current
  try {
    current = await stat(target)
  } catch {
    return null
  }
  const sameMtime = previous !== undefined && previous.mtimeMs === current.mtimeMs
    && previous.size === current.size
  if (sameMtime) return previous
  const hash = await previewHash(target, maxPreviewBytes)
  if (hash !== null && previous?.hash === hash) return previous
  return { mtimeMs: current.mtimeMs, size: current.size, hash }
}



/** Read only the head of a file: stat fields plus a hash of the preview-sized
 * prefix, for cheap change detection. */
export async function readPreviewHead(workspace, relativePath, maxPreviewBytes, previousSnapshot) {
  if (relativePath === '') throw new HttpError(400, 'not-a-file', '请选择要预览的文件')
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, relativePath)
  return fileChangeSnapshot(target, previousSnapshot, maxPreviewBytes)
}
/** Preview a drag-and-dropped non-workspace file. Browsers never expose a
 * dropped file's absolute path, so the client uploads the raw bytes and this
 * route decodes them like readPreview. Always read-only: no disk location to
 * write back to. */
export async function readExternalPreview(url, config, req) {
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
