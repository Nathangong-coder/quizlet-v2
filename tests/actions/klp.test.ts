import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  createMany: vi.fn(),
  klpUpdateMany: vi.fn(),
  klpFindMany: vi.fn(),
  generateJson: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    card: { findMany: h.findMany, update: h.update, updateMany: h.updateMany },
    cardKlp: {
      aggregate: h.aggregate,
      createMany: h.createMany,
      updateMany: h.klpUpdateMany,
      findMany: h.klpFindMany,
    },
    $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
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

import { extractKlpsForCards, KLP_BATCH_SIZE } from '@/actions/klp'

const card = (id: string) => ({
  id,
  term: `term-${id}`,
  definition: `def-${id}`,
  setId: 'set-1',
  contentBlocks: [],
  set: { title: 'M&A Basics' },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.aggregate.mockResolvedValue({ _max: { version: 0 } })
  h.createMany.mockResolvedValue({})
  h.klpUpdateMany.mockResolvedValue({})
  h.update.mockResolvedValue({})
  h.updateMany.mockResolvedValue({})
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

  it('does nothing when given no card ids', async () => {
    await extractKlpsForCards('u1', [])
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})
