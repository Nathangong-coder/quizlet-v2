'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { RailNav, type RailRecent } from '@/components/shell/RailNav'
import { SynapseLogo } from '@/components/shell/SynapseLogo'

/**
 * The rail below `lg`: a hamburger and a slide-in drawer.
 *
 * Holds BOTH the trigger and the panel, and lives inside the topbar. The
 * alternative — a button in the topbar and a drawer in the layout — needs the
 * open state lifted into a context that exists for one boolean, and makes the
 * shell layout a client component to hold it.
 *
 * Re-renders `RailNav` rather than portalling the desktop one. Two instances of
 * a nav that derives everything from `usePathname` cost nothing and stay in
 * sync for free.
 */
export function MobileRail({ signedIn, recents }: { signedIn: boolean; recents: RailRecent[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-[4px]
                   text-muted-foreground transition-colors hover:bg-accent hover:text-foreground
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* The scrim closes the drawer. `aria-hidden` because the close
              button below is the accessible affordance; a focusable scrim would
              be a tab stop with no name. */}
          <button
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          />
          <div className="relative flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar p-5">
            <div className="mb-6 flex items-center justify-between">
              <Link
                href="/"
                onClick={() => setOpen(false)}
                aria-label="synapseHQ home"
              >
                <SynapseLogo id="drawer" className="h-8 w-auto text-foreground" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[4px]
                           text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RailNav signedIn={signedIn} recents={recents} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
