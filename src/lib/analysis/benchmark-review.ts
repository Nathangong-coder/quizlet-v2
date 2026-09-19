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
export type ReviewOutcome = 'agree' | 'disagree' | 'strong'

export interface ReviewPoint {
  klpRef: number
  klpId: string
  stance: 'accept' | 'hold'
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
export function reviewOutcome(points: readonly { stance: 'accept' | 'hold'; firm: boolean }[]): ReviewOutcome {
  if (points.length === 0) return 'disagree'
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
export function foldReview(
  reply: PanelGradeReview,
  klpIds: readonly string[],
  isolated: readonly { klpRef: number; status: string }[],
): { points: ReviewPoint[]; outcome: ReviewOutcome; dropped: number } {
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
      after: p.stance === 'accept' ? p.verdict : (beforeOf.get(p.klpRef) ?? p.verdict),
      firm: p.firm,
      reason: p.reason,
    })
  }
  return { points, outcome: reviewOutcome(points), dropped }
}
