/* Plan resources: the bridge from the harness chat's `ctx.sidebarRight.openResource`
 * path into this plugin's own preview column.
 *
 * The harness right-Sidebar seat is never mounted under this root layout, so a
 * plan address handed to ctx.sidebarRight reaches no surface of its own: ui-plan's
 * 「查看全文」 and the turn's plan card would fail with no visible result at all.
 * This module recognizes those addresses, keeps a temporary review document in
 * memory, publishes an open request the mounted explorer consumes as a
 * session-only preview tab, and exposes the harness `plan` resource source
 * (ctx.resources) so the logged plan's session-history read stays owned by
 * ui-plan — the plugin never re-implements that read.
 */

/* The two address grammars ui-plan publishes (mirrored locally so the bundle
   needs no harness dependency):
   - logged plan: `dsh-resource://plan/<sessionId>/<callId>` or
     `dsh-resource://plan/subagent/<parent>/<child>/<mode>/<callId>`
   - temporary review: `dsh-resource://plan-review/<sessionId>/<key>` */
const PLAN_PREFIX = 'dsh-resource://plan/'
const PLAN_REVIEW_PREFIX = 'dsh-resource://plan-review/'
/* Subagent session modes ui-plan encodes in the 5-segment plan address. */
const SUBAGENT_MODES = new Set(['one-shot', 'continuable', 'unknown'])

/* Percent-decode an address tail into its segments; undefined on malformed
   encoding or an empty segment (a plan address never carries one). */
function decodeSegments(rest) {
  if (rest === '') return undefined
  try {
    const parts = rest.split('/').map(decodeURIComponent)
    return parts.some(part => part === '') ? undefined : parts
  } catch (_error) {
    // decodeURIComponent throws URIError on a malformed escape: not a plan address.
    return undefined
  }
}

/**
 * Recognize a plan resource address.
 * @param address - a caller-supplied `dsh-resource://…` address.
 * @returns the plan kind and the session whose explorer should host its tab, or undefined.
 */
export function parsePlanResourceAddress(address) {
  if (typeof address !== 'string') return undefined
  if (address.startsWith(PLAN_REVIEW_PREFIX)) {
    const parts = decodeSegments(address.slice(PLAN_REVIEW_PREFIX.length))
    if (parts === undefined || parts.length !== 2) return undefined
    return { kind: 'plan-review', sessionId: parts[0] }
  }
  if (address.startsWith(PLAN_PREFIX)) {
    const parts = decodeSegments(address.slice(PLAN_PREFIX.length))
    if (parts === undefined) return undefined
    if (parts.length === 2) return { kind: 'plan', sessionId: parts[0] }
    /* A subagent plan belongs to a subagent chat: its parent session hosts the tab. */
    if (parts.length === 5 && parts[0] === 'subagent' && SUBAGENT_MODES.has(parts[3])) {
      return { kind: 'plan', sessionId: parts[1] }
    }
    return undefined
  }
  return undefined
}

/**
 * Whether an address names a temporary review preview (its document travels in
 * the navigation params and never reaches the session log).
 * @param address - a caller-supplied address.
 * @returns true for the `plan-review` grammar.
 */
export function isPlanReviewAddress(address) {
  return typeof address === 'string' && parsePlanResourceAddress(address)?.kind === 'plan-review'
}

/**
 * Validate a plan document from untrusted navigation params or a resource frame.
 * @param value - candidate `{ markdown, title }`.
 * @returns the document, with the title falling back to the leading ATX heading.
 */
export function normalizePlanDocument(value) {
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.markdown !== 'string') return undefined
  const markdown = value.markdown
  const title = typeof value.title === 'string' && value.title.trim() !== ''
    ? value.title.trim()
    : (/^#\s+(\S[^\r\n]*)/.exec(markdown.trim())?.[1] ?? '')
  return { markdown, title }
}

/* Temporary review documents, keyed by their address: they exist only in the
   browser (ui-plan marks them expired on reload), so they are never persisted
   and their memory is bounded here. */
const PLAN_DOCUMENT_MAX = 16
const planDocumentsByAddress = new Map()

export const planDocuments = {
  set(address, document) {
    const key = String(address)
    // Re-insert so insertion order tracks recency; the oldest document is evicted past the cap.
    planDocumentsByAddress.delete(key)
    planDocumentsByAddress.set(key, document)
    while (planDocumentsByAddress.size > PLAN_DOCUMENT_MAX) {
      const oldest = planDocumentsByAddress.keys().next().value
      planDocumentsByAddress.delete(oldest)
    }
  },
  get(address) {
    return planDocumentsByAddress.get(String(address))
  },
  drop(address) {
    planDocumentsByAddress.delete(String(address))
  },
}

/* Module-wide open-request bridge: the openResource router publishes one plan
   open, and the explorer whose previewSessionId matches the request's
   expectFamily consumes it. An unrelated session's explorer never adopts a
   request aimed at another session, and a mount that arrives later still
   consumes the pending request. */
export const planOpenStore = {
  _snapshot: { seq: 0, request: null },
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getSnapshot() { return this._snapshot },
  open(address, name, expectFamily) {
    this._snapshot = {
      seq: this._snapshot.seq + 1,
      request: {
        address: String(address),
        name: typeof name === 'string' ? name : '',
        expectFamily: expectFamily === undefined || expectFamily === null ? null : String(expectFamily),
      },
    }
    for (const listener of [...this._listeners]) listener()
  },
  consume() {
    if (this._snapshot.request === null) return
    this._snapshot = { seq: this._snapshot.seq + 1, request: null }
    for (const listener of [...this._listeners]) listener()
  },
}

/* The harness resource source, installed for the lifetime of the plugin via a
   deferred inject: the plan protocol's provider belongs to ui-plan, and
   ctx.resources.source(address) holds one read of it open. */
let resourceSourceAccessor

/**
 * Install the plan resource reader.
 * @param ctx - client root context.
 */
export function installPlanResources(ctx) {
  ctx.inject(['resources'], scope => {
    scope.effect(() => {
      const resources = scope.get('resources')
      if (resources === undefined) return undefined
      resourceSourceAccessor = address => resources.source(address)
      return () => { resourceSourceAccessor = undefined }
    }, 'workspace-studio: plan resource source')
  })
}

/**
 * The live source of one plan resource, or undefined while no resource service
 * is installed (the plan viewer then reports an unreadable plan).
 * @param address - a `dsh-resource://plan/…` address.
 * @returns the observable snapshot face, or undefined.
 */
export function planResourceSource(address) {
  return typeof resourceSourceAccessor === 'function' ? resourceSourceAccessor(String(address)) : undefined
}
