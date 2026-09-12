/**
 * The adjudicator call for dual-model topic minting: what it is shown, what it
 * may answer, and how its answer maps back onto the reconciler's sides.
 *
 * Three item types, each a CLOSED question. The judge is never asked "are
 * both wrong" and never picks a name - when two names are the same concept
 * the rule (shorter) decides.
 *
 *   name   - same concept? if not, which is more accurate, AND would the other
 *            be accepted by a careful expert too? The first run showed the
 *            judge calling 18 of 19 preferences "clear", which made the
 *            weighting inert. "Acceptable" is a harder bar than "clear": DeepSeek
 *            wins only when the judge says Gemini's mapping would be rejected
 *            outright, and the prompt tells it most pairs are both defensible.
 *   edges  - which of side A's edges, if any, are the same link as each of side
 *            B's? Alignment only - B's replaces A's same link, everything else
 *            on both sides is kept.
 *   extra  - is an A-only context a distinct additional concept for the point,
 *            or a restatement of the point / its leaf / its edges?
 *
 * The side shown as "A"/"B" is randomised per item HERE, with the seed
 * recorded, so the judge cannot learn that one slot is usually one model. The
 * weighting toward Gemini is applied by `applyVerdicts`, not by the judge.
 */
import { z } from 'zod'
import type { Conflict, EdgeDraft, Verdict } from './topic-reconcile'

export const JudgeVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      item: z.number().int(),
      /** name items */
      sameConcept: z.boolean().optional(),
      prefer: z.enum(['A', 'B']).optional(),
      otherAcceptable: z.boolean().optional(),
      /** edge items: pairs of (A index, B index) that are the same link */
      sameLinks: z.array(z.object({ a: z.number().int(), b: z.number().int() })).optional(),
      /** extra items */
      distinct: z.boolean().optional(),
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

function coin(seed: number, i: number): boolean {
  let x = (seed ^ (i * 0x9e3779b9)) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return ((x >>> 0) & 1) === 1
}

export function buildJudgeItems(conflicts: Conflict[], klpTexts: string[], seed: number): JudgeItem[] {
  return conflicts.map((conflict, index) => ({
    index,
    conflict,
    aIs: coin(seed, index) ? 'a' : 'b',
    klpText: klpTexts[conflict.klpRef] ?? '',
  }))
}

function fmtEdge(e: EdgeDraft): string {
  return `${e.from} --${e.type}--> ${e.to}`
}

export function buildJudgePrompt(items: JudgeItem[]): string {
  const lines = items.map((it) => {
    const c = it.conflict
    const head = `ITEM ${it.index} [${c.kind === 'name_conflict' ? 'name' : c.kind === 'edge_align' ? 'edges' : 'extra'}]\n  key point (${c.klpKind}): ${it.klpText}`
    if (c.kind === 'name_conflict') {
      const A = it.aIs === 'a' ? c.aName : c.bName
      const B = it.aIs === 'a' ? c.bName : c.aName
      return `${head}\n  A: leaf "${A}"\n  B: leaf "${B}"`
    }
    if (c.kind === 'edge_align') {
      const A = it.aIs === 'a' ? c.aEdges! : c.bEdges!
      const B = it.aIs === 'a' ? c.bEdges! : c.aEdges!
      return `${head}\n  A edges: ${A.map((e, i) => `[A${i}] ${fmtEdge(e)}`).join(' ; ')}\n  B edges: ${B.map((e, i) => `[B${i}] ${fmtEdge(e)}`).join(' ; ')}`
    }
    return `${head}\n  candidate context: "${c.concept}"\n  already recorded for this point: ${(c.distinctFrom ?? []).map((d) => `"${d}"`).join(', ') || '(nothing)'}`
  })
  return `Two annotators mapped the key learning points of a finance flashcard onto a topic
map. A LEAF is the topic node a point belongs to; a RELATION is an edge between two nodes;
a CONTEXT is a second, process-level concept the point also touches.

Answer each item with closed fields only. Do not explain.

[name] items:
  sameConcept — are A and B naming the SAME concept, merely worded differently?
     ("accounting equation" / "fundamental accounting equation" -> true;
      "depreciation" / "non-cash expense add-backs" -> false)
  If not the same concept: prefer — which is the more accurate node for THIS point, A or B?
  otherAcceptable — would a careful expert ALSO accept the other one as a correct node for
     this point? Answer true unless the other is outright wrong. MOST PAIRS ARE BOTH
     DEFENSIBLE; reserve false for a mapping that misreads the point, names the wrong
     thing, or uses a whole financial statement where a specific concept was meant.

[edges] items:
  sameLinks — list every pair {a, b} where edge [Aa] and edge [Bb] express the SAME link
     between the same two things (wording may differ; the edge type may differ). An edge
     with no counterpart is simply left out. Two different links are NOT a pair.

[extra] items:
  distinct — is the candidate context a genuinely ADDITIONAL concept for this point,
     rather than a restatement of the point itself or of something already recorded?
     true = keep it as an extra; false = it repeats what is already there.

${lines.join('\n\n')}`
}

/** Maps A/B answers back to reconciler sides a/b. */
export function toVerdicts(items: JudgeItem[], parsed: z.infer<typeof JudgeVerdictSchema>): Verdict[] {
  const out: Verdict[] = []
  for (const v of parsed.verdicts) {
    const it = items.find((x) => x.index === v.item)
    if (!it) continue
    const c = it.conflict
    const base = { klpRef: c.klpRef, conflictIndex: c.conflictIndex }
    if (c.kind === 'name_conflict') {
      let prefer: 'a' | 'b' | undefined
      if (v.prefer) prefer = v.prefer === 'A' ? it.aIs : it.aIs === 'a' ? 'b' : 'a'
      out.push({ ...base, sameConcept: v.sameConcept ?? false, prefer, otherAcceptable: v.otherAcceptable })
    } else if (c.kind === 'edge_align') {
      // The judge's {a, b} index the SHOWN A/B lists; map back to reconciler sides.
      const sameLinks = (v.sameLinks ?? []).map((p) => (it.aIs === 'a' ? { a: p.a, b: p.b } : { a: p.b, b: p.a }))
      out.push({ ...base, sameLinks })
    } else {
      out.push({ ...base, distinct: v.distinct ?? true })
    }
  }
  return out
}
