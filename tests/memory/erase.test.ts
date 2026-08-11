import { describe, it, expect } from 'vitest'
import {
  planErasure,
  ERASURE_SCOPE_KINDS,
  type ErasureSnapshot,
  type ErasureScope,
} from '@/lib/memory/erase'

/**
 * One fixture graph shared by every scope test.
 *
 *  attempt att1 (session s1, planned itemCount 2) — answers a1 (card c1, klp
 *    k1), a2 (card c2, klp k2)
 *  attempt att2 (session s2, planned itemCount 2) — answers a3 (card c1, klp
 *    k1), a5 (card c3, klp k3)
 *  events: e1->a1 (session s1), e2->a2 (session s1), e3->a3 (session s2),
 *    e4 = a standalone review of c1 tied to session s3, e5->a5 (session s2)
 *  sessions: s1 (att1), s2 (att2), s3 = a standalone matching/review session
 *    with NO QuizAttempt at all — e4's session, exercising the only path
 *    back to a review/matching session's insight (I-7 gap fix)
 *
 * a5/c3 exists so the attempt-scope replay assertions have a card outside
 * att1's touch-set to prove against — att1 only ever touched c1 and c2,
 * which used to be the entire card universe, so a broken "return every card"
 * implementation could not be told apart from a correct one.
 */
const snapshot = (): ErasureSnapshot => ({
  answers: [
    { id: 'a1', attemptId: 'att1', cardId: 'c1', klpIds: ['k1'], score: 100 },
    { id: 'a2', attemptId: 'att1', cardId: 'c2', klpIds: ['k2'], score: 0 },
    { id: 'a3', attemptId: 'att2', cardId: 'c1', klpIds: ['k1'], score: 50 },
    { id: 'a5', attemptId: 'att2', cardId: 'c3', klpIds: ['k3'], score: 20 },
  ],
  events: [
    { id: 'e1', cardId: 'c1', quizAnswerId: 'a1', source: 'quiz-mc', sessionId: 's1' },
    { id: 'e2', cardId: 'c2', quizAnswerId: 'a2', source: 'quiz-mc', sessionId: 's1' },
    { id: 'e3', cardId: 'c1', quizAnswerId: 'a3', source: 'quiz-sa', sessionId: 's2' },
    { id: 'e4', cardId: 'c1', quizAnswerId: null, source: 'review', sessionId: 's3' },
    { id: 'e5', cardId: 'c3', quizAnswerId: 'a5', source: 'quiz-mc', sessionId: 's2' },
  ],
  attempts: [
    { id: 'att1', sessionId: 's1', answers: [{ id: 'a1', score: 100 }, { id: 'a2', score: 0 }] },
    { id: 'att2', sessionId: 's2', answers: [{ id: 'a3', score: 50 }, { id: 'a5', score: 20 }] },
  ],
  sessions: [
    { id: 's1', itemCount: 2 },
    { id: 's2', itemCount: 2 },
    { id: 's3', itemCount: 5 },
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

  it('recomputes the surviving attempt score and decrements the planned itemCount', () => {
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.updateAttempts).toEqual([
      { attemptId: 'att1', sessionId: 's1', score: 0, itemCount: 1 },
    ])
    expect(p.deleteAttemptIds).toEqual([])
  })

  it('returns an empty-ish plan for an answer id absent from the snapshot', () => {
    const p = plan({ kind: 'answer', answerId: 'ghost' })
    expect(p.deleteAnswerIds).toEqual([])
    expect(p.updateAttempts).toEqual([])
    expect(p.deleteAttemptIds).toEqual([])
  })

  it('rounds the recomputed score, because QuizAttempt.score is an Int column', () => {
    // overallQuizScore returns a float mean. Writing that straight into an Int
    // column throws at the database, which no pure test would catch.
    const snap = snapshot()
    snap.answers.push({ id: 'a4', attemptId: 'att1', cardId: 'c4', klpIds: [], score: 67 })
    snap.attempts[0].answers.push({ id: 'a4', score: 67 })

    const p = planErasure(snap, { kind: 'answer', answerId: 'a1' })
    // survivors are a2 (0) and a4 (67) -> mean 33.5 -> 34
    expect(p.updateAttempts[0].score).toBe(34)
    expect(Number.isInteger(p.updateAttempts[0].score)).toBe(true)
  })
})

