import { describe, it, expect, vi } from 'vitest'
import {
  persistKlpStates,
  rebuildKlpStates,
  lockKlpStates,
  type KlpObservationWrite,
} from '@/lib/metrics/state-writer'
import { rebuildStatesFromResults, type KlpStateRow } from '@/lib/metrics/cache'
import { BKT_PRIOR } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const at = (mins: number): Date => new Date(NOW.getTime() + mins * 60_000)

const res = (o: Partial<KlpObservationWrite> = {}): KlpObservationWrite => ({
  klpId: 'klp1',
  status: 'passed',
  mode: 'quiz-mc',
  ...o,
})

/** Stands in for the transaction client the action binds its closures to. */
function fakeStore() {
  const rows = new Map<string, KlpStateRow>()
  const saves: KlpStateRow[] = []
  return {
    rows,
    saves,
    load: async (klpId: string) => rows.get(klpId) ?? null,
    save: async (state: KlpStateRow) => {
      saves.push({ ...state })
      rows.set(state.klpId, state)
    },
  }
}

describe('lockKlpStates', () => {
  function fakeTx() {
    const queryRaw = vi.fn()
    const executeRaw = vi.fn()
    return {
      tx: { $queryRaw: queryRaw, $executeRaw: executeRaw } as never,
      queryRaw,
      executeRaw,
    }
  }

  it('locks through $executeRaw, never $queryRaw', async () => {
    // pg_advisory_xact_lock returns void. $queryRaw deserializes the result
    // column and the Neon adapter throws P2010 UnsupportedNativeDataType on a
    // void one, aborting the enclosing transaction. That shipped on 2026-08-08
    // and broke BOTH quiz answer submission and every erasure verb; no mocked
    // test caught it because a mock deserializes nothing.
    const { tx, queryRaw, executeRaw } = fakeTx()
    await lockKlpStates(tx, 'u1', ['k1'])
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('takes one lock per distinct id, in sorted order', async () => {
    // Sorted because two transactions taking the same locks in opposite
    // orders deadlock; deduped because taking the same lock twice is waste.
    const { tx, executeRaw } = fakeTx()
    await lockKlpStates(tx, 'u1', ['k2', 'k1', 'k2'])
    expect(executeRaw).toHaveBeenCalledTimes(2)

    // Tagged template: call[0] is the strings array, call[1] the first
    // interpolated value — here the lock key.
    const keyOf = (call: unknown[]) => call[1] as string
    expect([keyOf(executeRaw.mock.calls[0]), keyOf(executeRaw.mock.calls[1])]).toEqual([
      'klpstate:u1:k1',
      'klpstate:u1:k2',
    ])
  })

  it('issues no statement at all when there is nothing to lock', async () => {
    const { tx, executeRaw } = fakeTx()
    await lockKlpStates(tx, 'u1', [])
    expect(executeRaw).not.toHaveBeenCalled()
  })
})

describe('persistKlpStates', () => {
  it('writes a state for every KLP the answer observed', async () => {
    // The bug: nothing in production wrote KlpState at all, so `knowledge` was
    // permanently `{}` — every topic's knowledge null, and every `too_terse`
    // booked as a knowledge gap.
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1',
      results: [res({ klpId: 'k1' }), res({ klpId: 'k2', status: 'failed' })],
      observedAt: NOW,
      load: store.load,
      save: store.save,
    })

    expect([...store.rows.keys()].sort()).toEqual(['k1', 'k2'])
    expect(store.rows.get('k1')!.observations).toBe(1)
    expect(store.rows.get('k1')!.userId).toBe('u1')
    expect(store.rows.get('k1')!.pKnown).not.toBe(BKT_PRIOR)
  })

  it('writes nothing when the answer attributed nothing', async () => {
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1', results: [], observedAt: NOW, load: store.load, save: store.save,
    })
    expect(store.saves).toHaveLength(0)
  })

  it('accumulates across answers instead of overwriting', async () => {
    const store = fakeStore()
    for (const n of [0, 1, 2]) {
      await persistKlpStates({
        userId: 'u1', results: [res()], observedAt: at(n), load: store.load, save: store.save,
      })
    }
    expect(store.rows.get('klp1')!.observations).toBe(3)
    expect(store.rows.get('klp1')!.lastObservedAt.getTime()).toBe(at(2).getTime())
  })

  it('steps sequentially, each observation reading what the last one wrote', async () => {
    // Formerly "composes two results naming the same KLP in one answer" —
    // asserting behaviour that cannot occur: AnswerKlpResult is unique on
    // (quizAnswerId, klpId), and `buildAnalysisWrites` now dedupes, so one
    // answer never yields two results for one KLP. Two DISTINCT KLPs is the
    // real shape, and the property that matters is still that the loop is
    // sequential — a parallel read-then-write would lose a state.
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1',
      results: [res({ klpId: 'klp1' }), res({ klpId: 'klp2' })],
      observedAt: NOW,
      load: store.load,
      save: store.save,
    })
    expect(store.rows.get('klp1')!.observations).toBe(1)
    expect(store.rows.get('klp2')!.observations).toBe(1)
  })

  it('converges with the backfill replay over the same evidence', async () => {
    const results = [
      res({ status: 'failed', mode: 'quiz-sa' }),
      res({ status: 'passed', mode: 'quiz-mc' }),
      res({ status: 'partial', mode: 'quiz-tf' }),
    ]
    const store = fakeStore()
    for (const [i, r] of results.entries()) {
      await persistKlpStates({
        userId: 'u1', results: [r], observedAt: at(i), load: store.load, save: store.save,
      })
    }

    const [rebuilt] = rebuildStatesFromResults(
      'u1',
      results.map((r, i) => ({ ...r, createdAt: at(i) })),
    )
    expect(store.rows.get('klp1')!.pKnown).toBeCloseTo(rebuilt.pKnown, 10)
    expect(store.rows.get('klp1')!.observations).toBe(rebuilt.observations)
  })

  it('stamps the answer clock, not wall time, so a replay reproduces it', async () => {
    const store = fakeStore()
    await persistKlpStates({
      userId: 'u1', results: [res()], observedAt: at(99), load: store.load, save: store.save,
    })
    expect(store.rows.get('klp1')!.lastObservedAt.getTime()).toBe(at(99).getTime())
  })
})

