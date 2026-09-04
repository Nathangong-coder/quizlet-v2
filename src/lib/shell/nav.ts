/**
 * The left rail's destinations, and which one is current.
 *
 * Pure and router-free on purpose: the active-state rule below is the single
 * thing about a persistent nav that is easy to get subtly wrong, and it should
 * be provable without mounting a component or faking `usePathname`.
 */

import { isStaff } from '@/lib/auth/roles'

export type RailIcon = 'home' | 'compass' | 'library' | 'plus' | 'login' | 'gauge'

export interface RailItem {
  href: string
  label: string
  icon: RailIcon
}

/**
 * What the rail offers, by session state.
 *
 * A signed-out visitor still gets a rail rather than a bare page. `/browse` is
 * the only surface a stranger can use to judge whether this app is worth an
 * account, and showing them an empty frame at that exact moment makes the
 * product look smaller than it is. What they do NOT get is Library and New set,
 * which would both bounce them straight to a sign-in wall.
 */
export function railItems(signedIn: boolean, role?: string | null): RailItem[] {
  if (!signedIn) {
    return [
      { href: '/', label: 'Home', icon: 'home' },
      { href: '/browse', label: 'Browse', icon: 'compass' },
      { href: '/login', label: 'Sign in', icon: 'login' },
    ]
  }
  const items: RailItem[] = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/browse', label: 'Browse', icon: 'compass' },
    { href: '/sets', label: 'Library', icon: 'library' },
    { href: '/sets/new', label: 'New set', icon: 'plus' },
  ]
  // A signed-out visitor never sees it regardless of role — there is no role
  // without a session, and the early return above already guarantees that.
  if (isStaff(role)) items.push({ href: '/staff', label: 'Staff', icon: 'gauge' })
  return items
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

/**
 * A recents row is current only on that set's own page — not on its edit
 * screen, and not inside a quiz launched from it. Those are different places,
 * and highlighting the rail row while the rail is not even the way you got
 * there would be a claim about location that is false.
 */
export function isRecentCurrent(pathname: string, setId: string): boolean {
  return pathname === `/sets/${setId}`
}

/** How many recents the rail shows. The homepage strip keeps its own, larger, limit. */
export const RAIL_RECENTS_LIMIT = 6
