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
export const AI_TASKS = ['grade', 'plan', 'distractors', 'autocomplete', 'note-analysis', 'diagnostic', 'author'] as const;

export type AiTask = (typeof AI_TASKS)[number];
