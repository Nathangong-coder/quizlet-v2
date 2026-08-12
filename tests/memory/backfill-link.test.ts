import { describe, it, expect } from 'vitest'
import { pairStudyEventsToAnswers } from '@/lib/memory/link-backfill'

const t = (mins: number) => new Date(new Date('2026-08-01T00:00:00Z').getTime() + mins * 60_000)

describe('pairStudyEventsToAnswers', () => {
  it('links an event to the answer sharing its card, session and mode', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(0) }],
      [{ id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) }],
    )
    expect(pairs).toEqual([{ eventId: 'e1', quizAnswerId: 'a1' }])
  })

  it('links nothing when two candidates are indistinguishable', () => {
    // A wrong link deletes the wrong memory row later, which is worse than an
    // unlinked legacy row. Ambiguity must produce silence, not a guess.
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(0) }],
      [
        { id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) },
        { id: 'a2', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) },
      ],
    )
    expect(pairs).toEqual([])
  })

  it('does not link across sessions', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(0) }],
      [{ id: 'a1', cardId: 'c1', sessionId: 's2', mode: 'multiple-choice', createdAt: t(0) }],
    )
    expect(pairs).toEqual([])
  })

  it('ignores non-quiz sources, which have no answer', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'review', createdAt: t(0) }],
      [{ id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) }],
    )
    expect(pairs).toEqual([])
  })

  it('picks the nearest answer in time when several are distinguishable', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(10) }],
      [
        { id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) },
        { id: 'a2', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(9) },
      ],
    )
    expect(pairs).toEqual([{ eventId: 'e1', quizAnswerId: 'a2' }])
  })
})
