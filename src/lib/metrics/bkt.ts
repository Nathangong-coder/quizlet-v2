import { DEFAULT_STRENGTH, EVIDENCE_STRENGTH, STATUS_CREDIT, type KlpStatus } from '@/lib/errors/klp-credit'
import type { StudySource } from '@/lib/memory/scoring'

/** P(knew it before any evidence). */
export const BKT_PRIOR = 0.25
/** P(learns it on this opportunity, given they did not know it). */
export const BKT_LEARN = 0.1
/** P(gets it wrong despite knowing it). */
export const BKT_SLIP = 0.1
/** Below this, no caller may describe a KLP as weak or strong. */
export const MIN_OBSERVATIONS = 3

/**
 * P(gets it right without knowing it).
 *
 * DERIVED from `EVIDENCE_STRENGTH`, which documents itself as `1 - guessRate`.
 * Writing 0.25 / 0.5 / 0.05 here a second time is the persisted-value-in-two-
 * places drift class Spec 2a keeps flagging; a test pins the equality so a
 * change to either side is a build failure.
 */
export function guessRate(mode: StudySource): number {
  const strength = EVIDENCE_STRENGTH[mode]
  return strength === undefined ? 1 - DEFAULT_STRENGTH : 1 - strength
}

export interface KlpObservation {
  status: KlpStatus
  mode: StudySource
  createdAt: Date
}

export interface BktResult {
  pKnown: number
  observations: number
}

/**
 * One BKT update.
 *
 * Reads `status` and `mode` UNMULTIPLIED and never the stored `credit` float.
 * `credit` is `STATUS_CREDIT x EVIDENCE_STRENGTH` — two quantities belonging in
 * two different positions here: `STATUS_CREDIT` in the mixing weight,
 * `EVIDENCE_STRENGTH` inside the likelihood via `guess`. Feeding the product as
 * the mixing weight applies the mode discount twice and creates a fixed point
 * strictly below 1 whose value depends on `BKT_LEARN`, `BKT_SLIP`, and the
 * mode's evidence strength — approximately 0.82 for multiple choice, 0.40 for
 * true/false, with no binding ceiling for short answer at current constants.
 * The figure moves if these constants are retuned.
 */
export function stepBkt(pKnown: number, obs: KlpObservation): number {
  const guess = guessRate(obs.mode)
  const slip = BKT_SLIP

  const correctNum = pKnown * (1 - slip)
  const correctDen = correctNum + (1 - pKnown) * guess
  const pIfCorrect = correctDen === 0 ? pKnown : correctNum / correctDen

  const wrongNum = pKnown * slip
  const wrongDen = wrongNum + (1 - pKnown) * (1 - guess)
  const pIfWrong = wrongDen === 0 ? pKnown : wrongNum / wrongDen

  // The CATEGORICAL fraction only — mode never enters the mixing weight.
  const c = STATUS_CREDIT[obs.status]
  const posterior = c * pIfCorrect + (1 - c) * pIfWrong

  // Learning opportunity.
  return posterior + (1 - posterior) * BKT_LEARN
}

/**
 * Replay a KLP's observations chronologically. Input may be unsorted; the
 * result must not depend on the order rows came back from the database.
 */
export function traceKlp(observations: KlpObservation[]): BktResult {
  const chronological = [...observations].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let pKnown = BKT_PRIOR
  for (const obs of chronological) pKnown = stepBkt(pKnown, obs)

  return { pKnown, observations: chronological.length }
}
