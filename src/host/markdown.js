/** Server-side Markdown → HTML rendering for the "open in new window" tab action on Markdown files. The GUI's own renderer (MarkdownText) is a client React component that cannot run in the opened tab, so the Host renders a self-contained document instead. The untrusted-output policy mirrors MarkdownText: raw HTML renders as literal text, link destinations pass a protocol allowlist (http/https/mailto), images require absolute HTTP(S), and disallowed destinations render as plain text. */
import { Buffer } from 'node:buffer'
import { Marked } from 'marked'
import { decodeBytes } from './encodings.js'

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/* A destination is renderable only when it parses as an absolute URL with an allowlisted protocol (MarkdownText parity: relative destinations and disallowed schemes render as plain text). */
function safeHref(href) {
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(href).protocol) ? href : undefined
  } catch {
    return undefined
  }
}

/* Images additionally require absolute HTTP(S) (MarkdownText parity). */
function safeImageSrc(href) {
  try {
    const protocol = new URL(href).protocol
    return protocol === 'http:' || protocol === 'https:' ? href : undefined
  } catch {
    return undefined
  }
}

/* Partial renderer merged over marked's defaults via Marked#use: methods here run first and only fall back to the default when they return false. `this` is the default Renderer instance, so nested children render through this.parser. */
const SAFE_RENDERER = {
  /* Raw HTML never enters the DOM: it renders as literal text. */
  html({ text }) {
    return escapeHtml(text)
  },
  link({ href, title, text, tokens, autolink }) {
    const content = autolink ? escapeHtml(text) : this.parser.parseInline(tokens)
    const safe = safeHref(href)
    if (safe === undefined) return content
    const external = safe.startsWith('http:') || safe.startsWith('https:')
    const titleAttr = title === undefined || title === null || title === '' ? '' : ` title="${escapeHtml(title)}"`
    const target = external ? ' target="_blank"' : ''
    const rel = external ? ' rel="noopener noreferrer"' : ''
    return `<a href="${escapeHtml(safe)}"${titleAttr}${target}${rel}>${content}</a>`
  },
  image({ href, title, text }) {
    const src = safeImageSrc(href)
    if (src === undefined) {
      /* MarkdownText parity: a disallowed image renders as its alt text. */
      return `<span class="dsh-ws-md-image-alt">${escapeHtml(text)}</span>`
    }
    const titleAttr = title === undefined || title === null || title === '' ? '' : ` title="${escapeHtml(title)}"`
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy" decoding="async" referrerpolicy="no-referrer">`
  },
}

/* One shared instance: parse is synchronous and the renderer is stateless, so concurrent requests cannot interfere. */
const MARKED = new Marked({ gfm: true })
MARKED.use({ renderer: SAFE_RENDERER })

/* Minimal GitHub-flavored document styling; the opened tab is a unique origin and cannot read the GUI theme, so dark mode follows the system. */
const DOCUMENT_STYLE = `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;line-height:1.65;color:#1f2328;background:#fff}main{max-width:880px;margin:0 auto;padding:28px 22px 72px}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.5em 0 .6em;font-weight:600}h1{font-size:1.75em;padding-bottom:.3em;border-bottom:1px solid #d8dee4}h2{font-size:1.35em;padding-bottom:.3em;border-bottom:1px solid #d8dee4}h3{font-size:1.15em}p{margin:.6em 0}a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}code{font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:.9em;background:rgba(175,184,193,.22);padding:.15em .35em;border-radius:4px}pre{background:#f6f8fa;border:1px solid #d8dee4;border-radius:6px;padding:12px 14px;overflow-x:auto;line-height:1.5}pre code{background:none;padding:0;font-size:.88em}blockquote{margin:.6em 0;padding:.1em 1em;border-left:4px solid #d8dee4;color:#59636e}ul,ol{padding-left:1.7em;margin:.6em 0}li{margin:.2em 0}li.task-list-item{list-style:none;margin-left:-1.5em}li.task-list-item input{margin-right:.45em}table{border-collapse:collapse;margin:.8em 0;max-width:100%;display:block;overflow-x:auto}th,td{border:1px solid #d8dee4;padding:6px 12px}th{background:#f6f8fa;font-weight:600}hr{border:none;border-top:1px solid #d8dee4;margin:1.6em 0}img{max-width:100%}del{color:#59636e}.dsh-ws-md-image-alt{color:#59636e}@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}h1,h2{border-bottom-color:#30363d}a{color:#58a6ff}code{background:rgba(110,118,129,.32)}pre{background:#161b22;border-color:#30363d}blockquote{border-left-color:#30363d;color:#8b949e}th{background:#161b22}th,td{border-color:#30363d}hr{border-top-color:#30363d}del,.dsh-ws-md-image-alt{color:#8b949e}}`

/* Render a markdown file's bytes into a complete, self-contained HTML document (UTF-8). Returns null when the bytes do not decode as the detected encoding — the caller then falls back to serving the raw bytes. */
export function renderMarkdownDocument(bytes, encodingId, fileName) {
  const text = decodeBytes(bytes, encodingId, false)
  if (text === undefined) return null
  const body = MARKED.parse(text)
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fileName)}</title>
<style>${DOCUMENT_STYLE}</style>
</head>
<body>
<main class="dsh-ws-md-doc">
${body}
</main>
</body>
</html>`
  return Buffer.from(html, 'utf8')
}
