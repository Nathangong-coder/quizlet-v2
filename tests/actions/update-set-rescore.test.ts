import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `updateSet` re-scores a set's quiz attempts when it deletes a card (D3 of
 * docs/superpowers/specs/2026-08-12-empty-quiz-attempts-design.md).
 *
 * The load-bearing test here is "a SECOND user's attempt is re-scored". A
 * single-user test passes even with a `userId` filter accidentally added to
 * `rescoreSetAttempts`, which is the one failure mode this design is built
 * around: sets are link-shareable, so the OWNER's edit strands OTHER learners'
 * scores.
 *
 * Mocked-Prisma style follows tests/actions/klp.test.ts.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  setFindUnique: vi.fn(),
  setUpdate: vi.fn(),
  categoryDeleteMany: vi.fn(),
  categoryUpsert: vi.fn(),
  categoryFindMany: vi.fn(),
  cardFindMany: vi.fn(),
  cardDeleteMany: vi.fn(),
  cardUpdate: vi.fn(),
  cardCreate: vi.fn(),
  cardUpdateMany: vi.fn(),
  attemptFindMany: vi.fn(),
  attemptUpdate: vi.fn(),
  assetUpdateMany: vi.fn(),
  blockFindMany: vi.fn(),
  transaction: vi.fn(),
  extractKlpsForCards: vi.fn(),
  order: [] as string[],
}))

// The `tx` handed to the interactive callback delegates to the SAME mocks as
// the top-level client, so assertions work regardless of which was used.
function txClient() {
  return {
    card: {
      deleteMany: h.cardDeleteMany,
      update: h.cardUpdate,
      create: h.cardCreate,
      findMany: h.cardFindMany,
    },
    set: { update: h.setUpdate },
    cardCategory: { deleteMany: h.categoryDeleteMany, upsert: h.categoryUpsert },
    quizAttempt: { findMany: h.attemptFindMany, update: h.attemptUpdate },
  }
}

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findUnique: h.setFindUnique, update: h.setUpdate },
    cardCategory: {
      deleteMany: h.categoryDeleteMany,
      upsert: h.categoryUpsert,
      findMany: h.categoryFindMany,
    },
    card: {
      findMany: h.cardFindMany,
      deleteMany: h.cardDeleteMany,
      update: h.cardUpdate,
      create: h.cardCreate,
      updateMany: h.cardUpdateMany,
    },
    quizAttempt: { findMany: h.attemptFindMany, update: h.attemptUpdate },
    cardAsset: { updateMany: h.assetUpdateMany },
    cardContentBlock: { findMany: h.blockFindMany },
    $transaction: h.transaction,
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn }))
vi.mock('@/actions/klp', () => ({ extractKlpsForCards: h.extractKlpsForCards }))

import { updateSet } from '@/actions/sets'

const OWNER = 'user-owner'
const SET_ID = 'set-1'

/** Two cards exist; the payload only mentions `keep`, so `gone` is deleted. */
function payloadDroppingOneCard() {
  return {
    title: 'Valuation',
    cards: [{ id: 'keep', term: 'WACC', definition: 'Weighted average cost of capital.', position: 0 }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.order = []
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.setFindUnique.mockResolvedValue({ id: SET_ID, userId: OWNER })
  h.categoryFindMany.mockResolvedValue([])
  h.setUpdate.mockResolvedValue({})
  h.cardUpdate.mockResolvedValue({})
  h.cardCreate.mockResolvedValue({})
  h.attemptUpdate.mockImplementation(async () => {
    h.order.push('attempt.update')
    return {}
  })
  h.cardDeleteMany.mockImplementation(async () => {
    h.order.push('card.deleteMany')
    return { count: 1 }
  })
  h.attemptFindMany.mockImplementation(async () => {
    h.order.push('attempt.findMany')
    return []
  })

  // Two distinct shapes: the reconcile read (`select`) and the post-write
  // staleness read (`include`). klpSourceHash: null keeps `stale` empty, so
  // the KLP re-extraction path stays out of these assertions.
  h.cardFindMany.mockImplementation(async (args: { select?: unknown }) => {
    if (args?.select) return [{ id: 'keep' }, { id: 'gone' }]
    return [
      {
        id: 'keep',
        term: 'WACC',
        definition: 'Weighted average cost of capital.',
        klpSourceHash: null,
        contentBlocks: [],
      },
    ]
  })

  h.transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(txClient())
    return Promise.all(arg as Promise<unknown>[])
  })
})

