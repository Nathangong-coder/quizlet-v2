import { Card } from '@prisma/client';
import { AnnotationSchema } from '@/lib/ai/schemas';
import { learnerContextBlock } from './shared';

export interface AnnotationBuildInput {
  card: Card;
  answer: string;
  correct: string;
  profileBlock?: string;
}

/**
 * Annotates a short-answer response (bold/underline/highlight spans) for the
 * grading UI. Grouped with grade-short-answer.ts conceptually (both fire as
 * part of SA grading in src/actions/quiz.ts submitShortAnswer) but kept in
 * its own module since it has a distinct schema/output shape and is called
 * as a second, separate AI request. Routed via modelFor('grade').
 */
export const ANNOTATION_PROMPT = {
  id: 'annotation',
  version: 1,
  schema: AnnotationSchema,

  build(input: AnnotationBuildInput): string {
    return `${learnerContextBlock(input.profileBlock)}You are a linguistic expert. Analyze the following response for a finance interview.

Term: ${input.card.term}
Correct Definition: ${input.correct}
User Answer: "${input.answer}"

Your task is to annotate the user's response.

Annotate for:
1. **Bold**: Key technical terms (either used correctly or missed but should have been used).
2. **Underline**: Exceptional phrasing or strong terminology.
3. **Highlight**: Significant errors, omissions, or areas for improvement.

For each annotation, provide the exact text segment, its type, and a brief comment.

Output the result as JSON.

JSON Schema:
{
  "annotations": [
    { "type": "bold" | "underline" | "highlight", "text": string, "startIndex": number, "endIndex": number, "comment": string }
  ]
}`;
  },
};
