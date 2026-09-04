import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A tiny in-memory fake standing in for Prisma, shared by every test below.
 * Real state (not fixed mock-return snapshots) is what makes the "reuses the
 * existing Klt" and "place an unplaced concept" tests meaningful: they call
 * two different actions (`createConcept`/`listConceptTree` from
 * `klt-tree.ts`, `applyPreset`/`savePresetFromSet` from `klt-presets.ts`,
 * `applyPaths` from `klt-seed.ts`) against the SAME store, exactly as they
 * would against a real database.
 *
 * NOTE what is deliberately ABSENT: `cardKlp`, `klpState`, `answerKlpResult`.
 * If any action under test ever reached for one of those, the test would die
 * with "is not a function" rather than passing quietly — a guard for the
 * rule that a concept-tree edit must never touch a learner's answer history.
 */
const h = vi.hoisted(() => {
  interface KltRow {
    id: string
    name: string
    normalizedName: string
  }
  interface NodeRow {
    id: string
    setId: string
    kltId: string
    parentKltId: string | null
    depth: number
    ancestorIds: string[]
  }
  interface PresetRow {
    id: string
    name: string
    paths: unknown
  }
  interface TopicRow {
    id: string
    setId: string
    klpId: string
    kltId: string
  }

  const state: {
    klts: KltRow[]
    nodes: NodeRow[]
    presets: PresetRow[]
    topics: TopicRow[]
    nextId: number
  } = { klts: [], nodes: [], presets: [], topics: [], nextId: 0 }

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

  const access = vi.fn()
  const view = vi.fn()
  const auth = vi.fn()

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

  const nodeUpsert = vi.fn(
    async ({
      where,
      create,
    }: {
      where: { setId_kltId: { setId: string; kltId: string } }
      create: { setId: string; kltId: string; parentKltId: string | null; depth: number; ancestorIds: string[] }
    }) => {
      const { setId, kltId } = where.setId_kltId
      const existing = state.nodes.find((n) => n.setId === setId && n.kltId === kltId)
      if (existing) return existing
      const created: NodeRow = { id: freshId('node'), ...create }
      state.nodes.push(created)
      return created
    },
  )

  const topicFindMany = vi.fn(async ({ where }: { where: { klp: { card: { setId: string } } } }) =>
    state.topics
      .filter((t) => t.setId === where.klp.card.setId)
      .map((t) => {
        const klt = kltById(t.kltId)
        return { kltId: t.kltId, klt: { name: klt.name, normalizedName: klt.normalizedName } }
      }),
  )

  const presetFindMany = vi.fn(async () =>
    [...state.presets]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, name: p.name, paths: p.paths })),
  )

  const presetFindUnique = vi.fn(async ({ where }: { where: { id?: string; name?: string } }) => {
    const match = state.presets.find((p) => (where.id ? p.id === where.id : p.name === where.name))
    return match ?? null
  })

  const presetUpsert = vi.fn(
    async ({
      where,
      create,
      update,
    }: {
      where: { name: string }
      create: { name: string; paths: unknown }
      update: { paths: unknown }
    }) => {
      const existing = state.presets.find((p) => p.name === where.name)
      if (existing) {
        existing.paths = update.paths
        return existing
      }
      const created: PresetRow = { id: freshId('preset'), name: create.name, paths: create.paths }
      state.presets.push(created)
      return created
    },
  )

  const presetDelete = vi.fn(async ({ where }: { where: { id: string } }) => {
    state.presets = state.presets.filter((p) => p.id !== where.id)
    return { id: where.id }
  })

  const transaction = vi.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      const tx = {
        klt: { upsert: kltUpsert },
        setKltNode: { upsert: nodeUpsert, findUnique: nodeFindUnique, create: nodeCreate },
      }
      return (arg as (tx: unknown) => Promise<unknown>)(tx)
    }
    return Promise.all(arg as Promise<unknown>[])
  })

  return {
    state,
    access,
    view,
    auth,
    kltUpsert,
    nodeFindMany,
    nodeFindUnique,
    nodeCreate,
    nodeUpsert,
    topicFindMany,
    presetFindMany,
    presetFindUnique,
    presetUpsert,
    presetDelete,
    transaction,
  }
})

