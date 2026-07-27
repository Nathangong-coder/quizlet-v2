/**
 * Task-based model routing (Stage 6 Task 5).
 *
 * `MODEL_FALLBACKS` is the full fallback chain. Every id here is a real
 * model id as accepted by the Generative Language API's `generateContent`
 * on the v1beta endpoint, verified against `ListModels` *and* a live call —
 * not a `litellm_config.yaml` alias.
 *
 * That distinction is the bug this chain previously had. In
 * `litellm_config.yaml`, `model_name:` is a local alias and
 * `litellm_params.model:` is the real upstream id, e.g.
 * `gemini-3-flash` -> `gemini/gemini-3-flash-preview`. The chain had been
 * copied from the *alias* column, so `gemini-3-flash` 404'd when sent
 * straight to Google, as did `gemma-3-27b-it` and `gemma-3-12b-it` (no
 * gemma-3 tier is offered on this endpoint at all). Three of five entries
 * were dead, so a failure on the primary burned through the chain and
 * surfaced as "failed after trying all fallbacks".
 *
 * Do not add an id here without confirming it returns 200 from
 * `POST /v1beta/models/<id>:generateContent`. Presence in `ListModels` is
 * NOT sufficient — `gemini-2.5-flash` lists but 404s on generation.
 *
 * `modelFor(task)` returns the *primary* model to try first for a task
 * category. `generateJsonWithGoogle`/`generateJsonMultimodal`
 * (src/lib/ai/google.ts) handle the actual fallback by appending
 * `MODEL_FALLBACKS.filter(m => m !== model)` after the primary.
 */

export const DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite';

export const MODEL_FALLBACKS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemma-4-31b-it',
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
 * start at the strongest model in the chain (`gemini-3.6-flash`);
 * `autocomplete`/`distractors` start at a cheaper tier
 * (`gemini-3.1-flash-lite` — kept deliberately, since QuizOptionCache is
 * keyed on the model id and changing it would silently orphan every cached
 * distractor set).
 */
export function modelFor(task: AiTask): AiModel {
  switch (task) {
    case 'grade':
    case 'plan':
      return 'gemini-3.6-flash';
    case 'autocomplete':
    case 'distractors':
      return 'gemini-3.1-flash-lite';
  }
}
