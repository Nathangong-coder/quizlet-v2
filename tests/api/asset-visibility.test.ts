import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  assetFindUnique: vi.fn(),
  blobGet: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: { cardAsset: { findUnique: h.assetFindUnique } } }))
vi.mock('@vercel/blob', () => ({ get: h.blobGet, del: vi.fn() }))

import { GET } from '@/app/api/assets/[id]/route'

const OWNER = 'user-owner'
const OTHER = 'user-other'
const params = Promise.resolve({ id: 'asset1' })
const call = () => GET({} as never, { params })

/**
 * An asset reached through its content block's card's set.
 *
 * `visibility: null` models an asset not yet attached to any card — uploads
 * create the row before linking it — which must stay owner-only, since there
 * is no set whose visibility could speak for it.
 */
const asset = (setOwner: string, visibility: string | null) => ({
  id: 'asset1',
  userId: setOwner,
  storageKey: 'k',
  mimeType: 'image/png',
  originalName: 'a.png',
  contentBlocks:
    visibility === null ? [] : [{ card: { set: { userId: setOwner, visibility } } }],
})

beforeEach(() => {
  vi.clearAllMocks()
  h.blobGet.mockResolvedValue({
    statusCode: 200,
    stream: 'STREAM',
    blob: { contentType: 'image/png', size: 3 },
  })
})

describe('GET /api/assets/[id]', () => {
  it('serves the owner their own private-set asset', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await call()).status).toBe(200)
  })

  it('denies another user an asset on a private set', async () => {
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await call()).status).toBe(404)
  })

  it('serves another user an asset on a link-shared set', async () => {
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'link'))
    expect((await call()).status).toBe(200)
  })

  it('serves an ANONYMOUS viewer an asset on a link-shared set', async () => {
    // Without this a shared set renders broken placeholders for the exact
    // audience share links exist for, with nothing on screen explaining why.
    h.auth.mockResolvedValue(null)
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'link'))
    expect((await call()).status).toBe(200)
  })

  it('denies an anonymous viewer an asset on a private set', async () => {
    h.auth.mockResolvedValue(null)
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await call()).status).toBe(404)
  })

  it('keeps an UNLINKED asset owner-only', async () => {
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, null))
    expect((await call()).status).toBe(404)
  })

  it('still serves the owner an unlinked asset', async () => {
    // The upload flow renders a preview before the block is saved.
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, null))
    expect((await call()).status).toBe(200)
  })

  it('answers 404, never 403, for a denied asset', async () => {
    // A distinguishable 403 confirms the asset exists to someone probing ids.
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    const res = await call()
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(404)
  })

  it('caches a shared asset publicly and a private one privately', async () => {
    // A shared asset served `private` is refetched per viewer for no benefit;
    // an owner-only asset served `public` could be cached by a shared proxy,
    // which is precisely the leak this change closes.
    h.auth.mockResolvedValue({ user: { id: OWNER } })

    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await call()).headers.get('Cache-Control')).toContain('private')

    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'link'))
    expect((await call()).headers.get('Cache-Control')).toContain('public')
  })

  it('404s a missing asset', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.assetFindUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
})
