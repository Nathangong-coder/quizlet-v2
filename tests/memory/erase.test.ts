import { describe, it, expect } from 'vitest'
import {
  planErasure,
  type ErasureSnapshot,
  type ErasureScope,
} from '@/lib/memory/erase'

/**
 * One fixture graph shared by every scope test.
 *
 *  attempt att1 (session s1) — answers a1 (card c1, klp k1), a2 (card c2, klp k2)
 *  attempt att2 (session s2) — answer  a3 (card c1, klp k1)
 *  events: e1->a1, e2->a2, e3->a3, e4 = a standalone review of c1
 */
const snapshot = (): ErasureSnapshot => ({
  answers: [
    { id: 'a1', attemptId: 'att1', cardId: 'c1', klpIds: ['k1'], score: 100 },
    { id: 'a2', attemptId: 'att1', cardId: 'c2', klpIds: ['k2'], score: 0 },
    { id: 'a3', attemptId: 'att2', cardId: 'c1', klpIds: ['k1'], score: 50 },
  ],
  events: [
    { id: 'e1', cardId: 'c1', quizAnswerId: 'a1', source: 'quiz-mc' },
    { id: 'e2', cardId: 'c2', quizAnswerId: 'a2', source: 'quiz-mc' },
    { id: 'e3', cardId: 'c1', quizAnswerId: 'a3', source: 'quiz-sa' },
    { id: 'e4', cardId: 'c1', quizAnswerId: null, source: 'review' },
  ],
  attempts: [
    { id: 'att1', sessionId: 's1', answers: [{ id: 'a1', score: 100 }, { id: 'a2', score: 0 }] },
    { id: 'att2', sessionId: 's2', answers: [{ id: 'a3', score: 50 }] },
  ],
})

const plan = (scope: ErasureScope) => planErasure(snapshot(), scope)

describe('planErasure — answer scope', () => {
  it('deletes the answer and replays its card and KLPs', () => {
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.deleteAnswerIds).toEqual(['a1'])
    expect(p.replayCardIds).toEqual(['c1'])
    expect(p.replayKlpIds).toEqual(['k1'])
  })

  it('does not list the cascaded event — the database removes it', () => {
    // Listing it would be harmless but misleading: it implies application code
    // is responsible for a deletion the FK already guarantees.
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.deleteEventIds).toEqual([])
  })

  it('recomputes the surviving attempt score and item count', () => {
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.updateAttempts).toEqual([
      { attemptId: 'att1', sessionId: 's1', score: 0, itemCount: 1 },
    ])
    expect(p.deleteAttemptIds).toEqual([])
  })

  it('deletes the attempt and its session when its last answer goes', () => {
    // Otherwise the activity feed shows a ghost quiz with nothing in it.
    const p = plan({ kind: 'answer', answerId: 'a3' })
    expect(p.deleteAttemptIds).toEqual(['att2'])
    expect(p.deleteSessionIds).toEqual(['s2'])
    expect(p.updateAttempts).toEqual([])
  })

  it('rounds the recomputed score, because QuizAttempt.score is an Int column', () => {
    // overallQuizScore returns a float mean. Writing that straight into an Int
    // column throws at the database, which no pure test would catch.
    const snap = snapshot()
    snap.answers.push({ id: 'a4', attemptId: 'att1', cardId: 'c3', klpIds: [], score: 67 })
    snap.attempts[0].answers.push({ id: 'a4', score: 67 })

    const p = planErasure(snap, { kind: 'answer', answerId: 'a1' })
    // survivors are a2 (0) and a4 (67) -> mean 33.5 -> 34
    expect(p.updateAttempts[0].score).toBe(34)
    expect(Number.isInteger(p.updateAttempts[0].score)).toBe(true)
  })
})

