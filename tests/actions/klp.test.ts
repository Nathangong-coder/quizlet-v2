import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  createMany: vi.fn(),
  klpUpdateMany: vi.fn(),
  klpFindMany: vi.fn(),
  klpFindFirst: vi.fn(),
  klpUpdate: vi.fn(),
  generateJson: vi.fn(),
  transaction: vi.fn(),
  auth: vi.fn(),
  revalidatePath: vi.fn(),
}))

/**
 * Default `$transaction` behavior: supports both the array form (unused by
 * the current implementation, kept for safety) and the interactive
 * `(tx) => ...` form the version-write path uses. The `tx` handed to the
 * callback delegates to the SAME mocks as the top-level `prisma` client, so
 * assertions against `h.aggregate` / `h.createMany` / etc. work whether the
 * code called `prisma.x` or `tx.x`. Individual tests override
 * `h.transaction.mockImplementation` to inject a mid-transaction failure.
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = {
      cardKlp: {
        aggregate: h.aggregate,
        createMany: h.createMany,
        updateMany: h.klpUpdateMany,
        findMany: h.klpFindMany,
      },
      card: { update: h.update, updateMany: h.updateMany, findMany: h.findMany },
    }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    card: { findMany: h.findMany, findFirst: h.findFirst, update: h.update, updateMany: h.updateMany },
    cardKlp: {
      aggregate: h.aggregate,
      createMany: h.createMany,
      updateMany: h.klpUpdateMany,
      findMany: h.klpFindMany,
      findFirst: h.klpFindFirst,
      update: h.klpUpdate,
    },
    $transaction: h.transaction,
  },
}))

vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  AiGenerationError: class extends Error {
    constructor(public detail: { attempts: unknown[] }) {
      super('ai failed')
    }
  },
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))

import {
  extractKlpsForCards,
  KLP_BATCH_SIZE,
  getCardKlps,
  saveCardKlp,
} from '@/actions/klp'

const card = (id: string) => ({
  id,
  term: `term-${id}`,
  definition: `def-${id}`,
  setId: 'set-1',
  contentBlocks: [],
  set: { title: 'M&A Basics' },
})

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.aggregate.mockResolvedValue({ _max: { version: 0 } })
  h.createMany.mockResolvedValue({})
  h.klpUpdateMany.mockResolvedValue({})
  h.update.mockResolvedValue({})
  h.updateMany.mockResolvedValue({})
  h.transaction.mockImplementation(defaultTransactionImpl)
  h.auth.mockResolvedValue({ user: { id: OWNER } })
})

describe('extractKlpsForCards', () => {
  it('batches cards so a 100-card import is not 100 calls', async () => {
    h.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => card(`c${i}`)),
    )
    h.generateJson.mockImplementation(async ({ prompt }: { prompt: string }) => ({
      cards: [...prompt.matchAll(/\[(\d+)\]/g)].map((m) => ({
        ref: Number(m[1]),
        cardType: 'compound' as const,
        klps: [{ text: 'a point', weight: 3, kind: 'definition' as const }],
      })),
    }))

    await extractKlpsForCards('u1', Array.from({ length: 25 }, (_, i) => `c${i}`))

    expect(KLP_BATCH_SIZE).toBe(10)
    expect(h.generateJson).toHaveBeenCalledTimes(3) // 10 + 10 + 5
  })

  it('writes a new version and supersedes the previous one', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.aggregate.mockResolvedValue({ _max: { version: 2 } })
    h.generateJson.mockResolvedValue({
      cards: [
        {
          ref: 0,
          cardType: 'compound',
          klps: [{ text: 'a point', weight: 4, kind: 'causal' }],
        },
      ],
    })

    await extractKlpsForCards('u1', ['c1'])

    expect(h.klpUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardId: 'c1', supersededAt: null },
        data: { supersededAt: expect.any(Date) },
      }),
    )
    expect(h.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ cardId: 'c1', version: 3, index: 0, weight: 4, kind: 'causal' }),
        ],
      }),
    )
  })

  it('marks the card ready with the hash that produced its KLPs', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockResolvedValue({
      cards: [{ ref: 0, cardType: 'atomic', klps: [{ text: 'x', weight: 5, kind: 'definition' }] }],
    })

    await extractKlpsForCards('u1', ['c1'])

    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          klpStatus: 'ready',
          klpVersion: 1,
          klpSourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          klpError: null,
        }),
      }),
    )
  })

  it('marks the batch failed without throwing, so a save is never blocked', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockRejectedValue(new Error('provider exploded'))

    await expect(extractKlpsForCards('u1', ['c1'])).resolves.toBeUndefined()

    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c1'] } },
        data: expect.objectContaining({ klpStatus: 'failed' }),
      }),
    )
  })

  it('skips rather than fails when the user has no usable credential', async () => {
    // An empty `attempts` list is the empty-pool signal: no key saved, or every
    // key disabled. 'skipped' must not surface a retry button — there is
    // nothing to retry until the user adds a key.
    const { AiGenerationError } = await import('@/lib/ai/generate')
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockRejectedValue(new (AiGenerationError as any)({ attempts: [] }))

    await extractKlpsForCards('u1', ['c1'])

    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ klpStatus: 'skipped' }),
      }),
    )
  })

  it('does not clobber a card that already committed when a later entry in the batch fails', async () => {
    // c1's write commits fine; c2's write blows up mid-transaction. Only c2
    // may end up marked 'failed' — c1 must keep its committed 'ready' status.
    h.findMany.mockResolvedValue([card('c1'), card('c2')])
    h.generateJson.mockResolvedValue({
      cards: [
        { ref: 0, cardType: 'atomic', klps: [{ text: 'ok', weight: 3, kind: 'definition' }] },
        { ref: 1, cardType: 'atomic', klps: [{ text: 'boom', weight: 3, kind: 'definition' }] },
      ],
    })

    let call = 0
    h.transaction.mockImplementation((arg: unknown) => {
      if (typeof arg !== 'function') return Promise.all(arg as Promise<unknown>[])
      call += 1
      if (call === 2) return Promise.reject(new Error('write failed for c2'))
      return defaultTransactionImpl(arg)
    })

    await extractKlpsForCards('u1', ['c1', 'c2'])

    // c1 committed successfully.
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ klpStatus: 'ready' }),
      }),
    )

    // Only c2 is written as failed.
    const failedCalls = h.updateMany.mock.calls.filter(
      ([arg]) => arg?.data?.klpStatus === 'failed',
    )
    expect(failedCalls).toHaveLength(1)
    expect(failedCalls[0][0].where).toEqual({ id: { in: ['c2'] } })
  })

  it('retries once on a concurrent version-write race then succeeds', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockResolvedValue({
      cards: [{ ref: 0, cardType: 'atomic', klps: [{ text: 'x', weight: 5, kind: 'definition' }] }],
    })

    let call = 0
    h.transaction.mockImplementation((arg: unknown) => {
      if (typeof arg !== 'function') return Promise.all(arg as Promise<unknown>[])
      call += 1
      if (call === 1) {
        const raceErr = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        return Promise.reject(raceErr)
      }
      return defaultTransactionImpl(arg)
    })

    await extractKlpsForCards('u1', ['c1'])

    expect(h.transaction).toHaveBeenCalledTimes(2)
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ klpStatus: 'ready' }),
      }),
    )
    // The race must not surface as a batch failure.
    expect(h.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ klpStatus: 'failed' }) }),
    )
  })

  it('ignores a hallucinated ref instead of writing to the wrong card', async () => {
    h.findMany.mockResolvedValue([card('c1'), card('c2'), card('c3')])
    h.generateJson.mockResolvedValue({
      cards: [{ ref: 7, cardType: 'atomic', klps: [{ text: 'x', weight: 3, kind: 'definition' }] }],
    })

    await expect(extractKlpsForCards('u1', ['c1', 'c2', 'c3'])).resolves.toBeUndefined()

    expect(h.createMany).not.toHaveBeenCalled()
    expect(h.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ klpStatus: 'failed' }) }),
    )
  })

  it("scopes the card load by owner, so a foreign card id extracts nothing", async () => {
    // The owner-scoped findMany returns nothing for a card belonging to
    // someone else, so no generation and no CardKlp write happens.
    h.findMany.mockResolvedValue([])

    await extractKlpsForCards('u1', ['card-not-mine'])

    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['card-not-mine'] }, set: { userId: 'u1' } },
      }),
    )
    expect(h.generateJson).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
    expect(h.klpUpdateMany).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('does nothing when given no card ids', async () => {
    await extractKlpsForCards('u1', [])
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})

describe('getCardKlps', () => {
  it('rejects a card the user does not own', async () => {
    // findFirst is owner-scoped in the action's `where`; simulate the DB
    // finding nothing because the card belongs to a different user.
    h.findFirst.mockResolvedValue(null)

    const res = await getCardKlps('card-not-mine')

    expect(res).toEqual({ success: false, error: 'Card not found' })
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-not-mine', set: { userId: OWNER } },
      }),
    )
    expect(h.klpFindMany).not.toHaveBeenCalled()
  })

  it('returns the live klps and status for a card the user owns', async () => {
    h.findFirst.mockResolvedValue({ klpStatus: 'ready' })
    h.klpFindMany.mockResolvedValue([
      { id: 'k1', index: 0, text: 'a point', weight: 3, kind: 'definition' },
    ])

    const res = await getCardKlps('card-1')

    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data.status).toBe('ready')
    expect(res.data.klps).toHaveLength(1)
    expect(h.klpFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cardId: 'card-1', supersededAt: null } }),
    )
  })
})

describe('saveCardKlp', () => {
  it("rejects a KLP whose card the user does not own", async () => {
    // findFirst is owner-scoped through card.set.userId; simulate not found.
    h.klpFindFirst.mockResolvedValue(null)

    const res = await saveCardKlp('klp-not-mine', { text: 'x', weight: 3, kind: 'definition' })

    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.klpFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'klp-not-mine', card: { set: { userId: OWNER } } },
      }),
    )
    expect(h.klpUpdate).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it("writes source: 'user' and re-stamps the card's klpSourceHash", async () => {
    h.klpFindFirst.mockResolvedValue({
      id: 'klp-1',
      cardId: 'card-1',
      card: {
        setId: 'set-1',
        term: 'EBITDA',
        definition: 'Earnings before interest, taxes, depreciation, and amortization',
        contentBlocks: [],
      },
    })

    const res = await saveCardKlp('klp-1', { text: 'corrected text', weight: 5, kind: 'causal' })

    expect(res).toEqual({ success: true, data: undefined })
    expect(h.klpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'klp-1' },
        data: expect.objectContaining({
          text: 'corrected text',
          weight: 5,
          kind: 'causal',
          source: 'user',
        }),
      }),
    )
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-1' },
        data: expect.objectContaining({
          klpSourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          klpStatus: 'ready',
        }),
      }),
    )
  })
})
