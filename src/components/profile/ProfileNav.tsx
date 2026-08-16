'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { SCOPE_PARAM_KEYS, SCOPE_ALL_PARAM } from '@/lib/memory/scope';

/**
 * One navigation across the three profile pages.
 *
 * Before this, `/profile` carried two text links and each child carried only
 * "Back to profile", so moving between the two leaves meant going up and back
 * down. Spec 3C created the problem by adding a third sibling.
 *
 * The names are a hierarchy, deliberately: the parent used to be titled "Your
 * Learning Memory" while one child was "Memory History" and the other "Learner
 * Profile" — a parent named after one of its children, and two children whose
 * names did not say which was which.
 */
export const PROFILE_TABS = [
  { href: '/profile', label: 'Overview', hint: 'Activity and totals' },
  { href: '/profile/learner', label: 'Learner Profile', hint: 'What you know and what to study' },
  { href: '/profile/memory', label: 'Memory History', hint: 'Every answer that shaped it' },
] as const;

/**
 * Exact match only. A `startsWith` test would mark Overview current on every
 * child route, since every one of them lives under `/profile`.
 */
export function isCurrentTab(pathname: string, href: string): boolean {
  return pathname === href;
}

/**
 * The scope dimensions both scoped tabs understand, carried across a tab
 * change. Narrowing to one set on Memory History and clicking Learner Profile
 * used to discard the scope silently and land on the saved default — the two
 * pages parse the SAME `HistoryScope` out of the query string, so there was
 * never a reason for the scope not to survive the move.
 *
 * `/profile` takes no scope, so it never receives one: appending inert params
 * to a URL that ignores them makes the link look scoped when it is not.
 *
 * `source` is deliberately included even though only Memory History renders a
 * control for it — dropping a dimension the target page still *applies* would
 * silently widen the data on arrival.
 *
 * Pure and exported so this is testable without a router.
 */
export function scopedHref(href: string, query: string): string {
  if (!query) return href;
  if (href === '/profile') return href;

  const incoming = new URLSearchParams(query);
  const carried = new URLSearchParams();
  for (const key of SCOPE_PARAM_KEYS) {
    const value = incoming.get(key)?.trim();
    if (value) carried.set(key, value);
  }

  // An explicit "show everything" is a real choice and must survive too, or
  // the destination falls back to the saved default and the tab change looks
  // like it re-applied a filter the learner had just cleared.
  const all = incoming.get(SCOPE_ALL_PARAM)?.trim();
  if (all && ![...carried].length) carried.set(SCOPE_ALL_PARAM, all);

  const qs = carried.toString();
  return qs ? `${href}?${qs}` : href;
}

export default function ProfileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  return (
    <nav aria-label="Profile sections" className="border-b">
      <ul className="flex flex-wrap gap-1 -mb-px">
        {PROFILE_TABS.map((tab) => {
          const current = isCurrentTab(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={scopedHref(tab.href, query)}
                aria-current={current ? 'page' : undefined}
                title={tab.hint}
                className={cn(
                  'inline-block px-4 py-2 text-sm border-b-2 transition-colors',
                  current
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
