import { describe, it, expect, vi } from 'vitest'
import {
  AUTHORED_PROMPT_VERSION,
  CARDS_PER_RUN,
  RUN_BUDGET_MS,
  findUnauthoredCards,
  sweepReusable,
  outOfTime,
} from '@/lib/klp/background-authoring'
import type { PrismaClient } from '@prisma/client'

/**
 * The policy half of the background authoring cron: which cards, how many, and
 * what gets served for free. The interesting failure is not an HTTP failure —
 * it is spending a use-it-or-lose-it daily quota on the wrong cards.
 */
describe('run sizing', () => {
  it('keeps a batch well inside the platform function ceiling', () => {
    // One card is 6-16 calls at a few seconds each. The budget must leave room
    // for the last card to FINISH: a card aborted mid-run is the one case that
    // spends calls and produces nothing.
    expect(CARDS_PER_RUN).toBeLessThanOrEqual(5)
    expect(RUN_BUDGET_MS).toBeLessThan(300_000)
  })
})

describe('outOfTime', () => {
  it('is false at the start and true once the budget is spent', () => {
    expect(outOfTime(1_000, 1_000)).toBe(false)
    expect(outOfTime(1_000, 1_000 + RUN_BUDGET_MS - 1)).toBe(false)
    expect(outOfTime(1_000, 1_000 + RUN_BUDGET_MS)).toBe(true)
  })
})

describe('findUnauthoredCards', () => {
  function prismaWith(rows: unknown[]) {
    const findMany = vi.fn().mockResolvedValue(rows)
    return { prisma: { card: { findMany } } as unknown as PrismaClient, findMany }
  }

  it('selects on the absence of an AUTHORED key point, not on klpStatus', async () => {
    // klpStatus is `ready` on legacy cards carrying two weak propositions.
    // Selecting on it would declare the whole legacy corpus done and the job
    // would find nothing to do on a corpus that is mostly unauthored.
    const { prisma, findMany } = prismaWith([])
    await findUnauthoredCards(prisma, 10)
    const where = findMany.mock.calls[0][0].where
    expect(where).toEqual({
      klps: {
        none: { supersededAt: null, promptVersion: { gte: AUTHORED_PROMPT_VERSION } },
      },
    })
    expect(JSON.stringify(where)).not.toContain('klpStatus')
  })

  it('takes the oldest cards first and honours the limit', async () => {
    const { prisma, findMany } = prismaWith([])
    await findUnauthoredCards(prisma, 7)
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { createdAt: 'asc' },
      take: 7,
    })
  })
})

describe('sweepReusable', () => {
  const card = {
    id: 'c1',
    term: 'What is EBITDA?',
    definition: 'Earnings before interest, taxes, depreciation and amortisation.',
    setId: 's1',
    setTitle: 'Accounting',
    blocks: [],
  }

  /** A prisma whose donor lookup returns cards at the given prompt versions. */
  function prismaWithDonors(versions: number[][]) {
    return {
      card: {
        findMany: vi.fn().mockResolvedValue(
          versions.map((klpVersions, i) => ({
            id: `donor${i}`,
            setId: 'other',
            klps: klpVersions.map((promptVersion) => ({ promptVersion })),
          })),
        ),
      },
      cardKlp: {
        findMany: vi.fn().mockResolvedValue([
          { index: 0, text: 'x', weight: 3, kind: 'definition', promptVersion: 2, source: 'ai', label: null, model: 'm' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 0 } }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          cardKlp: {
            aggregate: vi.fn().mockResolvedValue({ _max: { version: 0 } }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          card: { update: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaClient
  }

  it('serves a card from an AUTHORED twin', async () => {
    const served = await sweepReusable(prismaWithDonors([[2, 2, 2]]), [card])
    expect(served).toHaveLength(1)
    expect(served[0]).toMatchObject({ cardId: 'c1', donorCardId: 'donor0' })
  })

  it('REFUSES a legacy twin', async () => {
    // Copying a legacy donor would mark the card done at a version the job
    // does not consider done — so the next run picks it up again, forever.
    // An infinite rotation through the same cards, doing nothing.
    expect(await sweepReusable(prismaWithDonors([[1, 1]]), [card])).toEqual([])
  })

  it('does nothing when there is no twin at all', async () => {
    expect(await sweepReusable(prismaWithDonors([]), [card])).toEqual([])
  })
})
