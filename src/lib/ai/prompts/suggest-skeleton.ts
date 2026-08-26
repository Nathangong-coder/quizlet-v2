import { KltSkeletonSchema, MAX_SKELETON_DEPTH } from '@/lib/ai/schemas';
import { MAX_KLT_WORDS } from '@/lib/klt/normalize';

export interface SuggestSkeletonBuildInput {
  /** The subject to anchor, e.g. "finance". Becomes every path's root. */
  subject: string;
  /**
   * Leaf concepts already extracted from the learner's cards under this
   * subject — evidence of what it covers. These must NOT appear in the
   * output: they are leaves, and this prompt is asked only for the levels
   * ABOVE them.
   */
  sampleConcepts: string[];
}

/**
 * Anchors the TOP of the concept tree for a subject, before any leaf
 * placement happens.
 *
 * This exists because placement (`place-klts.ts`) reliably COLLAPSES the
 * middle rungs of a hierarchy — asked to place "depreciation add-back" it
 * returns 4 levels, not 8, skipping the intermediate ones. Anchoring the top
 * 2-3 rungs FIRST, as their own deliberate act, gives later placements real
 * intermediate nodes to land on instead of inventing a shortcut straight from
 * the subject to the leaf.
 *
 * Deliberately narrow: this prompt is never asked to place a concept, only to
 * name the broad areas above them. The two tasks fail in different ways and
 * mixing them reproduces the exact collapsing this prompt exists to prevent.
 *
 * The result is a PROPOSAL. `suggestSkeleton` (src/actions/klt-seed.ts) never
 * writes it — a human must review it and call `applySkeleton` explicitly.
 */
export const SUGGEST_SKELETON_PROMPT = {
  id: 'suggest-skeleton',
  version: 1,
  schema: KltSkeletonSchema,

  build(input: SuggestSkeletonBuildInput): string {
    const sample = input.sampleConcepts.map((c) => `- ${c}`).join('\n');

    return `You are anchoring the TOP of a study concept hierarchy for the subject "${input.subject}".

These specific concepts have already been extracted from the learner's cards. They are evidence of what "${input.subject}" covers — read them to understand the shape of the material — but they are LEAVES, already placed at the bottom of the tree, and must NOT appear anywhere in your output:
${sample}

Return only the TOP levels — broad areas, never specific concepts. Your job is to name the 2 to 3 broad areas a curriculum in "${input.subject}" would be organised into, not to place any of the concepts above.

Rules:
- The FIRST element of every path must be exactly "${input.subject}".
- At most ${MAX_SKELETON_DEPTH} elements per path, including "${input.subject}" itself.
- Each element after the first: at most ${MAX_KLT_WORDS} words, never a sentence, never a proper noun, never anything specific to one company, person or study set.
- Broad areas only. If an element could itself be one of the concepts listed above, it is too
  specific — go broader.
- Do NOT invent extra rungs to make a path longer. A short accurate path is better than a padded one.
- Every level must be a genuine generalisation of the one after it, and of the leaf concepts it will
  eventually contain.

Example shape for subject "finance":
  ["finance", "accounting"]
  ["finance", "corporate finance", "valuation"]

Output JSON:
{ "paths": string[][] }`;
  },
};
