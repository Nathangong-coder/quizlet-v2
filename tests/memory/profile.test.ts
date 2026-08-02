import { describe, it, expect } from 'vitest'
import { shapeLearnerProfile, classifyTrend } from '@/lib/memory/profile'
import type { ProgressRow, EventRow } from '@/lib/memory/profile'

const NOW = new Date('2026-07-24T12:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

function progress(overrides: Partial<ProgressRow> & { cardId: string; term: string }): ProgressRow {
  return {
    confidence: 5,
    mastery: null,
    starred: false,
    dueAt: null,
    ...overrides,
  }
}

function event(overrides: Partial<EventRow> & { cardId: string }): EventRow {
  return {
    source: 'quiz-mc',
    correct: null,
    score: null,
    confidenceAfter: 5,
    createdAt: NOW,
    ...overrides,
  }
}

describe('empty-history default', () => {
  it('returns a fully-empty, non-crashing profile for a brand-new user (no progress, no events)', () => {
    const result = shapeLearnerProfile({ progress: [], events: [], now: NOW })

    expect(result).toEqual({
      setId: null,
      setTitle: null,
      weak: [],
      fading: [],
      strong: [],
      starred: [],
      recent: {
        byMode: [],
        graded: [],
        streakDays: 0,
      },
    })
  })

  it('carries setId/setTitle through untouched when provided', () => {
    const result = shapeLearnerProfile({
      setId: 'set-1',
      setTitle: 'M&A Basics',
      progress: [],
      events: [],
      now: NOW,
    })

    expect(result.setId).toBe('set-1')
    expect(result.setTitle).toBe('M&A Basics')
  })
})

describe('classifyTrend', () => {
  it('is flat when there are fewer than 2 scorable events', () => {
    expect(classifyTrend([])).toBe('flat')
    expect(classifyTrend([event({ cardId: 'c1', correct: true, createdAt: daysAgo(1) })])).toBe(
      'flat',
    )
  })

  it('classifies improving when the recent half scores higher than the earlier half', () => {
    const events: EventRow[] = [
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(3) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(1) }),
    ]
    expect(classifyTrend(events)).toBe('improving')
  })

  it('classifies declining when the recent half scores lower than the earlier half', () => {
    const events: EventRow[] = [
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(3) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(1) }),
    ]
    expect(classifyTrend(events)).toBe('declining')
  })

  it('classifies flat when there is no meaningful swing', () => {
    const events: EventRow[] = [
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(3) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(1) }),
    ]
    expect(classifyTrend(events)).toBe('flat')
  })

  it('only looks at the most recent TREND_WINDOW events (order-independent input)', () => {
    // A long-ago decline shouldn't matter if the recent window is all correct.
    const oldDecline: EventRow[] = Array.from({ length: 20 }, (_, i) =>
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(100 + i) }),
    )
    const recentAllCorrect: EventRow[] = Array.from({ length: 5 }, (_, i) =>
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(i) }),
    )
    expect(classifyTrend([...oldDecline, ...recentAllCorrect])).toBe('flat')
  })
})

describe('weak bucket', () => {
  it('selects cards with confidence <= 4, sorted weakest-first, with per-card trend', () => {
    const p: ProgressRow[] = [
      progress({ cardId: 'c1', term: 'accretion/dilution', confidence: 2 }),
      progress({ cardId: 'c2', term: 'synergies', confidence: 3 }),
      progress({ cardId: 'c3', term: 'EBITDA', confidence: 9 }), // not weak
    ]
    const e: EventRow[] = [
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(3) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })

    expect(result.weak).toEqual([
      { term: 'accretion/dilution', confidence: 2, mastery: null, trend: 'declining' },
      { term: 'synergies', confidence: 3, mastery: null, trend: 'flat' },
    ])
  })

  it('surfaces every qualifying card, uncapped', () => {
    const p: ProgressRow[] = Array.from({ length: 100 }, (_, i) =>
      progress({ cardId: `c${i}`, term: `term-${i}`, confidence: 1 }),
    )

    const result = shapeLearnerProfile({ progress: p, events: [], now: NOW })

    expect(result.weak).toHaveLength(100)
  })
})

