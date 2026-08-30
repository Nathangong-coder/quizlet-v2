import { CardAutocompleteSchema, CardAutofillSchema } from '@/lib/ai/schemas';

export interface AuthoringSetContext {
  title: string;
  description?: string | null;
  cards: Array<{ term: string; definition: string }>;
}

export interface AutocompleteBuildInput {
  set: AuthoringSetContext;
  currentText: string;
  side: 'term' | 'definition';
  categories: string[];
  referenceText?: string;
}

/**
 * Card term/definition autocomplete suggestions while authoring a set.
 * Not part of the memory-injection set (no learner-performance context is
 * relevant while writing new cards). Routed via task 'autocomplete' in
 * generateJson (cheap/fast tier).
 */
export const AUTOCOMPLETE_PROMPT = {
  id: 'autocomplete',
  version: 1,
  schema: CardAutocompleteSchema,

  build(input: AutocompleteBuildInput): string {
    const cards = input.set.cards.map((c) => `${c.term}: ${c.definition}`).join('\\n');
    const categoriesList = input.categories.join(', ');
    const referenceLabel = input.side === 'term' ? 'definition / answer' : 'term / question';
    const reference = input.referenceText?.trim()
      ? `\nThe existing ${referenceLabel} for this card is:\n"${input.referenceText}"\nUse it as the primary signal for a semantically correct completion.`
      : '';

    return `You are an AI study assistant for a finance interview prep app.

  Set Title: ${input.set.title}
  Set Description: ${input.set.description || 'No description provided'}
  Categories: ${categoriesList}

  Existing cards in this set:
  ${cards}

  The user is currently typing a ${input.side === 'term' ? 'term' : 'definition'}:
  "${input.currentText}"
  ${reference}

  Provide 3-5 plausible autocomplete suggestions that fit the context of this set and categories.
  If the user is typing a term, suggest common finance terms.
  If the user is typing a definition, suggest professional, concise interview-style definitions.
  When the existing other side is provided, make every suggestion answer or name that exact concept rather than generating a generic example.

  Output as JSON: { "suggestions": string[] }`;
  },
};

export interface CardAutofillBuildInput {
  set: AuthoringSetContext;
  term: string;
  definition: string;
  categories: string[];
}

/**
 * Generates a complete term/definition pair for an empty card or completes
 * the missing side from the side the learner already supplied. It deliberately
 * shares the `autocomplete` task with suggestions so one settings route covers
 * the whole authoring assistant.
 */
export const CARD_AUTOFILL_PROMPT = {
  id: 'card-autofill',
  version: 1,
  schema: CardAutofillSchema,

  build(input: CardAutofillBuildInput): string {
    const cards = input.set.cards.map((c) => `${c.term}: ${c.definition}`).join('\n');
    const categoriesList = input.categories.join(', ');

    return `You are an expert study-set author for a finance interview prep app.

Set title: ${input.set.title}
Set description: ${input.set.description || 'No description provided'}
Categories: ${categoriesList || 'None'}

Other cards in this set for context:
${cards || 'None yet'}

Current card draft:
Term / question: "${input.term || '[blank]'}"
Definition / answer: "${input.definition || '[blank]'}"

Complete this one flashcard.
- If one side is present, preserve its meaning exactly and write the missing side to match it.
- If both sides are blank, create a useful finance interview-prep term/question and its concise, accurate answer.
- Keep the term/question concise and the definition/answer specific enough to study from.
- Do not mention that you are an AI or add labels like "Term:" inside the values.

Output JSON with exactly this shape:
{ "term": string, "definition": string }`;
  },
};
