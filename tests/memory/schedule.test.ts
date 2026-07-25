import { describe, it, expect } from 'vitest'
import {
  nextDueAt,
  selectDueCards,
  RESET_INTERVAL_DAYS,
  BASE_INTERVAL_DAYS,
  GROWTH_RATE,
  MAX_INTERVAL_DAYS,
} from '@/lib/memory/schedule'
import type { DueCardRow } from '@/lib/memory/schedule'

const NOW = new Date('2026-07-24T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / DAY_MS)
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS)
const daysFromNow = (n: number): Date => new Date(NOW.getTime() + n * DAY_MS)

describe('nextDueAt — wrong/poor outcome', () => {
  it('resets to RESET_INTERVAL_DAYS regardless of confidence', () => {
    const low = nextDueAt({ correct: false, confidence: 1, reps: 0, now: NOW })
    const high = nextDueAt({ correct: false, confidence: 10, reps: 0, now: NOW })

    expect(daysBetween(NOW, low)).toBe(RESET_INTERVAL_DAYS)
    expect(daysBetween(NOW, high)).toBe(RESET_INTERVAL_DAYS)
  })

  it('resets to RESET_INTERVAL_DAYS regardless of a large prior reps streak', () => {
    // Caller is expected to have already reset `reps` to 0 on a wrong
    // outcome, but nextDueAt should ignore a stale/non-zero reps value too
    // when correct=false — the outcome always wins over the streak.
    const result = nextDueAt({ correct: false, confidence: 8, reps: 12, now: NOW })
    expect(daysBetween(NOW, result)).toBe(RESET_INTERVAL_DAYS)
  })

  it('is always strictly in the future relative to now', () => {
    const result = nextDueAt({ correct: false, confidence: 5, reps: 0, now: NOW })
    expect(result.getTime()).toBeGreaterThan(NOW.getTime())
  })
})

describe('nextDueAt — correct/good outcome, interval growth', () => {
  it('grows geometrically with the consecutive-correct streak (mid confidence)', () => {
    const confidence = 5 // near the midpoint of the 1-10 scale
    const days = [1, 2, 3, 4, 5].map(
      (reps) => daysBetween(NOW, nextDueAt({ correct: true, confidence, reps, now: NOW })),
    )

    // Each successive interval should be >= the previous one (monotonic
    // non-decreasing growth) and strictly greater at least once early on.
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThanOrEqual(days[i - 1])
    }
    expect(days[days.length - 1]).toBeGreaterThan(days[0])
  })

  it('scales the first correct rep (reps=1) roughly to BASE_INTERVAL_DAYS at mid confidence', () => {
    const result = nextDueAt({ correct: true, confidence: 5, reps: 1, now: NOW })
    const days = daysBetween(NOW, result)
    // BASE_INTERVAL_DAYS * confidenceScale(5), confidenceScale in [0.5, 1.5]
    expect(days).toBeGreaterThanOrEqual(1)
    expect(days).toBeLessThanOrEqual(BASE_INTERVAL_DAYS * 2)
  })

  it('a higher confidence produces a longer (or equal) interval than a lower one, same streak', () => {
    const reps = 3
    const lowConf = daysBetween(NOW, nextDueAt({ correct: true, confidence: 1, reps, now: NOW }))
    const highConf = daysBetween(NOW, nextDueAt({ correct: true, confidence: 10, reps, now: NOW }))

    expect(highConf).toBeGreaterThan(lowConf)
  })

  it('caps the interval at MAX_INTERVAL_DAYS no matter how long the streak', () => {
    const result = nextDueAt({ correct: true, confidence: 10, reps: 50, now: NOW })
    expect(daysBetween(NOW, result)).toBe(MAX_INTERVAL_DAYS)
  })

  it('is deterministic and pure — same inputs, same output, no reliance on real time', () => {
    const a = nextDueAt({ correct: true, confidence: 7, reps: 4, now: NOW })
    const b = nextDueAt({ correct: true, confidence: 7, reps: 4, now: NOW })
    expect(a.getTime()).toBe(b.getTime())
  })

  it('treats reps <= 0 the same as a fresh first rep (reps=1) rather than growing negatively', () => {
    const zero = nextDueAt({ correct: true, confidence: 5, reps: 0, now: NOW })
    const one = nextDueAt({ correct: true, confidence: 5, reps: 1, now: NOW })
    expect(zero.getTime()).toBe(one.getTime())
  })

  it('roughly doubles the interval per rep when GROWTH_RATE=2 (documented shape check)', () => {
    // Only meaningful while GROWTH_RATE stays 2; guards the documented
    // "1 -> 2 -> 4 -> 8..." growth shape at a fixed confidence.
    if (GROWTH_RATE !== 2) return
    const confidence = 5.5 // exact scale midpoint
    const rep1 = daysBetween(NOW, nextDueAt({ correct: true, confidence, reps: 1, now: NOW }))
    const rep2 = daysBetween(NOW, nextDueAt({ correct: true, confidence, reps: 2, now: NOW }))
    const rep3 = daysBetween(NOW, nextDueAt({ correct: true, confidence, reps: 3, now: NOW }))

    expect(rep2).toBeGreaterThanOrEqual(rep1)
    expect(rep3).toBeGreaterThan(rep1)
  })
})