describe('strong bucket', () => {
  it('selects cards with confidence >= 8, sorted strongest-first, uncapped', () => {
    const p: ProgressRow[] = Array.from({ length: 20 }, (_, i) =>
      progress({ cardId: `c${i}`, term: `term-${i}`, confidence: 8 + (i % 3) }),
    )

    const result = shapeLearnerProfile({ progress: p, events: [], now: NOW })

    expect(result.strong).toHaveLength(20)
    // strongest-first
    for (let i = 1; i < result.strong.length; i++) {
      expect(result.strong[i - 1].confidence).toBeGreaterThanOrEqual(result.strong[i].confidence)
    }
  })
})

describe('starred bucket', () => {
  it('selects starred cards, uncapped', () => {
    const p: ProgressRow[] = Array.from({ length: 20 }, (_, i) =>
      progress({ cardId: `c${i}`, term: `term-${i}`, confidence: 5, starred: true }),
    )

    const result = shapeLearnerProfile({ progress: p, events: [], now: NOW })

    expect(result.starred).toHaveLength(20)
  })

  it('excludes non-starred cards', () => {
    const p: ProgressRow[] = [progress({ cardId: 'c1', term: 'IRR', confidence: 5, starred: false })]
    const result = shapeLearnerProfile({ progress: p, events: [], now: NOW })
    expect(result.starred).toEqual([])
  })
})

describe('fading bucket (due + slipping) — synthetic dueAt fixtures', () => {
  it('includes a card whose dueAt has passed AND whose trend is declining', () => {
    const p: ProgressRow[] = [
      progress({ cardId: 'c1', term: 'WACC', confidence: 6, dueAt: daysAgo(1) }),
    ]
    const e: EventRow[] = [
      event({ cardId: 'c1', correct: true, confidenceAfter: 7, createdAt: daysAgo(6) }),
      event({ cardId: 'c1', correct: true, confidenceAfter: 7, createdAt: daysAgo(5) }),
      event({ cardId: 'c1', correct: false, confidenceAfter: 6, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: false, confidenceAfter: 6, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })

    expect(result.fading).toEqual([{ term: 'WACC', wasConfidence: 7, missCount: 2 }])
  })

  it('excludes a card whose dueAt has passed but is not declining', () => {
    const p: ProgressRow[] = [
      progress({ cardId: 'c1', term: 'IRR', confidence: 8, dueAt: daysAgo(1) }),
    ]
    const e: EventRow[] = [
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(3) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })
    expect(result.fading).toEqual([])
  })

  it('excludes a card that is declining but not yet due (dueAt in the future)', () => {
    const p: ProgressRow[] = [
      progress({ cardId: 'c1', term: 'NPV', confidence: 4, dueAt: daysAgo(-5) }),
    ]
    const e: EventRow[] = [
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(3) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(2) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })
    expect(result.fading).toEqual([])
  })

  it('defaults to empty when dueAt is null for every card (today\'s production reality, pre-Task-4)', () => {
    const p: ProgressRow[] = [
      progress({ cardId: 'c1', term: 'WACC', confidence: 6, dueAt: null }),
    ]
    const e: EventRow[] = [
      event({ cardId: 'c1', correct: true, createdAt: daysAgo(4) }),
      event({ cardId: 'c1', correct: false, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })
    expect(result.fading).toEqual([])
  })

  it('surfaces every fading card, uncapped', () => {
    const p: ProgressRow[] = Array.from({ length: 20 }, (_, i) =>
      progress({ cardId: `c${i}`, term: `term-${i}`, confidence: 5, dueAt: daysAgo(1) }),
    )
    const e: EventRow[] = p.flatMap((row) => [
      event({ cardId: row.cardId, correct: true, createdAt: daysAgo(4) }),
      event({ cardId: row.cardId, correct: true, createdAt: daysAgo(3) }),
      event({ cardId: row.cardId, correct: false, createdAt: daysAgo(2) }),
      event({ cardId: row.cardId, correct: false, createdAt: daysAgo(1) }),
    ])

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })
    expect(result.fading).toHaveLength(20)
  })
})

