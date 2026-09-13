import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDirectoryWhere } from '@/lib/sets/directory'
import { countSubjects } from '@/lib/subjects/counts'

/**
 * `Set.subject` on its three write/read paths: the set action validates it
 * against the tree and fails CLOSED; the directory narrows by leaf or group
 * and an unknown value narrows to nothing; facet counts roll leaves up into
 * their group. Mocked-Prisma harness follows tests/actions/update-set-rescore.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  setFindUnique: vi.fn(),
  setUpdate: vi.fn(),
  categoryFindMany: vi.fn(),
  cardFindMany: vi.fn(),
  cardUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findUnique: h.setFindUnique, update: h.setUpdate },
    cardCategory: { deleteMany: vi.fn(), upsert: vi.fn(), findMany: h.categoryFindMany },
    card: { findMany: h.cardFindMany, deleteMany: vi.fn(async () => ({ count: 0 })), update: h.cardUpdate, create: vi.fn(), updateMany: vi.fn() },
    quizAttempt: { findMany: vi.fn(async () => []), update: vi.fn() },
    cardAsset: { updateMany: vi.fn() },
    cardContentBlock: { findMany: vi.fn(async () => []) },
    $transaction: h.transaction,
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn }))
vi.mock('@/actions/klp', () => ({ extractKlpsForCards: vi.fn() }))

import { updateSet } from '@/actions/sets'

const OWNER = 'u-owner'
const SET_ID = 'set-1'
const CARD = { id: 'c1', term: 'WACC', definition: 'Weighted average cost of capital.', position: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.setFindUnique.mockResolvedValue({ id: SET_ID, userId: OWNER })
  h.categoryFindMany.mockResolvedValue([])
  h.setUpdate.mockResolvedValue({})
  h.cardUpdate.mockResolvedValue({})
  h.cardFindMany.mockImplementation(async (args: { select?: unknown }) =>
    args?.select ? [{ id: 'c1' }] : [{ ...CARD, klpSourceHash: null, contentBlocks: [] }],
  )
  h.transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => Promise<unknown>)({
        card: { deleteMany: vi.fn(), update: h.cardUpdate, create: vi.fn(), findMany: h.cardFindMany },
        set: { update: h.setUpdate },
        cardCategory: { deleteMany: vi.fn(), upsert: vi.fn() },
        quizAttempt: { findMany: vi.fn(async () => []), update: vi.fn() },
      })
    }
    return Promise.all(arg as Promise<unknown>[])
  })
})

describe('updateSet · subject', () => {
  it('persists a known leaf slug', async () => {
    const r = await updateSet(SET_ID, { title: 'T', subject: 'accounting', cards: [CARD] })
    expect(r.success).toBe(true)
    expect(h.setUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subject: 'accounting' }) }))
  })

  it('stores null for an empty or omitted subject', async () => {
    await updateSet(SET_ID, { title: 'T', subject: '', cards: [CARD] })
    expect(h.setUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subject: null }) }))
    vi.clearAllMocks()
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.setFindUnique.mockResolvedValue({ id: SET_ID, userId: OWNER })
    h.categoryFindMany.mockResolvedValue([])
    await updateSet(SET_ID, { title: 'T', cards: [CARD] })
    expect(h.setUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subject: null }) }))
  })

  it('REJECTS an unknown slug and a group slug rather than coercing to null', async () => {
    // Coercing would silently drop the subject the owner thought they set.
    for (const bad of ['nope', 'business-finance']) {
      const r = await updateSet(SET_ID, { title: 'T', subject: bad, cards: [CARD] })
      expect(r.success, bad).toBe(false)
      expect(h.setUpdate).not.toHaveBeenCalled()
    }
  })
})

describe('buildDirectoryWhere · subject', () => {
  it('narrows a leaf to itself and a group to its leaves', () => {
    const leaf = buildDirectoryWhere(null, undefined, 'history') as { AND: Record<string, unknown>[] }
    expect(leaf.AND).toContainEqual({ subject: { in: ['history'] } })
    const group = buildDirectoryWhere(null, undefined, 'maths') as { AND: Record<string, unknown>[] }
    const clause = group.AND.find((c) => 'subject' in c) as { subject: { in: string[] } }
    expect(clause.subject.in).toContain('calculus')
    expect(clause.subject.in.length).toBeGreaterThan(1)
  })

  it('narrows an unknown value to NOTHING, never to everything', () => {
    const where = buildDirectoryWhere(null, undefined, 'nope') as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual({ subject: { in: [] } })
  })

  it('adds no clause when no subject is given', () => {
    const where = buildDirectoryWhere(null, undefined, undefined) as { AND: Record<string, unknown>[] }
    expect(where.AND.some((c) => 'subject' in c)).toBe(false)
  })

  it('keeps the search OR as its own AND member beside the subject clause', () => {
    const where = buildDirectoryWhere('u1', 'merger', 'valuation') as { AND: Record<string, unknown>[] }
    expect(where.AND).toHaveLength(4)
  })
})

describe('countSubjects', () => {
  it('counts leaves and rolls them up into their group, dropping unknown slugs', () => {
    expect(
      countSubjects([
        { subject: 'accounting', count: 3 },
        { subject: 'valuation', count: 2 },
        { subject: 'history', count: 1 },
        { subject: 'gone-slug', count: 9 },
        { subject: null, count: 4 },
      ]),
    ).toEqual({ accounting: 3, valuation: 2, 'business-finance': 5, history: 1, 'arts-humanities': 1 })
  })
})
