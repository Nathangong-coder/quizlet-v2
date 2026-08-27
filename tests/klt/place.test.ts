import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  setKltNodeFindMany: vi.fn(),
  setKltNodeUpsert: vi.fn(),
  klpTopicFindMany: vi.fn(),
  kltUpsert: vi.fn(),
  transaction: vi.fn(),
}))

/**
 * The `tx` handed to the interactive callback delegates to the SAME mocks as
 * the top-level client, so an assertion works whether the code called
 * `prisma.x` or `tx.x` — same technique as tests/actions/klt.test.ts.
 *
 * NOTE what is deliberately ABSENT: `klt.create`/`delete`/`update`,
 * `setKltNode.create`/`update`/`delete`. The pipeline must only ever `upsert`
 * (so a retry converges instead of duplicating) — if the implementation ever
 * reaches for one of the omitted methods, the test dies with "not a function"
 * rather than passing quietly.
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = { klt: { upsert: h.kltUpsert }, setKltNode: { upsert: h.setKltNodeUpsert } }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    setKltNode: { findMany: h.setKltNodeFindMany, upsert: h.setKltNodeUpsert },
    klpTopic: { findMany: h.klpTopicFindMany },
    klt: { upsert: h.kltUpsert },
    $transaction: h.transaction,
  },
}))

import { resolvePlacementPath, placeUnparentedConcepts, type KltPlacer } from '@/lib/klt/place'
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'
import { AiGenerationError } from '@/lib/ai/generate'

const node = (id: string, name: string, parentKltId: string | null, depth: number): TreeNodeRow => ({
  id, kltId: id, name, normalizedName: name, parentKltId, depth,
  ancestorIds: parentKltId ? [parentKltId] : [],
})

const byNormalized = new Map<string, TreeNodeRow>([
  ['finance', node('f', 'finance', null, 0)],
  ['accounting', node('a', 'accounting', 'f', 1)],
])

describe('resolvePlacementPath', () => {
  it('matches existing nodes and creates only what is missing', () => {
    const out = resolvePlacementPath(['finance', 'accounting', 'liquidity', 'quick ratio'], byNormalized)
    expect(out?.matched.map((m) => m.kltId)).toEqual(['f', 'a'])
    expect(out?.toCreate.map((c) => c.normalizedName)).toEqual(['liquidity', 'quick ratio'])
  })

  it('creates the whole chain against an empty tree', () => {
    const out = resolvePlacementPath(['finance', 'quick ratio'], new Map())
    expect(out?.matched).toEqual([])
    expect(out?.toCreate).toHaveLength(2)
  })

  it('normalizes names so casing cannot fork a node', () => {
    const out = resolvePlacementPath(['Finance', 'Accounting', 'quick ratio'], byNormalized)
    expect(out?.matched.map((m) => m.kltId)).toEqual(['f', 'a'])
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

// --- placeUnparentedConcepts fixtures -------------------------------------

/** A row already placed in a set — what `setKltNode.findMany` resolves to. */
const placedRow = (
  rowId: string,
  kltId: string,
  name: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[] = [],
) => ({
  id: rowId,
  kltId,
  parentKltId,
  depth,
  ancestorIds,
  klt: { name, normalizedName: name },
})

/** A concept the set's cards have linked — what `klpTopic.findMany` resolves to. */
const linkedTopic = (kltId: string, name: string) => ({ kltId, klt: { name, normalizedName: name } })

const SELECT = {
  id: true,
  kltId: true,
  parentKltId: true,
  depth: true,
  ancestorIds: true,
}

