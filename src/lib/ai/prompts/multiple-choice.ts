import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { MultipleChoiceOptionsSchema } from '@/lib/ai/schemas';
import { distractorMemoryHint } from './shared';

export interface MultipleChoiceBuildInput {
  card: Card;
  siblingCards: Card[];
  /** Optional rendered LearnerProfile block (see lib/ai/context.ts). */
  profileBlock?: string;
}

export interface MultipleChoiceBuildPartsInput {
  card: Card;
  promptBlocks: ContentBlock[];
  siblingCards: Card[];
  profileBlock?: string;
}

function siblingDefinitions(card: Card, siblingCards: Card[]): string {
  return siblingCards
    .filter((c) => c.id !== card.id)
    .map((c) => c.definition)
    .join('\n- ');
}

/**
 * Multiple-choice distractor-generation prompt. Registry entry per Stage 6
 * Task 5 — routed via task 'distractors' in generateJson (cheap/fast tier), cached in
 * QuizOptionCache keyed by {cardId, model}.
 */
export const MULTIPLE_CHOICE_PROMPT = {
  id: 'multiple-choice',
  version: 1,
  schema: MultipleChoiceOptionsSchema,

  build(input: MultipleChoiceBuildInput): string {
    const siblings = siblingDefinitions(input.card, input.siblingCards);

    return `You are a finance interview expert. Generate a multiple-choice question for the following term.

Term: ${input.card.term}
Correct Definition: ${input.card.definition}

Other related definitions (use these as inspiration for plausible but incorrect distractors):
- ${siblings}
${distractorMemoryHint(input.profileBlock)}
Requirements:
1. Provide exactly 4 options.
2. One option must be the exact correct definition.
3. The other 3 must be plausible but incorrect distractors.
4. Output the result as JSON.

JSON Schema:
{
  "options": string[],
  "correctAnswer": string
}`;
  },

  /**
   * Multimodal variant: the term side's media is rendered above/below this
   * text by the caller; this only builds the accompanying text part.
   */
  buildParts(input: MultipleChoiceBuildPartsInput): { parts: any[]; promptText: string } {
    const siblings = siblingDefinitions(input.card, input.siblingCards);

    const promptText = `You are a finance interview expert. Generate a multiple-choice question based on the material shown.

${input.promptBlocks.some((b) => b.type !== 'text') ? '[The question material is shown above/below as images, audio, video, etc.]' : ''}

Correct Definition: ${input.card.definition}

Other related definitions (use these as inspiration for plausible but incorrect distractors):
- ${siblings}
${distractorMemoryHint(input.profileBlock)}
Requirements:
1. Provide exactly 4 options.
2. One option must be the exact correct definition.
3. The other 3 must be plausible but incorrect distractors.
4. Output the result as JSON.

JSON Schema:
{
  "options": string[],
  "correctAnswer": string
}`;

    return { parts: [{ text: promptText }], promptText };
  },
};
