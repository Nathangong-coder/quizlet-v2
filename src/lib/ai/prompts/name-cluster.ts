import { z } from 'zod';

/**
 * Naming a cluster parent (2026-09-15). The rebuild planner finds anchors
 * that share children or content words; three or more of them want a parent
 * above them — the owner's "semi-parent". This is the ONE model call the
 * rebuild makes, once per cluster: name the concept the members are all
 * parts of, or say there is none (a grab-bag is not a concept).
 */
export const ClusterNameSchema = z.object({
  /** A 1-4 word lowercase noun phrase, or null when the members do not share a real parent concept. */
  name: z.string().nullable(),
  reason: z.string().optional(),
});

export interface NameClusterBuildInput {
  domain: string;
  members: string[];
  sharedChildren: string[];
  /** Existing sibling parents already under the domain, so the name does not collide or restate one. */
  existing: string[];
}

export const NAME_CLUSTER_PROMPT = {
  id: 'name-cluster',
  version: 1,
  schema: ClusterNameSchema,

  build(input: NameClusterBuildInput): string {
    return `Several topic nodes in a finance study set look like parts of one larger concept. Name that concept, or say there is none.

The domain: ${input.domain}
The nodes: ${input.members.join(' · ')}
${input.sharedChildren.length ? `Children they share: ${input.sharedChildren.join(', ')}\n` : ''}Concepts already sitting at this level (do not restate one; if a member IS the parent of the others, answer with that member's name): ${input.existing.join(', ') || '(none)'}

A real parent is a thing a learner studies as one subject — "accretion/dilution analysis", "synergies", "deal consideration". Answer null when the nodes only share a word or a vague theme: a grab-bag parent hides more than it organises.

Output JSON: { "name": string | null, "reason": string }
The name is a lowercase noun phrase of at most four words, no articles.`;
  },
};