vi.mock('@/lib/db', () => ({
  prisma: {
    klt: { upsert: h.kltUpsert },
    setKltNode: { findMany: h.nodeFindMany, findUnique: h.nodeFindUnique, create: h.nodeCreate, upsert: h.nodeUpsert },
    klpTopic: { findMany: h.topicFindMany },
    kltPreset: { findMany: h.presetFindMany, findUnique: h.presetFindUnique, upsert: h.presetUpsert, delete: h.presetDelete },
    $transaction: h.transaction,
  },
}))

// `listConceptTree` runs on the READ gate; everything else here on the
// ownership gate. Both are mocked so a test that flips one sees the other
// unchanged.
vi.mock('@/lib/klt/access', () => ({ requireSetKltAccess: h.access, requireSetKltView: h.view }))
vi.mock('@/auth', () => ({ auth: h.auth }))

// klt-seed.ts also imports the AI generation path (used only by
// suggestSkeleton, never by applyPaths) — mocked exactly as
// tests/klt/skeleton.test.ts does, so importing it here never reaches a real
// provider call.
vi.mock('@/lib/ai/generate', () => ({
  generateJson: vi.fn(),
  AiGenerationError: class extends Error {
    detail = { attempts: [] }
  },
}))

import { listPresets, savePreset, deletePreset, applyPreset, savePresetFromSet } from '@/actions/klt-presets'
import { listConceptTree, createConcept } from '@/actions/klt-tree'

const OWNER = 'owner-1'
const ADMIN = 'admin-1'
const STAFF = 'staff-1'
const SET_A = 'set-a'
const SET_B = 'set-b'
const ACCESS_OWNER = { userId: OWNER, setId: SET_A, setTitle: 'Finance 101', viaRole: false }
const ACCESS_ADMIN = { userId: ADMIN, setId: SET_A, setTitle: 'Finance 101', viaRole: true }

function seedTree() {
  // finance (root) -> accounting (child)
  h.state.klts = [
    { id: 'k-finance', name: 'finance', normalizedName: 'finance' },
    { id: 'k-accounting', name: 'accounting', normalizedName: 'accounting' },
  ]
  h.state.nodes = [
    { id: 'n-finance', setId: SET_A, kltId: 'k-finance', parentKltId: null, depth: 0, ancestorIds: [] },
    { id: 'n-accounting', setId: SET_A, kltId: 'k-accounting', parentKltId: 'k-finance', depth: 1, ancestorIds: ['k-finance'] },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.klts = []
  h.state.nodes = []
  h.state.presets = []
  h.state.topics = []
  h.state.nextId = 0
  h.access.mockResolvedValue(ACCESS_OWNER)
  // Mirrors whatever the ownership gate resolves, so a test that refuses
  // access does not accidentally leave the read gate open behind it.
  h.view.mockImplementation(async (setId: string) => {
    const a = await h.access(setId)
    return a && { viewerId: a.userId, setId: a.setId, setTitle: a.setTitle, canEdit: true, viaRole: a.viaRole }
  })
  h.auth.mockResolvedValue({ user: { id: OWNER } })
})

describe('listPresets', () => {
  it('is available to a set owner (not just an admin)', async () => {
    h.state.presets = [{ id: 'p1', name: 'Finance skeleton', paths: [['finance']] }]
    const res = await listPresets(SET_A)
    expect(res.success).toBe(true)
    expect(res.success === true && res.data).toEqual([{ id: 'p1', name: 'Finance skeleton', pathCount: 1 }])
  })

  it('returns the not-found shape when access is refused', async () => {
    h.access.mockResolvedValue(null)
    const res = await listPresets(SET_A)
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
  })
})

