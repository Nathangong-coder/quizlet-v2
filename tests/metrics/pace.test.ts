import { describe, it, expect } from 'vitest'
import { paceIndex, medianOf, MIN_TIMED_OBSERVATIONS, paceOutliers, PACE_OUTLIER_MIN_INDEX } from '@/lib/metrics/pace'
import type { TimedEvent } from '@/lib/metrics/pace'

const ev = (cardId: string, latencyMs: number, mode: TimedEvent['mode'] = 'quiz-sa'): TimedEvent => ({
  cardId,
  mode,
  latencyMs,
})

const evc = (
  cardId: string,
  latencyMs: number,
  correct: boolean,
  mode: TimedEvent['mode'] = 'quiz-sa',
): TimedEvent => ({ cardId, mode, latencyMs, correct })

describe('medianOf', () => {
  it('returns null for an empty list rather than 0', () => {
    expect(medianOf([])).toBeNull()
  })

  it('averages the middle pair for an even count', () => {
    expect(medianOf([10, 20, 30, 40])).toBe(25)
  })

  it('returns the middle value for an odd count', () => {
    expect(medianOf([10, 20, 30])).toBe(20)
  })

  it('distinguishes median from mean with skewed data', () => {
    // mean = 32.5, median = 25
    expect(medianOf([10, 20, 30, 70])).toBe(25)
    expect(medianOf([10, 20, 30, 70])).not.toBe(32.5)
  })
})

describe('paceIndex', () => {
  const baseline = [ev('other1', 1000), ev('other2', 1000), ev('other3', 1000)]

  it('returns 1 when the card matches the learner baseline', () => {
    const events = [...baseline, ev('c1', 1000), ev('c1', 1000), ev('c1', 1000)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(1, 5)
  })

  it('returns above 1 for effortful retrieval', () => {
    const manyBaseline = [
      ev('other1', 1000), ev('other2', 1000), ev('other3', 1000),
      ev('other4', 1000), ev('other5', 1000), ev('other6', 1000),
    ]
    const events = [...manyBaseline, ev('c1', 2400), ev('c1', 2400), ev('c1', 2400)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(2.4, 5)
  })

  it('returns null below the observation floor rather than a one-sample ratio', () => {
    const events = [...baseline, ev('c1', 5000)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeNull()
    expect(MIN_TIMED_OBSERVATIONS).toBe(3)
  })

  it('never compares across modes — short answer and true/false differ by an order of magnitude', () => {
    const events = [
      ev('c1', 8000, 'quiz-sa'), ev('c1', 8000, 'quiz-sa'), ev('c1', 8000, 'quiz-sa'),
      ev('o1', 8000, 'quiz-sa'), ev('o2', 8000, 'quiz-sa'), ev('o3', 8000, 'quiz-sa'),
      ev('o1', 100, 'quiz-tf'), ev('o2', 100, 'quiz-tf'), ev('o3', 100, 'quiz-tf'),
      ev('o4', 100, 'quiz-tf'), ev('o5', 100, 'quiz-tf'), ev('o6', 100, 'quiz-tf'),
    ]
    // Six fast TF events must not corrupt the SA baseline.
    // SA only: [8000, 8000, 8000, 8000, 8000, 8000], median 8000.
    // All modes mixed would be [100, 100, 100, 100, 100, 100, 8000, 8000, 8000, 8000, 8000, 8000], median 4050.
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(1, 5)
  })

  it('returns null when the mode has no baseline at all', () => {
    expect(paceIndex([ev('c1', 100, 'quiz-sa')], 'c1', 'quiz-tf')).toBeNull()
  })
})

describe('paceOutliers', () => {
  // 12 distinct single-observation cards, each below MIN_TIMED_OBSERVATIONS
  // on its own (so none can appear in the output itself), but together large
  // enough that they, not a test card's own 3 samples, anchor the population
  // median at exactly 1000 regardless of how slow a test card is. Every test
  // below adds at most 6 non-baseline samples, well under the 12-strong
  // baseline, so this holds throughout.
  const baseline = Array.from({ length: 12 }, (_, i) => ev(`other${i}`, 1000))

  it('includes a card exactly at the threshold', () => {
    // index = 1500 / 1000 = 1.5 === PACE_OUTLIER_MIN_INDEX
    const events = [...baseline, evc('c1', 1500, true), evc('c1', 1500, true), evc('c1', 1500, true)]
    const outliers = paceOutliers(events, 'quiz-sa')
    expect(outliers).toEqual([{ cardId: 'c1', index: 1.5 }])
  })

  it('excludes a card just below the threshold', () => {
    // index = 1499 / 1000 = 1.499 < 1.5
    const events = [...baseline, evc('c1', 1499, true), evc('c1', 1499, true), evc('c1', 1499, true)]
    expect(paceOutliers(events, 'quiz-sa')).toEqual([])
  })

  it('excludes a slow card that was majority-incorrect — that is a knowledge gap, not a fluency one', () => {
    // index = 3000 / 1000 = 3.0, well above threshold, but 2 of 3 wrong.
    const events = [
      ...baseline,
      evc('c1', 3000, true), evc('c1', 3000, false), evc('c1', 3000, false),
    ]
    expect(paceOutliers(events, 'quiz-sa')).toEqual([])
  })

  it('excludes a card with no correctness evidence at all (a tie, not a majority)', () => {
    const events = [...baseline, ev('c1', 3000), ev('c1', 3000), ev('c1', 3000)]
    expect(paceOutliers(events, 'quiz-sa')).toEqual([])
  })

  it('excludes cards below the observation floor regardless of latency or correctness', () => {
    const events = [...baseline, evc('c1', 5000, true), evc('c1', 5000, true)]
    expect(paceOutliers(events, 'quiz-sa')).toEqual([])
  })

  it('sorts multiple outliers by index descending', () => {
    const events = [
      ...baseline,
      evc('slow', 2000, true), evc('slow', 2000, true), evc('slow', 2000, true),
      evc('slower', 4000, true), evc('slower', 4000, true), evc('slower', 4000, true),
    ]
    expect(paceOutliers(events, 'quiz-sa')).toEqual([
      { cardId: 'slower', index: 4 },
      { cardId: 'slow', index: 2 },
    ])
  })

  it('accepts a custom minIndex', () => {
    const events = [...baseline, evc('c1', 1200, true), evc('c1', 1200, true), evc('c1', 1200, true)]
    // index = 1.2, below the default 1.5 floor but above a custom 1.0 floor.
    expect(paceOutliers(events, 'quiz-sa')).toEqual([])
    expect(paceOutliers(events, 'quiz-sa', 1.0)).toEqual([{ cardId: 'c1', index: 1.2 }])
  })

  it('never mixes outliers across modes', () => {
    const events = [
      ...baseline,
      evc('c1', 3000, true, 'quiz-tf'), evc('c1', 3000, true, 'quiz-tf'), evc('c1', 3000, true, 'quiz-tf'),
    ]
    expect(paceOutliers(events, 'quiz-sa')).toEqual([])
  })
})
