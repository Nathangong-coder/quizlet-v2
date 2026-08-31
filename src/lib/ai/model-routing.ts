/**
 * The task categories a generation call can belong to. Used by
 * `generateJson` (src/lib/ai/generate.ts), the `AiTaskRouting` actions, and the
 * settings routing panel. Single source of truth — the UI must import
 * `AI_TASKS` rather than re-listing these.
 */
export const AI_TASKS = ['grade', 'plan', 'distractors', 'autocomplete', 'note-analysis'] as const;

export type AiTask = (typeof AI_TASKS)[number];
