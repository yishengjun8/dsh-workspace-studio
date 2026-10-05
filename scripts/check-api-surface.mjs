/**
 * API-surface guard: the client's route mirror and the Host's route table must
 * agree, and the client must have exactly ONE network transport.
 *
 * Two failures this catches, both invisible until a user clicks:
 *   - a client call to a route the Host does not serve (runtime 404);
 *   - a Host route whose client side was renamed or dropped (dead endpoint).
 * It also enforces the "one transport" rule the interface cleanup established:
 * `fetch(` may appear once in the whole client bundle, inside src/client/api.js.
 *
 * The two tables are read as TEXT on purpose: src/client/api.js imports harness
 * packages that are not installed in this repo, so it cannot be imported here
 * (see check-client-modules.mjs for the same constraint).
 *
 * Run: node scripts/check-api-surface.mjs   (npm run check:api-surface)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const API_JS = join(ROOT, 'src', 'client', 'api.js')
const HOST_INDEX = join(ROOT, 'src', 'host', 'index.js')

/* Routes the browser itself opens, so no client fetch helper names them:
   the HTML preview's token-gated byte route is built inside src/host/site.js
   (its URL lives in the page's <base>, never in api.js). */
const HOST_ONLY = new Set([])

/** Every `${API_PREFIX}/…` path literal of the Host route table. */
function hostPaths() {
  const text = readFileSync(HOST_INDEX, 'utf8')
  const paths = new Set()
  for (const match of text.matchAll(/\$\{API_PREFIX\}(\/[A-Za-z0-9/_-]*)/g)) paths.add(match[1])
  return paths
}

/** Every `path: '/…'` entry of the client ROUTES table, plus the route KEYS that use it. */
function clientRoutes() {
  const text = readFileSync(API_JS, 'utf8')
  const routes = new Map()
  for (const match of text.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{\s*path:\s*'(\/[^']*)'/gm)) {
    routes.set(match[2], match[1])
  }
  return routes
}

const failures = []
const host = hostPaths()
const client = clientRoutes()

for (const [path, key] of client) {
  if (!host.has(path)) failures.push(`src/client/api.js  ROUTES.${key} calls '${path}', which src/host/index.js does not serve`)
}
for (const path of host) {
  if (!client.has(path) && !HOST_ONLY.has(path)) failures.push(`src/host/index.js  serves '${path}' but no client ROUTES entry uses it`)
}

/* Every declared route must actually be used by an exported helper: an orphan entry is a
   route the client will never reach (and a sign the mirror has drifted). */
const apiText = readFileSync(API_JS, 'utf8')
for (const [, key] of client) {
  if (!new RegExp(`ROUTES\\.${key}\\b`).test(apiText.replace(/^\s{2}[A-Za-z0-9_]+:\s*\{[^}]*\},?$/gm, ''))) {
    failures.push(`src/client/api.js  ROUTES.${key} is declared but never used`)
  }
}

/* One transport: `fetch(` only in api.js. */
for (const file of (function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path)
  }
  return out
})(join(ROOT, 'src', 'client'))) {
  const where = relative(ROOT, file).split(sep).join('/')
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const count = (text.match(/(?<![\w.])fetch\s*\(/g) ?? []).length
  if (where.endsWith('src/client/api.js')) {
    if (count !== 1) failures.push(`${where}  expected exactly 1 fetch() call (the single transport), found ${count}`)
  } else if (count !== 0) {
    failures.push(`${where}  calls fetch() directly: every request must go through src/client/api.js`)
  }
}

if (failures.length > 0) {
  console.error('check:api-surface FAILED — the client/Host interface has drifted:\n')
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}
console.log(`check:api-surface OK — ${client.size} client routes mirror the Host table, one fetch() transport`)
