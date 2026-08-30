import { translate } from './locale/index.js'

export function entryPath(parent, name) { return parent === '' ? name : `${parent}/${name}` }
export function pathBaseName(path) { return path.slice(path.lastIndexOf('/') + 1) }
export function parentPath(path){const index=path.lastIndexOf('/');return index<0?'':path.slice(0,index)}
export function joinAbsolutePath(root,relative){if(typeof root!=='string'||root==='')return relative;if(relative==='')return root;const separator=/^[A-Za-z]:[\\/]/.test(root)?'\\':'/';return `${root.replace(/[\\/]+$/,'')}${separator}${relative.split('/').join(separator)}`}
export async function copyText(value){if(typeof navigator!=='undefined'&&typeof navigator.clipboard?.writeText==='function'){try{await navigator.clipboard.writeText(value);return true}catch{/* clipboard API rejects without user gesture or outside secure contexts; fall back to execCommand */}}const textarea=document.createElement('textarea');textarea.value=value;textarea.style.position='fixed';textarea.style.opacity='0';document.body.append(textarea);textarea.select();let ok=false;try{ok=document.execCommand('copy')}catch{/* execCommand throws in unusual embedders; report failure */}textarea.remove();return ok}
export function selectedLevelPath(entry){return entry?.kind==='directory'?entry.path:entry?parentPath(entry.path):''}
export function defaultEntryName(kind) { return kind === 'directory' ? translate('dialog.newFolder') : translate('dialog.newFileDefault') }
export function entryNameError(value) {
  const name = value.trim()
  if (name === '') return translate('entry.nameRequired')
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(name)) return translate('entry.nameInvalid')
  return undefined
}
export function entryDialogTitle(dialog) { if (dialog?.mode === 'rename') return translate('dialog.rename'); return dialog?.kind === 'directory' ? translate('dialog.newFolder') : translate('dialog.newFile') }
export function entryDialogAction(dialog) { return dialog?.mode === 'rename' ? translate('dialog.rename') : translate('dialog.create') }
export function rewriteRelativePath(path,from,to){if(path===from)return to;if(from!==''&&path.startsWith(`${from}/`))return `${to}${path.slice(from.length)}`;return path}
export function rewriteEntry(entry,from,to,replacement){if(!entry)return entry;if(entry.path===from)return {...replacement};const path=rewriteRelativePath(entry.path,from,to);return path===entry.path?entry:{...entry,path}}
export function rewriteDirectoryMap(current,from,to,replacement){const next=new Map();for(const [path,state]of current){const nextPath=rewriteRelativePath(path,from,to);const entries=Array.isArray(state?.entries)?state.entries.map(entry=>rewriteEntry(entry,from,to,replacement)):state?.entries;next.set(nextPath,{...state,entries})}return next}
export function rewritePathSet(current,from,to){const next=new Set();for(const path of current)next.add(rewriteRelativePath(path,from,to));return next}
export function rewritePathMap(current,from,to){const next=new Map();for(const [path,value]of current)next.set(rewriteRelativePath(path,from,to),value);return next}