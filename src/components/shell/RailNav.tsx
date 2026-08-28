'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Compass, Library, Plus, LogIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import { railItems, isRailItemCurrent, isRecentCurrent, type RailIcon } from '@/lib/shell/nav'

const ICONS: Record<RailIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  compass: Compass,
  library: Library,
  plus: Plus,
  login: LogIn,
}

export interface RailRecent {
  id: string
  title: string
  isOwn: boolean
}

/**
 * The rail's links. The ONLY client component in the shell's navigation —
 * everything around it (the wordmark, the data fetch, the container) is server
 * rendered, and this exists solely because active state needs `usePathname`.
 *
 * All the logic it uses is imported from `@/lib/shell/nav`, which is pure and
 * tested without a router. Nothing here decides anything.
 */
export function RailNav({
  signedIn,
  recents,
  onNavigate,
}: {
  signedIn: boolean
  recents: RailRecent[]
  /** Lets the mobile drawer close itself when a link is taken. */
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const items = railItems(signedIn)

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const current = isRailItemCurrent(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              current
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}

      {recents.length > 0 && (
        <>
          {/* The divider and heading only exist when there is something under
              them. An empty "RECENTS" label is a promise the rail cannot keep
              and reads as a broken query rather than as a new account. */}
          <div className="mt-6 mb-2 px-3">
            <p className="label text-muted-foreground">Recents</p>
          </div>
          <ul className="flex flex-col gap-0.5">
            {recents.map((recent) => {
              const current = isRecentCurrent(pathname, recent.id)
              return (
                <li key={recent.id}>
                  <Link
                    href={`/sets/${recent.id}`}
                    onClick={onNavigate}
                    aria-current={current ? 'page' : undefined}
                    title={recent.title}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      current
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    {/* A 3px tick, not an icon: it marks whose set it is
                        without spending the width an icon would. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-3.5 w-[3px] shrink-0 rounded-full',
                        recent.isOwn ? 'bg-primary/50' : 'bg-muted-foreground/30',
                      )}
                    />
                    <span className="truncate">{recent.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </nav>
  )
}
