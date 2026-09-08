/**
 * The discrimination SMOKE TEST — deliberately crude, and that is the design.
 *
 * ## Why discrimination got demoted
 *
 * The pipeline spent most of its effort treating discrimination as the measure
 * of key-point quality. Two measurements argue it cannot be:
 *
 * 1. **It is saturated.** AUC is 1.000 on 129 of 130 authoring runs — the
 *    reference outranks every adversary, every time. Adding a near-miss level
 *    (the competence panel) made the number informative again, and then
 *    **96% of real key points came back healthy**.
 * 2. **The failures it does surface are not key-point defects.** Every
 *    confirmed coverage hole C1 found was a *contamination* — an answer
 *    satisfying every point while asserting something false. A key-point set is
 *    a conjunction of POSITIVE requirements and structurally cannot forbid a
 *    falsehood; no point can be added to fix it. That belongs to the grading
 *    engine, and it is where the negative check went.
 *
 * The conclusion those two support: **a key point's job is to be true, atomic,
 * independent and complete.** Deciding how wrong an answer is, in what way, and
 * what to do about it, is a different system — error taxonomy, misconception
 * library, adaptive follow-ups. Discrimination is a check ON the key points,
 * not the instrument that grades wrongness.
 *
 * ## So this measures ONE thing: is the set so loose that a bad answer passes?
 *
 * It reads only the WEAK end of the evidence, plus one sanity check at the top.
 * It does not try to rank a competent answer against a partial one, because
 * that is the judgment the evidence says a proposition list does not make well.
 *
 * ## It works with or without the competence panel
 *
 * The panel is the better instrument and is off by default. This takes whatever
 * weak candidates exist — the panel's L1/L0, or the legacy `confident_wrong` /
 * `vague` / `memorized_template` adversaries — so a smoke test exists on every
 * card in the corpus rather than only on re-authored ones. A check that only
 * runs on the newest cards cannot tell you about the corpus.
 */

export const SMOKE_FAILURES = [
  'accepts_off_target',
  'accepts_weak',
  'rejects_reference',
  'inverted',
] as const

export type SmokeFailure = (typeof SMOKE_FAILURES)[number]

/**
 * How much credit a WEAK answer may take before the set is suspect.
 *
 * 0.5 is deliberately permissive. A weak answer legitimately earns some points
 * — a vague answer to a seven-point card usually gestures at two of them — and
 * a smoke test that fires on that is a smoke test nobody reads. Half the set is
 * the level at which "this answer is being credited for knowing the card" stops
 * being defensible.
 *
 * NOT tuned against the corpus yet, and it should be once the panel runs
 * widely. It is a gross-failure threshold, not a quality bar; the difference
 * matters, because the whole point of this module is that it is not trying to
 * grade quality.
 */
export const SMOKE_WEAK_CEILING = 0.5

/**
 * How little credit the REFERENCE may take before something is wrong with the
 * points rather than with any answer.
 *
 * A set the strong answer cannot satisfy was not derived from the card it
 * claims to describe. This is a FIDELITY alarm surfacing through a
 * discrimination check, which is why it is here rather than in a quality score.
 */
export const SMOKE_REFERENCE_FLOOR = 0.6

export interface SmokeInput {
  /** Mean credit the strong/reference answer earned, 0-1. */
  referenceScore: number
  /**
   * Mean credit each WEAK candidate earned. The panel's L1 and L0, or the
   * legacy three adversaries — whichever the run produced.
   */
  weakScores: number[]
  /**
   * The off-target candidate specifically, when one exists (the panel's L0).
   * Absent on legacy runs, where no adversary is defined as off-topic.
   */
  offTargetScore?: number
}

export interface SmokeResult {
  passed: boolean
  failures: { code: SmokeFailure; detail: string }[]
  /** The worst weak score — what the check actually turns on. */
  worstWeak: number | null
}

/**
 * Runs the smoke test. Pure, and cheap enough to run on every card on every
 * authoring pass.
 *
 * `max` over the weak candidates, never a mean: one hopeless adversary must not
 * mask the near-miss that a mean would average away. Same reasoning as
 * `bestWrongScore`, kept because it is the one part of the old design the
 * measurements did not undermine.
 */
export function smokeTest(input: SmokeInput): SmokeResult {
  const failures: SmokeResult['failures'] = []
  const worstWeak = input.weakScores.length === 0 ? null : Math.max(...input.weakScores)

  // WORST CASE, and its own code: an answer to a different question should earn
  // nothing. Anything above zero means the points are matching surface
  // vocabulary rather than content, which makes every number they produce noise
  // rather than merely generous.
  if (input.offTargetScore !== undefined && input.offTargetScore > 0) {
    failures.push({
      code: 'accepts_off_target',
      detail:
        `an off-target answer earned ${input.offTargetScore.toFixed(2)} — the points are matching ` +
        `surface keywords, not content`,
    })
  }

  if (worstWeak !== null && worstWeak > SMOKE_WEAK_CEILING) {
    failures.push({
      code: 'accepts_weak',
      detail:
        `a weak answer earned ${worstWeak.toFixed(2)} of the set (ceiling ${SMOKE_WEAK_CEILING}) — ` +
        `the points are loose enough that not knowing the card still scores`,
    })
  }

  if (input.referenceScore < SMOKE_REFERENCE_FLOOR) {
    failures.push({
      code: 'rejects_reference',
      detail:
        `the strong answer earned only ${input.referenceScore.toFixed(2)} (floor ` +
        `${SMOKE_REFERENCE_FLOOR}) — a FIDELITY alarm: points the reference cannot satisfy were ` +
        `probably not derived from this card`,
    })
  }

  // Reported separately from `accepts_weak` because the fix differs: a weak
  // answer OUTSCORING the strong one is not looseness, it is a broken or
  // unstable grading of this set.
  if (worstWeak !== null && worstWeak > input.referenceScore) {
    failures.push({
      code: 'inverted',
      detail:
        `a weak answer (${worstWeak.toFixed(2)}) outscored the strong one ` +
        `(${input.referenceScore.toFixed(2)}) — re-grade before rewording anything`,
    })
  }

  // NO CANDIDATES MEANS THE TEST DID NOT RUN, which is not a pass. Same posture
  // `computeSeparation` takes toward an empty adversary list.
  if (worstWeak === null) {
    failures.push({
      code: 'accepts_weak',
      detail: 'no weak candidate was graded, so nothing was tested — this is not a pass',
    })
  }

  return { passed: failures.length === 0, failures, worstWeak }
}

/** One line per card, for a corpus sweep. */
export function formatSmokeResult(result: SmokeResult): string {
  if (result.passed) return 'SMOKE OK'
  return `SMOKE FAIL — ${result.failures.map((f) => f.code).join(', ')}`
}
