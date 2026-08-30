'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Compass, Library, NotebookPen, Plus, LogIn } from 'lucide-react'
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
  collapsed = false,
}: {
  signedIn: boolean
  recents: RailRecent[]
  /** Lets the mobile drawer close itself when a link is taken. */
  onNavigate?: () => void
  /** When true, the rail is icon-only and recent text is hidden. */
  collapsed?: boolean
}) {
  const pathname = usePathname()
  const items = railItems(signedIn)
  const postmortemCurrent = pathname === '/postmortem' || pathname.startsWith('/postmortem/')

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const current = isRailItemCurrent(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={current ? 'page' : undefined}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-[4px] py-2.5 text-[0.9375rem] transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              current
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_3px_0_0_var(--primary)]'
                : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && item.label}
          </Link>
        )
      })}

      {!collapsed && recents.length > 0 && (
        <>
          {/* The divider and heading only exist when there is something under
              them. An empty "RECENTS" label is a promise the rail cannot keep
              and reads as a broken query rather than as a new account. */}
          <div className="mt-8 mb-2 px-3">
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
                      'flex items-center gap-2 rounded-[4px] px-3 py-2 text-sm transition-colors',
                      current
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_3px_0_0_var(--primary)]'
                        : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
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

      {signedIn && (
        <div className={cn(
          'border-t border-sidebar-border pt-3',
          recents.length > 0 ? 'mt-5' : 'mt-8',
        )}>
          <Link
            href="/postmortem"
            onClick={onNavigate}
            aria-current={postmortemCurrent ? 'page' : undefined}
            aria-label="Postmortem"
            title={collapsed ? 'Postmortem' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-[4px] py-2.5 text-[0.9375rem] transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              postmortemCurrent
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_3px_0_0_var(--primary)]'
                : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
            )}
          >
            <NotebookPen className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && 'Postmortem'}
          </Link>
        </div>
      )}
    </nav>
  )
}
