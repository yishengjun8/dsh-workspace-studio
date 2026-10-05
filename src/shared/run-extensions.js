/* The executable-file runner's extension vocabulary, shared VERBATIM by both bundles.
 *
 * The Host is the authority: it resolves the interpreter, re-checks every request and refuses any
 * extension without a recipe. The client only decides whether to OFFER a console for a preview tab.
 * Keeping one table in src/shared means the two sides cannot drift — they used to be two hand-kept
 * copies (`host/run.js` RUN_EXTENSION_RECIPES vs `client/run-detect.js` RUN_FAMILY_BY_EXTENSION, with
 * a comment admitting the mirror), and a divergence would have shown up as a missing console or a
 * refused run for the same file.
 *
 * `direct` executes the file itself.
 */
export const RUN_FAMILY_BY_EXTENSION = Object.freeze({
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  bat: 'cmd', cmd: 'cmd',
  exe: 'direct', com: 'direct',
})

/** The command family of one file name, or null when the extension has no recipe. */
export function runFamilyOfName(name) {
  const lower = String(name ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  return RUN_FAMILY_BY_EXTENSION[lower.slice(dot + 1)] ?? null
}
