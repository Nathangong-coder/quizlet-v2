import { describe, it, expect } from 'vitest'
import {
  buildWeightHistogram,
  diagnoseWeightHistogram,
  buildBreadthHistogram,
  formatWeightHistogram,
  formatBreadthHistogram,
  HISTOGRAM_FAILURE_MODES,
} from '@/lib/klp/histogram'
import { HISTOGRAM_CLUSTER_SHARE, HISTOGRAM_UNIFORM_SHARE } from '@/lib/klp/authoring-config'

/** Repeats a weight, so a fixture reads as a distribution rather than a list. */
function rep(weight: number, times: number): number[] {
  return Array.from({ length: times }, () => weight)
}

function modesOf(weights: number[]): string[] {
  return diagnoseWeightHistogram(buildWeightHistogram(weights)).map((f) => f.mode)
}

describe('buildWeightHistogram', () => {
  it('counts by weight and reports the tails', () => {
    const h = buildWeightHistogram([1, 2, 3, 4, 5, 5])
    expect(h.total).toBe(6)
    expect(h.counts).toEqual([1, 1, 1, 1, 2])
    expect(h.mean).toBeCloseTo(20 / 6)
    expect(h.distinctValues).toBe(5)
    expect(h.highShare).toBeCloseTo(3 / 6)
    expect(h.lowShare).toBeCloseTo(2 / 6)
    expect(h.modalWeight).toBe(5)
  })

  it('is all zeros and never NaN for an empty corpus', () => {
    const h = buildWeightHistogram([])
    expect(h.total).toBe(0)
    expect(h.mean).toBe(0)
    expect(h.shares.every((s) => s === 0)).toBe(true)
    expect(h.modalShare).toBe(0)
  })

  /**
   * Clamping a corrupt weight into the 1 or 5 bucket would make the corruption
   * look like the exact clustering this histogram exists to detect. Dropping it
   * leaves `total` short of the row count, which an operator can see.
   */
  it('drops out-of-range and non-integer weights rather than clamping them', () => {
    const h = buildWeightHistogram([0, 6, 2.5, Number.NaN, 3])
    expect(h.total).toBe(1)
    expect(h.counts).toEqual([0, 0, 1, 0, 0])
  })
})

describe('diagnoseWeightHistogram', () => {
  /** Audit finding G1 itself: 92.3% at 4-5 is what this must reject. */
  it('fires clustered_high on the G1 baseline shape', () => {
    const modes = modesOf([...rep(4, 60), ...rep(5, 32), ...rep(1, 4), ...rep(2, 4)])
    expect(modes).toContain('clustered_high')
    expect(modes).not.toContain('clustered_low')
  })

  /**
   * The failure this increment is watching for: if the evidence term does not
   * carry enumeration cards, weights collapse into the bottom tail instead of
   * the top one, and the formula needs rebalancing rather than the prompt.
   */
  it('fires clustered_low when weights bunch at 1-2', () => {
    const modes = modesOf([...rep(1, 60), ...rep(2, 30), ...rep(3, 5), ...rep(4, 5)])
    expect(modes).toContain('clustered_low')
    expect(modes).not.toContain('clustered_high')
  })

  /** Flatness in the MIDDLE is invisible to both tail checks and just as useless. */
  it('fires uniform when one mid-range value dominates, with neither tail firing', () => {
    const modes = modesOf([...rep(3, 70), ...rep(1, 10), ...rep(2, 5), ...rep(4, 10), ...rep(5, 5)])
    expect(modes).toEqual(['uniform'])
  })

  it('reports every mode that fires rather than one verdict', () => {
    const modes = modesOf(rep(5, 40))
    expect(modes).toContain('clustered_high')
    expect(modes).toContain('uniform')
  })

  it('passes a genuinely spread distribution', () => {
    expect(modesOf([...rep(1, 20), ...rep(2, 20), ...rep(3, 20), ...rep(4, 20), ...rep(5, 20)])).toEqual([])
  })

  /**
   * Zero rows is not a flat distribution, it is no distribution. Failing here
   * would train an operator to ignore the check on the run where it has not yet
   * had anything to measure.
   */
  it('fires nothing on an empty corpus', () => {
    expect(diagnoseWeightHistogram(buildWeightHistogram([]))).toEqual([])
  })

  it('sits strictly on the configured thresholds', () => {
    // 3 of 4 in the high tail is exactly HISTOGRAM_CLUSTER_SHARE.
    expect(HISTOGRAM_CLUSTER_SHARE).toBe(0.75)
    expect(modesOf([4, 4, 5, 1])).toContain('clustered_high')
    expect(modesOf([4, 4, 1, 2])).not.toContain('clustered_high')

    expect(HISTOGRAM_UNIFORM_SHARE).toBe(0.6)
    expect(modesOf([3, 3, 3, 1, 5])).toContain('uniform')
    expect(modesOf([3, 3, 1, 4, 5])).not.toContain('uniform')
  })

  it('names only modes in the declared vocabulary', () => {
    for (const mode of modesOf(rep(5, 10))) {
      expect(HISTOGRAM_FAILURE_MODES).toContain(mode)
    }
  })
})

describe('buildBreadthHistogram', () => {
  it('buckets KLPs by how many adversaries failed them', () => {
    const h = buildBreadthHistogram([3, 3, 2, 1, 0], 3)
    expect(h.counts).toEqual([1, 1, 1, 2])
    expect(h.total).toBe(5)
    expect(h.distinctValues).toBe(4)
    expect(h.meanBreadth).toBeCloseTo((3 + 3 + 2 + 1 + 0) / (5 * 3))
  })

  /**
   * The state that makes rebalancing the weight formula a mistake: the evidence
   * term is a constant, so it contributes no spread, and the cause is the
   * adversaries rather than the formula.
   */
  it('shows a single distinct value when every KLP has the same breadth', () => {
    const h = buildBreadthHistogram([3, 3, 3, 3], 3)
    expect(h.distinctValues).toBe(1)
    expect(h.modalShare).toBe(1)
    expect(formatBreadthHistogram(h)).toContain('FLAT')
  })

  it('drops counts outside 0..wrongAnswerCount and never returns NaN', () => {
    const h = buildBreadthHistogram([4, -1, 2], 3)
    expect(h.total).toBe(1)
    expect(buildBreadthHistogram([], 3).meanBreadth).toBe(0)
  })
})

describe('formatWeightHistogram', () => {
  it('prints every failure detail so the printout is self-explanatory', () => {
    const h = buildWeightHistogram(rep(5, 10))
    const text = formatWeightHistogram(h, diagnoseWeightHistogram(h))
    expect(text).toContain('FAIL clustered_high')
    expect(text).toContain('G1')
  })

  it('says so plainly when nothing fired', () => {
    const weights = [...rep(1, 20), ...rep(2, 20), ...rep(3, 20), ...rep(4, 20), ...rep(5, 20)]
    const h = buildWeightHistogram(weights)
    expect(formatWeightHistogram(h, diagnoseWeightHistogram(h))).toContain('OK')
  })
})
