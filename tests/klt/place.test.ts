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

  it('rejects a path whose RESULTING depth reaches the cap, even though the path itself is short', () => {
    // Anchored two levels above the cap via a matched prefix, not via path
    // length: a plain `path.length > MAX_TREE_DEPTH` check would miss this,
    // since this path is only 2-3 segments long.
    const deepAnchor = node('deep', 'deep', 'parent-id', MAX_TREE_DEPTH - 2)
    const anchored = new Map<string, TreeNodeRow>([['deep', deepAnchor]])

    // One new segment lands the concept exactly AT depth MAX_TREE_DEPTH - 1:
    // the last valid depth. Allowed.
    expect(resolvePlacementPath(['deep', 'new1'], anchored)).not.toBeNull()

    // Two new segments would land the concept AT MAX_TREE_DEPTH: one past the
    // last valid depth. Refused whole, never truncated to the first segment.
    expect(resolvePlacementPath(['deep', 'new1', 'new2'], anchored)).toBeNull()
  })

  it('allows a root-anchored path of exactly MAX_TREE_DEPTH segments (the LENGTH cap boundary)', () => {
    // A root-anchored path of exactly MAX_TREE_DEPTH segments lands at depth
    // MAX_TREE_DEPTH-1, which is legal. Pins the boundary against an off-by-one
    // that would silently refuse every deepest legal path.
    expect(
      resolvePlacementPath(Array.from({ length: MAX_TREE_DEPTH }, (_, i) => `n${i}`), new Map()),
    ).not.toBeNull()
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

  it('never throws on a plain, non-AiGenerationError failure from the generator', async () => {
    // The documented NEVER THROWS contract is reachable failing here:
    // `generateJson` can throw raw Prisma errors (from `resolveCandidates` or
    // `flagFailures`), not just `AiGenerationError`. This runs inside
    // `after()`, where an escaped exception surfaces as an unhandled
    // rejection long after the response went out.
    h.kltFindMany.mockResolvedValue([node('x', 'quick ratio', null, 0)])
    const generate: KltPlacer = vi.fn().mockRejectedValue(new Error('boom'))
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

  it('does not self-parent or double-write a concept the AI names twice in one reply', async () => {
    // Once 'quick ratio' is placed, its real (now-parented) row is merged
    // into byNormalized so LATER placements can reuse it as an ancestor. If
    // the AI names the SAME concept a second time in the same reply, that
    // second pass must not re-resolve against the concept's own just-written
    // row — which would either self-parent it (if the whole path now
    // "matches") or otherwise duplicate the write.
    h.kltFindMany.mockResolvedValue([node('x', 'quick ratio', null, 0)])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'quick ratio'] },
        { concept: 'quick ratio', path: ['finance', 'quick ratio'] },
      ],
    })
    await placeUnparentedConcepts('user-1', generate)

    expect(h.kltUpdate).toHaveBeenCalledTimes(1)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'x' },
      data: { parentKltId: 'klt-finance', depth: 1, ancestorIds: ['klt-finance'] },
    })
    // Don't re-enter a DB transaction for a concept already placed this run.
    // Relying on the C1 guard to throw from inside the transaction would make
    // an exception the control flow for an ordinary duplicate.
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('places a shorter-path ancestor before a longer-path descendant that names it, regardless of reply order', async () => {
    // The AI lists the descendant ('quick ratio') BEFORE the ancestor
    // ('liquidity ratios') it depends on. Processing in reply order would
    // try to create 'liquidity ratios' as a byproduct of placing 'quick
    // ratio' while it is still a distinct, unplaced concept in its own
    // right. Sorting shortest-path-first places 'liquidity ratios' as its
    // own target first, so 'quick ratio' then finds a REAL match for it.
    h.kltFindMany.mockResolvedValue([
      node('qr', 'quick ratio', null, 0),
      node('lr', 'liquidity ratios', null, 0),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'liquidity ratios', 'quick ratio'] },
        { concept: 'liquidity ratios', path: ['finance', 'liquidity ratios'] },
      ],
    })
    await placeUnparentedConcepts('user-1', generate)

    // 'finance' is only ever upserted once (created while placing 'liquidity
    // ratios'); 'liquidity ratios' itself is never upserted at all — it is
    // the pre-existing node being directly `update`d, not created via upsert.
    const financeUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'finance')
    const liquidityUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'liquidity ratios')
    expect(financeUpserts).toHaveLength(1)
    expect(liquidityUpserts).toHaveLength(0)

    expect(h.kltUpdate).toHaveBeenCalledTimes(2)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'lr' },
      data: { parentKltId: 'klt-finance', depth: 1, ancestorIds: ['klt-finance'] },
    })
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'qr' },
      data: { parentKltId: 'lr', depth: 2, ancestorIds: ['klt-finance', 'lr'] },
    })
  })

  it('skips a placement whose ancestor name collides with a concept still unplaced this run', async () => {
    // 'liquidity ratios' is unplaced and the AI never returns its own
    // placement for it this round. Upserting an ANCESTOR named 'liquidity
    // ratios' would hit the pre-existing (parentless) row's unique
    // `normalizedName` and take the no-op `update: {}` branch instead of
    // truly creating a child of 'finance' — silently stranding it exactly
    // where it was while the pipeline wrongly believes it just re-parented
    // it. The whole placement must be skipped instead.
    h.kltFindMany.mockResolvedValue([
      node('qr', 'quick ratio', null, 0),
      node('lr', 'liquidity ratios', null, 0),
    ])
    // Simulates what a REAL Prisma upsert does when `where` matches an
    // existing row: it takes the `update: {}` no-op branch and returns the
    // row exactly as it already was, ignoring `create` entirely. The
    // default beforeEach mock (used for every other test in this file)
    // always simulates the create branch, which cannot exercise this bug.
    h.kltUpsert.mockImplementation(
      async ({ where, create }: { where: { normalizedName: string }; create: Record<string, unknown> }) => {
        if (where.normalizedName === 'liquidity ratios') {
          return { id: 'lr', name: 'liquidity ratios', normalizedName: 'liquidity ratios', parentKltId: null, depth: 0, ancestorIds: [] }
        }
        return {
          id: `klt-${where.normalizedName}`,
          name: create.name,
          normalizedName: where.normalizedName,
          parentKltId: create.parentKltId ?? null,
          depth: create.depth,
          ancestorIds: create.ancestorIds,
        }
      },
    )
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'quick ratio', path: ['finance', 'liquidity ratios', 'quick ratio'] }],
    })
    await placeUnparentedConcepts('user-1', generate)

    expect(h.kltUpsert).not.toHaveBeenCalled()
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('does not treat a node created during a rolled-back transaction as real for a later placement', async () => {
    // The FIRST placement's own final write fails (e.g. a DB constraint
    // violation), so its whole transaction rolls back — but only AFTER it
    // already upserted a brand-new 'finance' ancestor earlier in that SAME
    // transaction. If the shared map were updated from inside the
    // transaction callback (rather than only after it resolves), that
    // 'finance' row would look real to the SECOND placement even though the
    // database never actually kept it.
    h.kltFindMany.mockResolvedValue([
      node('qr', 'quick ratio', null, 0),
      node('cr', 'current ratio', null, 0),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'quick ratio'] },
        { concept: 'current ratio', path: ['finance', 'current ratio'] },
      ],
    })
    h.kltUpdate.mockRejectedValueOnce(new Error('constraint violation'))

    await placeUnparentedConcepts('user-1', generate)

    // The second placement must re-create 'finance' from scratch — it must
    // NOT find a phantom 'finance' left over in memory from the rolled-back
    // first attempt.
    const financeUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'finance')
    expect(financeUpserts).toHaveLength(2)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'cr' },
      data: { parentKltId: 'klt-finance', depth: 1, ancestorIds: ['klt-finance'] },
    })
  })

  it('merges a ROOT placement into the shared maps so a later placement cannot orphan a new ancestor above it', async () => {
    // 'valuation' is placed FIRST as a pure root (path length 1, no parent).
    // If that root is not merged into byNormalized/byId, it is invisible to
    // BOTH guards: byNormalized never saw it, and unplacedByNormalized
    // already dropped it on success. A later placement proposing a brand-new
    // ancestor ABOVE it ('finance' > 'valuation' > 'dcf model') would then
    // upsert-adopt the now-real 'valuation' row via its unique normalizedName
    // (a no-op `update: {}`, never actually re-parenting it), stranding
    // 'finance' as a parentless, childless orphan that renderTreeForPrompt
    // would emit as a bogus root in every future prompt.
    h.kltFindMany.mockResolvedValue([
      node('v', 'valuation', null, 0),
      node('dcf', 'dcf model', null, 0),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'valuation', path: ['valuation'] },
        { concept: 'dcf model', path: ['finance', 'valuation', 'dcf model'] },
      ],
    })
    // Simulates a real Prisma upsert matching valuation's now-real (root) row
    // and taking the `update: {}` no-op branch — same technique as the
    // earlier collision test.
    h.kltUpsert.mockImplementation(
      async ({ where, create }: { where: { normalizedName: string }; create: Record<string, unknown> }) => {
        if (where.normalizedName === 'valuation') {
          return { id: 'v', name: 'valuation', normalizedName: 'valuation', parentKltId: null, depth: 0, ancestorIds: [] }
        }
        return {
          id: `klt-${where.normalizedName}`,
          name: create.name,
          normalizedName: where.normalizedName,
          parentKltId: create.parentKltId ?? null,
          depth: create.depth,
          ancestorIds: create.ancestorIds,
        }
      },
    )

    await placeUnparentedConcepts('user-1', generate)

    // 'valuation' becomes a real root (one update). 'dcf model' must be
    // refused outright — with 'valuation' correctly visible as an existing
    // match, inserting 'finance' ABOVE it is a match-after-creation
    // (re-parenting), which resolvePlacementPath already refuses — rather
    // than silently stranding a new, childless 'finance'.
    expect(h.kltUpdate).toHaveBeenCalledTimes(1)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'v' },
      data: { parentKltId: null, depth: 0, ancestorIds: [] },
    })
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('refuses a placement whose newly-upserted ancestor was concurrently adopted from a row that already descends from the node being placed', async () => {
    // Simulates a stale snapshot: this run's `findMany` predates a concurrent
    // run that already made 'liquidity ratios' a real child of 'quick ratio'
    // (finance > quick ratio > liquidity ratios). This run is unaware of
    // 'liquidity ratios' at all and proposes placing 'quick ratio' UNDER it
    // (finance > liquidity ratios > quick ratio) — a genuine 2-hop cycle if
    // honoured. `wouldCycle`'s walk (not just the immediate self-id check)
    // is what catches this: the adopted ancestor's OWN parentKltId points
    // back at the node currently being placed.
    h.kltFindMany.mockResolvedValue([
      node('f', 'finance', null, 0),
      node('a', 'accounting', 'f', 1), // gives 'finance' a real child, so it is a genuine root, not itself unplaced
      node('qr', 'quick ratio', null, 0),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'quick ratio', path: ['finance', 'liquidity ratios', 'quick ratio'] }],
    })
    h.kltUpsert.mockImplementation(
      async ({ where, create }: { where: { normalizedName: string }; create: Record<string, unknown> }) => {
        if (where.normalizedName === 'liquidity ratios') {
          // The row a concurrent run already wrote: for real, it is 'quick
          // ratio's child, not its ancestor.
          return {
            id: 'lr-real',
            name: 'liquidity ratios',
            normalizedName: 'liquidity ratios',
            parentKltId: 'qr',
            depth: 1,
            ancestorIds: ['qr'],
          }
        }
        return {
          id: `klt-${where.normalizedName}`,
          name: create.name,
          normalizedName: where.normalizedName,
          parentKltId: create.parentKltId ?? null,
          depth: create.depth,
          ancestorIds: create.ancestorIds,
        }
      },
    )

    await placeUnparentedConcepts('user-1', generate)

    expect(h.kltUpdate).not.toHaveBeenCalled()
  })
})