describe('savePreset / deletePreset — admin gate', () => {
  it('refuses a non-admin set owner for savePreset, touching no store', async () => {
    const res = await savePreset('Finance skeleton', [['finance']])
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.presetUpsert).not.toHaveBeenCalled()
  })

  it('refuses a non-admin set owner for deletePreset, touching no store', async () => {
    h.state.presets = [{ id: 'p1', name: 'x', paths: [['finance']] }]
    const res = await deletePreset('p1')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.presetDelete).not.toHaveBeenCalled()
  })

  it('admits an admin for savePreset', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
    const res = await savePreset('Finance skeleton', [['finance', 'accounting']])
    expect(res.success).toBe(true)
    expect(h.state.presets).toHaveLength(1)
  })

  it('admits an admin for deletePreset', async () => {
    h.state.presets = [{ id: 'p1', name: 'x', paths: [['finance']] }]
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
    const res = await deletePreset('p1')
    expect(res.success).toBe(true)
    expect(h.state.presets).toHaveLength(0)
  })

  it('refuses when signed out entirely', async () => {
    h.auth.mockResolvedValue(null)
    const res = await savePreset('x', [['finance']])
    expect(res.success).toBe(false)
  })

  it('refuses a staff session for savePreset — staff is not admin, touching no store', async () => {
    // Regression guard: the `beforeEach` default session carries no `role` at
    // all, so a requireAdmin -> requireStaff swap in isCallerKltAdmin would
    // stay green against every OTHER test here too — isStaff(undefined) and
    // isAdmin(undefined) are both false. An explicit 'staff' role is the only
    // session shape that actually distinguishes the two predicates.
    h.auth.mockResolvedValue({ user: { id: STAFF, role: 'staff' } })
    const res = await savePreset('Finance skeleton', [['finance']])
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.presetUpsert).not.toHaveBeenCalled()
  })
})

describe('savePreset validation', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
  })

  it('rejects an empty name', async () => {
    const res = await savePreset('   ', [['finance']])
    expect(res.success).toBe(false)
    expect(h.presetUpsert).not.toHaveBeenCalled()
  })

  it('rejects a preset with no paths', async () => {
    const res = await savePreset('Empty', [])
    expect(res.success).toBe(false)
    expect(h.presetUpsert).not.toHaveBeenCalled()
  })

  it('rejects a path with a segment parseKltName refuses (too many words)', async () => {
    const res = await savePreset('Bad', [['one two three four five']])
    expect(res.success).toBe(false)
    expect(h.presetUpsert).not.toHaveBeenCalled()
  })

  it('upserts by name — saving the same name twice replaces the paths', async () => {
    await savePreset('Finance skeleton', [['finance']])
    const res = await savePreset('Finance skeleton', [['finance', 'accounting']])
    expect(res.success).toBe(true)
    expect(h.state.presets).toHaveLength(1)
    expect(h.state.presets[0].paths).toEqual([['finance', 'accounting']])
  })
})

