/* HTML preview packing: collect statically declared relative classic scripts and stylesheets, read
   them via the readRelated Remote, and build a bootstrap srcDoc. Relative URLs it does NOT handle —
   images, fonts, media, CSS url(), and anything a page script builds at runtime — resolve through
   the preview's token-gated site route, whose prefix the caller passes in as `base` and the bootstrap
   installs as the document's <base>. That route is why this packing can stay narrow: without it a
   srcdoc document resolves relative URLs against the embedding application page (measured), and the
   opaque-origin frame cannot load a parent-created blob URL. Ported from the harness html packer (MIT). */
const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64

/* Whether this reference can be read relative to the original document, never
   the parent application URL. */
function relative(reference) {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference) && !reference.includes('\0')
}

/* Collect static dependencies without executing or mounting document elements
   in the parent page; only direct .js classic scripts and .css links are packed.
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
    /* Script and stylesheet text travels verbatim (never base64), so an undecodable byte fails here
       rather than inside the frame's bootstrap. */
    assets.push({
      kind,
      reference,
      mime: script ? 'application/javascript' : 'text/css',
      text: new TextDecoder('utf-8', { fatal: true }).decode(asset.data),
    })
    seen.add(key)
  }
  return { html, assets }
}

/* Build the outer iframe document; resource URLs are created inside the sandbox, since the opaque
   origin cannot load parent-created URLs. The bundle travels as a JSON data block (a data script
   element's text is raw, so only `<` — which JSON.stringify emits inside strings alone — needs
   escaping as a JSON escape). `base` is the preview site's root-relative prefix, installed as the
   document's <base> so every relative URL the packer left alone resolves through that route. */
export function createHtmlDocument(bundle, base) {
  const payload = JSON.stringify({
    html: bundle.html,
    base: base ?? '',
    assets: bundle.assets.map(asset => ({ reference: asset.reference, mime: asset.mime, text: asset.text })),
  }).replaceAll('<', '\\u003c')
  return `<!doctype html><meta charset="utf-8"><script type="application/json" id="dsh-ws-html-bundle">${payload}</script><script>(()=>{
const bundle=JSON.parse(document.getElementById('dsh-ws-html-bundle').textContent);
let html=bundle.html;
if(bundle.assets.length||bundle.base){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  if(bundle.base){
    /* setAttribute, not .href: this detached document has no meaningful base URL, and the value is
       resolved for real once the written document lives inside the frame. */
    const base=parsed.createElement('base');
    base.setAttribute('href',bundle.base);
    parsed.head.prepend(base);
  }
  for(const asset of bundle.assets){
    const script=asset.mime==='application/javascript';
    const url=URL.createObjectURL(new Blob([asset.text],{type:asset.mime}));
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
