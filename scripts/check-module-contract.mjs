/**
 * Module-contract guard: the internal module surface must be consistent.
 *
 *   1. every name a module IMPORTS from another module of this package must actually be EXPORTED there;
 *   2. no module may import a name it never uses (a dead import);
 *   3. every name this package EXPORTS somewhere, used inside another module, must be IMPORTED (or
 *      declared) there.
 *
 * Why this exists: an un-exported symbol that another module imports is a hard BUNDLE failure, but a
 * purely textual sweep for "unused exports" cannot tell `NAME` from `NAMES` (a prefix collision) and
 * cannot see a comma-separated declarator list (`export const A = 1, B = 2`, where one keyword covers
 * both names). Both mistakes were made once while cleaning up the export surface; this guard makes
 * them impossible to repeat without needing a build.
 *
 * Rule 3 covers the opposite failure — a package-local helper CALLED without being imported. That is a
 * free identifier: it bundles fine and throws `ReferenceError: X is not defined` only when the code
 * path runs (a dialog opens, a filter applies). It bit `Modal` and `createStyleSheet`, and neither
 * `node --check` nor check-client-modules' SCREAMING_SNAKE pass can see a mixed-case helper.
 *
 * Two implementation rules learned the hard way:
 *   - ANCHORS: JavaScript has no inline `(?m)` flag — passing it to `new RegExp` throws
 *     "Invalid group". Use the `m` flag argument.
 *   - IMPORTS ARE PARSED FROM THE RAW SOURCE: blanking string literals (as a "used exactly once"
 *     check wants) destroys the module specifier, which silently matches nothing at all.
 *
 * Run: node scripts/check-module-contract.mjs   (npm run check:module-contract)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

/** Collect every .js source under a directory. */
function sources(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sources(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

/** Blank comments and string/template literals, keeping newlines so line numbers stay exact. */
/* Whether a `/` at this point in the emitted code opens a REGEX rather than being division: only where a
   value may start (after an operator / opener / comma / semicolon) or after a keyword that takes an
   expression. Deliberately conservative — a missed regex literal only costs a possible false positive,
   while misreading division as a regex would blank real code. */
const REGEX_AFTER_CHAR = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'new', 'delete', 'void', 'instanceof', 'default'])
function startsRegex(emitted) {
  let last = ''
  for (let index = emitted.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(emitted[index])) { last = emitted[index]; break }
  }
  if (REGEX_AFTER_CHAR.has(last)) return true
  const word = /([A-Za-z_$][\w$]*)\s*$/.exec(emitted)
  return word !== null && REGEX_AFTER_WORD.has(word[1])
}

function stripLiterals(source) {
  let out = ''
  let index = 0
  while (index < source.length) {
    const two = source.slice(index, index + 2)
    const char = source[index]
    if (two === '//') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
    } else if (two === '/*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      out += ' '
    } else if (char === '/' && two !== '//' && two !== '/*' && startsRegex(out)) {
      /* A regex literal counts as literal TEXT: `[/^(zh|yue)/, 'gb18030']` must not read as a use of a
         binding named `zh`. `startsRegex` is what keeps `a / b` (division) from being eaten here. */
      index += 1
      let inClass = false
      while (index < source.length) {
        const inner = source[index]
        if (inner === '\\') { index += 2; continue }
        if (inner === '[') inClass = true
        else if (inner === ']') inClass = false
        else if (inner === '/' && !inClass) break
        else if (inner === '\n') break
        index += 1
      }
      index += 1
      while (index < source.length && /[a-z]/i.test(source[index])) index += 1
      out += '/""/'
    } else if (char === '"' || char === "'" || char === '`') {
      index += 1
      while (index < source.length && source[index] !== char) index += source[index] === '\\' ? 2 : 1
      index += 1
      out += '""'
    } else {
      out += char
      index += 1
    }
  }
  return out
}

/**
 * Whether `name` is exported by `source`.
 *
 * Three shapes count: a declaration keyword after `export` (`export function f`, possibly on the same
 * line as a leading block comment — several modules open with `/* … *​/ export function X(…)`),
 * a declarator inside an exported list on ONE line (`export const A = 1, B = 2`), and an
 * `export { … }` clause.
 *
 * The declarations of `//`-commented-out code must not count, so line comments are removed first;
 * block comments are deliberately kept, because a leading block comment on the same line is the shape
 * a line anchor would miss.
 */
