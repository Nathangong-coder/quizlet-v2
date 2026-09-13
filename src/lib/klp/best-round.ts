/**
 * THE GRADERS' VETO (2026-09-13, owner: "the parity grader should be able to
 * object somehow, same with the separation grader").
 *
 * The revise loop used to keep whatever the LAST round produced. A round can
 * make a set worse — a compression edit that drops a claim, a split that
 * hands the template a new pass — and the graders then see it only after
 * the fact, with no round left. Two mechanisms, both computed here:
 *
 *  1. PRE-EMPTIVE: when a round carries compression findings, the parity
 *     grader's own decomposition of the reference (every claim it listed,
 *     present or not) goes to the revise call as claims that must survive.
 *     The grader objects BEFORE the cut, in the language it already speaks.
 *  2. AFTER THE FACT: the outcome is the BEST round, not the last. A round
 *     qualifies when it clears every bar it was measured against
 *     (substance separation floor, parity bar, coverage bar); among
 *     qualifying rounds the highest substance separation wins, then parity.
 *     With none qualifying, the fewest bars missed, then substance. A round
 *     that lowered a number the graders own is thereby vetoed by them.
 *
 * Pure. The orchestrator snapshots each round and asks which to keep.
 */
import { SEPARATION_FLOOR } from '@/lib/klp/authoring-config'

export interface RoundSummary {
  round: number
  substanceSeparation: number
  /** True when the discrimination test passed (panel or substance floor). */
  separated: boolean
  /** Null when no rebuild test ran that round. */
  referenceParity: number | null
  clearsParityBar: boolean | null
  clearsCoverageBar: boolean | null
  /** The compression signals, as tie-breakers only: a round equal on every bar and score keeps the tighter set. */
  rebuiltTight?: boolean
  wordRatio?: number | null
}

export function barsMissed(r: RoundSummary): number {
  let n = 0
  if (!r.separated) n += 1
  if (r.clearsParityBar === false) n += 1
  if (r.clearsCoverageBar === false) n += 1
  return n
}

/** Index into `rounds` of the round to keep. */
export function pickBestRound(rounds: RoundSummary[]): number {
  if (rounds.length === 0) return -1
  let best = 0
  for (let i = 1; i < rounds.length; i++) {
    const a = rounds[best]
    const b = rounds[i]
    const ma = barsMissed(a)
    const mb = barsMissed(b)
    if (mb < ma) { best = i; continue }
    if (mb > ma) continue
    if (b.substanceSeparation > a.substanceSeparation + 1e-9) { best = i; continue }
    if (b.substanceSeparation < a.substanceSeparation - 1e-9) continue
    if ((b.referenceParity ?? -1) > (a.referenceParity ?? -1)) { best = i; continue }
    if ((b.referenceParity ?? -1) < (a.referenceParity ?? -1)) continue
    // Equal on every bar and score: the compression signals decide — a
    // tighter rebuilt answer, then a lower word ratio — and only then the
    // EARLIER round, since later rounds cost calls and bought nothing.
    if ((b.rebuiltTight ? 1 : 0) > (a.rebuiltTight ? 1 : 0)) { best = i; continue }
    if ((b.rebuiltTight ? 1 : 0) < (a.rebuiltTight ? 1 : 0)) continue
    if (b.wordRatio != null && a.wordRatio != null && b.wordRatio < a.wordRatio - 1e-9) best = i
  }
  return best
}

/** One line for the run log saying what the veto did. */
export function describeChoice(rounds: RoundSummary[], kept: number): string {
  if (rounds.length <= 1 || kept === rounds.length - 1) return ''
  const last = rounds[rounds.length - 1]
  const k = rounds[kept]
  return `kept round ${kept} over the last (${rounds.length - 1}): substance ${k.substanceSeparation.toFixed(2)} vs ${last.substanceSeparation.toFixed(2)}, parity ${k.referenceParity?.toFixed(2) ?? 'n/a'} vs ${last.referenceParity?.toFixed(2) ?? 'n/a'}, bars missed ${barsMissed(k)} vs ${barsMissed(last)}`
}

export { SEPARATION_FLOOR }