describe('planErasure — answer scope, last-answer cascade', () => {
  // Isolated fixture: the shared snapshot's att2 now carries two answers (a3
  // and a5, added so the attempt-scope replay tests have a card outside
  // att1's touch-set — see the shared fixture's comment), so it can no
  // longer demonstrate a *single remaining* answer emptying an attempt when
  // deleted. This fixture is scoped to exactly that one behavior.
  it('deletes the attempt and its session when its last answer goes', () => {
    // Otherwise the activity feed shows a ghost quiz with nothing in it.
    const snap: ErasureSnapshot = {
      answers: [{ id: 'x1', attemptId: 'attX', cardId: 'cX', klpIds: ['kX'], score: 50 }],
      events: [{ id: 'ex1', cardId: 'cX', quizAnswerId: 'x1', source: 'quiz-sa', sessionId: 'sX' }],
      attempts: [{ id: 'attX', sessionId: 'sX', answers: [{ id: 'x1', score: 50 }] }],
      sessions: [{ id: 'sX', itemCount: 1 }],
    }
    const p = planErasure(snap, { kind: 'answer', answerId: 'x1' })
    expect(p.deleteAttemptIds).toEqual(['attX'])
    expect(p.deleteSessionIds).toEqual(['sX'])
    expect(p.updateAttempts).toEqual([])
  })
})

describe('planErasure — itemCount (I-1)', () => {
  it('decrements the stored PLANNED itemCount, never the survivor count', () => {
    // s1.itemCount = 2 is the count StudySession was created with, unrelated
    // to how many answers happen to survive. Rewriting an abandoned
    // 20-question quiz to "2 items" just because 2 answers remain would be
    // a permanent, silent corruption of the activity feed.
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.updateAttempts).toEqual([
      { attemptId: 'att1', sessionId: 's1', score: 0, itemCount: 1 },
    ])
  })

  it('omits itemCount, rather than guessing, when the session is absent from the snapshot', () => {
    const snap = snapshot()
    snap.sessions = snap.sessions.filter((s) => s.id !== 's1')
    const p = planErasure(snap, { kind: 'answer', answerId: 'a1' })
    expect(p.updateAttempts).toEqual([{ attemptId: 'att1', sessionId: 's1', score: 0 }])
    expect('itemCount' in p.updateAttempts[0]).toBe(false)
  })

  it('never lets the decremented itemCount go negative', () => {
    const snap = snapshot()
    snap.sessions = snap.sessions.map((s) => (s.id === 's1' ? { ...s, itemCount: 0 } : s))
    const p = planErasure(snap, { kind: 'answer', answerId: 'a1' })
    expect(p.updateAttempts[0].itemCount).toBe(0)
  })
})

