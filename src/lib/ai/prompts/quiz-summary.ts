import { z } from 'zod';
import { learnerContextBlock } from './shared';

export const QuizSummarySchema = z.object({ analysis: z.string() });

export interface QuizSummaryAnswer {
  term: string;
  isCorrect: boolean | null;
  score: number | null;
  feedback: string | null;
}

export interface QuizSummaryBuildInput {
  setTitle: string;
  mode: string;
  score: number | null;
  answers: QuizSummaryAnswer[];
  profileBlock?: string;
}

/**
 * Post-quiz holistic analysis prompt. De-inlined from
 * `getQuizAttemptSummary` in src/actions/quiz.ts (Stage 6 Task 5, step 3) —
 * previously a template literal built directly in the action body. Routed
 * via modelFor('grade') (strongest available flash).
 */
export const QUIZ_SUMMARY_PROMPT = {
  id: 'quiz-summary',
  version: 1,
  schema: QuizSummarySchema,

  build(input: QuizSummaryBuildInput): string {
    const details = input.answers
      .map(
        (a) =>
          `- Card: ${a.term} | Correct: ${a.isCorrect ? 'Yes' : 'No'} | Score: ${a.score}/100 | Feedback: ${a.feedback}`,
      )
      .join('\\n');

    return `${learnerContextBlock(input.profileBlock)}You are an AI study coach. Analyze this user's quiz attempt.

Set: ${input.setTitle}
Mode: ${input.mode}
Score: ${input.score}%

Performance Details:
${details}

Provide a holistic breakdown. Use clear headers and separate each section with double newlines:

### Strengths
Identify what the user did well.

### Weaknesses
Where did they struggle?

### Action Plan
3 key topics to focus on next.

Output as JSON: { "analysis": string }`;
  },
};
