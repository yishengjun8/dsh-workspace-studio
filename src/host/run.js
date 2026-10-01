/** Executable-file runner: workspace-confined command plans, a per-file process registry, and
 *  a bounded output buffer the preview column reads back incrementally.
 *
 *  Safety model (the reason this file is deliberately boring):
 *   - only whitelisted extensions (plus POSIX executable-bit files) can be planned at all;
 *   - the command is an argv ARRAY handed to spawn/execFile — there is never a shell, so no
 *     quoting/escaping surface and no injection from the user's argument text;
 *   - the working directory is the file's own directory inside the resolved workspace, and the
 *     target path goes through the same realpath containment fence as every other endpoint;
 *   - the child environment is the Host's minus the DSH_* session/config variables, so a run
 *     script cannot read the harness's own credentials;
 *   - stdin is closed (a non-interactive console; a script that waits on input gets EOF);
 *   - output is capped by a ring buffer, and finished runs are dropped after a keep window.
 */
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { Buffer } from 'node:buffer'
import { basename, delimiter, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import iconv from 'iconv-lite'
import { HttpError } from './errors.js'
import { decodeUtf8 } from './encodings.js'
import { resolveWorkspacePath } from './paths.js'
import { readJsonStrict, writeJsonAtomic } from './drafts.js'
import { quarantineFile } from './quarantine.js'
import { serializeWrite } from './write.js'

/* Bounded output per run: the client polls incrementally, so the cap only bounds Host memory for
   a chatty/noisy script. Past it the OLDEST text is dropped and the client is told about the gap. */
export const RUN_OUTPUT_MAX_BYTES = 256 * 1024
/* How long a finished run keeps its buffer on the Host: long enough that a page refresh (or a tab
   switch) re-attaches to the tail of what just ended, short enough that memory is reclaimed. */
const RUN_SETTLED_KEEP_MS = 10 * 60 * 1000
/* Concurrent live processes across ALL files: a runaway client (or a script that spawns itself)
   must not turn the Host into a fork bomb. */
const RUN_MAX_CONCURRENT = 8
/* SIGTERM → force-kill grace period. Windows goes straight to a forced tree kill. */
const RUN_KILL_GRACE_MS = 1500
/* A child that exits while a process it spawned still holds the stdout/stderr pipes never emits
   'close'. The run must still settle (otherwise the console is stuck on 「正在停止…」/「运行中」
   forever), so 'exit' arms this short drain timer as a deadline for 'close'. */
const RUN_EXIT_DRAIN_MS = 400
/* Windows tree kill: enumerate the descendants ourselves (taskkill /T alone can miss a grandchild
   whose parent already died), retry once, and only then report a failure. */
const RUN_WINDOWS_KILL_RETRY_MS = 1200
const RUN_WINDOWS_QUERY_TIMEOUT_MS = 8000
/* Text handed to one status poll, so a chatty child cannot return a multi-megabyte JSON body.
   The cursor unit is a UTF-16 code unit (JS string index), not a byte — output is decoded at the
   source precisely because a child's encoding is unknown (see RunStreamDecoder). */
const RUN_POLL_SLICE_LENGTH = 48 * 1024
/* Argument text bound (the editable part of the command line). */
const RUN_ARGS_MAX_LENGTH = 4096
const INTERPRETER_PATH_MAX_LENGTH = 4096
/* Per-file interpreter overrides: an explicit user action, but still unbounded input. Past the cap
   the WRITE is refused with an explicit error — silently evicting a setting the user made by hand
   would be worse than a clear "clean some up first". */
export const RUN_FILE_OVERRIDE_MAX = 200
/* A version probe is a one-shot `<path> --version`: bounded time, bounded output, and never a
   registered run (no console entry, no output ring, no tab badge). */
export const RUN_PROBE_TIMEOUT_MS = 5000
export const RUN_PROBE_OUTPUT_MAX = 4096

/* Recipe table: extension → command family. `direct` executes the file itself. */
const RUN_EXTENSION_RECIPES = Object.freeze({
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  bat: 'cmd', cmd: 'cmd',
  exe: 'direct', com: 'direct',
})
/* Families the current platform can execute at all (a .bat needs cmd.exe, a .exe needs Windows). */
const RUN_WINDOWS_ONLY_FAMILIES = new Set(['cmd', 'direct'])
export const RUN_FAMILIES = Object.freeze(['python', 'shell', 'powershell', 'cmd', 'direct'])
/* The runnable extensions in recipe order. The settings page renders exactly one row per entry, and
   the policy accepts nothing else: an extension without a recipe could never resolve into a plan. */
export const RUN_RUNNABLE_EXTENSIONS = Object.freeze(Object.keys(RUN_EXTENSION_RECIPES))

const POLICY_SUB_DIR = 'run'
const POLICY_FILE = 'policy.json'

function policyPath() {
  return join(homedir(), '.dsh-plugin', 'dsh-workspace-studio', POLICY_SUB_DIR, POLICY_FILE)
}

/** The command family of one file name, or null when the file is not runnable by extension. */
export function runFamilyOf(name) {
  const lower = String(name ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  return RUN_EXTENSION_RECIPES[lower.slice(dot + 1)] ?? null
}

/** Whether a file may get a run plan at all: a whitelisted extension, or (POSIX) an executable bit. */
export function isRunnableName(name) {
  return runFamilyOf(name) !== null
}

/* ---- interpreter lookup (a PATH search, never a probe process) ---- */

export async function isExecutableFile(target) {
  try {
    const info = await stat(target)
    if (!info.isFile()) return false
    /* A zero-byte "executable" is an app-execution-alias stub (the Microsoft Store python.exe /
       python3.exe placeholders are exactly that): running it prints an advert instead of running
       the script, so it must never win a candidate search. */
    if (info.size === 0) return false
    /* Windows has no executable bit: existence (plus a PATHEXT match) is the whole test there. */
    if (process.platform !== 'win32') await access(target, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function pathCandidates(name, env) {
  const windows = process.platform === 'win32'
  const extensions = windows
    ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(part => part !== '')
    : ['']
  const directories = String(env.PATH ?? env.Path ?? '').split(delimiter).filter(part => part !== '')
  const out = []
  for (const directory of directories) {
    for (const extension of extensions) out.push(join(directory, `${name}${windows ? extension : ''}`))
  }
  return out
}

/* Resolved interpreter locations, cached for the Host's lifetime: a PATH search per plan request
   would stat dozens of directories on every preview open. Cleared when the user re-detects. */
const executableCache = new Map()

/** Resolve one executable name against PATH (an absolute path is checked directly). */
export async function whichExecutable(name, env = process.env) {
  if (typeof name !== 'string' || name === '') return null
  if (name.includes('/') || name.includes('\\')) {
    return (await isExecutableFile(name)) ? name : null
  }
  const cacheKey = `${process.platform}:${name}`
  if (executableCache.has(cacheKey)) return executableCache.get(cacheKey)
  let found = null
  for (const candidate of pathCandidates(name, env)) {
    if (await isExecutableFile(candidate)) { found = candidate; break }
  }
  executableCache.set(cacheKey, found)
  return found
}

export function clearExecutableCache() {
  executableCache.clear()
}

/* ---- Windows shell resolution: Git Bash, never the WSL launcher ---- */

/** A directory under the Windows installation (used to recognise the WSL launcher). */
function windowsSystem32(name, env = process.env) {
  const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows'
  return join(root, 'System32', name)
}

/* Windows ships a WSL launcher at %SystemRoot%\System32\bash.exe even when no distribution is
   installed, and it is on PATH before any real bash. It is unusable here twice over: with no distro
   it prints an "install a distribution" wall of text, and even with one it cannot take the arguments
   this plugin passes (the file and cwd are Windows paths, which WSL reads as literal backslash
   names). It is therefore never a candidate; `.sh` on Windows means Git Bash (or the user's own
   interpreter override), and the "cannot run" card says so. */
const WSL_LAUNCHERS = new Set(['bash.exe', 'wsl.exe', 'bash', 'wsl'])

export function isWslLauncherPath(target, env = process.env) {
  if (process.platform !== 'win32' || typeof target !== 'string') return false
  const normalized = target.toLowerCase()
  for (const name of WSL_LAUNCHERS) {
    if (normalized === windowsSystem32(name, env).toLowerCase()) return true
  }
  return false
}

/** Git for Windows' bash, in the order the installer uses (machine-wide first, then per-user). */
function gitBashPaths(name, env = process.env) {
  const roots = [
    env.ProgramFiles === undefined ? undefined : join(env.ProgramFiles, 'Git'),
    env['ProgramFiles(x86)'] === undefined ? undefined : join(env['ProgramFiles(x86)'], 'Git'),
    env.LOCALAPPDATA === undefined ? undefined : join(env.LOCALAPPDATA, 'Programs', 'Git'),
  ].filter(root => root !== undefined)
  return roots.map(root => join(root, 'bin', `${name}.exe`))
}

/* ---- per-family command recipes ---- */

function powershellFlags() {
  return process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']
    : ['-NoProfile', '-NonInteractive', '-File']
}

/** The interpreter candidates for a family, in preference order.
 *  Each entry is { name (shown in the console), flags, paths? } — `paths` lists absolute install
 *  locations tried BEFORE the PATH search, which is how Git Bash wins over a WSL launcher. */
export function interpreterCandidatesFor(family, extension, env = process.env) {
  switch (family) {
    case 'python':
      return process.platform === 'win32'
        ? [{ name: 'py', flags: ['-3'] }, { name: 'python', flags: [] }]
        : [{ name: 'python3', flags: [] }, { name: 'python', flags: [] }]
    case 'shell': {
      const preferred = extension === 'zsh' ? 'zsh' : 'bash'
      if (process.platform !== 'win32') return [{ name: preferred, flags: [] }, { name: 'sh', flags: [] }]
      if (extension === 'zsh') return [{ name: 'zsh', flags: [] }]
      return [
        { name: 'bash', flags: [], paths: gitBashPaths('bash', env) },
        { name: 'sh', flags: [], paths: gitBashPaths('sh', env) },
      ]
    }
    case 'powershell':
      return process.platform === 'win32'
        ? [{ name: 'powershell', flags: powershellFlags() }, { name: 'pwsh', flags: powershellFlags() }]
        : [{ name: 'pwsh', flags: powershellFlags() }]
    case 'cmd':
      return process.platform === 'win32' ? [{ name: 'cmd', flags: ['/c'] }] : []
    default:
      return []
  }
}

/** A plain JSON object (never an array, never null): every policy map goes through this test. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Whether a string is an absolute path on this platform's rules (drive letter, POSIX root, UNC). */
function isAbsolutePathString(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')
}

/** The file name of an interpreter path: overrides are DISPLAYED by their basename (the console
 *  keeps the full path in its tooltip), so the chip stays short however deeply nested the path is. */
function basenameOf(target) {
  const base = basename(String(target ?? ''))
  return base === '' ? String(target ?? '') : base
}

/** The flags an OVERRIDE path needs, judged by that path rather than by the recipe's first candidate.
 *
 *  This is a correctness fix, not a nicety: `-3` is the `py` launcher's own flag, and inheriting the
 *  family's first-candidate flags would build `python.exe -3 script.py`, which CPython rejects with
 *  "Unknown option: -3" — i.e. pointing `.py` at a real python.exe would break the run. */
export function flagsForOverride(family, overridePath, env = process.env) {
  if (family === 'python') {
    const base = basenameOf(overridePath).toLowerCase()
    return process.platform === 'win32' && /^pyw?(\.exe)?$/.test(base) ? ['-3'] : []
  }
  return interpreterCandidatesFor(family, '', env)[0]?.flags ?? []
}

/** The argv that asks one family's interpreter for its version, or null when probing is not allowed.
 *  `direct` has no entry on purpose: probing an .exe/.com would RUN the user's own program, which a
 *  settings button must never do. */
export function probeArgsFor(family) {
  switch (family) {
    case 'python':
      return ['-V']
    case 'shell':
      return ['--version']
    case 'powershell':
      /* `--version` only exists on pwsh; Windows PowerShell 5.1 needs an expression instead. */
      return process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']
        : ['-NoProfile', '-NonInteractive', '--version']
    case 'cmd':
      return ['/c', 'ver']
    default:
      return null
  }
}

/** Resolve one candidate to an absolute executable path, or null.
 *  Absolute install locations win first; a PATH hit is rejected when it is the WSL launcher. */
export async function resolveInterpreterCandidate(candidate, env = process.env) {
  for (const path of candidate.paths ?? []) {
    if (await isExecutableFile(path)) return path
  }
  const found = await whichExecutable(candidate.name, env)
  if (found === null || isWslLauncherPath(found, env)) return null
  return found
}

/* Why an interpreter could not be found, in the user's words — the console's amber card shows this
   as the "tried" line, so it has to be actionable rather than a bare candidate list. */
function missingInterpreterMessage(family, names, extension) {
  const tried = names.join(', ')
  /* Git for Windows ships bash but not zsh, so the "install Git for Windows" advice is only right
     for the bash family. */
  if (family === 'shell' && process.platform === 'win32' && extension !== 'zsh') {
    return `未找到可用的 bash（已尝试：${tried}）。Windows 自带的 bash.exe 是 WSL 启动器，不能直接运行 Windows 路径；请安装 Git for Windows，或在控制台里指定 bash 的绝对路径（如 C:\\Program Files\\Git\\bin\\bash.exe）。`
  }
  if (family === 'shell') return `未找到可用的 shell（已尝试：${tried}）。若确实需要 zsh，请安装后在控制台里指定它的绝对路径。`
  if (family === 'python') return `未找到 Python 解释器（已尝试：${tried}）。安装 Python 后点「重新检测」，或指定解释器的绝对路径。`
  if (family === 'powershell') return `未找到 PowerShell（已尝试：${tried}）。安装 PowerShell 7 后重试，或指定绝对路径。`
  if (family === 'cmd') return `未找到 cmd.exe（已尝试：${tried}）。`
  return `未找到可用的解释器（已尝试：${tried}）。`
}

/* ---- run policy (confirmation opt-out + interpreter overrides), stored Host-side so both ends share it ---- */

/* A stored interpreter value: a bounded absolute path with no control characters. */
function isPolicyInterpreter(value) {
  return typeof value === 'string' && value !== '' && value.length <= INTERPRETER_PATH_MAX_LENGTH
    && isAbsolutePathString(value)
    && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
}

/* A stored per-file key: the file's own absolute path, bounded like an interpreter path. */
function isPolicyPathKey(value) {
  return typeof value === 'string' && value !== '' && value.length <= INTERPRETER_PATH_MAX_LENGTH
    && isAbsolutePathString(value)
    && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
}

function normalizePolicy(value) {
  const trusted = {}
  const extensions = {}
  const files = {}
  const rawTrusted = value?.trusted
  if (isPlainObject(rawTrusted)) {
    for (const [workspaceId, flag] of Object.entries(rawTrusted)) {
      if (flag === true) trusted[String(workspaceId)] = true
    }
  }
  /* Global per-extension overrides: keys outside the recipe table could never resolve a plan, so a
     hand-edited or stale key is dropped on read instead of being served back as a setting. */
  const rawExtensions = value?.extensions
  if (isPlainObject(rawExtensions)) {
    for (const [extension, candidate] of Object.entries(rawExtensions)) {
      const key = extension.toLowerCase()
      if (!Object.hasOwn(RUN_EXTENSION_RECIPES, key)) continue
      if (isPolicyInterpreter(candidate)) extensions[key] = candidate
    }
  }
  const rawFiles = value?.files
  if (isPlainObject(rawFiles)) {
    let kept = 0
    for (const [key, candidate] of Object.entries(rawFiles)) {
      if (kept >= RUN_FILE_OVERRIDE_MAX) break
      if (!isPolicyPathKey(key) || !isPolicyInterpreter(candidate)) continue
      files[key] = candidate
      kept += 1
    }
  }
  /* Everything the current schema does not name is dropped, which is how the retired
     per-family `interpreters` map disappears: it is never read back as a tier. */
  return { trusted, extensions, files }
}

export async function readRunPolicyStore() {
  const path = policyPath()
  const read = await readJsonStrict(path)
  if (read.status === 'missing') return normalizePolicy(undefined)
  if (read.status !== 'ok') {
    /* Present but unparseable: quarantine it and fall back to the defaults (nothing trusted, no
       interpreter overrides). */
    await quarantineFile(path, 'unreadable run policy')
    return normalizePolicy(undefined)
  }
  return normalizePolicy(read.value)
}

export async function readRunPolicy(workspaceId) {
  const policy = await readRunPolicyStore()
  return {
    workspaceId: String(workspaceId),
    trusted: policy.trusted[String(workspaceId)] === true,
    extensions: policy.extensions,
    files: policy.files,
  }
}

function validateInterpreterPath(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-interpreter', '解释器路径必须是字符串')
  if (value === '') return ''
  if (value.length > INTERPRETER_PATH_MAX_LENGTH || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-interpreter', '解释器路径无效')
  }
  if (!isAbsolutePathString(value)) throw new HttpError(400, 'invalid-interpreter', '解释器路径必须是绝对路径')
  return value
}

/** Validate one override that is about to be STORED: shape first, then the fact that it can actually
 *  run. A stored path that does not exist would silently fall back to auto-detection at run time —
 *  exactly the confusion this feature exists to remove — so an unusable path is refused with the
 *  reason the user needs, and the dialog keeps the typed value in place for editing. */
async function validateInterpreterOverride(value) {
  const target = validateInterpreterPath(value)
  if (target === '') return ''
  if (!await isExecutableFile(target)) {
    throw new HttpError(400, 'invalid-interpreter', `解释器路径不存在或不可执行：${target}`)
  }
  return target
}

/** The per-file override of one resolved file path, or null.
 *
 *  Lookup is exact first, then (Windows only) case-insensitive: the same file can be addressed with a
 *  different drive/directory case depending on how the workspace was opened, and a silent miss would
 *  look exactly like a lost setting. The map is capped at RUN_FILE_OVERRIDE_MAX, so the fallback scan
 *  is cheap by construction. */
export function lookupFileOverride(files, target) {
  if (!isPlainObject(files) || typeof target !== 'string' || target === '') return null
  const exact = files[target]
  if (typeof exact === 'string' && exact !== '') return exact
  if (process.platform !== 'win32') return null
  const wanted = target.toLowerCase()
  for (const [key, value] of Object.entries(files)) {
    if (key.toLowerCase() === wanted && typeof value === 'string' && value !== '') return value
  }
  return null
}

/** Update the run policy: the per-workspace confirmation opt-out, the global per-extension map and
 *  the per-file overrides. Every path is validated (existing + executable) before anything is
 *  written, and the per-file map is capped with an explicit error instead of silently evicting a
 *  setting the user made by hand. The whole policy is rewritten from the normalized value, so a
 *  field this schema does not name (the retired per-family `interpreters` map) is dropped here. */
export async function writeRunPolicy(workspaceId, payload, queues) {
  const trustedPatch = payload?.trusted
  if (trustedPatch !== undefined && typeof trustedPatch !== 'boolean') {
    throw new HttpError(400, 'invalid-run-policy', 'trusted 必须是布尔值')
  }
  /* Only the confirmation opt-out is workspace-scoped, so it is the only field that needs one. */
  if (trustedPatch !== undefined && String(workspaceId ?? '') === '') {
    throw new HttpError(400, 'invalid-run-policy', '更新工作区信任状态必须提供 workspaceId')
  }
  let extensionPatch
  if (payload?.extensions !== undefined) {
    if (!isPlainObject(payload.extensions)) {
      throw new HttpError(400, 'invalid-run-policy', 'extensions 必须是对象')
    }
    extensionPatch = {}
    for (const [extension, value] of Object.entries(payload.extensions)) {
      const key = String(extension).toLowerCase()
      if (!Object.hasOwn(RUN_EXTENSION_RECIPES, key)) {
        throw new HttpError(400, 'invalid-run-policy', `未知的后缀 .${key}`)
      }
      extensionPatch[key] = await validateInterpreterOverride(value)
    }
  }
  let filePatch
  if (payload?.files !== undefined) {
    if (!isPlainObject(payload.files)) {
      throw new HttpError(400, 'invalid-run-policy', 'files 必须是对象')
    }
    filePatch = {}
    for (const [key, value] of Object.entries(payload.files)) {
      if (!isPolicyPathKey(key)) throw new HttpError(400, 'invalid-run-policy', '文件级解释器设置的文件路径无效')
      filePatch[key] = await validateInterpreterOverride(value)
    }
  }
  if (trustedPatch === undefined && extensionPatch === undefined && filePatch === undefined) {
    throw new HttpError(400, 'invalid-run-policy', '没有要更新的运行设置')
  }
  const policy = await serializeWrite(queues, 'run:policy', async () => {
    /* readRunPolicyStore returns the NORMALIZED policy, so writing it back also drops every field
       this schema does not name (notably the retired per-family `interpreters` map). */
    const current = await readRunPolicyStore()
    if (trustedPatch !== undefined) {
      const key = String(workspaceId)
      if (trustedPatch) current.trusted[key] = true
      else delete current.trusted[key]
    }
    if (extensionPatch !== undefined) {
      for (const [extension, value] of Object.entries(extensionPatch)) {
        if (value === '') delete current.extensions[extension]
        else current.extensions[extension] = value
      }
    }
    if (filePatch !== undefined) {
      const next = { ...current.files }
      for (const [key, value] of Object.entries(filePatch)) {
        if (value === '') delete next[key]
        else next[key] = value
      }
      if (Object.keys(next).length > RUN_FILE_OVERRIDE_MAX) {
        throw new HttpError(400, 'run-policy-limit', `文件级解释器设置最多 ${RUN_FILE_OVERRIDE_MAX} 条，请先在设置中清理`)
      }
      current.files = next
    }
    await writeJsonAtomic(policyPath(), current)
    return current
  })
  /* A user who just pointed at a new interpreter (or installed one before retrying) must not be
     answered from a stale PATH-search cache. */
  clearExecutableCache()
  return {
    workspaceId: String(workspaceId),
    trusted: policy.trusted[String(workspaceId)] === true,
    extensions: policy.extensions,
    files: policy.files,
  }
}

/* ---- argument tokenizer (the editable tail of the command line) ---- */

/** Split user argument text into argv tokens: whitespace-separated, with "…" / '…' quoting.
 *  No shell ever sees the result, so this only has to be predictable, not POSIX-complete. */
export function splitRunArgs(text) {
  const source = String(text ?? '')
  if (source.length > RUN_ARGS_MAX_LENGTH) {
    throw new HttpError(413, 'run-args-too-long', `运行参数不能超过 ${RUN_ARGS_MAX_LENGTH} 个字符`)
  }
  const tokens = []
  let current = ''
  let quoted = null
  let started = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted !== null) {
      if (character === quoted) { quoted = null; continue }
      if (character === '\\' && quoted === '"' && source[index + 1] === '"') { current += '"'; index += 1; continue }
      current += character
      continue
    }
    if (character === '"' || character === "'") { quoted = character; started = true; continue }
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      if (started || current !== '') { tokens.push(current); current = ''; started = false }
      continue
    }
    current += character
  }
  if (quoted !== null) throw new HttpError(400, 'invalid-run-args', '运行参数中的引号没有闭合')
  if (started || current !== '') tokens.push(current)
  return tokens
}

/** Render argv for display: quote only the tokens that would otherwise read as several. */
export function displayCommand(parts) {
  return parts.map((part) => (part === '' || /[\s"']/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(' ')
}

/* ---- command plan: what WOULD run, resolved without executing anything ---- */

/** Build the run plan of one workspace file: the resolved interpreter, argv, cwd and the reason it
 *  cannot run when it cannot. Pure resolution — no process is started and the file is not read. */
export async function buildRunPlan(workspace, relativePath, options = {}) {
  const root = workspace.path
  const target = await resolveWorkspacePath(root, relativePath)
  const info = await stat(target)
  if (!info.isFile()) throw new HttpError(400, 'not-a-file', '所选路径不是普通文件')
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const extension = dot < 0 ? '' : lower.slice(dot + 1)
  const family = runFamilyOf(name)
  const cwd = dirname(target)
  const cwdRelative = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
  const base = {
    name,
    path: relativePath,
    kind: family ?? 'none',
    extension,
    cwd,
    cwdRelative,
    runnable: family !== null,
    supported: false,
    reason: null,
    message: '',
    interpreter: null,
    interpreterName: null,
    interpreterOverride: false,
    /* Where the resolved interpreter came from ('file' | 'extension' | 'family' | 'auto' | 'direct'),
       which path an override requested, and the highest-priority tier that was skipped because its
       path is no longer executable. `fileKey` is this file's own policy key (its absolute path). */
    interpreterSource: null,
    interpreterRequested: null,
    interpreterStaleScope: null,
    interpreterStalePath: null,
    fileKey: target,
    candidates: [],
    flags: [],
    args: [],
    command: '',
    hint: null,
  }
  if (family === null) {
    return { ...base, reason: 'not-runnable', message: '该文件不在可运行白名单内' }
  }
  if (RUN_WINDOWS_ONLY_FAMILIES.has(family) && process.platform !== 'win32') {
    return { ...base, reason: 'unsupported-platform', message: `当前系统无法运行 .${extension} 文件` }
  }
  /* Direct execution: on POSIX the file needs its executable bit (Windows has no such notion). */
  if (family === 'direct') {
    const executable = process.platform === 'win32' ? true : (info.mode & 0o111) !== 0
    if (!executable) {
      return { ...base, reason: 'not-executable', message: '该文件没有可执行权限' }
    }
    /* Direct execution has no interpreter to override: the file itself is the command. */
    return { ...base, supported: true, interpreter: target, interpreterName: name, interpreterSource: 'direct', args: [target], command: displayCommand([name]) }
  }
  const env = options.env ?? process.env
  const candidates = interpreterCandidatesFor(family, extension, env)
  /* Resolution chain, most specific first: THIS FILE → this extension → auto-detection. A tier is used only while its path is still an executable file; a tier
     that no longer resolves is SKIPPED (never fatal) and the highest one that fell through is
     reported, so the console says which setting stopped working instead of silently ignoring it. */
  const tiers = [
    { scope: 'file', value: lookupFileOverride(options.files, target) },
    { scope: 'extension', value: options.extensions?.[extension] },
  ]
  let resolved = null
  /* The name shown in the console ("py -3 main.py" / "python3 main.py"): auto-detection keeps the
     recipe's short name, an override shows its path's basename. The absolute path stays internal
     (the console's tooltip carries it), so a deep install path never widens the command line. */
  let resolvedName = null
  let flags = []
  let source = 'auto'
  let requested = null
  let staleScope = null
  let stalePath = null
  for (const tier of tiers) {
    if (typeof tier.value !== 'string' || tier.value === '') continue
    if (await isExecutableFile(tier.value)) {
      resolved = tier.value
      resolvedName = basenameOf(tier.value)
      flags = flagsForOverride(family, tier.value, env)
      source = tier.scope
      requested = tier.value
      break
    }
    if (staleScope === null) { staleScope = tier.scope; stalePath = tier.value }
  }
  if (resolved === null) {
    for (const candidate of candidates) {
      const found = await resolveInterpreterCandidate(candidate, env)
      if (found !== null) { resolved = found; resolvedName = candidate.name; flags = candidate.flags; break }
    }
  }
  if (resolved === null) {
    const windowsShell = family === 'shell' && process.platform === 'win32' && extension !== 'zsh'
    return {
      ...base,
      candidates: candidates.map(candidate => candidate.name),
      reason: 'missing-interpreter',
      /* A structured hint, not just prose: the console localizes it (the Host's own message would
         otherwise arrive as Chinese text in an English UI). */
      hint: windowsShell ? 'shell-windows' : 'generic',
      message: missingInterpreterMessage(family, candidates.map(candidate => candidate.name), extension),
      interpreterStaleScope: staleScope,
      interpreterStalePath: stalePath,
    }
  }
  const args = [...flags, target]
  return {
    ...base,
    supported: true,
    interpreter: resolved,
    interpreterName: resolvedName,
    interpreterOverride: source !== 'auto',
    interpreterSource: source,
    interpreterRequested: requested,
    interpreterStaleScope: staleScope,
    interpreterStalePath: stalePath,
    candidates: candidates.map(candidate => candidate.name),
    flags,
    /* The displayed command uses the SHORT interpreter name and the workspace-relative file path:
       the argv above carries the absolute forms, and the console should read like the docs do. */
    args,
    command: displayCommand([resolvedName, ...flags, name]),
  }
}

/** The settings page's per-extension table: what each runnable extension resolves to right now,
 *  without needing a file. Mirrors buildRunPlan's interpreter step (extension →
 *  auto-detection) so the page and the console can never disagree. */
export async function describeRunExtensions(options = {}) {
  const env = options.env ?? process.env
  const rows = []
  for (const extension of RUN_RUNNABLE_EXTENSIONS) {
    const family = RUN_EXTENSION_RECIPES[extension]
    const candidates = family === 'direct' ? [] : interpreterCandidatesFor(family, extension, env)
    const row = {
      ext: extension,
      family,
      supported: false,
      source: null,
      interpreter: null,
      interpreterName: null,
      override: null,
      stale: false,
      candidates: candidates.map(candidate => candidate.name),
      reason: null,
      hint: null,
    }
    if (RUN_WINDOWS_ONLY_FAMILIES.has(family) && process.platform !== 'win32') {
      rows.push({ ...row, reason: 'unsupported-platform' })
      continue
    }
    if (family === 'direct') {
      rows.push({ ...row, supported: true, source: 'direct' })
      continue
    }
    let override = null
    let stale = false
    let staleOverride = null
    const extensionOverride = options.extensions?.[extension]
    if (typeof extensionOverride === 'string' && extensionOverride !== '') {
      if (await isExecutableFile(extensionOverride)) override = { path: extensionOverride, source: 'extension' }
      else { stale = true; staleOverride = extensionOverride }
    }
    if (override !== null) {
      rows.push({
        ...row,
        supported: true,
        source: override.source,
        interpreter: override.path,
        interpreterName: basenameOf(override.path),
        override: override.path,
        stale,
      })
      continue
    }
    let found = null
    for (const candidate of candidates) {
      const hit = await resolveInterpreterCandidate(candidate, env)
      if (hit !== null) { found = { path: hit, name: candidate.name }; break }
    }
    if (found === null) {
      const windowsShell = family === 'shell' && process.platform === 'win32' && extension !== 'zsh'
      rows.push({
        ...row,
        reason: 'missing-interpreter',
        hint: windowsShell ? 'shell-windows' : 'generic',
        override: staleOverride,
        stale,
      })
      continue
    }
    rows.push({
      ...row,
      supported: true,
      source: 'auto',
      interpreter: found.path,
      interpreterName: found.name,
      override: staleOverride,
      stale,
    })
  }
  return { platform: process.platform, extensions: rows }
}

/** One-shot version probe: `<path> --version` in the family's own spelling, with bounded time and
 *  bounded output, no shell, no argument text from the user, and NO registry entry (nothing to show
 *  in the console, nothing to stop). `direct` is refused: probing an .exe would run the user's own
 *  program, which a settings button must never do. */
export async function probeInterpreter(path, family, options = {}) {
  const target = validateInterpreterPath(path)
  if (target === '') throw new HttpError(400, 'invalid-interpreter', '解释器路径不能为空')
  const args = probeArgsFor(family)
  if (args === null) {
    throw new HttpError(400, 'invalid-interpreter-family', '该类别不支持版本探测（可执行文件会被直接运行）')
  }
  if (!await isExecutableFile(target)) {
    throw new HttpError(400, 'invalid-interpreter', `解释器路径不存在或不可执行：${target}`)
  }
  const startedAt = Date.now()
  return await new Promise((resolveProbe) => {
    let output = ''
    let settled = false
    const decoders = { stdout: new RunStreamDecoder(), stderr: new RunStreamDecoder() }
    const append = (text) => {
      if (text === '' || output.length >= RUN_PROBE_OUTPUT_MAX) return
      output = (output + text).slice(0, RUN_PROBE_OUTPUT_MAX)
    }
    let timer = null
    const finish = (patch) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolveProbe({
        path: target,
        family,
        ok: patch.ok === true,
        exitCode: patch.exitCode ?? null,
        signal: patch.signal ?? null,
        timedOut: patch.timedOut === true,
        output: output.trim(),
        durationMs: Date.now() - startedAt,
        errorCode: patch.errorCode ?? null,
        errorMessage: patch.errorMessage ?? null,
      })
    }
    let child
    try {
      child = spawn(target, args, {
        cwd: homedir(),
        env: childEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        /* Own process group on POSIX so the timeout can take down the whole tree, like a run. */
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish({ ok: false, errorCode: 'spawn-failed', errorMessage: String(error?.message ?? error) })
      return
    }
    timer = setTimeout(() => {
      forceKill({ child })
      finish({ ok: false, timedOut: true, errorCode: 'probe-timeout', errorMessage: `探测超时（${RUN_PROBE_TIMEOUT_MS}ms）` })
    }, RUN_PROBE_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()
    child.stdout?.on('data', (data) => append(decoders.stdout.push(Buffer.from(data))))
    child.stderr?.on('data', (data) => append(decoders.stderr.push(Buffer.from(data))))
    child.on('error', (error) => finish({
      ok: false,
      errorCode: error?.code === 'ENOENT' ? 'interpreter-not-found' : 'spawn-failed',
      errorMessage: String(error?.message ?? error),
    }))
    child.on('close', (code, signal) => {
      append(decoders.stdout.flush())
      append(decoders.stderr.flush())
      finish({
        ok: code === 0 && signal === null,
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal === null ? null : String(signal),
      })
    })
  })
}

/* ---- process registry ---- */

const runsById = new Map()
const runsByKey = new Map()

function keyOf(workspace, relativePath) {
  return `${String(workspace.id)}:${relativePath}`
}

function liveRunCount() {
  let count = 0
  for (const entry of runsById.values()) if (entry.status === 'running') count += 1
  return count
}

/** The child environment: the Host's own, minus the harness's DSH_* session/config variables. */
function childEnvironment() {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('DSH_')) delete env[name]
  }
  return env
}

/* ---- child-output decoding ----
 * A child's bytes arrive with no declared encoding and are NOT reliably UTF-8 on Windows: the WSL
 * launcher (bash.exe / wsl.exe) answers in UTF-16LE with no BOM, PowerShell 5.1 writes UTF-16LE to a
 * redirected pipe, and cmd-hosted tools print in the OEM/ANSI codepage (GBK on a Chinese system).
 * Decoding everything as UTF-8 renders a wall of U+FFFD, so each stream gets its own decoder: a BOM
 * or NUL-heavy bytes lock UTF-16, otherwise valid UTF-8 is kept, and anything else falls back to the
 * locale's legacy codepage through iconv-lite (the same encoding family the file preview ships). */
const OUTPUT_CODEPAGE_BY_LOCALE = Object.freeze([
  [/^(zh|yue)/, 'gb18030'],
  [/^ja/, 'shift_jis'],
  [/^ko/, 'euc-kr'],
  [/^(ru|uk|bg|sr|mk)/, 'windows-1251'],
])
const MULTIBYTE_LEGACY_CODEPAGES = new Set(['gb18030', 'shift_jis', 'euc-kr'])
function legacyOutputCodepage() {
  let locale = ''
  try { locale = String(Intl.DateTimeFormat().resolvedOptions().locale ?? '') } catch { locale = '' }
  const lower = locale.toLowerCase()
  for (const [pattern, codepage] of OUTPUT_CODEPAGE_BY_LOCALE) if (pattern.test(lower)) return codepage
  return 'windows-1252'
}
const OUTPUT_CODEPAGE = legacyOutputCodepage()

/** Bytes of `buffer` that end on a complete UTF-8 sequence boundary (a multi-byte character must
 *  never be split, or every chunk boundary would render as U+FFFD in the console). */
export function utf8SafeLength(buffer) {
  let index = buffer.length - 1
  let continuations = 0
  while (index >= 0 && continuations < 3) {
    const byte = buffer[index]
    if ((byte & 0xc0) === 0x80) { index -= 1; continuations += 1; continue }
    const needed = (byte & 0x80) === 0 ? 1 : (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 1
    const available = buffer.length - index
    return available >= needed ? buffer.length : index
  }
  return buffer.length
}

/** The encoding a stream's first bytes reveal: a BOM, UTF-16 without a BOM, or nothing yet.
 *  `skip` is the BOM length to consume.
 *
 *  The no-BOM UTF-16 case is decided by NUL bytes: a console message never contains one, so even a
 *  single NUL — let alone an ASCII run interleaved with them — is proof. The sample must be wide
 *  (1 KB, not the first few bytes), because a CJK message begins with many NUL-free characters
 *  (a Chinese WSL error message starts with 16 CJK chars before the first NUL byte). */
export function detectStreamEncoding(pending) {
  if (pending.length >= 2 && pending[0] === 0xff && pending[1] === 0xfe) return { encoding: 'utf16le', skip: 2 }
  if (pending.length >= 2 && pending[0] === 0xfe && pending[1] === 0xff) return { encoding: 'utf16be', skip: 2 }
  if (pending.length >= 3 && pending[0] === 0xef && pending[1] === 0xbb && pending[2] === 0xbf) return { encoding: 'utf8', skip: 3 }
  const sample = Math.min(pending.length, 1024)
  let leadNuls = 0
  let trailNuls = 0
  for (let index = 0; index < sample; index += 1) {
    if (pending[index] !== 0) continue
    /* LE interleaves NULs after ASCII (odd index); BE before it (even index). */
    if (index % 2 === 0) trailNuls += 1
    else leadNuls += 1
  }
  if (leadNuls > 0 || trailNuls > 0) return { encoding: leadNuls >= trailNuls ? 'utf16le' : 'utf16be', skip: 0 }
  return null
}

/** One child stream's decoder: stateful because chunks (and characters) split anywhere. */
export class RunStreamDecoder {
  constructor(codepage = OUTPUT_CODEPAGE) {
    this.codepage = codepage
    this.pending = Buffer.alloc(0)
    this.locked = null
  }

  push(chunk) {
    if (chunk.length === 0) return ''
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    if (this.locked === null) {
      const detected = detectStreamEncoding(this.pending)
      if (detected !== null) {
        this.locked = detected.encoding
        if (detected.skip > 0) this.pending = this.pending.subarray(detected.skip)
      }
    }
    /* Undecidable prefix (not UTF-8, no BOM, no NUL yet — for example the two bytes of a CJK
       character that opens a UTF-16 stream): wait for more bytes instead of committing to a
       codepage guess that would emit one replacement character at the start of the output. */
    if (this.locked === null && this.pending.length < 64 && decodeUtf8(this.pending, true) === undefined) {
      return ''
    }
    if (this.locked === 'utf16le' || this.locked === 'utf16be') {
      const even = this.pending.length - (this.pending.length % 2)
      const slice = this.pending.subarray(0, even)
      this.pending = this.pending.subarray(even)
      /* Node only decodes LE natively; BE goes through iconv-lite. */
      return this.locked === 'utf16le' ? slice.toString('utf16le') : iconv.decode(slice, 'utf16-be')
    }
    const safe = utf8SafeLength(this.pending)
    const slice = this.pending.subarray(0, safe)
    const text = decodeUtf8(slice, false)
    if (text !== undefined) {
      this.pending = this.pending.subarray(slice.length)
      /* ASCII stays unlocked: a later non-UTF-8 chunk must still be detectable. */
      if (this.locked === null && !isAsciiOnly(slice)) this.locked = 'utf8'
      return text
    }
    /* Not UTF-8: hand the pending buffer to the legacy codepage, holding back a byte that may be the
       lead half of a double-byte character. */
    const hold = MULTIBYTE_LEGACY_CODEPAGES.has(this.codepage) && this.pending[this.pending.length - 1] >= 0x81 ? 1 : 0
    const body = this.pending.subarray(0, this.pending.length - hold)
    this.pending = hold === 0 ? Buffer.alloc(0) : this.pending.subarray(this.pending.length - 1)
    return body.length === 0 ? '' : iconv.decode(body, this.codepage)
  }

  /** Whatever is still held back (an incomplete sequence) when the process ends. */
  flush() {
    if (this.pending.length === 0) return ''
    const rest = this.pending
    this.pending = Buffer.alloc(0)
    if (this.locked === 'utf16le') return rest.toString('utf16le')
    if (this.locked === 'utf16be') return iconv.decode(rest, 'utf16-be')
    if (this.locked === 'utf8') return rest.toString('utf8')
    return iconv.decode(rest, this.codepage)
  }
}

function isAsciiOnly(buffer) {
  for (const byte of buffer) if (byte >= 0x80) return false
  return true
}

/** Append already-decoded text to the run's output ring, dropping the oldest chunks past the cap. */
function appendOutput(entry, stream, text) {
  if (text === '') return
  const bytes = Buffer.byteLength(text, 'utf8')
  entry.chunks.push({ stream, text, bytes })
  entry.bufferedBytes += bytes
  entry.totalLength += text.length
  while (entry.bufferedBytes > RUN_OUTPUT_MAX_BYTES && entry.chunks.length > 1) {
    const dropped = entry.chunks.shift()
    entry.bufferedBytes -= dropped.bytes
    entry.droppedLength += dropped.text.length
  }
}

/** Append whatever a stream has produced so far, decoded by that stream's own decoder. */
function drainStream(entry, stream, chunk) {
  return entry.decoders[stream].push(chunk)
}

/** Emit the incomplete tail both decoders still hold back (called once the process ends). */
function flushDecoders(entry) {
  for (const stream of ['stdout', 'stderr']) {
    const rest = entry.decoders[stream].flush()
    if (rest !== '') appendOutput(entry, stream, rest)
  }
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff
}

/** The status payload one poll returns: metadata plus the output slice starting at `offset`. */
export function runStatusPayload(entry, offset = 0) {
  const requested = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0
  const start = Math.max(requested, entry.droppedLength)
  const chunks = []
  let cursor = entry.droppedLength
  let nextOffset = start
  let delivered = 0
  for (const chunk of entry.chunks) {
    const chunkStart = cursor
    cursor += chunk.text.length
    if (cursor <= start || delivered >= RUN_POLL_SLICE_LENGTH) continue
    const from = Math.max(start, chunkStart) - chunkStart
    let to = chunk.text.length
    if (delivered + (to - from) > RUN_POLL_SLICE_LENGTH) to = from + (RUN_POLL_SLICE_LENGTH - delivered)
    let text = chunk.text.slice(from, to)
    /* Never hand out half a surrogate pair (a lone half renders as a replacement glyph). */
    if (to < chunk.text.length && text !== '' && isHighSurrogate(text.charCodeAt(text.length - 1))) text = text.slice(0, -1)
    if (text === '') continue
    chunks.push({ s: chunk.stream === 'stderr' ? 'e' : 'o', t: text })
    delivered += text.length
    nextOffset = chunkStart + from + text.length
  }
  return {
    exists: true,
    runId: entry.runId,
    path: entry.path,
    name: entry.name,
    status: entry.status,
    stopping: entry.stopping === true,
    code: entry.code ?? null,
    signal: entry.signal ?? null,
    errorCode: entry.errorCode ?? null,
    errorMessage: entry.errorMessage ?? null,
    errorCandidates: entry.errorCandidates ?? null,
    command: entry.command,
    cwd: entry.cwd,
    cwdRelative: entry.cwdRelative,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt ?? null,
    durationMs: (entry.endedAt ?? Date.now()) - entry.startedAt,
    chunks,
    nextOffset,
    totalLength: entry.totalLength,
    droppedLength: entry.droppedLength,
    truncated: entry.droppedLength > 0,
    argsText: entry.argsText ?? '',
    interpreter: entry.interpreter ?? null,
  }
}

function settleEntry(entry, patch) {
  if (entry.settled) return
  entry.settled = true
  entry.stopping = false
  Object.assign(entry, patch)
  entry.endedAt = Date.now()
  if (entry.killTimer !== null) {
    clearTimeout(entry.killTimer)
    entry.killTimer = null
  }
  if (entry.exitTimer !== null) {
    clearTimeout(entry.exitTimer)
    entry.exitTimer = null
  }
  /* Reclaim memory, but keep the tail readable for a while so a refresh re-attaches to a run that
     just ended. `unref` keeps the timer from holding the Host open. */
  entry.reapTimer = setTimeout(() => {
    if (runsById.get(entry.runId) === entry) runsById.delete(entry.runId)
    if (runsByKey.get(entry.key) === entry) runsByKey.delete(entry.key)
  }, RUN_SETTLED_KEEP_MS)
  if (typeof entry.reapTimer?.unref === 'function') entry.reapTimer.unref()
}

function runTaskkill(pids, tree) {
  if (pids.length === 0) return Promise.resolve()
  const args = []
  for (const pid of pids) args.push('/PID', String(pid))
  if (tree) args.push('/T')
  args.push('/F')
  return new Promise((resolveKill) => {
    try {
      execFile('taskkill', args, { windowsHide: true, timeout: RUN_WINDOWS_QUERY_TIMEOUT_MS }, () => resolveKill())
    } catch { resolveKill() }
  })
}

/** Descendant pids of one Windows pid, deepest first.
 *
 *  Enumerated with PowerShell's CIM (wmic is absent on current Windows builds) because
 *  `taskkill /T` alone can miss a grandchild: the intermediate process dies first, and the traversal
 *  no longer reaches it. Measured on this machine — a python child of a python child survived a
 *  /T /F kill of the launcher, and kept the run's output pipes open with it. */
async function windowsDescendantPids(rootPid) {
  const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
  const output = await new Promise((resolveQuery) => {
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: RUN_WINDOWS_QUERY_TIMEOUT_MS,
        windowsHide: true,
      }, (error, stdout) => resolveQuery(error === null || error === undefined ? String(stdout ?? '') : ''))
    } catch { resolveQuery('') }
  })
  const childrenOf = new Map()
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    const pid = Number(parts[0])
    const parent = Number(parts[1])
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent) || pid <= 0) continue
    const bucket = childrenOf.get(parent)
    if (bucket === undefined) childrenOf.set(parent, [pid])
    else bucket.push(pid)
  }
  const out = []
  /* Post-order: children before their parent, so the kill list is deepest first. */
  const walk = (pid) => {
    for (const child of childrenOf.get(pid) ?? []) {
      walk(child)
      out.push(child)
    }
  }
  walk(rootPid)
  return out
}

