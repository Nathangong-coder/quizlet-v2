import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { loadMissedWork } from '@/lib/metrics/klt-read'
import { EMPTY_SCOPE } from '@/lib/memory/scope'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

const USER = 'user-1'

const resultRow = (over: Record<string, unknown> = {}) => ({
  klpId: 'k1',
  status: 'failed',
  mode: 'quiz-sa',
  createdAt: new Date('2026-08-20'),
  quizAnswerId: 'a1',
  klp: {
    id: 'k1',
    label: 'Debt impact on WACC',
    text: 'A long proposition about debt and WACC.',
    card: { term: 'WACC' },
    topics: [{ klt: { normalizedName: 'wacc', name: 'WACC' } }],
  },
  ...over,
})

function makePrisma(over: Record<string, unknown> = {}) {
  return {
    answerKlpResult: { findMany: vi.fn().mockResolvedValue([resultRow()]) },
    klpState: {
      findMany: vi.fn().mockResolvedValue([{ klpId: 'k1', pKnown: 0.2, observations: 5 }]),
    },
    answerErrorTag: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ quizAnswerId: 'a1', klpId: 'k1', type: 'negated' }]),
    },
    ...over,
  } as unknown as PrismaClient
}

let prisma: PrismaClient
beforeEach(() => {
  prisma = makePrisma()
})

describe('loadMissedWork', () => {
  it('returns topics grouping the learner’s misses', async () => {
    const out = await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('WACC')
    expect(out[0].klps[0].label).toBe('Debt impact on WACC')
  })

  it('scopes the result query to this user’s own answers AND cards', async () => {
    // Without both, this reads another account's answer history or another
    // account's card text — the class of hole the visibility pass closed.
    await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    const arg = (prisma.answerKlpResult.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.where.quizAnswer).toEqual({ userId: USER })
    expect(JSON.stringify(arg.where.klp)).toContain(USER)
  })

  it('asks the database only for misses, never for passes', async () => {
    await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    const arg = (prisma.answerKlpResult.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.where.status).toEqual({ in: ['failed', 'partial'] })
  })

  it('scopes KlpState to this user — a posterior is per-learner', async () => {
    await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    const arg = (prisma.klpState.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.where.userId).toBe(USER)
  })

  it('honours masteryTopicRanks when reading a KLP’s topics', async () => {
    await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], {
      ...DEFAULT_THRESHOLDS,
      masteryTopicRanks: 1,
    })
    const arg = (prisma.answerKlpResult.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.select.klp.select.topics.where).toEqual({ rank: { lte: 1 } })
  })

  it('attaches error types to the attempt they belong to', async () => {
    const out = await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    expect(out[0].klps[0].misses[0].errorTypes).toEqual(['negated'])
  })

  it('does not leak one attempt’s tags onto another attempt of the same KLP', async () => {
    prisma = makePrisma({
      answerKlpResult: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            resultRow(),
            resultRow({ quizAnswerId: 'a2', createdAt: new Date('2026-08-22') }),
          ]),
      },
    })
    const out = await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    const misses = out[0].klps[0].misses
    expect(misses.find((m) => m.createdAt.getTime() === new Date('2026-08-22').getTime())
      ?.errorTypes).toEqual([])
  })

  it('short-circuits with no further queries when nothing was missed', async () => {
    prisma = makePrisma({ answerKlpResult: { findMany: vi.fn().mockResolvedValue([]) } })
    const out = await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    expect(out).toEqual([])
    expect(prisma.klpState.findMany).not.toHaveBeenCalled()
  })

  it('puts a KLP with no topics under Uncategorized rather than dropping it', async () => {
    prisma = makePrisma({
      answerKlpResult: {
        findMany: vi
          .fn()
          .mockResolvedValue([resultRow({ klp: { ...resultRow().klp, topics: [] } })]),
      },
    })
    const out = await loadMissedWork(prisma, USER, EMPTY_SCOPE, [], DEFAULT_THRESHOLDS)
    expect(out[0].name).toBe('Uncategorized')
  })

  it('narrows to a single card when the scope names one', async () => {
    await loadMissedWork(
      prisma,
      USER,
      { ...EMPTY_SCOPE, cardId: 'card-9' },
      [],
      DEFAULT_THRESHOLDS,
    )
    const arg = (prisma.answerKlpResult.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.where.klp.card.id).toBe('card-9')
  })
})
