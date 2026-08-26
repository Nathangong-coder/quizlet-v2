import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  kltFindMany: vi.fn(),
  kltFindFirst: vi.fn(),
  kltFindUnique: vi.fn(),
  kltUpdate: vi.fn(),
  kltDelete: vi.fn(),
  kltCount: vi.fn(),
  topicFindMany: vi.fn(),
  topicUpdate: vi.fn(),
  transaction: vi.fn(),
  auth: vi.fn(),
}))

/**
 * The `tx` handed to the interactive callback delegates to the SAME mocks as
 * the top-level client, so an assertion works whether the code called
 * `prisma.x` or `tx.x`.
 *
 * NOTE what is deliberately ABSENT: `cardKlp`, `klpState`, `answerKlpResult`.
 * If the implementation ever reaches for one of those, the test dies with
 * "is not a function" rather than passing quietly — that absence is itself a
 * guard for the rule that a concept-tree edit must never touch a learner's
 * answer history.
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = {
      klt: { update: h.kltUpdate, delete: h.kltDelete },
      klpTopic: { findMany: h.topicFindMany, update: h.topicUpdate },
    }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    klt: {
      findMany: h.kltFindMany,
      findFirst: h.kltFindFirst,
      findUnique: h.kltFindUnique,
      update: h.kltUpdate,
      delete: h.kltDelete,
      count: h.kltCount,
    },
    klpTopic: {
      findMany: h.topicFindMany,
      update: h.topicUpdate,
    },
    $transaction: h.transaction,
  },
}))

vi.mock('@/auth', () => ({ auth: h.auth }))

import {
  listConceptTree,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
} from '@/actions/klt-tree'

const EDITOR = 'user-1'

/**
 * A small real tree:
 *
 *   k-root (Finance, depth 0)
 *     k-a (Accounting, depth 1)
 *       k-b (Ratios, depth 2)
 *     k-c (Valuation, depth 1)
 *       k-leaf (WACC, depth 2)
 */
const ROWS = [
  { id: 'k-root', name: 'Finance', normalizedName: 'finance', parentKltId: null, depth: 0, ancestorIds: [] },
  { id: 'k-a', name: 'Accounting', normalizedName: 'accounting', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'] },
  { id: 'k-b', name: 'Ratios', normalizedName: 'ratios', parentKltId: 'k-a', depth: 2, ancestorIds: ['k-root', 'k-a'] },
  { id: 'k-c', name: 'Valuation', normalizedName: 'valuation', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'] },
  { id: 'k-leaf', name: 'WACC', normalizedName: 'wacc', parentKltId: 'k-c', depth: 2, ancestorIds: ['k-root', 'k-c'] },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KLT_EDITORS = EDITOR
  h.auth.mockResolvedValue({ user: { id: EDITOR } })
  h.transaction.mockImplementation(defaultTransactionImpl)
  h.kltFindMany.mockResolvedValue(ROWS.map((r) => ({ ...r, ancestorIds: [...r.ancestorIds] })))
  h.kltFindFirst.mockResolvedValue(null)
  // Existence check for renameConcept: resolves against the same fixture
  // tree, so every existing test id (k-leaf, k-a, ...) is found automatically
  // and only a deliberately unknown id reads as "not found".
  h.kltFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
    ROWS.some((r) => r.id === id) ? { id } : null,
  )
  h.kltCount.mockResolvedValue(0)
  h.topicFindMany.mockResolvedValue([])
  h.kltUpdate.mockResolvedValue({})
  h.kltDelete.mockResolvedValue({})
})

