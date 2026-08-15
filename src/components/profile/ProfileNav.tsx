'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

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

export default function ProfileNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Profile sections" className="border-b">
      <ul className="flex flex-wrap gap-1 -mb-px">
        {PROFILE_TABS.map((tab) => {
          const current = isCurrentTab(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
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
