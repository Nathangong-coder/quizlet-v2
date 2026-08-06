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
})

describe('paceIndex', () => {
  const baseline = [ev('other1', 1000), ev('other2', 1000), ev('other3', 1000)]

  it('returns 1 when the card matches the learner baseline', () => {
    const events = [...baseline, ev('c1', 1000), ev('c1', 1000), ev('c1', 1000)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(1, 5)
  })

  it('returns above 1 for effortful retrieval', () => {
    const events = [...baseline, ev('c1', 2400), ev('c1', 2400), ev('c1', 2400)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeGreaterThan(2)
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
      ev('o1', 500, 'quiz-tf'), ev('o2', 500, 'quiz-tf'), ev('o3', 500, 'quiz-tf'),
    ]
    // The fast TF baseline must not inflate the SA index.
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(1, 5)
  })

  it('returns null when the mode has no baseline at all', () => {
    expect(paceIndex([ev('c1', 100, 'quiz-sa')], 'c1', 'quiz-tf')).toBeNull()
  })
})
