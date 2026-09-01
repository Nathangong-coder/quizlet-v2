'use client'

import React from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Crosshair, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sourceLabel } from '@/lib/memory/source-labels'
import type { StudyEventHistoryRow } from '@/actions/memory'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/memory/activity-labels'

/**
 * How one answer's outcome reads in the Accuracy column.
 *
 * Three genuinely different states, and they must stay distinguishable:
 * a graded score, a pass/fail verdict, and NO judgement at all. The last is
 * real — a Review-mode "I knew it" records confidence without correctness — and
 * rendering it as 0% or "Wrong" would invent a failure the learner never had.
 *
 * Pure and exported so the three-way split is tested without a DOM.
 */
export function outcomeText(event: Pick<StudyEventHistoryRow, 'score' | 'correct'>): string {
  if (event.score !== null) return `${event.score}%`
  if (event.correct === null) return '—'
  return event.correct ? 'Correct' : 'Wrong'
}

/** Grid template shared by the header and every row, so columns line up. */
const GRID =
  'grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_7.5rem_4.5rem_6.5rem_5rem_4.5rem_4.5rem] items-center gap-3'

function HeaderCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('text-xs font-medium uppercase tracking-wide text-muted-foreground', className)}>
      {children}
    </div>
  )
}

export interface ActivityTableProps {
  events: StudyEventHistoryRow[]
  /** Narrow the whole page to one card — the route to "Forget this card". */
  onScopeToCard: (event: StudyEventHistoryRow) => void
  onDelete: (eventId: string) => void
}

/**
 * The study-history feed, as a table.
 *
 * It was a list of rows whose primary click NARROWED THE PAGE to that card —
 * the same view, filtered. That made the obvious gesture on a history entry
 * produce a filtered copy of the list you were already looking at, while the
 * quiz it came from stayed unreachable. Clicking a row now opens the activity
 * itself; scoping to the card survives as its own small control, because it is
 * still the only discoverable route to "Forget this card".
 */
export default function ActivityTable({ events, onScopeToCard, onDelete }: ActivityTableProps) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[50rem]">
        <div className={cn(GRID, 'border-b px-3 pb-2')}>
          <HeaderCell>Card</HeaderCell>
          <HeaderCell>Set</HeaderCell>
          <HeaderCell>Type</HeaderCell>
          <HeaderCell>Time</HeaderCell>
          <HeaderCell>Date</HeaderCell>
          <HeaderCell className="text-right">Accuracy</HeaderCell>
          <HeaderCell className="text-right">Conf.</HeaderCell>
          <HeaderCell className="sr-only">Actions</HeaderCell>
        </div>

        <div className="divide-y">
          {events.map((event) => {
            const outcome = outcomeText(event)
            const when = new Date(event.createdAt)

            return (
              <div
                key={event.id}
                className={cn(GRID, 'group px-3 py-2 transition-colors hover:bg-muted/50')}
              >
                {/*
                  The link is the CARD NAME, not the whole row. A row-spanning
                  overlay would have to sit under the two action buttons and
                  over the truncated text cells, which kills their `title`
                  tooltips — and truncation is exactly where a tooltip earns its
                  place. The name is the row's primary content, so linking it is
                  both the obvious target and a real, focusable <a>.
                */}
                <div className="min-w-0">
                  {event.sessionId ? (
                    <Link
                      href={`/profile/activity/${event.sessionId}`}
                      className="block truncate rounded text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`${event.term} — open this activity`}
                    >
                      {event.term}
                    </Link>
                  ) : (
                    // No session to open. Rendered as plain text rather than a
                    // dead link, so nothing advertises a destination that isn't
                    // there.
                    <span className="block truncate text-sm font-medium" title={event.term}>
                      {event.term}
                    </span>
                  )}
                </div>

                <div className="min-w-0 truncate text-sm text-muted-foreground" title={event.setTitle}>
                  {event.setTitle}
                </div>

                <div className="truncate text-xs text-muted-foreground" title={sourceLabel(event.source)}>
                  {sourceLabel(event.source)}
                </div>

                <div className="text-xs tabular-nums text-muted-foreground" title="Time to answer">
                  {formatDuration(event.latencyMs)}
                </div>

                <div className="text-xs text-muted-foreground" title={format(when, 'PPpp')}>
                  {format(when, 'MMM d, h:mm a')}
                </div>

                <div className="text-right text-sm tabular-nums">{outcome}</div>

                <div className="text-right text-sm tabular-nums text-muted-foreground">
                  {event.confidenceAfter}
                </div>

                <div className="flex items-center justify-end gap-0.5">
                  {/*
                    ALWAYS visible, never hover-only. This is the sole
                    discoverable route into card scope, and card scope is the
                    sole route to "Forget this card" — that affordance was
                    already lost once (fixed in f4236d9) by being reachable only
                    if you knew to select exactly one set first. Hiding it
                    behind hover would also put it out of reach on touch.
                  */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground"
                    aria-label={`Show only ${event.term}`}
                    title={`Show only "${event.term}"`}
                    onClick={() => onScopeToCard(event)}
                  >
                    <Crosshair className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label={`Delete ${event.term} entry`}
                    onClick={() => onDelete(event.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
