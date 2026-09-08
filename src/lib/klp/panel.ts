/**
 * The synthetic competence panel — build item 4 of the quality-pipeline spec.
 *
 * Replaces the three failure-kind adversaries (`confident_wrong`, `vague`,
 * `memorized_template`) with five answers ordered by LEVEL OF COMPETENCE, and
 * replaces a single gap number with a curve.
 *
 * ## Why, measured — and one reason from the spec that does NOT hold
 *
 * **The real argument is saturation.** Across 130 authoring runs the
 * rank-based AUC is 1.000 on 129 of them: the reference answer outscores every
 * adversary, every time, on every model. `bestWrongScore` takes a `max`
 * specifically so a NEAR-MISS sets the bar — and nothing is nearly passing, so
 * the max is doing no work. A test that never fails at the top cannot tell a
 * sharp key-point set from a merely adequate one; it only catches sets so loose
 * that an obviously bad answer passes. **L3 is the near-miss that does not
 * currently exist**, and adding it is what makes the number informative again.
 *
 * **Monotonicity is the second reason and it is free.** Five ordered levels
 * should score in order. An inversion — a partial answer outscoring a competent
 * one — is a defect the single-gap test cannot even express, because it has
 * only two points to compare.
 *
 * **THE SPEC'S THIRD REASON IS FALSE ABOUT THE SHIPPED CODE, and it was billed
 * as the strongest.** It says adversaries are "regenerated every revision", so
 * a rising separation score cannot distinguish a better item from weaker
 * adversaries. Checked in `authoring.ts`: the revision loop grades
 * `draft.wrongAnswers`, written ONCE by the author call, against each revised
 * key-point set. The adversaries are already fixed within a run. The panel is
 * still worth building for the two reasons above; it is not worth building for
 * that one, and a design doc that keeps claiming it will send someone looking
 * for a bug that is not there.
 *
 * A panel fixed ACROSS runs — a true regression suite, so two separate
 * authoring passes are comparable — would need the panel persisted against the
 * card rather than the version. That is a schema change and is not in this
 * increment.
 */
import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'
import { scoreCandidate } from '@/lib/klp/separation'

/**
 * Five levels, ordered strongest to weakest.
 *
 * By COMPETENCE, not by kind of failure. The old archetypes named three ways of
 * being wrong and left the space between "right" and "wrong" empty, which is
 * precisely where a key-point set earns or loses its value.
 */
export const PANEL_LEVELS = ['L4', 'L3', 'L2', 'L1', 'L0'] as const

export type PanelLevel = (typeof PANEL_LEVELS)[number]

export const PANEL_LEVEL_LABELS: Record<PanelLevel, string> = {
  L4: 'expert — complete, precise, correctly framed',
  L3: 'competent — a good answer with a real gap or imprecision',
  L2: 'partial — the shape of an answer, missing substance',
  L1: 'confused — engages the topic and gets it wrong',
  L0: 'off-target — answers a different question, or says nothing',
}

/**
 * The levels a well-built key-point set should CREDIT.
 *
 * L3 is here deliberately, and it is the whole point of the change: a competent
 * answer with a real gap should still pass most points. A set that only accepts
 * the perfect answer is too strict, and nothing in the old four-candidate test
 * could see that — there was no candidate between the reference and a
 * deliberately bad one.
 */
export const PASSING_LEVELS: readonly PanelLevel[] = ['L4', 'L3']

/** The levels it should NOT credit. */
export const FAILING_LEVELS: readonly PanelLevel[] = ['L2', 'L1', 'L0']

/**
 * The floor for panel separation.
 *
 * DELIBERATELY ITS OWN CONSTANT, and NOT comparable to `SEPARATION_FLOOR`. The
 * old number is `referenceScore - max(weak)`; this one is
 * `min(passing) - max(failing)`, which is a strictly harder quantity — it takes
 * the WEAKEST answer that should pass and the STRONGEST that should not. Reusing
 * the old floor would silently retune the pipeline while looking like a
 * refactor, and the corpus's stored separation scores would stop meaning what
 * they meant.
 *
 * Lower than `SEPARATION_FLOOR` because the quantity is harder. Tune it against
 * the corpus once panels exist, the way the severity bands were tuned; there is
 * no measurement behind this value yet and it is a starting point.
 */