describe('applyPreset', () => {
  it('creates the missing chain for a path against an empty set', async () => {
    h.state.presets = [{ id: 'p1', name: 'Finance skeleton', paths: [['finance', 'accounting']] }]
    const res = await applyPreset('p1', SET_A)
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(2)
    expect(res.success === true && res.data.skipped).toBe(0)
  })

  it('is idempotent — applying the same preset twice creates nothing the second time', async () => {
    h.state.presets = [{ id: 'p1', name: 'Finance skeleton', paths: [['finance', 'accounting']] }]

    const first = await applyPreset('p1', SET_A)
    expect(first.success === true && first.data.created).toBe(2)
    expect(first.success === true && first.data.skipped).toBe(0)

    h.transaction.mockClear()
    h.kltUpsert.mockClear()

    const second = await applyPreset('p1', SET_A)
    expect(second.success).toBe(true)
    expect(second.success === true && second.data.created).toBe(0)
    expect(second.success === true && second.data.skipped).toBe(0)
    // Not merely "created stays 0" — no write machinery fires at all the
    // second time, matching applySkeleton's own idempotency guard.
    expect(h.kltUpsert).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('reuses a concept that already exists in the global vocabulary rather than forking a second Klt', async () => {
    // 'finance' already exists globally (e.g. placed in SET_B), but has no
    // node in SET_A yet — loadSetTree(SET_A) is what makes it look unplaced
    // here even though the Klt row itself is not new.
    h.state.klts = [{ id: 'k-finance', name: 'finance', normalizedName: 'finance' }]
    h.state.nodes = [
      { id: 'n-finance-b', setId: SET_B, kltId: 'k-finance', parentKltId: null, depth: 0, ancestorIds: [] },
    ]
    h.state.presets = [{ id: 'p1', name: 'Finance skeleton', paths: [['finance']] }]

    const before = h.state.klts.length
    const res = await applyPreset('p1', SET_A)

    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(1)
    expect(h.state.klts.length).toBe(before) // no second Klt row forked
    expect(h.state.nodes.some((n) => n.setId === SET_A && n.kltId === 'k-finance')).toBe(true)
  })

  it('refuses a path that would re-parent an existing node, and counts it as skipped', async () => {
    seedTree() // finance -> accounting already placed in SET_A
    h.state.presets = [{ id: 'p1', name: 'Bad preset', paths: [['finance', 'ratios', 'accounting']] }]

    const res = await applyPreset('p1', SET_A)

    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(0)
    expect(res.success === true && res.data.skipped).toBe(1)
    // 'ratios' must never have been created as a side effect of the refusal.
    expect(h.state.klts.some((k) => k.normalizedName === 'ratios')).toBe(false)
  })

  it('refuses a stored path whose segment parseKltName now rejects, on APPLY not just on save', async () => {
    // Simulates a preset saved before a naming rule tightened: this path
    // never goes through savePreset's own validation, only applyPreset's.
    h.state.presets = [
      { id: 'p1', name: 'Legacy preset', paths: [['finance', 'one two three four five']] },
    ]

    const res = await applyPreset('p1', SET_A)

    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(0)
    expect(res.success === true && res.data.skipped).toBe(1)
  })

  it('applying to set A writes no SetKltNode for set B', async () => {
    h.state.presets = [{ id: 'p1', name: 'Finance skeleton', paths: [['finance', 'accounting']] }]
    await applyPreset('p1', SET_A)
    expect(h.state.nodes.every((n) => n.setId === SET_A)).toBe(true)
    expect(h.state.nodes.some((n) => n.setId === SET_B)).toBe(false)
  })

  it('returns the not-found shape when access is refused', async () => {
    h.access.mockResolvedValue(null)
    h.state.presets = [{ id: 'p1', name: 'Finance skeleton', paths: [['finance']] }]
    const res = await applyPreset('p1', SET_A)
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
  })

  it('reports an error for an unknown preset id', async () => {
    const res = await applyPreset('does-not-exist', SET_A)
    expect(res.success).toBe(false)
  })
})

describe('savePresetFromSet', () => {
  it('is admin-only — a plain owner (viaRole: false) is refused', async () => {
    seedTree()
    // Isolates savePresetFromSet's OWN `access.viaRole` check from
    // savePreset's independent auth()-based admin check (which would also
    // refuse an ordinary OWNER/OWNER pairing and mask a broken guard here) —
    // the caller resolves as an operator via auth(), but access to THIS
    // particular set is mocked as ordinary ownership, so only a real
    // `viaRole` check inside savePresetFromSet can refuse it.
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
    h.access.mockResolvedValue(ACCESS_OWNER)
    const res = await savePresetFromSet(SET_A, 'Captured')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.presetUpsert).not.toHaveBeenCalled()
  })

  it('derives root-to-node paths from the set’s current structure and saves them', async () => {
    seedTree()
    h.access.mockResolvedValue(ACCESS_ADMIN)
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })

    const res = await savePresetFromSet(SET_A, 'Captured')

    expect(res.success).toBe(true)
    expect(h.state.presets).toHaveLength(1)
    const saved = h.state.presets[0].paths as string[][]
    expect(saved).toEqual(
      expect.arrayContaining([
        ['finance'],
        ['finance', 'accounting'],
      ]),
    )
  })

  it('refuses a node WHOLE — never truncated — when an ancestor has no node in this set', async () => {
    // A broken tree: 'ratios' claims 'k-accounting' as an ancestor (via
    // ancestorIds), but no SetKltNode for 'k-accounting' exists in SET_A —
    // a `parent_not_in_set`-shaped invariant violation. The codebase rule is
    // "refuse whole, never truncate": deriving `['finance', 'ratios']` here
    // (dropping the missing middle segment) would bake a WRONG chain into a
    // shared, install-wide preset. 'ratios' must be SKIPPED, not shortened —
    // and the healthy 'finance' row must still be captured.
    h.state.klts = [
      { id: 'k-finance', name: 'finance', normalizedName: 'finance' },
      { id: 'k-accounting', name: 'accounting', normalizedName: 'accounting' },
      { id: 'k-ratios', name: 'ratios', normalizedName: 'ratios' },
    ]
    h.state.nodes = [
      { id: 'n-finance', setId: SET_A, kltId: 'k-finance', parentKltId: null, depth: 0, ancestorIds: [] },
      // No 'n-accounting' row in SET_A — the missing middle segment.
      {
        id: 'n-ratios',
        setId: SET_A,
        kltId: 'k-ratios',
        parentKltId: 'k-accounting',
        depth: 2,
        ancestorIds: ['k-finance', 'k-accounting'],
      },
    ]
    h.access.mockResolvedValue(ACCESS_ADMIN)
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })

    const res = await savePresetFromSet(SET_A, 'Captured')

    expect(res.success).toBe(true)
    expect(res.success === true && res.data.skipped).toBe(1)
    const saved = h.state.presets[0].paths as string[][]
    expect(saved).toEqual([['finance']])
    expect(saved).not.toContainEqual(['finance', 'ratios'])
  })
})

