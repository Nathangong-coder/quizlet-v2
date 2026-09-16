// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/sets' }))

import { RailNav } from '@/components/shell/RailNav'

afterEach(cleanup)

describe('RailNav (signed in)', () => {
  it('is Home · Notifications (badged) · Your library, then Start here, then folders and groups by name with a plain "+" row', () => {
    render(
      <RailNav
        signedIn
        folders={[{ id: 'f1', name: 'Superday' }]}
        groups={[{ id: 'g1', name: 'Workshop Prep' }]}
        unread={3}
      />,
    )
    const nav = screen.getByRole('navigation', { name: /main/i })
    const links = within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/', '/notifications', '/sets', '/browse', '/flashcards', '/study-guides', '/games', '/tests', '/folders/f1', '/folders/new', '/groups/g1', '/groups/new'])
    expect(screen.getByRole('link', { name: /notifications, 3 unread/i })).toBeTruthy()
    expect(screen.getByTestId('unread-badge').textContent).toBe('3')
    expect(screen.getByText('Start here')).toBeTruthy()
    // No "Your folders" title, no recents, no diagnostic, and the add rows are words.
    expect(screen.queryByText(/your folders/i)).toBeNull()
    expect(screen.queryByText(/recents/i)).toBeNull()
    expect(links).not.toContain('/diagnostic')
    expect(screen.getByRole('link', { name: '+ folder' }).textContent).toBe('+ folder')
    expect(screen.getByRole('link', { name: '+ group' }).textContent).toBe('+ group')
    expect(screen.getByRole('link', { name: /your library/i }).getAttribute('aria-current')).toBe('page')
  })

  it('hides the badge at zero and the Start here tools when signed out', () => {
    render(<RailNav signedIn={false} folders={[]} />)
    expect(screen.queryByTestId('unread-badge')).toBeNull()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/', '/browse', '/login'])
  })
})