describe('planErasure — clearInsightSessionIds (I-7)', () => {
  // StudySession.insight is a persisted AI summary making per-card claims.
  // Nothing else invalidates it, so after an erasure it can go on naming a
  // card the learner explicitly erased. Planner only — Task 5 writes the
  // executor that actually clears it.
  it('lists the session behind a surviving-but-updated attempt', () => {
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.clearInsightSessionIds).toEqual(['s1'])
  })

  it('is empty when no attempt merely loses an answer', () => {
    const p = plan({ kind: 'attempt', attemptId: 'att1' })
    expect(p.clearInsightSessionIds).toEqual([])
  })

  it('collects a session id for every updated attempt AND every deleted standalone event it backs', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    // card scope recomputes att1 (session s1) and att2 (session s2), and
    // also deletes e4 — the standalone review event on c1, tied to s3.
    expect(p.clearInsightSessionIds.sort()).toEqual(['s1', 's2', 's3'])
  })

  // Round 2 gap: review/matching sessions have no QuizAttempt, so
  // updateAttempts alone can never reach them. A learner who erases a
  // standalone review event from the memory-history page must still get
  // that session's insight cleared, or it goes on naming a card they just
  // erased — precisely the failure I-7 exists to prevent.
  describe('standalone (non-quiz) events', () => {
    it('clears the insight of a standalone review event\'s session', () => {
      const p = plan({ kind: 'event', eventId: 'e4' })
      expect(p.clearInsightSessionIds).toEqual(['s3'])
    })

    it('adds nothing when the deleted standalone event has no session', () => {
      // No null leaking in — same class of bug the deleteSessionIds
      // predicate already guards against.
      const snap = snapshot()
      snap.events.push({
        id: 'e6',
        cardId: 'c1',
        quizAnswerId: null,
        source: 'review',
        sessionId: null,
      })
      const p = planErasure(snap, { kind: 'event', eventId: 'e6' })
      expect(p.clearInsightSessionIds).toEqual([])
    })

    it('excludes a session that is already being deleted outright', () => {
      // The set scope deletes s3 outright (I-2's full session sweep) and
      // also deletes e4, whose sessionId is s3. Without the exclusion, s3
      // would be listed for both outright deletion AND a pointless
      // field-clear on a row that is about to be gone.
      const p = plan({ kind: 'set', setId: 'set1' })
      expect(p.deleteSessionIds).toContain('s3')
      expect(p.clearInsightSessionIds).not.toContain('s3')
    })
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

  it('returns an empty-ish plan for an event id absent from the snapshot', () => {
    const p = plan({ kind: 'event', eventId: 'ghost' })
    expect(p.deleteAnswerIds).toEqual([])
    expect(p.deleteEventIds).toEqual([])
  })

  it('throws when a quiz-sourced event routes to an answer absent from the snapshot (I-4)', () => {
    // Without this check, deleteAnswerIds would carry an id that never got
    // resolved through the snapshot, so replayCardIds/replayKlpIds — both
    // derived from `snapshot.answers.filter(...)` — would come back empty.
    // The executor would delete the answer, cascade its AnswerKlpResult rows,
    // and replay nothing: evidence gone, posterior standing, permanent.
    const snap = snapshot()
    snap.events.push({
      id: 'eGhost',
      cardId: 'c9',
      quizAnswerId: 'aGhost',
      source: 'quiz-mc',
      sessionId: null,
    })
    expect(() => planErasure(snap, { kind: 'event', eventId: 'eGhost' })).toThrow(
      /absent from the snapshot/,
    )
  })
})