function isExported(source, name) {
  const withoutLineComments = source.replace(/^\s*\/\/.*$/gm, '')
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${escaped}\\b`).test(withoutLineComments)) return true
  if (new RegExp(`\\bexport\\s+(?:const|let|var)\\s[^\\n]*\\b${escaped}\\s*=`).test(withoutLineComments)) return true
  if (new RegExp(`export\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`).test(withoutLineComments)) return true
  return false
}

/* NOTE: both checks below run on the RAW source, never on a "blank the literals" copy. Blanking
   strings also blanks the module specifiers (making the import scan match nothing at all) and blanking
   template literals hides real uses (`${API_PREFIX}` inside a template read as "imported but never
   used"), while a regex literal containing a quote desynchronizes the scanner and swallows the rest of
   the file. The cost of raw matching is a false NEGATIVE when a name appears only in a comment — the
   right trade-off for a build guard. */
const files = sources(SRC)
const raw = new Map(files.map(file => [file, readFileSync(file, 'utf8')]))
const failures = []
let checkedImports = 0
for (const file of files) {
  const where = relative(ROOT, file).split(sep).join('/')
  const source = raw.get(file)
  /* The import clauses themselves are removed before the "is it used" scan, so a name that only
     appears in an import list cannot count as used. */
  const body = source.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g, '')
  for (const clause of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const specifier = clause[2]
    if (!specifier.startsWith('.')) continue
    const target = resolve(dirname(file), specifier)
    const targetSource = raw.get(target)
    if (targetSource === undefined) {
      failures.push(`${where}  imports from an unresolved local module ${specifier}`)
      continue
    }
    for (const rawName of clause[1].split(',')) {
      const name = rawName.replace(/\s+as\s+[\s\S]*$/, '').replace(/^\s*type\s+/, '').trim()
      if (name === '') continue
      checkedImports += 1
      if (!isExported(targetSource, name)) {
        failures.push(`${where}  imports { ${name} } which ${relative(ROOT, target).split(sep).join('/')} does not export`)
        continue
      }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      /* No lookbehind before the name: a spread use (`...name`) is preceded by a dot, and rejecting
         that read as "imported but never used". A member access (`obj.name`) therefore also counts as
         a use — acceptable, because this package has no namespace imports, so a member access can
         never be how an imported binding is consumed. */
      if (!new RegExp(`${escaped}(?![\\w$])`).test(body)) {
        failures.push(`${where}  imports { ${name} } but never uses it`)
      }
    }
  }
}

/* ---- rule 3: a name this package exports elsewhere must be imported (or declared) here ----
   Collect every exported name of the package, then look for a module that USES one of them as a call
   without importing it. Method calls (`x.Modal(`) and property keys are excluded, and a local
   declaration of the same name counts as legitimate shadowing. */
const exportedNames = new Map()
for (const file of files) {
  const source = raw.get(file)
  for (const match of source.matchAll(/^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) {
    if (!exportedNames.has(match[1])) exportedNames.set(match[1], file)
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of match[1].split(',')) {
      const name = entry.replace(/\s+as\s+[\s\S]*$/, '').trim()
      if (name !== '' && !exportedNames.has(name)) exportedNames.set(name, file)
    }
  }
}
for (const file of files) {
  const where = relative(ROOT, file).split(sep).join('/')
  const source = raw.get(file)
  const code = stripLiterals(source)
  const imported = new Set()
  for (const clause of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const entry of clause[1].split(',')) imported.add(entry.replace(/\s+as\s+[\s\S]*$/, '').trim())
  }
  for (const [name, owner] of exportedNames) {
    if (owner === file || imported.has(name)) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    /* ANY bare reference in CODE (comments and string literals are blanked first) counts, not just a
       call: a component is passed as a VALUE (`h(Row, {…})`, `createPortal(<Modal/>, …)`), so a
       call-shaped test alone missed exactly the missing imports this rule exists for. A member access
       (`obj.Row`) and a quoted string are excluded by the lookbehind / the literal stripping. */
    const used = new RegExp(`(?<![.\\w$])${escaped}(?![\\w$])`).test(code)
    if (!used) continue
    /* A local declaration or a destructured parameter/property of that name is legitimate shadowing —
       this is how a component receives `saveFile` as a prop. */
    if (new RegExp(`(?:^|[^\\w$.])(?:const|let|var|function|class)\\s+${escaped}\\b`).test(source)) continue
    if (new RegExp(`[{,]\\s*${escaped}\\s*[,}:]`).test(source)) continue
    /* A function PARAMETER of that name (`(name) => …`, `function f(name) {`) is shadowing too. */
    if (new RegExp(`\\([^)]*\\b${escaped}\\b[^)]*\\)\\s*(=>|\\{)`).test(code)) continue
    /* …including the paren-less single-parameter arrow (`header => …`). */
    if (new RegExp(`(?:^|[^\\w$.])${escaped}\\s*=>`).test(code)) continue
    /* A METHOD DEFINITION of that name (`apply(snapshot){`) is a definition, not a use of the exported
       binding — `theme.js` is one long line of class methods. The shape is deliberately narrow: a call
       followed by an opening brace on the SAME line, which `if (foo(a)) {` does not match. */
    if (new RegExp(`(?<![.\\w$])${escaped}\\s*\\([^\\n]*?\\)\\s*\\{`).test(source)) continue
    failures.push(`${where}  uses ${name} (exported by ${relative(ROOT, owner).split(sep).join('/')}) without importing it`)
  }
}

if (failures.length > 0) {
  console.error('check:module-contract FAILED — the internal module surface is inconsistent:\n')
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}
console.log(`check:module-contract OK — ${files.length} modules, ${checkedImports} imported names all exported and used`)
