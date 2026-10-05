/** Package-owned invariant companion for the workspace studio.
 *
 *  Built as its own entry (`lib/invariant.js`), this file makes the artifact
 *  reproducible: it used to exist only as a hand-written lib/ file with no
 *  source, so a clean rebuild dropped it while package.json still exported it.
 *
 *  It declares no runtime invariants: the host API validates every path against
 *  the workspace root, and slot/route registrations are effect-owned by their
 *  registries. Registering the package (empty install) is the whole contract. */
export const name = 'workspace-studio-invariant'
export const inject = ['invariants']

/** No extra runtime invariants (see the file header). */
const install = () => {}

/** Register package ownership with the invariant registry. */
export const apply = ctx => Promise.resolve(
  ctx.invariants.register('@yishengjun8/dsh-workspace-studio', install),
)