describe('placeUnparentedConcepts', () => {
  const SET = 'set-1'

  beforeEach(() => {
    vi.clearAllMocks()
    h.transaction.mockImplementation(defaultTransactionImpl)
    // The vocabulary upsert: a brand-new concept, echoing back its own name.
    // Klt carries NO structure any more, so this never needs depth/ancestors.
    h.kltUpsert.mockImplementation(
      async ({ where }: { where: { normalizedName: string } }) => ({
        id: `klt-${where.normalizedName}`,
        name: where.normalizedName,
        normalizedName: where.normalizedName,
      }),
    )
    // The structure upsert: echoes back the `create` payload, as a real
    // Prisma upsert does on the CREATE branch (no pre-existing row).
    h.setKltNodeUpsert.mockImplementation(
      async ({
        where,
        create,
      }: {
        where: { setId_kltId: { setId: string; kltId: string } }
        create: { parentKltId: string | null; depth: number; ancestorIds: string[] }
      }) => ({
        id: `node-${where.setId_kltId.kltId}`,
        kltId: where.setId_kltId.kltId,
        parentKltId: create.parentKltId,
        depth: create.depth,
        ancestorIds: create.ancestorIds,
      }),
    )
  })

  it('never throws when generation fails', async () => {
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('x', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockRejectedValue(new AiGenerationError({ attempts: [] } as never))
    await expect(placeUnparentedConcepts('user-1', SET, generate)).resolves.toBeUndefined()
    expect(h.setKltNodeUpsert).not.toHaveBeenCalled()
  })

  it('never throws on a plain, non-AiGenerationError failure from the generator', async () => {
    // The documented NEVER THROWS contract is reachable failing here:
    // `generateJson` can throw raw Prisma errors (from `resolveCandidates` or
    // `flagFailures`), not just `AiGenerationError`. This runs inside
    // `after()`, where an escaped exception surfaces as an unhandled
    // rejection long after the response went out.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('x', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(placeUnparentedConcepts('user-1', SET, generate)).resolves.toBeUndefined()
    expect(h.setKltNodeUpsert).not.toHaveBeenCalled()
  })

  it('leaves concepts unparented rather than fabricating a parent', async () => {
    // The proposed path repeats a name, so resolvePlacementPath refuses it —
    // this must fall through to "leave it unplaced", never a guessed parent.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('x', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'quick ratio', path: ['finance', 'finance', 'quick ratio'] }],
    })
    await placeUnparentedConcepts('user-1', SET, generate)
    expect(h.setKltNodeUpsert).not.toHaveBeenCalled()
  })

  it('skips a placement whose path does not end at the concept', async () => {
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('x', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      // Model drifted: the path is about a different concept entirely.
      placements: [{ concept: 'quick ratio', path: ['finance', 'current ratio'] }],
    })
    await placeUnparentedConcepts('user-1', SET, generate)
    expect(h.setKltNodeUpsert).not.toHaveBeenCalled()
  })

  it('does not try to re-place a node that already has a SetKltNode in this set', async () => {
    // 'finance' and 'accounting' are already placed in THIS set; 'quick
    // ratio' is the only concept still unplaced. Even if the model
    // hallucinates a path that would move 'finance', it must never be
    // looked up as a placement target because it was never in `unplaced`.
    h.setKltNodeFindMany.mockResolvedValue([
      placedRow('nf', 'f', 'finance', null, 0, []),
      placedRow('na', 'a', 'accounting', 'f', 1, ['f']),
    ])
    // 'finance' is BOTH already placed AND still linked (realistic: it was
    // linked before it was placed) — the exclusion has to actually filter
    // something out here, not just vacuously pass because 'finance' never
    // appears in the linked-topics read at all.
    h.klpTopicFindMany.mockResolvedValue([
      linkedTopic('f', 'finance'),
      linkedTopic('x', 'quick ratio'),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'finance', path: ['accounting', 'finance'] },
        { concept: 'quick ratio', path: ['finance', 'accounting', 'quick ratio'] },
      ],
    })
    await placeUnparentedConcepts('user-1', SET, generate)

    // Already-placed concepts must not even be OFFERED to the model as
    // something to place — only the genuinely unplaced 'quick ratio' is.
    const prompt = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt as string
    expect(prompt).not.toContain('- finance')
    expect(prompt).toContain('- quick ratio')

    // Both ancestors already matched — no new vocabulary needed.
    expect(h.kltUpsert).not.toHaveBeenCalled()
    expect(h.setKltNodeUpsert).toHaveBeenCalledTimes(1)
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'x' } },
      create: { setId: SET, kltId: 'x', parentKltId: 'a', depth: 2, ancestorIds: ['f', 'a'] },
      update: {},
      select: SELECT,
    })
  })

  it('reuses a node created earlier in the same run', async () => {
    // Two brand-new concepts land under the same brand-new ancestor chain.
    // Without in-place reuse, the second placement would upsert its own copy
    // of 'finance' and 'liquidity' and the tree would fork on its first run.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([
      linkedTopic('qr', 'quick ratio'),
      linkedTopic('cr', 'current ratio'),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'liquidity', 'quick ratio'] },
        { concept: 'current ratio', path: ['finance', 'liquidity', 'current ratio'] },
      ],
    })
    await placeUnparentedConcepts('user-1', SET, generate)

    const financeUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'finance')
    const liquidityUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'liquidity')
    expect(financeUpserts).toHaveLength(1)
    expect(liquidityUpserts).toHaveLength(1)

    // 2 ancestor structure writes (finance, liquidity) + 2 leaf writes (qr, cr).
    expect(h.setKltNodeUpsert).toHaveBeenCalledTimes(4)
    // The SECOND placement reuses 'liquidity' WITHOUT re-upserting it — its
    // parentKltId is liquidity's KLT id ('klt-liquidity'), never a
    // SetKltNode row id.
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'qr' } },
      create: { setId: SET, kltId: 'qr', parentKltId: 'klt-liquidity', depth: 2, ancestorIds: ['klt-finance', 'klt-liquidity'] },
      update: {},
      select: SELECT,
    })
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'cr' } },
      create: { setId: SET, kltId: 'cr', parentKltId: 'klt-liquidity', depth: 2, ancestorIds: ['klt-finance', 'klt-liquidity'] },
      update: {},
      select: SELECT,
    })
  })

  it('does not self-parent or double-write a concept the AI names twice in one reply', async () => {
    // Once 'quick ratio' is placed, its real (now-parented) row is merged
    // into byNormalized/byKltId so LATER placements can reuse it as an
    // ancestor. If the AI names the SAME concept a second time in the same
    // reply, that second pass must not re-resolve against the concept's own
    // just-written row — which would either self-parent it (if the whole
    // path now "matches") or otherwise duplicate the write.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('x', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'quick ratio'] },
        { concept: 'quick ratio', path: ['finance', 'quick ratio'] },
      ],
    })
    await placeUnparentedConcepts('user-1', SET, generate)

    // 1 ancestor write (finance) + 1 leaf write (quick ratio).
    expect(h.setKltNodeUpsert).toHaveBeenCalledTimes(2)
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'x' } },
      create: { setId: SET, kltId: 'x', parentKltId: 'klt-finance', depth: 1, ancestorIds: ['klt-finance'] },
      update: {},
      select: SELECT,
    })
    // Don't re-enter a DB transaction for a concept already placed this run.
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('places a shorter-path ancestor before a longer-path descendant that names it, regardless of reply order', async () => {
    // The AI lists the descendant ('quick ratio') BEFORE the ancestor
    // ('liquidity ratios') it depends on. Processing in reply order would
    // try to create 'liquidity ratios' as a byproduct of placing 'quick
    // ratio' while it is still a distinct, unplaced concept in its own
    // right. Sorting shortest-path-first places 'liquidity ratios' as its
    // own target first, so 'quick ratio' then finds a REAL match for it.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([
      linkedTopic('qr', 'quick ratio'),
      linkedTopic('lr', 'liquidity ratios'),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'liquidity ratios', 'quick ratio'] },
        { concept: 'liquidity ratios', path: ['finance', 'liquidity ratios'] },
      ],
    })
    await placeUnparentedConcepts('user-1', SET, generate)

    // 'finance' is only ever upserted once (created while placing 'liquidity
    // ratios'); 'liquidity ratios' itself is never upserted into `Klt` at all
    // — its Klt row already existed (it is a linked concept), only its
    // SetKltNode is newly created.
    const financeUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'finance')
    const liquidityUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'liquidity ratios')
    expect(financeUpserts).toHaveLength(1)
    expect(liquidityUpserts).toHaveLength(0)

    // finance (ancestor) + liquidity ratios (leaf of placement 1) + quick
    // ratio (leaf of placement 2) = 3 structure writes.
    expect(h.setKltNodeUpsert).toHaveBeenCalledTimes(3)
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'lr' } },
      create: { setId: SET, kltId: 'lr', parentKltId: 'klt-finance', depth: 1, ancestorIds: ['klt-finance'] },
      update: {},
      select: SELECT,
    })
    // 'quick ratio's parent is liquidity ratios' KLT id ('lr'), NOT its
    // SetKltNode row id ('node-lr') — the one semantic change this task
    // exists to get right.
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'qr' } },
      create: { setId: SET, kltId: 'qr', parentKltId: 'lr', depth: 2, ancestorIds: ['klt-finance', 'lr'] },
      update: {},
      select: SELECT,
    })
  })

  it('skips a placement whose ancestor name collides with a concept still unplaced this run', async () => {
    // 'liquidity ratios' is unplaced and the AI never returns its own
    // placement for it this round. Creating a SetKltNode for it as an
    // ANCESTOR of 'quick ratio' would pre-empt this set's own independent
    // placement decision for it with whatever path this unrelated placement
    // happened to propose. The whole placement must be skipped instead —
    // and skipped BEFORE any database call, purely from the in-memory
    // unplaced set.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([
      linkedTopic('qr', 'quick ratio'),
      linkedTopic('lr', 'liquidity ratios'),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'quick ratio', path: ['finance', 'liquidity ratios', 'quick ratio'] }],
    })
    await placeUnparentedConcepts('user-1', SET, generate)

    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.kltUpsert).not.toHaveBeenCalled()
    expect(h.setKltNodeUpsert).not.toHaveBeenCalled()
  })

  it('does not treat a node created during a rolled-back transaction as real for a later placement', async () => {
    // The FIRST placement's own final write fails (e.g. a DB constraint
    // violation), so its whole transaction rolls back — but only AFTER it
    // already upserted a brand-new 'finance' ancestor earlier in that SAME
    // transaction. If the shared maps were updated from inside the
    // transaction callback (rather than only after it resolves), that
    // 'finance' row would look real to the SECOND placement even though the
    // database never actually kept it.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([
      linkedTopic('qr', 'quick ratio'),
      linkedTopic('cr', 'current ratio'),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'quick ratio', path: ['finance', 'quick ratio'] },
        { concept: 'current ratio', path: ['finance', 'current ratio'] },
      ],
    })
    // First call = the 'finance' ancestor write (succeeds); second call =
    // 'quick ratio's own final write (fails) — targeting the SAME sequence
    // the original (pre-split) pipeline exercised.
    h.setKltNodeUpsert.mockImplementationOnce(
      async ({ where, create }: { where: { setId_kltId: { setId: string; kltId: string } }; create: { parentKltId: string | null; depth: number; ancestorIds: string[] } }) => ({
        id: `node-${where.setId_kltId.kltId}`,
        kltId: where.setId_kltId.kltId,
        parentKltId: create.parentKltId,
        depth: create.depth,
        ancestorIds: create.ancestorIds,
      }),
    )
    h.setKltNodeUpsert.mockImplementationOnce(async () => {
      throw new Error('constraint violation')
    })

    await placeUnparentedConcepts('user-1', SET, generate)

    // The second placement must re-create 'finance' from scratch — it must
    // NOT find a phantom 'finance' left over in memory from the rolled-back
    // first attempt.
    const financeUpserts = h.kltUpsert.mock.calls.filter(([a]) => a.where.normalizedName === 'finance')
    expect(financeUpserts).toHaveLength(2)
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'cr' } },
      create: { setId: SET, kltId: 'cr', parentKltId: 'klt-finance', depth: 1, ancestorIds: ['klt-finance'] },
      update: {},
      select: SELECT,
    })
  })

  it('merges a ROOT placement into the shared maps so a later placement cannot orphan a new ancestor above it', async () => {
    // 'valuation' is placed FIRST as a pure root (path length 1, no parent).
    // If that root is not merged into byNormalized/byKltId, it is invisible
    // to both: a later placement proposing a brand-new ancestor ABOVE it
    // ('finance' > 'valuation' > 'dcf model') would then treat 'valuation'
    // as still-creatable, stranding 'finance' as a parentless, childless
    // orphan that renderTreeForPrompt would emit as a bogus root in every
    // future prompt.
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([
      linkedTopic('v', 'valuation'),
      linkedTopic('dcf', 'dcf model'),
    ])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [
        { concept: 'valuation', path: ['valuation'] },
        { concept: 'dcf model', path: ['finance', 'valuation', 'dcf model'] },
      ],
    })

    await placeUnparentedConcepts('user-1', SET, generate)

    // 'valuation' becomes a real root (one structure write, no ancestors).
    // 'dcf model' is refused outright — with 'valuation' correctly visible
    // as an existing match, inserting 'finance' ABOVE it is a
    // match-after-creation (re-parenting), which resolvePlacementPath
    // already refuses — so it never reaches the database at all.
    expect(h.setKltNodeUpsert).toHaveBeenCalledTimes(1)
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: SET, kltId: 'v' } },
      create: { setId: SET, kltId: 'v', parentKltId: null, depth: 0, ancestorIds: [] },
      update: {},
      select: SELECT,
    })
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('refuses a placement whose newly-upserted ancestor was concurrently adopted from a row that already descends from the node being placed', async () => {
    // Simulates a stale snapshot: this run's reads predate a concurrent run
    // that already made 'liquidity ratios' a real child of 'quick ratio' IN
    // THIS SAME SET (finance > quick ratio > liquidity ratios). This run is
    // unaware of 'liquidity ratios' at all and proposes placing 'quick
    // ratio' UNDER it (finance > liquidity ratios > quick ratio) — a genuine
    // 2-hop cycle if honoured. `wouldCycle`'s walk (not just the immediate
    // self-id check) is what catches this: the concurrently-adopted
    // ancestor's OWN parentKltId points back at the node currently being
    // placed.
    h.setKltNodeFindMany.mockResolvedValue([
      placedRow('nf', 'f', 'finance', null, 0, []),
      // Gives 'finance' a real child, so it is a genuine root already placed
      // in this set — not itself a candidate for `unplaced`.
      placedRow('na', 'a', 'accounting', 'f', 1, ['f']),
    ])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('qr', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'quick ratio', path: ['finance', 'liquidity ratios', 'quick ratio'] }],
    })
    h.kltUpsert.mockImplementation(async ({ where }: { where: { normalizedName: string } }) => ({
      id: where.normalizedName === 'liquidity ratios' ? 'lr-real' : `klt-${where.normalizedName}`,
      name: where.normalizedName,
      normalizedName: where.normalizedName,
    }))
    h.setKltNodeUpsert.mockImplementation(
      async ({
        where,
        create,
      }: {
        where: { setId_kltId: { setId: string; kltId: string } }
        create: { parentKltId: string | null; depth: number; ancestorIds: string[] }
      }) => {
        if (where.setId_kltId.kltId === 'lr-real') {
          // The row a concurrent run already wrote: for real, it is 'quick
          // ratio's child in this set, not its ancestor.
          return { id: 'existing-node-lr', kltId: 'lr-real', parentKltId: 'qr', depth: 1, ancestorIds: ['qr'] }
        }
        return {
          id: `node-${where.setId_kltId.kltId}`,
          kltId: where.setId_kltId.kltId,
          parentKltId: create.parentKltId,
          depth: create.depth,
          ancestorIds: create.ancestorIds,
        }
      },
    )

    await placeUnparentedConcepts('user-1', SET, generate)

    // Only the ancestor write (liquidity ratios) happens; the cycle check
    // refuses the transaction before 'quick ratio's own final write.
    expect(h.setKltNodeUpsert).toHaveBeenCalledTimes(1)
    expect(h.setKltNodeUpsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { setId_kltId: { setId: SET, kltId: 'qr' } } }),
    )
  })

  // --- Set scoping: the guard this whole task exists for -------------------

  it('reports a concept placed in set B as still unplaced in set A, and places it there', async () => {
    // A tiny fake "database": 'growth' already has a SetKltNode in set-B,
    // and is linked (via KlpTopic) in BOTH sets. If the placement pipeline
    // ever queried across sets instead of filtering by the `setId` it was
    // given, 'growth' would wrongly be seen as already placed when working
    // on set-A.
    const nodesBySet: Record<string, unknown[]> = {
      'set-A': [],
      'set-B': [placedRow('nB-growth', 'growth', 'growth', null, 0, [])],
    }
    const topicsBySet: Record<string, unknown[]> = {
      'set-A': [linkedTopic('growth', 'growth')],
      'set-B': [linkedTopic('growth', 'growth')],
    }
    // Mimics what dropping the `where: { setId }` filter would really do
    // against Postgres: return the UNION across every set, not an empty
    // result — so a query that forgot to scope by `setId` sees 'growth'
    // already placed (via set-B's row) and wrongly treats it as placed here
    // too, rather than accidentally "passing" by returning nothing for both
    // the real and the mutated code path.
    h.setKltNodeFindMany.mockImplementation(async ({ where }: { where?: { setId?: string } }) =>
      where && typeof where.setId === 'string' ? nodesBySet[where.setId] ?? [] : Object.values(nodesBySet).flat(),
    )
    h.klpTopicFindMany.mockImplementation(
      async ({ where }: { where?: { klp?: { card?: { setId?: string } } } }) => {
        const setId = where?.klp?.card?.setId
        return typeof setId === 'string' ? topicsBySet[setId] ?? [] : Object.values(topicsBySet).flat()
      },
    )
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      placements: [{ concept: 'growth', path: ['growth'] }],
    })

    await placeUnparentedConcepts('user-1', 'set-A', generate)

    // Both reads are scoped to set-A specifically — asserted on the exact
    // call shape so a query that silently dropped or renamed the `setId`
    // filter is caught even in a fixture (like this one) where the fake
    // data alone might not otherwise expose it.
    expect(h.setKltNodeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setId: 'set-A' } }),
    )
    expect(h.klpTopicFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { klp: { card: { setId: 'set-A' } } } }),
    )

    // 'growth' being ALREADY placed in set-B did not exempt it from being
    // unplaced (and placeable) in set-A.
    expect(h.setKltNodeUpsert).toHaveBeenCalledWith({
      where: { setId_kltId: { setId: 'set-A', kltId: 'growth' } },
      create: { setId: 'set-A', kltId: 'growth', parentKltId: null, depth: 0, ancestorIds: [] },
      update: {},
      select: SELECT,
    })
  })

  it('never writes a SetKltNode for a different set than the one it was asked to place', async () => {
    h.setKltNodeFindMany.mockResolvedValue([])
    h.klpTopicFindMany.mockResolvedValue([linkedTopic('qr', 'quick ratio')])
    const generate: KltPlacer = vi.fn().mockResolvedValue({
      // Includes an ancestor chain, so both the ancestor write and the leaf
      // write are checked, not just the leaf.
      placements: [{ concept: 'quick ratio', path: ['finance', 'quick ratio'] }],
    })

    await placeUnparentedConcepts('user-1', 'set-A', generate)

    expect(h.setKltNodeUpsert.mock.calls.length).toBeGreaterThan(0)
    for (const [args] of h.setKltNodeUpsert.mock.calls) {
      expect(args.where.setId_kltId.setId).toBe('set-A')
      expect(args.create.setId).toBe('set-A')
    }
  })
})
