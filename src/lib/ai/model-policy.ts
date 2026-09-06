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
 * a rule to reason about. But curate it on EVIDENCE: run
 * `npm run probe-models` (scripts/probe-model-policy.ts), which makes a real
 * generation call against the diagnostic grading schema. A listing call and a
 * benchmark both say nothing about nested-schema compliance, which is the only
 * property that matters here.
 *
 * What is deliberately NOT here, and why — all measured 2026-09-06:
 *
 *  - `gemini-2.5-flash` — failed structured output outright during the pilot.
 *  - `gemini-3.4-flash` — **does not exist.** `generateContent` 404s. It was
 *    requested by name; asking the API is how that was settled.
 *  - `gemma-4-31b-it`, `gemma-4-26b-a4b-it` — "No object generated: could not
 *    parse the response." The Gemma instruction-tuned models do not hold this
 *    engine's structured-output contract, so they cannot be grading backups
 *    however cheap they are.
 *  - `gemini-3.7-flash` — spent **4,185 output tokens** on a two-question
 *    grading probe that `gemini-3.1-flash-lite` answered in 300, and hit the
 *    ceiling with `finishReason: length`. Provisional: a re-test at a larger
 *    ceiling was inconclusive (the model returned "high demand"). Even if it
 *    can comply, ~14x the output for the same verdict is a poor backup.
 *  - `gemini-3.8-flash` — untested. Both attempts returned "high demand".
 */
export const GOOGLE_APPROVED_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  /**
   * Added 2026-09-06 on evidence, via `npm run probe-models`. It graded the
   * two-question probe correctly — one verdict per key point, separating a
   * correct answer from "IDK" — in **300 output tokens and 1.5s**, the
   * cheapest and fastest of everything tested by a wide margin. The pilot had
   * already recorded it authoring a card cleanly where `gemini-2.5-flash`
   * could not.
   */
  'gemini-3.1-flash-lite',
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
 * `autocomplete` used to be the one to watch here, because it was quietly doing
 * four jobs. It was split on 2026-09-05: `klp-extract` and `concept-tree` now
 * carry the background work that writes persisted knowledge, and `autocomplete`
 * is just card autofill again. All three stay policed — autofill because a
 * suggestion accepted into a card becomes card content like any other.
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
  'klp-extract',
  'concept-tree',
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

/**
 * Other models this provider may be rotated onto for a task.
 *
 * Only Google has an allowlist, and only Google has the per-project-per-model
 * daily cap that makes fanning out worth anything — so every other provider
 * returns nothing rather than a guess. Widening a provider here without first
 * verifying its models (`npm run probe-models`) would put unverified models
 * into the grading path, which is the failure `GOOGLE_APPROVED_MODELS` exists
 * to prevent.
 *
 * Returns nothing for an unpoliced task too: outside the quality floor there
 * is no curated list to rotate within, and inventing one from the provider's
 * catalogue would be exactly the unverified-model problem again.
 */
export function approvedAlternates(provider: string, task: AiTask): string[] {
  if (provider !== 'google') return []
  if (!isPolicedTask(task)) return []
  return [...GOOGLE_APPROVED_MODELS]
}