/** Stop a Windows process tree thoroughly: kill every descendant plus the root, then retry once,
 *  and only report a failure after both passes. Never leaves the console stuck on 「正在停止…」. */
async function killWindowsTree(entry) {
  const root = entry.child?.pid
  if (root === undefined) return
  const attempt = async () => {
    const descendants = await windowsDescendantPids(root)
    await runTaskkill([...descendants, root], false)
    /* Belt and braces for a tree whose links still hold at this instant. */
    await runTaskkill([root], true)
  }
  await attempt()
  setTimeout(() => {
    if (entry.settled) return
    void (async () => {
      const child = entry.child
      const stillAlive = child !== null && child.exitCode === null && child.signalCode === null
      if (stillAlive) await attempt()
      setTimeout(() => {
        if (entry.settled) return
        const latest = entry.child
        const alive = latest !== null && latest.exitCode === null && latest.signalCode === null
        if (alive) {
          /* Honest degradation: unblock the console and say what to do, instead of spinning on
             「正在停止…」 forever. The child may still be running. */
          settleEntry(entry, {
            status: 'killed',
            errorCode: 'stop-failed',
            errorMessage: '已尝试终止该进程树两次，但它仍在运行；请在任务管理器中手动结束这些进程。',
          })
        } else {
          settleEntry(entry, { status: 'killed', code: latest?.exitCode ?? null, signal: null })
        }
      }, RUN_WINDOWS_KILL_RETRY_MS)
    })()
  }, RUN_WINDOWS_KILL_RETRY_MS)
}

