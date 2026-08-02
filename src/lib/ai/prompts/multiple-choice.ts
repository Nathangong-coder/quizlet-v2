import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { MultipleChoiceOptionsSchema } from '@/lib/ai/schemas';
import { CORRUPTIONS } from '@/lib/quiz/options';
import { distractorMemoryHint } from './shared';

export interface PromptKlp {
  /** Index in this prompt. Never a cuid. */
  ref: number;
  text: string;
  kind: string;
}

export interface MultipleChoiceBuildInput {
  card: Card;
  siblingCards: Card[];
  /** Optional rendered LearnerProfile block (see lib/ai/context.ts). */
  profileBlock?: string;
  /** Live KLPs. Absent or empty falls back to the legacy sibling-seeded prompt. */
  klps?: PromptKlp[];
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
 * The v1 fallback: sibling-seeded, no KLP provenance. Used whenever a card
 * has no live KLPs — no AI key, unextracted card, or failed extraction —
 * so a working quiz is always available. Kept verbatim; do not "improve" it,
 * pre-existing tests assert on this exact text.
 */
function legacyBuild(input: MultipleChoiceBuildInput): string {
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
}

/**
 * Multiple-choice distractor-generation prompt. Registry entry per Stage 6
 * Task 5 — routed via task 'distractors' in generateJson (cheap/fast tier), cached in
 * QuizOptionCache keyed by {cardId, model}.
 *
 * v2 (Stage 8 Spec 1): when live KLPs are supplied, each distractor must
 * corrupt exactly one named KLP in exactly one named way, so a wrong pick
 * diagnoses itself with no grading call. `schema` stays the v1
 * MultipleChoiceOptionsSchema — the fallback path's contract; the KLP path's
 * contract is MultipleChoiceKlpSchema, imported directly by the caller.
 */
export const MULTIPLE_CHOICE_PROMPT = {
  id: 'multiple-choice',
  version: 2,
  schema: MultipleChoiceOptionsSchema,

  build(input: MultipleChoiceBuildInput): string {
    if (!input.klps || input.klps.length === 0) return legacyBuild(input);

    const klpList = input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n');

    return `You are a finance interview expert writing a multiple-choice question.

Term: ${input.card.term}
Correct Definition: ${input.card.definition}

Key Learning Points this card teaches:
${klpList}

Other related definitions, for flavour only:
- ${siblingDefinitions(input.card, input.siblingCards)}
${distractorMemoryHint(input.profileBlock)}
Write exactly 3 distractors. Each one must:
1. Corrupt EXACTLY ONE of the Key Learning Points above, named by its klpRef.
2. Use exactly one corruption from: ${CORRUPTIONS.join(', ')}.
   - inversion: reverse the direction, sign, or causality
   - conflation: describe it using an adjacent concept's content
   - misapplication: keep the concept but apply it in the wrong context
   - overgeneralization: state a conditional claim as universal
   - factual_error: change a specific number, formula term, or fact
3. Be wrong ONLY in the way named. A distractor that is wrong for several
   reasons at once cannot tell us what the candidate misunderstood.
4. Be similar enough to the correct definition that someone who half-knows the
   point would pick it.

Do not restate the correct definition as a distractor.

Output JSON:
{ "correctAnswer": string, "distractors": [ { "text": string, "klpRef": number, "corruption": string } ] }`;
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
