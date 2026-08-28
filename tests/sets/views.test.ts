import { describe, it, expect } from 'vitest'
import {
  setViewTabs,
  isSetViewCurrent,
  currentSetView,
  parseConceptView,
} from '@/lib/sets/views'

const SET = 'abc123'

describe('setViewTabs', () => {
  it('offers exactly Study, Knowledge and Analysis', () => {
    expect(setViewTabs(SET).map((t) => t.key)).toEqual(['study', 'knowledge', 'analysis'])
  })

  it('points Study at the set root, not at a sub-route', () => {
    expect(setViewTabs(SET)[0].href).toBe(`/sets/${SET}`)
  })

  it('gives every tab a unique href, a label and a hint', () => {
    const tabs = setViewTabs(SET)
    expect(new Set(tabs.map((t) => t.href)).size).toBe(tabs.length)
    for (const tab of tabs) {
      expect(tab.label.length).toBeGreaterThan(0)
      expect(tab.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('isSetViewCurrent', () => {
  it('does NOT mark Study current on Knowledge or Analysis', () => {
    // `/sets/abc` is a prefix of both, so `startsWith` lights Study on every
    // tab at once. Third time this rule has been needed in this codebase.
    expect(isSetViewCurrent(`/sets/${SET}/knowledge`, `/sets/${SET}`)).toBe(false)
    expect(isSetViewCurrent(`/sets/${SET}/analysis`, `/sets/${SET}`)).toBe(false)
  })

  it('does NOT mark Study current on edit or on a study activity', () => {
    for (const path of ['/edit', '/quiz', '/match', '/review', '/print', '/concepts']) {
      expect(
        isSetViewCurrent(`/sets/${SET}${path}`, `/sets/${SET}`),
        `${path} must not highlight Study`,
      ).toBe(false)
    }
  })

  it('marks an exact match current', () => {
    expect(isSetViewCurrent(`/sets/${SET}`, `/sets/${SET}`)).toBe(true)
    expect(isSetViewCurrent(`/sets/${SET}/knowledge`, `/sets/${SET}/knowledge`)).toBe(true)
  })

  it('AT MOST ONE tab is current, for every path a set can be at', () => {
    // The property the assertions above are instances of. Individual cases are
    // easy to "fix" one at a time; this one fails on any reintroduction of
    // prefix matching, whatever shape it takes.
    const paths = [
      `/sets/${SET}`,
      `/sets/${SET}/knowledge`,
      `/sets/${SET}/analysis`,
      `/sets/${SET}/edit`,
      `/sets/${SET}/concepts`,
      `/sets/${SET}/quiz`,
      `/sets/${SET}/match`,
      `/sets/${SET}/review`,
      `/sets/${SET}/print`,
      '/sets',
      '/',
    ]
    for (const path of paths) {
      const current = setViewTabs(SET).filter((t) => isSetViewCurrent(path, t.href))
      expect(current.length, `${path} matched ${current.length} tabs`).toBeLessThanOrEqual(1)
    }
  })

  it('does not confuse a set whose id is a prefix of another', () => {
    expect(isSetViewCurrent(`/sets/${SET}0/knowledge`, `/sets/${SET}/knowledge`)).toBe(false)
  })
})

describe('currentSetView', () => {
  it('names the view a pathname is showing', () => {
    expect(currentSetView(`/sets/${SET}`, SET)).toBe('study')
    expect(currentSetView(`/sets/${SET}/knowledge`, SET)).toBe('knowledge')
    expect(currentSetView(`/sets/${SET}/analysis`, SET)).toBe('analysis')
  })

  it('returns null where no tab applies', () => {
    // Edit and the concept editor are not views of the set in this sense; they
    // deliberately render outside the tab strip.
    expect(currentSetView(`/sets/${SET}/edit`, SET)).toBeNull()
    expect(currentSetView(`/sets/${SET}/concepts`, SET)).toBeNull()
  })
})

describe('parseConceptView', () => {
  it('defaults to the map', () => {
    // The spatial view is the point of the feature; the list is the one that
    // has to keep working after it.
    expect(parseConceptView(undefined)).toBe('map')
    expect(parseConceptView('')).toBe('map')
    expect(parseConceptView('nonsense')).toBe('map')
  })

  it('honours an explicit list', () => {
    expect(parseConceptView('list')).toBe('list')
  })
})
