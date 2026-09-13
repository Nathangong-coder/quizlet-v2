/**
 * INCREMENTAL REGRADING (2026-09-13, owner: "reference should just be
 * adjusted every round based on the KLPs ... only the trap that trips up the
 * test should be re-called ... if both tests passed, both should not be
 * re-graded").
 *
 * Before this, every revision round re-graded every candidate against the
 * whole revised set: 4 calls a round, and with two rounds on a card the
 * grader was half the bill (docs/ai/model-performance.md, "What a card
 * costs"). Most of that was re-deriving verdicts the pipeline already had:
 * the revise prompt is told to leave a point with no finding alone, so most
 * points come back byte-identical, and a verdict on an identical point
 * against an unchanged answer is the same verdict.
 *
 * So a round now does three things, all decided here in TypeScript:
 *
 *  1. CARRY. For every kept candidate, a point whose text is unchanged keeps
 *     its verdict. Matching is by exact text — the one identity the revise
 *     contract guarantees — never by index, which a split or a cut shifts.
 *  2. PARTIAL. Points that are new or rewritten are graded in ONE call per
 *     kept candidate, with only those points in the prompt. A kept trap's
 *     stale verdict on a rewritten point is never reused and never filled
 *     with `failed`: both would be a verdict nobody gave.
 *  3. REPLACE. A trap that BEAT the last set — credited `correct` on a
 *     substance point, or the best wrong answer when separation did not clear
 *     the bar — is rewritten (a fresh answer of the same kind) and graded in
 *     full. A trap that failed every point is kept; rewriting it would only
 *     make a rising score ambiguous between a sharper set and a weaker trap.
 *
 * The reference is always kept (it is the artifact the points came from) and
 * is treated exactly like a kept trap: carry + partial.
 */
import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'
import type { PointRole } from '@/lib/klp/framing'
import type { ProbeKind } from '@/lib/klp/authoring-config'

export interface CarryResult {
  /** One slot per NEW point: the carried verdict, or undefined where a grade is needed. */
  verdicts: (KlpVerdict | undefined)[]
  /** Indices (into the new set) that need grading. */
  pending: number[]
}

/** Carry verdicts from the previous set onto the new one by exact text. */
export function carryVerdicts(
  previous: { text: string }[],
  previousVerdicts: KlpVerdict[],
  next: { text: string }[],
): CarryResult {
  const byText = new Map<string, KlpVerdict>()
  previous.forEach((k, i) => {
    const v = previousVerdicts[i]
    // First occurrence wins; a duplicated text in the old set is a hygiene
    // defect the validator reports separately.
    if (v !== undefined && !byText.has(k.text)) byText.set(k.text, v)
  })
  const verdicts = next.map((k) => byText.get(k.text))
  const pending = verdicts.map((v, i) => (v === undefined ? i : -1)).filter((i) => i >= 0)
  return { verdicts, pending }
}

/**
 * Which traps to rewrite before the next round. `roles` is the last round's
 * classification; a `framing` point the template recited does not count
 * against it (that is expected, see src/lib/klp/framing.ts).
 */
export function trapsToReplace(
  wrong: { kind: ProbeKind; verdicts: KlpVerdict[] }[],
  roles: PointRole[],
  clearedBar: boolean,
): ProbeKind[] {
  if (wrong.length === 0) return []
  const scores = wrong.map((w) => w.verdicts.reduce((a, v) => a + VERDICT_CREDIT[v], 0) / Math.max(1, w.verdicts.length))
  const best = scores.indexOf(Math.max(...scores))
  const out: ProbeKind[] = []
  wrong.forEach((w, i) => {
    const creditedOnSubstance = w.verdicts.some((v, j) => v === 'correct' && roles[j] !== 'framing')
    if (creditedOnSubstance || (!clearedBar && i === best)) out.push(w.kind)
  })
  return out
}

/** Fill a partial grade's verdicts (indexed by position in `pending`) back into the full slots. */
export function mergePartial(
  carried: (KlpVerdict | undefined)[],
  pending: number[],
  partial: { klpIndex: number; verdict: KlpVerdict }[],
): KlpVerdict[] {
  const byPos = new Map(partial.map((p) => [p.klpIndex, p.verdict]))
  return carried.map((v, i) => {
    if (v !== undefined) return v
    const pos = pending.indexOf(i)
    // A skipped index is the honest fallback the full grader also uses.
    return (pos >= 0 ? byPos.get(pos) : undefined) ?? 'failed'
  })
}
