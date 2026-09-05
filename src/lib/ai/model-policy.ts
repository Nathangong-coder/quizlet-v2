/**
 * Which models are allowed to produce the artifacts the learning engine
 * depends on.
 *
 * This is a QUALITY floor, not a cost control. KLPs, grading verdicts and
 * distractor provenance are PERSISTED and then used as evidence: a KLP becomes
 * what a distractor is corrupted from and what a short answer is graded
 * against, and an error tag written off a bad distractor is indistinguishable
 * later from a real one. A weak model does not merely give a worse answer
 * here — it writes a wrong fact into the learner's history, where nothing
 * downstream can tell it apart from a right one.
 *
 * The pilot made the risk concrete rather than theoretical: `gemini-2.5-flash`
 * could not satisfy `AuthorDraftSchema` at all (`response did not match
 * schema`) on a card that `gemini-3.1-flash-lite` authored cleanly. Models
 * differ materially in structured-output compliance, and structured output is
 * the entire contract this engine runs on.
 *
 * Owner's decision, 2026-09-04: for grading and background generation, Google
 * credentials are restricted to the three models below.
 */
import type { AiTask } from '@/lib/ai/model-routing'

/**
 * The Google models approved for grading and background generation.
 *
 * ADDING ONE IS A ONE-LINE EDIT, deliberately — this is a list to curate, not
 * a rule to reason about. Note what is NOT here: `gemini-3.7-flash` and
 * `gemini-3.8-flash` exist on the account and are newer than everything listed,
 * but no card has been authored with either, so they are excluded until
 * somebody checks. `gemini-2.5-flash` is excluded on evidence: it failed
 * structured output outright during the pilot.
 */
export const GOOGLE_APPROVED_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
] as const

export type GoogleApprovedModel = (typeof GOOGLE_APPROVED_MODELS)[number]

/**
 * What a Google credential falls back to when its configured model is not
 * approved for a policed task.
 *
 * Substitution rather than refusal, and the choice matters: refusing would mean
 * a user whose credential defaults to an unapproved model simply gets no
 * grading, which is a worse outcome than grading on a good model they did not
 * personally pick. The substitution is surfaced in settings rather than done
 * silently — see `TaskRoutingPanel`.
 */
export const GOOGLE_POLICY_FALLBACK: GoogleApprovedModel = 'gemini-3.6-flash'

/**
 * The tasks the policy covers: everything that GRADES, and everything that
 * generates in the BACKGROUND.
 *
 * `autocomplete` is in the list and that will look wrong until you know why:
 * it is not only card autofill. Legacy KLP extraction (`src/actions/klp.ts`,
 * fired from `after()` on set save), KLT seeding, KLT placement and KLT
 * summarising ALL route through `autocomplete` today. So the task that sounds
 * the most cosmetic is in fact the one writing the most persisted knowledge.
 * When that conflation is untangled into its own task, this entry should follow
 * the KLP/KLT work rather than staying with autofill.
 *
 * `distractors` is included because a distractor's `corruption` is persisted as
 * the provenance an error tag is later derived from — a bad distractor does not
 * just ask a poor question, it writes a fictional misconception into the
 * learner's profile.
 *
 * NOT policed: nothing currently. The set is every task, and it is written out
 * member by member anyway, so adding a task to `AI_TASKS` forces a deliberate
 * decision here instead of silently inheriting one.
 */
export const POLICED_TASKS: readonly AiTask[] = [
  'grade',
  'diagnostic',
  'author',
  'autocomplete',
  'distractors',
  'plan',
  'note-analysis',
]

export function isPolicedTask(task: AiTask): boolean {
  return POLICED_TASKS.includes(task)
}

/**
 * Whether a model may serve a task.
 *
 * ONLY GOOGLE IS POLICED. The approved list is a list of Google model ids, so
 * applying it to any other provider would reject every Anthropic and OpenAI
 * model as "unapproved" — turning a quality floor into an outage the moment the
 * owner adds the OpenAI credits they are planning to. Other providers are
 * unrestricted until somebody curates a list for them.
 */
export function isModelAllowed(provider: string, model: string, task: AiTask): boolean {
  if (provider !== 'google') return true
  if (!isPolicedTask(task)) return true
  return (GOOGLE_APPROVED_MODELS as readonly string[]).includes(model)
}

export interface PolicyDecision {
  /** The model that will actually be used. */
  model: string
  /** True when the configured model was replaced because it is not approved. */
  substituted: boolean
}

/**
 * The model a policed task will really run on.
 *
 * Applied at RESOLVE time, not only at save time, because the model can arrive
 * from two places: `AiTaskRouting.model` (a per-task override, which
 * `saveTaskRouting` can validate) and `AiCredential.defaultModel` (which it
 * cannot — one credential serves every task, so a default that is wrong for
 * grading may be perfectly fine elsewhere). Validating only the form would
 * leave the second path unpoliced, which is the path most users are on.
 */
export function enforceModelPolicy(provider: string, model: string, task: AiTask): PolicyDecision {
  if (isModelAllowed(provider, model, task)) return { model, substituted: false }
  return { model: GOOGLE_POLICY_FALLBACK, substituted: true }
}