/** Best-effort synchronous tree kill, used by the teardown path (the Host is going away). */
function forceKill(entry) {
  const child = entry.child
  if (child === null || child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => {})
    } catch { /* taskkill missing: fall through to the single-process kill */ }
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    return
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
}

/** Start one run of a workspace file. Returns the registry entry's public shape. */
export async function startRun(workspace, relativePath, argsText, options = {}) {
  const policy = await readRunPolicyStore()
  const plan = await buildRunPlan(workspace, relativePath, {
    extensions: policy.extensions,
    files: policy.files,
    env: options.env,
  })
  if (!plan.supported) {
    throw new HttpError(400, 'run-not-supported', plan.message === '' ? '该文件当前无法运行' : plan.message, { reason: plan.reason, candidates: plan.candidates })
  }
  const key = keyOf(workspace, relativePath)
  const existing = runsByKey.get(key)
  if (existing !== undefined && existing.status === 'running') {
    throw new HttpError(409, 'run-in-progress', '该文件已有正在运行的进程', { runId: existing.runId })
  }
  if (liveRunCount() >= RUN_MAX_CONCURRENT) {
    throw new HttpError(429, 'run-limit', `同时运行的进程不能超过 ${RUN_MAX_CONCURRENT} 个`)
  }
  const extraArgs = splitRunArgs(argsText)
  const argv = [...plan.args, ...extraArgs]
  const command = displayCommand([plan.interpreterName ?? plan.name, ...plan.flags, plan.name, ...extraArgs])
  const entry = {
    runId: randomUUID(),
    key,
    workspaceId: String(workspace.id),
    path: relativePath,
    name: plan.name,
    kind: plan.kind,
    command,
    cwd: plan.cwd,
    cwdRelative: plan.cwdRelative,
    interpreter: plan.interpreter,
    argsText: typeof argsText === 'string' ? argsText : '',
    startedAt: Date.now(),
    endedAt: null,
    status: 'running',
    stopping: false,
    settled: false,
    code: null,
    signal: null,
    errorCode: null,
    errorMessage: null,
    errorCandidates: null,
    chunks: [],
    bufferedBytes: 0,
    totalLength: 0,
    droppedLength: 0,
    /* One decoder per stream: the encoding is detected from that stream's own first bytes. */
    decoders: { stdout: new RunStreamDecoder(), stderr: new RunStreamDecoder() },
    child: null,
    killTimer: null,
    exitTimer: null,
    reapTimer: null,
  }
  runsById.set(entry.runId, entry)
  runsByKey.set(key, entry)
  let child
  try {
    child = spawn(plan.interpreter, argv, {
      cwd: plan.cwd,
      env: childEnvironment(),
      /* stdin is closed on purpose: this is a non-interactive console, so a script that waits for
         input receives EOF instead of hanging the panel forever. */
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      /* POSIX: own process group, so stopping kills the whole tree the script may have spawned. */
      detached: process.platform !== 'win32',
    })
  } catch (error) {
    settleEntry(entry, { status: 'error', errorCode: 'spawn-failed', errorMessage: String(error?.message ?? error) })
    throw new HttpError(500, 'run-spawn-failed', '无法启动该进程', { runId: entry.runId })
  }
  entry.child = child
  child.stdout?.on('data', (data) => appendOutput(entry, 'stdout', drainStream(entry, 'stdout', Buffer.from(data))))
  child.stderr?.on('data', (data) => appendOutput(entry, 'stderr', drainStream(entry, 'stderr', Buffer.from(data))))
  child.on('error', (error) => {
    const code = error?.code === 'ENOENT' ? 'interpreter-not-found' : 'spawn-failed'
    flushDecoders(entry)
    settleEntry(entry, {
      status: 'error',
      errorCode: code,
      errorMessage: code === 'interpreter-not-found' ? `未找到 ${plan.interpreterName ?? plan.name}` : String(error?.message ?? error),
    })
  })
  child.on('close', (code, signal) => {
    if (entry.settled) return
    /* Whatever the decoders still hold back (an incomplete multi-byte sequence) belongs to this run:
       emit it before the exit line, or the tail of the last line would be lost. */
    flushDecoders(entry)
    settleEntry(entry, {
      status: entry.stopping || signal !== null ? 'killed' : 'exited',
      code: Number.isInteger(code) ? code : null,
      signal: signal === null ? null : String(signal),
    })
  })
  /* 'close' waits for the stdio pipes, so a process whose own child survived keeps this run
     "running" forever (measured: a script that spawns a sleeper and is stopped). 'exit' is the
     real end of THIS process; it only loses output the child wrote in its last instants, so it
     arms a short drain deadline instead of settling immediately. */
  child.on('exit', (code, signal) => {
    if (entry.settled || entry.exitTimer !== null) return
    entry.exitTimer = setTimeout(() => {
      entry.exitTimer = null
      if (entry.settled) return
      flushDecoders(entry)
      settleEntry(entry, {
        status: entry.stopping || signal !== null ? 'killed' : 'exited',
        code: Number.isInteger(code) ? code : null,
        signal: signal === null ? null : String(signal),
      })
    }, RUN_EXIT_DRAIN_MS)
    if (typeof entry.exitTimer?.unref === 'function') entry.exitTimer.unref()
  })
  return {
    ...runStatusPayload(entry, 0),
    plan: {
      supported: true,
      reason: null,
      kind: plan.kind,
      interpreter: plan.interpreter,
      interpreterName: plan.interpreterName,
      interpreterOverride: plan.interpreterOverride,
      interpreterSource: plan.interpreterSource,
      interpreterRequested: plan.interpreterRequested,
      interpreterStaleScope: plan.interpreterStaleScope,
      interpreterStalePath: plan.interpreterStalePath,
      fileKey: plan.fileKey,
      candidates: plan.candidates,
    },
  }
}

