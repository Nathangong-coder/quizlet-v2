import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A tiny in-memory fake standing in for Prisma, shared by every test below.
 * Real state (not a fixed mock-return snapshot) is what makes the ruling-2
 * regression test possible: it calls `mergeConcepts` and then
 * `listConceptTree` against the SAME store, so a resurrection bug shows up
 * exactly the way it would against a real database — the merged-away concept
 * reappearing in `unplaced` — rather than as a mocked-away assertion that
 * could stay green under a subtly different bug.
 *
 * Everything lives inside ONE `vi.hoisted` block because `vi.mock` factories
 * are hoisted above every other top-level statement in the file — a `const`
 * declared below them would still be in its temporal dead zone when the
 * mocked module is first evaluated.
 *
 * NOTE what is deliberately ABSENT from the mocked `@/lib/db`: `cardKlp`,
 * `klpState`, `answerKlpResult`. If any action ever reaches for one of those,
 * the test dies with "is not a function" rather than passing quietly — a
 * guard for the rule that a concept-tree edit must never touch a learner's
 * answer history.
 */
const h = vi.hoisted(() => {
  interface NodeRow {
    id: string
    setId: string
    kltId: string
    parentKltId: string | null
    depth: number
    ancestorIds: string[]
  }
  interface KltRow {
    id: string
    name: string
    normalizedName: string
  }
  interface TopicRow {
    id: string
    setId: string
    klpId: string
    kltId: string
  }

  const state: {
    nodes: NodeRow[]
    klts: KltRow[]
    topics: TopicRow[]
    setOwners: Record<string, string>
    nextId: number
  } = { nodes: [], klts: [], topics: [], setOwners: {}, nextId: 0 }

  const freshId = (prefix: string) => `${prefix}-${++state.nextId}`

  function kltById(id: string): KltRow {
    const k = state.klts.find((k) => k.id === id)
    if (!k) throw new Error(`test fixture: unknown klt ${id}`)
    return k
  }

  function nodeSelectShape(n: NodeRow) {
    const klt = kltById(n.kltId)
    return {
      id: n.id,
      kltId: n.kltId,
      parentKltId: n.parentKltId,
      depth: n.depth,
      ancestorIds: n.ancestorIds,
      klt: { name: klt.name, normalizedName: klt.normalizedName },
    }
  }

  /** Matches the handful of `KlpTopic` where-shapes klt-tree.ts actually issues. */
  function topicMatches(row: TopicRow, where: Record<string, unknown>): boolean {
    if ('kltId' in where && where.kltId !== row.kltId) return false
    const klp = where.klp as { card?: { setId?: string; set?: { NOT?: { userId?: string } } } } | undefined
    if (klp?.card?.setId !== undefined && klp.card.setId !== row.setId) return false
    if (klp?.card?.set?.NOT?.userId !== undefined) {
      const excludedUserId = klp.card.set.NOT.userId
      if (state.setOwners[row.setId] === excludedUserId) return false
    }
    return true
  }

  const access = vi.fn()

  const kltFindFirst = vi.fn(async ({ where }: { where: { normalizedName?: string; NOT?: { id: string } } }) => {
    const match = state.klts.find(
      (k) => (where.normalizedName === undefined || k.normalizedName === where.normalizedName) && k.id !== where.NOT?.id,
    )
    return match ?? null
  })

  const kltUpsert = vi.fn(
    async ({
      where,
      create,
    }: {
      where: { normalizedName: string }
      create: { name: string; normalizedName: string }
    }) => {
      const existing = state.klts.find((k) => k.normalizedName === where.normalizedName)
      if (existing) return existing
      const created: KltRow = { id: freshId('klt'), name: create.name, normalizedName: create.normalizedName }
      state.klts.push(created)
      return created
    },
  )

  const kltUpdate = vi.fn(
    async ({ where, data }: { where: { id: string }; data: { name: string; normalizedName: string } }) => {
      const row = kltById(where.id)
      row.name = data.name
      row.normalizedName = data.normalizedName
      return row
    },
  )

  const nodeFindMany = vi.fn(async ({ where }: { where: { setId: string } }) =>
    state.nodes.filter((n) => n.setId === where.setId).map(nodeSelectShape),
  )

  const nodeFindUnique = vi.fn(
    async ({ where }: { where: { setId_kltId: { setId: string; kltId: string } } }) => {
      const { setId, kltId } = where.setId_kltId
      const row = state.nodes.find((n) => n.setId === setId && n.kltId === kltId)
      return row ? { id: row.id } : null
    },
  )

  /** Backs `isConceptUsedOutsideOwnedSets`'s "placed in a set I don't own?" check. */
  const nodeFindFirst = vi.fn(
    async ({ where }: { where: { kltId: string; set?: { NOT?: { userId?: string } } } }) => {
      const excludedUserId = where.set?.NOT?.userId
      const match = state.nodes.find(
        (n) => n.kltId === where.kltId && (excludedUserId === undefined || state.setOwners[n.setId] !== excludedUserId),
      )
      return match ? { id: match.id } : null
    },
  )

  const nodeCreate = vi.fn(
    async ({
      data,
    }: {
      data: { setId: string; kltId: string; parentKltId: string | null; depth: number; ancestorIds: string[] }
    }) => {
      const created: NodeRow = { id: freshId('node'), ...data }
      state.nodes.push(created)
      return created
    },
  )

  const nodeUpdate = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string }
      data: { parentKltId?: string | null; depth: number; ancestorIds: string[] }
    }) => {
      const row = state.nodes.find((n) => n.id === where.id)
      if (!row) throw new Error(`test fixture: unknown node ${where.id}`)
      if (data.parentKltId !== undefined) row.parentKltId = data.parentKltId
      row.depth = data.depth
      row.ancestorIds = data.ancestorIds
      return row
    },
  )

  const nodeDelete = vi.fn(async ({ where }: { where: { id: string } }) => {
    state.nodes = state.nodes.filter((n) => n.id !== where.id)
    return { id: where.id }
  })

  const nodeCount = vi.fn(async ({ where }: { where: { setId: string; parentKltId: string } }) =>
    state.nodes.filter((n) => n.setId === where.setId && n.parentKltId === where.parentKltId).length,
  )

  const topicFindMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    state.topics
      .filter((t) => topicMatches(t, where))
      .map((t) => {
        const klt = kltById(t.kltId)
        return { id: t.id, klpId: t.klpId, kltId: t.kltId, klt: { name: klt.name, normalizedName: klt.normalizedName } }
      }),
  )

  const topicFindFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const match = state.topics.find((t) => topicMatches(t, where))
    return match ? { id: match.id } : null
  })

  const topicUpdate = vi.fn(
    async ({ where, data }: { where: { id: string }; data: { kltId: string } }) => {
      const row = state.topics.find((t) => t.id === where.id)
      if (!row) throw new Error(`test fixture: unknown topic ${where.id}`)
      row.kltId = data.kltId
      return row
    },
  )

  const topicDelete = vi.fn(async ({ where }: { where: { id: string } }) => {
    state.topics = state.topics.filter((t) => t.id !== where.id)
    return { id: where.id }
  })

  const transaction = vi.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      const tx = {
        klt: { upsert: kltUpsert, update: kltUpdate, findFirst: kltFindFirst },
        setKltNode: {
          findUnique: nodeFindUnique,
          create: nodeCreate,
          update: nodeUpdate,
          delete: nodeDelete,
        },
        klpTopic: { findMany: topicFindMany, update: topicUpdate, delete: topicDelete },
      }
      return (arg as (tx: unknown) => Promise<unknown>)(tx)
    }
    return Promise.all(arg as Promise<unknown>[])
  })

  return {
    state,
    access,
    kltFindFirst,
    kltUpsert,
    kltUpdate,
    nodeFindMany,
    nodeFindUnique,
    nodeFindFirst,
    nodeCreate,
    nodeUpdate,
    nodeDelete,
    nodeCount,
    topicFindMany,
    topicFindFirst,
    topicUpdate,
    topicDelete,
    transaction,
  }
})

