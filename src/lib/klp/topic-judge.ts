/**
 * The adjudicator call for dual-model topic minting: what it is shown, what it
 * may answer, and how its answer maps back onto the reconciler's sides.
 *
 * It is asked two CLOSED questions per item and never "are both wrong" — the
 * owner does not trust a third model with that. The side each candidate is
 * shown under (A/B) is randomised per item HERE, with the seed recorded, so
 * the judge cannot learn that one slot is usually the better model. The
 * weighting toward Gemini is applied by `applyVerdicts`, not by the judge.
 */
import { z } from 'zod'
import type { Conflict, Candidate, Verdict } from './topic-reconcile'

export const JudgeVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      item: z.number().int(),
      sameConcept: z.boolean(),
      prefer: z.enum(['A', 'B']).optional(),
      strength: z.enum(['clear', 'slight']).optional(),
    }),
  ),
})

export interface JudgeItem {
  index: number
  conflict: Conflict
  /** Which reconciler side is shown as "A". */
  aIs: 'a' | 'b'
  klpText: string
}

/** Deterministic per-item coin from a seed, so a run is reproducible. */
function coin(seed: number, i: number): boolean {
  let x = (seed ^ (i * 0x9e3779b9)) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return ((x >>> 0) & 1) === 1
}

export function buildJudgeItems(
  conflicts: Conflict[],
  klpTexts: string[],
  seed: number,
): JudgeItem[] {
  return conflicts.map((conflict, index) => ({
    index,
    conflict,
    aIs: coin(seed, index) ? 'a' : 'b',
    klpText: klpTexts[conflict.klpRef] ?? '',
  }))
}

function describe(c: Candidate): string {
  if (c.shape === 'leaf') return `LEAF "${c.name}"`
  return (c.edges ?? []).map((e) => `RELATION ${e.from} --${e.type}--> ${e.to}`).join(' ; ')
}

export function buildJudgePrompt(items: JudgeItem[]): string {
  const lines = items.map((it) => {
    const c = it.conflict
    const A = it.aIs === 'a' ? c.a : c.b
    const B = it.aIs === 'a' ? c.b : c.a
    return `ITEM ${it.index}
  key point (${c.klpKind}): ${it.klpText}
  A: ${describe(A)}
  B: ${describe(B)}`
  })
  return `Two annotators mapped the same key learning points from a finance flashcard onto a
topic map. A LEAF is a topic node the point belongs to. A RELATION is an edge between two
topic nodes, used when the point itself describes how two things connect.

For each item below, answer two questions:
1. sameConcept — are A and B naming the SAME concept, merely worded differently?
   (e.g. "accounting equation" and "fundamental accounting equation" -> true;
    "depreciation" and "non-cash expense add-backs" -> false, one is an example of the
    other; a LEAF and a RELATION are never the same concept -> false)
2. If not the same concept: which is the more accurate mapping for this key point, A or B,
   and is that preference clear or slight? Judge accuracy of the mapping to THIS key
   point — the right shape (thing vs link), the right grain, plain reusable naming.

Do not say both are wrong; pick one. Do not explain.

${lines.join('\n\n')}`
}

/** Maps A/B answers back to reconciler sides a/b. */
export function toVerdicts(
  items: JudgeItem[],
  parsed: z.infer<typeof JudgeVerdictSchema>,
): Verdict[] {
  const out: Verdict[] = []
  for (const v of parsed.verdicts) {
    const it = items.find((x) => x.index === v.item)
    if (!it) continue
    let prefer: 'a' | 'b' | undefined
    if (v.prefer) {
      prefer = v.prefer === 'A' ? it.aIs : it.aIs === 'a' ? 'b' : 'a'
    }
    out.push({
      klpRef: it.conflict.klpRef,
      conflictIndex: it.conflict.conflictIndex,
      sameConcept: v.sameConcept,
      prefer,
      strength: v.strength,
    })
  }
  return out
}
