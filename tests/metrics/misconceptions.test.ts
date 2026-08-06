import { describe, it, expect } from 'vitest'
import { deriveMisconceptions, computeCleanStreaks } from '@/lib/metrics/misconceptions'
import type { ConflationTag } from '@/lib/metrics/misconceptions'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)

const tag = (o: Partial<ConflationTag> = {}): ConflationTag => ({
  klpId: 'a',
  secondaryKlpId: 'b',
  sessionId: 's1',
  quote: 'they are the same thing',
  createdAt: daysAgo(1),
  ...o,
})

describe('promotion', () => {
  it('promotes a pair at 2 occurrences across 2 distinct sessions', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's2' })],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result).toHaveLength(1)
    expect(result[0].klpId).toBe('a')
    expect(result[0].secondaryKlpId).toBe('b')
    expect(result[0].active).toBe(true)
  })

  it('does not promote two occurrences inside a single session', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's1' })],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result).toHaveLength(0)
  })

  it('keeps the verbatim quote from the triggering tag rather than regenerating', () => {
    const result = deriveMisconceptions({
      tags: [
        tag({ sessionId: 's1', quote: 'first' }),
        tag({ sessionId: 's2', quote: 'second' }),
      ],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result[0].evidenceSnippet).toBe('second')
  })

  it('treats (a,b) and (b,a) as distinct pairs — direction is signal', () => {
    const result = deriveMisconceptions({
      tags: [
        tag({ klpId: 'a', secondaryKlpId: 'b', sessionId: 's1' }),
        tag({ klpId: 'b', secondaryKlpId: 'a', sessionId: 's2' }),
      ],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result).toHaveLength(0)
  })
})

describe('retirement', () => {
  it('retires after 30 days with no recurrence', () => {
    const result = deriveMisconceptions({
      tags: [
        tag({ sessionId: 's1', createdAt: daysAgo(40) }),
        tag({ sessionId: 's2', createdAt: daysAgo(31) }),
      ],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result[0].active).toBe(false)
    expect(result[0].retiredReason).toBe('stale')
  })

  it('retires after 3 consecutive clean answers on both KLPs', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's2' })],
      cleanStreaks: { a: 3, b: 3 },
      now: NOW,
    })
    expect(result[0].active).toBe(false)
    expect(result[0].retiredReason).toBe('cleared')
  })

  it('stays active when only one of the two KLPs is clean', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's2' })],
      cleanStreaks: { a: 3, b: 1 },
      now: NOW,
    })
    expect(result[0].active).toBe(true)
  })
})

describe('computeCleanStreaks', () => {
  it('counts consecutive passes back from the most recent outcome', () => {
    const streaks = computeCleanStreaks([
      { klpId: 'a', status: 'failed', createdAt: daysAgo(5) },
      { klpId: 'a', status: 'passed', createdAt: daysAgo(3) },
      { klpId: 'a', status: 'passed', createdAt: daysAgo(1) },
    ])
    expect(streaks.a).toBe(2)
  })

  it('resets the streak at the most recent non-pass', () => {
    const streaks = computeCleanStreaks([
      { klpId: 'a', status: 'passed', createdAt: daysAgo(5) },
      { klpId: 'a', status: 'passed', createdAt: daysAgo(3) },
      { klpId: 'a', status: 'partial', createdAt: daysAgo(1) },
    ])
    expect(streaks.a).toBe(0)
  })

  it('tracks each KLP independently', () => {
    const streaks = computeCleanStreaks([
      { klpId: 'a', status: 'passed', createdAt: daysAgo(2) },
      { klpId: 'b', status: 'failed', createdAt: daysAgo(1) },
    ])
    expect(streaks.a).toBe(1)
    expect(streaks.b).toBe(0)
  })
})