describe('gating', () => {
  it('refuses every mutation for a non-editor, with a not-found shape', async () => {
    // Never "forbidden" — that confirms the route exists to someone who
    // should not know it does.
    process.env.KLT_EDITORS = 'someone-else'
    for (const call of [
      () => reparentConcept('a', 'b'),
      () => renameConcept('a', 'x'),
      () => mergeConcepts('a', 'b'),
      () => deleteConcept('a'),
    ]) {
      const res = await call()
      expect(res.success).toBe(false)
      expect(res.success === false && res.error).toMatch(/not found/i)
    }
    // None of these reached the database.
    expect(h.kltFindMany).not.toHaveBeenCalled()
    expect(h.kltUpdate).not.toHaveBeenCalled()
    expect(h.kltDelete).not.toHaveBeenCalled()
  })

  it('refuses listConceptTree for a non-editor too, with a not-found shape', async () => {
    process.env.KLT_EDITORS = 'someone-else'
    const res = await listConceptTree()
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.kltFindMany).not.toHaveBeenCalled()
  })

  it('refuses everyone when KLT_EDITORS is unset', async () => {
    delete process.env.KLT_EDITORS
    const res = await deleteConcept('k-leaf')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
  })

  it('refuses when there is no session at all', async () => {
    h.auth.mockResolvedValue(null)
    const res = await deleteConcept('k-leaf')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
  })
})

describe('listConceptTree', () => {
  it('returns nodes with link and child counts', async () => {
    h.kltFindMany.mockResolvedValue([
      { id: 'k-root', name: 'Finance', normalizedName: 'finance', parentKltId: null, depth: 0, ancestorIds: [], _count: { links: 0, children: 2 } },
      { id: 'k-a', name: 'Accounting', normalizedName: 'accounting', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'], _count: { links: 3, children: 1 } },
    ])
    const res = await listConceptTree()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toEqual([
      { id: 'k-root', name: 'Finance', normalizedName: 'finance', parentKltId: null, depth: 0, ancestorIds: [], linkCount: 0, childCount: 2 },
      { id: 'k-a', name: 'Accounting', normalizedName: 'accounting', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'], linkCount: 3, childCount: 1 },
    ])
  })
})

describe('reparentConcept', () => {
  it('refuses a re-parent that would create a cycle', async () => {
    // Moving the root under its own descendant.
    const res = await reparentConcept('k-root', 'k-b')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/cycle/i)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('refuses a re-parent that would breach the max tree depth', async () => {
    // 'deep7' is fabricated already sitting at depth 7 (its own ancestor
    // chain does not need to literally exist as rows — computeSubtreeUpdates
    // reads the parent's own denormalized depth/ancestorIds directly).
    // Moving 'm' (unrelated branch, no ancestor relationship to deep7 — so
    // this is NOT a cycle) under it would land 'm' at depth 8, breaching
    // MAX_TREE_DEPTH.
    const rows = [
      { id: 'root', name: 'Root', normalizedName: 'root', parentKltId: null, depth: 0, ancestorIds: [] },
      { id: 'deep7', name: 'Deep7', normalizedName: 'deep7', parentKltId: 'phantom', depth: 7, ancestorIds: ['root', 'a', 'b', 'c', 'd', 'e', 'f'] },
      { id: 'm', name: 'M', normalizedName: 'm', parentKltId: 'root', depth: 1, ancestorIds: ['root'] },
    ]
    h.kltFindMany.mockResolvedValue(rows)
    const res = await reparentConcept('m', 'deep7')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/depth/i)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('recomputes depth and ancestorIds for the whole subtree in one transaction', async () => {
    // Move k-a (and its child k-b) under k-c.
    const res = await reparentConcept('k-a', 'k-c')
    expect(res.success).toBe(true)
    expect(h.transaction).toHaveBeenCalledTimes(1)
    // Two rows change: k-a itself and its descendant k-b.
    expect(h.kltUpdate).toHaveBeenCalledTimes(2)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'k-a' },
      data: { parentKltId: 'k-c', depth: 2, ancestorIds: ['k-root', 'k-c'] },
    })
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'k-b' },
      data: { parentKltId: undefined, depth: 3, ancestorIds: ['k-root', 'k-c', 'k-a'] },
    })
  })

  it('fails cleanly on an unknown node without writing a partial update', async () => {
    const res = await reparentConcept('nope', 'k-root')
    expect(res.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

describe('renameConcept', () => {
  it('rejects a rename that fails parseKltName', async () => {
    const res = await renameConcept('k-leaf', 'one two three four five')
    expect(res.success).toBe(false)
    expect(h.kltFindFirst).not.toHaveBeenCalled()
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('refuses a rename whose normalized form collides with another concept', async () => {
    h.kltFindFirst.mockResolvedValue({ id: 'k-c' })
    const res = await renameConcept('k-leaf', 'Valuation')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/already/i)
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })

  it('renames when the name is valid and unique', async () => {
    h.kltFindFirst.mockResolvedValue(null)
    const res = await renameConcept('k-leaf', 'Cost of Capital')
    expect(res.success).toBe(true)
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'k-leaf' },
      data: { name: 'Cost of Capital', normalizedName: 'cost of capital' },
    })
  })

  it('returns a failed ActionResult for a nonexistent id, instead of throwing a raw Prisma exception', async () => {
    // Carried fix: renameConcept previously had no existence check, unlike
    // reparentConcept and mergeConcepts, which both check explicitly. A
    // nonexistent kltId would fall straight through to `klt.update`, which
    // Prisma rejects with a raw P2025 exception — surfaced to the editor UI
    // as an unhandled error instead of a clean, renderable ActionResult.
    const res = await renameConcept('does-not-exist', 'Cost of Capital')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.kltFindFirst).not.toHaveBeenCalled()
    expect(h.kltUpdate).not.toHaveBeenCalled()
  })
})

