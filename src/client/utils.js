// Whether a dropped File is an image. Images go to the chat composer, not the
// preview: the drop highlight is withheld and a real drop is server-rejected
// with a toast (development-notes §17). Empty MIME types count as files.
export function isImageFile(file) {
  const type = typeof file?.type === 'string' ? file.type : ''
  return type.startsWith('image/')
}
// File-drag detection mirroring the harness composer: dataTransfer.types is
// authoritative and stable during the drag, while dataTransfer.files is only
// guaranteed populated at drop time.
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
// Whether the drag carries a non-image file. Controls only the drop
// highlight: during dragover File objects may not be inspectable, so any file
// drag counts as "normal" (images are still rejected at drop — see isImageFile).
export function hasNormalFile(event) {
  if (!hasDraggedFiles(event)) return false
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return true
  for (const file of files) if (!isImageFile(file)) return true
  return false
}