import { describe, it, expect } from 'vitest'
import {
  initReviewSession,
  currentCard,
  answerCard,
  isReviewComplete,
  progressStats,
} from '@/lib/review/session'
import type { ReviewCard } from '@/lib/review/session'

const CARDS: ReviewCard[] = [
  { id: 'c1', term: 'P/E Ratio', definition: 'Price / EPS', confidence: 5 },
  { id: 'c2', term: 'EBITDA', definition: 'Earnings before interest...', confidence: 7 },
  { id: 'c3', term: 'DCF', definition: 'Discounted cash flow', confidence: 3 },
]

describe('initReviewSession', () => {
  it('puts all cards in queue', () => {
    const s = initReviewSession(CARDS)
    expect(s.queue).toHaveLength(3)
    expect(s.completed).toHaveLength(0)
    expect(s.requeuedHighConf).toHaveLength(0)
  })
})

describe('currentCard', () => {
  it('returns first card in queue', () => {
    const s = initReviewSession(CARDS)
    expect(currentCard(s)).toEqual(CARDS[0])
  })

  it('returns null when queue is empty', () => {
    expect(currentCard(initReviewSession([]))).toBeNull()
  })
})

describe('answerCard — knew: true', () => {
  it('removes card from queue and adds to completed', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', true)
    expect(next.queue.find((c) => c.id === 'c1')).toBeUndefined()
    expect(next.completed).toContain('c1')
  })

  it('does not touch remaining cards', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', true)
    expect(next.queue).toHaveLength(2)
  })
})

describe('answerCard — knew: false, confidence ≤ 5', () => {
  it('moves card to end of queue', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', false)
    expect(next.queue[next.queue.length - 1].id).toBe('c1')
    expect(next.completed).not.toContain('c1')
  })

  it('decrements confidence by 1', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', false)
    expect(next.queue.find((c) => c.id === 'c1')!.confidence).toBe(4)
  })

  it('clamps confidence at 1', () => {
    const card: ReviewCard = { id: 'x', term: 'T', definition: 'D', confidence: 1 }
    const s = initReviewSession([card])
    const next = answerCard(s, 'x', false)
    expect(next.queue[0].confidence).toBe(1)
  })

  it('does not add to requeuedHighConf', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', false)
    expect(next.requeuedHighConf).not.toContain('c1')
  })

  it('allows indefinite re-queuing', () => {
    const card: ReviewCard = { id: 'lc', term: 'T', definition: 'D', confidence: 3 }
    let s = initReviewSession([card])
    s = answerCard(s, 'lc', false)
    s = answerCard(s, 'lc', false)
    s = answerCard(s, 'lc', false)
    expect(s.queue).toHaveLength(1)
    expect(s.completed).not.toContain('lc')
  })
})

describe('answerCard — knew: false, confidence > 5', () => {
  it('re-queues card and records it in requeuedHighConf', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c2', false)
    expect(next.queue[next.queue.length - 1].id).toBe('c2')
    expect(next.requeuedHighConf).toContain('c2')
  })

  it('retires card on second don-know (already requeued)', () => {
    const s = initReviewSession(CARDS)
    let next = answerCard(s, 'c2', false)
    expect(next.requeuedHighConf).toContain('c2')
    next = answerCard(next, 'c2', false)
    expect(next.completed).toContain('c2')
    expect(next.queue.find((c) => c.id === 'c2')).toBeUndefined()
  })
})

describe('isReviewComplete', () => {
  it('returns false for a new session', () => {
    expect(isReviewComplete(initReviewSession(CARDS))).toBe(false)
  })

  it('returns true when queue is empty', () => {
    let s = initReviewSession(CARDS)
    for (const card of CARDS) {
      s = answerCard(s, card.id, true)
    }
    expect(isReviewComplete(s)).toBe(true)
  })
})

describe('progressStats', () => {
  it('total stays constant as cards are answered', () => {
    let s = initReviewSession(CARDS)
    expect(progressStats(s).total).toBe(3)
    s = answerCard(s, 'c1', true)
    expect(progressStats(s).total).toBe(3)
    s = answerCard(s, 'c2', false)
    expect(progressStats(s).total).toBe(3)
  })

  it('reports completed and remaining', () => {
    let s = initReviewSession(CARDS)
    s = answerCard(s, 'c1', true)
    const stats = progressStats(s)
    expect(stats.completed).toBe(1)
    expect(stats.remaining).toBe(2)
  })
})
