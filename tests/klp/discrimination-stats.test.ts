import { describe, it, expect } from 'vitest'
import { auc, mutualInformation, entropy } from '@/lib/klp/discrimination-stats'

/**
 * The two alternative discrimination measures. They exist to check the shipped
 * separation score by making DIFFERENT assumptions than it does, so their own
 * assumptions are worth pinning.
 */
describe('auc', () => {
  it('is 1 when the reference beats every adversary', () => {
    expect(auc(0.9, [0.3, 0.2, 0.1])).toBe(1)
  })

  it('is 0 when every adversary beats the reference', () => {
    expect(auc(0.1, [0.3, 0.2, 0.9])).toBe(0)
  })

  it('counts a tie as half a win', () => {
    // A tie is genuinely ambiguous — the KLPs did not order these two answers.
    // Scoring it as a win would claim a discrimination that did not happen.
    expect(auc(0.5, [0.5, 0.1])).toBe(0.75)
  })

  it('ignores the SIZE of the gap, only its direction', () => {
    // The property that makes it a check on separation rather than a
    // restatement of it: a uniformly harsher grader shrinks every score and
    // moves separation, but cannot move a rank statistic.
    expect(auc(0.9, [0.1])).toBe(auc(0.51, [0.5]))
  })

  it('is 0 with no adversaries — the test did not run', () => {
    // Matching computeSeparation: no wrong answers is a failure to measure,
    // never a perfect score.
    expect(auc(1, [])).toBe(0)
  })
})

describe('mutualInformation', () => {
  it('is 0 when the verdict is identical on every candidate', () => {
    // The KLP fires the same way regardless of answer quality: pure grading
    // cost, zero information. This is the case the measure exists to name.
    expect(mutualInformation([1, 1, 1, 1], [1, 0, 0, 0])).toBe(0)
  })

  it('reaches the class entropy when the verdict predicts the class exactly', () => {
    const classes = [1, 0, 0, 0]
    const perfect = [1, 0, 0, 0]
    expect(mutualInformation(perfect, classes)).toBeCloseTo(entropy(classes), 10)
  })

  it('is symmetric under relabelling the verdict values', () => {
    // It reads the PARTITION, not the credit values — so it never assumes
    // "partial" sits halfway, which is the assumption separation does make.
    expect(mutualInformation([1, 0, 0, 0], [1, 0, 0, 0])).toBeCloseTo(
      mutualInformation([0.5, 0.2, 0.2, 0.2], [1, 0, 0, 0]),
      10,
    )
  })

  it('is 0 for an empty sample rather than NaN', () => {
    expect(mutualInformation([], [])).toBe(0)
  })
})

describe('entropy', () => {
  it('is 0.811 bits for one reference against three adversaries', () => {
    // The hard ceiling on MI in this design. No KLP can score above it however
    // perfectly it discriminates, which is why MI is reported as a FRACTION of
    // this rather than as an absolute number of bits.
    expect(entropy([1, 0, 0, 0])).toBeCloseTo(0.8113, 4)
  })

  it('is 1 bit for a balanced split and 0 for a constant class', () => {
    expect(entropy([1, 0])).toBe(1)
    expect(entropy([1, 1, 1])).toBe(0)
  })
})
