/** Package-owned error + value primitives shared by every host module. */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
