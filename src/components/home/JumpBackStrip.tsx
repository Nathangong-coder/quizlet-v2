'use client'

import { useState } from 'react'
import { ArrowRight, FileText, Folder, Layers, MoreVertical, NotebookPen } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { HomeRecentItem, HomeRecentKind } from '@/lib/home/recent-items'

const TINTS: Record<HomeRecentKind, string> = {
  flashcard: 'from-sky-50 via-card to-card dark:from-sky-950/30 dark:via-card dark:to-card',
  folder: 'from-slate-100 via-card to-card dark:from-slate-900/60 dark:via-card dark:to-card',
  'study-guide': 'from-fuchsia-50 via-card to-card dark:from-fuchsia-950/25 dark:via-card dark:to-card',
  postmortem: 'from-amber-50 via-card to-card dark:from-amber-950/25 dark:via-card dark:to-card',
}

const ICONS: Record<HomeRecentKind, typeof Layers> = {
  flashcard: Layers,
  folder: Folder,
  'study-guide': FileText,
  postmortem: NotebookPen,
}

export function JumpBackStrip({ items }: { items: HomeRecentItem[] }) {
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const visible = items.slice(0, 4).filter((item) => !hiddenIds.includes(item.id))

  if (visible.length === 0) return null

  return <ul className="-mx-1 flex snap-x gap-5 overflow-x-auto px-1 pb-3">{visible.map((item, index) => {
    const Icon = ICONS[item.kind]
    return <li key={`${item.kind}-${item.id}`} className="w-[min(48rem,calc(100vw-2.5rem))] min-w-[min(48rem,calc(100vw-2.5rem))] snap-start">
      <article className={`relative flex h-72 flex-col overflow-visible rounded-2xl border border-border/80 bg-gradient-to-br p-6 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] sm:h-80 sm:p-9 ${TINTS[item.kind]}`}>
        <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" />{item.kindLabel}</div><div className="relative"><button type="button" aria-label={`More options for ${item.title}`} aria-haspopup="menu" aria-expanded={openMenu === item.id} onClick={() => setOpenMenu(openMenu === item.id ? null : item.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreVertical className="h-5 w-5" aria-hidden="true" /></button>{openMenu === item.id && <div role="menu" className="absolute right-0 top-10 z-10 min-w-28 rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-md)]"><button type="button" role="menuitem" onClick={() => { setHiddenIds((current) => [...current, item.id]); setOpenMenu(null) }} className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted">Hide</button></div>}</div></div>
        <h3 className="mt-8 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:mt-10 sm:text-5xl">{item.title}</h3>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-10"><div className="text-sm text-muted-foreground"><span>{item.meta ?? item.kindLabel}</span><span aria-hidden="true"> · </span><span>{item.byline}</span></div><Button size="lg" render={<Link href={item.href} />}><span>Continue</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></Button></div>
      </article>
      {index === 0 && visible.length > 1 && <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">{visible.map((dot) => <span key={dot.id} className={`h-1.5 w-1.5 rounded-full ${dot.id === item.id ? 'bg-primary' : 'bg-muted-foreground/25'}`} />)}</div>}
    </li>
  })}</ul>
}
