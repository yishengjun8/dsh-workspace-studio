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

if (failures.length > 0) {
  console.error('check:client-modules FAILED — these throw when the plugin is imported (AGENTS.md「交付铁律」):\n')
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}
console.log(`check:client-modules OK — ${evaluated} modules evaluated, ${skipped} skipped (harness packages not installed here)`)
