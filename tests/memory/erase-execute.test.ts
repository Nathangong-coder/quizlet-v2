import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Executor tests for `executeErasure`.
 *
 * No live-DB harness exists in this repo, so Prisma is mocked (the pattern in
 * tests/actions/quiz-submit-ownership.test.ts) and `state-writer` is mocked so
 * the ORDERING guarantees — lock before any posterior touch, rebuild strictly
 * after the deletes — become observable through `invocationCallOrder`, which
 * vitest maintains globally across every mock in the file.
 *
 * The properties under test are the ones that are permanent when broken:
 * a posterior that survives its own evidence cannot be repaired by the
 * backfill, because the backfill only rebuilds from surviving rows.
 */

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  rebuildKlpStates: vi.fn(),
  lockKlpStates: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ prisma: { $transaction: h.transaction } }))
vi.mock('@/lib/metrics/state-writer', () => ({
  rebuildKlpStates: h.rebuildKlpStates,
  lockKlpStates: h.lockKlpStates,
}))

import { Prisma } from '@prisma/client'
import { ERASABLE_MEMORY_MODELS } from '@/lib/memory/erase'
import { executeErasure } from '@/lib/memory/erase-execute'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Fixture {
  /** Rows `quizAnswer.findMany` returns for the snapshot read. */
  answers?: any[]
  /** Rows `studyEvent.findMany` returns for the snapshot read. */
  events?: any[]
  /** cardId -> rows the REPLAY read returns (the read that selects createdAt). */
  survivingEvents?: Record<string, any[]>
  attempts?: any[]
  sessions?: any[]
  rootAnswer?: any
  rootEvent?: any
  rootAttempt?: any
}

/** A transaction client recording every call, with configurable reads. */
function fakeTx(f: Fixture = {}) {
  const calls: { model: string; op: string; arg: any }[] = []
  const op = (model: string, name: string, impl: (arg: any) => unknown) =>
    vi.fn(async (arg: any) => {
      calls.push({ model, op: name, arg })
      return impl(arg)
    })

  return {
    calls,
    quizAnswer: {
      findUnique: op('quizAnswer', 'findUnique', () => f.rootAnswer ?? null),
      findMany: op('quizAnswer', 'findMany', () => f.answers ?? []),
      deleteMany: op('quizAnswer', 'deleteMany', () => ({ count: 0 })),
    },
    studyEvent: {
      findUnique: op('studyEvent', 'findUnique', () => f.rootEvent ?? null),
      findMany: op('studyEvent', 'findMany', (arg) =>
        // The replay read selects `createdAt`; the snapshot read does not.
        arg.select?.createdAt
          ? (f.survivingEvents?.[arg.where.cardId] ?? [])
          : (f.events ?? []),
      ),
      deleteMany: op('studyEvent', 'deleteMany', () => ({ count: 0 })),
    },
    quizAttempt: {
      findUnique: op('quizAttempt', 'findUnique', () => f.rootAttempt ?? null),
      findMany: op('quizAttempt', 'findMany', () => f.attempts ?? []),
      deleteMany: op('quizAttempt', 'deleteMany', () => ({ count: 0 })),
      updateMany: op('quizAttempt', 'updateMany', () => ({ count: 1 })),
    },
    studySession: {
      findMany: op('studySession', 'findMany', () => f.sessions ?? []),
      deleteMany: op('studySession', 'deleteMany', () => ({ count: 0 })),
      updateMany: op('studySession', 'updateMany', () => ({ count: 1 })),
    },
    confidenceEvent: {
      deleteMany: op('confidenceEvent', 'deleteMany', () => ({ count: 0 })),
    },
    cardProgress: {
      deleteMany: op('cardProgress', 'deleteMany', () => ({ count: 0 })),
      upsert: op('cardProgress', 'upsert', () => ({})),
    },
    klpState: { deleteMany: op('klpState', 'deleteMany', () => ({ count: 0 })) },
  }
}

type Tx = ReturnType<typeof fakeTx>

function run(tx: Tx) {
  h.transaction.mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx))
}

const argFor = (tx: Tx, model: string, op: string) =>
  tx.calls.find((c) => c.model === model && c.op === op)?.arg

const argsFor = (tx: Tx, model: string, op: string) =>
  tx.calls.filter((c) => c.model === model && c.op === op).map((c) => c.arg)

