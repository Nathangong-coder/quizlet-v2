import { Card } from '@prisma/client';
import { ContentBlock } from '../cards/content';
import {
  MULTIPLE_CHOICE_PROMPT,
  GRADE_SHORT_ANSWER_PROMPT,
  ANNOTATION_PROMPT,
  MC_FEEDBACK_PROMPT,
  TRAINING_PLAN_PROMPT,
  AUTOCOMPLETE_PROMPT,
  TrainingPlanContext,
} from './prompts/registry';

/**
 * THIS FILE IS A SHIM (Stage 6 Task 5).
 *
 * The actual prompt text/schemas now live one-per-module under
 * `src/lib/ai/prompts/*` (see `./prompts/registry.ts`). These functions are
 * kept only so any import of the old names (`buildMultipleChoicePrompt`,
 * etc.) that this task missed doesn't break at runtime. All real call sites
 * (src/actions/quiz.ts, src/actions/training-plan.ts,
 * src/actions/card-autocomplete.ts) have been updated to import the
 * registry modules directly instead of going through these shims — new code
 * should do the same, not add new callers here.
 */

export const GRADING_RUBRIC = {
  clarity: 'How easy is the answer to understand? (1-10)',
  conciseness: 'Does the answer avoid unnecessary filler? (1-10)',
  correctness: 'How accurate is the answer compared to the definition? (1-10)',
  overall: 'Overall quality of the response. (1-10)',
};

// Text-only builders (legacy shims)

export function buildMultipleChoicePrompt(card: Card, siblingCards: Card[]) {
  return MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards });
}

export function buildShortAnswerGradePrompt(card: Card, answer: string) {
  return GRADE_SHORT_ANSWER_PROMPT.build({ card, answer });
}

// Multimodal builders (legacy shims)

export function buildMultipleChoicePromptParts(
  card: Card,
  promptBlocks: ContentBlock[],
  siblingCards: Card[],
): { parts: any[]; promptText: string } {
  return MULTIPLE_CHOICE_PROMPT.buildParts({ card, promptBlocks, siblingCards });
}

export function buildShortAnswerGradePromptParts(
  card: Card,
  promptBlocks: ContentBlock[],
  answer: string,
): { parts: any[]; promptText: string } {
  return GRADE_SHORT_ANSWER_PROMPT.buildParts({ card, promptBlocks, answer });
}

export type { TrainingPlanContext };

export function buildTrainingPlanPrompt(context: TrainingPlanContext) {
  return TRAINING_PLAN_PROMPT.build(context);
}

export function buildAnnotationPrompt(card: Card, answer: string, correct: string) {
  return ANNOTATION_PROMPT.build({ card, answer, correct });
}

export function buildMultipleChoiceGradePrompt(card: Card, selected: string, correct: string) {
  return MC_FEEDBACK_PROMPT.build({ card, selected, correct });
}

export function buildAutocompletePrompt(
  set: any,
  currentText: string,
  side: 'term' | 'definition',
  categories: string[],
) {
  return AUTOCOMPLETE_PROMPT.build({ set, currentText, side, categories });
}
