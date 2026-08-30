/** Text encodings: decoding, encoding, BOM handling and revision hashes. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import iconv from 'iconv-lite'
import { HttpError } from './errors.js'
export function containsNul(bytes) {
  for (const byte of bytes) if (byte === 0) return true
  return false
}
export function decodeUtf8(bytes, mayEndMidCharacter) {
  const maxTrim = mayEndMidCharacter ? Math.min(3, bytes.byteLength) : 0
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - trim))
    } catch {
      // A truncated valid code point can occupy up to four bytes; try the next shorter prefix.
    }
  }
  return undefined
}
export function revisionFor(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
/**
 * Supported text encodings. `id` is the canonical API/client identifier;
 * `decodeLabel` feeds the WHATWG TextDecoder, `encode` the iconv-lite name.
 * UTF-8/UTF-16 LE/BE BOMs are written by the encoder itself.
 */
export const ENCODINGS = Object.freeze([
  { id: 'utf-8', label: 'UTF-8', decodeLabel: 'utf-8', encode: 'utf8' },
  { id: 'utf-8-bom', label: 'UTF-8（带 BOM）', decodeLabel: 'utf-8', encode: 'utf8' },
  { id: 'utf-16le', label: 'UTF-16 LE', decodeLabel: 'utf-16le', encode: 'utf16-le' },
  { id: 'utf-16be', label: 'UTF-16 BE', decodeLabel: 'utf-16be', encode: 'utf16-be' },
  { id: 'gbk', label: 'GBK', decodeLabel: 'gbk', encode: 'gbk' },
  { id: 'gb18030', label: 'GB18030', decodeLabel: 'gb18030', encode: 'gb18030' },
  { id: 'big5', label: 'Big5', decodeLabel: 'big5', encode: 'big5' },
  { id: 'shift_jis', label: 'Shift_JIS', decodeLabel: 'shift_jis', encode: 'shift_jis' },
  { id: 'euc-jp', label: 'EUC-JP', decodeLabel: 'euc-jp', encode: 'euc-jp' },
  { id: 'euc-kr', label: 'EUC-KR', decodeLabel: 'euc-kr', encode: 'euc-kr' },
  { id: 'iso-8859-1', label: 'ISO-8859-1（Latin-1）', decodeLabel: 'iso-8859-1', encode: 'latin1' },
  { id: 'windows-1252', label: 'Windows-1252', decodeLabel: 'windows-1252', encode: 'windows-1252' },
  { id: 'windows-1251', label: 'Windows-1251（西里尔）', decodeLabel: 'windows-1251', encode: 'windows-1251' },
  { id: 'ascii', label: 'ASCII', decodeLabel: 'ascii', encode: 'ascii' },
])
export function encodingById(id) {
  const found = ENCODINGS.find(encoding => encoding.id === id)
  if (found === undefined) throw new HttpError(400, 'unsupported-encoding', '不支持的编码格式')
  return found
}
export function hasBom(bytes, encodingId) {
  if (encodingId === 'utf-16le') return bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  if (encodingId === 'utf-16be') return bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  return bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}
/**
 * Decode bytes strictly as `encodingId`. UTF-8 keeps its existing trim-aware
 * decoder; other encodings use a fatal TextDecoder, retrying progressively
 * shorter prefixes so a truncated trailing character does not fail the read.
 */
export function decodeBytes(bytes, encodingId, mayEndMidCharacter) {
  if (encodingId === 'utf-8' || encodingId === 'utf-8-bom') {
    return decodeUtf8(bytes, mayEndMidCharacter)
  }
  const spec = encodingById(encodingId)
  const maxTrim = mayEndMidCharacter ? Math.min(4, bytes.byteLength) : 0
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return new TextDecoder(spec.decodeLabel, { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - trim))
    } catch {
      // A truncated multi-byte sequence can occupy up to four bytes; try the next shorter prefix.
    }
  }
  return undefined
}
/* Code-point -> byte maps for the single-byte encodings, built from the same
 * TextDecoder instances decodeBytes uses. iconv-lite round-tripping is lossy
 * in 0x80..0x9F, silently corrupting those bytes on save; encoding through the
 * inverse decoder map keeps save-as identical to the preview. */
const SINGLE_BYTE_ENCODE_MAPS = (() => {
  const maps = new Map()
  for (const id of ['ascii', 'iso-8859-1', 'windows-1252', 'windows-1251']) {
    const spec = encodingById(id)
    const decoder = new TextDecoder(spec.decodeLabel)
    const map = new Map()
    for (let byte = 0; byte < 256; byte += 1) {
      const decoded = decoder.decode(Uint8Array.of(byte))
      if (decoded.length === 1) map.set(decoded.codePointAt(0), byte)
    }
    maps.set(id, map)
  }
  return maps
})()
/** Encode text into bytes for `encodingId`. Single-byte encodings replace
 * unmappable chars with '?' (preserving every byte the decoder can produce);
 * UTF-16 encodings add their BOM here. */
export function encodeText(text, encodingId) {
  if (encodingId === 'utf-8') return Buffer.from(text, 'utf8')
  if (encodingId === 'utf-8-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  }
  const singleByteMap = SINGLE_BYTE_ENCODE_MAPS.get(encodingId)
  if (singleByteMap !== undefined) {
    /* Iterate by CODE POINT (for..of), not by UTF-16 code unit: a surrogate
       pair (e.g. an emoji) is ONE unmappable character and must produce ONE
       replacement byte — indexing units would emit '??' for it. */
    const bytes = []
    for (const char of text) {
      const byte = singleByteMap.get(char.codePointAt(0))
      bytes.push(byte === undefined ? 0x3f : byte)
    }
    return Buffer.from(bytes)
  }
  const spec = encodingById(encodingId)
  let body = iconv.encode(text, spec.encode)
  if (encodingId === 'utf-16le') body = Buffer.concat([Buffer.from([0xff, 0xfe]), body])
  else if (encodingId === 'utf-16be') body = Buffer.concat([Buffer.from([0xfe, 0xff]), body])
  return body
}
/** The encoding id to save back with, preserving a UTF-8 BOM when present. */
export function effectiveReadEncoding(requestedId, bom) {
  if (requestedId === 'utf-8' && bom) return 'utf-8-bom'
  return requestedId
}
export function textMetadata(bytes, content, encodingId = 'utf-8') {
  const bom = hasBom(bytes, encodingId)
  const crlf = (content.match(/\r\n/g) ?? []).length
  const withoutCrlf = content.replace(/\r\n/g, '')
  const lf = (withoutCrlf.match(/\n/g) ?? []).length
  const cr = (withoutCrlf.match(/\r/g) ?? []).length
  let lineEnding = 'none'
  const kinds = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0)
  if (kinds > 1) lineEnding = 'mixed'
  else if (crlf > 0) lineEnding = 'crlf'
  else if (lf > 0) lineEnding = 'lf'
  else if (cr > 0) lineEnding = 'cr'
  return { bom, lineEnding }
}
