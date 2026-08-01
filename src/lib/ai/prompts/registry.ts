/**
 * Single re-export point for every versioned prompt module (Stage 6 Task 5).
 *
 * Each module exports an object shaped `{ id, version, build(input), schema
 * [, buildParts(input) for multimodal variants] }`. Call sites (src/actions/
 * *.ts) should import directly from the specific module (e.g.
 * `@/lib/ai/prompts/grade-short-answer`) or from this barrel — both resolve
 * to the same objects. `src/lib/ai/prompts.ts` (the pre-Task-5 monolithic
 * file) now re-exports the old function names as thin shims delegating to
 * these modules, kept only so any not-yet-updated import doesn't break.
 *
 * `promptVersion` (persisted on `QuizAnswer.grade` and `TrainingPlan`) should
 * always be read from these `.version` fields, not hardcoded, so bumping a
 * prompt's wording and its version stay in lockstep.
 */

export { MULTIPLE_CHOICE_PROMPT } from './multiple-choice';
export type { MultipleChoiceBuildInput, MultipleChoiceBuildPartsInput } from './multiple-choice';

export { GRADE_SHORT_ANSWER_PROMPT } from './grade-short-answer';
export type {
  GradeShortAnswerBuildInput,
  GradeShortAnswerBuildPartsInput,
} from './grade-short-answer';

export { ANNOTATION_PROMPT } from './annotation';
export type { AnnotationBuildInput } from './annotation';

export { MC_FEEDBACK_PROMPT } from './mc-feedback';
export type { McFeedbackBuildInput } from './mc-feedback';

export { TRAINING_PLAN_PROMPT } from './training-plan';
export type { TrainingPlanContext } from './training-plan';

export { AUTOCOMPLETE_PROMPT } from './autocomplete';
export type { AutocompleteBuildInput } from './autocomplete';

export { SESSION_INSIGHT_PROMPT } from './session-insight';
export type { SessionInsightBuildInput } from './session-insight';

export { learnerContextBlock, distractorMemoryHint } from './shared';

import { MULTIPLE_CHOICE_PROMPT } from './multiple-choice';
import { GRADE_SHORT_ANSWER_PROMPT } from './grade-short-answer';
import { ANNOTATION_PROMPT } from './annotation';
import { MC_FEEDBACK_PROMPT } from './mc-feedback';
import { TRAINING_PLAN_PROMPT } from './training-plan';
import { AUTOCOMPLETE_PROMPT } from './autocomplete';
import { SESSION_INSIGHT_PROMPT } from './session-insight';

/** All registry entries keyed by `id`, for introspection/tooling. */
export const PROMPT_REGISTRY = {
  [MULTIPLE_CHOICE_PROMPT.id]: MULTIPLE_CHOICE_PROMPT,
  [GRADE_SHORT_ANSWER_PROMPT.id]: GRADE_SHORT_ANSWER_PROMPT,
  [ANNOTATION_PROMPT.id]: ANNOTATION_PROMPT,
  [MC_FEEDBACK_PROMPT.id]: MC_FEEDBACK_PROMPT,
  [TRAINING_PLAN_PROMPT.id]: TRAINING_PLAN_PROMPT,
  [AUTOCOMPLETE_PROMPT.id]: AUTOCOMPLETE_PROMPT,
  [SESSION_INSIGHT_PROMPT.id]: SESSION_INSIGHT_PROMPT,
} as const;
