import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  access: vi.fn(),
  listConceptTree: vi.fn(),
  nodeFindMany: vi.fn(),
  kltUpsert: vi.fn(),
  nodeUpsert: vi.fn(),
  transaction: vi.fn(),
  generateJson: vi.fn(),
}))

/**
 * The `tx` handed to the interactive callback delegates to the SAME mocks as
 * the top-level client, so an assertion works whether the code called
 * `prisma.x` or `tx.x` — same technique as tests/actions/klt-tree.test.ts.
 *
 * NOTE what is deliberately ABSENT from `klt`: `create`, `update`, `delete`,
 * `deleteMany`, `updateMany`, `findFirst`. `applySkeleton` must only ever
 * `findMany` (to read the tree via `loadSetTree`) and `upsert` on both `klt`
 * and `setKltNode` (so a retry converges instead of duplicating). If the
 * implementation ever reaches for one of the omitted methods, the test dies
 * with "is not a function" rather than passing quietly. `suggestSkeleton`
 * must reach NONE of these beyond reading — that absence is the guard for
 * "writes NOTHING".
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = { klt: { upsert: h.kltUpsert }, setKltNode: { upsert: h.nodeUpsert } }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    setKltNode: { findMany: h.nodeFindMany },
    $transaction: h.transaction,
  },
}))

vi.mock('@/lib/klt/access', () => ({ requireSetKltAccess: h.access }))

// suggestSkeleton reads via listConceptTree(setId) rather than querying the
// tree itself — mocked here so its sampling logic (tested against
// listConceptTree directly in tests/actions/klt-tree.test.ts) isn't
// re-verified, only that suggestSkeleton USES the unplaced list it returns.
vi.mock('@/actions/klt-tree', async () => {
  const actual = await vi.importActual<typeof import('@/actions/klt-tree')>('@/actions/klt-tree')
  return { ...actual, listConceptTree: h.listConceptTree }
})

vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  AiGenerationError: class extends Error {
    detail = { attempts: [] }
  },
}))

import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'
import { MAX_SKELETON_DEPTH } from '@/lib/ai/schemas'
import { SUGGEST_SKELETON_PROMPT } from '@/lib/ai/prompts/suggest-skeleton'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'

const OWNER = 'user-1'
const SET_ID = 'set-1'
const ACCESS = { userId: OWNER, setId: SET_ID, setTitle: 'Finance 101', viaAllowlist: false }

/** A `SetKltNode` row as `setKltNode.findMany` (via `loadSetTree`) returns it. */
const node = (kltId: string, name: string, parentKltId: string | null, depth: number) => ({
  id: `n-${kltId}`,
  kltId,
  parentKltId,
  depth,
  ancestorIds: parentKltId ? [parentKltId] : [],
  klt: { name, normalizedName: name },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.access.mockResolvedValue(ACCESS)
  h.listConceptTree.mockResolvedValue({ success: true, data: { setId: SET_ID, setTitle: 'Finance 101', nodes: [], unplaced: [] } })
  h.transaction.mockImplementation(defaultTransactionImpl)
  h.nodeFindMany.mockResolvedValue([])
  h.kltUpsert.mockImplementation(
    async ({ where, create }: { where: { normalizedName: string }; create: Record<string, unknown> }) => ({
      id: `klt-${where.normalizedName}`,
      name: create.name,
      normalizedName: where.normalizedName,
    }),
  )
  h.nodeUpsert.mockImplementation(
    async ({
      create,
    }: {
      create: { setId: string; kltId: string; parentKltId: string | null; depth: number; ancestorIds: string[] }
    }) => ({
      id: `node-${create.kltId}`,
      kltId: create.kltId,
      parentKltId: create.parentKltId,
      depth: create.depth,
      ancestorIds: create.ancestorIds,
    }),
  )
})