/**
 * B2. Re-submitting an answer deletes the prior `QuizAnswer` and cascades away
 * its `AnswerKlpResult` rows — but `KlpState` is an incremental posterior, and
 * `stepBkt` is not invertible, so nothing can subtract the deleted attempt back
 * out. The only correct response is a replay of what survives.
 */
describe('re-submission must not double-count (B2)', () => {
  const T = new Date('2026-08-07T12:00:00.000Z')
  const later = (mins: number): Date => new Date(T.getTime() + mins * 60_000)

  // The two numbers this whole task turns on, replayed from the constants
  // rather than restated: one `passed` observation, from the BKT prior.
  const ONE_PASS_SA = rebuildStatesFromResults('u1', [
    { klpId: 'k1', status: 'passed', mode: 'quiz-sa', createdAt: T },
  ])[0]
  const ONE_PASS_MC = rebuildStatesFromResults('u1', [
    { klpId: 'k1', status: 'passed', mode: 'quiz-mc', createdAt: T },
  ])[0]

  it('pins the surviving-history truth a re-submit must land on', () => {
    // After a re-submit the failed row is DELETED by the cascade. The surviving
    // history is one passed observation, so the posterior must equal a replay
    // of exactly that — never the stale value stepped a second time.
    expect(ONE_PASS_SA.observations).toBe(1)
    expect(ONE_PASS_SA.pKnown).toBeCloseTo(0.8714285714285714, 10)
    // Same shape at multiple choice's weaker evidence (guessRate 0.25).
    expect(ONE_PASS_MC.observations).toBe(1)
    expect(ONE_PASS_MC.pKnown).toBeCloseTo(0.5909090909, 8)
  })

  interface Row {
    id: string
    klpId: string
    userId: string
    status: string
    mode: string
    createdAt: Date
  }

  /**
   * A transaction client over an in-memory `AnswerKlpResult` table.
   *
   * Deliberately models two things a naive stub would paper over:
   * - `where.quizAnswer.userId` is honoured only when the query asks for it, so
   *   dropping the owner scope really does pull in another learner's rows.
   * - Without an `orderBy` the rows come back in storage order, which is what a
   *   real planner is free to do. Storage order here is NOT chronological.
   */
  function fakeTx(rows: Row[]) {
    // Both declare their `args` so assertions can read `mock.calls[0][0]`
    // directly; a zero-arg `vi.fn()` types its calls as `[]`, which has no
    // element at index 0.
    type Args = Record<string, Record<string, unknown>>
    const upsert = vi.fn(async (args: Args) => ({ args }))
    const deleteMany = vi.fn(async (args: Args) => ({ args, count: 1 }))
    const findMany = vi.fn(async (args: any) => {
      const wanted: string[] = args.where.klpId.in
      const owner: string | undefined = args.where.quizAnswer?.userId
      const hits = rows.filter(
        (r) => wanted.includes(r.klpId) && (owner === undefined || r.userId === owner),
      )
      const ordered = args.orderBy
        ? [...hits].sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
          )
        : hits
      // `select` narrows the row, as the real query does.
      return ordered.map((r) => ({
        klpId: r.klpId,
        status: r.status,
        mode: r.mode,
        createdAt: r.createdAt,
      }))
    })
    return {
      tx: { answerKlpResult: { findMany }, klpState: { upsert, deleteMany } },
      findMany,
      upsert,
      deleteMany,
    }
  }

  const written = (upsert: ReturnType<typeof vi.fn>) =>
    upsert.mock.calls[0][0] as {
      create: { pKnown: number; observations: number; lastObservedAt: Date }
      update: { pKnown: number; observations: number }
    }

  it('recomputes the posterior from surviving rows instead of stepping the stale one', async () => {
    // Fail, then re-submit as a pass. The failed row is gone with its answer,
    // so the only surviving evidence is the pass.
    const f = fakeTx([
      { id: 'r1', klpId: 'k1', userId: 'u1', status: 'passed', mode: 'quiz-sa', createdAt: T },
    ])
    await rebuildKlpStates(f.tx as any, 'u1', ['k1'])

    expect(f.upsert).toHaveBeenCalledOnce()
    const w = written(f.upsert)
    expect(w.create.observations).toBe(1)
    expect(w.create.pKnown).toBeCloseTo(ONE_PASS_SA.pKnown, 12)
    expect(w.update.observations).toBe(1)
    // Not the stale double-count: stepping the failed posterior (0.1305) by the
    // pass gives 0.7569 on TWO observations. Both are wrong.
    expect(w.create.pKnown).not.toBeCloseTo(0.7568720379146919, 6)
  })

  it('replays only this learner rows, never another user answers', async () => {
    // `AnswerKlpResult` carries no userId of its own and a `CardKlp` is shared
    // by everyone studying the set, so an unscoped read would rebuild this
    // learner's posterior partly out of strangers' evidence.
    const f = fakeTx([
      { id: 'r1', klpId: 'k1', userId: 'u1', status: 'passed', mode: 'quiz-sa', createdAt: T },
      { id: 'r2', klpId: 'k1', userId: 'u2', status: 'failed', mode: 'quiz-sa', createdAt: later(1) },
    ])
    await rebuildKlpStates(f.tx as any, 'u1', ['k1'])

    const w = written(f.upsert)
    expect(w.create.observations).toBe(1)
    expect(w.create.pKnown).toBeCloseTo(ONE_PASS_SA.pKnown, 12)
    expect(f.findMany.mock.calls[0][0].where.quizAnswer).toEqual({ userId: 'u1' })
  })

  it('deletes the state when the cascade left no surviving evidence', async () => {
    // A stale row would keep claiming knowledge from observations that no
    // longer exist — and keep the KLP above MIN_OBSERVATIONS, so downstream
    // code would call the proposition weak or strong on deleted rows.
    const f = fakeTx([
      { id: 'r1', klpId: 'k1', userId: 'u1', status: 'passed', mode: 'quiz-sa', createdAt: T },
    ])
    await rebuildKlpStates(f.tx as any, 'u1', ['k1', 'k2'])

    expect(f.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', klpId: 'k2' } })
    expect(f.upsert).toHaveBeenCalledOnce()
    expect(f.upsert.mock.calls[0][0].where).toEqual({ userId_klpId: { userId: 'u1', klpId: 'k1' } })
  })

  it('pins replay order, because tied timestamps are the norm and stepBkt is not commutative', async () => {
    // Rows written by one `createMany` share a transaction timestamp, so ties
    // are ordinary. `traceKlp`'s sort is stable, which means tied rows replay
    // in ARRIVAL order — whatever the planner returned. Same evidence, two
    // orders, two answers: pass-then-fail lands at 0.4747, fail-then-pass at
    // 0.7569. Only an ORDER BY makes the number reproducible.
    const f = fakeTx([
      { id: 'r2', klpId: 'k1', userId: 'u1', status: 'passed', mode: 'quiz-sa', createdAt: T },
      { id: 'r1', klpId: 'k1', userId: 'u1', status: 'failed', mode: 'quiz-sa', createdAt: T },
    ])
    await rebuildKlpStates(f.tx as any, 'u1', ['k1'])

    const w = written(f.upsert)
    expect(w.create.observations).toBe(2)
    // r1 (failed) before r2 (passed) — the id tiebreak, not storage order.
    expect(w.create.pKnown).toBeCloseTo(0.7568720379146919, 10)
    expect(f.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
  })

  it('touches nothing when no KLP was superseded', async () => {
    const f = fakeTx([])
    await rebuildKlpStates(f.tx as any, 'u1', [])
    expect(f.findMany).not.toHaveBeenCalled()
    expect(f.upsert).not.toHaveBeenCalled()
    expect(f.deleteMany).not.toHaveBeenCalled()
  })
})
