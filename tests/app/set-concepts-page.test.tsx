// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ access: vi.fn(), notFound: vi.fn() }))

// notFound() THROWS in Next, to unwind the render. The mock must too, or a
// call that gets swallowed somewhere would still look like a call and this
// guard would be incapable of failing.
vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/klt/access', () => ({ requireSetKltAccess: h.access }))

// ConceptTree pulls in '@/actions/klt-tree' and '@/actions/klt-seed', both
// 'use server' modules that import next-auth — irrelevant to what this file
// tests (the route's gate), so it's stubbed out rather than exercised here.
vi.mock('@/components/klt/ConceptTree', () => ({
  ConceptTree: ({ setId, setTitle }: { setId: string; setTitle: string }) => (
    <div data-testid="concept-tree">
      {setId} / {setTitle}
    </div>
  ),
}))

import SetConceptsPage from '@/app/sets/[id]/concepts/page'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('/sets/[id]/concepts', () => {
  it('calls notFound() — a real 404 — when requireSetKltAccess refuses (stranger, signed-out, or nonexistent set alike)', async () => {
    h.access.mockResolvedValue(null)

    await expect(SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalledTimes(1)
  })

  it('renders ConceptTree for the owner, scoped to the resolved setId/setTitle, without ever calling notFound', async () => {
    h.access.mockResolvedValue({ userId: 'owner-1', setId: 'set-1', setTitle: 'Finance 101', viaAllowlist: false })

    render(await SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) }))

    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('concept-tree')).toHaveTextContent('set-1 / Finance 101')
  })

  it('renders ConceptTree for an allowlisted operator who does not own the set', async () => {
    h.access.mockResolvedValue({ userId: 'admin-1', setId: 'set-1', setTitle: 'Someone Else’s Deck', viaAllowlist: true })

    render(await SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) }))

    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('concept-tree')).toBeInTheDocument()
  })
})