describe('deleteConcept', () => {
  it('refuses deleting a node that still has children', async () => {
    h.kltCount.mockResolvedValue(1)
    const res = await deleteConcept('k-a')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/children/i)
    expect(h.kltDelete).not.toHaveBeenCalled()
  })

  it('deletes a childless node', async () => {
    h.kltCount.mockResolvedValue(0)
    const res = await deleteConcept('k-leaf')
    expect(res.success).toBe(true)
    expect(h.kltDelete).toHaveBeenCalledWith({ where: { id: 'k-leaf' } })
  })
})

describe('mergeConcepts', () => {
  it('merge refuses when the target is a descendant of the source', async () => {
    const res = await mergeConcepts('k-root', 'k-b')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/descendant|cycle/i)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('merge refuses merging a concept into itself', async () => {
    const res = await mergeConcepts('k-a', 'k-a')
    expect(res.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('merge refuses when re-parenting a child of the source under the target would breach the max tree depth', async () => {
    // 'deep7' is fabricated already sitting at depth 7, same trick as the
    // analogous reparentConcept test above — its ancestor chain does not
    // need to literally exist as rows. 'src' has one child ('kid') and is
    // NOT an ancestor of 'deep7' (and vice versa), so the merge itself is
    // not a cycle — but re-parenting 'kid' under 'deep7' during the merge
    // would land it at depth 8, breaching MAX_TREE_DEPTH. This is the exact
    // throw from computeSubtreeUpdates that mergeConcepts must catch, the
    // same way reparentConcept already does.
    const rows = [
      { id: 'root', name: 'Root', normalizedName: 'root', parentKltId: null, depth: 0, ancestorIds: [] },
      { id: 'deep7', name: 'Deep7', normalizedName: 'deep7', parentKltId: 'phantom', depth: 7, ancestorIds: ['root', 'a', 'b', 'c', 'd', 'e', 'f'] },
      { id: 'src', name: 'Src', normalizedName: 'src', parentKltId: 'root', depth: 1, ancestorIds: ['root'] },
      { id: 'kid', name: 'Kid', normalizedName: 'kid', parentKltId: 'src', depth: 2, ancestorIds: ['root', 'src'] },
    ]
    h.kltFindMany.mockResolvedValue(rows)

    const res = await mergeConcepts('src', 'deep7')

    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/depth/i)
    // Must fail cleanly, with no transaction opened and nothing written —
    // matching reparentConcept's contract for the identical throw.
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.kltUpdate).not.toHaveBeenCalled()
    expect(h.kltDelete).not.toHaveBeenCalled()
    expect(h.topicUpdate).not.toHaveBeenCalled()
  })

  it('merge re-points links and children to the target, then deletes the source', async () => {
    h.topicFindMany.mockImplementation(async ({ where }: { where: { kltId: string } }) => {
      if (where.kltId === 'k-a') return [{ id: 'lt-1', klpId: 'klp-x' }, { id: 'lt-2', klpId: 'klp-y' }]
      if (where.kltId === 'k-root') return [{ klpId: 'klp-x' }]
      return []
    })

    const res = await mergeConcepts('k-a', 'k-root')
    expect(res.success).toBe(true)
    expect(h.transaction).toHaveBeenCalledTimes(1)

    // klp-x already links to the target -> skipped (would violate @@unique).
    expect(h.topicUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lt-1' } }),
    )
    // klp-y does not -> re-pointed.
    expect(h.topicUpdate).toHaveBeenCalledWith({
      where: { id: 'lt-2' },
      data: { kltId: 'k-root' },
    })

    // k-b (child of source k-a) is re-pointed to the target and its subtree
    // recomputed.
    expect(h.kltUpdate).toHaveBeenCalledWith({
      where: { id: 'k-b' },
      data: { parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'] },
    })

    // The source is deleted, and deleted AFTER the re-pointing above.
    expect(h.kltDelete).toHaveBeenCalledWith({ where: { id: 'k-a' } })
    const lastTopicCall = Math.max(...h.topicUpdate.mock.invocationCallOrder)
    const lastKltUpdateCall = Math.max(...h.kltUpdate.mock.invocationCallOrder)
    const deleteCall = h.kltDelete.mock.invocationCallOrder[0]
    expect(deleteCall).toBeGreaterThan(lastTopicCall)
    expect(deleteCall).toBeGreaterThan(lastKltUpdateCall)
  })

  it('merge skips a link that would duplicate an existing (klpId, kltId) pair', async () => {
    // Two leaves, no children, so this isolates the skip logic from the
    // child-reparenting logic exercised above.
    h.kltFindMany.mockResolvedValue([
      { id: 'k-c', name: 'Valuation', normalizedName: 'valuation', parentKltId: 'k-root', depth: 1, ancestorIds: ['k-root'] },
      { id: 'k-leaf', name: 'WACC', normalizedName: 'wacc', parentKltId: 'k-c', depth: 2, ancestorIds: ['k-root', 'k-c'] },
      { id: 'k-root', name: 'Finance', normalizedName: 'finance', parentKltId: null, depth: 0, ancestorIds: [] },
    ])
    h.topicFindMany.mockImplementation(async ({ where }: { where: { kltId: string } }) => {
      if (where.kltId === 'k-leaf') return [{ id: 'lt-dup', klpId: 'klp-shared' }]
      if (where.kltId === 'k-c') return [{ klpId: 'klp-shared' }]
      return []
    })

    const res = await mergeConcepts('k-leaf', 'k-c')
    expect(res.success).toBe(true)
    expect(h.topicUpdate).not.toHaveBeenCalled()
    expect(h.kltDelete).toHaveBeenCalledWith({ where: { id: 'k-leaf' } })
  })

  it('never touches CardKlp, KlpState or AnswerKlpResult', async () => {
    // Those delegates are entirely absent from the mocked prisma client
    // above (top-level and inside the transaction callback). If any of
    // these four actions ever called one, this test would blow up with
    // "... is not a function" rather than silently passing.
    h.kltFindFirst.mockResolvedValue(null)
    h.kltCount.mockResolvedValue(0)
    await expect(reparentConcept('k-a', 'k-c')).resolves.toMatchObject({ success: true })
    await expect(renameConcept('k-leaf', 'Discount Rate')).resolves.toMatchObject({ success: true })
    await expect(mergeConcepts('k-a', 'k-root')).resolves.toMatchObject({ success: true })
    await expect(deleteConcept('k-leaf')).resolves.toMatchObject({ success: true })
  })
})
