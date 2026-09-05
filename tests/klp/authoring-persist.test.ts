import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  write: vi.fn(),
  authoringCreate: vi.fn(),
  probeCreateMany: vi.fn(),
  relationCreateMany: vi.fn(),
  // What a later resumability check would see. Mimics Prisma's real
  // interactive-transaction guarantee closely enough to prove atomicity: a
  // row created through `tx` inside the `$transaction` callback is only
  // appended here if the callback RESOLVES. If it throws, nothing this
  // "transaction" wrote becomes visible — the property Fix 1 depends on.
  committedAuthoringRows: [] as { id: string; cardId: string; klpVersion: number }[],
}))

vi.mock('@/lib/cards/klp-write', () => ({ writeKlpVersion: h.write }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged: { id: string; cardId: string; klpVersion: number }[] = []
      const tx = {
        cardAuthoring: {
          create: async (args: { data: Record<string, unknown> }) => {
            const row = await h.authoringCreate(args)
            staged.push(row)
            return row
          },
        },
        authoringProbe: { createMany: h.probeCreateMany },
        klpRelation: { createMany: h.relationCreateMany },
      }
      const result = await fn(tx) // a throw here skips the push below — nothing commits
      h.committedAuthoringRows.push(...staged)
      return result
    }),
    cardAuthoring: {
      // The exact shape `scripts/author-klps.ts`'s resumability check calls.
      findFirst: vi.fn(async ({ where }: { where: { cardId: string; klpVersion: number } }) =>
        h.committedAuthoringRows.find(
          (r) => r.cardId === where.cardId && r.klpVersion === where.klpVersion,
        ) ?? null,
      ),
    },
  },
}))

import { persistAuthoring } from '@/lib/klp/authoring-persist'
import { klpSourceHash } from '@/lib/cards/klp-hash'
import { selectStaleCardIds } from '@/lib/cards/stale'
import { prisma } from '@/lib/db'

beforeEach(() => {
  vi.clearAllMocks()
  h.committedAuthoringRows.length = 0
  h.write.mockResolvedValue({ version: 4, klpIds: ['k0', 'k1', 'k2'] })
  h.authoringCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: 'a1',
    ...args.data,
  }))
})

const outcome = {
  referenceAnswer: 'ref',
  klps: [
    { text: 'p0', kind: 'mechanism', weight: 3 },
    { text: 'p1', kind: 'causal', weight: 2 },
    { text: 'p2', kind: 'definition', weight: 1 },
  ],
  probes: [{ kind: 'vague' as const, text: 'w', score: 0.2, verdicts: { '0': 'omission' as const } }],
  relations: [{ from: 0, to: 1, type: 'causes' as const, provenance: 'perturbation' as const, rationale: 'r', probe: 'p' }],
  relationStats: { candidates: 1, accepted: 1, droppedForCycles: 0, droppedOutOfRange: 0 },
  separationScore: 0.8,
  revisions: 1,
  status: 'separated' as const,
  defects: [],
  targetKlpCount: 4,
  concerns: [],
}

/** The card this outcome was authored from. Deliberately distinct term/definition text. */
const content = {
  term: 'What is EBITDA?',
  definition: 'Earnings before interest, taxes, depreciation and amortization.',
}

