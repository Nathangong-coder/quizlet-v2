import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'
import { computeSeparation, type CandidateGrade, type SeparationResult } from '@/lib/klp/separation'
import type { PointRole } from '@/lib/klp/framing'

/**
 * RELATIONS AS A DISCRIMINATION AXIS (2026-09-19, owner's ask).
 *
 * Until now the quality bar read key-point verdicts only; relations were
 * authored after the bar and never graded on a candidate. The spike that
 * motivated this (docs/ai/model-performance.md, "relations spike") graded the
 * stored reference and both traps on the LBO cards' relations: the VAGUE trap
 * omitted every link on every card, the TEMPLATE trap contradicted or omitted
 * most links on cards whose ceiling-bound POINTS it passed, and on one card
 * the REFERENCE itself failed all four of its relations — edges the relate
 * call had written that the reference never asserts. Mean separation: points
 * 0.52, relations 0.70. A link is what a recited answer lacks.
 *
 * Every rule here is TypeScript over categorical verdicts, as for points:
 *  - an edge the reference FAILS is pruned (it is definitional or fabricated —
 *    the same "must pass the reference" rule a point obeys);
 *  - `relationSeparation` is `computeSeparation` over the kept edges;
 *  - `combinedSeparation` is over substance points AND kept edges, one item
 *    each — the number the bar reads when a card has relations.
 */

export interface RelationGrade {
  kind: CandidateGrade['kind']
  /** One verdict per relation, in the card's relation order (indices into the ACCEPTED list). */
  verdicts: KlpVerdict[]
}

export interface RelationDiscrimination {
  index: number
  passesReference: boolean
  failsSomeWrong: boolean
  discriminates: boolean
}

export function evaluateRelations(reference: RelationGrade, wrong: RelationGrade[]): RelationDiscrimination[] {
  return reference.verdicts.map((refVerdict, index) => {
    const passesReference = VERDICT_CREDIT[refVerdict] > 0
    const failsSomeWrong = wrong.some((w) => {
      const v = w.verdicts[index]
      return v !== undefined && VERDICT_CREDIT[v] === 0
    })
    return { index, passesReference, failsSomeWrong, discriminates: passesReference && failsSomeWrong }
  })
}

export interface RelationPass {
  /** Indices (into the accepted list) of the edges the reference asserts — the ones kept. */
  kept: number[]
  /** Indices pruned because the reference does not assert them. */
  droppedForReference: number[]
  perRelation: RelationDiscrimination[]
  /** Over the kept edges only; `null` when nothing is kept. */
  relationSeparation: SeparationResult | null
}

/** Prune the edges the reference fails, then separate over what is left. */
export function relationPass(reference: RelationGrade, wrong: RelationGrade[]): RelationPass {
  const perRelation = evaluateRelations(reference, wrong)
  const kept = perRelation.filter((r) => r.passesReference).map((r) => r.index)
  const droppedForReference = perRelation.filter((r) => !r.passesReference).map((r) => r.index)
  if (kept.length === 0) return { kept, droppedForReference, perRelation, relationSeparation: null }
  const pick = (g: RelationGrade): CandidateGrade => ({ kind: g.kind, verdicts: kept.map((i) => g.verdicts[i]) })
  return { kept, droppedForReference, perRelation, relationSeparation: computeSeparation(pick(reference), wrong.map(pick)) }
}

/**
 * Points and links on one scale: the substance points (framing excluded, as
 * `substanceSeparation` does) concatenated with the kept relations, one item
 * each, separated with the same formula. A card with no kept relations reads
 * exactly as `substanceSeparation` would.
 */
export function combinedSeparation(
  points: { reference: CandidateGrade; wrong: CandidateGrade[]; roles: PointRole[] },
  relations: { reference: RelationGrade; wrong: RelationGrade[]; kept: number[] } | null,
): SeparationResult {
  const keepPoints = points.roles.map((r, i) => (r === 'substance' ? i : -1)).filter((i) => i >= 0)
  const pointIdx = keepPoints.length === 0 ? points.roles.map((_, i) => i) : keepPoints
  const keptRel = relations?.kept ?? []
  const build = (kind: CandidateGrade['kind'], pv: KlpVerdict[], rv: KlpVerdict[] | undefined): CandidateGrade => ({
    kind,
    verdicts: [...pointIdx.map((i) => pv[i]), ...keptRel.map((i) => (rv ?? [])[i] ?? 'failed')],
  })
  const reference = build(points.reference.kind, points.reference.verdicts, relations?.reference.verdicts)
  const wrong = points.wrong.map((w) => build(w.kind, w.verdicts, relations?.wrong.find((r) => r.kind === w.kind)?.verdicts))
  return computeSeparation(reference, wrong)
}