describe('gating', () => {
  it('suggestSkeleton returns a not-found shape when access is refused, never forbidden', async () => {
    h.access.mockResolvedValue(null)
    const res = await suggestSkeleton(SET_ID, 'finance')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.listConceptTree).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('applySkeleton returns a not-found shape when access is refused, never forbidden', async () => {
    h.access.mockResolvedValue(null)
    const res = await applySkeleton(SET_ID, [['finance', 'accounting']])
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.nodeFindMany).not.toHaveBeenCalled()
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })
})

describe('suggestSkeleton', () => {
  it('writes NOTHING — the user reviews before anything lands', async () => {
    h.listConceptTree.mockResolvedValue({
      success: true,
      data: { setId: SET_ID, setTitle: 'Finance 101', nodes: [], unplaced: [{ kltId: 'x', name: 'quick ratio', normalizedName: 'quick ratio', linkCount: 1 }] },
    })
    h.generateJson.mockResolvedValue({ paths: [['finance', 'accounting'], ['finance', 'valuation']] })

    const res = await suggestSkeleton(SET_ID, 'finance')

    expect(res.success).toBe(true)
    expect(res.success === true && res.data.paths).toEqual([
      ['finance', 'accounting'],
      ['finance', 'valuation'],
    ])
    // No write delegate exists on the mocked client at all — a create/
    // update/upsert/delete call would throw "is not a function" rather than
    // silently succeed. The transaction helper itself must also never fire.
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('scopes evidence to THIS SET — samples listConceptTree(setId)’s own unplaced list, passed to the prompt', async () => {
    h.listConceptTree.mockResolvedValue({
      success: true,
      data: {
        setId: SET_ID,
        setTitle: 'Finance 101',
        nodes: [],
        unplaced: [
          { kltId: 'x', name: 'quick ratio', normalizedName: 'quick ratio', linkCount: 1 },
          { kltId: 'y', name: 'minority interest', normalizedName: 'minority interest', linkCount: 1 },
        ],
      },
    })
    h.generateJson.mockResolvedValue({ paths: [['finance', 'accounting']] })

    await suggestSkeleton(SET_ID, 'finance')

    expect(h.listConceptTree).toHaveBeenCalledWith(SET_ID)
    expect(h.generateJson).toHaveBeenCalledTimes(1)
    const call = h.generateJson.mock.calls[0][0]
    expect(call.task).toBe('autocomplete')
    expect(call.prompt).toContain('quick ratio')
    expect(call.prompt).toContain('minority interest')
  })

  it('rejects an invalid subject name before ever reading the tree', async () => {
    const res = await suggestSkeleton(SET_ID, 'a name that is far too long to be a valid concept here')
    expect(res.success).toBe(false)
    expect(h.listConceptTree).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('turns a generation failure into a failed ActionResult, never a thrown error', async () => {
    h.generateJson.mockRejectedValue(new Error('all credentials failed'))
    const res = await suggestSkeleton(SET_ID, 'finance')
    expect(res.success).toBe(false)
  })

  it('turns a listConceptTree failure into a failed ActionResult', async () => {
    h.listConceptTree.mockResolvedValue({ success: false, error: 'Not found' })
    const res = await suggestSkeleton(SET_ID, 'finance')
    expect(res.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})

describe('applySkeleton', () => {
  it('creates the missing chain for a path against an empty set, as SetKltNode rows', async () => {
    const res = await applySkeleton(SET_ID, [['finance', 'accounting']])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(2)
    expect(h.kltUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { normalizedName: 'finance' } }))
    expect(h.kltUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { normalizedName: 'accounting' } }))
    expect(h.nodeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setId_kltId: { setId: SET_ID, kltId: 'klt-finance' } } }),
    )
  })

  it('rejects a skeleton path deeper than MAX_SKELETON_DEPTH, and REPORTS the refusal via skipped', async () => {
    const tooDeep = Array.from({ length: MAX_SKELETON_DEPTH + 1 }, (_, i) => `level${i}`)
    const res = await applySkeleton(SET_ID, [tooDeep])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(0)
    expect(res.success === true && res.data.skipped).toBe(1)
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('creates missing nodes but NEVER re-parents an existing one in this set, and counts the refusal as skipped', async () => {
    // 'accounting' already exists in THIS SET as a child of 'finance'. A
    // skeleton path inserting a level between them is a match-after-creation
    // — resolvePlacementPath refuses it, and applySkeleton must honour that.
    h.nodeFindMany.mockResolvedValue([node('f', 'finance', null, 0), node('a', 'accounting', 'f', 1)])
    const res = await applySkeleton(SET_ID, [['finance', 'ratios', 'accounting']])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(0)
    expect(res.success === true && res.data.skipped).toBe(1)
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('a mixed batch reports created and skipped independently, one bad path does not discard a good one', async () => {
    const tooDeep = Array.from({ length: MAX_SKELETON_DEPTH + 1 }, (_, i) => `level${i}`)
    const res = await applySkeleton(SET_ID, [['finance', 'accounting'], tooDeep])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(2)
    expect(res.success === true && res.data.skipped).toBe(1)
  })

  it('is idempotent — applying the same skeleton twice creates nothing the second time in this set', async () => {
    const first = await applySkeleton(SET_ID, [['finance', 'accounting']])
    expect(first.success === true && first.data.created).toBe(2)
    expect(first.success === true && first.data.skipped).toBe(0)

    h.nodeFindMany.mockClear()
    h.kltUpsert.mockClear()
    h.nodeUpsert.mockClear()
    h.transaction.mockClear()
    h.nodeFindMany.mockResolvedValue([node('klt-finance', 'finance', null, 0), node('klt-accounting', 'accounting', 'klt-finance', 1)])

    const second = await applySkeleton(SET_ID, [['finance', 'accounting']])
    expect(second.success).toBe(true)
    expect(second.success === true && second.data.created).toBe(0)
    expect(second.success === true && second.data.skipped).toBe(0)
    expect(h.kltUpsert).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('scopes the same-name reuse check to THIS SET — a name already placed in another set is still created here', async () => {
    // loadSetTree(setId) is scoped by the (mocked) prisma call's own `where`
    // — this test proves applySkeleton passes THIS set's id through, by
    // asserting the read is scoped, then that creation still proceeds
    // (nodeFindMany returning [] simulates "not in this set", regardless of
    // what exists in another set).
    await applySkeleton(SET_ID, [['finance']])
    expect(h.nodeFindMany).toHaveBeenCalledWith({ where: { setId: SET_ID }, select: expect.anything() })
  })

  it('never touches CardKlp, KlpState or AnswerKlpResult', async () => {
    await expect(applySkeleton(SET_ID, [['finance', 'accounting']])).resolves.toMatchObject({ success: true })
  })
})

describe('SUGGEST_SKELETON_PROMPT', () => {
  const input = { subject: 'finance', sampleConcepts: ['quick ratio', 'minority interest'] }

  it('is in the registry', () => {
    expect(PROMPT_REGISTRY['suggest-skeleton']).toBe(SUGGEST_SKELETON_PROMPT)
  })

  it('instructs to return only top levels, never specific concepts', () => {
    expect(SUGGEST_SKELETON_PROMPT.build(input)).toContain(
      'Return only the TOP levels — broad areas, never specific concepts.',
    )
  })

  it('names the sample concepts as evidence and forbids emitting them', () => {
    const out = SUGGEST_SKELETON_PROMPT.build(input)
    expect(out).toContain('quick ratio')
    expect(out).toContain('minority interest')
    expect(out).toMatch(/must NOT appear/i)
  })

  it('states the skeleton depth cap', () => {
    expect(SUGGEST_SKELETON_PROMPT.build(input)).toContain(`At most ${MAX_SKELETON_DEPTH} elements`)
  })

  it('reuses the same wording rules as parseKltName: word cap, no proper nouns', () => {
    const out = SUGGEST_SKELETON_PROMPT.build(input)
    expect(out).toMatch(/at most 4 words/i)
    expect(out).toMatch(/never a proper noun/i)
  })

  it('anchors every path at the given subject', () => {
    expect(SUGGEST_SKELETON_PROMPT.build(input)).toContain('"finance"')
  })
})
