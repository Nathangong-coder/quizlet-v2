import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The over-application guard, in behaviour.
 *
 * `ANSWERED_ATTEMPT_WHERE = { answers: { some: {} } }` (src/lib/quiz/history.ts)
 * is correct on the two read-only history surfaces and catastrophic anywhere
 * near an in-flight attempt: a `QuizAttempt` has ZERO `QuizAnswer` rows from
 * creation until the learner's first submit. If the predicate ever reaches
 * `startQuizAttempt` or `getQuizAttemptCards`, the attempt the learner just
 * started stops being findable and the FIRST QUESTION OF EVERY QUIZ fails to
 * load — a total outage of quizzing, not a display bug.
 *
 * `tests/quiz/history.test.ts` guards the same rule at the SOURCE level, by
 * scanning `src/` for files referencing the constant. That catches a new call
 * site by name. It cannot catch the in-flight path breaking for any other
 * reason — an inlined `answers: { some: {} }` written by hand, a shared `where`
 * builder that grows the clause, a `select`/`include` change that drops
 * `selectedCardIds`. This file covers the behaviour instead, end to end:
 * `startQuizAttempt` creates the attempt, and `getQuizAttemptCards` reads back
 * THAT id, with the store holding zero answers for it throughout.
 *
 * THE MOCK HONOURS THE `where` IT RECEIVES. This is the whole design of the
 * file, and the same technique as `tests/actions/user-stats-empty-attempts.test.ts`:
 * a mock that returns a fixed attempt row no matter what it is asked cannot
 * detect a filter being applied to it, so it would stay green through the exact
 * regression it claims to guard. Here `quizAttempt.findFirst` queries a tiny
 * in-memory store, and a `where.answers` clause genuinely excludes the
 * zero-answer attempt — see the harness self-check at the bottom, which proves
 * the discrimination rather than assuming it.
 *
 * Mocking conventions follow tests/actions/quiz-submit-ownership.test.ts and
 * tests/actions/discard-skipped-attempt.test.ts (no live-DB harness exists).
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  setFindFirst: vi.fn(),
  answerFindMany: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptCreate: vi.fn(),
  sessionCreate: vi.fn(),
  cardFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findFirst: h.setFindFirst },
    quizAnswer: { findMany: h.answerFindMany },
    quizAttempt: { findFirst: h.attemptFindFirst, create: h.attemptCreate },
    studySession: { create: h.sessionCreate },
    card: { findMany: h.cardFindMany },
    $transaction: h.transaction,
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: vi.fn(),
  resolveTaskModel: vi.fn(),
  AiGenerationError: class extends Error {},
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: vi.fn() }))
vi.mock('@/lib/quiz/coin-flip', () => ({ pickTfVariant: vi.fn() }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: vi.fn() }))
vi.mock('@/lib/memory/erase-execute', () => ({ executeErasure: vi.fn() }))

import { startQuizAttempt, getQuizAttemptCards } from '@/actions/quiz'
import type { QuizSetup } from '@/lib/quiz/setup'

const LEARNER = 'user-learner'
const SET_ID = 'set-1'

const CARDS = [
  { id: 'card-1', term: 'EBITDA', definition: 'Earnings before interest, taxes, D&A.' },
  { id: 'card-2', term: 'WACC', definition: 'Weighted average cost of capital.' },
  { id: 'card-3', term: 'FCF', definition: 'Free cash flow.' },
]

const SETUP: QuizSetup = {
  questionMode: ['multiple-choice'],
  promptSide: 'term',
  categoryIds: [],
  starredOnly: false,
  failedOnly: false,
  printable: false,
  questionCount: 3,
}

/**
 * The store. `answers` is a real (empty) list, not a count — an in-flight
 * attempt owns zero `QuizAnswer` rows, which is precisely the state that makes
 * the history predicate lethal here.
 */
type StoredAttempt = {
  id: string
  userId: string
  setId: string
  selectedCardIds: string[]
  printable: boolean
  answers: unknown[]
}
/** The subset of `quizAttempt.create`'s `data` this harness reads. Narrow on
 *  purpose: the rest is spread through untouched, and naming only what the
 *  store depends on keeps the mock from drifting into a second schema. */
type AttemptCreateData = {
  userId: string
  setId: string
  selectedCardIds: string[]
  printable?: boolean
}

let attempts: StoredAttempt[] = []
let nextId = 0

/**
 * Evaluate a Prisma-shaped `where` against the store instead of ignoring it.
 *
 * The `answers` branch is the load-bearing one: `ANSWERED_ATTEMPT_WHERE` is the
 * only attempt-relation predicate this codebase can pass, and it means "at
 * least one answer", so any `answers` key excludes a zero-answer row. If the
 * production code starts sending it, `findFirst` returns null and the actions
 * below fail with 'Attempt not found' — which is exactly what a learner would
 * see in the browser.
 */
/** Only the keys these two actions actually send. Typed rather than
 *  `Record<string, any>` so a production query growing a NEW key is a
 *  type error here, instead of being silently ignored by the matcher. */
type AttemptWhere = {
  id?: string
  userId?: string
  setId?: string
  answers?: unknown
}

function matches(attempt: StoredAttempt, where: AttemptWhere = {}): boolean {
  if (where.id !== undefined && attempt.id !== where.id) return false
  if (where.userId !== undefined && attempt.userId !== where.userId) return false
  if (where.setId !== undefined && attempt.setId !== where.setId) return false
  if (where.answers !== undefined && attempt.answers.length === 0) return false
  return true
}

