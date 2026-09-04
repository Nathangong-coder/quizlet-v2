/**
 * The discrimination test, in TypeScript.
 *
 * THE AI NEVER COMPUTES THIS. It returns categorical verdicts; every number
 * here is derived from them, the same division of labour significance and
 * mastery already use. A model asked to score its own KLPs reports that they
 * are good, which is the exact failure this pipeline replaces.
 */
import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'
import { SEPARATION_FLOOR } from '@/lib/klp/authoring-config'
import type { ProbeKind } from '@/lib/klp/authoring-config'

export interface CandidateGrade {
  kind: 'reference' | ProbeKind
  /** One verdict per KLP, in the KLPs' own order. */
  verdicts: KlpVerdict[]
}

/** Mean credit across the KLPs. 0 for an empty set, never NaN. */
export function scoreCandidate(verdicts: KlpVerdict[]): number {
  if (verdicts.length === 0) return 0
  return verdicts.reduce((sum, v) => sum + VERDICT_CREDIT[v], 0) / verdicts.length
}

export interface KlpDiscrimination {
  index: number
  passesReference: boolean
  failsSomeWrong: boolean
  discriminates: boolean
}

/**
 * Per-KLP verdict on whether the point earns its place.
 *
 * Two conditions, and both are load-bearing:
 *  - It must PASS on the reference. A KLP the reference does not support was
 *    hallucinated past the artifact it was derived from.
 *  - It must FAIL on at least one wrong answer. One that fires identically
 *    across strong and weak carries no information.
 */
export function evaluateKlps(
  reference: CandidateGrade,
  wrong: CandidateGrade[],
): KlpDiscrimination[] {
  return reference.verdicts.map((refVerdict, index) => {
    const passesReference = VERDICT_CREDIT[refVerdict] > 0
    const failsSomeWrong = wrong.some((w) => {
      const v = w.verdicts[index]
      return v !== undefined && VERDICT_CREDIT[v] === 0
    })
    return {
      index,
      passesReference,
      failsSomeWrong,
      discriminates: passesReference && failsSomeWrong,
    }
  })
}

export interface SeparationResult {
  referenceScore: number
  bestWrongScore: number
  separation: number
  separated: boolean
  perKlp: KlpDiscrimination[]
}

/**
 * `separation = referenceScore - bestWrongScore`, against SEPARATION_FLOOR.
 *
 * The BEST wrong answer sets the bar, never the mean: averaging lets one
 * hopeless adversary mask a near-miss the KLPs genuinely fail to catch, and
 * the near-miss is the whole point of writing three of them.
 *
 * No wrong answers means the test did not run, which is a failure, not a pass.
 */
export function computeSeparation(
  reference: CandidateGrade,
  wrong: CandidateGrade[],
): SeparationResult {
  const referenceScore = scoreCandidate(reference.verdicts)
  const bestWrongScore = wrong.length === 0
    ? referenceScore
    : Math.max(...wrong.map((w) => scoreCandidate(w.verdicts)))
  const separation = referenceScore - bestWrongScore
  return {
    referenceScore,
    bestWrongScore,
    separation,
    separated: wrong.length > 0 && separation >= SEPARATION_FLOOR,
    perKlp: evaluateKlps(reference, wrong),
  }
}
