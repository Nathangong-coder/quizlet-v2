import { describe, it, expect } from 'vitest'
import { selectReviewCards, setupCounts, sideFor, matchesSetup, DEFAULT_REVIEW_SETUP, type ReviewCardInput } from '@/lib/review/setup'
import { initReviewSession, answerCard, summarizeReview } from '@/lib/review/session'

const NOW = 1_000_000
const cards: ReviewCardInput[] = [
  { id: 'a', term: 'A', definition: 'a', confidence: 8, starred: true, dueAt: NOW + 1000, categoryIds: ['x'] },
  { id: 'b', term: 'B', definition: 'b', confidence: 3, starred: false, dueAt: null, categoryIds: ['y'] },
  { id: 'c', term: 'C', definition: 'c', confidence: 4, starred: true, dueAt: NOW - 1, categoryIds: [] },
  { id: 'd', term: 'D', definition: 'd', confidence: 6, starred: false, dueAt: NOW, categoryIds: ['x', 'y'] },
]

describe('review setup', () => {
  it('filters by star, due (null is due now), weak (≤ 4) and category, in combination', () => {
    const ids = (patch: Partial<typeof DEFAULT_REVIEW_SETUP>) => selectReviewCards(cards, { ...DEFAULT_REVIEW_SETUP, ...patch }, NOW).map((c) => c.id)
    expect(ids({})).toEqual(['a', 'b', 'c', 'd'])
    expect(ids({ starredOnly: true })).toEqual(['a', 'c'])
    expect(ids({ dueOnly: true })).toEqual(['b', 'c', 'd'])
    expect(ids({ weakOnly: true })).toEqual(['b', 'c'])
    expect(ids({ categoryIds: ['x'] })).toEqual(['a', 'd'])
    expect(ids({ starredOnly: true, weakOnly: true })).toEqual(['c'])
    expect(matchesSetup(cards[0], { ...DEFAULT_REVIEW_SETUP, dueOnly: true }, NOW)).toBe(false)
  })

  it('orders: set order, a seeded shuffle, weakest first', () => {
    expect(selectReviewCards(cards, { ...DEFAULT_REVIEW_SETUP, order: 'weakest' }, NOW).map((c) => c.id)).toEqual(['b', 'c', 'd', 'a'])
    const s1 = selectReviewCards(cards, { ...DEFAULT_REVIEW_SETUP, order: 'shuffle' }, NOW, 7).map((c) => c.id)
    expect(s1).toEqual(selectReviewCards(cards, { ...DEFAULT_REVIEW_SETUP, order: 'shuffle' }, NOW, 7).map((c) => c.id))
    expect([...s1].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('facet counts drop their own filter', () => {
    const counts = setupCounts(cards, { ...DEFAULT_REVIEW_SETUP, starredOnly: true }, NOW)
    // "starred" is counted with starredOnly already on: 2; due/weak are counted UNDER the star filter.
    expect(counts).toEqual({ all: 2, starred: 2, due: 1, weak: 1 })
  })

  it('mixed alternates the first side by position', () => {
    expect([0, 1, 2].map((i) => sideFor({ ...DEFAULT_REVIEW_SETUP, side: 'mixed' }, i))).toEqual(['term', 'definition', 'term'])
    expect(sideFor({ ...DEFAULT_REVIEW_SETUP, side: 'definition' }, 0)).toBe('definition')
  })
})

describe('review summary', () => {
  it('counts first-time knows, misses, and confidence movement', () => {
    let s = initReviewSession(cards)
    s = answerCard(s, 'a', true) // 8 → 9
    s = answerCard(s, 'b', false) // 3 → 2, requeued
    s = answerCard(s, 'c', true) // 4 → 5
    s = answerCard(s, 'd', false) // 6 → 5, requeued (high conf: one more look)
    s = answerCard(s, 'b', true) // 2 → 3
    s = answerCard(s, 'd', false) // 5 → 4, retired
    const sum = summarizeReview(s)
    // b went 3 → 2 → 3 (no net change); d went 6 → 5 → 4 (down).
    expect(sum).toEqual({ total: 4, knownFirstTime: 2, missed: 2, up: 2, down: 1, missedIds: ['b', 'd'] })
    expect(s.outcomes?.b).toEqual({ firstKnew: false, attempts: 2, startConfidence: 3, endConfidence: 3 })
    expect(s.outcomes?.d).toEqual({ firstKnew: false, attempts: 2, startConfidence: 6, endConfidence: 4 })
  })
})
