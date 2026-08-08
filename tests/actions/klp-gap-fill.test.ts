import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Spec 3B sibling — set visibility, §7.
 *
 * `extractKlpsForCards` was owner-scoped, and its doc comment correctly called
 * that an authorization boundary: extraction is a WRITE, superseding live
 * CardKlp rows and mutating Card.klpStatus. Visibility widens the READ so a
 * viewer studying a link-shared set gets KLPs at all — otherwise True/False
 * falls back, MC distractors degrade, and every answer records `no_klps`,
 * polluting the VIEWER'S OWN learner profile with analysis that could not run.
 *
 * These tests pin the two constraints that keep the widening safe.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  cardKlpFindMany: vi.fn(),
  cardFindFirst: vi.fn(),
  cardFindMany: vi.fn(),
  cardUpdateMany: vi.fn(),
  cardUpdate: vi.fn(),
  generateJson: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    cardKlp: { findMany: h.cardKlpFindMany },
    card: {
      findFirst: h.cardFindFirst,
      findMany: h.cardFindMany,
      updateMany: h.cardUpdateMany,
      update: h.cardUpdate,
    },
    $transaction: vi.fn(async (fn: unknown) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)({}) : undefined,
    ),
  },
}))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  AiGenerationError: class extends Error {
    detail = { attempts: [] }
  },
}))

import { ensureKlpsReady } from '@/actions/klp'
import { klpSourceHash } from '@/lib/cards/klp-hash'

const OWNER = 'user-owner'
const VIEWER = 'user-viewer'

const LIVE = [{ id: 'k1', index: 0, text: 'a point', weight: 3, kind: 'fact' }]

/**
 * The hash of this fixture's own content. A card is "fresh" only when its
 * stored hash MATCHES its content — `selectStaleCardIds` counts a null hash as
 * stale by design (a never-extracted card), so hardcoding null here would test
 * the stale path while claiming to test the fresh one.
 */
const FRESH_HASH = klpSourceHash({ term: 'a', definition: 'b', blocks: [] })

const cardRow = (opts: {
  owner: string
  klpStatus?: string
  klpSourceHash?: string | null
}) => ({
  id: 'c1',
  term: 'a',
  definition: 'b',
  klpStatus: opts.klpStatus ?? 'ready',
  klpSourceHash: 'klpSourceHash' in opts ? opts.klpSourceHash! : FRESH_HASH,
  set: { userId: opts.owner },
  contentBlocks: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  h.cardUpdateMany.mockResolvedValue({ count: 0 })
  h.cardFindMany.mockResolvedValue([])
  h.generateJson.mockRejectedValue(new Error('no credential'))
})

describe('ensureKlpsReady on a set you do not own', () => {
  it('serves KLPs the owner already extracted, without extracting', async () => {
    h.cardKlpFindMany.mockResolvedValue(LIVE)
    h.cardFindFirst.mockResolvedValue(cardRow({ owner: OWNER }))

    expect(await ensureKlpsReady(VIEWER, 'c1')).toEqual(LIVE)
    expect(h.cardFindMany).not.toHaveBeenCalled()
  })

  it('NEVER supersedes a ready card, even when that card is stale', async () => {
    // Gap-fill only. Without this, anyone holding a link could replace the
    // propositions the owner's whole error-analysis substrate is built on,
    // using whatever model their credential happens to point at.
    h.cardKlpFindMany.mockResolvedValue(LIVE)
    h.cardFindFirst.mockResolvedValue(
      cardRow({ owner: OWNER, klpSourceHash: 'STALE-HASH-FROM-OLD-CONTENT' }),
    )

    expect(await ensureKlpsReady(VIEWER, 'c1')).toEqual(LIVE)
    expect(h.cardFindMany).not.toHaveBeenCalled()
    expect(h.cardUpdateMany).not.toHaveBeenCalled()
  })

  it('DOES fill a genuine gap — a card nobody has extracted yet', async () => {
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue(cardRow({ owner: OWNER, klpStatus: 'pending' }))

    await ensureKlpsReady(VIEWER, 'c1')
    // Reached extraction rather than short-circuiting, which is only possible
    // if the card was looked up under a READABLE scope, not an owner scope.
    expect(h.cardFindMany).toHaveBeenCalled()
  })

  it("does not mark the owner's card when the viewer's extraction fails", async () => {
    // A viewer with no usable AI credential would otherwise stamp 'skipped' on
    // a stranger's card and suppress the owner's own retry UI.
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue(cardRow({ owner: OWNER, klpStatus: 'pending' }))
    h.cardFindMany.mockRejectedValue(new Error('db down'))

    await ensureKlpsReady(VIEWER, 'c1')
    expect(h.cardUpdateMany).not.toHaveBeenCalled()
  })

  it('returns nothing for a card on a set the viewer cannot read at all', async () => {
    // readableSetWhere matched no set, so findFirst yields null.
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue(null)

    expect(await ensureKlpsReady(VIEWER, 'c1')).toEqual([])
    expect(h.cardFindMany).not.toHaveBeenCalled()
  })

  it('scopes the card lookup by readability, not by ownership', async () => {
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue(null)

    await ensureKlpsReady(VIEWER, 'c1')
    const where = h.cardFindFirst.mock.calls[0][0].where
    expect(where.id).toBe('c1')
    // The old shape was `set: { userId }`. It must now be the OR fragment.
    expect(where.set).toEqual({ OR: [{ userId: VIEWER }, { visibility: 'link' }] })
  })
})

describe('ensureKlpsReady for the owner is unchanged', () => {
  it('still re-extracts a stale card the owner owns', async () => {
    // The self-healing layer that stops distractors corrupting propositions
    // the card no longer teaches. Gap-fill must not have broken it.
    h.cardKlpFindMany.mockResolvedValue(LIVE)
    h.cardFindFirst.mockResolvedValue(
      cardRow({ owner: OWNER, klpSourceHash: 'STALE-HASH-FROM-OLD-CONTENT' }),
    )

    await ensureKlpsReady(OWNER, 'c1')
    expect(h.cardFindMany).toHaveBeenCalled()
  })

  it("still records a failure on the owner's own card", async () => {
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue(cardRow({ owner: OWNER, klpStatus: 'pending' }))
    h.cardFindMany.mockRejectedValue(new Error('db down'))

    await ensureKlpsReady(OWNER, 'c1')
    expect(h.cardUpdateMany).toHaveBeenCalled()
  })

  it('still short-circuits on a fresh card without extracting', async () => {
    h.cardKlpFindMany.mockResolvedValue(LIVE)
    h.cardFindFirst.mockResolvedValue(cardRow({ owner: OWNER }))

    expect(await ensureKlpsReady(OWNER, 'c1')).toEqual(LIVE)
    expect(h.cardFindMany).not.toHaveBeenCalled()
  })
})
