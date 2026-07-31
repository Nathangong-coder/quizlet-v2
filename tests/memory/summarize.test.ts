import { describe, it, expect } from 'vitest'
import { summarizeSession, type SessionItem } from '../../src/lib/memory/summarize'

const item = (over: Partial<SessionItem> = {}): SessionItem => ({
  cardId: 'c1',
  term: 'WACC',
  source: 'quiz-mc',
  correct: true,
  score: null,
  confidenceBefore: 5,
  confidenceAfter: 6,
  latencyMs: 1000,
  categoryNames: ['Valuation'],
  ...over,
})

describe('summarizeSession', () => {
  it('returns an empty-but-valid shape for a session with no items', () => {
    const result = summarizeSession([])
    expect(result.itemCount).toBe(0)
    expect(result.byCategory).toEqual([])
    expect(result.byMode).toEqual([])
    expect(result.pacing.medianLatencyMs).toBeNull()
    expect(result.pacing.fastest).toBeNull()
    expect(result.confidence.avgDelta).toBeNull()
    expect(result.outliers.rushed).toEqual([])
    expect(result.outliers.laboured).toEqual([])
  })

  it('counts accuracy per category', () => {
    const result = summarizeSession([
      item({ cardId: 'a', categoryNames: ['Valuation'], correct: true }),
      item({ cardId: 'b', categoryNames: ['Valuation'], correct: false }),
      item({ cardId: 'c', categoryNames: ['Accounting'], correct: true }),
    ])

    expect(result.byCategory).toEqual([
      { name: 'Accounting', correct: 1, total: 1, accuracyPct: 100 },
      { name: 'Valuation', correct: 1, total: 2, accuracyPct: 50 },
    ])
  })

  it('counts a multi-category card under each of its categories', () => {
    const result = summarizeSession([
      item({ categoryNames: ['Valuation', 'Vocabulary'], correct: true }),
    ])
    expect(result.byCategory.map((c) => c.name)).toEqual(['Valuation', 'Vocabulary'])
  })

  it('buckets uncategorized cards explicitly', () => {
    const result = summarizeSession([item({ categoryNames: [] })])
    expect(result.byCategory).toEqual([
      { name: 'Uncategorized', correct: 1, total: 1, accuracyPct: 100 },
    ])
  })

  it('reports per-mode accuracy, average score, and median latency', () => {
    const result = summarizeSession([
      item({ source: 'quiz-sa', correct: true, score: 90, latencyMs: 1000 }),
      item({ source: 'quiz-sa', correct: false, score: 40, latencyMs: 3000 }),
      item({ source: 'quiz-mc', correct: true, score: null, latencyMs: 500 }),
    ])

    const sa = result.byMode.find((m) => m.mode === 'quiz-sa')!
    expect(sa).toEqual({
      mode: 'quiz-sa',
      correct: 1,
      total: 2,
      avgScore: 65,
      medianLatencyMs: 2000,
    })

    const mc = result.byMode.find((m) => m.mode === 'quiz-mc')!
    expect(mc.avgScore).toBeNull()
  })

  it('takes the median of an odd-length series and the mean of the middle two on even', () => {
    const odd = summarizeSession([
      item({ latencyMs: 100 }),
      item({ latencyMs: 900 }),
      item({ latencyMs: 200 }),
    ])
    expect(odd.pacing.medianLatencyMs).toBe(200)

    const even = summarizeSession([item({ latencyMs: 100 }), item({ latencyMs: 400 })])
    expect(even.pacing.medianLatencyMs).toBe(250)
  })

  it('ignores unknown latencies entirely rather than treating them as zero', () => {
    const result = summarizeSession([
      item({ latencyMs: null }),
      item({ latencyMs: 400 }),
      item({ latencyMs: null }),
    ])
    expect(result.pacing.medianLatencyMs).toBe(400)
  })

  it('names the fastest and slowest timed items', () => {
    const result = summarizeSession([
      item({ cardId: 'slow', term: 'Deferred tax', latencyMs: 9000 }),
      item({ cardId: 'fast', term: 'EBITDA', latencyMs: 300 }),
      item({ cardId: 'untimed', term: 'Beta', latencyMs: null }),
    ])

    expect(result.pacing.fastest).toEqual({ cardId: 'fast', term: 'EBITDA', latencyMs: 300 })
    expect(result.pacing.slowest).toEqual({
      cardId: 'slow',
      term: 'Deferred tax',
      latencyMs: 9000,
    })
  })
})

