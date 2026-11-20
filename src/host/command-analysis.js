/** Static shell-command analysis for the console file-permission gate.
 *
 *  The gate must decide, BEFORE anything runs, which files a console command may delete, modify,
 *  or create. This module is deliberately pure: it tokenizes a command string, understands the
 *  common mutating commands of bash/PowerShell/cmd, and resolves their arguments to absolute paths.
 *  It never spawns a process, never opens a file, and never executes a script.
 *
 *  What it returns is advisory input for the permission gate, NOT a sandbox. Anything it cannot
 *  classify is reported as `opaque`; the gate then asks the user for the working folder (or, when
 *  configured, asks the AI analyzer) instead of silently allowing it.
 *
 *  Script contents are analyzed by the caller (it owns fs reads / recursion / limits); this module
 *  only reports script references and nested command strings.
 */

import { homedir } from 'node:os'
import path from 'node:path'

/* Extensions whose body this module can parse with the same shell grammar as a command. */
export const SHELL_SCRIPT_EXTENSIONS = Object.freeze(['.ps1', '.psm1', '.bat', '.cmd', '.sh', '.bash', '.zsh'])
/* Text scripts whose language is not covered by the static parser: the AI analyzer may take them. */
export const OTHER_SCRIPT_EXTENSIONS = Object.freeze(['.py', '.pyw', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl', '.php', '.lua', '.rs', '.go', '.java'])
const SHELL_SCRIPT_SET = new Set(SHELL_SCRIPT_EXTENSIONS)
const OTHER_SCRIPT_SET = new Set(OTHER_SCRIPT_EXTENSIONS)

const NULL_DEVICES = new Set(['nul', '/dev/null', '$null', 'con', 'prn', 'aux'])

/* Commands that only read. Aliases are listed explicitly because the generic prefix rules below
   only cover the long cmdlet names. */
const READ_ONLY = new Set([
  'ls', 'dir', 'pwd', 'cd', 'chdir', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'rg', 'find',
  'which', 'where', 'whoami', 'hostname', 'date', 'echo', 'printf', 'true', 'false', 'test',
  'clear', 'cls', 'tree', 'history', 'alias', 'unalias', 'printenv', 'uname', 'arch', 'df', 'du',
  'free', 'top', 'ps', 'kill', 'sleep', 'timeout', 'wait', 'jobs', 'bg', 'fg', 'set', 'export',
  'umask', 'get-childitem', 'gci', 'get-content', 'gc', 'get-item', 'gi', 'get-itemproperty',
  'gp', 'get-acl', 'get-location', 'gl', 'get-process', 'gps', 'get-service', 'gsv',
  'get-command', 'gcm', 'get-help', 'help', 'man', 'get-module', 'gm', 'get-variable', 'gv',
  'get-history', 'h', 'get-host', 'get-psdrive', 'get-psprovider', 'get-date', 'get-culture',
  'get-uiculture', 'get-timezone', 'get-computerinfo', 'get-ciminstance', 'get-wmiobject',
  'gwmi', 'test-path', 'resolve-path', 'test-connection', 'resolve-dnsname', 'select-string',
  'sls', 'measure-object', 'measure', 'compare-object', 'compare', 'sort-object', 'sort',
  'select-object', 'select', 'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw',
  'out-host', 'oh', 'out-string', 'os', 'write-output', 'write-host', 'write-verbose',
  'write-warning', 'write-error', 'write-information', 'write-debug', 'start-sleep', 'sleep',
  'wait-process', 'get-netadapter', 'get-nettcpconnection', 'get-netipaddress', 'get-dnsclientcache',
  'get-volume', 'get-disk', 'get-partition', 'get-smbshare', 'get-eventlog', 'get-winevent',
  'get-childitem', 'get-item', 'get-childitem', 'rem', 'ver', 'vol', 'title', 'color', 'pause',
  'ipconfig', 'netstat', 'ping', 'tracert', 'nslookup', 'systeminfo', 'cmdkey', 'whoami',
  'code', 'notepad',
])

/* Wrappers that run another command; without a dedicated parser they must be treated as opaque
   (a read-only wrapper would let an inner mutator through). */
const WRAPPERS = new Set([
  'sudo', 'doas', 'su', 'runuser', 'chroot', 'env', 'command', 'builtin', 'exec', 'nohup', 'time',
  'nice', 'ionice', 'stdbuf', 'watch', 'xargs', 'parallel', 'start', 'start-process', 'call',
  'source', '.', 'eval', 'invoke-expression', 'iex',
])

const GIT_READ_ONLY = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'describe',
  'blame', 'grep', 'shortlog', 'count-objects', 'check-ignore', 'check-attr', 'show-ref',
  'for-each-ref', 'reflog', 'help', 'version',
])
const GIT_MUTATING = new Set([
  'add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'clean', 'rm', 'mv', 'stash', 'apply',
  'am', 'merge', 'rebase', 'cherry-pick', 'pull', 'fetch', 'clone', 'init', 'gc', 'prune',
  'worktree', 'submodule', 'bisect', 'notes', 'replace', 'filter-branch', 'update-index',
  'update-ref', 'pack-refs', 'fsck',
])
const SVN_READ_ONLY = new Set(['status', 'info', 'diff', 'log', 'list', 'cat', 'blame', 'proplist', 'propget'])

function lower(value) {
  return String(value ?? '').toLowerCase()
}

