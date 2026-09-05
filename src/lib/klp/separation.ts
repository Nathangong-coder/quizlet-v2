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

/**
 * Per KLP, the FRACTION of wrong answers that fail it — the evidence half of
 * the weight formula (increment A §1).
 *
 * This is centrality measured by evidence rather than opinion, and it is free:
 * the verdict matrix it reads is computed for the discrimination test whether
 * or not anything uses it for weight. Before this it was computed and
 * discarded.
 *
 * A KLP all three adversaries fail is load-bearing — every way of being wrong
 * about this card runs through it. One that only the vague answer misses is
 * peripheral: you can be confidently wrong about the card and still get it
 * right, so getting it right says little.
 *
 * It exists BECAUSE blast radius does not work on every card shape. Blast
 * radius measures dependency depth: a derivation chain has depth, an
 * enumeration of parallel drivers does not, and on the latter the graph term is
 * flat no matter how good the relate call is. This term carries those cards.
 *
 * A missing verdict does NOT count as a failure, matching `evaluateKlps` —
 * `toOrderedVerdicts` has already filled every gap with an explicit `failed` by
 * the time the orchestrator gets here, so the only way to see `undefined` is a
 * caller that skipped that step, and inferring a failure from an absence there
 * would inflate the very signal this is supposed to measure honestly.
 *
 * No wrong answers means no evidence, so the term is 0 rather than 1: the
 * discrimination test did not run, and an untested KLP must not be handed the
 * maximum weight for it.
 */
export function discriminationBreadth(wrong: CandidateGrade[], klpCount: number): number[] {
  return Array.from({ length: klpCount }, (_, index) => {
    if (wrong.length === 0) return 0
    const fails = wrong.filter((w) => {
      const v = w.verdicts[index]
      return v !== undefined && VERDICT_CREDIT[v] === 0
    }).length
    return fails / wrong.length
  })
}
