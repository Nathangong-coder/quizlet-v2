import { CardAutocompleteSchema } from '@/lib/ai/schemas';

export interface AutocompleteBuildInput {
  set: any;
  currentText: string;
  side: 'term' | 'definition';
  categories: string[];
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
    const cards = input.set.cards.map((c: any) => `${c.term}: ${c.definition}`).join('\\n');
    const categoriesList = input.categories.join(', ');

    return `You are an AI study assistant for a finance interview prep app.

  Set Title: ${input.set.title}
  Set Description: ${input.set.description || 'No description provided'}
  Categories: ${categoriesList}

  Lexisting cards in this set:
  ${cards}

  The user is currently typing a ${input.side === 'term' ? 'term' : 'definition'}:
  "${input.currentText}"

  Provide 3-5 plausible autocomplete suggestions that fit the context of this set and categories.
  If the user is typing a term, suggest common finance terms.
  If the user is typing a definition, suggest professional, concise interview-style definitions.

  Output as JSON: { "suggestions": string[] }`;
  },
};
