import { describe, it, expect } from 'vitest'
import { paceIndex, medianOf, MIN_TIMED_OBSERVATIONS } from '@/lib/metrics/pace'
import type { TimedEvent } from '@/lib/metrics/pace'

const ev = (cardId: string, latencyMs: number, mode: TimedEvent['mode'] = 'quiz-sa'): TimedEvent => ({
  cardId,
  mode,
  latencyMs,
})

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