function pathModule(platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function hasWildcard(value) {
  return /[*?[\]]/u.test(value)
}

function isNullDevice(value) {
  const text = lower(value).replace(/^"+|"+$/gu, '')
  return text === '' || NULL_DEVICES.has(text)
}

function stripTrailingSeparators(value, pathMod) {
  if (value === '') return value
  const root = pathMod.parse(value).root
  let end = value.length
  while (end > root.length && (value[end - 1] === '/' || value[end - 1] === '\\')) end -= 1
  return value.slice(0, end)
}

function normalizeForCompare(value, platform) {
  const text = stripTrailingSeparators(platform === 'win32' ? String(value).replace(/\//gu, '\\') : String(value), pathModule(platform))
  return platform === 'win32' ? text.toLowerCase() : text
}

/** Whether two absolute paths denote the same location (case-insensitive on Windows). */
export function samePath(left, right, platform = process.platform) {
  return normalizeForCompare(left, platform) === normalizeForCompare(right, platform)
}

/** Whether `target` is inside `folder` (or equal to it). */
export function pathWithin(target, folder, platform = process.platform) {
  const pathMod = pathModule(platform)
  const a = normalizeForCompare(target, platform)
  const b = normalizeForCompare(folder, platform)
  if (a === b) return true
  const separator = platform === 'win32' ? '\\' : '/'
  const prefix = b.endsWith(separator) ? b : `${b}${separator}`
  return a.startsWith(prefix)
}

/** Whether one path is a filesystem root or the user's home directory (never grantable as a folder). */
export function isRootOrHome(target, homeDir, platform = process.platform) {
  const pathMod = pathModule(platform)
  const normalized = normalizeForCompare(target, platform)
  const root = normalizeForCompare(pathMod.parse(String(target)).root, platform)
  if (normalized === root) return true
  if (typeof homeDir === 'string' && homeDir !== '') {
    return normalized === normalizeForCompare(homeDir, platform)
  }
  return false
}

function envValue(env, name) {
  if (env === null || env === undefined) return undefined
  const exact = env[name]
  if (typeof exact === 'string' && exact !== '') return exact
  const wanted = lower(name)
  for (const [key, value] of Object.entries(env)) {
    if (lower(key) === wanted && typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/* Expand the variables a console command commonly uses. Unknown variables are left in place and
   reported as uncertain: the gate then asks for the stable parent instead of guessing a path. */
function expandVariables(raw, ctx) {
  let text = String(raw)
  let uncertain = false
  const cwd = ctx.cwd
  const home = ctx.homeDir
  const scriptDir = ctx.scriptDir
  const scriptPath = ctx.scriptPath
  if (text === '~') {
    text = home
  } else if (text.startsWith('~/') || text.startsWith('~\\')) {
    text = `${home}${text.slice(1)}`
  } else if (text.startsWith('~')) {
    uncertain = true
  }
  const replaceEnv = (name, fallback) => {
    const value = envValue(ctx.env, name) ?? fallback
    if (typeof value === 'string' && value !== '') return value
    uncertain = true
    return `%${name}%`
  }
  text = text.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/giu, (_m, name) => {
    const known = replaceEnv(name, name === 'USERPROFILE' || name === 'HOME' ? home : undefined)
    return known
  })
  text = text.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/gu, (_m, name) => {
    if (lower(name) === 'cd') return cwd
    if (lower(name) === '__cd__') return `${cwd}${pathModule(ctx.platform).sep}`
    return replaceEnv(name, lower(name) === 'userprofile' ? home : undefined)
  })
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_m, name) => {
    if (name === 'PWD') return cwd
    if (name === 'HOME') return home
    if (name === 'BASH_SOURCE') return scriptPath ?? scriptDir ?? ''
    return replaceEnv(name, undefined)
  })
  text = text.replace(/\$0\b/gu, () => (scriptPath === undefined ? (uncertain = true, '$0') : scriptPath))
  text = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/gu, (match, name) => {
    if (name === 'HOME') return home
    if (name === 'PWD') return cwd
    if (name === 'PSScriptRoot') return scriptDir ?? ''
    if (name === 'PSCommandPath') return scriptPath ?? ''
    if (name === '0' && scriptPath !== undefined) return scriptPath
    const value = envValue(ctx.env, name)
    if (typeof value === 'string' && value !== '') return value
    uncertain = true
    return match
  })
  text = text.replace(/%~dp0/giu, () => (scriptDir === undefined ? (uncertain = true, '%~dp0') : `${scriptDir}${pathModule(ctx.platform).sep}`))
  text = text.replace(/%~f0/giu, () => (scriptPath === undefined ? (uncertain = true, '%~f0') : scriptPath))
  /* A variable this expander does not know (`%1`, a PowerShell subexpression, a literal `$` in a
     path) makes the exact target unknowable; ask for the stable parent instead of guessing. */
  if (text.includes('`') || text.includes('$(') || /[$%]/u.test(text)) uncertain = true
  return { text, uncertain }
}

function stableParent(raw, ctx) {
  const pathMod = pathModule(ctx.platform)
  const separators = ctx.platform === 'win32' ? /[\\/]+/u : /\/+/u
  const parts = String(raw).split(separators).filter(part => part !== '')
  const unstable = part => /[$%*?[\]`]/u.test(part) || (ctx.platform !== 'win32' && part === '~')
  const index = parts.findIndex(unstable)
  const stable = index < 0 ? parts : parts.slice(0, index)
  if (stable.length === 0) {
    /* A wildcard directly under a root (`/*`, `C:\\*`) must not fall back to the process cwd. */
    if (String(raw).startsWith('/')) return pathMod.sep
    if (ctx.platform === 'win32' && /^[A-Za-z]:/u.test(String(raw))) return `${String(raw).slice(0, 2)}${pathMod.sep}`
    return pathMod.normalize(ctx.cwd)
  }
  if (ctx.platform === 'win32' && /^[A-Za-z]:$/u.test(stable[0])) {
    return `${stable[0]}${pathMod.sep}${stable.slice(1).join(pathMod.sep)}`
  }
  const joined = stable.join(pathMod.sep)
  if (pathMod.isAbsolute(joined)) return pathMod.normalize(joined)
  return pathMod.normalize(pathMod.resolve(ctx.cwd, joined))
}

/** Resolve one command argument to an absolute path, or a stable parent when it is dynamic. */
export function resolveTargetPath(raw, kindHint, ctx) {
  if (typeof raw !== 'string' || raw === '' || isNullDevice(raw)) return null
  const expanded = expandVariables(raw, ctx)
  const pathMod = pathModule(ctx.platform)
  if (hasWildcard(expanded.text) || expanded.uncertain) {
    const parent = stableParent(expanded.text, ctx)
    return { path: parent, kind: 'folder', uncertain: true, confidence: 'low', raw }
  }
  let text = stripTrailingSeparators(expanded.text, pathMod)
  if (text === '') return null
  const absolute = pathMod.isAbsolute(text)
  if (!absolute) text = pathMod.resolve(ctx.cwd, text)
  text = pathMod.normalize(text)
  const trailing = /[\\/]$/u.test(expanded.text)
  return {
    path: text,
    kind: trailing ? 'folder' : (kindHint ?? 'file'),
    uncertain: false,
    confidence: 'high',
    raw,
  }
}

function targetFor(raw, kindHint, operations, source, ctx, extra) {
  const resolved = resolveTargetPath(raw, kindHint, ctx)
  if (resolved === null) return null
  const target = {
    path: resolved.path,
    kind: resolved.kind,
    operations: [...new Set(operations)],
    source,
    confidence: resolved.confidence,
  }
  if (resolved.uncertain) target.uncertain = true
  if (extra !== undefined && extra !== null) Object.assign(target, extra)
  return target
}

function pushTarget(out, target) {
  if (target !== null) out.targets.push(target)
}

function looksLikeScript(raw, platform) {
  if (typeof raw !== 'string' || raw === '') return null
  const ext = lower(pathModule(platform).extname(raw))
  if (SHELL_SCRIPT_SET.has(ext)) return 'shell'
  if (OTHER_SCRIPT_SET.has(ext)) return 'other'
  return null
}

function commandName(raw, platform) {
  let base = pathModule(platform).basename(String(raw ?? ''))
  base = base.replace(/\.(exe|com|cmd|bat)$/iu, '')
  return lower(base)
}

function isFlag(value, platform) {
  if (typeof value !== 'string' || value === '' || value === '-') return false
  if (value.startsWith('--')) return true
  if (platform === 'win32') return value.startsWith('-') && !/^-\d/u.test(value)
  return value.startsWith('-')
}

function positionals(argv, platform, valueFlags = new Set(), options = {}) {
  const out = []
  let stopFlags = false
  for (let i = 1; i < argv.length; i += 1) {
    const arg = String(argv[i])
    if (!stopFlags && arg === '--') {
      stopFlags = true
      continue
    }
    if (!stopFlags && isFlag(arg, platform)) {
      const eq = arg.indexOf('=')
      const name = lower(eq >= 0 ? arg.slice(0, eq) : arg)
      const needsValue = valueFlags.has(name)
      if (needsValue && eq < 0) i += 1
      continue
    }
    out.push(arg)
  }
  if (options.limit !== undefined) return out.slice(0, options.limit)
  return out
}

function namedValueList(argv, names, platform) {
  const wanted = new Set(names.map(lower))
  const values = []
  for (let i = 1; i < argv.length; i += 1) {
    const arg = String(argv[i])
    if (!isFlag(arg, platform)) continue
    const eq = arg.indexOf('=')
    const name = lower(eq >= 0 ? arg.slice(0, eq) : arg)
    if (!wanted.has(name)) continue
    if (eq >= 0) {
      const value = arg.slice(eq + 1)
      if (value !== '') values.push(value)
      continue
    }
    for (let j = i + 1; j < argv.length; j += 1) {
      if (isFlag(String(argv[j]), platform)) break
      values.push(String(argv[j]))
      i = j
    }
  }
  return values
}

/* One flag, one value (curl -o, -Destination, -OutFile): a URL or another positional after the
   value must not be swallowed as a second target. */
function namedSingleValue(argv, names, platform) {
  const wanted = new Set(names.map(lower))
  for (let i = 1; i < argv.length; i += 1) {
    const arg = String(argv[i])
    if (!isFlag(arg, platform)) continue
    const eq = arg.indexOf('=')
    const name = lower(eq >= 0 ? arg.slice(0, eq) : arg)
    if (!wanted.has(name)) continue
    if (eq >= 0) {
      const value = arg.slice(eq + 1)
      return value === '' ? undefined : value
    }
    const next = argv[i + 1]
    if (next === undefined || isFlag(String(next), platform)) return undefined
    return String(next)
  }
  return undefined
}

const PS_PATH_FLAGS = ['-path', '-literalpath', '-pspath']
const PS_DEST_FLAGS = ['-destination']
const PS_FILE_FLAGS = ['-filepath', '-outfile', '-literalpath']
const PS_VALUE_FLAGS = new Set([
  '-value', '-inputobject', '-encoding', '-stream', '-delimiter', '-totalcount', '-tail',
  '-filter', '-include', '-exclude', '-credential', '-computername', '-property', '-name',
  '-itemtype', '-type', '-force', '-recurse', '-whatif', '-confirm', '-verbose', '-erroraction',
  '-warningaction', '-informationaction', '-debug', '-errorvariable', '-outvariable',
  '-outbuffer', '-pipelinevariable', '-asjob', '-throttlelimit', '-timeout', '-count',
  '-first', '-last', '-skip', '-unique', '-descending', '-casesensitive', '-culture',
  '-replace', '-simplematch', '-list', '-notmatch', '-pattern', '-allmatches', '-destination',
])

/* Per-command value flags. A generic "looks like an option" set is NOT safe here: `rm -i file`
   takes no value after -i, and treating it as one would hide the file and silently allow the
   delete. Keep these tables narrow and command-specific. */
const FLAGS_NONE = new Set()
const FLAGS_CP = new Set(['-t', '--target-directory', '-S', '--suffix'])
const FLAGS_MKDIR = new Set(['-m', '--mode'])
const FLAGS_TOUCH = new Set(['-d', '--date', '-r', '--reference', '-t'])
const FLAGS_LN = new Set(['-t', '--target-directory', '-S', '--suffix'])
const FLAGS_OWNER = new Set(['--reference'])
const FLAGS_TRUNCATE = new Set(['-s', '--size', '-r', '--reference'])
const FLAGS_INSTALL = new Set(['-t', '--target-directory', '-m', '--mode', '-o', '--owner', '-g', '--group'])
const FLAGS_PATCH = new Set(['-i', '--input', '-o', '--output', '-r', '--reject-file', '-d', '--directory', '-p', '--strip', '-F', '--fuzz'])
const FLAGS_CURL = new Set(['-o', '--output', '--out', '-outfile'])
const FLAGS_ARCHIVE = new Set(['-path', '-literalpath', '-destinationpath', '-destination', '-compressionlevel'])

/* cmd.exe writes its switches with `/`, which path.isAbsolute on Windows also accepts. For the cmd
   mutators (del/copy/move/...), every `/x` token is a switch; no target path in cmd begins with `/`. */
function cmdPositionals(argv) {
  return argv.slice(1).filter(arg => !/^\/[A-Za-z?]/u.test(String(arg)) && String(arg) !== '')
}

function psPaths(argv, platform) {
  const named = namedValueList(argv, PS_PATH_FLAGS, platform)
  const positional = positionals(argv, platform, PS_VALUE_FLAGS)
  return [...named, ...positional]
}

function psDest(argv, platform) {
  const named = namedValueList(argv, PS_DEST_FLAGS, platform)
  if (named.length > 0) return named
  const positional = positionals(argv, platform, PS_VALUE_FLAGS)
  return positional.length > 0 ? [positional[positional.length - 1]] : []
}

function pushFolderTarget(out, raw, ops, source, ctx, extra) {
  pushTarget(out, targetFor(raw, 'folder', ops, source, ctx, extra))
}

function pushFileTarget(out, raw, ops, source, ctx, extra) {
  pushTarget(out, targetFor(raw, 'file', ops, source, ctx, extra))
}

function analyzeGit(args, cwd, out, ctx) {
  const sub = lower(args[0])
  if (sub === '') {
    out.readOnly = true
    return
  }
  if (GIT_READ_ONLY.has(sub) || sub === '--version' || sub === 'version') {
    out.readOnly = true
    return
  }
  if (sub === 'clone') {
    /* `git clone <url> [<dest>]`: with a destination it writes OUTSIDE the current working
       directory, so the working directory grant alone must not authorize it. Options that take a
       value are skipped before looking at the URL/destination pair. */
    const cloneValueFlags = new Set(['--depth', '--branch', '-b', '--origin', '-o', '--config', '-c', '--reference', '--separate-git-dir', '--jobs', '-j', '--template', '--upload-pack', '--filter'])
    const rest = positionals(args, ctx.platform, cloneValueFlags)
      .filter(arg => !/^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/iu.test(arg))
    const destination = rest.length >= 1 ? rest[rest.length - 1] : cwd
    pushFolderTarget(out, destination, ['create', 'modify'], 'git', ctx, { confidence: 'low' })
    return
  }
  if (sub === 'worktree' && lower(args[1]) === 'add') {
    const rest = positionals(args, ctx.platform, new Set(['-b', '-B', '--reason']))
    const target = rest[0] === 'add' ? rest[1] : undefined
    if (target !== undefined) pushFolderTarget(out, target, ['create', 'modify'], 'git', ctx, { confidence: 'low' })
    else out.opaque = true
    return
  }
  if (sub === 'branch') {
    const mutating = args.slice(1).some(arg => /^-[dDmM]$/u.test(arg) || arg === '--delete' || arg === '--move' || arg === '--copy')
    if (!mutating) {
      out.readOnly = true
      return
    }
  }
  if (sub === 'tag') {
    const mutating = args.slice(1).some(arg => /^-[aAsdD]$/u.test(arg) || arg === '--delete' || arg === '--annotate')
    if (!mutating) {
      out.readOnly = true
      return
    }
  }
  if (sub === 'remote') {
    const action = lower(args[1])
    if (action === '' || action === 'show' || action === '-v' || action === 'get-url') {
      out.readOnly = true
      return
    }
  }
  if (sub === 'stash' && (lower(args[1]) === 'list' || lower(args[1]) === 'show')) {
    out.readOnly = true
    return
  }
  if (sub === 'worktree' && lower(args[1]) === 'list') {
    out.readOnly = true
    return
  }
  if (sub === 'config' && (args.includes('--get') || args.includes('--list') || args.includes('-l'))) {
    out.readOnly = true
    return
  }
  if (GIT_MUTATING.has(sub) || sub === 'config' || sub === 'branch' || sub === 'tag' || sub === 'remote' || sub === 'stash' || sub === 'worktree') {
    pushFolderTarget(out, cwd, ['modify'], 'git', ctx, { confidence: 'low' })
    return
  }
  out.opaque = true
}

function analyzeSvn(args, cwd, out, ctx) {
  const sub = lower(args[0])
  if (SVN_READ_ONLY.has(sub) || sub === '--version' || sub === 'version') {
    out.readOnly = true
    return
  }
  if (sub === 'checkout' || sub === 'export') {
    const rest = positionals(args, ctx.platform, new Set(['-r', '--revision', '--depth', '--set-depth']))
      .filter(arg => !/^(?:[a-z][a-z0-9+.-]*:\/\/|svn\+ssh:\/\/)/iu.test(arg))
    const destination = rest.length >= 1 ? rest[rest.length - 1] : cwd
    pushFolderTarget(out, destination, ['create', 'modify'], 'svn', ctx, { confidence: 'low' })
    return
  }
  pushFolderTarget(out, cwd, ['modify'], 'svn', ctx, { confidence: 'low' })
}

function scriptReference(out, raw, kind, ctx) {
  const resolved = resolveTargetPath(raw, 'file', ctx)
  if (resolved === null) {
    out.opaque = true
    return
  }
  out.scripts.push({ path: resolved.path, kind, raw: String(raw), confidence: resolved.confidence, ...(resolved.uncertain ? { uncertain: true } : {}) })
}

function analyzeWrapper(argv, cwd, out, ctx) {
  const name = commandName(argv[0], ctx.platform)
  const args = argv.slice(1)
  const scriptKind = raw => looksLikeScript(raw, ctx.platform)

  if (name === 'call' || name === 'source' || name === '.') {
    const raw = args.find(arg => !isFlag(arg, ctx.platform))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'start') {
    const raw = args.find(arg => !isFlag(arg, ctx.platform) && lower(arg) !== '')
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'pwsh' || name === 'powershell') {
    if (args.some(arg => /^--?(v|version)$/iu.test(arg))) {
      out.readOnly = true
      return true
    }
    const fileIndex = args.findIndex(arg => /^-(f|file)$/iu.test(arg))
    if (fileIndex >= 0 && args[fileIndex + 1] !== undefined) {
      scriptReference(out, args[fileIndex + 1], 'shell', ctx)
      return true
    }
    const commandIndex = args.findIndex(arg => /^-(c|command)$/iu.test(arg))
    if (commandIndex >= 0) {
      const nested = args.slice(commandIndex + 1).join(' ')
      if (nested === '') out.opaque = true
      else out.nested.push({ command: nested, cwd })
      return true
    }
    if (args.some(arg => /^-(e|ec|encodedcommand)$/iu.test(arg))) {
      out.opaque = true
      return true
    }
    const raw = args.find(arg => !isFlag(arg, ctx.platform))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'cmd') {
    const index = args.findIndex(arg => /^\/(c|k)$/iu.test(arg))
    if (index >= 0) {
      const rest = args.slice(index + 1)
      if (rest.length === 0) {
        out.opaque = true
        return true
      }
      const first = rest[0]
      const kind = scriptKind(first)
      if (kind !== null && rest.length === 1) {
        scriptReference(out, first, kind, ctx)
        return true
      }
      out.nested.push({ command: rest.join(' '), cwd })
      return true
    }
    const raw = args.find(arg => !isFlag(arg, ctx.platform) || /^\/[ck]$/iu.test(arg))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'bash' || name === 'sh' || name === 'zsh') {
    if (args.some(arg => /^--version$/iu.test(arg))) {
      out.readOnly = true
      return true
    }
    const commandIndex = args.findIndex(arg => arg === '-c' || arg === '--command')
    if (commandIndex >= 0) {
      const nested = args.slice(commandIndex + 1).join(' ')
      if (nested === '') out.opaque = true
      else out.nested.push({ command: nested, cwd })
      return true
    }
    const raw = args.find(arg => !isFlag(arg, ctx.platform))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'node' || name === 'nodejs' || name === 'deno') {
    if (args.some(arg => /^--version$/iu.test(arg) || arg === '-v')) {
      out.readOnly = true
      return true
    }
    if (args.some(arg => arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print')) {
      out.opaque = true
      return true
    }
    if (args[0] === '-' || args.includes('-')) {
      out.opaque = true
      return true
    }
    const raw = args.find(arg => !isFlag(arg, ctx.platform))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'python' || name === 'python3' || name === 'py') {
    if (args.some(arg => /^--version$/iu.test(arg) || arg === '-V')) {
      out.readOnly = true
      return true
    }
    if (args.some(arg => arg === '-c' || arg === '-m' || arg === '-' || arg === '--command')) {
      out.opaque = true
      return true
    }
    const raw = args.find(arg => !isFlag(arg, ctx.platform))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'ruby' || name === 'php' || name === 'perl' || name === 'lua') {
    if (args.some(arg => /^--version$/iu.test(arg))) {
      out.readOnly = true
      return true
    }
    if (args.some(arg => arg === '-e' || arg === '-r' || arg === '-c')) {
      out.opaque = true
      return true
    }
    const raw = args.find(arg => !isFlag(arg, ctx.platform))
    const kind = raw === undefined ? null : scriptKind(raw)
    if (kind !== null) {
      scriptReference(out, raw, kind, ctx)
      return true
    }
    out.opaque = true
    return true
  }

  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
    if (args.length === 0) {
      /* `yarn` with no subcommand means `yarn install` (writes node_modules); the other bare
         launchers only print help. */
      if (name === 'yarn') out.opaque = true
      else out.readOnly = true
      return true
    }
    if (args.some(arg => /^--version$/iu.test(arg) || arg === '-v' || arg === '--help')) {
      out.readOnly = true
      return true
    }
    const sub = lower(args[0])
    if (sub === 'run' || sub === 'run-script') {
      const script = args.slice(1).find(arg => !isFlag(arg, ctx.platform))
      if (script === undefined) out.opaque = true
      else out.runners.push({ command: name, script, cwd })
      return true
    }
    if (name === 'bun') {
      if (sub === 'install' || sub === 'i' || sub === 'add' || sub === 'remove' || sub === 'update' || sub === 'link' || sub === 'publish' || sub === 'pack' || sub === 'exec' || sub === 'x') {
        out.opaque = true
        return true
      }
      const raw = args.find(arg => !isFlag(arg, ctx.platform))
      const kind = raw === undefined ? null : scriptKind(raw)
      if (kind !== null) {
        scriptReference(out, raw, kind, ctx)
        return true
      }
      out.opaque = true
      return true
    }
    if (name === 'yarn' || name === 'pnpm') {
      if (sub === 'install' || sub === 'i' || sub === 'add' || sub === 'remove' || sub === 'up' || sub === 'update' || sub === 'ci' || sub === 'link' || sub === 'publish' || sub === 'pack' || sub === 'exec' || sub === 'dlx') {
        out.opaque = true
        return true
      }
      if (!isFlag(sub, ctx.platform)) {
        out.runners.push({ command: name, script: sub, cwd })
        return true
      }
    }
    if (sub === 'test' || sub === 'start' || sub === 'build') {
      out.runners.push({ command: name, script: sub, cwd })
      return true
    }
    out.opaque = true
    return true
  }

  return false
}

function analyzeSegment(segment, cwd, out, ctx) {
  const argv = segment.argv
  const redirects = segment.redirects
  for (const redirect of redirects) {
    pushFileTarget(out, redirect.path, redirect.op === '>>' ? ['modify', 'create'] : ['create', 'modify'], 'redirect', ctx)
  }
  if (argv.length === 0) {
    out.readOnly = redirects.length === 0 && out.targets.length === 0
    return cwd
  }
  const rawName = String(argv[0])
  const directKind = looksLikeScript(rawName, ctx.platform)
  if (directKind !== null) {
    scriptReference(out, rawName, directKind, ctx)
    return cwd
  }
  const name = commandName(rawName, ctx.platform)
  const args = argv.slice(1)

  /* cd / Set-Location: affects the base of every later relative path in this command. */
  if (name === 'cd' || name === 'chdir' || name === 'set-location' || name === 'sl' || name === 'pushd' || name === 'push-location') {
    let target = args.find(arg => !isFlag(arg, ctx.platform))
    if (name === 'cd' && lower(args[0]) === '/d') target = args.find((arg, index) => index > 0 && !isFlag(arg, ctx.platform))
    if (target === undefined || target === '') {
      out.readOnly = redirects.length === 0
      return cwd
    }
    const resolved = resolveTargetPath(target, 'folder', { ...ctx, cwd })
    if (resolved === null || resolved.uncertain) {
      out.opaque = true
      out.readOnly = false
      return cwd
    }
    out.readOnly = redirects.length === 0
    return resolved.path
  }
  if (name === 'popd' || name === 'pop-location') {
    out.opaque = true
    out.readOnly = false
    return cwd
  }

  if (analyzeWrapper(argv, cwd, out, ctx)) {
    out.readOnly = out.targets.length === 0 && out.scripts.length === 0 && out.nested.length === 0 && out.runners.length === 0 && !out.opaque && redirects.length === 0
    return cwd
  }

  if (name === 'git') {
    analyzeGit(args, cwd, out, ctx)
    out.readOnly = out.targets.length === 0 && !out.opaque && redirects.length === 0
    return cwd
  }
  if (name === 'svn') {
    analyzeSvn(args, cwd, out, ctx)
    out.readOnly = out.targets.length === 0 && !out.opaque && redirects.length === 0
    return cwd
  }

  if (name === 'rm' || name === 'unlink' || name === 'rmdir' || name === 'rd') {
    const targets = positionals(argv, ctx.platform, FLAGS_NONE)
    const recursive = args.some(arg => /^-[A-Za-z]*r/iu.test(arg) || arg === '--recursive' || name === 'rmdir' || name === 'rd')
    for (const raw of targets) {
      if (recursive) pushFolderTarget(out, raw, ['delete'], 'command', ctx)
      else pushFileTarget(out, raw, ['delete'], 'command', ctx)
    }
    out.readOnly = false
    return cwd
  }
  if (name === 'del' || name === 'erase') {
    const targets = cmdPositionals(argv)
    for (const raw of targets) pushFileTarget(out, raw, ['delete'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'mkdir' || name === 'md') {
    const targets = positionals(argv, ctx.platform, FLAGS_MKDIR)
    for (const raw of targets) pushFolderTarget(out, raw, ['create'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'touch') {
    const targets = positionals(argv, ctx.platform, FLAGS_TOUCH)
    for (const raw of targets) pushFileTarget(out, raw, ['create', 'modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'cp' || name === 'copy' || name === 'xcopy' || name === 'robocopy') {
    const cmdStyle = name === 'copy' || name === 'xcopy' || name === 'robocopy'
    const targets = cmdStyle ? cmdPositionals(argv) : positionals(argv, ctx.platform, FLAGS_CP)
    const recursive = args.some(arg => /^-[A-Za-z]*r/u.test(arg) || arg === '--recursive' || /^\/(S|E)$/iu.test(arg))
    let dest
    const targetDir = namedValueList(argv, ['-t', '--target-directory'], ctx.platform)
    if (targetDir.length > 0) dest = targetDir[targetDir.length - 1]
    else if (name === 'robocopy' && targets.length >= 2) dest = targets[1]
    else if (targets.length >= 2) dest = targets[targets.length - 1]
    else if (targets.length === 1 && name === 'cp') dest = targets[0]
    if (dest !== undefined) {
      if (recursive) pushFolderTarget(out, dest, ['create', 'modify'], 'command', ctx)
      else pushFileTarget(out, dest, ['create', 'modify'], 'command', ctx)
    }
    out.readOnly = false
    return cwd
  }
  if (name === 'mv' || name === 'move' || name === 'ren' || name === 'rename') {
    const cmdStyle = name === 'move' || name === 'ren' || name === 'rename'
    const targets = cmdStyle ? cmdPositionals(argv) : positionals(argv, ctx.platform, FLAGS_CP)
    if (name === 'ren' || name === 'rename') {
      if (targets.length >= 1) pushFileTarget(out, targets[0], ['modify', 'move'], 'command', ctx)
    } else {
      for (const raw of targets.slice(0, -1)) pushFileTarget(out, raw, ['delete', 'move'], 'command', ctx)
      if (targets.length >= 2) pushFileTarget(out, targets[targets.length - 1], ['create', 'modify'], 'command', ctx)
    }
    out.readOnly = false
    return cwd
  }
  if (name === 'ln' || name === 'link') {
    const targets = positionals(argv, ctx.platform, FLAGS_LN)
    if (targets.length >= 1) pushFileTarget(out, targets[targets.length - 1], ['create'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'chmod' || name === 'chown' || name === 'chgrp') {
    const targets = positionals(argv, ctx.platform, FLAGS_OWNER)
    for (const raw of targets.slice(1)) pushFileTarget(out, raw, ['modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'truncate') {
    const targets = positionals(argv, ctx.platform, FLAGS_TRUNCATE)
    for (const raw of targets) pushFileTarget(out, raw, ['modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'tee') {
    const targets = positionals(argv, ctx.platform, FLAGS_NONE)
    for (const raw of targets) pushFileTarget(out, raw, ['create', 'modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'dd') {
    const assignment = args.find(arg => lower(arg).startsWith('of='))
    if (assignment !== undefined) pushFileTarget(out, assignment.slice(3), ['create', 'modify'], 'command', ctx)
    else out.opaque = true
    out.readOnly = false
    return cwd
  }
  if (name === 'sed' || name === 'perl' || name === 'awk') {
    const inPlace = args.some(arg => lower(arg).startsWith('-i') || lower(arg) === '--in-place' || (name === 'awk' && lower(arg) === '-i'))
    if (!inPlace) {
      out.readOnly = true
      return cwd
    }
    /* sed/perl take a program text as the first positional (or after -e/-f); only the remaining
       positional arguments are files. awk's `-i inplace` is rarer and too easy to misparse; treat
       it as opaque rather than risk hiding a data file. */
    if (name === 'awk') {
      out.opaque = true
      out.readOnly = false
      return cwd
    }
    const expressionFlags = new Set(['-e', '--expression', '-f', '--file'])
    const hasExpressionFlag = args.some(arg => expressionFlags.has(lower(arg)))
    const targets = positionals(argv, ctx.platform, expressionFlags)
    const files = hasExpressionFlag ? targets : targets.slice(1)
    for (const raw of files) pushFileTarget(out, raw, ['modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'install') {
    const targets = positionals(argv, ctx.platform, FLAGS_INSTALL)
    const dest = targets[targets.length - 1]
    if (dest !== undefined) pushFileTarget(out, dest, ['create', 'modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'patch') {
    const targets = positionals(argv, ctx.platform, FLAGS_PATCH)
    const target = targets[targets.length - 1]
    if (target === undefined) out.opaque = true
    else pushFileTarget(out, target, ['modify'], 'command', ctx)
    out.readOnly = false
    return cwd
  }
  if (name === 'find') {
    const deleteIndex = args.findIndex(arg => arg === '-delete')
    const execIndex = args.findIndex(arg => arg === '-exec' || arg === '-execdir' || arg === '-ok')
    if (execIndex >= 0) {
      out.opaque = true
      out.readOnly = false
      return cwd
    }
    if (deleteIndex >= 0) {
      for (const raw of args.slice(0, deleteIndex).filter(arg => !isFlag(arg, ctx.platform))) {
        pushFolderTarget(out, raw, ['delete'], 'command', ctx, { uncertain: true, confidence: 'low' })
      }
      out.readOnly = false
      return cwd
    }
    out.readOnly = true
    return cwd
  }
  if (name === 'curl' || name === 'wget' || name === 'iwr' || name === 'invoke-webrequest' || name === 'invoke-restmethod') {
    const outFile = namedSingleValue(argv, ['-o', '--output', '-outfile', '--out'], ctx.platform)
    if (outFile !== undefined) pushFileTarget(out, outFile, ['create', 'modify'], 'command', ctx)
    else if (args.some(arg => arg === '-O' || arg === '--remote-name')) pushFolderTarget(out, cwd, ['create'], 'command', ctx, { confidence: 'low' })
    else out.readOnly = true
    out.readOnly = out.targets.length === 0
    return cwd
  }
  if (name === 'expand-archive' || name === 'compress-archive') {
    const dest = namedValueList(argv, ['-destinationpath'], ctx.platform)
    for (const raw of dest) pushFileTarget(out, raw, ['create', 'modify'], 'command', ctx)
    out.readOnly = dest.length === 0
    return cwd
  }

  /* PowerShell cmdlets (and their aliases). The aliases are handled before this point where they
     collide with POSIX names (rm, cp, mv, mkdir, ...). */
  if (name === 'remove-item' || name === 'ri' || name === 'clear-content' || name === 'clc' || name === 'set-content' || name === 'sc' || name === 'add-content' || name === 'ac' || name === 'out-file' || name === 'tee-object' || name === 'new-item' || name === 'ni' || name === 'copy-item' || name === 'cpi' || name === 'move-item' || name === 'mi' || name === 'rename-item' || name === 'rni' || name === 'set-itemproperty' || name === 'sp' || name === 'new-itemproperty' || name === 'remove-itemproperty' || name === 'rp' || name === 'set-acl' || name === 'export-csv' || name === 'export-clixml') {
    const paths = [...namedValueList(argv, PS_PATH_FLAGS, ctx.platform), ...namedValueList(argv, PS_DEST_FLAGS, ctx.platform), ...namedValueList(argv, ['-filepath', '-outfile'], ctx.platform)]
    const positional = positionals(argv, ctx.platform, PS_VALUE_FLAGS)
    let targets = paths
    if (targets.length === 0) {
      if (name === 'set-content' || name === 'sc' || name === 'add-content' || name === 'ac' || name === 'out-file' || name === 'tee-object' || name === 'export-csv' || name === 'export-clixml') {
        targets = positional.slice(0, 1)
      } else if (name === 'copy-item' || name === 'cpi' || name === 'move-item' || name === 'mi') {
        targets = positional.length >= 2 ? [positional[positional.length - 1]] : positional
      } else {
        targets = positional
      }
    }
    if (name === 'new-item' || name === 'ni') {
      const base = namedValueList(argv, PS_PATH_FLAGS, ctx.platform)[0] ?? positional[0]
      const child = namedValueList(argv, ['-name'], ctx.platform)[0]
      const itemType = lower(namedValueList(argv, ['-itemtype', '-type'], ctx.platform)[0] ?? '')
      const merged = []
      if (base !== undefined && child !== undefined) merged.push(pathModule(ctx.platform).join(base, child))
      else if (base !== undefined) merged.push(base)
      else if (child !== undefined) merged.push(child)
      else merged.push(...positional.slice(0, 1))
      for (const raw of merged) {
        if (itemType === 'directory' || itemType === 'symboliclink' || itemType === 'junction' || itemType === 'hardlink') pushFolderTarget(out, raw, ['create'], 'command', ctx)
        else pushFileTarget(out, raw, ['create'], 'command', ctx)
      }
    } else if (name === 'copy-item' || name === 'cpi') {
      const destNamed = namedSingleValue(argv, PS_DEST_FLAGS, ctx.platform)
      const dest = destNamed ?? positional[positional.length - 1]
      if (dest !== undefined) pushFileTarget(out, dest, ['create', 'modify'], 'command', ctx)
    } else if (name === 'move-item' || name === 'mi') {
      const destNamed = namedSingleValue(argv, PS_DEST_FLAGS, ctx.platform)
      const sources = [...namedValueList(argv, PS_PATH_FLAGS, ctx.platform), ...(destNamed === undefined ? positional.slice(0, -1) : positional)]
      for (const raw of sources) pushFileTarget(out, raw, ['delete', 'move'], 'command', ctx)
      const dest = destNamed ?? positional[positional.length - 1]
      if (dest !== undefined) pushFileTarget(out, dest, ['create', 'modify'], 'command', ctx)
    } else if (name === 'remove-item' || name === 'ri') {
      const recursive = args.some(arg => lower(arg) === '-recurse')
      for (const raw of targets) {
        if (recursive) pushFolderTarget(out, raw, ['delete'], 'command', ctx)
        else pushFileTarget(out, raw, ['delete'], 'command', ctx)
      }
    } else if (name === 'rename-item' || name === 'rni' || name === 'set-itemproperty' || name === 'sp' || name === 'new-itemproperty' || name === 'remove-itemproperty' || name === 'rp' || name === 'set-acl') {
      /* The first positional is the target path; later positionals are a new name / property /
         ACL value, not paths. */
      const first = positional[0]
      if (first !== undefined) pushFileTarget(out, first, ['modify'], 'command', ctx)
    } else {
      for (const raw of targets) pushFileTarget(out, raw, ['modify'], 'command', ctx)
    }
    out.readOnly = false
    return cwd
  }

  /* Remaining commands: known safe readers return early; everything else is opaque. Wrappers and
     control-flow keywords deliberately fall here so a nested write cannot slip through. */
  if (isReadOnly(name, argv, ctx)) {
    out.readOnly = redirects.length === 0 && out.targets.length === 0
    return cwd
  }
  if (WRAPPERS.has(name)) {
    out.opaque = true
    out.readOnly = false
    return cwd
  }
  out.opaque = true
  out.readOnly = false
  return cwd
}

function isReadOnly(name, argv, ctx) {
  if (name === '') return false
  if (READ_ONLY.has(name)) return true
  if (name.startsWith('get-') || name.startsWith('select-') || name.startsWith('measure-') || name.startsWith('compare-') || name.startsWith('sort-') || name.startsWith('format-') || name.startsWith('write-') || name.startsWith('test-') || name.startsWith('resolve-') || name.startsWith('search-') || name.startsWith('read-') || name.startsWith('import-') || name.startsWith('convertto-')) return true
  if (name === 'git' || name === 'svn') return true
  if (name === 'echo' || name === 'printf' || name === 'write-output' || name === 'write-host') return true
  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'node' || name === 'python' || name === 'py') {
    return argv.slice(1).some(arg => /^--version$/iu.test(arg) || arg === '-v' || arg === '-V' || arg === '--help')
  }
  return false
}

/* Parse one command string into pipeline/sequence segments and redirections. */
export function lexSegments(command, platform = process.platform) {
  const text = String(command ?? '')
  const segments = []
  let argv = []
  let redirects = []
  let token = ''
  let started = false
  let quote = ''
  let escaped = false
  let opaque = false

  const flushToken = () => {
    if (started) {
      argv.push(token)
      token = ''
      started = false
    }
  }
  const flushSegment = () => {
    flushToken()
    if (argv.length > 0 || redirects.length > 0) segments.push({ argv, redirects })
    argv = []
    redirects = []
  }
  const skipBalanced = (openIndex) => {
    let depth = 1
    let quoteState = ''
    for (let index = openIndex + 1; index < text.length; index += 1) {
      const ch = text[index]
      if (quoteState !== '') {
        if (ch === quoteState) quoteState = ''
        continue
      }
      if (ch === "'" || ch === '"') quoteState = ch
      else if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) return index
      }
    }
    return text.length - 1
  }
  const skipBacktick = (openIndex) => {
    for (let index = openIndex + 1; index < text.length; index += 1) {
      if (text[index] === '`') return index
    }
    return text.length - 1
  }
  const readRedirectTarget = (start) => {
    let index = start
    while (index < text.length && /\s/u.test(text[index])) index += 1
    let out = ''
    let state = ''
    for (; index < text.length; index += 1) {
      const ch = text[index]
      if (state !== '') {
        if (ch === state) { state = ''; continue }
        if (platform !== 'win32' && ch === '\\') { out += text[index + 1] ?? ''; index += 1; continue }
        out += ch
        continue
      }
      if (/\s/u.test(ch) || ch === ';' || ch === '|' || ch === '&' || ch === '>' || ch === '<') break
      if (ch === "'" || ch === '"') { state = ch; continue }
      if (platform !== 'win32' && ch === '\\') { out += text[index + 1] ?? ''; index += 1; continue }
      out += ch
    }
    return { text: out, end: index }
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote === "'") {
      if (ch === "'") quote = ''
      else { token += ch; started = true }
      continue
    }
    if (quote === '"') {
      if (escaped) { token += ch; escaped = false; continue }
      if (ch === '"') { quote = ''; continue }
      if (platform === 'win32' && ch === '`') { escaped = true; continue }
      if (platform!=='win32' && ch === '\\') { escaped = true; continue }
      if (ch === '$' && text[i + 1] === '(') { opaque = true; i = skipBalanced(i + 1); continue }
      if (platform !== 'win32' && ch === '`') { opaque = true; i = skipBacktick(i); continue }
      token += ch
      started = true
      continue
    }
    if (escaped) { token += ch; escaped = false; started = true; continue }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue }
    if (platform === 'win32' && ch === '`') { escaped = true; continue }
    if (platform !== 'win32' && ch === '\\') { escaped = true; continue }
    if (ch === '#' && !started && (i === 0 || /\s/u.test(text[i - 1]))) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1
      continue
    }
    if (ch === ':' && text[i + 1] === ':' && !started) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1
      continue
    }
    if (ch === '$' && text[i + 1] === '(') { opaque = true; i = skipBalanced(i + 1); continue }
    if (platform !== 'win32' && ch === '`') { opaque = true; i = skipBacktick(i); continue }
    if (ch === '{' || ch === '}' || ch === '(' || ch === ')') { opaque = true; flushToken(); continue }
    if (ch === '@' && !started) continue
    if (ch === ';' || ch === '\n') { flushSegment(); continue }
    if (ch === '&') {
      if (text[i + 1] === '&') { flushSegment(); i += 1; continue }
      if (text[i + 1] === '>') {
        flushToken()
        i += 1
        let op = '>'
        if (text[i + 1] === '>') { op = '>>'; i += 1 }
        const target = readRedirectTarget(i + 1)
        if (target.text === '') opaque = true
        else redirects.push({ op, path: target.text })
        i = target.end - 1
        continue
      }
      if (argv.length === 0 && redirects.length === 0) continue
      flushSegment()
      continue
    }
    if (ch === '|') {
      if (text[i + 1] === '|') i += 1
      flushSegment()
      continue
    }
    if (ch === '>') {
      flushToken()
      let op = '>'
      if (text[i + 1] === '>') { op = '>>'; i += 1 }
      let index = i + 1
      while (index < text.length && /\s/u.test(text[index])) index += 1
      if (text[index] === '&' && /[0-9]/u.test(text[index + 1] ?? '')) { i = index + 1; continue }
      const target = readRedirectTarget(index)
      if (target.text === '') opaque = true
      else redirects.push({ op, path: target.text })
      i = target.end - 1
      continue
    }
    if (/\s/u.test(ch) || ch === ',') { flushToken(); continue }
    token += ch
    started = true
  }
  flushSegment()
  return { segments, opaque }
}

/**
 * Analyze one console command.
 * @param {object} input
 * @param {string} input.command - raw command string.
 * @param {string} input.workdir - absolute working directory.
 * @param {string} [input.platform] - process.platform.
 * @param {string} [input.homeDir] - user home (for `~` / root checks).
 * @param {object} [input.env] - environment used for variable expansion.
 * @param {string} [input.scriptDir] - directory of the script being analyzed, if any.
 * @param {string} [input.scriptPath] - path of the script being analyzed, if any.
 * @param {number} [input.maxTargets] - target cap.
 * @returns {{readOnly:boolean, opaque:boolean, targets:Array, scripts:Array, nested:Array, runners:Array, notes:Array}}
 */
export function analyzeCommand(input) {
  const platform = input?.platform ?? process.platform
  const cwdBase = typeof input?.workdir === 'string' && input.workdir !== '' ? input.workdir : process.cwd()
  const maxTargets = Number.isFinite(input?.maxTargets) ? Math.max(1, Math.floor(input.maxTargets)) : 50
  const lexed = lexSegments(input?.command ?? '', platform)
  const result = { readOnly: !lexed.opaque, opaque: lexed.opaque, targets: [], scripts: [], nested: [], runners: [], notes: [] }
  let cwd = cwdBase
  let allReadOnly = true
  for (const segment of lexed.segments) {
    const out = { readOnly: false, opaque: false, targets: [], scripts: [], nested: [], runners: [] }
    const ctx = { platform, homeDir: input?.homeDir ?? homedir(), env: input?.env ?? process.env, cwd, scriptDir: input?.scriptDir, scriptPath: input?.scriptPath }
    cwd = analyzeSegment(segment, cwd, out, ctx)
    if (out.opaque) result.opaque = true
    if (!out.readOnly) allReadOnly = false
    for (const target of out.targets) result.targets.push(target)
    for (const script of out.scripts) result.scripts.push(script)
    for (const nested of out.nested) result.nested.push(nested)
    for (const runner of out.runners) result.runners.push(runner)
  }
  const deduped = dedupeTargets(result.targets, platform)
  if (deduped.length > maxTargets) result.opaque = true
  result.targets = deduped.slice(0, maxTargets)
  result.readOnly = allReadOnly && !result.opaque && result.targets.length === 0 && result.scripts.length === 0 && result.nested.length === 0 && result.runners.length === 0
  return result
}

function dedupeTargets(targets, platform = process.platform) {
  const byKey = new Map()
  for (const target of targets) {
    if (target === null || target === undefined || typeof target.path !== 'string' || target.path === '') continue
    const key = `${normalizeForCompare(target.path, platform)}|${target.kind}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, { ...target, operations: [...new Set(target.operations ?? [])] })
      continue
    }
    existing.operations = [...new Set([...(existing.operations ?? []), ...(target.operations ?? [])])]
    if (target.confidence === 'low') existing.confidence = 'low'
  }
  return [...byKey.values()]
}

/** Build the strict-JSON prompt for the optional AI analyzer. */
export function buildAiAnalysisInput({ command, cwd, scripts, maxChars = 65536 }) {
  let remaining = maxChars
  const parts = []
  for (const script of Array.isArray(scripts) ? scripts : []) {
    if (script === null || script === undefined || typeof script.path !== 'string') continue
    const text = typeof script.text === 'string' ? script.text : ''
    if (text === '' || remaining <= 0) continue
    const clipped = text.slice(0, remaining)
    remaining -= clipped.length
    parts.push({ path: String(script.path), content: clipped })
  }
  return JSON.stringify({ command: String(command ?? ''), workdir: String(cwd ?? ''), scripts: parts })
}

/** Validate one AI answer; returns a normalized target list or null when the answer is unusable. */
export function validateAiAnalysis(value, { workdir, platform = process.platform, maxTargets = 50 }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  /* The brief is presentation data, never an instruction channel: keep it plain, single-paragraph,
     bounded, and independent of the target validation below. */
  const summary = typeof value.summary === 'string'
    ? value.summary.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 240)
    : ''
  const confidence = value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low'
    ? value.confidence
    : 'low'
  if (value.opaque === true) return { opaque: true, targets: [], summary, confidence }
  if (!Array.isArray(value.targets)) return null
  const pathMod = pathModule(platform)
  const targets = []
  const allowedOperations = new Set(['delete', 'modify', 'create', 'move'])
  for (const entry of value.targets) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    if (typeof entry.path !== 'string' || entry.path === '' || entry.path.length > 4096) return null
    const kind = entry.kind === 'folder' ? 'folder' : 'file'
    const operations = Array.isArray(entry.operations)
      ? entry.operations.filter(op => allowedOperations.has(op))
      : []
    if (operations.length === 0) continue
    let target = entry.path
    if (!pathMod.isAbsolute(target)) target = pathMod.resolve(workdir, target)
    target = pathMod.normalize(target)
    targets.push({
      path: target,
      kind,
      operations: [...new Set(operations)],
      source: 'ai',
      confidence: entry.confidence === 'low' ? 'low' : 'high',
    })
    if (targets.length >= maxTargets) break
  }
  return { opaque: false, targets, summary, confidence }
}