describe('planErasure — attempt scope', () => {
  it('deletes the attempt, its session, and replays every card and KLP', () => {
    const p = plan({ kind: 'attempt', attemptId: 'att1' })
    expect(p.deleteAttemptIds).toEqual(['att1'])
    expect(p.deleteSessionIds).toEqual(['s1'])
    // att1 only ever touched c1/c2 — c3 (att2's a5) must NOT show up here.
    expect(p.replayCardIds.sort()).toEqual(['c1', 'c2'])
    expect(p.replayKlpIds.sort()).toEqual(['k1', 'k2'])
    expect(p.updateAttempts).toEqual([])
  })

  it('returns an empty-ish plan for an attempt id absent from snapshot.answers', () => {
    const p = plan({ kind: 'attempt', attemptId: 'ghost' })
    expect(p.deleteAnswerIds).toEqual([])
  })

  it('still deletes an attempt id absent from snapshot.attempts (I-3)', () => {
    // A zero-answer, never-completed quiz the loader did not enumerate in
    // `attempts` must still be deleted when explicitly targeted — otherwise
    // "reset this quiz" on an abandoned attempt silently deletes nothing.
    const p = plan({ kind: 'attempt', attemptId: 'ghost' })
    expect(p.deleteAttemptIds).toEqual(['ghost'])
    // No session is known for it, so nothing spurious is deleted.
    expect(p.deleteSessionIds).toEqual([])
  })

  it('never includes null in deleteSessionIds for an attempt with no session', () => {
    const snap = snapshot()
    snap.attempts.push({ id: 'attN', sessionId: null, answers: [{ id: 'aN', score: 10 }] })
    snap.answers.push({ id: 'aN', attemptId: 'attN', cardId: 'cN', klpIds: [], score: 10 })
    const p = planErasure(snap, { kind: 'attempt', attemptId: 'attN' })
    expect(p.deleteAttemptIds).toEqual(['attN'])
    expect(p.deleteSessionIds).toEqual([])
  })

  describe('orphan quiz events reachable only via the session (M-1)', () => {
    // Pre-Stage-6 StudyEvent rows can be quiz-sourced with a NULL
    // quizAnswerId that Task 3's backfill structurally cannot link — the
    // executor's loader reaches them through the attempt's session as well
    // as through its answers. Without the planner routing these into
    // eventIds too, they're loaded and then silently dropped: after the
    // session is deleted (StudyEvent.sessionId is SetNull) they survive
    // invisible, unreachable, and still feeding CardProgress.
    const orphanFixture = (): ErasureSnapshot => ({
      answers: [{ id: 'y1', attemptId: 'attY', cardId: 'cY', klpIds: ['kY'], score: 80 }],
      events: [
        { id: 'ey1', cardId: 'cY', quizAnswerId: 'y1', source: 'quiz-mc', sessionId: 'sY' },
        // The orphan: quiz-sourced, but its quizAnswerId is null, so it is
        // reachable ONLY through sessionId matching attY's session.
        { id: 'eOrphan', cardId: 'cOrphan', quizAnswerId: null, source: 'quiz-mc', sessionId: 'sY' },
      ],
      attempts: [{ id: 'attY', sessionId: 'sY', answers: [{ id: 'y1', score: 80 }] }],
      sessions: [{ id: 'sY', itemCount: 1 }],
    })

    it('deletes the orphan event and replays its card', () => {
      const p = planErasure(orphanFixture(), { kind: 'attempt', attemptId: 'attY' })
      expect(p.deleteEventIds).toEqual(['eOrphan'])
      expect(p.replayCardIds).toContain('cOrphan')
    })

    it('does not pull in an orphan event belonging to a DIFFERENT session', () => {
      // QuizAttempt.sessionId is @unique, so this is a defensive check: even
      // if two attempts existed, an orphan tied to a different session must
      // not be swept in.
      const snap = orphanFixture()
      snap.events.push({
        id: 'eOther',
        cardId: 'cOther',
        quizAnswerId: null,
        source: 'quiz-mc',
        sessionId: 'sOther',
      })
      const p = planErasure(snap, { kind: 'attempt', attemptId: 'attY' })
      expect(p.deleteEventIds).toEqual(['eOrphan'])
      expect(p.deleteEventIds).not.toContain('eOther')
    })

    it('does not sweep a standalone (non-quiz) review event on the same session', () => {
      // Not part of M-1's contract either way in this fixture shape, but
      // pins that a null-quizAnswerId event on the attempt's session is
      // still swept regardless of its `source` label — the planner has no
      // other signal to distinguish "orphaned quiz event" from "review
      // event that happens to share the session."
      const snap = orphanFixture()
      snap.events.push({
        id: 'eReview',
        cardId: 'cReview',
        quizAnswerId: null,
        source: 'review',
        sessionId: 'sY',
      })
      const p = planErasure(snap, { kind: 'attempt', attemptId: 'attY' })
      expect(p.deleteEventIds.sort()).toEqual(['eOrphan', 'eReview'])
    })

    it('sweeps nothing extra when the attempt has no session', () => {
      const snap = orphanFixture()
      snap.attempts[0] = { ...snap.attempts[0], sessionId: null }
      const p = planErasure(snap, { kind: 'attempt', attemptId: 'attY' })
      expect(p.deleteEventIds).toEqual([])
    })
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

  it('recomputes both surviving attempts touched by the card, and deletes neither', () => {
    // c1's answers (a1, a3) sit on two DIFFERENT attempts — the only scope
    // that touches more than one attempt at once — so this exercises
    // updateAttempts/deleteAttemptIds/deleteSessionIds together, previously
    // unasserted for this scope.
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteAttemptIds).toEqual([])
    expect(p.deleteSessionIds).toEqual([])
    expect(p.updateAttempts).toEqual([
      { attemptId: 'att1', sessionId: 's1', score: 0, itemCount: 1 },
      { attemptId: 'att2', sessionId: 's2', score: 20, itemCount: 1 },
    ])
  })
})

describe('planErasure — set scope', () => {
  it('deletes every answer, event, attempt and session in the snapshot', () => {
    // The snapshot loader has already narrowed to the set, so the set scope
    // erases everything it was handed.
    const p = plan({ kind: 'set', setId: 'set1' })
    expect(p.deleteAnswerIds.sort()).toEqual(['a1', 'a2', 'a3', 'a5'])
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.deleteAttemptIds.sort()).toEqual(['att1', 'att2'])
    expect(p.deleteSessionIds.sort()).toEqual(['s1', 's2', 's3'])
    expect(p.replayCardIds.sort()).toEqual(['c1', 'c2', 'c3'])
    expect(p.deleteConfidenceEventCardIds.sort()).toEqual(['c1', 'c2', 'c3'])
  })

  it('deletes every session even when it has no QuizAttempt at all (I-2)', () => {
    // s3 is a standalone matching/review session with zero attempts. Only
    // deriving deleteSessionIds from deleteAttemptIds would leave it standing
    // as an empty husk after "forget this set" — verbatim spec defect #3,
    // previously fixed only for the account scope.
    const p = plan({ kind: 'set', setId: 'set1' })
    expect(p.deleteSessionIds).toContain('s3')
  })

  it('does not sweep every session for a narrower scope', () => {
    // Only the set scope gets the full-snapshot session sweep.
    const p = plan({ kind: 'attempt', attemptId: 'att1' })
    expect(p.deleteSessionIds).toEqual(['s1'])
    expect(p.deleteSessionIds).not.toContain('s3')
  })

  it('throws when narrowedSetId does not match the scope setId (M-3)', () => {
    const snap = snapshot()
    snap.narrowedSetId = 'other-set'
    expect(() => planErasure(snap, { kind: 'set', setId: 'set1' })).toThrow()
  })

  it('accepts a matching narrowedSetId', () => {
    const snap = snapshot()
    snap.narrowedSetId = 'set1'
    expect(() => planErasure(snap, { kind: 'set', setId: 'set1' })).not.toThrow()
  })

  it('does not require narrowedSetId at all', () => {
    const snap = snapshot()
    expect(snap.narrowedSetId).toBeUndefined()
    expect(() => planErasure(snap, { kind: 'set', setId: 'set1' })).not.toThrow()
  })
})

