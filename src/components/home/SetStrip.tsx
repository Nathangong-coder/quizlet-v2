import { cn } from '@/lib/utils'
import { SetCard } from '@/components/sets/SetCard'
import type { RecentSet } from '@/lib/sets/recents'
import type { SetStudySummary } from '@/lib/sets/study-summary'

/**
 * The "Jump back in" row — the sets this viewer most recently OPENED.
 *
 * RENDERS THE SAME `SetCard` AS EVERY OTHER SET LIST, and that is the change.
 * It used to be a bespoke compact tile: title, card count, and an @handle. Two
 * blocks on one page describing the same kind of object in two different
 * vocabularies is what made the page read as unfinished — the block a learner
 * lands on first was the one that said the least, so "jump back in" showed less
 * about a set than the shelf below it showed about the same set.
 *
 * STILL A HORIZONTAL SCROLLER, not a grid. That is the distinction actually
 * worth keeping: this is a shelf of things you were already doing, scanned
 * left-to-right, while "Your sets" is a catalogue you browse. The tiles now
 * match; the SHAPE of the block is what separates them.
 *
 * Server-safe (no `'use client'`) — nothing here is interactive beyond a link.
 */
export function SetStrip({
  sets,
  summaries = {},
}: {
  sets: RecentSet[]
  /**
   * Per-set study summaries, keyed by set id. Missing entries are the norm, not
   * an error — a set you opened and never answered a question in has no
   * `CardProgress` row, and `SetCard` falls back to its creation date.
   */
  summaries?: Record<string, SetStudySummary>
}) {
  // NOTHING, not an empty shell. A block with a heading and no contents reads
  // as a failed render; a block that is absent reads as "you have not done
  // this yet", which is the truth. Tested contract, not a nicety.
  if (sets.length === 0) return null

  return (
    <ul
      className={cn(
        'flex gap-6 overflow-x-auto pb-2',
        // Negative margin + matching padding so the first and last tiles can
        // sit flush with the page gutter while their focus rings still have
        // room to draw.
        '-mx-1 px-1',
      )}
    >
      {sets.map((s) => (
        // `w-72` and `shrink-0`: a card in a flex scroller with no fixed width
        // collapses to its content, and a one-word title would render a tile
        // half the width of its neighbour.
        <li key={s.id} className="w-72 shrink-0">
          <SetCard
            set={{
              id: s.id,
              title: s.title,
              description: s.description,
              visibility: s.visibility,
              createdAt: s.createdAt,
              _count: { cards: s.cardCount },
            }}
            summary={summaries[s.id]}
            // Credit ONLY for someone else's set. On a strip that deliberately
            // mixes your sets with other people's, the absence of a credit is
            // what tells you which is yours — and "@you" on your own material
            // is noise.
            ownerHandle={s.isOwn ? null : s.ownerHandle}
          />
        </li>
      ))}
    </ul>
  )
}
