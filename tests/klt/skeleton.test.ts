import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  kltFindMany: vi.fn(),
  kltUpsert: vi.fn(),
  transaction: vi.fn(),
  generateJson: vi.fn(),
}))

/**
 * The `tx` handed to the interactive callback delegates to the SAME mock as
 * the top-level client, so an assertion works whether the code called
 * `prisma.x` or `tx.x` — same technique as tests/klt/place.test.ts and
 * tests/actions/klt-tree.test.ts.
 *
 * NOTE what is deliberately ABSENT from `klt`: `create`, `update`, `delete`,
 * `deleteMany`, `updateMany`, `findFirst`. `applySkeleton` must only ever
 * `findMany` (to read the tree) and `upsert` (so a retry converges instead
 * of duplicating). If the implementation ever reaches for one of the
 * omitted methods, the test dies with "is not a function" rather than
 * passing quietly. `suggestSkeleton` must reach NONE of these beyond
 * `findMany` — that absence is the guard for "writes NOTHING".
 */
function defaultTransactionImpl(arg: unknown) {
  if (typeof arg === 'function') {
    const tx = { klt: { upsert: h.kltUpsert } }
    return (arg as (tx: unknown) => Promise<unknown>)(tx)
  }
  return Promise.all(arg as Promise<unknown>[])
}

vi.mock('@/lib/db', () => ({
  prisma: {
    klt: { findMany: h.kltFindMany, upsert: h.kltUpsert },
    $transaction: h.transaction,
  },
}))

vi.mock('@/auth', () => ({ auth: h.auth }))

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

const EDITOR = 'user-1'