vi.mock('@/lib/klt/access', () => ({ requireSetKltAccess: h.access }))

vi.mock('@/lib/db', () => ({
  prisma: {
    klt: { upsert: h.kltUpsert, update: h.kltUpdate, findFirst: h.kltFindFirst },
    setKltNode: {
      findMany: h.nodeFindMany,
      findUnique: h.nodeFindUnique,
      findFirst: h.nodeFindFirst,
      create: h.nodeCreate,
      update: h.nodeUpdate,
      delete: h.nodeDelete,
      count: h.nodeCount,
    },
    klpTopic: { findMany: h.topicFindMany, findFirst: h.topicFindFirst, update: h.topicUpdate, delete: h.topicDelete },
    $transaction: h.transaction,
  },
}))

import {
  listConceptTree,
  createConcept,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
} from '@/actions/klt-tree'

const OWNER = 'owner-1'
const SET_A = 'set-a'
const SET_B = 'set-b'
const ACCESS_A = { userId: OWNER, setId: SET_A, setTitle: 'Finance 101', viaAllowlist: false }

/**
 * A small real tree in SET_A:
 *
 *   k-root (Finance, depth 0)
 *     k-a (Accounting, depth 1)
 *       k-b (Ratios, depth 2)
 *     k-c (Valuation, depth 1)
 *       k-leaf (WACC, depth 2)
 */
