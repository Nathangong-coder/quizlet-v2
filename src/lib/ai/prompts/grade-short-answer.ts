import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas';
import { learnerContextBlock } from './shared';

export interface GradeShortAnswerBuildInput {
  card: Card;
  answer: string;
  profileBlock?: string;
}

export interface GradeShortAnswerBuildPartsInput {
  card: Card;
  promptBlocks: ContentBlock[];
  answer: string;
  profileBlock?: string;
}

const RUBRIC_BODY = `For each of the following categories, provide a score (1-10), a list of pros, and a list of cons:
1. Clarity: How easy is the answer to understand?
2. Conciseness: Does the answer avoid unnecessary filler?
3. Correctness: How accurate is the answer compared to the definition?

Additionally, provide:
- Overall Score: A final weighted grade (1-10).
- Summary: A concise synthesis of the performance.
- Suggested Improvement: A specific, actionable tip to make this answer "interview-ready".

Output the result as JSON.

JSON Schema:
{
  "clarity": { "score": number, "pros": string[], "cons": string[] },
  "conciseness": { "score": number, "pros": string[], "cons": string[] },
  "correctness": { "score": number, "pros": string[], "cons": string[] },
  "overall": number,
  "summary": string,
  "suggestedImprovement": string
}`;

/**
 * Short-answer grading prompt. Registry entry per Stage 6 Task 5 — routed
 * via modelFor('grade') (strongest available flash). The rubric/schema is
 * unchanged from the pre-registry version: still 1-10
 * clarity/conciseness/correctness/overall. `profileBlock` only adds learner
 * context; it does not change what's being graded.
 */
export const GRADE_SHORT_ANSWER_PROMPT = {
  id: 'grade-short-answer',
  version: 1,
  schema: ShortAnswerGradeSchema,

  build(input: GradeShortAnswerBuildInput): string {
    return `${learnerContextBlock(input.profileBlock)}You are a finance interview grader. Grade the following short-answer response.

Term: ${input.card.term}
Expected Definition: ${input.card.definition}
User Answer: "${input.answer}"

${RUBRIC_BODY}`;
  },

  buildParts(input: GradeShortAnswerBuildPartsInput): { parts: any[]; promptText: string } {
    const promptText = `${learnerContextBlock(input.profileBlock)}You are a finance interview grader. Grade the following short-answer response.

${input.promptBlocks.some((b) => b.type !== 'text') ? '[The question material is shown above/below as images, audio, video, etc.]' : ''}

Expected Definition: ${input.card.definition}
User Answer: "${input.answer}"

${RUBRIC_BODY}`;

    return { parts: [{ text: promptText }], promptText };
  },
};
