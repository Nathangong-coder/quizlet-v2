// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * The profile area has three sibling pages and, before this, no navigation
 * between them — each child carried only "Back to profile". Spec 3C created
 * the problem by adding the third.
 */
afterEach(cleanup)

const h = vi.hoisted(() => ({ pathname: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: h.pathname }))

import ProfileNav, { PROFILE_TABS, isCurrentTab } from '@/components/profile/ProfileNav'

describe('isCurrentTab', () => {
  it('matches exactly, never by prefix', () => {
    // A startsWith test would mark Overview current on every child route,
    // since all three live under /profile — so every page would show two
    // current tabs and the marker would mean nothing.
    expect(isCurrentTab('/profile', '/profile')).toBe(true)
    expect(isCurrentTab('/profile/learner', '/profile')).toBe(false)
    expect(isCurrentTab('/profile/memory', '/profile')).toBe(false)
    expect(isCurrentTab('/profile/learner', '/profile/learner')).toBe(true)
  })
})

describe('ProfileNav', () => {
  it('offers every destination from every page', () => {
    for (const from of PROFILE_TABS) {
      cleanup()
      h.pathname.mockReturnValue(from.href)
      render(<ProfileNav />)
      for (const tab of PROFILE_TABS) {
        expect(screen.getByText(tab.label), `${tab.label} missing on ${from.href}`).toBeTruthy()
      }
    }
  })

  it('marks exactly one tab current, and the right one', () => {
    for (const from of PROFILE_TABS) {
      cleanup()
      h.pathname.mockReturnValue(from.href)
      render(<ProfileNav />)
      const current = screen.getAllByRole('link').filter(
        (el) => el.getAttribute('aria-current') === 'page',
      )
      expect(current.length, `on ${from.href}`).toBe(1)
      expect(current[0].textContent).toBe(from.label)
    }
  })

  it('marks nothing current on a profile route with no tab', () => {
    // /profile/activity/[id] is a real route with no tab of its own. A nav
    // that guesses would tell the reader they are somewhere they are not.
    h.pathname.mockReturnValue('/profile/activity/abc123')
    render(<ProfileNav />)
    expect(
      screen.getAllByRole('link').filter((el) => el.getAttribute('aria-current') === 'page'),
    ).toHaveLength(0)
  })

  it('names the parent something other than its children', () => {
    // The parent used to be titled "Your Learning Memory" while a child was
    // "Memory History" — a hierarchy that read as two names for one thing.
    const labels = PROFILE_TABS.map((t) => t.label)
    expect(labels).toEqual(['Overview', 'Learner Profile', 'Memory History'])
    expect(new Set(labels).size).toBe(labels.length)
  })
})
