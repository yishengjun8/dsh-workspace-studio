/** Workspace write side: save/create/rename/copy/move/delete, serialized. */
import { randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readdir, realpath, rename, rm, rmdir, stat, unlink, utimes } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Buffer } from 'node:buffer'
import { HttpError } from './errors.js'
import { entryPath, hasSymlinkComponent, isInside, normalizeEntryName, normalizeRelativePath, parentPath, resolveWorkspacePath } from './paths.js'
import { containsNul, decodeUtf8, encodeText, hasBom, revisionFor } from './encodings.js'
import { header, readBody, readJsonObject } from './http.js'
import { describeCreatedEntry, openRegularFile, readFileHandleBounded } from './fs.js'
export async function serializeWrite(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  queues.set(key, current)
  try {
    return await current
  } finally {
    if (queues.get(key) === current) queues.delete(key)
  }
}

/** Serialize all workspace mutations through one queue: the coarse
 * workspace-wide lock covers overlapping paths/names unknown until canonical
 * checks run, keeping mutations deterministic and allocation race-free. */
function serializeWorkspaceMutation(queues, workspace, operation) {
  return serializeWrite(queues, `workspace:${String(workspace.id)}`, operation)
}
export async function saveFile(workspace, relativePath, config, queues, req, encodingId = 'utf-8') {
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

  // In-process route: canonical checks run inside the workspace mutation queue
  // so every rename/delete/save observes one serial history.
  return serializeWorkspaceMutation(queues, workspace, async () => {
    const root = await realpath(workspace.path)
    const candidate = resolve(root, ...relativePath.split('/'))
    if (!isInside(root, candidate)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    const target = await realpath(candidate)
    if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    const targetStat = await lstat(candidate)
    /* A symlink at the final component resolves inside the workspace but is
       still a symlink path: report the same 403 the later symlink fence uses,
       not a misleading 400 (the file exists — it is just not a plain file). */
    if (targetStat.isSymbolicLink()) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
    if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '只能保存已存在的普通文件')
    if (targetStat.size > config.maxEditableBytes) throw new HttpError(413, 'file-too-large', '现有文件超过可编辑大小限制')
    /* openRegularFile: O_NONBLOCK + post-open fstat so a FIFO/device swapped
       in after the lstat above can never hang the workspace write queue. */
    const current = await openRegularFile(candidate)
    let currentBytes
    try {
      currentBytes = await readFileHandleBounded(current, config.maxEditableBytes)
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
    let savedMtimeMs
    try {
      tempHandle = await open(temp, 'wx', targetStat.mode & 0o777)
      tempCreated = true
      await tempHandle.chmod(targetStat.mode & 0o777)
      await tempHandle.writeFile(outBytes)
      await tempHandle.sync()
      await tempHandle.close()
      tempHandle = undefined
      if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
      const latest = await openRegularFile(candidate)
      let latestBytes
      try {
        latestBytes = await readFileHandleBounded(latest, config.maxEditableBytes)
      } finally {
        await latest.close()
      }
      if (revisionFor(latestBytes) !== ifMatch) throw new HttpError(409, 'file-conflict', '文件已被修改，请重新加载后再保存')
      // Recheck the directory just before the rename: narrows the symlink-swap
      // window and rejects a parent changed after the temp was created. A
      // directory-handle rename is unavailable in Node's cross-platform API,
      // so this is the final best-effort fence for hostile local writers.
      const finalParent = await realpath(parent)
      if (finalParent !== realParent || !isInside(root, finalParent) || await hasSymlinkComponent(root, relativePath)) {
        throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
      }
      await rename(temp, candidate)
      /* The PUT response carries the written file's stat so the client's
         change-poll baseline can use the REAL mtime: a fabricated 0 baseline
         defeats the Host's sameMtime fast path and forces a full hash on
         every 2 s tick until the next re-read. */
      try {
        savedMtimeMs = (await stat(candidate)).mtimeMs
      } catch {
        savedMtimeMs = undefined
      }
    } finally {
      if (tempHandle !== undefined) await tempHandle.close().catch(() => {})
      if (tempCreated) {
        await unlink(temp).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
      }
    }
    return { workspaceId: String(workspace.id), path: relativePath, revision: revisionFor(outBytes), size: outBytes.byteLength, encoding: encodingId, bom: hasBom(outBytes, encodingId), ...(savedMtimeMs === undefined ? {} : { mtimeMs: savedMtimeMs }) }
  })
}
export async function createEntry(workspace, relativePath, config, queues, req) {
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
export async function renameEntry(workspace, relativePath, config, queues, req) {
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
      /* A target that is the SAME entry as the source (case-only rename on a
         case-insensitive FS like NTFS/APFS) is not a collision: rename in
         place, falling back to a unique-temp-name hop if the FS refuses.
         A genuinely different entry keeps 409. */
      if (sameEntryIdentity(sourceStat, targetCollision)) {
        try {
          await rename(source, target)
        } catch (error) {
          const temp = resolve(parent, `.${randomBytes(8).toString('hex')}.dsh-case.tmp`)
          try {
            await rename(source, temp)
            await rename(temp, target)
          } catch (renameError) {
            /* Best-effort restore of the temp name; a failure here leaves the
               entry under a `.dsh-case.tmp` name — log it instead of burying
               the evidence. */
            await rename(temp, source).catch((rollbackError) => {
              console.warn(`[workspace-studio] case-rename rollback failed for ${source}: ${String(rollbackError)}`)
            })
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
    /* Fast path: the target is verified absent, so a plain rename() is atomic,
       preserves inode/hardlinks, and — unlike the copy fallback — works for
       directories containing symlinks. Fall back to copy+delete only when the
       rename crosses devices (EXDEV); any other failure is a real error. */
    try {
      await rename(source, target)
      return {
        workspaceId: String(workspace.id),
        fromPath: relativePath,
        path: targetPath,
        name,
        kind,
        symlink: false,
      }
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error
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
/** Stable-enough identity: dev/ino on Unix; Windows may report ino=0, where
 * birth time is the best signal without native openat handles. */
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
 * Copy a file or directory tree into a path that must not exist. Files use
 * COPYFILE_EXCL and dirs exclusive mkdir, so an external creator can't be
 * overwritten between probe and commit. Symlinks are omitted only for copy;
 * move/rename reject a tree containing one (deleting the source would lose
 * entries). The root call returns a full source snapshot for the destructive
 * removal; cleanup removes only identities this call made, in reverse order.
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
        /* A non-EEXIST failure (EISDIR/EPERM on a pre-existing DIRECTORY, or a
           mid-copy error) must never enqueue a pre-existing directory for
           cleanup: cleanupCreatedTargets would then rmdir a user-owned folder
           (data loss). copyFile never creates directories, so a directory at
           the target pre-existed and is a collision — dedupe when allowed,
           otherwise a 409. Only a REGULAR file at the target can be a partial
           this call created (COPYFILE_EXCL guarantees any pre-existing file
           would have thrown EEXIST), so that is the only case to track. */
        let partial
        try {
          partial = await lstat(target)
        } catch {
          partial = undefined
        }
        if (partial !== undefined && partial.isDirectory()) {
          if (allowCollision) return false
          throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
        }
        if (partial !== undefined) {
          createdTargets.push({ path: target, stat: partial, directory: false })
        }
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
 * and extension-less names get it at the end (.gitignore-1, dir-1). */
function dedupeName(name, index) {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return `${name.slice(0, dot)}-${index}${name.slice(dot)}`
  return `${name}-${index}`
}

/** Copy or move (cut+paste) one workspace-confined entry. Both use exclusive
 * copy primitives; move is copy-then-delete rather than rename because POSIX
 * rename replaces an existing target. Destination allocation and canonical
 * checks run under the workspace lock. */
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
        /* The copy (or its verification) failed: the created targets were
           cleaned up, so this candidate must NOT be reported as a success —
           rethrow instead of falling through (a move would otherwise delete
           the source while the "destination" no longer exists). */
        await cleanupCreatedTargets(copied.createdTargets, error)
        throw error
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
      /* Final target verification failed (e.g. the copy was swapped for an
         out-of-workspace symlink): the created targets were cleaned up, so the
         source must NOT be deleted — rethrow and abort the whole operation. */
      await cleanupCreatedTargets(chosenCreatedTargets, error)
      throw error
    }

    if (cut) {
      try {
        await removeEntryTreeChecked(source, sourceStat, chosenSnapshot)
      } catch (error) {
        // Keep the completed destination as a recoverable copy: deleting it
        // here could destroy the only intact copy on partial source deletion.
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
    /* Re-verify path components right before the destructive commit (as
       saveFile/copyEntry do): a parent swapped to an out-of-workspace symlink
       since the first check would otherwise let rm delete outside the workspace. */
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝删除符号链接路径')
    await removeEntryTreeChecked(source, sourceStat)
    return { workspaceId: String(workspace.id), path: relativePath, kind: sourceStat.isDirectory() ? 'directory' : 'file' }
  })
}
/** Dispatch the copy/move/delete file operations from the /fs endpoint. */
export async function fsOperation(workspace, config, queues, req) {
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