describe('placing an unplaced concept (folded-in UI gap)', () => {
  it('reuses the existing Klt and removes the concept from unplaced', async () => {
    // 'quick ratio' already exists globally and this set's cards cite it
    // (via KlpTopic), but it has no SetKltNode in SET_A yet.
    h.state.klts = [{ id: 'k-qr', name: 'quick ratio', normalizedName: 'quick ratio' }]
    h.state.topics = [{ id: 't1', setId: SET_A, klpId: 'klp-1', kltId: 'k-qr' }]
    h.state.nodes = []

    const before = await listConceptTree(SET_A)
    expect(before.success).toBe(true)
    expect(before.success === true && before.data.unplaced).toEqual([
      { kltId: 'k-qr', name: 'quick ratio', normalizedName: 'quick ratio', linkCount: 1 },
    ])

    const kltCountBefore = h.state.klts.length
    const createRes = await createConcept(SET_A, 'quick ratio', null)
    expect(createRes.success).toBe(true)
    // No second Klt row was created for the same name — the existing global
    // concept was reused.
    expect(h.state.klts.length).toBe(kltCountBefore)
    expect(createRes.success === true && createRes.data.kltId).toBe('k-qr')

    const after = await listConceptTree(SET_A)
    expect(after.success).toBe(true)
    expect(after.success === true && after.data.unplaced).toEqual([])
    expect(after.success === true && after.data.nodes.some((n) => n.kltId === 'k-qr')).toBe(true)
  })
})
