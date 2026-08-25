import { KltPlacementSchema } from '@/lib/ai/schemas';
import { MAX_TREE_DEPTH } from '@/lib/klt/tree';

export interface PlaceKltsBuildInput {
  /** The whole current tree, indented. Empty string when nothing exists yet. */
  tree: string;
  /** Concepts with no parent yet. */
  concepts: string[];
}

/**
 * Places unparented concepts into the tree.
 *
 * Separate from summarization because naming a concept and knowing where it
 * belongs are different tasks with different failure modes. Naming is anchored
 * by the KLP's own words and is reliable; placement is the compounding error
 * and wants the WHOLE tree in view rather than one batch of cards.
 *
 * Deliberately does NOT ask for a target depth. Demanding rungs produces
 * filler that becomes permanent structure — spec §12.1. Shallow output is
 * expected and is corrected later by refinement, not by prompting harder.
 */
export const PLACE_KLTS_PROMPT = {
  id: 'place-klts',
  version: 1,
  schema: KltPlacementSchema,

  build(input: PlaceKltsBuildInput): string {
    const tree =
      input.tree.length > 0
        ? `Existing concept tree — REUSE these nodes wherever they fit:\n${input.tree}`
        : 'The tree is empty. You are creating its first branches.';

    return `You are organising study concepts into a hierarchy.

${tree}

Place each of these concepts into the tree:
${input.concepts.map((c) => `- ${c}`).join('\n')}

For each one, return the full path from a top-level SUBJECT down to the concept itself.

Example shape:
  concept: "quick ratio"
  path: ["finance", "accounting", "financial statements", "liquidity ratios", "quick ratio"]

Rules:
- The FIRST element must be a broad subject — "finance", "biology", "modern history".
- The LAST element must be the concept exactly as given to you. Do not rename it.
- REUSE an existing node, spelled exactly as it appears above, at every level where one fits.
  Only invent a level that genuinely does not exist yet.
- Do NOT invent levels to make the path longer. A short accurate path is better than a padded one.
- At most ${MAX_TREE_DEPTH} elements including the concept.
- Every level must be a genuine generalisation of the one after it. Reading the path backwards
  must make sense: a quick ratio IS A liquidity ratio, which IS PART OF financial statements.

Output JSON:
{ "placements": [ { "concept": string, "path": string[] } ] }`;
  },
};
