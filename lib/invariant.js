/** Package-owned invariant companion for the workspace studio. */
export const name = 'workspace-studio-invariant'
export const inject = ['invariants']

/**
 * No additional runtime invariant: the host API validates every requested path
 * against the selected Workspace root, while slot and route registrations are
 * effect-owned by their registries.
 */
const install = () => {}

/** Register package ownership with the invariant registry. */
export const apply = ctx => Promise.resolve(
  ctx.invariants.register('@yishengjun8/dsh-workspace-studio', install),
)
