import type { PanelGradeReview } from '@/lib/ai/schemas'
import { bandOf, bandHit, isBandsKind, type GraderPanelKind } from '@/lib/analysis/benchmark'

/**
 * THE RECONCILIATION PASS — the pure half (2026-09-18, owner's ask).
 *
 * Which answers are disputed, what the dispute is in words, and what the
 * grader's per-point stances add up to. The AI half (building the prompt,
 * calling the model, persisting the row) lives in `benchmark-run.ts`; this
 * module never touches Prisma or a provider so every rule here is testable.
 */
/**
 * `klp_defect` (2026-09-19, owner's ask): the reconciliation names the KEY
 * POINT, not the grader or the adversary, as the problem — a competent
 * answer written to this band fails it because it is ambiguous, compound,
 * or asks for more than the question does. It routes to the authoring loop
 * (a `--findings` file for `author-klps`) and, where the card itself lacks
 * what the point needs, to the owner — the panel is then a test of the key
 * points as well as of the grader.
 */
export type ReviewOutcome = 'agree' | 'disagree' | 'strong' | 'klp_defect' | 'card_gap'

export interface ReviewPoint {
  klpRef: number
  klpId: string
  stance: 'accept' | 'hold' | 'klp_defect'
  before: string
  after: string
  firm: boolean
  reason: string
}

/**
 * `agree`: every disputed point accepted. `strong`: at least one point HELD
 * FIRMLY — the grader would defend it to a third reader, so a human decides.
 * `disagree`: held something, but not firmly — recorded, not queued.
 * An empty review (the model named no points) is `disagree`: it neither
 * accepted nor defended, and that is worth a look, not a pass.
 */
export function reviewOutcome(points: readonly { stance: 'accept' | 'hold' | 'klp_defect'; firm: boolean }[]): ReviewOutcome {
  if (points.length === 0) return 'disagree'
  // A named point defect outranks the grader-vs-adversary reading: the card is
  // what gets fixed, and a grader dispute on a defective point is moot.
  if (points.some((p) => p.stance === 'klp_defect')) return 'klp_defect'
  if (points.every((p) => p.stance === 'accept')) return 'agree'
  if (points.some((p) => p.stance === 'hold' && p.firm)) return 'strong'
  return 'disagree'
}

export interface DisputeInput {
  kind: GraderPanelKind
  /** The adversary's label — a level or a band id. */
  level: string | null
  intendedRank: number
  score: number
  /** Every answer on the card, to find rank inversions. */
  siblings: { intendedRank: number; score: number }[]
}

/**
 * Whether an answer's isolated grade disagrees with the adversary's intent,
 * and the disagreement in plain words for the review prompt. A bands panel
 * disputes on a BAND MISS; a levels panel on a RANK INVERSION (this answer
 * scored no higher than one the adversary ranked below it, or no lower than
 * one ranked above). `null` = no dispute, no review call.
 */
export function describeDispute(input: DisputeInput): string | null {
  const pct = Math.round(input.score * 100)
  if (isBandsKind(input.kind) && input.level) {
    const b = bandOf(input.level)
    if (!b) return null
    if (bandHit(input.level, input.score)) return null
    return `You scored this answer ${pct}/100 on content; the second reader aimed it at "${input.level}" (${b.low === b.high ? b.low : `${b.low}-${b.high}`}).`
  }
  const below = input.siblings.filter((s) => s.intendedRank > input.intendedRank && s.score >= input.score)
  const above = input.siblings.filter((s) => s.intendedRank < input.intendedRank && s.score <= input.score)
  if (below.length === 0 && above.length === 0) return null
  const parts: string[] = []
  if (below.length) parts.push(`an answer the second reader ranked BELOW it scored ${below.map((s) => Math.round(s.score * 100)).join('/')}`)
  if (above.length) parts.push(`an answer ranked ABOVE it scored ${above.map((s) => Math.round(s.score * 100)).join('/')}`)
  return `You scored this "${input.level ?? 'rank ' + input.intendedRank}" answer ${pct}/100 on content, but ${parts.join(' and ')}.`
}

/** Fold the model's reply into persisted points, resolving refs to ids and carrying the isolated verdict as `before`. */
/**
 * `card_gap` (2026-09-19, the question-only blind panel's finding): the
 * adversary's answer carries what a strong candidate says and no key point
 * covers it. The grader's verdicts on the existing points are RIGHT and the
 * disagreement is not about them; the card is thin. Outranks `strong` — a
 * firm hold on a thin card is not a grader question — but not `klp_defect`.
 */
export function foldReview(
  reply: PanelGradeReview,
  klpIds: readonly string[],
  isolated: readonly { klpRef: number; status: string }[],
): { points: ReviewPoint[]; outcome: ReviewOutcome; dropped: number; cardGaps: string[] } {
  const beforeOf = new Map(isolated.map((v) => [v.klpRef, v.status]))
  const points: ReviewPoint[] = []
  let dropped = 0
  for (const p of reply.points) {
    const klpId = klpIds[p.klpRef]
    if (!klpId) { dropped++; continue }
    points.push({
      klpRef: p.klpRef,
      klpId,
      stance: p.stance,
      before: beforeOf.get(p.klpRef) ?? 'unjudged',
      // A defect leaves the isolated verdict standing: the point, not the grade, changes.
      after: p.stance === 'accept' ? p.verdict : (beforeOf.get(p.klpRef) ?? p.verdict),
      firm: p.firm,
      reason: p.reason,
    })
  }
  const cardGaps = (reply.cardGaps ?? []).map((g) => g.trim()).filter(Boolean)
  const base = reviewOutcome(points)
  const outcome: ReviewOutcome = base === 'klp_defect' ? base : cardGaps.length ? 'card_gap' : base
  return { points, outcome, dropped, cardGaps }
}
