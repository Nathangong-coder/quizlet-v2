/**
 * The task categories a generation call can belong to. Used by
 * `generateJson` (src/lib/ai/generate.ts), the `AiTaskRouting` actions, and the
 * settings routing panel. Single source of truth — the UI must import
 * `AI_TASKS` rather than re-listing these.
 */
/**
 * `author` is separate from `grade`, deliberately. Authoring (the KLP
 * discrimination pipeline, `src/lib/klp/authoring.ts`) is judgment-heavy and
 * runs rarely — a handful of calls per card, once. Runtime grading is
 * latency-sensitive and runs constantly, on every quiz answer. Sharing one
 * task would force a single routing decision onto two workloads with
 * opposite cost/latency tradeoffs; splitting them lets a user pin authoring
 * to a strong model without touching the model that grades live answers.
 */
/**
 * `klp-extract` and `concept-tree` were split OUT of `autocomplete` on
 * 2026-09-05. That one task had been doing four jobs: card autofill (cosmetic,
 * thrown away after one screen), legacy KLP extraction fired from `after()` on
 * every set save, and both halves of the concept tree — seeding/placement and
 * summarising. Three of those four write PERSISTED knowledge.
 *
 * Two things were wrong with that. Pinning `autocomplete` to a cheap model in
 * settings silently sent background KLP extraction there too, which is a
 * quality decision nobody made. And once `/staff/ai-history` started reporting
 * per-task model performance, the `autocomplete` tab was averaging a
 * latency-sensitive typeahead together with a judgment-heavy extraction pass —
 * so the number said nothing about either.
 *
 * Adding task names is additive: `AiTaskRouting.task` stores strings, so
 * existing pins keep applying to whatever they already named, and the new
 * tasks simply start unpinned.
 */
export const AI_TASKS = [
  'grade',
  'plan',
  'distractors',
  'autocomplete',
  'klp-extract',
  'concept-tree',
  'note-analysis',
  'diagnostic',
  'author',
] as const;

export type AiTask = (typeof AI_TASKS)[number];
