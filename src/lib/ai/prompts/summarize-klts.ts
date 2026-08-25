import { KltSummarySchema, MAX_KLTS_PER_KLP } from '@/lib/ai/schemas';
import { MAX_LABEL_WORDS, MAX_KLT_WORDS } from '@/lib/klt/normalize';

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
  version: 3,
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

2. "topics" — a LADDER of 1 to ${MAX_KLTS_PER_KLP} subject areas, ordered from SPECIFIC to BROAD.
   Build the first one out of the key words in the KLP itself, then step outward.
   - Topic 1: the narrow concept this point is actually about. Take it from the KLP's own wording.
   - Topic 2: the area that concept belongs to.
   - Topic 3: the discipline it sits in.

   Worked example (finance):
     KLP: "Minority interest is added back to net income when calculating Enterprise Value."
     topics: ["net income adjustments", "income statement", "accounting"]

   Worked example (biology):
     KLP: "Chlorophyll absorbs light most strongly in the blue and red wavelengths."
     topics: ["chlorophyll", "photosynthesis", "biology"]

   Worked example (history):
     KLP: "The Treaty of Versailles imposed reparations that destabilised the Weimar economy."
     topics: ["war reparations", "interwar treaties", "modern history"]

   Rules:
   - Topic 1 must NEVER be a vague umbrella. Words like "analysis", "concepts", "fundamentals",
     "reporting", "statements", "management" and "principles" describe a shelf, not an idea.
     If topic 1 could apply to half the cards in this set, it is too broad — go narrower.
   - At most ${MAX_KLT_WORDS} words each. Never a sentence, never a proper noun, never anything
     specific to one company, one person or one study set.
   - REUSE an existing topic from the vocabulary below whenever one fits, at any rung. The same
     concept must always get the same name — never invent a synonym for something already there.
   - Fewer rungs is fine. OMIT a level rather than inventing a vague one to fill it.

${vocabulary}

Reference each KLP by its [ref] number. Return one entry per KLP, in the same order.

Output JSON:
{ "klps": [ { "ref": number, "label": string, "topics": string[] } ] }`;
  },
};
