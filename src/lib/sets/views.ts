/**
 * The three views of a set, and which one is current.
 *
 * Study is what you do with the set, Knowledge is what you know about it, and
 * Analysis is why you get things wrong. They are peers, which is why this is a
 * tab strip rather than the outline "Concepts" button it replaces.
 */

export type SetViewKey = 'study' | 'knowledge' | 'analysis'

export interface SetViewTab {
  key: SetViewKey
  href: string
  label: string
  /** One line, shown as a title attribute — these names are short by design. */
  hint: string
}

export function setViewTabs(setId: string): SetViewTab[] {
  return [
    {
      key: 'study',
      href: `/sets/${setId}`,
      label: 'Study',
      hint: 'Flashcards, activities and the full term list',
    },
    {
      key: 'knowledge',
      href: `/sets/${setId}/knowledge`,
      label: 'Knowledge',
      hint: 'Concepts, categories, confidence and your history with this set',
    },
    {
      key: 'analysis',
      href: `/sets/${setId}/analysis`,
      label: 'Analysis',
      hint: 'Retention, misconceptions and what you answer slowly',
    },
  ]
}

/**
 * EXACT MATCH. THE THIRD TIME THIS RULE HAS BEEN NEEDED IN THIS CODEBASE.
 *
 * `/sets/abc` is a prefix of `/sets/abc/knowledge` and of `/sets/abc/analysis`,
 * so the obvious `startsWith` spelling marks Study current on all three tabs at
 * once — and on `/edit`, and on every study activity launched from the set.
 *
 * `ProfileNav.isCurrentTab` documents this for the profile tabs and
 * `isRailItemCurrent` documents it for the rail. The lesson that finally stuck:
 * the individual assertions are easy to "fix" one at a time, so the test that
 * matters is the PROPERTY — at most one tab is ever current, for every path.
 */
export function isSetViewCurrent(pathname: string, href: string): boolean {
  return pathname === href
}

/** Which view a pathname is showing, or null if it is not a set view at all. */
export function currentSetView(pathname: string, setId: string): SetViewKey | null {
  const match = setViewTabs(setId).find((tab) => isSetViewCurrent(pathname, tab.href))
  return match?.key ?? null
}

/**
 * Knowledge renders its concepts as a map or as a list.
 *
 * A URL PARAM, not local state: the choice survives a reload and can be linked,
 * and a learner who prefers the list should not have to re-choose it on every
 * set. `map` is the default because the spatial view is the point of the
 * feature; the list is the one that has to keep working after it.
 */
export type ConceptView = 'map' | 'list'

export function parseConceptView(value: string | undefined): ConceptView {
  return value === 'list' ? 'list' : 'map'
}
