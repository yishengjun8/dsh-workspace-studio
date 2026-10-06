//#region src/host/invariant.js
/** Package-owned invariant companion for the workspace studio.
*
*  Built as its own entry (`lib/invariant.js`), this file makes the artifact
*  reproducible.
*
*  It declares no runtime invariants: the host API validates every path against
*  the workspace root, and slot/route registrations are effect-owned by their
*  registries. Registering the package (empty install) is the whole contract. */
const name = "workspace-studio-invariant";
const inject = ["invariants"];
/** No extra runtime invariants (see the file header). */
const install = () => {};
/** Register package ownership with the invariant registry. */
const apply = (ctx) => Promise.resolve(ctx.invariants.register("@yishengjun8/dsh-workspace-studio", install));

//#endregion
export { apply, inject, name };