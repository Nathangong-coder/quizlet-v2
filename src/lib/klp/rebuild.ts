/**
 * Scores for the rebuild test, computed in TypeScript from categorical
 * verdicts. Design: docs/superpowers/specs/2026-09-12-rebuild-test-design.md.
 *
 * `cardCoverage` is the number that matters — the share of the CARD's own
 * points an answer built from the key points alone establishes. It replaces
 * `referenceScore`, which graded the key points against the answer they were
 * extracted from and could not fail on a missing concept.
 *
 * `referenceParity` is what the rebuild kept of the writer's reference;
 * `extractionLoss = 1 − parity` is what the key points dropped.
 *
 * Empty inputs produce null, never NaN — a card whose definition split into
 * zero points has no coverage, not a coverage of zero.
 */
import type { CoverageVerdict, ParityVerdict } from '@/lib/ai/prompts/rebuild'

export const COVERAGE_CREDIT: Record<CoverageVerdict, number> = { correct: 1, partial: 0.5, missing: 0 }
export const PARITY_CREDIT: Record<ParityVerdict, number> = { present: 1, partial: 0.5, absent: 0 }

/**
 * The coverage a set should clear. Below it the card is reported (and, once
 * the bar is wired into the revise loop, revised with the missing points
 * named). 0.8 is a first guess: four of five owner points established.
 */
export const REBUILD_COVERAGE_BAR = 0.8

/**
 * The parity a set should keep of the writer's reference (2026-09-13, owner:
 * "a bar should be set at 0.7, and model 1 re-prompted if it fails"). Below
 * it, every claim the rebuild lost is named to the combined revise call.
 */
export const REBUILD_PARITY_BAR = 0.7

export interface RebuildDispute {
  index: number
  cardSays: string
  answerSays: string
  reason: string
}

export interface RebuildScores {
  cardCoverage: number | null
  referenceParity: number | null
  extractionLoss: number | null
  /** Definition points the rebuild left `missing`, by index — named to the revise call. */
  missingPoints: number[]
  clearsBar: boolean | null
  /** `referenceParity >= REBUILD_PARITY_BAR`; null when parity is null. */
  clearsParityBar: boolean | null
}

export function rebuildScores(input: {
  /** One verdict per definition point, by index; a point with no verdict counts as missing. */
  coverage: { index: number; verdict: CoverageVerdict }[]
  definitionPointCount: number
  parity: { verdict: ParityVerdict }[]
}): RebuildScores {
  let cardCoverage: number | null = null
  const missingPoints: number[] = []
  if (input.definitionPointCount > 0) {
    let sum = 0
    for (let i = 0; i < input.definitionPointCount; i++) {
      const v = input.coverage.find((c) => c.index === i)?.verdict ?? 'missing'
      sum += COVERAGE_CREDIT[v]
      if (v === 'missing') missingPoints.push(i)
    }
    cardCoverage = sum / input.definitionPointCount
  }
  let referenceParity: number | null = null
  if (input.parity.length > 0) {
    referenceParity = input.parity.reduce((a, c) => a + PARITY_CREDIT[c.verdict], 0) / input.parity.length
  }
  return {
    cardCoverage,
    referenceParity,
    extractionLoss: referenceParity === null ? null : 1 - referenceParity,
    missingPoints,
    clearsBar: cardCoverage === null ? null : cardCoverage >= REBUILD_COVERAGE_BAR,
    clearsParityBar: referenceParity === null ? null : referenceParity >= REBUILD_PARITY_BAR,
  }
}

/**
 * The rebuild test's contribution to the combined revise call (2026-09-13).
 * Whole-set findings (index null): a parity miss names every claim the
 * rebuild lost; a coverage miss names every card point left `missing`. Both
 * ask the revise call to ADD, which is why the fix says the count may rise —
 * the revise prompt otherwise treats the target as a ceiling to respect.
 */
export function rebuildFindings(input: {
  scores: RebuildScores
  parity: { claim: string; verdict: ParityVerdict }[]
  definitionPoints: string[]
}): { index: null; issue: string; fix: string }[] {
  const out: { index: null; issue: string; fix: string }[] = []
  const { scores } = input
  if (scores.clearsParityBar === false && scores.referenceParity !== null) {
    out.push({
      index: null,
      issue: `parity ${scores.referenceParity.toFixed(2)} is below the ${REBUILD_PARITY_BAR.toFixed(2)} bar — an answer rebuilt from the key points alone lost claims the reference makes`,
      fix: 'each lost claim is listed below; add a key point that states it, or fold it into the point it belongs to — the count may exceed the target for this',
    })
    for (const c of input.parity) {
      if (c.verdict === 'present') continue
      out.push({
        index: null,
        issue: `reference claim ${c.verdict === 'absent' ? 'not carried' : 'only gestured at'} by the key points: "${c.claim}"`,
        fix: 'state this claim as its own key point, or make the point it belongs to carry it explicitly',
      })
    }
  }
  if (scores.clearsBar === false) {
    for (const i of scores.missingPoints) {
      const point = input.definitionPoints[i]
      if (!point) continue
      out.push({
        index: null,
        issue: `card point not covered by the key points: "${point}"`,
        fix: "this is the owner's own content; add a key point that establishes it — the count may exceed the target for this",
      })
    }
  }
  return out
}
