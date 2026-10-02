/**
 * Module-evaluation guard: every client module and both built artifacts must be
 * IMPORTABLE, not merely parseable.
 *
 * A stray backtick inside a CSS comment in styles.js ends the file's single
 * template literal early, so the rest of the comment parses as expressions
 * (`….cm-scroller` becomes a member access minus an identifier). `tsdown` builds
 * it, `node --check` passes it, and it only explodes when the plugin is imported —
 * the GUI then reports "Failed to load plugins … import failed: scroller is not
 * defined" and every layout-dependent entry stays pending. A module-scope TDZ or
 * any other top-level throw fails the same way. Evaluating each module is the only
 * check that catches the class; the styles.js backtick count is asserted too, so
 * that specific hazard keeps its own precise message.
 *
 * Harness packages (@deepseek-ai/dsh-client-*) are not installed in this repo, so a
 * module that imports one cannot be evaluated here: it is SKIPPED, never failed.
 * lib/client.js is not imported on purpose — it is a browser bundle that needs a DOM
 * (`node --check` covers its syntax); the two Host artifacts are imported, because a
 * throw at their import time means the plugin never loads at all.
 *
 * See AGENTS.md「交付铁律」 and docs/development-notes.md §42.
 * Run: npm run check:client-modules
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, relative, sep } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLIENT = join(ROOT, 'src', 'client')

/** Built artifacts that must import cleanly (lib/client.js is DOM-bound and checked by node --check). */
const ARTIFACTS = ['lib/index.js', 'lib/invariant.js'].map(path => join(ROOT, path))

/**
 * Collect every .js source under a directory.
 * @param dir - directory to walk.
 * @returns absolute file paths, depth-first.
 */
function sources(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sources(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

const failures = []
let evaluated = 0
let skipped = 0

for (const file of [...sources(CLIENT), ...ARTIFACTS.filter(path => existsSync(path))]) {
  const where = relative(ROOT, file).split(sep).join('/')
  try {
    await import(pathToFileURL(file).href)
    evaluated += 1
  } catch (error) {
    /* An uninstalled harness package is an environment limit, not a defect: the module cannot be
       evaluated here at all (and stubbing it would turn the module's own top-level calls into
       false failures). */
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('Cannot find package')) {
      skipped += 1
      continue
    }
    failures.push(`${where}  ${error?.constructor?.name ?? 'Error'}: ${String(error?.message).split('\n')[0]}`)
  }
}

/* styles.js is one template literal, so its backtick count is exactly the two delimiters. */
const stylesSource = readFileSync(join(CLIENT, 'styles.js'), 'utf8')
const backticks = (stylesSource.match(/`/g) ?? []).length
if (backticks !== 2) {
  failures.push(`src/client/styles.js  expected exactly 2 backticks (the stylesheet template literal), found ${backticks}\n`
    + '    write CSS selectors bare (or in "double quotes") inside the stylesheet comments')
}

/* Undeclared SCREAMING_SNAKE constants: a module constant used but never imported is a free
   identifier, so `tsdown` bundles it, `node --check` passes and the module imports fine — it only
   throws `ReferenceError: X is not defined` when the handler that mentions it finally RUNS (a
   click, a keystroke). Evaluating modules cannot catch that: nothing executes the callback.
   Every SCREAMING_SNAKE identifier in these sources is a module constant, which makes a textual
   check exact enough: after comments and literals are stripped, each one must be DECLARED (import
   clause, export, declarator, object key) rather than merely used. See development-notes §45. */
const CONSTANT = /(?<![.\w$])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g

/** Blank out comments and string/template literals so the scan never reads prose or data. */
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
    } else if (char === '"' || char === '\'' || char === '`') {
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

for (const file of sources(CLIENT)) {
  const where = relative(ROOT, file).split(sep).join('/')
  const source = stripLiterals(readFileSync(file, 'utf8'))
  const missing = [...new Set([...source.matchAll(CONSTANT)].map(match => match[1]))].filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    /* Declared or assigned: `const X = 1`, a declarator inside a comma list, `X = value`. The
       lookahead keeps `==`, `===` and `=>` from reading as an assignment. */
    if (new RegExp(`(?:^|[^\\w$.])\\s*${escaped}\\s*=(?![=>])`).test(source)) return false
    /* Member of an import/export clause, a destructuring pattern, a declarator list or an object
       literal — always written right after `{` or `,`, then the name, then `,` `}` or `:`. A ternary
       (`? X :`) and a bare call argument (`f(X)`) do NOT satisfy the leading brace/comma. */
    if (new RegExp(`[{,]\\s*${escaped}\\s*[,}:]`).test(source)) return false
    return true
  })
  if (missing.length > 0) {
    failures.push(`${where}  uses undeclared constant${missing.length > 1 ? 's' : ''} ${missing.join(', ')}\n`
      + '    import it (or fix the typo): a free identifier throws ReferenceError only when the code runs')
  }
}

if (failures.length > 0) {
  console.error('check:client-modules FAILED — these throw when the plugin is imported (AGENTS.md「交付铁律」):\n')
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}
console.log(`check:client-modules OK — ${evaluated} modules evaluated, ${skipped} skipped (harness packages not installed here)`)
