// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * The profile area has three sibling pages and, before this, no navigation
 * between them — each child carried only "Back to profile". Spec 3C created
 * the problem by adding the third.
 */
afterEach(cleanup)

const h = vi.hoisted(() => ({ pathname: vi.fn(), search: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: h.pathname,
  useSearchParams: () => new URLSearchParams(h.search() ?? ''),
}))

import ProfileNav, {
  PROFILE_TABS,
  isCurrentTab,
  scopedHref,
} from '@/components/profile/ProfileNav'

beforeEach(() => h.search.mockReturnValue(''))

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

describe('scopedHref: the scope survives a tab change', () => {
  it('carries every scope dimension to a scoped sibling', () => {
    // Narrowing on Memory History and clicking Learner Profile used to discard
    // the scope silently and land on the saved default — even though both
    // pages parse the SAME HistoryScope out of the query string.
    const href = scopedHref('/profile/learner', 'sets=s1,s2&cats=valuation&card=c9&source=quiz-sa')
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('sets')).toBe('s1,s2')
    expect(params.get('cats')).toBe('valuation')
    expect(params.get('card')).toBe('c9')
    // Carried even though only Memory History renders a control for it:
    // dropping a dimension the destination still APPLIES would silently widen
    // the data on arrival.
    expect(params.get('source')).toBe('quiz-sa')
  })

  it('never scopes /profile, which takes none', () => {
    // Appending inert params to a URL that ignores them makes the link look
    // scoped when it is not.
    expect(scopedHref('/profile', 'sets=s1&cats=valuation')).toBe('/profile')
  })

  it('carries an explicit show-everything', () => {
    // `serializeScope(EMPTY_SCOPE)` is the empty string, so "I cleared the
    // scope" and "I have not chosen one" are otherwise the same URL — and the
    // destination would re-apply the saved default the learner just cleared.
    expect(scopedHref('/profile/learner', 'scope=all')).toBe('/profile/learner?scope=all')
  })

  it('drops scope=all once a real dimension exists, and ignores foreign params', () => {
    expect(scopedHref('/profile/memory', 'scope=all&sets=s1')).toBe('/profile/memory?sets=s1')
    expect(scopedHref('/profile/memory', 'utm=x&page=3')).toBe('/profile/memory')
  })

  it('returns a bare href when there is nothing to carry', () => {
    expect(scopedHref('/profile/learner', '')).toBe('/profile/learner')
    expect(scopedHref('/profile/learner', 'sets=&cats=  ')).toBe('/profile/learner')
  })
})

describe('ProfileNav: rendered links carry the scope', () => {
  it('puts the current scope on the sibling tabs but not on Overview', () => {
    h.pathname.mockReturnValue('/profile/memory')
    h.search.mockReturnValue('sets=s1&cats=valuation')
    render(<ProfileNav />)

    const link = (label: string) =>
      screen.getByText(label).getAttribute('href') ?? ''

    expect(link('Learner Profile')).toContain('sets=s1')
    expect(link('Learner Profile')).toContain('cats=valuation')
    expect(link('Overview')).toBe('/profile')
  })
})