export const PANEL_SEPARATION_FLOOR = 0.25

export interface PanelMember {
  level: PanelLevel
  text: string
}

export interface GradedPanelMember {
  level: PanelLevel
  /** One verdict per key point, in key-point order. */
  verdicts: KlpVerdict[]
}

/** Does this key point count as SUPPORTED by this answer? */
function fires(verdict: KlpVerdict | undefined): boolean {
  return verdict !== undefined && VERDICT_CREDIT[verdict] > 0
}

export interface PanelCurve {
  /** Mean credit per level, strongest first. Missing levels are omitted. */
  scores: { level: PanelLevel; score: number }[]
  /** `min(passing) - max(failing)`. */
  separation: number
  separated: boolean
  /** Every adjacent pair where a weaker level outscored a stronger one. */
  inversions: { stronger: PanelLevel; weaker: PanelLevel; by: number }[]
  monotonic: boolean
}

/**
 * The curve, in TypeScript. The AI never computes any number here — it returns
 * categorical verdicts, exactly as `separation.ts` documents.
 *
 * `min` over the passing levels mirrors why `max` is used over the failing
 * ones: the hardest available comparison. `max` over failing catches a set that
 * one strong-ish bad answer slips through; `min` over passing catches a set so
 * strict that a genuinely competent answer fails it. Averaging either end would
 * let one extreme member hide the case each is there to find.
 */
export function computePanelCurve(graded: GradedPanelMember[]): PanelCurve {
  const byLevel = new Map(graded.map((g) => [g.level, scoreCandidate(g.verdicts)]))
  const scores = PANEL_LEVELS.filter((l) => byLevel.has(l)).map((level) => ({
    level,
    score: byLevel.get(level)!,
  }))

  const passing = PASSING_LEVELS.filter((l) => byLevel.has(l)).map((l) => byLevel.get(l)!)
  const failing = FAILING_LEVELS.filter((l) => byLevel.has(l)).map((l) => byLevel.get(l)!)

  // No candidate on one side means the test did not run, which is a failure,
  // not a pass — the same posture `computeSeparation` takes toward an empty
  // adversary list.
  const separation =
    passing.length === 0 || failing.length === 0
      ? 0
      : Math.min(...passing) - Math.max(...failing)

  const inversions: PanelCurve['inversions'] = []
  for (let i = 0; i < scores.length - 1; i++) {
    const stronger = scores[i]
    const weaker = scores[i + 1]
    if (weaker.score > stronger.score) {
      inversions.push({
        stronger: stronger.level,
        weaker: weaker.level,
        by: weaker.score - stronger.score,
      })
    }
  }

  return {
    scores,
    separation,
    separated:
      passing.length > 0 && failing.length > 0 && separation >= PANEL_SEPARATION_FLOOR,
    inversions,
    monotonic: inversions.length === 0,
  }
}

export type KlpShape =
  | 'healthy'
  | 'too_loose'
  | 'too_strict'
  | 'blind_to_competence'
  | 'keyword_matching'
  | 'non_monotonic'

export interface KlpCurveDiagnosis {
  index: number
  shape: KlpShape
  detail: string
}

/**
 * Per-key-point diagnosis from the SHAPE of its curve.
 *
 * This is what a single gap number cannot give you: not "is this set good" but
 * "what is wrong with THIS point, and therefore what to do about it". Each
 * shape has a different cause and a different fix, which is why they are named
 * separately rather than rolled into a score.
 *
 * Order matters — the checks are most-serious first and only the first match is
 * reported, because a point that fires at L0 is also, necessarily, too loose,
 * and reporting both would bury the worse finding under the milder one.
 */