function seedBaseTree() {
  h.state.klts = [
    { id: 'k-root', name: 'Finance', normalizedName: 'finance' },
    { id: 'k-a', name: 'Accounting', normalizedName: 'accounting' },
    { id: 'k-b', name: 'Ratios', normalizedName: 'ratios' },
    { id: 'k-c', name: 'Valuation', normalizedName: 'valuation' },
    { id: 'k-leaf', name: 'WACC', normalizedName: 'wacc' },
  ]
  h.state.nodes = [
    { id: 'n-root', setId: SET_A, kltId: 'k-root', parentKltId: null, depth: 0, ancestorIds: [] },
    { id: 'n-a', setId: SET_A, kltId: 'k-a', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'] },
    { id: 'n-b', setId: SET_A, kltId: 'k-b', parentKltId: 'k-a', depth: 2, ancestorIds: ['k-root', 'k-a'] },
    { id: 'n-c', setId: SET_A, kltId: 'k-c', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'] },
    { id: 'n-leaf', setId: SET_A, kltId: 'k-leaf', parentKltId: 'k-c', depth: 2, ancestorIds: ['k-root', 'k-c'] },
  ]
  h.state.topics = []
  h.state.setOwners = { [SET_A]: OWNER, [SET_B]: OWNER }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.nextId = 0
  seedBaseTree()
  h.access.mockResolvedValue(ACCESS_A)
})

describe('gating', () => {
  it('every action returns the not-found shape, and touches no store, when access is refused', async () => {
    h.access.mockResolvedValue(null)
    const calls: Array<() => Promise<{ success: boolean; error?: string }>> = [
      () => listConceptTree(SET_A),
      () => createConcept(SET_A, 'finance', null),
      () => reparentConcept(SET_A, 'k-a', null),
      () => renameConcept(SET_A, 'k-a', 'x'),
      () => mergeConcepts(SET_A, 'k-a', 'k-c'),
      () => deleteConcept(SET_A, 'k-leaf'),
    ]
    for (const call of calls) {
      const res = await call()
      expect(res.success).toBe(false)
      expect(res.success === false && res.error).toMatch(/not found/i)
    }
    expect(h.nodeFindMany).not.toHaveBeenCalled()
    expect(h.nodeDelete).not.toHaveBeenCalled()
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('scopes every query to the setId requireSetKltAccess resolved, not a raw argument', async () => {
    // Access resolves to a DIFFERENT setId than the raw argument passed to
    // listConceptTree — a mock where the resolved id equals the argument
    // cannot tell `access.setId` apart from the raw parameter, which is
    // exactly the vacuous shape this guard had before (2026-08-26 review
    // finding #3). Seed a node under the RESOLVED id so a query scoped to the
    // wrong id would come back empty, not merely call-shape-wrong.
    const RESOLVED_SET_ID = 'set-resolved'
    h.state.nodes.push({
      id: 'n-resolved-root',
      setId: RESOLVED_SET_ID,
      kltId: 'k-root',
      parentKltId: null,
      depth: 0,
      ancestorIds: [],
    })
    h.access.mockResolvedValue({ ...ACCESS_A, setId: RESOLVED_SET_ID })

    const res = await listConceptTree('set-argument')

    expect(h.nodeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { setId: RESOLVED_SET_ID } }))
    expect(h.nodeFindMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { setId: 'set-argument' } }))
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.nodes.some((n) => n.kltId === 'k-root')).toBe(true)
  })
})