describe('planErasure — event scope', () => {
  it('routes a quiz-sourced event to its answer', () => {
    // The FK cascade runs answer -> event only. Without this routing, deleting
    // a quiz entry from the memory feed would leave its graded answer and KLP
    // evidence standing.
    const p = plan({ kind: 'event', eventId: 'e1' })
    expect(p.deleteAnswerIds).toEqual(['a1'])
    expect(p.replayKlpIds).toEqual(['k1'])
  })

  it('deletes a standalone review event without touching any answer', () => {
    const p = plan({ kind: 'event', eventId: 'e4' })
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.deleteAnswerIds).toEqual([])
    expect(p.replayCardIds).toEqual(['c1'])
    expect(p.replayKlpIds).toEqual([])
  })
})

describe('planErasure — attempt scope', () => {
  it('deletes the attempt, its session, and replays every card and KLP', () => {
    const p = plan({ kind: 'attempt', attemptId: 'att1' })
    expect(p.deleteAttemptIds).toEqual(['att1'])
    expect(p.deleteSessionIds).toEqual(['s1'])
    expect(p.replayCardIds.sort()).toEqual(['c1', 'c2'])
    expect(p.replayKlpIds.sort()).toEqual(['k1', 'k2'])
    expect(p.updateAttempts).toEqual([])
  })
})

describe('planErasure — card scope', () => {
  it('deletes every answer and event for the card and replays its KLPs', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteAnswerIds.sort()).toEqual(['a1', 'a3'])
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.replayKlpIds).toEqual(['k1'])
  })

  it('clears the legacy ConfidenceEvent rows for that card', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteConfidenceEventCardIds).toEqual(['c1'])
  })

  it('leaves the sibling card untouched', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteAnswerIds).not.toContain('a2')
    expect(p.replayKlpIds).not.toContain('k2')
  })
})

describe('planErasure — set scope', () => {
  it('deletes every answer, event, attempt and session in the snapshot', () => {
    // The snapshot loader has already narrowed to the set, so the set scope
    // erases everything it was handed.
    const p = plan({ kind: 'set', setId: 'set1' })
    expect(p.deleteAnswerIds.sort()).toEqual(['a1', 'a2', 'a3'])
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.deleteAttemptIds.sort()).toEqual(['att1', 'att2'])
    expect(p.deleteSessionIds.sort()).toEqual(['s1', 's2'])
    expect(p.replayCardIds.sort()).toEqual(['c1', 'c2'])
    expect(p.deleteConfidenceEventCardIds.sort()).toEqual(['c1', 'c2'])
  })
})

describe('the B3 regression guard', () => {
  // resetUserMemory once cleared KLP evidence and left the posterior standing,
  // permanently and beyond the backfill's reach. Any scope that can delete an
  // AnswerKlpResult must replay the KLPs those rows credited. This makes a
  // repeat a build failure rather than silent corruption.
  const scopes: ErasureScope[] = [
    { kind: 'answer', answerId: 'a1' },
    { kind: 'event', eventId: 'e1' },
    { kind: 'attempt', attemptId: 'att1' },
    { kind: 'card', cardId: 'c1' },
    { kind: 'set', setId: 'set1' },
  ]

  it.each(scopes)('replays a KLP for every deleted answer (%o)', (scope) => {
    const snap = snapshot()
    const p = planErasure(snap, scope)
    const expectedKlps = new Set(
      snap.answers.filter((a) => p.deleteAnswerIds.includes(a.id)).flatMap((a) => a.klpIds),
    )
    for (const klpId of expectedKlps) {
      expect(p.replayKlpIds).toContain(klpId)
    }
  })

  it.each(scopes)('replays a card for every deleted answer or event (%o)', (scope) => {
    const snap = snapshot()
    const p = planErasure(snap, scope)
    const expectedCards = new Set([
      ...snap.answers.filter((a) => p.deleteAnswerIds.includes(a.id)).map((a) => a.cardId),
      ...snap.events.filter((e) => p.deleteEventIds.includes(e.id)).map((e) => e.cardId),
    ])
    for (const cardId of expectedCards) {
      expect(p.replayCardIds).toContain(cardId)
    }
  })
})
