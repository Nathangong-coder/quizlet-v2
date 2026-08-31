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

export { AUTOCOMPLETE_PROMPT, CARD_AUTOFILL_PROMPT } from './autocomplete';
export type { AutocompleteBuildInput, CardAutofillBuildInput } from './autocomplete';

export { STUDY_NOTE_ANALYSIS_PROMPT } from './study-note';
export type { StudyNoteAnalysisBuildInput } from './study-note';

export { SESSION_INSIGHT_PROMPT } from './session-insight';
export type { SessionInsightBuildInput } from './session-insight';

export { learnerContextBlock, distractorMemoryHint } from './shared';

export { EXTRACT_KLPS_PROMPT } from './extract-klps';
export type { ExtractKlpsBuildInput } from './extract-klps';

export { TRUE_FALSE_PROMPT } from './true-false';
export type { TrueFalseBuildInput } from './true-false';

export { SUMMARIZE_KLTS_PROMPT } from './summarize-klts';
export type { SummarizeKltsBuildInput } from './summarize-klts';

export { PLACE_KLTS_PROMPT } from './place-klts';
export type { PlaceKltsBuildInput } from './place-klts';

export { SUGGEST_SKELETON_PROMPT } from './suggest-skeleton';
export type { SuggestSkeletonBuildInput } from './suggest-skeleton';

import { MULTIPLE_CHOICE_PROMPT } from './multiple-choice';
import { GRADE_SHORT_ANSWER_PROMPT } from './grade-short-answer';
import { ANNOTATION_PROMPT } from './annotation';
import { MC_FEEDBACK_PROMPT } from './mc-feedback';
import { TRAINING_PLAN_PROMPT } from './training-plan';
import { AUTOCOMPLETE_PROMPT } from './autocomplete';
import { CARD_AUTOFILL_PROMPT } from './autocomplete';
import { STUDY_NOTE_ANALYSIS_PROMPT } from './study-note';
import { SESSION_INSIGHT_PROMPT } from './session-insight';
import { EXTRACT_KLPS_PROMPT } from './extract-klps';
import { TRUE_FALSE_PROMPT } from './true-false';
import { SUMMARIZE_KLTS_PROMPT } from './summarize-klts';
import { PLACE_KLTS_PROMPT } from './place-klts';
import { SUGGEST_SKELETON_PROMPT } from './suggest-skeleton';

/** All registry entries keyed by `id`, for introspection/tooling. */
export const PROMPT_REGISTRY = {
  [MULTIPLE_CHOICE_PROMPT.id]: MULTIPLE_CHOICE_PROMPT,
  [GRADE_SHORT_ANSWER_PROMPT.id]: GRADE_SHORT_ANSWER_PROMPT,
  [ANNOTATION_PROMPT.id]: ANNOTATION_PROMPT,
  [MC_FEEDBACK_PROMPT.id]: MC_FEEDBACK_PROMPT,
  [TRAINING_PLAN_PROMPT.id]: TRAINING_PLAN_PROMPT,
  [AUTOCOMPLETE_PROMPT.id]: AUTOCOMPLETE_PROMPT,
  [CARD_AUTOFILL_PROMPT.id]: CARD_AUTOFILL_PROMPT,
  [STUDY_NOTE_ANALYSIS_PROMPT.id]: STUDY_NOTE_ANALYSIS_PROMPT,
  [SESSION_INSIGHT_PROMPT.id]: SESSION_INSIGHT_PROMPT,
  [EXTRACT_KLPS_PROMPT.id]: EXTRACT_KLPS_PROMPT,
  [TRUE_FALSE_PROMPT.id]: TRUE_FALSE_PROMPT,
  [SUMMARIZE_KLTS_PROMPT.id]: SUMMARIZE_KLTS_PROMPT,
  [PLACE_KLTS_PROMPT.id]: PLACE_KLTS_PROMPT,
  [SUGGEST_SKELETON_PROMPT.id]: SUGGEST_SKELETON_PROMPT,
} as const;