describe('updateSet re-scores attempts when a card is deleted', () => {
  it("re-scores a SECOND user's attempt — there is no userId filter", async () => {
    // Ground truth AFTER the cascade: the other learner's only answer went
    // with the deleted card, so their stored 100 no longer has any evidence.
    h.attemptFindMany.mockImplementation(async () => {
      h.order.push('attempt.findMany')
      return [
        { id: 'attempt-owner', score: 50, answers: [{ score: 100 }, { score: 0 }] },
        { id: 'attempt-other-learner', score: 100, answers: [] },
      ]
    })

    const result = await updateSet(SET_ID, payloadDroppingOneCard())

    expect(result.success).toBe(true)
    expect(h.attemptUpdate).toHaveBeenCalledTimes(1)
    expect(h.attemptUpdate).toHaveBeenCalledWith({
      where: { id: 'attempt-other-learner' },
      data: { score: null },
    })

    // The query must not be owner-scoped, or the whole feature is a no-op for
    // exactly the learners it exists to protect.
    const where = h.attemptFindMany.mock.calls[0][0].where
    expect(where).toEqual({ setId: SET_ID })
    expect(where).not.toHaveProperty('userId')
  })

  it('re-scores a partially-emptied attempt from surviving answers', async () => {
    h.attemptFindMany.mockResolvedValue([
      { id: 'a', score: 96, answers: [{ score: 100 }, { score: 100 }, { score: 85 }] },
    ])

    await updateSet(SET_ID, payloadDroppingOneCard())

    expect(h.attemptUpdate).toHaveBeenCalledWith({ where: { id: 'a' }, data: { score: 95 } })
  })

  it('reads the attempts AFTER the card delete lands', async () => {
    // The reason the array-form $transaction had to become interactive: the
    // re-score must see post-cascade state, not pre-cascade state.
    await updateSet(SET_ID, payloadDroppingOneCard())

    expect(h.order.indexOf('card.deleteMany')).toBeGreaterThanOrEqual(0)
    expect(h.order.indexOf('attempt.findMany')).toBeGreaterThan(
      h.order.indexOf('card.deleteMany'),
    )
  })

  it('does not touch attempts when no card is deleted', async () => {
    h.cardFindMany.mockImplementation(async (args: { select?: unknown }) => {
      if (args?.select) return [{ id: 'keep' }]
      return [
        {
          id: 'keep',
          term: 'WACC',
          definition: 'Weighted average cost of capital.',
          klpSourceHash: null,
          contentBlocks: [],
        },
      ]
    })

    const result = await updateSet(SET_ID, payloadDroppingOneCard())

    expect(result.success).toBe(true)
    expect(h.cardDeleteMany).not.toHaveBeenCalled()
    expect(h.attemptFindMany).not.toHaveBeenCalled()
    expect(h.attemptUpdate).not.toHaveBeenCalled()
  })

  it('leaves an already-correct attempt alone', async () => {
    h.attemptFindMany.mockResolvedValue([
      { id: 'a', score: 50, answers: [{ score: 100 }, { score: 0 }] },
    ])

    await updateSet(SET_ID, payloadDroppingOneCard())

    expect(h.attemptUpdate).not.toHaveBeenCalled()
  })
})

describe('updateSet card transaction (interactive-form conversion guard)', () => {
  it('still applies delete, update, create and the set write, in that order', async () => {
    const order: string[] = []
    h.cardDeleteMany.mockImplementation(async () => {
      order.push('delete')
      return { count: 1 }
    })
    h.cardUpdate.mockImplementation(async () => {
      order.push('update')
      return {}
    })
    h.cardCreate.mockImplementation(async () => {
      order.push('create')
      return {}
    })
    h.setUpdate.mockImplementation(async () => {
      order.push('set')
      return {}
    })
    h.attemptFindMany.mockResolvedValue([])

    const result = await updateSet(SET_ID, {
      title: 'Valuation',
      description: 'desc',
      cards: [
        { id: 'keep', term: 'WACC', definition: 'Weighted average cost of capital.', position: 0 },
        { term: 'Beta', definition: 'Systematic risk.', position: 1 },
      ],
    })

    expect(result.success).toBe(true)
    expect(order).toEqual(['delete', 'update', 'create', 'set'])
    expect(h.cardDeleteMany).toHaveBeenCalledWith({
      where: { setId: SET_ID, id: { in: ['gone'] } },
    })
    expect(h.setUpdate).toHaveBeenCalledWith({
      where: { id: SET_ID },
      data: { title: 'Valuation', description: 'desc' },
    })
  })
})
