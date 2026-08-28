import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The in-memory fake is deliberately fuller than the other action tests' fakes.
 *
 * `forkSet` is the only action in the app that writes across six tables in one
 * call and hand-rolls its own rollback, so a fake that only records the calls
 * would leave the two things worth asserting — what the fork ROW ends up
 * looking like, and what survives a mid-write failure — untestable.
 *
 * It therefore models nested relation `create`s (the fork writes each card and
 * its blocks in ONE statement), `createManyAndReturn` (the fork needs the new
 * asset ids to remap blocks), the ARRAY form of `$transaction`, and the
 * `Set` cascade the rollback leans on.
 */
const h = vi.hoisted(() => {
  interface SetRow {
    id: string
    title: string
    description: string | null
    visibility: string
    userId: string
    listingBlocked: boolean
    publishedAt: Date | null
    forkedFromId: string | null
    forkedFromTitle: string | null
    forkedFromHandle: string | null
  }
  interface CardRow {
    id: string
    setId: string
    term: string
    definition: string
    position: number
    klpStatus: string
  }
  interface AssetRow {
    id: string
    setId: string | null
    userId: string
    storageKey: string
    sizeBytes: number
    mimeType: string
    originalName: string
    kind: string
    textExtract: string | null
  }
  interface BlockRow {
    id: string
    cardId: string
    assetId: string | null
    side: string
    type: string
    text: string | null
    position: number
  }
  interface CategoryRow {
    id: string
    setId: string
    name: string
    normalizedName: string
    color: string | null
  }
  interface AssignmentRow { id: string; cardId: string; categoryId: string }
  interface NodeRow {
    id: string
    setId: string
    kltId: string
    parentKltId: string | null
    depth: number
    ancestorIds: string[]
    color: string | null
    icon: string | null
  }

  const state = {
    userId: 'bob' as string | null,
    sets: [] as SetRow[],
    cards: [] as CardRow[],
    assets: [] as AssetRow[],
    blocks: [] as BlockRow[],
    categories: [] as CategoryRow[],
    assignments: [] as AssignmentRow[],
    kltNodes: [] as NodeRow[],
    users: [{ id: 'alice', handle: 'alice' }, { id: 'bob', handle: null }] as {
      id: string
      handle: string | null
    }[],
    seq: 0,
  }
  const id = (p: string) => `${p}-${++state.seq}`
  const copied: { from: string; to: string; access?: string }[] = []
  /** Every blob url handed to `del`. The rollback's second half. */
  const deleted: string[] = []

  const db = {
    set: {
      findFirst: vi.fn(async ({ where }: never) => {
        const w = where as { id?: string; AND?: { id?: string }[] }
        const target = w.id ?? w.AND?.[0]?.id
        const s = state.sets.find((x) => x.id === target)
        if (!s) return null
        // The fake honours ownership + visibility the way readableSetWhere does.
        const readable = s.userId === state.userId || s.visibility !== 'private'
        if (!readable) return null
        return {
          ...s,
          user: state.users.find((u) => u.id === s.userId) ?? { handle: null },
          cards: state.cards
            .filter((c) => c.setId === s.id)
            .sort((a, b) => a.position - b.position)
            .map((c) => ({
              ...c,
              contentBlocks: state.blocks
                .filter((b) => b.cardId === c.id)
                .sort((a, b) => a.position - b.position),
              categoryAssignments: state.assignments
                .filter((a) => a.cardId === c.id)
                .map((a) => ({ categoryId: a.categoryId })),
            })),
          kltNodes: state.kltNodes.filter((n) => n.setId === s.id),
          categories: state.categories.filter((c) => c.setId === s.id),
        }
      }),
      create: vi.fn(async ({ data }: never) => {
        const d = data as Partial<SetRow> & {
          categories?: { create: { name: string; normalizedName: string; color: string | null }[] }
        }
        const row: SetRow = {
          id: id('set'),
          title: d.title!,
          description: d.description ?? null,
          visibility: d.visibility ?? 'private',
          userId: d.userId!,
          listingBlocked: false,
          publishedAt: d.publishedAt ?? null,
          forkedFromId: d.forkedFromId ?? null,
          forkedFromTitle: d.forkedFromTitle ?? null,
          forkedFromHandle: d.forkedFromHandle ?? null,
        }
        state.sets.push(row)
        const categories: CategoryRow[] = (d.categories?.create ?? []).map((c) => {
          const cat: CategoryRow = { id: id('cat'), setId: row.id, ...c }
          state.categories.push(cat)
          return cat
        })
        return { ...row, categories }
      }),
      // The rollback's whole database half. Cascades the way the schema does:
      // Card / CardCategory / CardAsset all carry onDelete: Cascade from Set,
      // and blocks + assignments cascade from Card in turn.
      deleteMany: vi.fn(async ({ where }: never) => {
        const w = where as { id: string; userId?: string }
        const doomed = state.sets.filter(
          (s) => s.id === w.id && (w.userId === undefined || s.userId === w.userId),
        )
        for (const s of doomed) {
          const cardIds = state.cards.filter((c) => c.setId === s.id).map((c) => c.id)
          state.blocks = state.blocks.filter((b) => !cardIds.includes(b.cardId))
          state.assignments = state.assignments.filter((a) => !cardIds.includes(a.cardId))
          state.cards = state.cards.filter((c) => c.setId !== s.id)
          state.categories = state.categories.filter((c) => c.setId !== s.id)
          state.assets = state.assets.filter((a) => a.setId !== s.id)
          state.kltNodes = state.kltNodes.filter((n) => n.setId !== s.id)
        }
        state.sets = state.sets.filter((s) => !doomed.includes(s))
        return { count: doomed.length }
      }),
    },
    card: {
      create: vi.fn(async ({ data }: never) => {
        const d = data as {
          setId: string
          term: string
          definition: string
          position: number
          klpStatus: string
          contentBlocks?: {
            create: {
              side: string
              type: string
              text: string | null
              position: number
              assetId: string | null
            }[]
          }
          categoryAssignments?: { create: { categoryId: string }[] }
        }
        const row: CardRow = {
          id: id('card'),
          setId: d.setId,
          term: d.term,
          definition: d.definition,
          position: d.position,
          klpStatus: d.klpStatus,
        }
        state.cards.push(row)
        for (const b of d.contentBlocks?.create ?? []) {
          state.blocks.push({ id: id('block'), cardId: row.id, ...b })
        }
        for (const a of d.categoryAssignments?.create ?? []) {
          state.assignments.push({ id: id('asn'), cardId: row.id, categoryId: a.categoryId })
        }
        return row
      }),
    },
    cardAsset: {
      findMany: vi.fn(async ({ where }: never) => {
        const w = where as { id: { in: string[] } }
        return state.assets.filter((a) => w.id.in.includes(a.id))
      }),
      createManyAndReturn: vi.fn(async ({ data }: never) => {
        const rows = (data as Omit<AssetRow, 'id'>[]).map((d) => {
          const row: AssetRow = { id: id('asset'), ...d }
          state.assets.push(row)
          return row
        })
        // createManyAndReturn does NOT promise input order. Reversing here is
        // what makes "join back through storageKey" a real assertion rather
        // than an accident of a fake that happens to preserve order.
        return [...rows].reverse().map((r) => ({ id: r.id, storageKey: r.storageKey }))
      }),
    },
    setKltNode: {
      createMany: vi.fn(async ({ data }: never) => {
        const rows = data as Omit<NodeRow, 'id'>[]
        for (const d of rows) state.kltNodes.push({ id: id('node'), ...d })
        return { count: rows.length }
      }),
    },
    // The array form: `prisma.$transaction([...])`. The fake's operations are
    // eager promises rather than Prisma's lazy PrismaPromises, so awaiting
    // them together is the closest honest model.
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(db),
    ),
  }
  return { state, db, copied, deleted, id }
})