/** One run's status (and output slice), by run id or by file. */
export function readRunStatus({ runId, workspace, relativePath, offset }) {
  let entry
  if (typeof runId === 'string' && runId !== '') {
    entry = runsById.get(runId)
    if (entry === undefined) return { exists: false, runId, chunks: [], nextOffset: 0 }
  } else {
    entry = runsByKey.get(keyOf(workspace, relativePath))
    if (entry === undefined) return { exists: false, path: relativePath, chunks: [], nextOffset: 0 }
  }
  return runStatusPayload(entry, offset)
}

/** Stop one run. POSIX: SIGTERM to the process group, then SIGKILL after the grace period.
 *  Windows: the whole tree, enumerated and killed explicitly (see killWindowsTree). Idempotent. */
export function stopRun(runId) {
  const entry = runsById.get(runId)
  if (entry === undefined) throw new HttpError(404, 'run-not-found', '该运行记录不存在或已结束')
  if (entry.status !== 'running') {
    return { runId, status: entry.status, alreadySettled: true }
  }
  entry.stopping = true
  const child = entry.child
  if (process.platform === 'win32') {
    /* Fire-and-forget: the endpoint answers immediately, the enumeration and the retry keep going. */
    void killWindowsTree(entry)
    return { runId, status: 'running', stopping: true, graceMs: RUN_WINDOWS_KILL_RETRY_MS }
  }
  if (child !== null && child.pid !== undefined) {
    try { process.kill(-child.pid, 'SIGTERM') } catch {
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }
  }
  if (entry.killTimer === null) {
    entry.killTimer = setTimeout(() => {
      entry.killTimer = null
      if (!entry.settled) forceKill(entry)
    }, RUN_KILL_GRACE_MS)
  }
  return { runId, status: 'running', stopping: true, graceMs: RUN_KILL_GRACE_MS }
}

/** Whether a path currently has a live process (used by the client's tab badge path). */
export function hasLiveRun(workspace, relativePath) {
  const entry = runsByKey.get(keyOf(workspace, relativePath))
  return entry !== undefined && entry.status === 'running'
}

/** Kill every live child (Host shutdown / plugin teardown): nothing must outlive the Host. */
export function stopAllRuns() {
  for (const entry of runsById.values()) {
    if (entry.status !== 'running') continue
    entry.stopping = true
    forceKill(entry)
  }
  for (const entry of runsById.values()) {
    if (entry.killTimer !== null) clearTimeout(entry.killTimer)
    if (entry.reapTimer !== null) clearTimeout(entry.reapTimer)
  }
}
