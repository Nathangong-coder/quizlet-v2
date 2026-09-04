'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/staff', label: 'Overview' },
  { href: '/staff/klps', label: 'Key points' },
  { href: '/staff/coverage', label: 'Coverage' },
  { href: '/staff/learners', label: 'Learners' },
] as const

/**
 * EXACT MATCH, never startsWith — the rule src/lib/shell/nav.ts documents.
 * `/staff` is a prefix of every tab here, so a prefix test would light the
 * Overview tab on every page.
 */
export function StaffNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const tabs = isAdmin ? [...TABS, { href: '/staff/roles', label: 'Roles' }] : TABS

  return (
    <nav aria-label="Staff" className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className={cn(
            'px-3 py-2 text-sm border-b-2 -mb-px',
            pathname === t.href
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