/**
 * One quiz attempt `att1` on session `s1` with two graded answers: a1 (card c1,
 * KLP k1) and a2 (card c2, KLP k2). Enough to tell a partial deletion from a
 * total one, which is the distinction most of the executor's writes hang on.
 */
const twoAnswerAttempt = (): Fixture => ({
  rootAttempt: { userId: 'u1', sessionId: 's1' },
  rootAnswer: { userId: 'u1', attemptId: 'att1' },
  answers: [
    { id: 'a1', attemptId: 'att1', cardId: 'c1', score: 100, klpResults: [{ klpId: 'k1' }] },
    { id: 'a2', attemptId: 'att1', cardId: 'c2', score: 0, klpResults: [{ klpId: 'k2' }] },
  ],
  events: [
    { id: 'e1', cardId: 'c1', quizAnswerId: 'a1', source: 'quiz-mc', sessionId: 's1' },
    { id: 'e2', cardId: 'c2', quizAnswerId: 'a2', source: 'quiz-mc', sessionId: 's1' },
  ],
  attempts: [
    {
      id: 'att1',
      sessionId: 's1',
      answers: [
        { id: 'a1', score: 100 },
        { id: 'a2', score: 0 },
      ],
    },
  ],
  sessions: [{ id: 's1', itemCount: 5 }],
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeErasure — ordering', () => {
  it('takes the KLP row lock before it touches any posterior', async () => {
    // Without the advisory lock two writers read the same pre-state and the
    // second drops the first's observation — permanently, since the posterior
    // cannot be stepped backward.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(h.lockKlpStates).toHaveBeenCalledWith(tx, 'u1', ['k1', 'k2'])
    expect(h.lockKlpStates.mock.invocationCallOrder[0]).toBeLessThan(
      h.rebuildKlpStates.mock.invocationCallOrder[0],
    )
  })

  it('replays the KLP posterior AFTER the deletes, never before', async () => {
    // rebuildKlpStates reads SURVIVING AnswerKlpResult rows. Called first, it
    // would rebuild from evidence that is about to vanish.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    const answerDelete = tx.quizAnswer.deleteMany.mock.invocationCallOrder[0]
    expect(answerDelete).toBeGreaterThan(h.lockKlpStates.mock.invocationCallOrder[0])
    expect(h.rebuildKlpStates.mock.invocationCallOrder[0]).toBeGreaterThan(answerDelete)
    expect(h.rebuildKlpStates).toHaveBeenCalledWith(tx, 'u1', ['k1', 'k2'])
  })

  it('replays CardProgress from events read after the deletes', async () => {
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    const replayRead = tx.studyEvent.findMany.mock.invocationCallOrder.at(-1)!
    expect(replayRead).toBeGreaterThan(tx.quizAnswer.deleteMany.mock.invocationCallOrder[0])
  })

  it('does all of it inside ONE transaction', async () => {
    // A replay that throws must roll the deletes back, not leave evidence gone
    // and aggregates stale.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(h.transaction).toHaveBeenCalledOnce()
  })
})