describe('planErasure — deleteConfidenceEventSetId (N-1)', () => {
  // Today's forgetSet (src/actions/memory.ts) deletes ConfidenceEvent by
  // { userId, card: { setId } } — every card in the set, including one whose
  // only remaining memory is a legacy ConfidenceEvent row with no surviving
  // answer or event. deleteConfidenceEventCardIds can't reach that card (it
  // only ever contains cards present in the snapshot's answers/events), so
  // this is a separate, set-scoped signal matching that breadth.
  it('is set to the setId for the set scope', () => {
    const p = plan({ kind: 'set', setId: 'set1' })
    expect(p.deleteConfidenceEventSetId).toBe('set1')
  })

  const otherScopes: ErasureScope[] = [
    { kind: 'event', eventId: 'e1' },
    { kind: 'answer', answerId: 'a1' },
    { kind: 'attempt', attemptId: 'att1' },
    { kind: 'card', cardId: 'c1' },
    { kind: 'account' },
  ]

  it.each(otherScopes)('is undefined for every other scope (%o)', (scope) => {
    const p = plan(scope)
    expect(p.deleteConfidenceEventSetId).toBeUndefined()
  })
})

describe('planErasure — account scope', () => {
  it('returns the empty plan without reading the snapshot', () => {
    // A full account wipe is a truncate, not a plan — loading every row to
    // decide to delete every row would be absurd. executeErasure special-
    // cases this scope onto ERASABLE_MEMORY_MODELS (Task 5).
    const p = plan({ kind: 'account' })
    expect(p).toEqual({
      deleteAnswerIds: [],
      deleteEventIds: [],
      deleteAttemptIds: [],
      deleteSessionIds: [],
      updateAttempts: [],
      deleteConfidenceEventCardIds: [],
      replayCardIds: [],
      replayKlpIds: [],
      clearInsightSessionIds: [],
    })
  })
})

