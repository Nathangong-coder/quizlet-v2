import { KltSummarySchema, MAX_CONCEPTS_PER_KLP } from '@/lib/ai/schemas';
import { MAX_LABEL_WORDS, MAX_KLT_WORDS } from '@/lib/klt/normalize';

export interface SummarizeKltsBuildInput {
  setTitle: string;
  /** `ref` is the KLP's index in this batch. Never pass a cuid. */
  klps: { ref: number; text: string; kind: string }[];
  /** Existing topic names to reuse, in priority order. May be empty. */
  candidates: string[];
}

/**
 * Summarizes KLPs into a short label plus 1-2 specific leaf concepts (KLTs).
 * Breadth is not asked for here — it comes from the concept tree
 * (`Klt.parentKltId`), built separately from what this prompt returns.
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
  version: 4,
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
   It is a TITLE, not a sentence. Never a full clause, never a verb phrase describing the whole claim.
   GOOD: "Debt impact on WACC"
   GOOD: "Add back non-cash charges"
   GOOD: "Bankruptcy risk and interest rates"
   BAD:  "WACC" (that is the topic, not this specific point)
   BAD:  "Debt is cheaper than equity because interest is tax-deductible" (a sentence, not a headline)
   BAD:  copying or lightly rewording the KLP text above (that is the single most common mistake here)
   HARD LIMIT: ${MAX_LABEL_WORDS} words. A label longer than that is DISCARDED and the point loses its headline entirely.

2. "concepts" — 1 to ${MAX_CONCEPTS_PER_KLP} SPECIFIC concepts this point is about, most central first.
   Take the first one from the key words of the KLP itself. Do NOT give broader categories:
   the app already knows that a quick ratio is a liquidity ratio and that liquidity sits under
   accounting. Your job is only the precise concept, not where it belongs.

   Worked examples:
     KLP: "The quick ratio excludes inventory from current assets."       -> ["quick ratio"]
     KLP: "Minority interest is added back when calculating Enterprise Value."
                                                                          -> ["minority interest"]
     KLP: "Chlorophyll absorbs light most strongly in blue and red wavelengths."
                                                                          -> ["chlorophyll"]

   Rules:
   - A concept must be something a DIFFERENT card could also be about.
     "quick ratio" passes. "quick ratio excludes inventory" is this key point restated, and fails.
   - At most ${MAX_KLT_WORDS} words each. Never a sentence, never a proper noun, never anything
     specific to one company, person or study set.
   - REUSE an existing concept from the list below whenever one fits, exactly as written.
   - One concept is normal. Give a second ONLY when the point genuinely covers two ideas.

${vocabulary}

Reference each KLP by its [ref] number. Return one entry per KLP, in the same order.

Output JSON:
{ "klps": [ { "ref": number, "label": string, "concepts": string[] } ] }`;
  },
};