describe('listConceptTree', () => {
  it('reports link and child counts, scoped to this set only', async () => {
    h.state.topics = [
      { id: 't-1', setId: SET_A, klpId: 'klp-1', kltId: 'k-leaf' },
      { id: 't-2', setId: SET_B, klpId: 'klp-2', kltId: 'k-leaf' }, // another set — must not count here
    ]
    const res = await listConceptTree(SET_A)
    expect(res.success).toBe(true)
    if (!res.success) return
    const leaf = res.data.nodes.find((n) => n.kltId === 'k-leaf')
    expect(leaf?.linkCount).toBe(1)
    const root = res.data.nodes.find((n) => n.kltId === 'k-root')
    expect(root?.childCount).toBe(2)
  })

  it('lists a concept this set cites but has not placed as unplaced', async () => {
    h.state.klts.push({ id: 'k-new', name: 'Quick Ratio', normalizedName: 'quick ratio' })
    h.state.topics = [{ id: 't-1', setId: SET_A, klpId: 'klp-1', kltId: 'k-new' }]
    const res = await listConceptTree(SET_A)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.unplaced).toEqual([
      { kltId: 'k-new', name: 'Quick Ratio', normalizedName: 'quick ratio', linkCount: 1 },
    ])
  })
})

describe('createConcept', () => {
  it('creates a root at depth 0 with empty ancestorIds', async () => {
    const res = await createConcept(SET_A, 'Macro', null)
    expect(res.success).toBe(true)
    const created = h.state.nodes.find((n: { kltId: string }) => res.success && n.kltId === res.data.kltId)
    expect(created).toMatchObject({ parentKltId: null, depth: 0, ancestorIds: [] })
  })

  it('creates a child inheriting ancestorIds plus the parent', async () => {
    const res = await createConcept(SET_A, 'Liquidity Ratios', 'k-a')
    expect(res.success).toBe(true)
    const created = h.state.nodes.find((n: { kltId: string }) => res.success && n.kltId === res.data.kltId)
    expect(created).toMatchObject({ parentKltId: 'k-a', depth: 2, ancestorIds: ['k-root', 'k-a'] })
  })

  it('refuses a duplicate within the same set', async () => {
    const res = await createConcept(SET_A, 'Accounting', null)
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/already/i)
  })

  it('succeeds for the same name in a DIFFERENT set — placement, not vocabulary, is scoped', async () => {
    h.access.mockResolvedValue({ userId: OWNER, setId: SET_B, setTitle: 'Bio 101', viaAllowlist: false })
    const before = h.state.klts.length
    const res = await createConcept(SET_B, 'Accounting', null)
    expect(res.success).toBe(true)
    // Reuses the existing global Klt row rather than forking a duplicate.
    expect(h.state.klts.length).toBe(before)
    expect(res.success && res.data.kltId).toBe('k-a')
    expect(h.state.nodes.some((n: { setId: string; kltId: string }) => n.setId === SET_B && n.kltId === 'k-a')).toBe(
      true,
    )
  })

  it('refuses a parent with no node in this set', async () => {
    const res = await createConcept(SET_A, 'Orphan', 'does-not-exist')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/parent/i)
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('refuses a nesting depth at or past MAX_TREE_DEPTH, whole, before any write', async () => {
    // Build a chain down to depth 7 so one more child would land at 8.
    let parentKltId: string | null = null
    for (let d = 0; d < 8; d++) {
      const kltId = `deep-${d}`
      h.state.klts.push({ id: kltId, name: `Deep ${d}`, normalizedName: `deep ${d}` })
      const parentAncestors = parentKltId
        ? h.state.nodes.find((n: { kltId: string }) => n.kltId === parentKltId)?.ancestorIds ?? []
        : []
      h.state.nodes.push({
        id: `n-deep-${d}`,
        setId: SET_A,
        kltId,
        parentKltId,
        depth: d,
        ancestorIds: parentKltId ? [...parentAncestors, parentKltId] : [],
      })
      parentKltId = kltId
    }
    const res = await createConcept(SET_A, 'Too Deep', parentKltId)
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/cap|nesting|deep/i)
  })
})

