import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2, end to end through `submitShortAnswer`.
 *
 * Re-submitting deletes the prior `QuizAnswer`, and the cascade takes its
 * `AnswerKlpResult` rows with it — but `KlpState` is an incremental posterior
 * that nothing rolled back, so the next submit stepped a number that had
 * already absorbed the deleted attempt. Short-answer re-submit is an advertised
 * feature, so this fired in ordinary use.
 *
 * Follows the mocking pattern in tests/actions/analysis-short-answer.test.ts,
 * but with a real in-memory store behind the transaction client so the cascade,
 * the replay read, and the state writes all see each other.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generateJson: vi.fn(),
  ensureKlpsReady: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdate: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerFindMany: vi.fn(),
  cardFindUnique: vi.fn(),
  progressFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, update: h.attemptUpdate },
    // Registered so the test can assert the delete no longer runs out here.
    quizAnswer: { deleteMany: h.answerDeleteMany, findMany: h.answerFindMany },
    card: { findUnique: h.cardFindUnique },
    cardProgress: { findUnique: h.progressFindUnique },
    $transaction: h.transaction,
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  resolveTaskModel: vi.fn(),
  AiGenerationError: class extends Error {
    constructor(public detail: { title: string; attempts: unknown[] }) {
      super('ai generation failed')
    }
  },
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: h.ensureKlpsReady }))
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: vi.fn() }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: vi.fn() }))

import { submitShortAnswer } from '@/actions/quiz'
import { rebuildStatesFromResults } from '@/lib/metrics/cache'

const OWNER = 'user-owner'
const ATTEMPT_ID = 'a1'
const CARD_ID = 'c1'
const KLP = 'klp-a'

const FIRST_AT = new Date('2026-08-07T12:00:00.000Z')
const SECOND_AT = new Date('2026-08-07T12:05:00.000Z')

const card = {
  id: CARD_ID,
  term: 'WACC',
  definition: 'Weighted Average Cost of Capital',
  setId: 'set1',
  // No blocks -> `termBlocks.every(...)` is vacuously true -> text-only path.
  contentBlocks: [],
}

const gradeShape = {
  clarity: { score: 8, pros: [], cons: [] },
  conciseness: { score: 7, pros: [], cons: [] },
  correctness: { score: 9, pros: [], cons: [] },
  overall: 8,
  summary: 'ok',
  suggestedImprovement: 'x',
}

interface AnswerRow {
  id: string
  attemptId: string
  userId: string
  cardId: string
  mode: string
  createdAt: Date
}
interface ResultRow {
  id: string
  quizAnswerId: string
  klpId: string
  status: string
  mode: string
  createdAt: Date
}
interface StateRow {
  pKnown: number
  observations: number
  lastObservedAt: Date
}

/**
 * A round trip to the database. Every fake query below pays it.
 *
 * Load-bearing: a stub that resolves in the same microtask lets an UNAWAITED
 * rebuild still finish before the transaction callback returns, so the test
 * cannot tell a correctly-awaited rebuild from a floating one. A real query
 * cannot come back that fast.
 */
const roundTrip = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The database `createAnswerWithAnalysis`'s transaction writes through. */
function makeStore() {
  let answers: AnswerRow[] = []
  let results: ResultRow[] = []
  const states = new Map<string, StateRow>()
  let seq = 0
  /** Wall clock for the answer being written, set per submit. */
  let clock = FIRST_AT
  /** Captures `states` the instant the transaction callback returns. */
  let atCommit: StateRow | undefined
  let insideTx = false
  const deletedInsideTx: boolean[] = []

  /**
   * Prisma's interactive-transaction client is dead once the callback resolves
   * — any later call throws "Transaction already closed". Modelled, so work
   * that escapes the transaction fails loudly instead of quietly succeeding.
   */
  const query = async () => {
    if (!insideTx) throw new Error('Transaction already closed')
    await roundTrip()
    if (!insideTx) throw new Error('Transaction already closed')
  }

  const matches = (r: AnswerRow, w: Record<string, unknown>) =>
    r.attemptId === w.attemptId &&
    r.userId === w.userId &&
    r.cardId === w.cardId &&
    r.mode === w.mode

  const tx = {
    quizAnswer: {
      findMany: async ({ where }: any) => {
        await query()
        return answers
          .filter((a) => matches(a, where))
          .map((a) => ({
            klpResults: results
              .filter((r) => r.quizAnswerId === a.id)
              .map((r) => ({ klpId: r.klpId })),
          }))
      },
      deleteMany: async ({ where }: any) => {
        deletedInsideTx.push(insideTx)
        await query()
        const gone = answers.filter((a) => matches(a, where)).map((a) => a.id)
        answers = answers.filter((a) => !gone.includes(a.id))
        // The cascade under test: AnswerKlpResult declares onDelete: Cascade.
        results = results.filter((r) => !gone.includes(r.quizAnswerId))
        return { count: gone.length }
      },
      create: async ({ data }: any) => {
        await query()
        const row = { ...data, id: `answer-${seq++}`, createdAt: clock }
        answers.push(row)
        return row
      },
    },
    answerKlpResult: {
      createMany: async ({ data }: any) => {
        await query()
        for (const d of data) {
          // One createMany shares a transaction timestamp in Postgres, so
          // sibling rows tie on createdAt — which is why the replay query
          // needs an explicit id tiebreak.
          results.push({ ...d, id: `res-${seq++}`, createdAt: clock })
        }
        return { count: data.length }
      },
      findMany: async ({ where, orderBy }: any) => {
        await query()
        const owner: string | undefined = where.quizAnswer?.userId
        const hits = results.filter((r) => {
          if (!where.klpId.in.includes(r.klpId)) return false
          if (owner === undefined) return true
          const parent = answers.find((a) => a.id === r.quizAnswerId)
          return parent?.userId === owner
        })
        // Without an ORDER BY a real planner may return any order; storage
        // order here is deliberately not chronological once rows are replaced.
        const ordered = orderBy
          ? [...hits].sort(
              (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
            )
          : hits
        return ordered.map((r) => ({
          klpId: r.klpId,
          status: r.status,
          mode: r.mode,
          createdAt: r.createdAt,
        }))
      },
    },
    answerErrorTag: {
      createMany: async () => {
        await query()
        return { count: 0 }
      },
    },
    klpState: {
      findUnique: async ({ where }: any) => {
        await query()
        const { userId, klpId } = where.userId_klpId
        const s = states.get(klpId)
        return s ? { userId, klpId, ...s } : null
      },
      upsert: async ({ where, create, update }: any) => {
        await query()
        const { klpId } = where.userId_klpId
        const data = states.has(klpId) ? update : create
        states.set(klpId, {
          pKnown: data.pKnown,
          observations: data.observations,
          lastObservedAt: data.lastObservedAt,
        })
        return {}
      },
      deleteMany: async ({ where }: any) => {
        await query()
        states.delete(where.klpId)
        return { count: 1 }
      },
    },
  }

  return {
    states,
    answers: () => answers,
    results: () => results,
    deletedInsideTx,
    commitSnapshot: () => atCommit,
    setClock: (d: Date) => {
      clock = d
    },
    run: async (fn: (client: unknown) => unknown) => {
      insideTx = true
      try {
        return await fn(tx)
      } finally {
        insideTx = false
        const s = states.get(KLP)
        atCommit = s ? { ...s } : undefined
      }
    },
  }
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  vi.clearAllMocks()
  store = makeStore()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue({ sessionId: 'sess1' })
  h.answerFindMany.mockResolvedValue([])
  h.attemptUpdate.mockResolvedValue({})
  h.cardFindUnique.mockResolvedValue(card)
  h.progressFindUnique.mockResolvedValue(null)
  h.ensureKlpsReady.mockResolvedValue([
    { id: KLP, index: 0, text: 'x', weight: 5, kind: 'definition' },
  ])
  h.transaction.mockImplementation((fn: (client: unknown) => unknown) => store.run(fn))
})