vi.mock('@/lib/db', () => ({ prisma: h.db }))
vi.mock('@/auth', () => ({
  auth: async () => (h.state.userId ? { user: { id: h.state.userId } } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(async (from: string, to: string, options: { access?: string }) => {
    // `options` is captured, not ignored. An earlier version of this mock took
    // only (from, to), which left `access` completely unasserted — and mutating
    // the action to `access: 'public'` kept every test in this file GREEN. That
    // is the single most dangerous one-word change in the fork path.
    h.copied.push({ from, to, access: options?.access })
    return { url: `https://blob.test/${to}-${h.copied.length}` }
  }),
  del: vi.fn(async (url: string) => {
    h.deleted.push(url)
  }),
}))

import { forkSet } from '@/actions/sets-fork'

beforeEach(() => {
  vi.clearAllMocks()
  h.copied.length = 0
  h.deleted.length = 0
  h.state.seq = 0
  h.state.userId = 'bob'
  h.state.sets = [
    {
      id: 'src',
      title: 'Merger Model',
      description: 'd',
      visibility: 'public',
      userId: 'alice',
      listingBlocked: false,
      publishedAt: new Date(),
      forkedFromId: null,
      forkedFromTitle: null,
      forkedFromHandle: null,
    },
  ]
  h.state.cards = [
    { id: 'c1', setId: 'src', term: 't', definition: 'd', position: 0, klpStatus: 'done' },
  ]
  h.state.assets = [
    {
      id: 'a1',
      setId: 'src',
      userId: 'alice',
      storageKey: 'https://blob.test/orig',
      sizeBytes: 1000,
      mimeType: 'image/png',
      originalName: 'x.png',
      kind: 'image',
      textExtract: null,
    },
  ]
  h.state.blocks = [
    { id: 'b1', cardId: 'c1', assetId: 'a1', side: 'term', type: 'image', text: null, position: 0 },
  ]
  h.state.categories = [
    { id: 'cat1', setId: 'src', name: 'Valuation', normalizedName: 'valuation', color: '#ff0000' },
  ]
  h.state.assignments = [{ id: 'as1', cardId: 'c1', categoryId: 'cat1' }]
  h.state.kltNodes = [
    {
      id: 'n1',
      setId: 'src',
      kltId: 'klt1',
      parentKltId: null,
      depth: 0,
      ancestorIds: [],
      color: 'violet',
      icon: null,
    },
  ]
})

const forkOf = (owner: string) => h.state.sets.find((s) => s.userId === owner)!

describe('forkSet', () => {
  it('creates the copy PRIVATE regardless of the source', async () => {
    const res = await forkSet('src')
    expect(res.success).toBe(true)
    const fork = forkOf('bob')
    // Inheriting `public` would republish someone else's work under a new name
    // with no deliberate act. Spec §7.1.
    expect(fork.visibility).toBe('private')
    // …and it is not carried into the directory's cursor either.
    expect(fork.publishedAt).toBeNull()
  })

  it('denormalizes the source title and handle at fork time', async () => {
    await forkSet('src')
    const fork = forkOf('bob')
    expect(fork.forkedFromId).toBe('src')
    expect(fork.forkedFromTitle).toBe('Merger Model')
    expect(fork.forkedFromHandle).toBe('alice')
  })

  it('COPIES the blob to a new storageKey rather than sharing the row', async () => {
    // Spec §7.2 — the strongest finding in the design. /api/assets/[id]
    // resolves permission through contentBlocks[0] with take:1, so a SHARED
    // asset row makes that answer depend on Postgres row order.
    await forkSet('src')
    expect(h.copied).toHaveLength(1)
    expect(h.copied[0].from).toBe('https://blob.test/orig')
    const newAsset = h.state.assets.find((a) => a.userId === 'bob')!
    expect(newAsset.storageKey).not.toBe('https://blob.test/orig')
    expect(newAsset.setId).toBe(forkOf('bob').id)
  })

  it('copies blobs as PRIVATE, never public', async () => {
    // A public blob is fetchable by its URL with NO authentication, which
    // routes every forked asset around `/api/assets/[id]` — the proxy that
    // owner-checks each byte. Copying a private set's media into a
    // world-readable blob is the largest hole this feature could open, and
    // 'public' vs 'private' is one word apart in the source.
    await forkSet('src')
    expect(h.copied).toHaveLength(1)
    expect(h.copied[0].access).toBe('private')
  })

  it('points the copied block at the copied asset, not the original', async () => {
    // The join back from createManyAndReturn is by storageKey, not by index —
    // zipping by index would render the wrong image on the wrong card, silently.
    await forkSet('src')
    const forkId = forkOf('bob').id
    const forkCardIds = h.state.cards.filter((c) => c.setId === forkId).map((c) => c.id)
    const forkBlocks = h.state.blocks.filter((b) => forkCardIds.includes(b.cardId))
    expect(forkBlocks).toHaveLength(1)
    const newAsset = h.state.assets.find((a) => a.userId === 'bob')!
    expect(forkBlocks[0].assetId).toBe(newAsset.id)
    expect(forkBlocks[0].assetId).not.toBe('a1')
  })

  it('remaps category assignments onto the fork OWN categories', async () => {
    await forkSet('src')
    const forkId = forkOf('bob').id
    const forkCategory = h.state.categories.find((c) => c.setId === forkId)!
    expect(forkCategory.normalizedName).toBe('valuation')
    const forkCardIds = h.state.cards.filter((c) => c.setId === forkId).map((c) => c.id)
    const assignments = h.state.assignments.filter((a) => forkCardIds.includes(a.cardId))
    expect(assignments).toHaveLength(1)
    // Pointing at 'cat1' would make the forker's card a member of ALICE's
    // category, and deleting her set would then cascade the fork's assignment.
    expect(assignments[0].categoryId).toBe(forkCategory.id)
  })

  it('sets every copied card to klpStatus pending', async () => {
    await forkSet('src')
    const forked = h.state.cards.filter((c) => c.setId !== 'src')
    expect(forked.length).toBeGreaterThan(0)
    for (const c of forked) expect(c.klpStatus).toBe('pending')
  })

  it('carries the concept-tree skeleton verbatim', async () => {
    // SetKltNode points at a GLOBAL Klt and stores only placement, so the
    // hierarchy copies with no id remapping. Spec §7.4.
    await forkSet('src')
    const forkId = forkOf('bob').id
    const nodes = h.state.kltNodes.filter((n) => n.setId === forkId)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kltId: 'klt1', depth: 0, color: 'violet' })
  })

  it('refuses a private set belonging to someone else', async () => {
    h.state.sets[0].visibility = 'private'
    const res = await forkSet('src')
    expect(res.success).toBe(false)
    expect(h.copied).toHaveLength(0)
  })

  it('refuses when signed out', async () => {
    h.state.userId = null
    const res = await forkSet('src')
    expect(res.success).toBe(false)
  })

  it('refuses an oversized set BEFORE copying any blob', async () => {
    h.state.assets[0].sizeBytes = 999 * 1024 * 1024
    const res = await forkSet('src')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain('MB')
    // The whole point of gating before the copy: a refusal must cost nothing.
    expect(h.copied).toHaveLength(0)
  })

  it('leaves no half-built set behind when the card write fails', async () => {
    // The set is created OUTSIDE the batched transaction, so a failure partway
    // through would otherwise leave a real, owned, EMPTY set in the forker's
    // library carrying a fork-attribution line — which looks like a successful
    // fork rather than a failed one.
    h.db.card.create.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const res = await forkSet('src')
    expect(res.success).toBe(false)
    expect(h.state.sets.filter((s) => s.userId === 'bob')).toHaveLength(0)
    // ...and the copied blob is reclaimed too.
    expect(h.deleted).toHaveLength(1)
  })
})