export function diagnoseKlpCurves(
  graded: GradedPanelMember[],
  klpCount: number,
): KlpCurveDiagnosis[] {
  const byLevel = new Map(graded.map((g) => [g.level, g.verdicts]))
  const at = (level: PanelLevel, i: number) => fires(byLevel.get(level)?.[i])
  const has = (level: PanelLevel) => byLevel.has(level)

  const out: KlpCurveDiagnosis[] = []

  for (let i = 0; i < klpCount; i++) {
    // WORST CASE. An off-target answer cannot support a point about this
    // question; if it does, the point is matching surface vocabulary rather
    // than content, and every score it contributes to is noise.
    if (has('L0') && at('L0', i)) {
      out.push({
        index: i,
        shape: 'keyword_matching',
        detail:
          'fires on the off-target answer — it is matching surface keywords, not content. ' +
          'Every number this point contributes to is noise.',
      })
      continue
    }

    // A FIDELITY ALARM, not merely a strictness problem: a point the expert
    // answer does not support was not derived from the card's own material.
    if (has('L4') && !at('L4', i)) {
      out.push({
        index: i,
        shape: 'too_strict',
        detail:
          'the expert answer does not satisfy it — either it is unreachably strict, or it was ' +
          'never traceable to the card in the first place. Check fidelity before rewording.',
      })
      continue
    }

    if (has('L1') && at('L1', i)) {
      out.push({
        index: i,
        shape: 'too_loose',
        detail:
          'a confused answer already satisfies it, so passing it says nothing about ' +
          'competence. Tighten what it requires.',
      })
      continue
    }

    // The one the old test structurally could not see: a point that separates
    // good from terrible but not competent from partial is dead weight exactly
    // where the learner actually sits.
    if (has('L2') && has('L3') && at('L2', i) === at('L3', i)) {
      out.push({
        index: i,
        shape: 'blind_to_competence',
        detail:
          'behaves identically on the competent and partial answers — it does not measure what ' +
          'separates them, which is the band most learners are in.',
      })
      continue
    }

    out.push({ index: i, shape: 'healthy', detail: 'fires across the curve in the right order' })
  }

  return out
}

/**
 * Points whose behaviour is non-monotonic across the ordered levels.
 *
 * Separate from `diagnoseKlpCurves` because the fix is different and it is not
 * knowable from the shape alone: an inversion is EITHER ambiguous wording OR an
 * unstable grader, and only re-grading the same panel tells you which. Reported
 * as its own list so nobody rewrites a point that was fine and had a flaky
 * verdict.
 */
export function findNonMonotonicKlps(
  graded: GradedPanelMember[],
  klpCount: number,
): KlpCurveDiagnosis[] {
  const ordered = PANEL_LEVELS.filter((l) => graded.some((g) => g.level === l))
  const byLevel = new Map(graded.map((g) => [g.level, g.verdicts]))
  const out: KlpCurveDiagnosis[] = []

  for (let i = 0; i < klpCount; i++) {
    // Once a point stops firing as competence drops, it must not fire again.
    let stopped = false
    for (const level of ordered) {
      const on = fires(byLevel.get(level)?.[i])
      if (!on) stopped = true
      else if (stopped) {
        out.push({
          index: i,
          shape: 'non_monotonic',
          detail:
            `fires at ${level} after failing a stronger answer — ambiguous wording, or an ` +
            `unstable grader. Re-grade the same panel to tell those apart before rewording.`,
        })
        break
      }
    }
  }

  return out
}

/** Human-readable curve, for `--dry-run` and the run summary. */
export function formatPanelCurve(curve: PanelCurve): string {
  const bars = curve.scores
    .map((s) => `${s.level} ${s.score.toFixed(2)} ${'#'.repeat(Math.round(s.score * 20))}`)
    .join('\n    ')
  const mono = curve.monotonic
    ? 'monotonic'
    : `NON-MONOTONIC: ${curve.inversions
        .map((i) => `${i.weaker} outscored ${i.stronger} by ${i.by.toFixed(2)}`)
        .join('; ')}`
  return (
    `    ${bars}\n` +
    `    separation ${curve.separation.toFixed(2)} ` +
    `(min passing - max failing, floor ${PANEL_SEPARATION_FLOOR}) — ` +
    `${curve.separated ? 'separated' : 'NOT separated'}; ${mono}`
  )
}