const node = (id: string, name: string, parentKltId: string | null, depth: number) => ({
  id, name, normalizedName: name, parentKltId, depth,
  ancestorIds: parentKltId ? [parentKltId] : [],
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KLT_EDITORS = EDITOR
  h.auth.mockResolvedValue({ user: { id: EDITOR } })
  h.transaction.mockImplementation(defaultTransactionImpl)
  h.kltFindMany.mockResolvedValue([])
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

describe('gating', () => {
  it('suggestSkeleton returns a not-found shape for a non-editor, never forbidden', async () => {
    process.env.KLT_EDITORS = 'someone-else'
    const res = await suggestSkeleton('finance')
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.kltFindMany).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('applySkeleton returns a not-found shape for a non-editor, never forbidden', async () => {
    process.env.KLT_EDITORS = 'someone-else'
    const res = await applySkeleton([['finance', 'accounting']])
    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.kltFindMany).not.toHaveBeenCalled()
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('both actions refuse everyone when KLT_EDITORS is unset', async () => {
    delete process.env.KLT_EDITORS
    const suggested = await suggestSkeleton('finance')
    const applied = await applySkeleton([['finance']])
    expect(suggested.success).toBe(false)
    expect(applied.success).toBe(false)
  })

  it('both actions refuse when there is no session at all', async () => {
    h.auth.mockResolvedValue(null)
    const suggested = await suggestSkeleton('finance')
    const applied = await applySkeleton([['finance']])
    expect(suggested.success).toBe(false)
    expect(applied.success).toBe(false)
  })
})

describe('suggestSkeleton', () => {
  it('writes NOTHING — the user reviews before anything lands', async () => {
    h.kltFindMany.mockResolvedValue([node('x', 'quick ratio', null, 0)])
    h.generateJson.mockResolvedValue({ paths: [['finance', 'accounting'], ['finance', 'valuation']] })

    const res = await suggestSkeleton('finance')

    expect(res.success).toBe(true)
    expect(res.success === true && res.data.paths).toEqual([
      ['finance', 'accounting'],
      ['finance', 'valuation'],
    ])
    // No write delegate exists on the mocked client at all (see the comment
    // above `defaultTransactionImpl`) — a create/update/upsert/delete call
    // would throw "is not a function" rather than silently succeed. The
    // transaction helper itself must also never be invoked.
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('samples unplaced leaf concepts and passes them to the prompt as evidence', async () => {
    h.kltFindMany.mockResolvedValue([
      node('f', 'finance', null, 0),
      node('a', 'accounting', 'f', 1), // has a parent AND is a root's child — not a leaf sample
      node('x', 'quick ratio', null, 0),
      node('y', 'minority interest', null, 0),
    ])
    h.generateJson.mockResolvedValue({ paths: [['finance', 'accounting']] })

    await suggestSkeleton('finance')

    expect(h.generateJson).toHaveBeenCalledTimes(1)
    const call = h.generateJson.mock.calls[0][0]
    expect(call.task).toBe('autocomplete')
    expect(call.prompt).toContain('quick ratio')
    expect(call.prompt).toContain('minority interest')
    // 'finance' is a root with a child, not an unplaced leaf, and must not
    // appear in the sample-evidence list.
    expect(call.prompt).not.toContain('- finance')
  })

  it('rejects an invalid subject name before ever reading the tree', async () => {
    const res = await suggestSkeleton('a name that is far too long to be a valid concept here')
    expect(res.success).toBe(false)
    expect(h.kltFindMany).not.toHaveBeenCalled()
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('turns a generation failure into a failed ActionResult, never a thrown error', async () => {
    h.kltFindMany.mockResolvedValue([])
    h.generateJson.mockRejectedValue(new Error('all credentials failed'))
    const res = await suggestSkeleton('finance')
    expect(res.success).toBe(false)
  })
})

describe('applySkeleton', () => {
  it('creates the missing chain for a path against an empty tree', async () => {
    const res = await applySkeleton([['finance', 'accounting']])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(2)
    expect(h.kltUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { normalizedName: 'finance' } }),
    )
    expect(h.kltUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { normalizedName: 'accounting' } }),
    )
  })

  it('rejects a skeleton path deeper than MAX_SKELETON_DEPTH, and REPORTS the refusal via skipped', async () => {
    const tooDeep = Array.from({ length: MAX_SKELETON_DEPTH + 1 }, (_, i) => `level${i}`)
    const res = await applySkeleton([tooDeep])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(0)
    expect(res.success === true && res.data.skipped).toBe(1)
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('creates missing nodes but NEVER re-parents an existing one, and counts the refusal as skipped', async () => {
    // 'accounting' already exists as a child of 'finance'. A skeleton path
    // that would insert a new level BETWEEN them (finance > ratios >
    // accounting) is a match-after-creation — resolvePlacementPath refuses
    // it outright, and applySkeleton must honour that null rather than
    // working around it.
    h.kltFindMany.mockResolvedValue([
      node('f', 'finance', null, 0),
      node('a', 'accounting', 'f', 1),
    ])
    const res = await applySkeleton([['finance', 'ratios', 'accounting']])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(0)
    expect(res.success === true && res.data.skipped).toBe(1)
    expect(h.kltUpsert).not.toHaveBeenCalled()
  })

  it('a mixed batch reports created and skipped independently, one bad path does not discard a good one', async () => {
    const tooDeep = Array.from({ length: MAX_SKELETON_DEPTH + 1 }, (_, i) => `level${i}`)
    const res = await applySkeleton([['finance', 'accounting'], tooDeep])
    expect(res.success).toBe(true)
    expect(res.success === true && res.data.created).toBe(2)
    expect(res.success === true && res.data.skipped).toBe(1)
  })

  it('is idempotent — applying the same skeleton twice creates nothing the second time, and does NOT count the no-op as skipped', async () => {
    const first = await applySkeleton([['finance', 'accounting']])
    expect(first.success === true && first.data.created).toBe(2)
    expect(first.success === true && first.data.skipped).toBe(0)

    // Reset call history only (implementations survive `clearAllMocks` —
    // it clears `.mock.calls`/`.mock.results`, not `mockImplementation`),
    // then simulate the second call reading a tree that already contains
    // exactly what the first call created.
    h.kltFindMany.mockClear()
    h.kltUpsert.mockClear()
    h.transaction.mockClear()
    h.kltFindMany.mockResolvedValue([
      node('klt-finance', 'finance', null, 0),
      node('klt-accounting', 'accounting', 'klt-finance', 1),
    ])

    const second = await applySkeleton([['finance', 'accounting']])
    expect(second.success).toBe(true)
    expect(second.success === true && second.data.created).toBe(0)
    // Already existing, not refused: skipped stays 0, not 1. A no-op success
    // must never be reported to the user as though something were refused.
    expect(second.success === true && second.data.skipped).toBe(0)
    expect(h.kltUpsert).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('never touches CardKlp, KlpState or AnswerKlpResult', async () => {
    // Those delegates are entirely absent from the mocked prisma client
    // above (top-level and inside the transaction callback). If applySkeleton
    // ever called one, this would blow up with "... is not a function"
    // rather than silently passing.
    await expect(applySkeleton([['finance', 'accounting']])).resolves.toMatchObject({ success: true })
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
