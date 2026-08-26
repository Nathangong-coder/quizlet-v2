import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), notFound: vi.fn() }))

// notFound() THROWS in Next, to unwind the render. The mock must too, or a
// call that gets swallowed somewhere would still look like a call and this
// guard would be incapable of failing — same technique as
// tests/app/verify-route.test.tsx for redirect().
vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/auth', () => ({ auth: h.auth }))

// ConceptTree pulls in '@/actions/klt-tree' and '@/actions/klt-seed', both
// 'use server' modules that import next-auth — irrelevant to what this file
// tests (the route's gate), so it's stubbed out rather than exercised here.
vi.mock('@/components/klt/ConceptTree', () => ({ ConceptTree: () => null }))

import ConceptsPage from '@/app/concepts/page'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KLT_EDITORS
})

describe('/concepts', () => {
  it('calls notFound() — a real 404 — for a signed-in non-editor, never a redirect or a message', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone' } })
    process.env.KLT_EDITORS = 'someone-else'

    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalledTimes(1)
  })

  it('calls notFound() for a signed-out visitor', async () => {
    h.auth.mockResolvedValue(null)
    process.env.KLT_EDITORS = 'anyone'

    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('calls notFound() when KLT_EDITORS is unset, even for a real user', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone' } })
    // KLT_EDITORS deliberately left unset by beforeEach's delete.

    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders the tree for an editor, without ever calling notFound', async () => {
    h.auth.mockResolvedValue({ user: { id: 'editor-1' } })
    process.env.KLT_EDITORS = 'editor-1'

    const result = await ConceptsPage()
    expect(result).toBeTruthy()
    expect(h.notFound).not.toHaveBeenCalled()
  })
})
