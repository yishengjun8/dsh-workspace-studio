/**
 * Locale-pair guard: the zh dictionary is the source and `en` must be its exact
 * mirror — same key set, no duplicates on either side, and no CJK left in the
 * English copy (a pasted Chinese string is the usual way a "translated" entry
 * ships untranslated).
 *
 * The two dictionaries are plain object modules, so this reads them as data
 * rather than importing them (no build step, no harness packages needed).
 *
 * Run: node scripts/check-locale-keys.mjs   (npm run check:locale-keys)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FILES = ['zh', 'en'].map(name => ({ name, path: join(ROOT, 'src', 'client', 'locale', `${name}.js`) }))

/** `'key': value` pairs of one dictionary, in source order, with their line numbers. */
function entriesOf(file) {
  const text = readFileSync(file.path, 'utf8')
  const entries = []
  const pattern = /^\s*'([^']+)':/gm
  let match
  while ((match = pattern.exec(text)) !== null) {
    entries.push({ key: match[1], line: text.slice(0, match.index).split('\n').length })
  }
  return entries
}

/** CJK ideographs plus the CJK punctuation block: the English dictionary must not contain them.
 *  The full-width ASCII forms (U+FF00–U+FFEF) are deliberately EXCLUDED — the English copy legitimately
 *  quotes UI glyphs such as the full-width plus sign in `＋ New collection`. */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/

const failures = []
const sets = {}
for (const file of FILES) {
  const entries = entriesOf(file)
  const seen = new Map()
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      failures.push(`src/client/locale/${file.name}.js:${entry.line}  duplicate key '${entry.key}' (first at line ${seen.get(entry.key)})`)
    }
    seen.set(entry.key, entry.line)
  }
  sets[file.name] = new Set(entries.map(entry => entry.key))
  console.log(`${file.name}: ${entries.length} keys`)
}

for (const key of sets.zh) if (!sets.en.has(key)) failures.push(`en is missing '${key}'`)
for (const key of sets.en) if (!sets.zh.has(key)) failures.push(`en has an extra key '${key}'`)

/* Only the English dictionary's VALUES are inspected for CJK; its keys are ASCII. */
const enText = readFileSync(FILES[1].path, 'utf8')
enText.split('\n').forEach((line, index) => {
  const value = line.replace(/^\s*'[^']+':\s*/, '')
  if (CJK.test(value)) failures.push(`src/client/locale/en.js:${index + 1}  untranslated CJK in ${line.trim().slice(0, 80)}`)
})

if (failures.length > 0) {
  console.error(`\ncheck:locale-keys FAILED — ${failures.length} problem(s):\n`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`check:locale-keys OK — zh and en agree on ${sets.zh.size} keys, no CJK in en`)
