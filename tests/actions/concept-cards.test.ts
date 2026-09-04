import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `listConceptCards` — the panel that answers "what is actually filed under
 * this concept".
 *
 * Its own file rather than an addition to `klt-tree.test.ts`: that suite's
 * fake store models nodes and topics but no key points or cards, and widening
 * it to carry both would make every unrelated fixture there heavier for one
 * read path.
 */
const h = vi.hoisted(() => ({
  view: vi.fn(),
  nodeFindMany: vi.fn(),
  topicFindMany: vi.fn(),
}))

vi.mock('@/lib/klt/access', () => ({
  requireSetKltAccess: vi.fn(async () => null),
  requireSetKltView: h.view,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    klt: {},
    setKltNode: { findMany: h.nodeFindMany },
    klpTopic: { findMany: h.topicFindMany },
    $transaction: vi.fn(),
  },
}))

import { listConceptCards } from '@/actions/klt-tree'

const SET_ID = 'set-a'
const VIEW = {
  viewerId: 'viewer-1',
  setId: SET_ID,
  setTitle: 'Finance 101',
  canEdit: false,
  viaRole: false,
}

/**
 *   k-fin (finance)
 *     k-bs (balance sheet)
 *       k-wc (working capital)
 *     k-is (income statement)
 */
const NODES = [
  { id: 'n1', kltId: 'k-fin', parentKltId: null, depth: 0, ancestorIds: [], color: null, icon: null, klt: { name: 'finance', normalizedName: 'finance' } },
  { id: 'n2', kltId: 'k-bs', parentKltId: 'k-fin', depth: 1, ancestorIds: ['k-fin'], color: null, icon: null, klt: { name: 'balance sheet', normalizedName: 'balance sheet' } },
  { id: 'n3', kltId: 'k-wc', parentKltId: 'k-bs', depth: 2, ancestorIds: ['k-fin', 'k-bs'], color: null, icon: null, klt: { name: 'working capital', normalizedName: 'working capital' } },
  { id: 'n4', kltId: 'k-is', parentKltId: 'k-fin', depth: 1, ancestorIds: ['k-fin'], color: null, icon: null, klt: { name: 'income statement', normalizedName: 'income statement' } },
]

interface TopicSeed {
  kltId: string
  klpId: string
  cardId: string
  rank?: number
  label?: string | null
  text?: string
  index?: number
  term?: string
  position?: number
}

function topic(seed: TopicSeed) {
  return {
    kltId: seed.kltId,
    rank: seed.rank ?? 1,
    klp: {
      id: seed.klpId,
      label: seed.label === undefined ? 'a label' : seed.label,
      text: seed.text ?? 'the full proposition',
      index: seed.index ?? 0,
      card: {
        id: seed.cardId,
        term: seed.term ?? 'A term',
        position: seed.position ?? 0,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.view.mockResolvedValue(VIEW)
  h.nodeFindMany.mockResolvedValue(NODES)
  h.topicFindMany.mockResolvedValue([])
})

describe('listConceptCards gating', () => {
  it('returns the not-found shape, touching no store, when the read gate refuses', async () => {
    h.view.mockResolvedValue(null)

    const res = await listConceptCards(SET_ID, 'k-bs')

    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found/i)
    expect(h.nodeFindMany).not.toHaveBeenCalled()
    expect(h.topicFindMany).not.toHaveBeenCalled()
  })

  it('scopes both queries to the setId the gate resolved, never the raw argument', async () => {
    h.view.mockResolvedValue({ ...VIEW, setId: 'set-resolved' })

    const res = await listConceptCards('set-argument', 'k-bs')

    expect(res.success).toBe(true)
    expect(h.nodeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { setId: 'set-resolved' } }))
    expect(h.topicFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          klp: expect.objectContaining({ card: { setId: 'set-resolved' } }),
        }),
      }),
    )
  })

  it('refuses a concept with no node in THIS set — a global concept is not automatically here', async () => {
    const res = await listConceptCards(SET_ID, 'k-elsewhere')

    expect(res.success).toBe(false)
    expect(res.success === false && res.error).toMatch(/not found in this set/i)
    expect(h.topicFindMany).not.toHaveBeenCalled()
  })

  it('asks only for live key points — a superseded one describes what a card USED to test', async () => {
    await listConceptCards(SET_ID, 'k-bs')

    expect(h.topicFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          klp: expect.objectContaining({ supersededAt: null }),
        }),
      }),
    )
  })
})

