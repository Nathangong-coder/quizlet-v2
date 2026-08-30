'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { setViewTabs, isSetViewCurrent } from '@/lib/sets/views'

/**
 * Study / Knowledge / Analysis.
 *
 * A tab strip, not a button. The owner was explicit that the concept surface
 * should not be "a button beside Edit and Delete" — those are things you DO to
 * a set, and Knowledge is a way of LOOKING at it. Peers get tabs.
 *
 * The only client component in the set header; everything around it is server
 * rendered. All the logic comes from `@/lib/sets/views`, which is pure and
 * tested without a router.
 */
export function SetViewTabs({ setId }: { setId: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Set views" className="border-b border-border/80">
      <ul className="flex gap-1 -mb-px">
        {setViewTabs(setId).map((tab) => {
          const current = isSetViewCurrent(pathname, tab.href)
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                title={tab.hint}
                className={cn(
                  'inline-block px-4 py-2.5 text-sm border-b-2 transition-colors',
                  current
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
