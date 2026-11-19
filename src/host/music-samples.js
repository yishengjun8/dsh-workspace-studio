/* Read-only access to the bundled curated VCSL pack.
 *
 * The pack lives beside the built Host entry (`assets/vcsl` at the package root). Only
 * names present in the manifest are readable, so a request cannot walk out of the asset
 * directory even though these files are outside the workspace trust fence.
 */
import { readFile } from 'node:fs/promises'
import { HttpError } from './errors.js'

const SAMPLE_NAME = /^ogg\/[a-z0-9-]+\/[a-z0-9-]+\.ogg$/u

let cachedManifest = null

export async function readMusicSampleManifest(assetRoot) {
  if (cachedManifest !== null) return cachedManifest
  let parsed
  try {
    parsed = JSON.parse(await readFile(new URL('manifest.json', assetRoot), 'utf8'))
  } catch {
    throw new HttpError(503, 'music-samples-missing', '音色包未安装')
  }
  const files = new Set()
  for (const instrument of Object.values(parsed?.instruments ?? {})) {
    for (const zone of Array.isArray(instrument?.zones) ? instrument.zones : []) {
      if (typeof zone?.file === 'string') files.add(zone.file)
    }
    for (const variants of Object.values(instrument?.lanes ?? {})) {
      for (const variant of Array.isArray(variants) ? variants : []) {
        if (typeof variant?.file === 'string') files.add(variant.file)
      }
    }
  }
  cachedManifest = { files, manifest: parsed }
  return cachedManifest
}

export async function readMusicSample(assetRoot, name) {
  if (typeof name !== 'string' || !SAMPLE_NAME.test(name)) {
    throw new HttpError(404, 'music-sample-not-found', '音色文件不存在')
  }
  const { files } = await readMusicSampleManifest(assetRoot)
  if (!files.has(name)) throw new HttpError(404, 'music-sample-not-found', '音色文件不存在')
  try {
    return await readFile(new URL(name, assetRoot))
  } catch {
    throw new HttpError(404, 'music-sample-not-found', '音色文件不存在')
  }
}
