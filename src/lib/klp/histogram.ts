/**
 * The weight histogram — the ACCEPTANCE CRITERION for increment A §1, not a
 * decoration on it.
 *
 * Audit finding G1 was never "the weights look wrong"; it was a number:
 * **92.3% of AI-assigned `CardKlp.weight` values were 4 or 5**, so no accuracy
 * error could score below 5 and significance never spanned its own 1-10 range.
 * A distribution is what found that, and a distribution is the only thing that
 * can show it fixed. `weightFromSignals` replacing an AI opinion is a
 * hypothesis; this module is the test.
 *
 * It lands BEFORE the corpus is re-authored on purpose. A check written after
 * the run can only be read once the evidence it would have judged is already
 * overwritten — and the pilot's own weights (2,1,2,1,1) are exactly the kind of
 * result that needs a baseline to interpret.
 *
 * Everything here is pure and takes plain numbers. `scripts/klp-histogram.ts`
 * feeds it live rows; `scripts/author-klps.ts` feeds it the weights of a run it
 * just produced, so an operator sees the shape of what they authored without a
 * second command.
 */
import {
  HISTOGRAM_CLUSTER_SHARE,
  HISTOGRAM_UNIFORM_SHARE,
  HISTOGRAM_MIN_SAMPLE,
} from '@/lib/klp/authoring-config'
import { VERDICT_CREDIT, isKlpVerdict } from '@/lib/klp/verdicts'

/** `CardKlp.weight` is an integer 1-5; every array here is indexed weight - 1. */
export const WEIGHT_MIN = 1
export const WEIGHT_MAX = 5

export interface WeightHistogram {
  total: number
  /** `counts[w - 1]` KLPs carry weight `w`. */
  counts: number[]
  /** `counts` as fractions of `total`; all zero when `total` is 0. */
  shares: number[]
  mean: number
  /** How many of the five weight values appear at all. */
  distinctValues: number
  /** Share at weight 4-5 — the G1 tail. */
  highShare: number
  /** Share at weight 1-2 — the tail an over-sparse relation graph produces. */
  lowShare: number
  modalWeight: number
  modalShare: number
}

/** Out-of-range weights are DROPPED, not clamped — see `buildWeightHistogram`. */
function inRange(weight: number): boolean {
  return Number.isInteger(weight) && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX
}

/**
 * The distribution of a set of weights.
 *
 * A weight outside 1-5 is dropped rather than clamped. Clamping would fold a
 * corrupt row into the 1 or 5 bucket and make the corruption look like the very
 * clustering this histogram exists to detect; dropping it makes `total` differ
 * from the row count, which is a discrepancy an operator can see and chase.
 */
export function buildWeightHistogram(weights: number[]): WeightHistogram {
  const counts = Array.from({ length: WEIGHT_MAX }, () => 0)
  let sum = 0
  let total = 0

  for (const w of weights) {
    if (!inRange(w)) continue
    counts[w - 1] += 1
    sum += w
    total += 1
  }

  const shares = counts.map((c) => (total > 0 ? c / total : 0))
  const modalIndex = counts.reduce((best, c, i) => (c > counts[best] ? i : best), 0)

  return {
    total,
    counts,
    shares,
    mean: total > 0 ? sum / total : 0,
    distinctValues: counts.filter((c) => c > 0).length,
    highShare: shares[3] + shares[4],
    lowShare: shares[0] + shares[1],
    modalWeight: modalIndex + 1,
    modalShare: total > 0 ? counts[modalIndex] / total : 0,
  }
}

/**
 * The three ways the weight signal fails, each with a different cause and a
 * different fix. Naming them separately is the whole value of the check: "the
 * weights are bad" is not actionable, "the evidence term is flat" is.
 */
export const HISTOGRAM_FAILURE_MODES = ['clustered_high', 'clustered_low', 'uniform'] as const
export type HistogramFailureMode = (typeof HISTOGRAM_FAILURE_MODES)[number]

export interface HistogramFinding {
  mode: HistogramFailureMode
  /** The measured share that fired the finding. */
  share: number
  threshold: number
  /** What it means and what to do about it — printed verbatim by the scripts. */
  detail: string
}