const gradeWith = (status: string) => ({
  ...gradeShape,
  klpResults: [{ klpRef: 0, status }],
  errorTags: [],
})

async function submit(status: string, at: Date) {
  store.setClock(at)
  h.generateJson.mockResolvedValue(gradeWith(status))
  return submitShortAnswer({ attemptId: ATTEMPT_ID, cardId: CARD_ID, answer: 'text' })
}

describe('re-submit rebuilds rather than accumulating (B2)', () => {
  // The truth: one passed short-answer observation replayed from the prior.
  const TRUTH = rebuildStatesFromResults(OWNER, [
    { klpId: KLP, status: 'passed', mode: 'quiz-sa', createdAt: SECOND_AT },
  ])[0]
  /** What the defect produced: the failed posterior stepped by the pass. */
  const STALE_DOUBLE_COUNT = 0.7568720379146919

  it('a failed-then-resubmitted-passed answer yields the same state as one passed answer', async () => {
    await submit('failed', FIRST_AT)
    expect(store.states.get(KLP)!.observations).toBe(1)

    await submit('passed', SECOND_AT)

    // Exactly one answer and one result row survive the replacement.
    expect(store.answers()).toHaveLength(1)
    expect(store.results()).toHaveLength(1)

    const final = store.states.get(KLP)!
    expect(final.observations).toBe(1)
    expect(final.pKnown).toBeCloseTo(TRUTH.pKnown, 12)
    expect(final.pKnown).toBeCloseTo(0.8714285714285714, 10)
    // The defect: two observations on evidence that is one row, at a posterior
    // that folded in an attempt the cascade already deleted.
    expect(final.observations).not.toBe(2)
    expect(final.pKnown).not.toBeCloseTo(STALE_DOUBLE_COUNT, 6)
  })

  it('the rebuild commits with the transaction, not after it', async () => {
    // An unawaited rebuild would leave the stale stepped value in place at
    // commit and only correct it later — outside the atomic unit, where a
    // rollback or crash keeps the double-counted posterior forever.
    await submit('failed', FIRST_AT)
    await submit('passed', SECOND_AT)

    const atCommit = store.commitSnapshot()!
    expect(atCommit.observations).toBe(1)
    expect(atCommit.pKnown).toBeCloseTo(TRUTH.pKnown, 12)
  })

  it('deletes the prior answer inside the transaction, never outside it', async () => {
    // Deleting outside meant a failure between the delete and the insert lost
    // the learner's answer entirely.
    await submit('failed', FIRST_AT)
    await submit('passed', SECOND_AT)

    expect(h.answerDeleteMany).not.toHaveBeenCalled()
    expect(store.deletedInsideTx).toEqual([true, true])
  })

  it('drops the state entirely when the re-submit attributes nothing', async () => {
    // Re-graded with no per-KLP outcome: the old row is cascaded away and
    // nothing replaces it, so a surviving KlpState would claim knowledge from
    // evidence that no longer exists.
    await submit('failed', FIRST_AT)
    expect(store.states.has(KLP)).toBe(true)

    store.setClock(SECOND_AT)
    h.generateJson.mockResolvedValue({ ...gradeShape, klpResults: [], errorTags: [] })
    await submitShortAnswer({ attemptId: ATTEMPT_ID, cardId: CARD_ID, answer: 'text' })

    expect(store.results()).toHaveLength(0)
    expect(store.states.has(KLP)).toBe(false)
  })
})
