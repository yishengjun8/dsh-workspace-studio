/* One reusable export path for the music workshop.
 *
 *  The export dialog and the chat auto-generation flow must encode and upload the same bytes;
 *  keeping only the CHOICE in the dialog means an automatic export cannot drift from what the
 *  user sees when they export by hand.
 */
import { exportMusicFileRequest, musicSampleFileRequest, musicSampleManifestRequest } from '../../api.js'
import { MUSIC_DEFAULT_INSTRUMENTS } from '../../../shared/music-score.js'
import { stripMusicExportExtension } from '../../../shared/music-export.js'
import { encodeMusicMidi, renderMusicWav } from './export-render.js'

/** Whether an export failure is the Host's "file already exists" 409 (the dialog offers overwrite). */
export function isMusicExportExists(error) {
  return error?.status === 409 || error?.code === 'music-export-exists'
}

/** Stage ids a caller may render as a progress list. */
export function musicExportStages(format) {
  return format === 'wav' ? ['samples', 'render', 'encode', 'write'] : [format === 'json' ? 'prepare' : 'encode', 'write']
}

/**
 * Encode the current score and write it into the workspace.
 *
 * @param options.doc - the live score document.
 * @param options.settings - normalized export prefs (`{format, wav, midi, json}`).
 * @param options.dir - workspace-relative directory ('' = workspace root).
 * @param options.name - file base name (an existing format suffix is stripped once).
 * @param options.overwrite - false lets the Host answer 409 for an existing file.
 * @param options.workspaceId - workspace fence for the write.
 * @param options.signal - caller abort signal.
 * @param options.onStage - optional stage callback ('samples' | 'render' | 'prepare' | 'encode' | 'write').
 * @returns the Host's `{ path, name, size, mtimeMs, format }`.
 */
export async function runMusicExport({
  doc,
  settings,
  dir,
  name,
  overwrite = false,
  workspaceId,
  signal,
  onStage,
}) {
  const format = settings?.format === 'wav' || settings?.format === 'midi' || settings?.format === 'json'
    ? settings.format
    : 'wav'
  const stages = musicExportStages(format)
  if (typeof onStage === 'function') onStage(stages[0])
  let bytes
  if (format === 'wav') {
    bytes = await renderMusicWav(
      doc,
      { channels: settings.wav.channels, depth: settings.wav.depth, rate: settings.wav.rate },
      {
        loadManifest: () => musicSampleManifestRequest(signal),
        loadSample: sample => musicSampleFileRequest(sample, signal),
      },
      onStage,
    )
  } else if (format === 'midi') {
    bytes = encodeMusicMidi(doc, settings.midi)
  } else {
    /* The "generation parameters" toggle keeps the AI brief out of a shared score without
       touching notes, tempo or key. */
    const source = settings.json.prompt === false
      ? {
        ...doc,
        prompt: {
          ...doc.prompt,
          complexity: 0.5,
          density: 0.5,
          instruments: [...MUSIC_DEFAULT_INSTRUMENTS],
          mood: 'lazy',
          style: 'lofi',
          text: '',
        },
      }
      : doc
    bytes = new TextEncoder().encode(JSON.stringify(source, null, 2))
  }
  if (typeof onStage === 'function') onStage('write')
  return exportMusicFileRequest(workspaceId, {
    bytes,
    dir,
    format,
    name: stripMusicExportExtension(name, format),
    overwrite,
  }, signal)
}
