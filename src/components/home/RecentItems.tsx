import Link from 'next/link'
import { FileText, Folder, Layers, NotebookPen } from 'lucide-react'
import type { HomeRecentItem, HomeRecentKind } from '@/lib/home/recent-items'

const ICONS: Record<HomeRecentKind, typeof Layers> = {
  flashcard: Layers,
  folder: Folder,
  'study-guide': FileText,
  postmortem: NotebookPen,
}

const COLORS: Record<HomeRecentKind, string> = {
  flashcard: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300',
  folder: 'bg-slate-100 text-slate-600 dark:bg-slate-900/70 dark:text-slate-300',
  'study-guide': 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/40 dark:text-fuchsia-300',
  postmortem: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
}

export function RecentItems({ items }: { items: HomeRecentItem[] }) {
  if (items.length === 0) return null

  return <ul className="grid gap-x-10 sm:grid-cols-2">{items.map((item) => {
    const Icon = ICONS[item.kind]
    return <li key={`${item.kind}-${item.id}`}><Link href={item.href} className="group flex min-w-0 items-center gap-4 border-b border-border/70 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-5"><div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${COLORS[item.kind]}`}><Icon className="h-6 w-6" aria-hidden="true" /></div><div className="min-w-0"><h3 className="truncate text-base font-semibold tracking-tight group-hover:text-primary">{item.title}</h3><p className="mt-1 truncate text-sm text-muted-foreground">{item.kindLabel}{item.meta && <> <span aria-hidden="true">·</span> {item.meta}</>} <span aria-hidden="true">·</span> {item.byline}</p></div></Link></li>
  })}</ul>
}
