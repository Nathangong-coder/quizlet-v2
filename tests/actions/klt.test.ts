import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  cardFindMany: vi.fn(),
  cardFindFirst: vi.fn(),
  cardUpdate: vi.fn(),
  cardUpdateMany: vi.fn(),
  klpUpdate: vi.fn(),
  kltFindMany: vi.fn(),
  kltUpsert: vi.fn(),
  topicDeleteMany: vi.fn(),
  topicCreateMany: vi.fn(),
  transaction: vi.fn(),
  generateJson: vi.fn(),
  auth: vi.fn(),
  revalidatePath: vi.fn(),
}))

/**
 * The `tx` handed to the interactive callback delegates to the SAME mocks as
 * the top-level client, so an assertion works whether the code called
 * `prisma.x` or `tx.x`.
 *
 * NOTE what is deliberately ABSENT from `cardKlp`: `delete`, `deleteMany`,
 * `updateMany` and `createMany`. If the implementation ever reaches for one,
 * the test dies with "not a function" rather than passing quietly — that
 * absence is itself a guard.
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = {
      cardKlp: { update: h.klpUpdate },
      klpTopic: { deleteMany: h.topicDeleteMany, createMany: h.topicCreateMany },
      card: { update: h.cardUpdate, updateMany: h.cardUpdateMany },
    }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    card: {
      findMany: h.cardFindMany,
      findFirst: h.cardFindFirst,
      update: h.cardUpdate,
      updateMany: h.cardUpdateMany,
    },
    cardKlp: { update: h.klpUpdate },
    klt: { findMany: h.kltFindMany, upsert: h.kltUpsert },
    klpTopic: { deleteMany: h.topicDeleteMany, createMany: h.topicCreateMany },
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

import { summarizeKltsForCards } from '@/actions/klt'
import { AiGenerationError } from '@/lib/ai/generate'

const OWNER = 'user-owner'

const CARD = {
  id: 'card-1',
  set: { id: 'set-1', title: 'Valuation' },
  klps: [
    { id: 'klp-a', text: 'WACC weights each source by market value.', kind: 'mechanism' },
    { id: 'klp-b', text: 'Interest is tax-deductible.', kind: 'causal' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockImplementation(defaultTransactionImpl)
  h.cardFindMany.mockResolvedValue([CARD])
  h.kltFindMany.mockResolvedValue([])
  h.kltUpsert.mockImplementation(async ({ where }: { where: { normalizedName: string } }) => ({
    id: `klt-${where.normalizedName}`,
  }))
  h.generateJson.mockResolvedValue({
    klps: [
      { ref: 0, label: 'Market value weighting', topics: ['WACC'] },
      { ref: 1, label: 'Tax shield on debt', topics: ['Tax Shield', 'WACC'] },
    ],
  })
})

describe('summarizeKltsForCards', () => {
  it('writes each label with an in-place update', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.klpUpdate).toHaveBeenCalledWith({
      where: { id: 'klp-a' },
      data: { label: 'Market value weighting' },
    })
  })

  it('NEVER supersedes a CardKlp row', async () => {
    // The guard for spec §6. Superseding to attach a label would mint new
    // klpIds and orphan every KlpState posterior — a silent mastery reset.
    await summarizeKltsForCards(OWNER, ['card-1'])
    for (const [arg] of h.klpUpdate.mock.calls) {
      expect(Object.keys(arg.data)).toEqual(['label'])
    }
  })

  it('never touches any CardKlp column other than label', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    const forbidden = ['text', 'weight', 'kind', 'index', 'version', 'sourceHash', 'supersededAt']
    for (const [arg] of h.klpUpdate.mock.calls) {
      for (const column of forbidden) expect(arg.data).not.toHaveProperty(column)
    }
  })

  it('upserts topics on normalizedName so concurrent batches converge', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.kltUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { normalizedName: 'wacc' } }),
    )
    // 'WACC' appears on both KLPs but must be upserted once.
    const waccCalls = h.kltUpsert.mock.calls.filter(
      ([a]) => a.where.normalizedName === 'wacc',
    )
    expect(waccCalls).toHaveLength(1)
  })

  it('replaces a KLP’s links rather than adding to them, so a retry is idempotent', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.topicDeleteMany).toHaveBeenCalledWith({ where: { klpId: 'klp-a' } })
    expect(h.topicCreateMany).toHaveBeenCalledWith({
      data: [{ klpId: 'klp-a', kltId: 'klt-wacc', rank: 1 }],
    })
  })

  it('persists rank order from the model', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    const call = h.topicCreateMany.mock.calls.find(([a]) => a.data[0]?.klpId === 'klp-b')
    expect(call?.[0].data).toEqual([
      { klpId: 'klp-b', kltId: 'klt-tax shield', rank: 1 },
      { klpId: 'klp-b', kltId: 'klt-wacc', rank: 2 },
    ])
  })

  it('marks the card ready', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.cardUpdate).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { kltStatus: 'ready', kltError: null },
    })
  })

  it('records skipped — not failed — when the user has no usable credential', async () => {
    h.generateJson.mockRejectedValue(new AiGenerationError({ attempts: [] } as never))
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.cardUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kltStatus: 'skipped' }) }),
    )
  })

  it('records failed on a real provider error', async () => {
    h.generateJson.mockRejectedValue(new AiGenerationError({ attempts: [{}] } as never))
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.cardUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kltStatus: 'failed' }) }),
    )
  })

  it('truncates a long error message to 500 characters', async () => {
    h.generateJson.mockRejectedValue(new Error('x'.repeat(900)))
    await summarizeKltsForCards(OWNER, ['card-1'])
    const [arg] = h.cardUpdateMany.mock.calls[0]
    expect(arg.data.kltError).toHaveLength(500)
  })

  it('NEVER throws — it runs inside after()', async () => {
    h.generateJson.mockRejectedValue(new Error('boom'))
    await expect(summarizeKltsForCards(OWNER, ['card-1'])).resolves.toBeUndefined()
  })

  it('does not throw even when the card load itself fails', async () => {
    h.cardFindMany.mockRejectedValue(new Error('db down'))
    await expect(summarizeKltsForCards(OWNER, ['card-1'])).resolves.toBeUndefined()
  })

  it('does not stamp a status onto a stranger’s card when the caller is not the owner', async () => {
    // A viewer on a link-shared set must never suppress the owner's retry UI.
    h.generateJson.mockRejectedValue(new Error('boom'))
    await summarizeKltsForCards(OWNER, ['card-1'], false)
    expect(h.cardUpdateMany).not.toHaveBeenCalled()
  })

  it('scopes the card read to sets the caller may actually read', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    const [arg] = h.cardFindMany.mock.calls[0]
    expect(JSON.stringify(arg.where.set)).toContain(OWNER)
  })

  it('reads only LIVE KLPs', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    const [arg] = h.cardFindMany.mock.calls[0]
    expect(arg.select.klps.where).toEqual({ supersededAt: null })
  })

  it('returns without an AI call when the batch has no live KLPs', async () => {
    h.cardFindMany.mockResolvedValue([{ ...CARD, klps: [] }])
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('returns immediately on an empty card list', async () => {
    await summarizeKltsForCards(OWNER, [])
    expect(h.cardFindMany).not.toHaveBeenCalled()
  })

  it('writes no links for a KLP whose topics were all invalid, but keeps its label', async () => {
    h.generateJson.mockResolvedValue({
      klps: [{ ref: 0, label: 'Still useful', topics: ['a name far too long to be a valid topic'] }],
    })
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.klpUpdate).toHaveBeenCalledWith({
      where: { id: 'klp-a' },
      data: { label: 'Still useful' },
    })
    expect(h.topicCreateMany).not.toHaveBeenCalled()
  })

  it('routes to the cheap autocomplete tier, not a new AI task', async () => {
    await summarizeKltsForCards(OWNER, ['card-1'])
    expect(h.generateJson).toHaveBeenCalledWith(expect.objectContaining({ task: 'autocomplete' }))
  })
})
