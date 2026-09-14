'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Menu, Plus, Search, X } from 'lucide-react'
import { SynapseLogo } from '@/components/shell/SynapseLogo'
import ThemeToggle from '@/components/theme/ThemeToggle'
import { buttonVariants } from '@/components/ui/button'
import type { NavLink } from '@/lib/marketing/nav'
import { cn } from '@/lib/utils'

/**
 * The signed-out top bar, replacing the app rail for visitors: logo,
 * Study tools ▾, Subjects ▾, a search box that lands on Browse, Create,
 * Log in. Signed-in users never see this — they keep the rail.
 *
 * The two menus are disclosure buttons (aria-expanded + a list), closed on
 * outside click and Escape. On small screens the menus collapse into one
 * drawer under a Menu button.
 *
 * `tools` and `subjects` arrive as PROPS from the server layout rather than
 * being imported here: `nav.ts` derives them from the full feature registry
 * (every page's copy) and importing it from a client module shipped all of
 * that to the browser to draw eight links. Props carry only the links.
 */
export function MarketingHeader({ signupOpen, signedIn = false, tools, subjects }: { signupOpen: boolean; signedIn?: boolean; tools: NavLink[]; subjects: NavLink[] }) {
  const [open, setOpen] = useState<'tools' | 'subjects' | null>(null)
  const [drawer, setDrawer] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const menu = (id: 'tools' | 'subjects', label: string, links: NavLink[]) => (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open === id}
        aria-controls={`menu-${id}`}
        onClick={() => setOpen(open === id ? null : id)}
        className={cn('inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-sm font-medium hover:bg-muted', open === id && 'bg-muted')}
      >
        {label}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open === id && 'rotate-180')} aria-hidden="true" />
      </button>
      {open === id && (
        <ul id={`menu-${id}`} className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-md)]">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={() => setOpen(null)} className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-muted">
                {l.label}
                {l.hint && <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">{l.hint}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div ref={ref} className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link href="/" aria-label="synapseHQ home" className="mr-1 shrink-0">
          <SynapseLogo id="marketing" className="h-8 w-auto text-foreground" />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
          {menu('tools', 'Study tools', tools)}
          {menu('subjects', 'Subjects', subjects)}
        </nav>

        <form action="/browse" role="search" className="relative mx-2 hidden min-w-0 flex-1 sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            name="q"
            placeholder="Search published sets"
            aria-label="Search published sets"
            className="h-9 w-full rounded-full border border-input bg-muted/60 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          {signedIn ? (
            <Link href="/sets" className={cn(buttonVariants({ size: 'sm' }))}>Your library</Link>
          ) : (
            <>
              <Link href={signupOpen ? '/signup' : '/login'} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden gap-1 sm:inline-flex')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create
              </Link>
              <Link href="/login" className={cn(buttonVariants({ size: 'sm' }))}>Log in</Link>
            </>
          )}
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted md:hidden"
            aria-expanded={drawer}
            aria-controls="mobile-menu"
            aria-label={drawer ? 'Close menu' : 'Open menu'}
            onClick={() => setDrawer((d) => !d)}
          >
            {drawer ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {drawer && (
        <nav id="mobile-menu" aria-label="Primary" className="border-t border-border bg-background px-4 pb-4 pt-3 md:hidden">
          <form action="/browse" role="search" className="relative mb-3 sm:hidden">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input type="search" name="q" placeholder="Search published sets" aria-label="Search published sets" className="h-9 w-full rounded-full border border-input bg-muted/60 pl-9 pr-3 text-sm" />
          </form>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="label mb-1">Study tools</div>
              <ul>{tools.map((l) => <li key={l.href}><Link href={l.href} onClick={() => setDrawer(false)} className="block py-1 text-sm">{l.label}</Link></li>)}</ul>
            </div>
            <div>
              <div className="label mb-1">Subjects</div>
              <ul>{subjects.map((l) => <li key={l.href}><Link href={l.href} onClick={() => setDrawer(false)} className="block py-1 text-sm">{l.label}</Link></li>)}</ul>
            </div>
          </div>
        </nav>
      )}
    </header>
  )
}
