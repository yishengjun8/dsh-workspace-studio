/** Workspace-confined path validation and resolution helpers. */
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { HttpError } from './errors.js'
export function normalizeRelativePath(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-path', '文件路径必须是工作区内的相对路径')
  if (value === '') return ''
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)
    || value.includes('\\') || value.startsWith('/') || isAbsolute(value)
    /* A colon is illegal in Windows file names, and drive-relative forms like
       `C:` / `a:b` resolve surprisingly under path.win32.resolve (C: -> the
       workspace root itself, a:b -> another drive). Reject them on Windows so
       no request can alias the root or probe other drives; POSIX hosts keep
       colons (legal there). */
    || (process.platform === 'win32' && value.includes(':'))) {
    throw new HttpError(400, 'invalid-path', '文件路径必须是工作区内的相对路径')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new HttpError(400, 'invalid-path', '文件路径包含无效段')
  }
  /* Every segment must also satisfy the Windows name rules (trailing dot or
     space, reserved device names): a MIDDLE segment like `foo.` aliases `foo`
     on NTFS (silent path alias) and `CON` reads/writes fail with a raw EINVAL
     that normalizeFailure does not classify. normalizeEntryName only guards
     the final name, so the same rules apply here per segment. */
  for (const part of parts) {
    if (/[. ]$/.test(part)) throw new HttpError(400, 'invalid-path', '路径段不能以点或空格结尾')
    const base = part.split('.')[0].toUpperCase()
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
      throw new HttpError(400, 'invalid-path', '路径段不能使用 Windows 保留名称')
    }
  }
  return parts.join('/')
}
export function isInside(root, target) {
  const tail = relative(root, target)
  return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail))
}
export async function resolveWorkspacePath(root, relativePath) {
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
export function entryPath(parent, name) {
  return parent === '' ? name : `${parent}/${name}`
}

export function parentPath(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}
export function normalizeEntryName(value, maxEntryNameBytes) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-path', '文件名必须是工作区内的单个名称')
  const name = value.trim()
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(name)) {
    throw new HttpError(400, 'invalid-path', '文件名必须是工作区内的单个名称')
  }
  /* Windows refuses names that end in a dot/space or that match its reserved
     device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) even with an extension;
     reject them up front so a create/rename returns a clean 400 instead of a
     raw fs error (500) on Windows hosts. Non-Windows hosts keep the same rule
     for consistency (the names are illegal there too in practice). */
  if (/[. ]$/.test(name)) throw new HttpError(400, 'invalid-path', '文件名不能以点或空格结尾')
  const base = name.split('.')[0].toUpperCase()
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
    throw new HttpError(400, 'invalid-path', '文件名不能使用 Windows 保留名称')
  }
  if (Buffer.byteLength(name, 'utf8') > maxEntryNameBytes) {
    throw new HttpError(413, 'entry-name-too-large', `文件名不能超过 ${maxEntryNameBytes} 字节`)
  }
  return name
}
export async function hasSymlinkComponent(root, relativePath) {
  let current = root
  for (const part of relativePath.split('/')) {
    current = resolve(current, part)
    if ((await lstat(current)).isSymbolicLink()) return true
  }
  return false
}