describe('recent accuracy by mode', () => {
  it('computes per-mode accuracy percentage for binary modes', () => {
    const e: EventRow[] = [
      event({ cardId: 'c1', source: 'quiz-mc', correct: true, createdAt: daysAgo(1) }),
      event({ cardId: 'c1', source: 'quiz-mc', correct: true, createdAt: daysAgo(1) }),
      event({ cardId: 'c1', source: 'quiz-mc', correct: true, createdAt: daysAgo(1) }),
      event({ cardId: 'c1', source: 'quiz-mc', correct: false, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: [], events: e, now: NOW })
    expect(result.recent.byMode).toEqual([{ mode: 'quiz-mc', accuracyPct: 75, count: 4 }])
  })

  it('computes average graded score (out of 10) for quiz-sa', () => {
    const e: EventRow[] = [
      event({ cardId: 'c1', source: 'quiz-sa', score: 70, createdAt: daysAgo(1) }),
      event({ cardId: 'c1', source: 'quiz-sa', score: 52, createdAt: daysAgo(1) }),
    ]

    const result = shapeLearnerProfile({ progress: [], events: e, now: NOW })
    expect(result.recent.graded).toEqual([{ mode: 'quiz-sa', avgScoreOutOfTen: 6.1, count: 2 }])
  })

  it('ignores events older than the recent window', () => {
    const e: EventRow[] = [
      event({ cardId: 'c1', source: 'quiz-mc', correct: false, createdAt: daysAgo(90) }),
    ]
    const result = shapeLearnerProfile({ progress: [], events: e, now: NOW })
    expect(result.recent.byMode).toEqual([])
  })
})

describe('streak calculation', () => {
  it('is 0 with no events', () => {
    const result = shapeLearnerProfile({ progress: [], events: [], now: NOW })
    expect(result.recent.streakDays).toBe(0)
  })

  it('counts consecutive active days ending today', () => {
    const e: EventRow[] = [
      event({ cardId: 'c1', createdAt: daysAgo(0) }),
      event({ cardId: 'c1', createdAt: daysAgo(1) }),
      event({ cardId: 'c1', createdAt: daysAgo(2) }),
    ]
    const result = shapeLearnerProfile({ progress: [], events: e, now: NOW })
    expect(result.recent.streakDays).toBe(3)
  })

  it('still counts an active streak that ended yesterday (no activity yet today)', () => {
    const e: EventRow[] = [
      event({ cardId: 'c1', createdAt: daysAgo(1) }),
      event({ cardId: 'c1', createdAt: daysAgo(2) }),
    ]
    const result = shapeLearnerProfile({ progress: [], events: e, now: NOW })
    expect(result.recent.streakDays).toBe(2)
  })

  it('breaks the streak on a gap', () => {
    const e: EventRow[] = [
      event({ cardId: 'c1', createdAt: daysAgo(0) }),
      event({ cardId: 'c1', createdAt: daysAgo(3) }),
    ]
    const result = shapeLearnerProfile({ progress: [], events: e, now: NOW })
    expect(result.recent.streakDays).toBe(1)
  })
})

describe('scales with history length (no bucket caps)', () => {
  it('surfaces every qualifying card when fed 100 synthetic events across many cards', () => {
    const p: ProgressRow[] = Array.from({ length: 100 }, (_, i) =>
      progress({ cardId: `c${i}`, term: `term-${i}`, confidence: (i % 10) + 1 }),
    )
    const e: EventRow[] = Array.from({ length: 100 }, (_, i) =>
      event({
        cardId: `c${i % 100}`,
        source: i % 2 === 0 ? 'quiz-mc' : 'quiz-sa',
        correct: i % 2 === 0 ? i % 3 === 0 : null,
        score: i % 2 === 1 ? 50 + (i % 50) : null,
        createdAt: daysAgo(i % 10),
      }),
    )

    const result = shapeLearnerProfile({ progress: p, events: e, now: NOW })

    // i % 10 + 1 cycles confidence 1..10 across the 100 cards: values <= 4
    // (1,2,3,4) are weak (40 of 100), values >= 8 (8,9,10) are strong (30 of 100).
    expect(result.weak.length).toBe(40)
    expect(result.strong.length).toBe(30)
    // `recent.byMode`/`recent.graded` are bucketed by mode, not by card, so
    // their size is bounded by the number of distinct modes regardless of
    // event volume — that's a real, unrelated bound, not a truncation cap.
    expect(result.recent.byMode.length).toBeLessThanOrEqual(4)
    expect(result.recent.graded.length).toBeLessThanOrEqual(1)
  })
})
