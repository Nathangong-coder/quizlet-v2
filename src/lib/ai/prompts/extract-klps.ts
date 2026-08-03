import { KlpExtractionSchema, KLP_KINDS, MAX_KLPS_PER_CARD } from '@/lib/ai/schemas';

export interface ExtractKlpsBuildInput {
  setTitle: string;
  /** `ref` is the card's index in this batch. Never pass a cuid. */
  cards: { ref: number; term: string; definition: string }[];
}

/**
 * Decomposes cards into Key Learning Points. Routed via task 'autocomplete'
 * (cheap tier) in generateJson — this is structured decomposition, not
 * judgment. Batched by the caller at KLP_BATCH_SIZE cards per call.
 */
export const EXTRACT_KLPS_PROMPT = {
  id: 'extract-klps',
  version: 1,
  schema: KlpExtractionSchema,

  build(input: ExtractKlpsBuildInput): string {
    const cards = input.cards
      .map((c) => `[${c.ref}] Term: ${c.term}\n    Definition: ${c.definition}`)
      .join('\n\n');

    return `You are a finance interview coach breaking flashcards into the specific things a candidate must be able to say to have actually answered them.

Study set: ${input.setTitle}

Cards:
${cards}

For each card, output its Key Learning Points (KLPs).

A KLP is a PROPOSITION that can be judged true or false about a candidate's answer — not a topic or a heading.
  GOOD: "WACC weights each capital source by market value, not book value"
  BAD:  "weighting"
  GOOD: "Depreciation is added back because it is a non-cash charge"
  BAD:  "non-cash charges"

How many:
- Give 1 to ${MAX_KLPS_PER_CARD} KLPs per card. Use as few as the card actually contains.
- Mark a card "atomic" when it is a bare vocabulary definition with a single thing to know (e.g. an acronym expansion). Atomic cards get exactly 1 KLP. Do NOT invent extra points to reach a quota — a padded KLP corrupts every question generated from it.
- Mark a card "compound" when it genuinely teaches several separable points.

weight (1-5): how central this point is to answering the card. Judge the KLPs of one card against each other — the point a candidate absolutely must hit is a 5; useful colour is a 1 or 2.

kind: one of ${KLP_KINDS.join(', ')}.
- definition: what something is
- mechanism: how it works
- causal: why, or what drives what
- condition: when it applies, or its constraints
- quantitative: a number, formula, or magnitude
- contrast: how it differs from an adjacent concept
- example: a concrete instance

Reference each card by the [ref] number shown above. Return one entry per card, in the same order.

Output JSON:
{ "cards": [ { "ref": number, "cardType": "atomic" | "compound", "klps": [ { "text": string, "weight": number, "kind": string } ] } ] }`;
  },
};