describe('reparentConcept', () => {
  it('refuses a re-parent that would create a cycle', async () => {
    const res = await reparentConcept(SET_A, 'k-root', 'k-b')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/cycle/i)
  })

  it('moves a subtree, recomputing depth and ancestorIds for every descendant', async () => {
    const res = await reparentConcept(SET_A, 'k-a', 'k-c')
    expect(res.success).toBe(true)
    const a = h.state.nodes.find((n: { id: string }) => n.id === 'n-a')
    const b = h.state.nodes.find((n: { id: string }) => n.id === 'n-b')
    expect(a).toMatchObject({ parentKltId: 'k-c', depth: 2, ancestorIds: ['k-root', 'k-c'] })
    expect(b).toMatchObject({ depth: 3, ancestorIds: ['k-root', 'k-c', 'k-a'] })
  })
})

describe('renameConcept (ruling 3 — narrowed to non-shared concepts)', () => {
  it('refuses a non-allowlisted caller renaming a concept another set (owned by someone else) also uses', async () => {
    h.state.setOwners[SET_B] = 'other-user'
    h.state.nodes.push({ id: 'n-a-in-b', setId: SET_B, kltId: 'k-a', parentKltId: null, depth: 0, ancestorIds: [] })

    const res = await renameConcept(SET_A, 'k-a', 'Bookkeeping')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/shared|operator/i)
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('allows the rename when the concept is placed only in sets the caller owns', async () => {
    // k-a is placed in SET_A only, and SET_A is owned by OWNER (the caller).
    const res = await renameConcept(SET_A, 'k-a', 'Bookkeeping')
    expect(res.success).toBe(true)
    expect(h.state.klts.find((k: { id: string }) => k.id === 'k-a')?.name).toBe('Bookkeeping')
  })

  it('allows an operator (viaAllowlist) to rename a concept shared with another owner’s set', async () => {
    h.state.setOwners[SET_B] = 'other-user'
    h.state.nodes.push({ id: 'n-a-in-b', setId: SET_B, kltId: 'k-a', parentKltId: null, depth: 0, ancestorIds: [] })
    h.access.mockResolvedValue({ ...ACCESS_A, viaAllowlist: true })

    const res = await renameConcept(SET_A, 'k-a', 'Bookkeeping')
    expect(res.success).toBe(true)
    expect(h.state.klts.find((k: { id: string }) => k.id === 'k-a')?.name).toBe('Bookkeeping')
  })

  it('refuses a non-allowlisted caller when another owned-by-someone-else set merely CITES the concept via KlpTopic (not placement)', async () => {
    h.state.setOwners[SET_B] = 'other-user'
    h.state.topics.push({ id: 't-cite', setId: SET_B, klpId: 'klp-b', kltId: 'k-a' })

    const res = await renameConcept(SET_A, 'k-a', 'Bookkeeping')
    expect(res.success).toBe(false)
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })
})

describe('deleteConcept', () => {
  it('refuses deleting a node that still has children in this set', async () => {
    const res = await deleteConcept(SET_A, 'k-a')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/children/i)
    expect(h.nodeDelete).not.toHaveBeenCalled()
  })

  it('deletes a childless node, leaving the global Klt row intact', async () => {
    const res = await deleteConcept(SET_A, 'k-leaf')
    expect(res.success).toBe(true)
    expect(h.state.nodes.some((n: { kltId: string }) => n.kltId === 'k-leaf')).toBe(false)
    expect(h.state.klts.some((k: { id: string }) => k.id === 'k-leaf')).toBe(true)
  })
})

