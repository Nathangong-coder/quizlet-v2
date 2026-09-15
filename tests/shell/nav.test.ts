import { describe, it, expect } from 'vitest'
import {
  railItems,
  isRailItemCurrent,
  railSections,
  RAIL_LIST_LIMIT,
} from '@/lib/shell/nav'

describe('railItems', () => {
  it('offers Home, Notifications and Your library, then the Start here tools, when signed in', () => {
    expect(railItems(true).map((i) => i.href)).toEqual(['/', '/notifications', '/sets', '/browse', '/flashcards', '/study-guides', '/games', '/tests'])
    const sections = railSections(true)
    expect(sections.map((s) => s.label)).toEqual([undefined, 'Start here'])
    // Every Start here tool has an icon of its own.
    const icons = sections[1].items.map((i) => i.icon)
    expect(new Set(icons).size).toBe(icons.length)
    // No recents, no diagnostic: the diagnostic lives under Tests.
    expect(railItems(true).some((i) => i.href === '/diagnostic')).toBe(false)
  })

  it('omits Library and New set when signed out', () => {
    // Both would bounce a visitor straight into a sign-in wall. Browse stays,
    // because it is the only surface a stranger can judge the app by.
    const hrefs = railItems(false).map((i) => i.href)
    expect(hrefs).not.toContain('/sets')
    expect(hrefs).not.toContain('/sets/new')
    expect(hrefs).toContain('/browse')
  })

  it('still renders a rail when signed out', () => {
    expect(railItems(false).length).toBeGreaterThan(0)
  })

  it('gives every item a unique href and a non-empty label', () => {
    for (const signedIn of [true, false]) {
      const items = railItems(signedIn)
      expect(new Set(items.map((i) => i.href)).size).toBe(items.length)
      for (const item of items) expect(item.label.length).toBeGreaterThan(0)
    }
  })
})

describe('isRailItemCurrent', () => {
  it('does NOT mark Library current on a set page', () => {
    // The whole reason this function exists. `startsWith` — the obvious
    // spelling — lights Library up on every set page, every edit screen and
    // every study activity.
    expect(isRailItemCurrent('/sets/abc123', '/sets')).toBe(false)
    expect(isRailItemCurrent('/sets/abc123/edit', '/sets')).toBe(false)
    expect(isRailItemCurrent('/sets/abc123/quiz', '/sets')).toBe(false)
  })

  it('does NOT mark two items current at once on /sets/new', () => {
    // Under prefix matching, /sets/new lights BOTH Library and New set.
    expect(isRailItemCurrent('/sets/new', '/sets')).toBe(false)
    expect(isRailItemCurrent('/sets/new', '/sets/new')).toBe(true)
  })

  it('marks Home current only on exactly /', () => {
    // "/" is a prefix of every path in the app, so prefix matching leaves Home
    // permanently highlighted.
    expect(isRailItemCurrent('/', '/')).toBe(true)
    expect(isRailItemCurrent('/browse', '/')).toBe(false)
    expect(isRailItemCurrent('/sets', '/')).toBe(false)
  })

  it('marks an exact match current', () => {
    expect(isRailItemCurrent('/browse', '/browse')).toBe(true)
    expect(isRailItemCurrent('/sets', '/sets')).toBe(true)
  })

  it('at most one item is ever current, for every path the rail links to', () => {
    // The property the three cases above are instances of. If a future edit
    // reintroduces prefix matching, this fails even if someone "fixes" the
    // individual assertions.
    const paths = ['/', '/browse', '/sets', '/sets/new', '/sets/abc', '/sets/abc/edit', '/account']
    for (const path of paths) {
      const current = railItems(true).filter((i) => isRailItemCurrent(path, i.href))
      expect(current.length, `${path} matched ${current.length} rail items`).toBeLessThanOrEqual(1)
    }
  })
})

describe('RAIL_LIST_LIMIT', () => {
  it('keeps the folder and group lists short enough not to compete with the page', () => {
    expect(RAIL_LIST_LIMIT).toBeGreaterThan(0)
    expect(RAIL_LIST_LIMIT).toBeLessThanOrEqual(8)
  })
})

describe('railItems and the staff entry', () => {
  it('hides Staff from a learner and from a signed-out visitor', () => {
    expect(railItems(true, 'learner').map((i) => i.href)).not.toContain('/staff')
    expect(railItems(false, 'admin').map((i) => i.href)).not.toContain('/staff')
  })

  it('shows Staff to staff and admin', () => {
    expect(railItems(true, 'staff').map((i) => i.href)).toContain('/staff')
    expect(railItems(true, 'admin').map((i) => i.href)).toContain('/staff')
  })

  it('defaults to hidden when no role is passed', () => {
    expect(railItems(true).map((i) => i.href)).not.toContain('/staff')
  })
})
