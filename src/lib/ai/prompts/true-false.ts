import { Card } from '@prisma/client';
import { TrueFalseStatementSchema } from '@/lib/ai/schemas';
import { CORRUPTIONS } from '@/lib/quiz/options';
import type { PromptKlp } from './multiple-choice';

export interface TrueFalseBuildInput {
  card: Card;
  klps: PromptKlp[];
}

/**
 * Builds the FALSE half of a true/false question: a statement that corrupts
 * exactly one KLP. The TRUE half needs no generation — it is the card's own
 * definition. Routed via task 'distractors'.
 */
export const TRUE_FALSE_PROMPT = {
  id: 'true-false',
  version: 1,
  schema: TrueFalseStatementSchema,

  build(input: TrueFalseBuildInput): string {
    const klpList = input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n');

    return `You are a finance interview expert writing a true/false question.

Term: ${input.card.term}
Correct Definition: ${input.card.definition}

Key Learning Points this card teaches:
${klpList}

Rewrite the definition into a statement that is FALSE.

Requirements:
1. Corrupt EXACTLY ONE Key Learning Point, named by its klpRef.
2. Use exactly one corruption from: ${CORRUPTIONS.join(', ')}.
3. Leave every other part of the definition intact and correct. A statement
   wrong in several ways cannot tell us which point the candidate missed.
4. Keep it plausible. A statement that is obviously absurd is rejected without
   the candidate ever engaging with the learning point, which tests nothing.
5. Do not signal falsity through hedging, vagueness, or unusual phrasing. It
   must read exactly like a confident, correct definition.

Output JSON:
{ "statement": string, "klpRef": number, "corruption": string }`;
  },
};