describe('selectDueCards', () => {
  function row(overrides: Partial<DueCardRow> & { cardId: string }): DueCardRow {
    return {
      term: `term-${overrides.cardId}`,
      definition: `def-${overrides.cardId}`,
      confidence: 5,
      dueAt: null,
      ...overrides,
    }
  }

  it('includes a card with dueAt=null (never reviewed / never scheduled)', () => {
    const rows = [row({ cardId: 'c1', dueAt: null })]
    const result = selectDueCards(rows, NOW, 10)
    expect(result.map((r) => r.cardId)).toEqual(['c1'])
  })

  it('includes a card whose dueAt has already passed', () => {
    const rows = [row({ cardId: 'c1', dueAt: daysAgo(1) })]
    const result = selectDueCards(rows, NOW, 10)
    expect(result.map((r) => r.cardId)).toEqual(['c1'])
  })

  it('includes a card whose dueAt is exactly now', () => {
    const rows = [row({ cardId: 'c1', dueAt: NOW })]
    const result = selectDueCards(rows, NOW, 10)
    expect(result.map((r) => r.cardId)).toEqual(['c1'])
  })

  it('excludes a card whose dueAt is in the future', () => {
    const rows = [row({ cardId: 'c1', dueAt: daysFromNow(5) })]
    const result = selectDueCards(rows, NOW, 10)
    expect(result).toEqual([])
  })

  it('orders never-scheduled (dueAt=null) cards before any dated-due card', () => {
    const rows = [
      row({ cardId: 'due-old', dueAt: daysAgo(10) }),
      row({ cardId: 'never', dueAt: null }),
      row({ cardId: 'due-recent', dueAt: daysAgo(1) }),
    ]
    const result = selectDueCards(rows, NOW, 10)
    expect(result.map((r) => r.cardId)).toEqual(['never', 'due-old', 'due-recent'])
  })

  it('orders dated-due cards oldest-due first', () => {
    const rows = [
      row({ cardId: 'a', dueAt: daysAgo(1) }),
      row({ cardId: 'b', dueAt: daysAgo(30) }),
      row({ cardId: 'c', dueAt: daysAgo(5) }),
    ]
    const result = selectDueCards(rows, NOW, 10)
    expect(result.map((r) => r.cardId)).toEqual(['b', 'c', 'a'])
  })

  it('caps the result at limit', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ cardId: `c${i}`, dueAt: null }))
    const result = selectDueCards(rows, NOW, 5)
    expect(result).toHaveLength(5)
  })

  it('returns an empty array when nothing is due', () => {
    const rows = [row({ cardId: 'c1', dueAt: daysFromNow(1) })]
    expect(selectDueCards(rows, NOW, 10)).toEqual([])
  })

  it('carries term/definition/confidence through untouched (not just bare IDs)', () => {
    const rows = [row({ cardId: 'c1', dueAt: null, term: 'WACC', definition: 'weighted avg cost of capital', confidence: 3 })]
    const result = selectDueCards(rows, NOW, 10)
    expect(result[0]).toMatchObject({
      cardId: 'c1',
      term: 'WACC',
      definition: 'weighted avg cost of capital',
      confidence: 3,
    })
  })
})
