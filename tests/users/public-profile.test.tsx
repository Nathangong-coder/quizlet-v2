// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { buildProfileSetsWhere } from '@/lib/users/public-profile'
import { readableSetWhere, listableSetWhere } from '@/lib/sets/visibility'
import { checkBio, BIO_MAX_LENGTH } from '@/lib/users/bio'
import { RESERVED_HANDLES } from '@/lib/users/handle'
import { DirectoryCard } from '@/components/sets/DirectoryCard'
import type { DirectoryEntry } from '@/lib/sets/directory'

afterEach(cleanup)

describe('buildProfileSetsWhere', () => {
  it('composes readable AND listable AND the owner, never by spreading', () => {
    expect(buildProfileSetsWhere('viewer', 'owner')).toEqual({
      AND: [readableSetWhere('viewer'), listableSetWhere(), { userId: 'owner' }],
    })
  })

  it('excludes moderation-unlisted sets — they must not resurface on the profile', () => {
    const where = buildProfileSetsWhere(null, 'owner') as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual({ visibility: 'public', listingBlocked: false })
  })
})

describe('checkBio', () => {
  it('collapses whitespace to one line and turns empty into null', () => {
    expect(checkBio('  studying   for\n\nsuperdays ')).toEqual({ ok: true, bio: 'studying for superdays' })
    expect(checkBio('   ')).toEqual({ ok: true, bio: null })
  })
  it('rejects over the cap', () => {
    expect(checkBio('x'.repeat(BIO_MAX_LENGTH + 1))).toEqual({ ok: false, reason: 'too_long' })
    expect(checkBio('x'.repeat(BIO_MAX_LENGTH)).ok).toBe(true)
  })
})

describe('reserved handles', () => {
  it('reserves the features route (the /u/ prefix needs none: a handle is at least three characters)', () => {
    expect(RESERVED_HANDLES).toContain('features')
  })
})

describe('DirectoryCard author link', () => {
  const entry: DirectoryEntry = {
    id: 's1',
    title: 'Valuation basics',
    description: null,
    subject: 'valuation',
    cardCount: 12,
    forkCount: 0,
    publishedAt: null,
    handle: 'Alice_NG',
    categories: [],
    forkedFromId: null,
    forkedFromTitle: null,
    forkedFromHandle: null,
  }

  it('links the handle to the public profile, outside the title link', () => {
    render(<ul><DirectoryCard entry={entry} /></ul>)
    const author = screen.getByRole('link', { name: '@Alice_NG' })
    expect(author).toHaveAttribute('href', '/u/Alice_NG')
    // Not nested: the parser would drop an inner <a>, so assert it is not
    // inside the title link.
    for (const title of screen.getAllByRole('link', { name: /valuation basics/i })) expect(title.contains(author)).toBe(false)
  })

  it('omits the author on the profile page itself', () => {
    render(<ul><DirectoryCard entry={entry} showAuthor={false} /></ul>)
    expect(screen.queryByRole('link', { name: '@Alice_NG' })).toBeNull()
  })

  it('renders no credit at all for a handle-less owner', () => {
    render(<ul><DirectoryCard entry={{ ...entry, handle: null }} /></ul>)
    expect(screen.queryByText(/@/)).toBeNull()
  })
})

describe('/u/[handle] page', () => {
  it('404s an unknown handle before reading any sets', async () => {
    const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND') })
    const loadProfileSets = vi.fn()
    vi.doMock('next/navigation', () => ({ notFound }))
    vi.doMock('@/auth', () => ({ auth: vi.fn(async () => null) }))
    vi.doMock('@/lib/users/public-profile', () => ({
      loadPublicProfile: vi.fn(async () => null),
      loadProfileSets,
    }))
    const mod = await import('@/app/(app)/u/[handle]/page')
    await expect(mod.default({ params: Promise.resolve({ handle: 'nobody' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(loadProfileSets).not.toHaveBeenCalled()
    vi.doUnmock('next/navigation')
    vi.doUnmock('@/auth')
    vi.doUnmock('@/lib/users/public-profile')
  })
})
