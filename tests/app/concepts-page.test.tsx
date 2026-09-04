// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ auth: vi.fn(), notFound: vi.fn(), setFindMany: vi.fn() }))

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
vi.mock('@/lib/db', () => ({ prisma: { set: { findMany: h.setFindMany } } }))

import ConceptsPage from '@/app/(app)/concepts/page'

beforeEach(() => {
  vi.clearAllMocks()
  h.setFindMany.mockResolvedValue([])
})
afterEach(cleanup)

describe('/concepts (admin picker)', () => {
  it('calls notFound() for a signed-in learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone', role: 'learner' } })
    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalledTimes(1)
    expect(h.setFindMany).not.toHaveBeenCalled()
  })

  it('calls notFound() for staff — reading the engine is not editing structure', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone', role: 'staff' } })
    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('calls notFound() for a signed-out visitor', async () => {
    h.auth.mockResolvedValue(null)

    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('calls notFound() for a signed-in user with no recognised role', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone' } })

    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('lists sets, each linking to that set’s own /sets/[id]/concepts editor — the SAME editor an owner uses', async () => {
    h.auth.mockResolvedValue({ user: { id: 'editor-1', role: 'admin' } })
    h.setFindMany.mockResolvedValue([
      {
        id: 'set-a',
        title: 'Finance 101',
        user: { name: 'Alice', email: 'a@x.com' },
        _count: { cards: 10, kltNodes: 3 },
      },
    ])

    render(await ConceptsPage())
    expect(h.notFound).not.toHaveBeenCalled()

    expect(screen.getByText('Finance 101')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /finance 101|open editor/i })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/sets/set-a/concepts')
    }
  })
})
