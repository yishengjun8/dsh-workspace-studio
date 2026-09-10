/* HTML preview packing: collect statically declared classic scripts and
   stylesheets referenced by relative URLs, read them through the standard
   workspaceFiles.readRelated Remote, and build a bootstrap srcDoc that
   rewrites the references to blob URLs created INSIDE the sandboxed iframe
   (an opaque origin cannot load blob URLs created by the parent). Ported from
   the harness ui-sidebar-documentpreview html packer (MIT). */
const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64

/* Whether this reference can be read relative to the original document, never
   the parent application URL. */
function relative(reference) {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference) && !reference.includes('\0')
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/* Collect static dependencies without executing or mounting document elements
   in the parent page. A base element leaves URL resolution to the browser.
   Only direct .js classic scripts and .css links are packed; local CSS
   url/import, modules and dynamically constructed URLs are unsupported.
   @param html - the complete HTML source (the editor draft).
   @param readRelative - original-document-scoped read; rejects on failure.
   @param signal - stops reads and prevents publication after cancellation.
   @returns the HTML and its finite static asset set. */
export async function packHtml(html, readRelative, signal) {
  signal.throwIfAborted()
  let total = new TextEncoder().encode(html).byteLength
  if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
  const template = document.createElement('template')
  template.innerHTML = html
  const assets = []
  if (template.content.querySelector('base[href]') !== null) return { html, assets }

  const seen = new Set()
  for (const element of template.content.querySelectorAll('script[src],link[href]')) {
    const script = element.localName === 'script'
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (script && !['', 'text/javascript', 'application/javascript'].includes(type)) continue
    if (!script && !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/u).includes('stylesheet')) continue
    // The selector requires the corresponding URL attribute.
    const reference = element.getAttribute(script ? 'src' : 'href')
    const suffix = reference.search(/[?#]/u)
    const path = suffix === -1 ? reference : reference.slice(0, suffix)
    if (!relative(reference) || !(script ? /\.js$/iu : /\.css$/iu).test(path)) continue
    const kind = script ? 'script' : 'stylesheet'
    const key = `${kind}:${reference}`
    if (seen.has(key)) continue
    if (assets.length >= MAX_ASSETS) throw new Error('HTML package exceeds its asset count limit')
    signal.throwIfAborted()
    const asset = await readRelative(reference, signal)
    signal.throwIfAborted()
    const size = asset.data.byteLength
    if (size > MAX_ASSET_BYTES) throw new Error('HTML asset exceeds its byte limit')
    total += size
    if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
    assets.push({ kind, reference, data: asset.data })
    seen.add(key)
  }
  return { html, assets }
}

/* Build the outer iframe document. Its resource URLs are created inside the
   sandbox, because that opaque origin cannot load resource URLs created by
   the parent. Invalid UTF-8 in an asset throws before navigation. */
export function createHtmlDocument(bundle) {
  const payload = bytesToBase64(new TextEncoder().encode(JSON.stringify({
    html: bundle.html,
    assets: bundle.assets.map(asset => ({
      kind: asset.kind,
      reference: asset.reference,
      text: new TextDecoder('utf-8', { fatal: true }).decode(asset.data),
    })),
  })))
  return `<!doctype html><meta charset="utf-8"><script>(()=>{
const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));
const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));
const bundle=JSON.parse(text("${payload}"));
let html=bundle.html;
if(bundle.assets.length){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  for(const asset of bundle.assets){
    const script=asset.kind==='script';
    const url=URL.createObjectURL(new Blob([asset.text],{type:script?'application/javascript':'text/css'}));
    const attribute=script?'src':'href';
    for(const element of parsed.querySelectorAll(script?'script[src]':'link[rel~="stylesheet" i][href]')){
      if(element.getAttribute(attribute)===asset.reference)element.setAttribute(attribute,url);
    }
  }
  html='<!doctype html>'+parsed.documentElement.outerHTML;
}
document.open();document.write(html);document.close();
})()</script>`
}
