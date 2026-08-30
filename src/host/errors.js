/** Package-owned error + value primitives shared by every host module. */
export class HttpError extends Error {
  constructor(status, code, message, data) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    /* Optional structured payload (e.g. { currentGeneration } on a draft
       generation conflict) so a client can recover without parsing prose. */
    if (data !== undefined) this.data = data
  }
}
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