/**
 * Which failure modes a distribution exhibits. ALL that fire are returned, not
 * a single verdict: a corpus of nothing but 5s is both `clustered_high` and
 * `uniform`, and collapsing that to one label discards half the diagnosis.
 *
 * A corpus below `HISTOGRAM_MIN_SAMPLE` fires NOTHING, and an empty one is the
 * limiting case of that. Zero rows is not a flat distribution, it is no
 * distribution; four rows at 75% one value is arithmetic, not evidence. Both
 * would train an operator to ignore the check on exactly the runs where it has
 * not yet had enough to measure — which are the runs it is printed on most
 * often, since a single card carries 4-9 KLPs.
 */
export function diagnoseWeightHistogram(h: WeightHistogram): HistogramFinding[] {
  if (h.total < HISTOGRAM_MIN_SAMPLE) return []

  const findings: HistogramFinding[] = []

  if (h.highShare >= HISTOGRAM_CLUSTER_SHARE) {
    findings.push({
      mode: 'clustered_high',
      share: h.highShare,
      threshold: HISTOGRAM_CLUSTER_SHARE,
      detail:
        'weights bunched at 4-5 — this is audit finding G1 (92.3% at 4-5 from the AI-assigned ' +
        'weights this pipeline replaced). Significance cannot score an error below the top of its ' +
        'range. Something is inflating: check that weight is coming from weightFromSignals and not ' +
        'from a model-supplied number.',
    })
  }

  if (h.lowShare >= HISTOGRAM_CLUSTER_SHARE) {
    findings.push({
      mode: 'clustered_low',
      share: h.lowShare,
      threshold: HISTOGRAM_CLUSTER_SHARE,
      detail:
        'weights bunched at 1-2 — both signals are flat. The graph term does this on enumeration ' +
        'cards, which is correct and expected; the evidence term is supposed to carry them. If this ' +
        'fires after increment A, the discrimination-breadth term is not doing its job — check the ' +
        'breadth histogram before touching the relate prompt, because forcing edges fabricates ' +
        'dependencies Spec 3 would then serve probes for.',
    })
  }

  if (h.modalShare >= HISTOGRAM_UNIFORM_SHARE) {
    findings.push({
      mode: 'uniform',
      share: h.modalShare,
      threshold: HISTOGRAM_UNIFORM_SHARE,
      detail:
        `one weight value (${h.modalWeight}) covers most of the corpus — the weights are not ` +
        'clustered in a tail so much as absent as a signal. Every KLP being equally important is ' +
        'the same as no weighting at all, wherever the value sits.',
    })
  }

  return findings
}

/**
 * The distribution of the EVIDENCE term's raw input, bucketed by how many
 * adversarial answers failed each KLP.
 *
 * Reported beside the weight histogram so an operator can tell WHICH term is
 * flat when weights come out flat. If every KLP is failed by all three
 * adversaries, the evidence term is a constant and contributes no spread — and
 * that is a fact about the adversaries (too weak, so they miss everything), not
 * about the weight formula. Rebalancing the formula in that state would be
 * tuning against a broken input.
 *
 * Bucketed by COUNT rather than by the 0-1 fraction because the count is exact:
 * with three adversaries the only reachable fractions are 0, 1/3, 2/3 and 1,
 * and rounding those back into buckets to display them invites off-by-one
 * confusion for no gain.
 */
export interface BreadthHistogram {
  total: number
  /** `counts[k]` KLPs were failed by exactly `k` of the wrong answers. */
  counts: number[]
  wrongAnswerCount: number
  distinctValues: number
  modalShare: number
  /** Mean fraction of adversaries failing a KLP — the evidence term's mean. */
  meanBreadth: number
}

export function buildBreadthHistogram(failCounts: number[], wrongAnswerCount: number): BreadthHistogram {
  const counts = Array.from({ length: wrongAnswerCount + 1 }, () => 0)
  let total = 0

  for (const k of failCounts) {
    if (!Number.isInteger(k) || k < 0 || k > wrongAnswerCount) continue
    counts[k] += 1
    total += 1
  }

  const modal = counts.reduce((best, c) => Math.max(best, c), 0)
  const weightedSum = counts.reduce((sum, c, k) => sum + c * k, 0)

  return {
    total,
    counts,
    wrongAnswerCount,
    distinctValues: counts.filter((c) => c > 0).length,
    modalShare: total > 0 ? modal / total : 0,
    meanBreadth: total > 0 && wrongAnswerCount > 0 ? weightedSum / (total * wrongAnswerCount) : 0,
  }
}

