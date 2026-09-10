// Whether a dropped File is an image; images go to the chat composer, not the preview.
export function isImageFile(file) {
  const type = typeof file?.type === 'string' ? file.type : ''
  return type.startsWith('image/')
}
// File-drag detection mirroring the harness composer: dataTransfer.types is authoritative and stable during the drag.
export function hasDraggedFiles(event) {
  const dataTransfer = event?.dataTransfer
  if (dataTransfer === null || dataTransfer === undefined) return false
  if ((dataTransfer.files?.length ?? 0) > 0) return true
  try {
    return typeof dataTransfer.types?.includes === 'function' && dataTransfer.types.includes('Files')
  } catch {
    return false
  }
}
// Whether the drag carries a non-image file; controls only the drop highlight.
export function hasNormalFile(event) {
  if (!hasDraggedFiles(event)) return false
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return true
  for (const file of files) if (!isImageFile(file)) return true
  return false
}