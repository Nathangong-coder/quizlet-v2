// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ view: vi.fn(), notFound: vi.fn() }))

// notFound() THROWS in Next, to unwind the render. The mock must too, or a
// call that gets swallowed somewhere would still look like a call and this
// guard would be incapable of failing.
vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/klt/access', () => ({ requireSetKltView: h.view }))

// ConceptTree pulls in '@/actions/klt-tree' and '@/actions/klt-seed', both
// 'use server' modules that import next-auth — irrelevant to what this file
// tests (the route's gate), so it's stubbed out rather than exercised here.
vi.mock('@/components/klt/ConceptTree', () => ({
  ConceptTree: ({
    setId,
    setTitle,
    canEdit,
    isAdmin,
  }: {
    setId: string
    setTitle: string
    canEdit: boolean
    isAdmin: boolean
  }) => (
    <div data-testid="concept-tree" data-can-edit={String(canEdit)} data-is-admin={String(isAdmin)}>
      {setId} / {setTitle}
    </div>
  ),
}))

import SetConceptsPage from '@/app/sets/[id]/concepts/page'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('/sets/[id]/concepts', () => {
  it('calls notFound() — a real 404 — when requireSetKltView refuses (stranger, private set, or nonexistent set alike)', async () => {
    h.view.mockResolvedValue(null)

    await expect(SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalledTimes(1)
  })

  it('renders ConceptTree for the owner, scoped to the resolved setId/setTitle, without ever calling notFound', async () => {
    h.view.mockResolvedValue({
      viewerId: 'owner-1',
      setId: 'set-1',
      setTitle: 'Finance 101',
      canEdit: true,
      viaAllowlist: false,
    })

    render(await SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) }))

    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('concept-tree')).toHaveTextContent('set-1 / Finance 101')
    expect(screen.getByTestId('concept-tree')).toHaveAttribute('data-can-edit', 'true')
  })

  it('renders ConceptTree for an allowlisted operator who does not own the set', async () => {
    h.view.mockResolvedValue({
      viewerId: 'admin-1',
      setId: 'set-1',
      setTitle: 'Someone Else’s Deck',
      canEdit: true,
      viaAllowlist: true,
    })

    render(await SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) }))

    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('concept-tree')).toHaveAttribute('data-is-admin', 'true')
  })

  it('renders READ-ONLY for someone holding the link to a set they do not own', async () => {
    // The whole point of the read gate: the page must render, and it must
    // hand the tree canEdit=false. Rendering it with canEdit=true would put
    // controls in front of a viewer that every server action then refuses.
    h.view.mockResolvedValue({
      viewerId: 'viewer-1',
      setId: 'set-1',
      setTitle: 'Shared Deck',
      canEdit: false,
      viaAllowlist: false,
    })

    render(await SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) }))

    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('concept-tree')).toHaveAttribute('data-can-edit', 'false')
  })

  it('renders read-only for a signed-out visitor holding the link', async () => {
    h.view.mockResolvedValue({
      viewerId: null,
      setId: 'set-1',
      setTitle: 'Shared Deck',
      canEdit: false,
      viaAllowlist: false,
    })

    render(await SetConceptsPage({ params: Promise.resolve({ id: 'set-1' }) }))

    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('concept-tree')).toHaveAttribute('data-can-edit', 'false')
  })
})
