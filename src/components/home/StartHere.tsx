import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { subjectPath } from '@/lib/subjects/taxonomy'
import type { StartSet } from '@/lib/home/start-here'
import { PageHeader } from '@/components/ui/page-header'

/**
 * The frame every "Start here" page shares: a header, an optional intro
 * block, and the set picker — each set as a card whose primary link is the
 * page's activity (`hrefFor`), with a secondary link when the page has one.
 */
export function StartHerePage({
  title,
  lede,
  action,
  intro,
  sets,
  hrefFor,
  cta,
  secondary,
  disabledWhen,
  empty,
  children,
}: {
  title: string
  lede: string
  action?: ReactNode
  intro?: ReactNode
  sets: StartSet[]
  hrefFor: (s: StartSet) => string
  cta: string
  secondary?: { label: string; hrefFor: (s: StartSet) => string }
  /** A reason the activity is unavailable on a set, or null. */
  disabledWhen?: (s: StartSet) => string | null
  empty: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="max-w-5xl">
      <PageHeader title={title} lede={lede} action={action} />
      {intro}
      {children}
      <section aria-labelledby="pick-a-set" className="mt-8">
        <h2 id="pick-a-set" className="label mb-3">Pick a set</h2>
        {sets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((s) => {
              const reason = disabledWhen?.(s) ?? null
              return (
                <li key={s.id} className={cn('flex flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)]', reason && 'opacity-70')}>
                  <Link href={`/sets/${s.id}`} className="truncate font-heading font-bold hover:underline underline-offset-4">{s.title}</Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="metric">{s.cardCount}</span> cards
                    {!s.isOwn && s.ownerHandle && <> · by @{s.ownerHandle}</>}
                    {s.isOwn && subjectPath(s.subject) && <> · {subjectPath(s.subject)}</>}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    {reason ? (
                      <span className="text-xs text-muted-foreground">{reason}</span>
                    ) : (
                      <Link href={hrefFor(s)} className="font-semibold text-primary underline-offset-4 hover:underline">{cta} →</Link>
                    )}
                    {secondary && !reason && <Link href={secondary.hrefFor(s)} className="text-xs text-muted-foreground underline-offset-4 hover:underline">{secondary.label}</Link>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
