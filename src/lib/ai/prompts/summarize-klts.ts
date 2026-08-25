import { KltSummarySchema, MAX_KLTS_PER_KLP } from '@/lib/ai/schemas';

export interface SummarizeKltsBuildInput {
  setTitle: string;
  /** `ref` is the KLP's index in this batch. Never pass a cuid. */
  klps: { ref: number; text: string; kind: string }[];
  /** Existing topic names to reuse, in priority order. May be empty. */
  candidates: string[];
}

/**
 * Summarizes KLPs into a short label plus 1-3 general topics (KLTs).
 *
 * Routed via task 'autocomplete' (cheap tier), like KLP extraction — this is
 * structured summarization, not judgment.
 *
 * BOTH grains come from ONE call because they are the same act of reading the
 * proposition; splitting them would double the cost for no gain.
 *
 * The label is deliberately NOT a replacement for `text`. The proposition
 * stays exactly as extracted: it is what a distractor gets corrupted from and
 * what a short answer is graded against, and neither survives being shortened
 * to a phrase.
 */
export const SUMMARIZE_KLTS_PROMPT = {
  id: 'summarize-klts',
  version: 1,
  schema: KltSummarySchema,

  build(input: SummarizeKltsBuildInput): string {
    const klps = input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n');

    const vocabulary =
      input.candidates.length > 0
        ? `Existing topics — REUSE one of these whenever it fits:\n${input.candidates
            .map((c) => `- ${c}`)
            .join('\n')}`
        : 'There are no existing topics yet. Mint new ones.';

    return `You are organising a study library. Each line below is a Key Learning Point (KLP): one specific claim a learner must be able to state.

Study set: ${input.setTitle}

KLPs:
${klps}

For each KLP, produce two things.

1. "label" — a SHORT headline for that point, 3 to 6 words, so it can be read at a glance in a list.
   GOOD: "Debt impact on WACC"
   GOOD: "Add back non-cash charges"
   BAD:  "WACC" (that is the topic, not this specific point)
   BAD:  "Debt is cheaper than equity because interest is tax-deductible" (that is the full proposition again)

2. "topics" — 1 to ${MAX_KLTS_PER_KLP} general subject areas this point belongs to, most central first.
   A topic is a CONCEPT NAME a textbook chapter might carry: "WACC", "bankruptcy", "terminal value", "working capital".
   - At most 4 words. Never a sentence, never a proper noun, never anything specific to one company or one study set.
   - Give FEWER topics rather than padding. An empty list is acceptable and is better than a wrong topic.
   - The same concept must always get the same name, so reuse the vocabulary below rather than inventing a synonym for it.

${vocabulary}

Reference each KLP by its [ref] number. Return one entry per KLP, in the same order.

Output JSON:
{ "klps": [ { "ref": number, "label": string, "topics": string[] } ] }`;
  },
};