describe('executeErasure — ownership', () => {
  const noDeletes = (tx: Tx) =>
    expect(tx.calls.some((c) => c.op === 'deleteMany' || c.op === 'updateMany')).toBe(false)

  it('rejects an attempt belonging to another user without deleting anything', async () => {
    const tx = fakeTx({ rootAttempt: { userId: 'someone-else', sessionId: 's1' } })
    run(tx)

    await expect(executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })).rejects.toThrow(
      'Not found',
    )
    noDeletes(tx)
  })

  it('rejects an absent attempt with the SAME error as a foreign one', async () => {
    // A distinguishable error confirms the row exists to someone probing ids.
    const tx = fakeTx({ rootAttempt: null })
    run(tx)

    await expect(executeErasure('u1', { kind: 'attempt', attemptId: 'ghost' })).rejects.toThrow(
      'Not found',
    )
    noDeletes(tx)
  })

  it('rejects a foreign answer', async () => {
    const tx = fakeTx({ rootAnswer: { userId: 'someone-else', attemptId: 'att1' } })
    run(tx)

    await expect(executeErasure('u1', { kind: 'answer', answerId: 'a1' })).rejects.toThrow(
      'Not found',
    )
    noDeletes(tx)
  })

  it('rejects a foreign event', async () => {
    const tx = fakeTx({ rootEvent: { userId: 'someone-else', quizAnswerId: null, quizAnswer: null } })
    run(tx)

    await expect(executeErasure('u1', { kind: 'event', eventId: 'e1' })).rejects.toThrow(
      'Not found',
    )
    noDeletes(tx)
  })

  it('scopes the card scope by userId ONLY — never by set ownership', async () => {
    // Since set visibility shipped a learner can study a link-shared set they
    // do not own. Their events and answers for someone else's card are
    // legitimately theirs to erase, so requiring set ownership here would
    // strand a learner's own memory behind another user's set.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'card', cardId: 'c1' })

    expect(argFor(tx, 'quizAnswer', 'findMany').where).toEqual({ userId: 'u1', cardId: 'c1' })
    expect(argFor(tx, 'studyEvent', 'findMany').where).toEqual({ userId: 'u1', cardId: 'c1' })
  })

  it('scopes the set scope by userId ONLY — never by set ownership', async () => {
    const tx = fakeTx({ ...twoAnswerAttempt(), events: [] })
    run(tx)

    await executeErasure('u1', { kind: 'set', setId: 'set1' })

    expect(argFor(tx, 'quizAnswer', 'findMany').where).toEqual({
      userId: 'u1',
      card: { setId: 'set1' },
    })
    expect(argFor(tx, 'studySession', 'findMany').where).toEqual({ userId: 'u1', setId: 'set1' })
  })
})

describe('executeErasure — account scope', () => {
  it('truncates every erasable model and reads no snapshot at all', async () => {
    const tx = fakeTx()
    run(tx)

    await executeErasure('u1', { kind: 'account' })

    for (const model of ERASABLE_MEMORY_MODELS) {
      expect(
        tx.calls.some(
          (c) =>
            c.model === model &&
            c.op === 'deleteMany' &&
            JSON.stringify(c.arg) === JSON.stringify({ where: { userId: 'u1' } }),
        ),
        `${model} was not cleared`,
      ).toBe(true)
    }
    // A full wipe is a truncate, not a plan: loading every row to decide to
    // delete every row would be absurd.
    expect(tx.calls.some((c) => c.op === 'findMany' || c.op === 'findUnique')).toBe(false)
  })

  it('clears the StudySession husk that RESET_MEMORY_MODELS alone leaves behind', async () => {
    // Both StudyEvent.sessionId and QuizAttempt.sessionId are SetNull, so a
    // reset that omits studySession leaves every session standing empty.
    const tx = fakeTx()
    run(tx)

    await executeErasure('u1', { kind: 'account' })

    expect(tx.studySession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })
})

describe('executeErasure — the event scope must widen to the whole attempt (I-4)', () => {
  it('loads every answer on the routed answer attempt, not just that answer', async () => {
    // planErasure THROWS when a quiz-sourced event routes to an answer absent
    // from the snapshot — that throw is the only thing enforcing this
    // coupling. A narrow query would fail the action at runtime.
    const tx = fakeTx({
      ...twoAnswerAttempt(),
      rootEvent: { userId: 'u1', quizAnswerId: 'a1', quizAnswer: { attemptId: 'att1' } },
      events: [{ id: 'e1', cardId: 'c1', quizAnswerId: 'a1', source: 'quiz-mc', sessionId: 's1' }],
    })
    run(tx)

    await executeErasure('u1', { kind: 'event', eventId: 'e1' })

    expect(argFor(tx, 'quizAnswer', 'findMany').where).toEqual({ userId: 'u1', attemptId: 'att1' })
    // a2 survives, so att1 survives with a recomputed score rather than being
    // deleted — only reachable if the snapshot actually held both answers.
    expect(tx.quizAttempt.deleteMany).not.toHaveBeenCalled()
    expect(argFor(tx, 'quizAttempt', 'updateMany')).toEqual({
      where: { id: 'att1', userId: 'u1' },
      data: { score: 0 },
    })
  })

  it('loads no answers at all for a standalone review event', async () => {
    const tx = fakeTx({
      rootEvent: { userId: 'u1', quizAnswerId: null, quizAnswer: null },
      events: [{ id: 'e4', cardId: 'c1', quizAnswerId: null, source: 'review', sessionId: 's3' }],
    })
    run(tx)

    await executeErasure('u1', { kind: 'event', eventId: 'e4' })

    expect(tx.quizAnswer.findMany).not.toHaveBeenCalled()
    expect(tx.studyEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['e4'] } },
    })
  })
})