describe('persistAuthoring', () => {
  it('writes the KLPs with their COMPUTED weights', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    expect(h.write.mock.calls[0][1]).toEqual([
      { text: 'p0', kind: 'mechanism', weight: 3, source: 'ai', promptVersion: 1 },
      { text: 'p1', kind: 'causal', weight: 2, source: 'ai', promptVersion: 1 },
      { text: 'p2', kind: 'definition', weight: 1, source: 'ai', promptVersion: 1 },
    ])
  })

  /** Relation endpoints are INDEXES until the rows exist; they must be mapped. */
  it('maps relation indexes onto the real KLP ids', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    expect(h.relationCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      fromKlpId: 'k0', toKlpId: 'k1', type: 'causes',
    })
  })

  it('records the run with its separation score and status', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    expect(h.authoringCreate.mock.calls[0][0].data).toMatchObject({
      cardId: 'c1', klpVersion: 4, referenceAnswer: 'ref',
      separationScore: 0.8, revisions: 1, status: 'separated',
    })
  })

  it('writes no relations when there are none, rather than an empty call', async () => {
    await persistAuthoring('c1', { ...outcome, relations: [] }, 1, content)
    expect(h.relationCreateMany).not.toHaveBeenCalled()
  })

  it('writes KLPs before relations — a relation needs real rows to point at', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    expect(h.write.mock.invocationCallOrder[0])
      .toBeLessThan(h.relationCreateMany.mock.invocationCallOrder[0])
  })

  /**
   * THE GUARD. `writeKlpVersion` must be given exactly the hash the legacy
   * extraction path (`src/actions/klp.ts`) would compute for this same card,
   * or `selectStaleCardIds` reads the authored card as permanently stale and
   * the owner's next set save silently supersedes it via the legacy
   * extractor. Computed with the REAL `klpSourceHash`, not a hardcoded hex
   * string, so a change to that function's algorithm cannot desync this test
   * from what it is actually guarding.
   */
  it('hashes the card content with the exact function the legacy path uses', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    expect(h.write.mock.calls[0][2]).toBe(klpSourceHash(content))
  })

  it('an authored card is NOT stale under the legacy staleness check', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    const storedHash: string = h.write.mock.calls[0][2]
    const stale = selectStaleCardIds([
      { id: 'c1', term: content.term, definition: content.definition, klpSourceHash: storedHash },
    ])
    expect(stale).toEqual([])
  })

  it('includes content blocks in the hash so a rich card is not falsely stale', async () => {
    const blocks = [{ side: 'term', type: 'text', text: 'What is EBITDA?', assetId: null, position: 0 }]
    await persistAuthoring('c1', outcome, 1, { ...content, blocks })
    expect(h.write.mock.calls[0][2]).toBe(klpSourceHash({ ...content, blocks }))
    expect(h.write.mock.calls[0][2]).not.toBe(klpSourceHash(content))
  })
})

describe('persistAuthoring — transactional atomicity (Fix 1)', () => {
  /**
   * THE GUARD for the strand-forever bug. Steps 2-4 (cardAuthoring.create,
   * authoringProbe.createMany, klpRelation.createMany) must commit or fail
   * TOGETHER. Before the fix, `cardAuthoring.create` committed independently,
   * so a later probe/relation write failing left a `CardAuthoring` row at
   * `klpVersion: 4` that `scripts/author-klps.ts`'s resumability check
   * (`cardAuthoring.findFirst({ cardId, klpVersion })`) would find FOREVER —
   * the card silently never gets authored again without `--force`. This test
   * makes `authoringProbe.createMany` reject inside the transaction and
   * asserts the row a resumability check would see is gone.
   */
  it('leaves no CardAuthoring row when a later write in the same transaction fails', async () => {
    h.probeCreateMany.mockRejectedValueOnce(new Error('transient db error'))

    await expect(persistAuthoring('c1', outcome, 1, content)).rejects.toThrow('transient db error')

    // The whole point of the fix: a resumability check run right after this
    // failure must find NOTHING at this card/klpVersion, so the next run
    // re-authors instead of skipping a stranded, incomplete row forever.
    const survivor = await prisma.cardAuthoring.findFirst({ where: { cardId: 'c1', klpVersion: 4 } })
    expect(survivor).toBeNull()
  })

  it('still commits cleanly when nothing fails, for contrast', async () => {
    await persistAuthoring('c1', outcome, 1, content)
    const survivor = await prisma.cardAuthoring.findFirst({ where: { cardId: 'c1', klpVersion: 4 } })
    expect(survivor).not.toBeNull()
  })
})