describe('listConceptCards results', () => {
  it('queries the concept together with its descendants, and nothing outside the subtree', async () => {
    await listConceptCards(SET_ID, 'k-bs')

    const where = h.topicFindMany.mock.calls[0][0].where
    expect(where.kltId.in).toEqual(['k-bs', 'k-wc'])
    // A sibling and the parent are emphatically NOT in the subtree.
    expect(where.kltId.in).not.toContain('k-is')
    expect(where.kltId.in).not.toContain('k-fin')
  })

  it('splits direct links from descendant links, naming the child concept a descendant came from', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-bs', klpId: 'klp-1', cardId: 'card-1', term: 'Goodwill', position: 0 }),
      topic({ kltId: 'k-wc', klpId: 'klp-2', cardId: 'card-2', term: 'Current ratio', position: 1 }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success).toBe(true)
    if (!res.success) return

    expect(res.data.conceptName).toBe('balance sheet')
    expect(res.data.direct.map((c) => c.cardId)).toEqual(['card-1'])
    expect(res.data.direct[0].viaConcepts).toEqual([])
    expect(res.data.descendants.map((c) => c.cardId)).toEqual(['card-2'])
    expect(res.data.descendants[0].viaConcepts).toEqual(['working capital'])
  })

  it('groups a card citing the concept from several key points into ONE row with several lines', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-bs', klpId: 'klp-2', cardId: 'card-1', index: 1, label: 'second' }),
      topic({ kltId: 'k-bs', klpId: 'klp-1', cardId: 'card-1', index: 0, label: 'first' }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success).toBe(true)
    if (!res.success) return

    expect(res.data.direct).toHaveLength(1)
    // Rank first (centrality), then the card's own key-point order.
    expect(res.data.direct[0].klps.map((k) => k.label)).toEqual(['first', 'second'])
  })

  it('orders key points by rank before index, so the concept’s main point leads', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-bs', klpId: 'klp-a', cardId: 'card-1', index: 0, rank: 2, label: 'also covers' }),
      topic({ kltId: 'k-bs', klpId: 'klp-b', cardId: 'card-1', index: 1, rank: 1, label: 'chiefly about' }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success === true && res.data.direct[0].klps.map((k) => k.label)).toEqual([
      'chiefly about',
      'also covers',
    ])
  })

  it('never lists a directly-tagged card AGAIN under a child, so the expander count is what the list is missing', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-bs', klpId: 'klp-1', cardId: 'card-1' }),
      topic({ kltId: 'k-wc', klpId: 'klp-2', cardId: 'card-1' }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success).toBe(true)
    if (!res.success) return

    expect(res.data.direct.map((c) => c.cardId)).toEqual(['card-1'])
    expect(res.data.descendants).toEqual([])
  })

  it('sorts by the card’s position in the set, so the panel reads in deck order', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-bs', klpId: 'klp-3', cardId: 'card-c', position: 9 }),
      topic({ kltId: 'k-bs', klpId: 'klp-1', cardId: 'card-a', position: 1 }),
      topic({ kltId: 'k-bs', klpId: 'klp-2', cardId: 'card-b', position: 4 }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success === true && res.data.direct.map((c) => c.cardId)).toEqual([
      'card-a',
      'card-b',
      'card-c',
    ])
  })

  it('carries an unlabelled key point’s full text through, so the UI never renders a blank line', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-bs', klpId: 'klp-1', cardId: 'card-1', label: null, text: 'Assets equal liabilities plus equity.' }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.direct[0].klps[0].label).toBeNull()
    expect(res.data.direct[0].klps[0].text).toBe('Assets equal liabilities plus equity.')
  })

  it('lists one card once even when two of its key points file it under the same child', async () => {
    h.topicFindMany.mockResolvedValue([
      topic({ kltId: 'k-wc', klpId: 'klp-1', cardId: 'card-1' }),
      topic({ kltId: 'k-wc', klpId: 'klp-2', cardId: 'card-1' }),
    ])

    const res = await listConceptCards(SET_ID, 'k-bs')
    expect(res.success === true && res.data.descendants).toHaveLength(1)
  })

  it('reports an empty subtree as empty, not as an error', async () => {
    const res = await listConceptCards(SET_ID, 'k-is')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.direct).toEqual([])
    expect(res.data.descendants).toEqual([])
  })
})