describe('executeErasure — sessions', () => {
  it('loads EVERY session in the set, including ones with no QuizAttempt (I-2)', async () => {
    // Matching and review sessions have no QuizAttempt at all. Deriving
    // sessions from attempts would leave them standing as empty husks after
    // "forget this set" — the exact bug this feature exists to fix.
    const f = twoAnswerAttempt()
    const tx = fakeTx({
      ...f,
      events: [],
      sessions: [
        { id: 's1', itemCount: 5 },
        { id: 's3', itemCount: 8 },
      ],
    })
    run(tx)

    await executeErasure('u1', { kind: 'set', setId: 'set1' })

    const deleted = argFor(tx, 'studySession', 'deleteMany').where.id.in as string[]
    expect([...deleted].sort()).toEqual(['s1', 's3'])
  })

  it('deletes an abandoned zero-answer attempt AND its session (I-3)', async () => {
    // The loader must enumerate the explicitly targeted attempt even though no
    // answer points at it, or the planner's I-3 branch deletes the attempt
    // while its session survives as a husk.
    const tx = fakeTx({
      rootAttempt: { userId: 'u1', sessionId: 's9' },
      answers: [],
      events: [],
      attempts: [{ id: 'att9', sessionId: 's9', answers: [] }],
      sessions: [{ id: 's9', itemCount: 20 }],
    })
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att9' })

    expect(argFor(tx, 'quizAttempt', 'findMany').where.id.in).toContain('att9')
    expect(tx.quizAttempt.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['att9'] } },
    })
    expect(tx.studySession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['s9'] } },
    })
  })

  it('clears the persisted insight of a surviving-but-changed session (I-7)', async () => {
    // StudySession.insight is a persisted AI summary making per-card claims.
    // Nothing else invalidates it, so left alone it goes on naming a card the
    // learner explicitly erased.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'answer', answerId: 'a1' })

    const clear = argsFor(tx, 'studySession', 'updateMany').find(
      (a) => 'insight' in a.data,
    )
    expect(clear).toEqual({
      where: { userId: 'u1', id: { in: ['s1'] } },
      data: { insight: Prisma.DbNull, insightAt: null },
    })
  })

  it('decrements the STORED itemCount rather than writing the survivor count', async () => {
    // s1 was planned with 5 items; deleting one answer makes it 4. Writing
    // `survivors.length` (1) would permanently rewrite an abandoned quiz's
    // size in the activity feed.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'answer', answerId: 'a1' })

    const counts = argsFor(tx, 'studySession', 'updateMany').filter((a) => 'itemCount' in a.data)
    expect(counts).toEqual([{ where: { id: 's1', userId: 'u1' }, data: { itemCount: 4 } }])
  })

  it('writes NO itemCount when the planner omitted it', async () => {
    // The planner omits rather than guesses when the session is absent from
    // the snapshot. Writing `undefined` through would be a no-op query; writing
    // anything else would be a fabricated count.
    const tx = fakeTx({ ...twoAnswerAttempt(), sessions: [] })
    run(tx)

    await executeErasure('u1', { kind: 'answer', answerId: 'a1' })

    expect(argsFor(tx, 'studySession', 'updateMany').some((a) => 'itemCount' in a.data)).toBe(false)
  })
})

