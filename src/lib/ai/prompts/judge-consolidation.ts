import { z } from 'zod';

/**
 * The consolidation judge (2026-09-15). The rebuild planner lists pairs of
 * real nodes where one name contains the other ("pro forma eps calculation"
 * / "pro forma eps"; "equity purchase price" / "purchase price") and asks,
 * per pair, whether they are ONE topic (merge: the specific becomes an alias
 * of the general), a genuine sub-topic (keep both, the specific sits under
 * the general), or unrelated despite the shared words. The owner's rule: a
 * merge moves mastery, so it needs a judgment, never a string rule alone.
 */
export const CONSOLIDATION_VERDICTS = ['same', 'related', 'unrelated'] as const;

export const ConsolidationSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().min(0),
      verdict: z.enum(CONSOLIDATION_VERDICTS),
      reason: z.string().optional(),
    }),
  ),
});

export interface JudgePair {
  specific: string;
  general: string;
}

export const JUDGE_CONSOLIDATION_PROMPT = {
  id: 'judge-consolidation',
  version: 1,
  schema: ConsolidationSchema,

  build(domain: string, pairs: JudgePair[]): string {
    const list = pairs.map((p, i) => `${i}. "${p.specific}"  vs  "${p.general}"`).join('\n');
    return `You are judging whether two topic names in a study tree for "${domain}" name the SAME concept.

For each numbered pair, answer one of:
- "same": one topic; a learner who knows one knows the other. The first is a wording variant, a facet, or a calculation/analysis OF the second (e.g. "pro forma eps calculation" vs "pro forma eps"; "accretion/dilution test" vs "accretion/dilution").
- "related": a real sub-topic. The first is a narrower thing that deserves its own node beneath the second (e.g. "acquired deferred revenue" vs "deferred revenue"; "equity purchase price" vs "purchase price" — a component, not a synonym).
- "unrelated": the shared words are a coincidence (e.g. "interest expense" vs "expense").

Pairs:
${list}

Output JSON: { "verdicts": [ { "index": number, "verdict": "same" | "related" | "unrelated", "reason": string }, ... ] } — one entry per pair, in order.`;
  },
};
