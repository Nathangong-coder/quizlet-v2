// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SetStrip } from '@/components/home/SetStrip'
import type { RecentSet } from '@/lib/sets/recents'

afterEach(cleanup)

const set = (over: Partial<RecentSet> = {}): RecentSet => ({
  id: 's1', title: 'Merger Model', description: null, cardCount: 12,
  visibility: 'link', ownerHandle: 'alice', isOwn: false,
  viewedAt: new Date('2026-08-27T10:00:00Z'),
  createdAt: new Date('2026-08-01T10:00:00Z'), ...over,
})

describe('SetStrip', () => {
  it('links each set to its page', () => {
    render(<SetStrip sets={[set()]} />)
    expect(screen.getByRole('link', { name: /Merger Model/ })).toHaveAttribute(
      'href', '/sets/s1',
    )
  })

  it('credits the handle for someone else’s set', () => {
    render(<SetStrip sets={[set()]} />)
    expect(screen.getByText('@alice')).toBeInTheDocument()
  })

  it('does NOT credit a handle on your own set', () => {
    // "@you" on your own material is noise, and on a strip that mixes yours
    // with other people's the absence of a credit IS the signal.
    render(<SetStrip sets={[set({ isOwn: true })]} />)
    expect(screen.queryByText('@alice')).not.toBeInTheDocument()
  })

  it('omits the credit entirely when there is no handle', () => {
    // Never falls back to User.name — that is the OAuth real-name field.
    render(<SetStrip sets={[set({ ownerHandle: null })]} />)
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  it('renders nothing at all for an empty list', () => {
    // Spec §8: a block renders NOTHING rather than an empty shell. A new
    // account must see a create prompt, not three empty headings.
    const { container } = render(<SetStrip sets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one tile per set', () => {
    render(<SetStrip sets={[set(), set({ id: 's2', title: 'DCF' })]} />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /DCF/ })).toHaveAttribute('href', '/sets/s2')
  })
})