describe('planErasure — purity', () => {
  // One representative scope per kind, all resolvable against the shared
  // fixture, so a mutation confined to a single branch (e.g. only the
  // `card` case) can't hide behind a test that only ever exercised `set`.
  const allScopes: ErasureScope[] = [
    { kind: 'event', eventId: 'e1' },
    { kind: 'answer', answerId: 'a1' },
    { kind: 'attempt', attemptId: 'att1' },
    { kind: 'card', cardId: 'c1' },
    { kind: 'set', setId: 'set1' },
    { kind: 'account' },
  ]

  it('the parameterisation covers every scope kind', () => {
    expect(allScopes.map((s) => s.kind).sort()).toEqual([...ERASURE_SCOPE_KINDS].sort())
  })

  it.each(allScopes)('does not mutate the snapshot passed in (%o)', (scope) => {
    // Both B3-guard blocks below derive their expectations from `snap`
    // *after* calling planErasure(snap, ...). If the planner ever mutated
    // its input, the guard would be checking its own corruption and could
    // go green over a broken planner.
    const snap = snapshot()
    const before = JSON.parse(JSON.stringify(snap))
    planErasure(snap, scope)
    expect(snap).toEqual(before)
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

  it('covers every scope kind except account (I-6)', () => {
    // A seventh scope added later must be added to `scopes` above too, or
    // this fails loudly instead of silently escaping coverage.
    const covered = new Set(scopes.map((s) => s.kind))
    const expected = ERASURE_SCOPE_KINDS.filter((k) => k !== 'account')
    expect([...covered].sort()).toEqual([...expected].sort())
  })

  // The true deletion set is deleteAnswerIds UNION every answer on a deleted
  // attempt — the QuizAttempt -> QuizAnswer cascade removes those too, even
  // ones the scope-specific logic didn't enumerate directly (I-5).
  const cascadedAnswerIds = (snap: ErasureSnapshot, p: ReturnType<typeof planErasure>) =>
    new Set([
      ...p.deleteAnswerIds,
      ...snap.attempts
        .filter((t) => p.deleteAttemptIds.includes(t.id))
        .flatMap((t) => t.answers.map((a) => a.id)),
    ])

  it.each(scopes)('replays a KLP for every deleted (or cascaded) answer (%o)', (scope) => {
    const snap = snapshot()
    const p = planErasure(snap, scope)
    const cascaded = cascadedAnswerIds(snap, p)
    const expectedKlps = new Set(
      snap.answers.filter((a) => cascaded.has(a.id)).flatMap((a) => a.klpIds),
    )
    for (const klpId of expectedKlps) {
      expect(p.replayKlpIds).toContain(klpId)
    }
  })

  it.each(scopes)('replays a card for every deleted (or cascaded) answer or event (%o)', (scope) => {
    const snap = snapshot()
    const p = planErasure(snap, scope)
    const cascaded = cascadedAnswerIds(snap, p)
    const expectedCards = new Set([
      ...snap.answers.filter((a) => cascaded.has(a.id)).map((a) => a.cardId),
      ...snap.events.filter((e) => p.deleteEventIds.includes(e.id)).map((e) => e.cardId),
    ])
    for (const cardId of expectedCards) {
      expect(p.replayCardIds).toContain(cardId)
    }
  })
})
