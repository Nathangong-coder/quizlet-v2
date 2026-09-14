'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHADE_CLASS, SHADE_LABEL, MASTERY_SHADES, type MasteryShade } from '@/lib/klt/mastery-shade'
import type { MasteryCard, MasterySummary } from '@/lib/sets/mastery'
import { Metric } from '@/components/ui/metric'

/**
 * Mastery — every card's key points, and what you have shown on each.
 *
 * The same shape the study-guide mock promised: card as heading, points as
 * a checklist, each point shaded by measured knowledge. The list is filterable
 * by shade so "show me what I am weak on" is one click, and searchable so a
 * long set is still a list you can use.
 *
 * `unknown` is drawn as a dashed outline, never a grey fill — not measured is
 * a different claim from measured low (see `mastery-shade.ts`).
 */

type Filter = 'all' | MasteryShade

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'weak', label: 'Weak' },
  { key: 'developing', label: 'Developing' },
  { key: 'solid', label: 'Solid' },
  { key: 'strong', label: 'Strong' },
  { key: 'unknown', label: 'Not measured' },
]

const DOT: Record<MasteryShade, string> = {
  unknown: 'border border-dashed border-muted-foreground/60 bg-transparent',
  weak: 'bg-chart-5',
  developing: 'bg-chart-4',
  solid: 'bg-chart-2',
  strong: 'bg-chart-1',
}

export function MasteryBoard({ cards, summary, signedIn, setId }: { cards: MasteryCard[]; summary: MasterySummary; signedIn: boolean; setId: string }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return cards
      .map((c) => {
        const points = filter === 'all' ? c.points : c.points.filter((p) => p.shade === filter)
        return { ...c, points }
      })
      .filter((c) => (filter === 'all' ? true : c.points.length > 0))
      .filter((c) => (needle ? c.term.toLowerCase().includes(needle) || c.points.some((p) => (p.label ?? p.text).toLowerCase().includes(needle)) : true))
  }, [cards, filter, q])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Metric value={summary.cardsWithPoints} label="Cards with key points" emptyLabel="—" />
        <Metric value={summary.points} label="Key points" emptyLabel="—" />
        <Metric value={signedIn ? summary.measuredPoints : null} label="Points measured" emptyLabel="—" />
        <Metric value={signedIn && summary.measuredPoints > 0 ? summary.byShade.strong + summary.byShade.solid : null} label="Solid or strong" emptyLabel="—" />
      </div>

      {!signedIn && (
        <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          <Link href="/login" className="underline underline-offset-4">Sign in</Link> and every point here is shaded by what you have shown you know. As a visitor you see the points; the shading is yours alone.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by mastery">
          {FILTERS.map((f) => {
            const count = f.key === 'all' ? summary.points : summary.byShade[f.key]
            if (f.key !== 'all' && f.key !== 'unknown' && !signedIn) return null
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', filter === f.key ? 'border-primary bg-accent' : 'border-border hover:border-primary/50')}
              >
                {f.key !== 'all' && <span className={cn('h-2 w-2 rounded-sm', DOT[f.key])} aria-hidden="true" />}
                {f.label}
                <span className="text-muted-foreground">{count}</span>
              </button>
            )
          })}
        </div>
        <label className="ml-auto flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a card or point" className="w-40 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Find a card or point" />
        </label>
        <Link href={`/sets/${setId}/guide`} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">Study guide →</Link>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{summary.points === 0 ? 'No key points yet — they are written when the set is authored.' : 'Nothing matches.'}</p>
      ) : (
        <ol className="space-y-3">
          {shown.map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-heading text-base font-bold">{c.term}</h3>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {c.confidence !== null && <span title="Your confidence">conf {c.confidence}/10</span>}
                  <span className={cn('rounded-full border px-2 py-0.5', SHADE_CLASS[c.shade])}>{c.knowledge === null ? SHADE_LABEL.unknown : `${SHADE_LABEL[c.shade]} · ${Math.round(c.knowledge * 100)}%`}</span>
                </div>
              </div>
              {c.points.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No key points on this card yet.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {c.points.map((p) => (
                    <li key={p.id} className="flex items-start gap-2.5 text-sm">
                      <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm', DOT[p.shade])} title={SHADE_LABEL[p.shade]} aria-label={SHADE_LABEL[p.shade]} role="img" />
                      <span className="min-w-0 flex-1">
                        <span>{p.label ?? p.text}</span>
                        {p.label && <span className="block text-xs text-muted-foreground">{p.text}</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground" title={`weight ${p.weight} of 5`}>
                        {'●'.repeat(Math.min(5, Math.max(0, p.weight)))}{'○'.repeat(Math.max(0, 5 - p.weight))}
                        {p.knowledge !== null && <span className="ml-2 tabular-nums">{Math.round(p.knowledge * 100)}%</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {signedIn && (
        <p className="text-xs text-muted-foreground">
          Shading: {MASTERY_SHADES.map((s) => SHADE_LABEL[s].toLowerCase()).join(' · ')} — measured from your written and quiz answers. A point you have not been asked about enough is not measured, not weak.
        </p>
      )}
    </div>
  )
}
