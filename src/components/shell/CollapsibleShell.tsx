'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RailNav, type RailFolder, type RailRecent } from '@/components/shell/RailNav'
import { MobileRail } from '@/components/shell/MobileRail'
import ThemeToggle from '@/components/theme/ThemeToggle'
import { SynapseLogo } from '@/components/shell/SynapseLogo'

/**
 * The app frame owns the rail width so collapsing it can reclaim the whole
 * content column. The mobile drawer remains separate below `lg`.
 */
export function CollapsibleShell({
  children,
  signedIn,
  recents,
  folders,
  account,
}: {
  children: React.ReactNode
  signedIn: boolean
  recents: RailRecent[]
  folders: RailFolder[]
  account: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className={cn(
        'min-h-screen bg-background lg:grid lg:transition-[grid-template-columns] lg:duration-200',
        collapsed ? 'lg:grid-cols-[4.75rem_minmax(0,1fr)]' : 'lg:grid-cols-[15rem_minmax(0,1fr)]',
      )}
    >
      <aside
        className={cn(
          'sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar py-6 lg:flex',
          collapsed ? 'gap-8 px-2' : 'gap-8 px-4',
        )}
      >
        <div className={cn('flex', collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between gap-2')}>
          <Link href="/" aria-label="synapseHQ home">
            <SynapseLogo
              id="rail"
              withWordmark={!collapsed}
              className={cn(collapsed ? 'h-8 w-8' : 'h-9 w-auto', 'text-foreground')}
            />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground',
              'transition-colors hover:bg-sidebar-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <RailNav signedIn={signedIn} recents={recents} folders={folders} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/70 bg-background/95 px-5 backdrop-blur lg:px-10">
          <MobileRail signedIn={signedIn} recents={recents} folders={folders} />
          <Link href="/" className="lg:hidden" aria-label="synapseHQ home">
            <SynapseLogo id="topbar" className="h-7 w-auto text-foreground" />
          </Link>

          <div className="flex-1" />
          <ThemeToggle />
          {account}
        </header>

        <main className="flex-1 w-full max-w-[75rem] px-5 py-9 lg:px-10 lg:py-12">{children}</main>
      </div>
    </div>
  )
}
