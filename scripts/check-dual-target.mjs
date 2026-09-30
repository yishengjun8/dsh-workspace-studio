/**
 * Dual-target guard: this plugin must work on the served Web page and inside the
 * Desktop (Electron) shell from the SAME sources. The shell serves the page from
 * dsh-app://app while the Host listens on a loopback HTTP origin, so client code
 * that assumes "the page origin is the Host origin", hardcodes an authority or a
 * port, or branches on Desktop-only globals silently breaks there.
 *
 * Comments are blanked (newlines kept, so line numbers stay exact) before matching:
 * prose may name a Desktop origin, executable code may not.
 *
 * See AGENTS.md "双端目标（Web + 桌面端）" and docs/development-notes.md §39.
 * Run: npm run check:dual-target
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CLIENT = join(SRC, 'client')

/** One forbidden pattern, the scope it applies to, and why it breaks a target. */
const RULES = [
  { scope: 'all', pattern: /\b3080\b/, why: 'port literal: the Desktop Host does not listen on the Web port' },
  { scope: 'all', pattern: /\b19387\b/, why: 'port literal: never hardcode a Host port' },
  {
    scope: 'client',
    pattern: /\b127\.0\.0\.1\b|\blocalhost\b/,
    why: 'Host-authority literal: use a document-relative URL, or globalThis.__DSH_TRANSPORT__?.streamBaseUrl behind it',
  },
  {
    scope: 'client',
    pattern: /\bdsh-app\b|\bdshDesktop\b|__DSH_DIRECTORY_PICKER__/,
    why: 'Desktop-only branch: probe the shared capability (__DSH_TRANSPORT__, a harness service), never the shell',
  },
]

/** The one allowed new-window shape: the href absolutized for a page that is not same-origin with its Host. */
const WINDOW_OPEN = /window\.open\(/
const ALLOWED_WINDOW_OPEN = /window\.open\(hostAbsoluteHref\(/

/**
 * Collect every .js source under a directory.
 * @param dir - directory to walk.
 * @returns absolute file paths.
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

/**
 * Blank every comment while preserving string literals and newlines.
 * @param text - whole file contents.
 * @returns the same text with comment characters replaced by spaces.
 */
function blankComments(text) {
  let out = ''
  let state = 'code'
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'line'; index += 1; continue }
      if (char === '/' && next === '*') { state = 'block'; index += 1; continue }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
      out += char
      continue
    }
    if (state === 'line') {
      if (char === '\n') { state = 'code'; out += char }
      continue
    }
    if (state === 'block') {
      if (char === '*' && next === '/') { state = 'code'; index += 1 }
      else if (char === '\n') out += char
      continue
    }
    if (char === '\\') { out += char + (next ?? ''); index += 1; continue }
    if ((state === 'single' && char === "'") || (state === 'double' && char === '"')
      || (state === 'template' && char === '`')) state = 'code'
    out += char
  }
  return out
}

const failures = []
for (const file of sources(SRC)) {
  const isClient = file.startsWith(CLIENT + sep)
  const lines = blankComments(readFileSync(file, 'utf8')).split(/\r?\n/)
  lines.forEach((line, index) => {
    const where = `${relative(ROOT, file).split(sep).join('/')}:${index + 1}`
    for (const rule of RULES) {
      if (rule.scope === 'client' && !isClient) continue
      if (rule.pattern.test(line)) failures.push(`${where}  ${rule.why}\n    ${line.trim()}`)
    }
    if (isClient && WINDOW_OPEN.test(line) && !ALLOWED_WINDOW_OPEN.test(line)) {
      failures.push(`${where}  window.open() with a page-origin URL is denied by the Desktop shell; go through hostAbsoluteHref()\n    ${line.trim()}`)
    }
  })
}

/**
 * The Windows Desktop shell draws its caption row (drag strip, preload-mounted
 * menu bar, native window controls) over the page, and the shipped layout
 * reserved it inside its own frame — the very frame this plugin's patch
 * disables. The plugin's frame must therefore carry both the reservation and the
 * drag area, or the layout renders under the menu bar again and the window has
 * no drag region at all. See docs/development-notes.md §39.
 */
const CAPTION_BAND = [
  {
    pattern: /html\[data-windows-titlebar\][^{]*\.dsh-ws-frame\{[^}]*padding-top:\s*var\(--dsh-ws-caption-h\)/,
    why: 'the Desktop caption band is no longer reserved: .dsh-ws-frame needs box-sizing:border-box plus padding-top:var(--dsh-ws-caption-h)',
  },
  {
    pattern: /html\[data-windows-titlebar\][^{]*\.dsh-ws-frame::before\{[^}]*-webkit-app-region:\s*drag/,
    why: 'the Desktop caption band is no longer draggable: ui-layout owned the window drag area and this plugin disables it',
  },
]
const styleSheet = readFileSync(join(CLIENT, 'styles.js'), 'utf8')
for (const rule of CAPTION_BAND) {
  if (!rule.pattern.test(styleSheet)) failures.push(`src/client/styles.js  ${rule.why}`)
}

if (failures.length > 0) {
  console.error('check:dual-target FAILED — these break the Desktop (or Web) target (AGENTS.md「双端目标」):\n')
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}
console.log('check:dual-target OK — no Host-authority, port, or Desktop-only assumptions in src/')
