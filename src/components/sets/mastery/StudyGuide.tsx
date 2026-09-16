'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SHADE_LABEL, type MasteryShade } from '@/lib/klt/mastery-shade'
import type { SetMastery } from '@/lib/sets/mastery'
import { subjectPath } from '@/lib/subjects/taxonomy'

/**
 * The study guide: the whole set on one page, built from its key points.
 *
 * Sections are the set's categories — the concept nodes a learner authored —
 * then everything else. Under each, every card as a heading with its points
 * as a checklist, the heavy points marked. Shading is the viewer's own
 * mastery and can be switched off for a clean copy; the print stylesheet
 * keeps whichever the reader chose.
 *
 * A page, deliberately: no fetch, no store. Everything it shows arrived as
 * props from the server, so printing it is printing the page.
 */

const ROW: Record<MasteryShade, string> = {
  unknown: '',
  weak: 'bg-chart-5/15 print:bg-chart-5/15',
  developing: 'bg-chart-4/15 print:bg-chart-4/15',
  solid: 'bg-chart-2/15 print:bg-chart-2/15',
  strong: 'bg-chart-1/20 print:bg-chart-1/20',
}

const MARK: Record<MasteryShade, string> = {
  unknown: '☐',
  weak: '☐',
  developing: '◪',
  solid: '☑',
  strong: '☑',
}

export function StudyGuide({ mastery, printedOn }: { mastery: SetMastery; printedOn: string }) {
  const signedIn = mastery.viewerId !== null
  const [shaded, setShaded] = useState(signedIn)
  const s = mastery.summary
  const subject = subjectPath(mastery.set.subject)

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/sets/${mastery.set.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the set
        </Link>
        <div className="flex items-center gap-2">
          {signedIn && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shaded} onChange={(e) => setShaded(e.target.checked)} className="h-4 w-4 accent-primary" />
              Shade by what I know
            </label>
          )}
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>

      <header className="border-b border-border pb-4">
        <div className="label">Study guide{subject && ` · ${subject}`}</div>
        <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight">{mastery.set.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {s.cards} cards · {s.points} key points
          {mastery.set.ownerHandle && <> · by @{mastery.set.ownerHandle}</>}
          {signedIn && shaded && s.measuredPoints > 0 && (
            <> · you have shown {s.byShade.strong + s.byShade.solid} of {s.measuredPoints} measured points solid or better</>
          )}
        </p>
        {shaded && signedIn && (
          <p className="mt-2 text-xs text-muted-foreground">
            ☑ solid or strong · ◪ developing · ☐ weak or not yet measured. Shading comes from your written and quiz answers; nothing on this page changes it.
          </p>
        )}
      </header>

      {mastery.groups.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">This set has no cards yet.</p>
      ) : (
        mastery.groups.map((g, gi) => (
          <section key={g.key} className="mt-8 break-inside-avoid-page" aria-labelledby={`g-${g.key}`}>
            <h2 id={`g-${g.key}`} className="flex items-center gap-2 font-heading text-xl font-bold">
              <span className="text-muted-foreground">{gi + 1}.</span>
              {g.color && <span className="h-3 w-3 rounded-full print:hidden" style={{ background: g.color }} aria-hidden="true" />}
              {g.name}
              <span className="ml-auto text-xs font-normal text-muted-foreground">{g.cards.length} {g.cards.length === 1 ? 'card' : 'cards'}</span>
            </h2>
            <ol className="mt-3 space-y-4">
              {g.cards.map((c) => (
                <li key={c.id} className={cn('rounded-lg border border-border p-4 break-inside-avoid', shaded && ROW[c.shade])}>
                  <h3 className="font-semibold">{c.term}</h3>
                  {c.points.length === 0 ? (
                    <p className="mt-1.5 text-sm text-muted-foreground">{c.definition}</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm">
                      {c.points.map((p) => (
                        <li key={p.id} className="flex items-start gap-2">
                          <span className="w-4 shrink-0 text-center font-mono" aria-label={shaded ? SHADE_LABEL[p.shade] : undefined}>{shaded ? MARK[p.shade] : '☐'}</span>
                          <span className={cn('flex-1', p.weight >= 4 && 'font-medium')}>{p.text}</span>
                          {p.weight >= 4 && <span className="shrink-0 text-[11px] text-muted-foreground" title="A point that matters most">key</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}

      <footer className="mt-10 border-t border-border pt-3 text-xs text-muted-foreground">
        synapseHQ · {mastery.set.title} · {printedOn}
      </footer>
    </article>
  )
}
