/** HTTP helpers: trust fence, JSON/body readers, error responses. */
import { Buffer } from 'node:buffer'
import { HttpError, isPlainObject } from './errors.js'
import { decodeUtf8 } from './encodings.js'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
}
export function header(headers, name) {
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
export function isTrustedRequest(req, trustedHosts) {
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
export function sendJson(req, res, status, value, extraHeaders = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': String(body.byteLength),
    ...extraHeaders,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

export function sendError(req, res, status, code, message, extraHeaders, data) {
  sendJson(req, res, status, { error: { code, message, ...(data === undefined ? {} : { data }) } }, extraHeaders)
}
export function requiredQuery(url, name) {
  const value = url.searchParams.get(name)
  if (value === null || value === '') throw new HttpError(400, 'invalid-request', `缺少查询参数 ${name}`)
  return value
}
export function readBody(
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
    /* Some Node versions / connection teardown paths fire only 'close'
       (destroy() mid-body, keep-alive reuse) without 'aborted': without this
       the promise would never settle and the request handler would hang. The
       settled guard makes the normal end-then-close sequence a no-op. */
    req.on('close', () => {
      if (settled) return
      settled = true
      reject(new HttpError(400, 'request-aborted', abortedMessage))
    })
  })
}
export async function readJsonObject(req, config, maximum = config.maxMutationBodyBytes) {
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
export function normalizeFailure(error) {
  if (error instanceof HttpError) return error
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return new HttpError(403, 'path-denied', '没有权限访问该路径')
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return new HttpError(404, 'path-not-found', '文件或目录不存在')
  /* Plain-file expectations meeting a directory, a symlink loop, or a
     read-only filesystem are NOT server faults: classify them instead of
     surfacing a black-box 500. */
  if (error?.code === 'EISDIR') return new HttpError(400, 'not-a-file', '所选路径不是普通文件')
  if (error?.code === 'ELOOP') return new HttpError(400, 'invalid-path', '路径包含符号链接循环')
  if (error?.code === 'EROFS') return new HttpError(403, 'path-denied', '文件系统为只读')
  /* Name/state races and platform edge cases that can slip past the
     pre-checks (Windows reserved-name EINVAL, over-long names, non-empty
     directories, a target that appeared mid-operation, locked files) must
     not surface as 500s. */
  if (error?.code === 'EINVAL' || error?.code === 'ENAMETOOLONG') {
    return new HttpError(400, 'invalid-path', '路径无效或名称过长')
  }
  if (error?.code === 'EEXIST') return new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
  if (error?.code === 'ENOTEMPTY') return new HttpError(409, 'entry-exists', '目录非空，无法完成该操作')
  if (error?.code === 'EBUSY') return new HttpError(409, 'file-conflict', '文件或目录正被占用，请稍后重试')
  return new HttpError(500, 'workspace-operation-failed', '工作区操作失败')
}
