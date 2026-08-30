/** Editor prompt-context rendering with clean/dirty selection checks. */
import { open, realpath, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { HttpError, isPlainObject } from './errors.js'
import { hasSymlinkComponent, isInside, normalizeRelativePath, resolveWorkspacePath } from './paths.js'
import { containsNul, decodeBytes, decodeUtf8, encodingById, revisionFor } from './encodings.js'
import { header, readBody } from './http.js'
import { workspaceFor, workspaceOwnsSession } from './workspace.js'
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
  // The encoding the client editor used, whitelisted against supported ones;
  // absent payloads default to UTF-8; unknown ids throw via encodingById.
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
  // UTF-16 text legitimately carries 0x00 bytes; the NUL sniff applies to other encodings only.
  if (!isUtf16 && containsNul(bytes)) throw new HttpError(415, 'binary-file', '上下文文件不是文本')
  // Decode with the same encoding the client editor displayed, not hard-coded UTF-8, so the recomputed selection matches the editor text.
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
  // The client LF-normalizes offsets and selection text before sending (see
  // publishContextState in src/client/index.js), so the slice is compared
  // directly without re-adding the file's original line endings.
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
export async function renderPromptContext(ctx, config, req) {
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