describe('mergeConcepts', () => {
  it('never deletes the global Klt row for the source concept', async () => {
    const res = await mergeConcepts(SET_A, 'k-a', 'k-c')
    expect(res.success).toBe(true)
    expect(h.state.klts.some((k: { id: string }) => k.id === 'k-a')).toBe(true)
  })

  it('re-points a non-duplicate link and reparents children under the target', async () => {
    h.state.topics = [{ id: 't-1', setId: SET_A, klpId: 'klp-y', kltId: 'k-a' }]
    const res = await mergeConcepts(SET_A, 'k-a', 'k-c')
    expect(res.success).toBe(true)
    expect(h.state.topics.find((t: { id: string }) => t.id === 't-1')?.kltId).toBe('k-c')
    expect(h.state.nodes.find((n: { id: string }) => n.id === 'n-b')).toMatchObject({
      parentKltId: 'k-c',
      depth: 2,
      ancestorIds: ['k-root', 'k-c'],
    })
    expect(h.state.nodes.some((n: { kltId: string; setId: string }) => n.kltId === 'k-a' && n.setId === SET_A)).toBe(
      false,
    )
  })

  it('RULING 2 (regression): a duplicate link is deleted, not left behind, so the source concept does not resurrect in unplaced', async () => {
    // Both the source (k-leaf) and the target (k-c) already carry a link for
    // the SAME klp — merging would duplicate (klpId, kltId).
    h.state.topics = [
      { id: 't-source', setId: SET_A, klpId: 'klp-shared', kltId: 'k-leaf' },
      { id: 't-target', setId: SET_A, klpId: 'klp-shared', kltId: 'k-c' },
    ]

    const merge = await mergeConcepts(SET_A, 'k-leaf', 'k-c')
    expect(merge.success).toBe(true)

    // The bug: leaving 't-source' in place (pointing at 'k-leaf', which no
    // longer has a SetKltNode) makes listConceptTree read it back as an
    // unplaced link and resurrect "WACC" in the Unplaced section.
    expect(h.state.topics.some((t: { id: string }) => t.id === 't-source')).toBe(false)
    expect(h.state.topics.some((t: { id: string }) => t.id === 't-target')).toBe(true)

    const tree = await listConceptTree(SET_A)
    expect(tree.success).toBe(true)
    if (!tree.success) return
    expect(tree.data.unplaced.find((u) => u.kltId === 'k-leaf')).toBeUndefined()
  })

  it('never touches CardKlp, KlpState or AnswerKlpResult', async () => {
    // No such delegate exists on the mocked `@/lib/db` module at all — see
    // the file-level comment. Reaching for one throws "is not a function".
    await expect(mergeConcepts(SET_A, 'k-a', 'k-c')).resolves.toMatchObject({ success: true })
    await expect(deleteConcept(SET_A, 'k-leaf')).resolves.toMatchObject({ success: true })
    await expect(reparentConcept(SET_A, 'k-c', null)).resolves.toMatchObject({ success: true })
  })
})
