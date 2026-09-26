/**
 * Editor-context injection for the harness command-claim submission path.
 *
 * The composer owns two submission sinks: the plain prompt sink
 * (`conversation.sendSession`, wrapped by PromptContextBridge) and a slash
 * command's claim transaction (`claim.submit` -> the `commands.execute` Remote
 * RPC). The claim path never touches `sendSession`, so a command whose argument
 * text becomes a user prompt needs its own injection point — this module owns
 * the decision table for it and nothing else (no IO, no harness imports).
 *
 * Only commands that forward their arguments to the agent as a user prompt are
 * listed. `/plan <message>` steers exactly that text as a user message
 * (packages/plan/plan-mode `agent.steer(createUserMessage(...))`), so an
 * envelope prepended to the arguments reaches the model and the existing
 * bubble folding / session-title guard apply unchanged. `/goal` is
 * deliberately absent: its argument is persisted as the durable goal objective,
 * where an XML envelope would leak into the goal UI.
 */

/* Command name -> arguments that switch behavior instead of carrying a prompt.
   The comparison mirrors the harness handler exactly (`rawInput.trim() === 'off'`
   in plan-mode, and the same test drives the plan projection), so it is
   case-sensitive and only matches the whole argument text. */
const PROMPT_COMMAND_CONTROL_WORDS = new Map([
  ['plan', new Set(['off'])],
])

/** The prompt carried by one claim submission, or null when it carries none. */
export function commandPromptText(name, args) {
  const controlWords = PROMPT_COMMAND_CONTROL_WORDS.get(name)
  if (controlWords === undefined || typeof args !== 'string') return null
  const text = args.trim()
  if (text === '' || controlWords.has(text)) return null
  return text
}

/**
 * Wrap one claim so a prompt-bearing submission routes through the injector;
 * any other claim — or a control-word/empty-argument submission — keeps its
 * own submit. Both claim routes (Enter-time adjudication and claim-time
 * application: slash-menu pick / Space) funnel through here, so this is the
 * single place that knows the claim shape.
 * @param claim - the command claim handed to the submit machine.
 * @param submitWithContext - (claim, args, actx, attachments) => Promise<SubmitOutcome>.
 * @returns the claim itself when it carries no prompt, else a wrapped copy.
 */
export function wrapPromptClaim(claim, submitWithContext) {
  if (claim === null || typeof claim !== 'object') return claim
  if (!PROMPT_COMMAND_CONTROL_WORDS.has(claim.name)) return claim
  return {
    ...claim,
    submit: (args, actx, attachments) => (commandPromptText(claim.name, args) === null
      ? claim.submit(args, actx, attachments)
      : submitWithContext(claim, args, actx, attachments)),
  }
}

/**
 * Route a prompt-bearing claim adjudication outcome through the
 * context-injecting submitter while leaving every other outcome untouched.
 * @param outcome - the slash pipeline's PickOutcome.
 * @param submitWithContext - (claim, args, actx, attachments) => Promise<SubmitOutcome>.
 * @returns the outcome, with a wrapped claim when this command carries a prompt.
 */
export function wrapPromptClaimOutcome(outcome, submitWithContext) {
  if (outcome === null || typeof outcome !== 'object' || outcome.claim === undefined) return outcome
  const claim = wrapPromptClaim(outcome.claim, submitWithContext)
  return claim === outcome.claim ? outcome : { ...outcome, claim }
}
