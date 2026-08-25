import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  kltFindMany: vi.fn(),
  kltUpsert: vi.fn(),
  kltUpdate: vi.fn(),
  transaction: vi.fn(),
}))

/**
 * The `tx` handed to the interactive callback delegates to the SAME mocks as
 * the top-level client, so an assertion works whether the code called
 * `prisma.x` or `tx.x` — same technique as tests/actions/klt.test.ts.
 *
 * NOTE what is deliberately ABSENT from `klt`: `create`, `delete`,
 * `deleteMany`, `updateMany`. The pipeline must only ever `upsert` (so a retry
 * converges instead of duplicating) and `update` a placement's own row — if
 * the implementation ever reaches for one of the omitted methods, the test
 * dies with "not a function" rather than passing quietly.
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = { klt: { upsert: h.kltUpsert, update: h.kltUpdate } }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    klt: { findMany: h.kltFindMany, upsert: h.kltUpsert, update: h.kltUpdate },
    $transaction: h.transaction,
  },
}))

import { resolvePlacementPath, placeUnparentedConcepts, type KltPlacer } from '@/lib/klt/place'
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'
import { AiGenerationError } from '@/lib/ai/generate'

const node = (id: string, name: string, parentKltId: string | null, depth: number): TreeNodeRow => ({
  id, name, normalizedName: name, parentKltId, depth,
  ancestorIds: parentKltId ? [parentKltId] : [],
})

const byNormalized = new Map<string, TreeNodeRow>([
  ['finance', node('f', 'finance', null, 0)],
  ['accounting', node('a', 'accounting', 'f', 1)],
])

describe('resolvePlacementPath', () => {
  it('matches existing nodes and creates only what is missing', () => {
    const out = resolvePlacementPath(['finance', 'accounting', 'liquidity', 'quick ratio'], byNormalized)
    expect(out?.matched.map((m) => m.id)).toEqual(['f', 'a'])
    expect(out?.toCreate.map((c) => c.normalizedName)).toEqual(['liquidity', 'quick ratio'])
  })

  it('creates the whole chain against an empty tree', () => {
    const out = resolvePlacementPath(['finance', 'quick ratio'], new Map())
    expect(out?.matched).toEqual([])
    expect(out?.toCreate).toHaveLength(2)
  })

  it('normalizes names so casing cannot fork a node', () => {
    const out = resolvePlacementPath(['Finance', 'Accounting', 'quick ratio'], byNormalized)
    expect(out?.matched.map((m) => m.id)).toEqual(['f', 'a'])
  })

  it('REJECTS a path once a match follows a creation — the tree would fork', () => {
    // finance > (new) liquidity > accounting: 'accounting' already lives
    // elsewhere, so honouring this would move it and everything beneath it.
    expect(resolvePlacementPath(['finance', 'liquidity', 'accounting'], byNormalized)).toBeNull()
  })

  it('rejects a path past the depth cap whole, never truncated', () => {
    const path = Array.from({ length: MAX_TREE_DEPTH + 1 }, (_, i) => `n${i}`)
    expect(resolvePlacementPath(path, new Map())).toBeNull()
  })

  it('rejects a path containing an invalid concept name', () => {
    expect(
      resolvePlacementPath(['finance', 'a name that is far too long to be a valid concept here'], byNormalized),
    ).toBeNull()
  })

  it('rejects an empty path', () => {
    expect(resolvePlacementPath([], byNormalized)).toBeNull()
  })

  it('rejects a path that repeats a name', () => {
    expect(resolvePlacementPath(['finance', 'finance'], byNormalized)).toBeNull()
  })
})

describe('placeUnparentedConcepts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.transaction.mockImplementation(defaultTransactionImpl)
    // Echoes back a full TreeNodeRow shape (not just an id) because the
    // pipeline needs depth/ancestorIds/parentKltId of a just-created ancestor
    // to compute the NEXT node in the chain — a bare `{ id }` stub (as used in
    // tests/actions/klt.test.ts, which never chains off the result) would
    // silently pass `undefined` depth/ancestorIds forward here.
    h.kltUpsert.mockImplementation(
      async ({ where, create }: { where: { normalizedName: string }; create: Record<string, unknown> }) => ({
        id: `klt-${where.normalizedName}`,
        name: create.name,
        normalizedName: where.normalizedName,
        parentKltId: create.parentKltId ?? null,
        depth: create.depth,
        ancestorIds: create.ancestorIds,
      }),
    )
  })

  it('never throws when generation fails', async () => {
    h.kltFindMany.mockResolvedValue([node('x', 'quick ratio', null, 0)])
    const generate: KltPlacer = vi.fn().mockRejectedValue(new AiGenerationError({ attempts: [] } as never))
    await expect(placeUnparentedConcepts('user-1', generate)).resolves.toBeUndefined()
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('leaves concepts unparented rather than fabricating a parent', async () => {
    // The proposed path repeats a name, so resolvePlacementPath refuses it —
    // this must fall through to "leave it unplaced", never a guessed parent.
    h.kltFindMany.mockResolvedValue([node('x', 'quick ratio', null, 0)])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'quick ratio', path: ['finance', 'finance', 'quick ratio'] }],
    })
    await placeUnparentedConcepts('user-1', generate)
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('skips a placement whose path does not end at the concept', async () => {
    h.kltFindMany.mockResolvedValue([node('x', 'quick ratio', null, 0)])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      // Model drifted: the path is about a different concept entirely.
      placements: [{ concept: 'quick ratio', path: ['finance', 'current ratio'] }],
    })
    await placeUnparentedConcepts('user-1', generate)
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('does not try to re-place a node that already has children', async () => {
    // 'finance' is a ROOT: no parent, but 'accounting' is its child. Even if
    // the model hallucinates a path that would move it, it must never be
    // looked up as a placement target because it was never in `unplaced`.
    h.kltFindMany.mockResolvedValue([
      node('f', 'finance', null, 0),
      node('a', 'accounting', 'f', 1),
      node('x', 'quick ratio', null, 0),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'finance', path: ['accounting', 'finance'] },
        { concept: 'quick ratio', path: ['finance', 'accounting', 'quick ratio'] },
      ],
    })
    await placeUnparentedConcepts('user-1', generate)
    expect(h.kltUpdate).toHaveBeenCalledTimes(1)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'x' },
      data: { parentKltId: 'a', depth: 2, ancestorIds: ['f', 'a'] },
    })
  })

  it('reuses a node created earlier in the same run', async () => {
    // Two brand-new concepts land under the same brand-new ancestor chain.
    // Without in-place reuse, the second placement would upsert its own copy
    // of 'finance' and 'liquidity' and the tree would fork on its first run.
    h.kltFindMany.mockResolvedValue([
      node('qr', 'quick ratio', null, 0),
      node('cr', 'current ratio', null, 0),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'liquidity', 'quick ratio'] },
        { concept: 'current ratio', path: ['finance', 'liquidity', 'current ratio'] },
      ],
    })
    await placeUnparentedConcepts('user-1', generate)

    const financeUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'finance')
    const liquidityUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'liquidity')
    expect(financeUpserts).toHaveLength(1)
    expect(liquidityUpserts).toHaveLength(1)

    expect(h.kltUpdate).toHaveBeenCalledTimes(2)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'qr' },
      data: { parentKltId: 'klt-liquidity', depth: 2, ancestorIds: ['klt-finance', 'klt-liquidity'] },
    })
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'cr' },
      data: { parentKltId: 'klt-liquidity', depth: 2, ancestorIds: ['klt-finance', 'klt-liquidity'] },
    })
  })
})
