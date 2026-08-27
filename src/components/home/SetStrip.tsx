import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { RecentSet } from '@/lib/sets/recents'

/**
 * The "Jump back in" row — the sets this viewer most recently OPENED.
 *
 * A horizontal scroller of compact tiles rather than a grid, on purpose: this
 * is a shelf of things you already know, scanned by title, not a catalogue you
 * evaluate. A grid here would compete visually with "Your sets" below it and
 * make two blocks of the same weight, which is exactly the reading the page is
 * trying to avoid.
 *
 * Server-safe (no `'use client'`) — nothing here is interactive beyond a link.
 */
export function SetStrip({ sets }: { sets: RecentSet[] }) {
  // NOTHING, not an empty shell. A block with a heading and no contents reads
  // as a failed render; a block that is absent reads as "you have not done
  // this yet", which is the truth. Tested contract, not a nicety.
  if (sets.length === 0) return null

  return (
    <div
      className={cn(
        'flex gap-4 overflow-x-auto pb-2',
        // Negative margin + matching padding so the first and last tiles can
        // sit flush with the page gutter while their focus rings still have
        // room to draw.
        '-mx-1 px-1',
      )}
    >
      {sets.map((s) => (
        <Link
          key={s.id}
          href={`/sets/${s.id}`}
          className={cn(
            'group shrink-0 w-56 rounded-lg border border-border bg-card p-4',
            'transition-colors hover:border-primary/50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <div className="font-heading text-base leading-snug tracking-tight line-clamp-2 group-hover:text-primary transition-colors">
            {s.title}
          </div>

          {s.description && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
              {s.description}
            </p>
          )}

          <div className="mt-3 flex items-baseline gap-2 text-xs text-muted-foreground">
            <span className="metric">{s.cardCount}</span>
            <span>{s.cardCount === 1 ? 'card' : 'cards'}</span>
            {/*
              The credit renders ONLY for someone else's set, and only when
              they have a handle.

              - `isOwn`: "@you" on your own material is noise, and on a strip
                that deliberately mixes your sets with other people's, the
                ABSENCE of a credit is what tells you it is yours.
              - `ownerHandle !== null`: never falls back to `User.name`. That
                field comes from the OAuth provider and is usually a real full
                name — printing it here would publish it to everyone the set
                was shared with.
            */}
            {!s.isOwn && s.ownerHandle !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{`@${s.ownerHandle}`}</span>
              </>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}