beforeEach(() => {
  vi.clearAllMocks()
  attempts = []
  nextId = 0

  h.auth.mockResolvedValue({ user: { id: LEARNER } })

  h.setFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === SET_ID
      ? {
          id: SET_ID,
          userId: LEARNER,
          visibility: 'private',
          cards: CARDS.map((c) => ({ ...c, setId: SET_ID, categoryAssignments: [], progress: [] })),
        }
      : null,
  )
  // No prior answers anywhere: this learner has never submitted anything.
  h.answerFindMany.mockResolvedValue([])

  h.sessionCreate.mockImplementation(async () => ({ id: `session-${++nextId}` }))
  h.attemptCreate.mockImplementation(async ({ data }: { data: AttemptCreateData }) => {
    const created: StoredAttempt = {
      ...data,
      id: `attempt-${++nextId}`,
      printable: data.printable ?? false,
      // Zero answers — the state under test. An in-flight attempt has none
      // until the learner's first submit. Written AFTER the spread so `data`
      // cannot reintroduce a value; before it, the field was assigned and then
      // silently overwritten, which `Record<string, any>` hid from tsc.
      answers: [],
    }
    attempts.push(created)
    return created
  })
  // Interactive form: the action passes a callback and gets `tx`. Same client
  // shape, so the store is shared between transactional and direct reads.
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      studySession: { create: h.sessionCreate },
      quizAttempt: { create: h.attemptCreate, findFirst: h.attemptFindFirst },
    }),
  )

  h.attemptFindFirst.mockImplementation(
    async ({ where }: { where: AttemptWhere }) =>
      attempts.find((a) => matches(a, where)) ?? null,
  )
  h.cardFindMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      CARDS.filter((c) => where.id.in.includes(c.id)).map((c) => ({ ...c, contentBlocks: [] })),
  )
})

describe('an in-flight, zero-answer attempt still flows end to end', () => {
  it('startQuizAttempt returns an attempt id for a learner with no answers', async () => {
    const result = await startQuizAttempt(SET_ID, ['multiple-choice'], SETUP)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.attemptId).toBeTruthy()
    expect(result.data.cardIds).toHaveLength(3)
    // The row it created really does have no answers — the premise of every
    // assertion below, asserted rather than assumed.
    expect(attempts).toHaveLength(1)
    expect(attempts[0].answers).toEqual([])
  })

  it('getQuizAttemptCards resolves the deck for that same attempt', async () => {
    // The regression that matters. Filtering here means the learner starts a
    // quiz and the first question never loads.
    const started = await startQuizAttempt(SET_ID, ['multiple-choice'], SETUP)
    if (!started.success) throw new Error(started.error)

    const result = await getQuizAttemptCards(started.data.attemptId)

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    // Ordered by the attempt's own selectedCardIds, so this holds through the
    // action's shuffle.
    expect(result.data.cards.map((c: { id: string }) => c.id)).toEqual(started.data.cardIds)
  })

  it('does not send an answers predicate to the in-flight lookup', async () => {
    // The mechanism assertion, on top of the behavioural one above: the
    // behaviour could conceivably survive a filter through some future
    // fallback, but a `where` carrying `answers` is unambiguously the bug.
    const started = await startQuizAttempt(SET_ID, ['multiple-choice'], SETUP)
    if (!started.success) throw new Error(started.error)

    await getQuizAttemptCards(started.data.attemptId)

    const where = h.attemptFindFirst.mock.calls.at(-1)![0].where
    expect(where).toEqual({ id: started.data.attemptId, userId: LEARNER })
    expect(where).not.toHaveProperty('answers')
  })

  it('keeps the owner scope on the in-flight lookup', async () => {
    // Not filtering must not become not guarding: the fix for over-application
    // is to leave the clause off, never to loosen the `where` wholesale.
    const started = await startQuizAttempt(SET_ID, ['multiple-choice'], SETUP)
    if (!started.success) throw new Error(started.error)
    h.auth.mockResolvedValue({ user: { id: 'someone-else' } })

    const result = await getQuizAttemptCards(started.data.attemptId)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected a foreign attempt to be refused')
    expect(result.error).toBe('Attempt not found')
  })
})

/**
 * Proof that the harness can fail.
 *
 * A behavioural regression test built on a mock is only worth its assertions if
 * the mock actually reacts to the query. This asserts the counterfactual
 * directly — the same store, asked WITH the predicate, does not find the
 * in-flight attempt — so the four green tests above are green because the
 * production code omits the clause, not because the mock is inert.
 */
describe('the mock discriminates (harness self-check)', () => {
  it('the same store hides the attempt once an answers predicate is added', async () => {
    const started = await startQuizAttempt(SET_ID, ['multiple-choice'], SETUP)
    if (!started.success) throw new Error(started.error)
    const id = started.data.attemptId

    expect(await h.attemptFindFirst({ where: { id, userId: LEARNER } })).not.toBeNull()
    // This is the shape `ANSWERED_ATTEMPT_WHERE` would introduce.
    expect(
      await h.attemptFindFirst({ where: { id, userId: LEARNER, answers: { some: {} } } }),
    ).toBeNull()
  })

  it('an attempt that HAS answers survives the predicate', async () => {
    // The complement: the store excludes on emptiness, not on the mere presence
    // of the key, so the check above is a real filter and not a blanket null.
    const started = await startQuizAttempt(SET_ID, ['multiple-choice'], SETUP)
    if (!started.success) throw new Error(started.error)
    attempts[0].answers = [{ id: 'answer-1' }]

    expect(
      await h.attemptFindFirst({
        where: { id: started.data.attemptId, userId: LEARNER, answers: { some: {} } },
      }),
    ).not.toBeNull()
  })
})
