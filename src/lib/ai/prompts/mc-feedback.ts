import { Card } from '@prisma/client';
import { MultipleChoiceFeedbackSchema } from '@/lib/ai/schemas';

export interface McFeedbackBuildInput {
  card: Card;
  selected: string;
  correct: string;
}

/**
 * Post-answer feedback for both multiple-choice and true/false questions
 * (the "true"/"false" strings are just passed as `correct`/`selected`).
 * Not part of the memory-injection set in the Task 5 brief (only grading,
 * MC generation, training-plan, and quiz-summary get a profileBlock) — this
 * is a short, per-answer confirmation/explanation, not a judgment that
 * benefits from broader learner context. Routed via modelFor('distractors')
 * (cheap/fast tier), same bucket as MC option generation.
 */
export const MC_FEEDBACK_PROMPT = {
  id: 'mc-feedback',
  version: 1,
  schema: MultipleChoiceFeedbackSchema,

  build(input: McFeedbackBuildInput): string {
    return `You are a finance interview grader. A user answered a multiple-choice question.

  Term: ${input.card.term}
  Correct Definition: ${input.correct}
  User's Selected Option: ${input.selected}

  If the answer is correct, provide a brief confirmation and a "pro tip" to deepen their understanding.
  If the answer is incorrect, explain WHY it is wrong and why the correct answer is the right one.

  Keep it concise (1-2 sentences).
  Output as JSON: { "feedback": string }`;
  },
};
