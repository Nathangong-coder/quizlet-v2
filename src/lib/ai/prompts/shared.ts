/**
 * Shared helpers for the versioned prompt registry (src/lib/ai/prompts/*).
 *
 * Keeps the exact phrasing used to inject a learner's `LearnerProfile`
 * snapshot (see src/lib/memory/profile.ts + src/lib/ai/context.ts) into
 * prompt text consistent across modules, instead of every prompt module
 * reinventing its own wording.
 *
 * Two phrasings are used, per the Stage 6 Task 5 brief:
 *  - `learnerContextBlock`: a neutral "Learner context: ..." prefix, used by
 *    grading (short-answer + annotation), training-plan, and quiz-summary —
 *    prompts where the model is judging or planning around the learner.
 *  - `distractorMemoryHint`: a directive appended to MC-generation prompts,
 *    explicitly asking the model to use the learner's weak spots when
 *    inventing distractors.
 *
 * Both are no-ops (return '') when no profileBlock is supplied, so every
 * `build()` that accepts an optional `profileBlock` works identically to
 * before this task when the caller omits it (e.g. profile-building failed
 * and the call site fell back to no context).
 */

export function learnerContextBlock(profileBlock?: string): string {
  if (!profileBlock) return '';
  return `Learner context: ${profileBlock}\n\n`;
}

export function distractorMemoryHint(profileBlock?: string): string {
  if (!profileBlock) return '';
  return `\nGiven this learner's recent performance, make distractors probe their specific confusions where relevant:\n${profileBlock}\n`;
}
