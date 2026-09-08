import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'

/**
 * Alternative discrimination measures, for checking the shipped separation
 * score against assumptions it does not make.
 *
 * `separation = referenceScore - bestWrongScore` is a difference of means over
 * an ordinal scale mapped to {0, 0.5, 1}. That is defensible and it is also an
 * ASSUMPTION - that "partial" sits exactly halfway, and that a grader's
 * harshness cancels in the subtraction. A measure making DIFFERENT assumptions
 * is the only way to find out whether the first one is carrying them.
 *
 * Pure and database-free, so the arithmetic is testable without a corpus. The
 * IO half lives in `scripts/klp-discrimination-stats.ts`.
 */

/** Verdict rows as stored on AuthoringProbe.verdicts. */
export type VerdictList = KlpVerdict[]

/**
 * `AuthoringProbe.verdicts` is stored as `{ "0": verdict, "1": ... }`, keyed by
 * KLP index, not as an array. Read back in numeric index order — object key
 * order is insertion order for these keys and happens to be right, which is
 * exactly the kind of accident not to depend on.
 */
export function verdictList(value: unknown): VerdictList {
  if (Array.isArray(value)) return value as VerdictList
  if (!value || typeof value !== 'object') return []
  const entries = Object.entries(value as Record<string, KlpVerdict>)
  const out: VerdictList = []
  for (const [k, v] of entries) {
    const i = Number(k)
    if (Number.isInteger(i) && i >= 0) out[i] = v
  }
  return out
}

export function credits(verdicts: VerdictList): number[] {
  return verdicts.map((v) => VERDICT_CREDIT[v] ?? 0)
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * MEASURE 2 — AUC (equivalently the Mann-Whitney U statistic).
 *
 * "The probability that a randomly chosen good answer outscores a randomly
 * chosen bad one", ties counting a half. It is RANK-BASED, which is exactly
 * what the difference of means is not:
 *
 *  - It never assumes `partial` is halfway between `failed` and `correct`. Only
 *    the ORDER of the credit values matters, so a grader with a different
 *    internal scale produces the same number.
 *  - It is unchanged by any monotone recalibration of the grader — a uniformly
 *    harsh grader shifts both scores and moves separation, but cannot move AUC.
 *
 * The cost is resolution: with one reference and three adversaries it can only
 * take the values 0, 1/6, ..., 1. It is a coarse instrument that is hard to
 * fool, next to a fine one that is easy to.
 */
export function auc(referenceScore: number, wrongScores: number[]): number {
  if (wrongScores.length === 0) return 0
  let wins = 0
  for (const w of wrongScores) {
    if (referenceScore > w) wins += 1
    else if (referenceScore === w) wins += 0.5
  }
  return wins / wrongScores.length
}

/**
 * MEASURE 3 — mutual information, in bits, between one KLP's verdict and
 * whether the answer it graded was the reference or an adversary.
 *
 * This is the information-theoretic form of the question the whole pipeline
 * asks: how much does knowing the verdict on this point tell you about whether
 * the answer was any good? A KLP that fires identically on every candidate has
 * I = 0 exactly, and is pure grading cost.
 *
 * Its advantage over `discriminationBreadth` is that it reads the REFERENCE
 * too. Breadth counts how many adversaries fail a KLP and never checks whether
 * the good answer passed it — so a KLP that everybody fails, including the
 * reference, scores maximum breadth while carrying no information at all.
 *
 * Its disadvantage is a hard ceiling: with 1 reference and 3 adversaries the
 * class distribution is fixed at (0.25, 0.75), so H(C) = 0.811 bits and no KLP
 * can score above that however perfect it is. Read it as a fraction of 0.811,
 * never as an absolute.
 */
export function mutualInformation(labels: number[], classes: number[]): number {
  const n = labels.length
  if (n === 0) return 0

  const joint = new Map<string, number>()
  const pLabel = new Map<number, number>()
  const pClass = new Map<number, number>()

  for (let i = 0; i < n; i++) {
    const l = labels[i]
    const c = classes[i]
    joint.set(`${l}|${c}`, (joint.get(`${l}|${c}`) ?? 0) + 1)
    pLabel.set(l, (pLabel.get(l) ?? 0) + 1)
    pClass.set(c, (pClass.get(c) ?? 0) + 1)
  }

  let mi = 0
  for (const [key, count] of joint) {
    const [l, c] = key.split('|').map(Number)
    const pxy = count / n
    const px = (pLabel.get(l) ?? 0) / n
    const py = (pClass.get(c) ?? 0) / n
    if (pxy > 0) mi += pxy * Math.log2(pxy / (px * py))
  }
  return mi
}

/** Entropy of the class variable — the ceiling MI can reach. */
export function entropy(classes: number[]): number {
  const n = classes.length
  if (n === 0) return 0
  const counts = new Map<number, number>()
  for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1)
  let h = 0
  for (const count of counts.values()) {
    const p = count / n
    if (p > 0) h -= p * Math.log2(p)
  }
  return h
}
