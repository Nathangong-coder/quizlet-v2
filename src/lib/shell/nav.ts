/**
 * The left rail's destinations, and which one is current.
 *
 * Pure and router-free on purpose: the active-state rule below is the single
 * thing about a persistent nav that is easy to get subtly wrong, and it should
 * be provable without mounting a component or faking `usePathname`.
 *
 * SHAPE (owner, 2026-09-14, after Quizlet's rail): one section of Home ·
 * Notifications · Your library, then "Start here" — Browse, Flashcards,
 * Study guides, Games, Tests — each with its own icon and its own hub page.
 * Recents are gone; the diagnostic test lives under Tests, not the rail.
 * Folders and groups follow as plain name lists (no section title) with a
 * "+ folder" / "+ group" row.
 */

import { isStaff } from '@/lib/auth/roles'

export type RailIcon = 'home' | 'bell' | 'library' | 'compass' | 'layers' | 'scroll' | 'gamepad' | 'clipboard' | 'plus' | 'login' | 'gauge' | 'users'

export interface RailItem {
  href: string
  label: string
  icon: RailIcon
}

export interface RailSection {
  /** Shown as a small label above the section; undefined for the first one. */
  label?: string
  items: RailItem[]
}

export function railSections(signedIn: boolean, role?: string | null): RailSection[] {
  if (!signedIn) {
    // A signed-out visitor still gets a rail rather than a bare page: `/browse`
    // is the one surface a stranger can use to judge the app. What they do NOT
    // get is anything that would bounce them to a sign-in wall.
    return [
      { items: [{ href: '/', label: 'Home', icon: 'home' }] },
      { label: 'Start here', items: [{ href: '/browse', label: 'Browse', icon: 'compass' }] },
      { items: [{ href: '/login', label: 'Sign in', icon: 'login' }] },
    ]
  }
  const first: RailItem[] = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/notifications', label: 'Notifications', icon: 'bell' },
    { href: '/sets', label: 'Your library', icon: 'library' },
  ]
  // A signed-out visitor never sees it regardless of role — there is no role
  // without a session, and the early return above already guarantees that.
  if (isStaff(role)) first.push({ href: '/staff', label: 'Staff', icon: 'gauge' })
  return [
    { items: first },
    {
      label: 'Start here',
      items: [
        { href: '/browse', label: 'Browse', icon: 'compass' },
        { href: '/flashcards', label: 'Flashcards', icon: 'layers' },
        { href: '/study-guides', label: 'Study guides', icon: 'scroll' },
        { href: '/games', label: 'Games', icon: 'gamepad' },
        { href: '/tests', label: 'Tests', icon: 'clipboard' },
      ],
    },
  ]
}

/** Every rail link, flattened — for the tests and for anything that only needs the list. */
export function railItems(signedIn: boolean, role?: string | null): RailItem[] {
  return railSections(signedIn, role).flatMap((s) => s.items)
}

/**
 * EXACT MATCH, never `startsWith`.
 *
 * `startsWith` is the obvious spelling and it is wrong in three ways at once
 * here: `/sets` would light up on `/sets/abc123`, on `/sets/abc123/edit` and on
 * every study activity; `/sets` would ALSO light up alongside `/sets/new`,
 * marking two items current simultaneously; and `/` is a prefix of literally
 * every path, so Home would be permanently highlighted.
 *
 * `ProfileNav.isCurrentTab` documents the same trap for the profile tabs. This
 * is the second nav in the app to need the rule, which is why it now lives in a
 * module of its own rather than being rediscovered a third time.
 *
 * `/` still needs its own branch: it is the one href for which exact-match and
 * prefix-match differ in the direction that matters.
 */
export function isRailItemCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href
}

/** How many folders / groups the rail lists by name before "+ folder" / "+ group". */
export const RAIL_LIST_LIMIT = 6