describe('executeErasure — legacy ConfidenceEvent breadth (N-1)', () => {
  it('deletes the set scope ConfidenceEvent rows by SET, not by the card id list', async () => {
    // `deleteConfidenceEventCardIds` only covers cards appearing in answers or
    // events. A card whose only remaining memory is a legacy ConfidenceEvent
    // row (no answer, no event) is in neither, so its rows would silently
    // survive "forget this set" — a regression against today's shipped
    // forgetSet, which deletes by `{ userId, card: { setId } }`.
    const tx = fakeTx({ ...twoAnswerAttempt(), events: [] })
    run(tx)

    await executeErasure('u1', { kind: 'set', setId: 'set1' })

    expect(tx.confidenceEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', card: { setId: 'set1' } },
    })
  })

  it('scopes that delete by userId, so it cannot reach another learner rows', async () => {
    // A ConfidenceEvent delete scoped only by set would erase every learner's
    // legacy history for a link-shared set.
    const tx = fakeTx({ ...twoAnswerAttempt(), events: [] })
    run(tx)

    await executeErasure('u1', { kind: 'set', setId: 'set1' })

    for (const call of argsFor(tx, 'confidenceEvent', 'deleteMany')) {
      expect(call.where.userId).toBe('u1')
    }
  })

  it('still deletes by card id for the card scope', async () => {
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'card', cardId: 'c1' })

    expect(tx.confidenceEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cardId: { in: ['c1'] } },
    })
  })

  it('issues no ConfidenceEvent delete for a scope that names neither', async () => {
    // The attempt scope erases one quiz session. There is no FK from
    // ConfidenceEvent to a StudyEvent or QuizAnswer, so the only alternative
    // to touching nothing would be wiping a card's whole legacy history to
    // erase one quiz — a far worse surprise (M-4, closed as not-a-defect).
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(tx.confidenceEvent.deleteMany).not.toHaveBeenCalled()
  })
})

describe('executeErasure — CardProgress replay', () => {
  it('deletes the row when no evidence survives, reverting the card to never-studied', async () => {
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(tx.cardProgress.upsert).not.toHaveBeenCalled()
    expect(tx.cardProgress.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cardId: 'c1' },
    })
  })

  it('recomputes the row from the events that survive', async () => {
    const tx = fakeTx({
      ...twoAnswerAttempt(),
      survivingEvents: {
        c1: [{ correct: true, score: null, createdAt: new Date('2026-08-01T00:00:00Z') }],
      },
    })
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    const upsert = argFor(tx, 'cardProgress', 'upsert')
    expect(upsert.where).toEqual({ userId_cardId: { userId: 'u1', cardId: 'c1' } })
    expect(upsert.update.reps).toBe(1)
    // The star is never resurrected by a replay, but an existing one is not
    // clobbered either — `update` must not carry `starred`.
    expect('starred' in upsert.update).toBe(false)
    expect(upsert.create.starred).toBe(false)
    // c2 had nothing left, so it goes the other way in the same run.
    expect(tx.cardProgress.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cardId: 'c2' },
    })
  })
})

describe('executeErasure — M-1: the attempt scope reaches events by session', () => {
  it('deletes the orphan events the plan lists AND replays their cards', async () => {
    // The end-to-end proof that the loader and the planner agree. A
    // quiz-sourced StudyEvent with a NULL quizAnswerId (pre-Stage-6 rows,
    // which Task 3's backfill structurally cannot link) is invisible to the
    // answer join, so the loader reaches it by the attempt's session and the
    // planner now puts it in `deleteEventIds`. If either half regresses the
    // row survives the reset invisibly — `StudyEvent.sessionId` is SetNull, so
    // after the session goes it is unreachable AND still feeding CardProgress.
    const f = twoAnswerAttempt()
    const tx = fakeTx({
      ...f,
      events: [
        ...f.events!,
        { id: 'e9', cardId: 'c9', quizAnswerId: null, source: 'quiz-mc', sessionId: 's1' },
      ],
    })
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(tx.studyEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['e9'] } },
    })
    // The orphan's card must be replayed too — deleting the evidence and
    // leaving its CardProgress standing is the exact invariant violation this
    // whole feature exists to prevent.
    expect(tx.cardProgress.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cardId: 'c9' },
    })
  })

  it('queries events via the attempt session as well as via its answers', async () => {
    // The loader half on its own: without the session arm the orphan above is
    // never even loaded, so the planner has nothing to put in deleteEventIds.
    const tx = fakeTx(twoAnswerAttempt())
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(argFor(tx, 'studyEvent', 'findMany').where).toEqual({
      userId: 'u1',
      OR: [{ quizAnswer: { attemptId: 'att1' } }, { sessionId: 's1' }],
    })
  })

  it('falls back to the answer join alone when the attempt has no session', async () => {
    const f = twoAnswerAttempt()
    const tx = fakeTx({ ...f, rootAttempt: { userId: 'u1', sessionId: null } })
    run(tx)

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(argFor(tx, 'studyEvent', 'findMany').where).toEqual({
      userId: 'u1',
      quizAnswer: { attemptId: 'att1' },
    })
  })
})