describe('summarizeSession confidence and outliers', () => {
  it('averages the confidence delta across items', () => {
    const result = summarizeSession([
      item({ confidenceBefore: 5, confidenceAfter: 6 }),
      item({ confidenceBefore: 5, confidenceAfter: 3 }),
    ])
    expect(result.confidence.avgDelta).toBe(-0.5)
  })

  it('ignores items with no recorded before-value', () => {
    // Events written before confidenceBefore existed carry null; averaging
    // them in as a zero delta would understate real movement.
    const result = summarizeSession([
      item({ confidenceBefore: null, confidenceAfter: 9 }),
      item({ confidenceBefore: 4, confidenceAfter: 6 }),
    ])
    expect(result.confidence.avgDelta).toBe(2)
  })

  it('returns a null delta when nothing is measurable', () => {
    const result = summarizeSession([item({ confidenceBefore: null, confidenceAfter: 5 })])
    expect(result.confidence.avgDelta).toBeNull()
  })

  it('names cards that crossed into mastery and cards that slipped', () => {
    const result = summarizeSession([
      item({ cardId: 'up', term: 'EBITDA', confidenceBefore: 7, confidenceAfter: 8 }),
      item({ cardId: 'down', term: 'WACC', confidenceBefore: 6, confidenceAfter: 5 }),
      item({ cardId: 'flat', term: 'Beta', confidenceBefore: 5, confidenceAfter: 5 }),
    ])

    expect(result.confidence.newlyMastered).toEqual([{ cardId: 'up', term: 'EBITDA' }])
    expect(result.confidence.dropped).toEqual([{ cardId: 'down', term: 'WACC' }])
  })

  it('does not re-report an already-mastered card as newly mastered', () => {
    const result = summarizeSession([
      item({ confidenceBefore: 9, confidenceAfter: 10 }),
    ])
    expect(result.confidence.newlyMastered).toEqual([])
  })

  it('flags wrong-and-fast as rushed and wrong-and-slow as laboured', () => {
    // Median latency across the five items is 1000ms.
    const result = summarizeSession([
      item({ cardId: 'a', latencyMs: 1000, correct: true }),
      item({ cardId: 'b', latencyMs: 1000, correct: true }),
      item({ cardId: 'c', latencyMs: 1000, correct: true }),
      item({ cardId: 'rush', term: 'WACC', latencyMs: 200, correct: false }),
      item({ cardId: 'slog', term: 'DCF', latencyMs: 5000, correct: false }),
    ])

    expect(result.outliers.rushed).toEqual([
      { cardId: 'rush', term: 'WACC', latencyMs: 200 },
    ])
    expect(result.outliers.laboured).toEqual([
      { cardId: 'slog', term: 'DCF', latencyMs: 5000 },
    ])
  })

  it('never flags a correct answer as an outlier however fast it was', () => {
    const result = summarizeSession([
      item({ latencyMs: 1000, correct: false }),
      item({ latencyMs: 1000, correct: false }),
      item({ cardId: 'quick', latencyMs: 10, correct: true }),
    ])
    expect(result.outliers.rushed).toEqual([])
  })

  it('reports no outliers when nothing was timed', () => {
    const result = summarizeSession([item({ latencyMs: null, correct: false })])
    expect(result.outliers.rushed).toEqual([])
    expect(result.outliers.laboured).toEqual([])
  })
})
