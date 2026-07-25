/**
 * Task-based model routing (Stage 6 Task 5).
 *
 * `MODEL_FALLBACKS` is the full fallback chain, corrected to match this
 * repo's actual dev-proxy routing in `litellm_config.yaml` (the source of
 * truth per this project's CLAUDE.md):
 *
 *   gemini-3-flash -> gemma-4-31b-it -> gemini-3.1-flash-lite
 *     -> gemma-3-27b-it -> gemma-3-12b-it
 *
 * The previous chain (`['gemini-3.5-flash', 'gemini-3.1-flash-lite',
 * 'gemma-4-31b-it']`) named a model (`gemini-3.5-flash`) that isn't even in
 * `litellm_config.yaml`'s model list, and every call site hardcoded
 * `DEFAULT_AI_MODEL` (or, in one place, a second hardcoded string) instead
 * of choosing a model appropriate to the task.
 *
 * `modelFor(task)` replaces that: it returns the *primary* model to try
 * first for a task category. `generateJsonWithGoogle`/`generateJsonMultimodal`
 * (src/lib/ai/google.ts) still handle the actual fallback by appending
 * `MODEL_FALLBACKS.filter(m => m !== model)` after the primary — that
 * mechanism is unchanged by this task.
 */

export const DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite';

export const MODEL_FALLBACKS = [
  'gemini-3-flash',
  'gemma-4-31b-it',
  'gemini-3.1-flash-lite',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
] as const;

export type AiModel = (typeof MODEL_FALLBACKS)[number];

/**
 * Task categories a prompt call falls into, for choosing a primary model:
 *  - `grade`: short-answer grading, annotation, quiz-attempt-summary
 *    analysis — judgment calls where response quality matters most.
 *  - `plan`: training-plan generation — a longer, more synthetic task.
 *  - `autocomplete`: card term/definition autocomplete while authoring.
 *  - `distractors`: MC option generation, plus MC/true-false answer
 *    feedback — cheap, short, high-volume calls.
 */
export type AiTask = 'grade' | 'plan' | 'autocomplete' | 'distractors';

/**
 * Returns the primary model to try first for a given task. `grade`/`plan`
 * start at the strongest model in the chain (`gemini-3-flash`); `
 * autocomplete`/`distractors` start at a cheaper tier
 * (`gemini-3.1-flash-lite` — the same model these call sites already used
 * pre-Task-5 as `DEFAULT_AI_MODEL`, so their QuizOptionCache cache keys stay
 * stable across this refactor).
 */
export function modelFor(task: AiTask): AiModel {
  switch (task) {
    case 'grade':
    case 'plan':
      return 'gemini-3-flash';
    case 'autocomplete':
    case 'distractors':
      return 'gemini-3.1-flash-lite';
  }
}
