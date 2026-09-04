import { RelationDraftSchema } from '@/lib/ai/schemas';
import { RELATABLE_TYPES } from '@/lib/klp/relations';

export interface RelateKlpsBuildInput {
  question: string;
  klps: { text: string }[];
}

/**
 * Call D of the authoring pipeline: relations among the surviving KLPs of
 * ONE card, by three techniques — none of which asks the model to
 * introspect about pedagogy.
 *
 * PERTURBATION must ask for a COUNTERFACTUAL PREMISE, never a negation.
 * "K3 is false" cannot be propagated to anything; "depreciation is a cash
 * charge" can — you can re-derive what changes in a world where that is
 * true. This single distinction decides whether perturbation works at all.
 *
 * Every candidate edge must carry a PROBE: an answer that gets BOTH
 * endpoints demonstrably right and the link between them wrong. That
 * artifact is what proves the edge informative — if no such answer can be
 * written, the edge is definitional, carries no information, costs grading
 * tokens for nothing, and must be dropped rather than emitted.
 *
 * `part_of` is NOT in this vocabulary at all — that is the concept tree
 * (`SetKltNode`), a different hierarchy. `analogous_to` IS a valid relation
 * type generally, but is cross-card and must never be emitted by this call.
 * The prompt text below and `RelationDraftSchema` both read `RELATABLE_TYPES`
 * — the same constant — so the offered list and the enforced list cannot
 * drift apart. Prompt copy alone is not a defence against a model that
 * ignores it; the schema is what actually rejects `analogous_to`.
 */
export const RELATE_KLPS_PROMPT = {
  id: 'relate-klps',
  version: 1,
  schema: RelationDraftSchema,

  build(input: RelateKlpsBuildInput): string {
    const klps = input.klps.map((k, i) => `[${i}] ${k.text}`).join('\n');

    return `You are finding the load-bearing links among the Key Learning Points (KLPs) of one interview question — not describing every way they relate, only the ones where missing the link is a specific, nameable mistake.

Question: ${input.question}

Key Learning Points:
${klps}

Look for edges by three techniques:

1. PERTURBATION — for each KLP, state a COUNTERFACTUAL PREMISE (never a negation): not "this KLP is false", but the substantive alternative world it implies — e.g. not "depreciation does not reduce cash" but "depreciation is a cash charge". Then re-derive, inside that counterfactual world, which OTHER KLPs would change as a result. That gives directed edges: "causes" (this KLP's truth drives that one), "requires" (that KLP cannot hold without this one), "applies_within" (this KLP only holds under the condition the other one sets).

2. ORDER VIOLATION — consider the KLPs shuffled out of order. Keep a rejection ONLY where the LATER point's derivation genuinely CONSUMES the earlier point's output — you cannot state the later claim without already having the earlier one's result in hand. Give a reason for every such pair. This yields "precedes" edges. Do not report stylistic ordering preferences; those are not relations.

3. SUBSTITUTION — which pairs of KLPs would a learner plausibly MISTAKE for each other, stating one when they mean the other? This yields "confused_with" edges (symmetric).

For every candidate edge you consider, write a PROBE: an answer that gets BOTH endpoints demonstrably right and the link between them wrong. If you cannot write such an answer, the edge is DEFINITIONAL — it carries no information, costs grading tokens for nothing — and must be DROPPED, not emitted.

Prune hard. Seven KLPs have 21 possible pairs and perhaps four edges that matter. Only keep an edge where a learner could plausibly hold both endpoints and still miss the link.

Offer only these relation types: ${RELATABLE_TYPES.join(', ')}. Do not use any other type.

Output JSON:
{ "relations": [ { "from": number, "to": number, "type": string, "provenance": "perturbation" | "order_violation" | "substitution", "rationale": string, "probe": string } ] }
"from"/"to" are the [index] numbers above.`;
  },
};