/**
 * How many adversarial answers failed each KLP, read off a persisted or
 * in-memory verdict matrix.
 *
 * `AuthoringProbe.verdicts` is keyed by the KLP's INDEX within the card, which
 * is also `CardKlp.index` at the same version — so this needs no join, and the
 * same function serves `scripts/klp-histogram.ts` (reading rows back) and
 * `scripts/author-klps.ts` (reading a run it just produced). Two copies of this
 * rule would be two chances for the stored breadth and the live breadth to
 * disagree about what counts as a failure.
 *
 * A verdict is a FAIL when `VERDICT_CREDIT` is 0 — `evaluateKlps`'s rule,
 * imported rather than restated.
 *
 * An unrecognised verdict string (a row written before a vocabulary change) is
 * SKIPPED, not counted either way: moving the distribution using a value
 * nothing can interpret is worse than leaving it out and letting the totals
 * disagree visibly.
 */
export function failCountsFromVerdicts(
  probes: { verdicts: unknown }[],
  klpCount: number,
): { failCounts: number[]; wrongAnswerCount: number } {
  const failCounts = Array.from({ length: klpCount }, () => 0)

  for (const probe of probes) {
    const map = probe.verdicts
    if (typeof map !== 'object' || map === null) continue
    for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
      const index = Number.parseInt(key, 10)
      if (!Number.isInteger(index) || index < 0 || index >= klpCount) continue
      if (!isKlpVerdict(value)) continue
      if (VERDICT_CREDIT[value] === 0) failCounts[index] += 1
    }
  }

  return { failCounts, wrongAnswerCount: probes.length }
}

/** A fixed-width bar, so a printed histogram is readable without a chart. */
function bar(share: number, width = 30): string {
  return '#'.repeat(Math.round(share * width)).padEnd(width, '.')
}

/** Renders a weight histogram plus every finding it fires. */
export function formatWeightHistogram(h: WeightHistogram, findings: HistogramFinding[]): string {
  const lines: string[] = []
  lines.push(`Weight histogram — ${h.total} KLP(s), mean ${h.mean.toFixed(2)}, ${h.distinctValues}/5 values present`)
  for (let w = WEIGHT_MIN; w <= WEIGHT_MAX; w++) {
    const i = w - 1
    lines.push(`  ${w}: ${bar(h.shares[i])} ${String(h.counts[i]).padStart(5)}  ${(h.shares[i] * 100).toFixed(1)}%`)
  }
  lines.push(
    `  low (1-2) ${(h.lowShare * 100).toFixed(1)}%  high (4-5) ${(h.highShare * 100).toFixed(1)}%  ` +
      `modal ${h.modalWeight} at ${(h.modalShare * 100).toFixed(1)}%`,
  )

  if (h.total === 0) {
    lines.push('  (no weights to judge)')
  } else if (h.total < HISTOGRAM_MIN_SAMPLE) {
    lines.push(
      `  Shape only — ${h.total} KLP(s) is below the ${HISTOGRAM_MIN_SAMPLE} needed to tell clustering ` +
        'from small-sample noise, so no failure mode is reported.',
    )
  } else if (findings.length === 0) {
    lines.push('  OK — no failure mode fired.')
  } else {
    for (const f of findings) {
      lines.push(`  FAIL ${f.mode} — ${(f.share * 100).toFixed(1)}% vs threshold ${(f.threshold * 100).toFixed(0)}%`)
      lines.push(`       ${f.detail}`)
    }
  }
  return lines.join('\n')
}

export function formatBreadthHistogram(h: BreadthHistogram): string {
  const lines: string[] = []
  lines.push(
    `Discrimination-breadth histogram — ${h.total} KLP(s) against ${h.wrongAnswerCount} wrong answer(s), ` +
      `mean breadth ${h.meanBreadth.toFixed(2)}`,
  )
  for (let k = 0; k < h.counts.length; k++) {
    const share = h.total > 0 ? h.counts[k] / h.total : 0
    lines.push(`  failed by ${k}: ${bar(share)} ${String(h.counts[k]).padStart(5)}  ${(share * 100).toFixed(1)}%`)
  }
  if (h.total > 0 && h.distinctValues <= 1) {
    lines.push('  FLAT — every KLP has the same breadth, so the evidence term contributes no spread.')
    lines.push('       That is a fact about the adversaries, not the weight formula. Fix them first.')
  }
  return lines.join('\n')
}
