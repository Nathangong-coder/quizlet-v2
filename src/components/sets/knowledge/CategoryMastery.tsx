import { SHADE_LABEL } from '@/lib/klt/mastery-shade'
import { MasteryBar } from '@/components/ui/mastery-bar'
import type { CategoryMasteryRow } from '@/lib/sets/knowledge'

/**
 * Your own category labels, with what the app has measured for each.
 *
 * BARS, NOT CHIPS, as of 2026-08-28 — and the same `MasteryBar` the concept
 * list above it uses. As chips this block carried a fill colour and a bare
 * percentage, which made two things on one page report mastery in two visual
 * languages: a learner comparing "how am I doing on my own labels" against "how
 * am I doing on the concepts" had to translate between a filled pill and a
 * table row. Same measurement, same picture.
 *
 * A category with no evidence stays on the list shaded `unknown` rather than
 * being dropped — "you have a category nothing has tested yet" is exactly the
 * kind of thing this view exists to say, and hiding it would make the page
 * disagree with the chips the learner can see on their own cards.
 *
 * The standing caveat, from CLAUDE.md (2026-08-14): a user-authored category is
 * often a FORMAT — "label the image", "talking", "vocabulary" — rather than a
 * subject. Within one account that is harmless, because the learner knows what
 * they meant. Nothing here is presented as a concept for that reason; it is
 * presented as their label, in its own block, below the concepts.
 */
export function CategoryMastery({ rows }: { rows: CategoryMasteryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No categories on this set. Adding them lets every study mode filter by topic, and
        gives this page something to measure against.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-3 text-sm">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-[14rem]">
            {/* The learner's own colour survives as a dot. It identifies the
                category; the bar reports mastery. Two different jobs, so they
                get two different surfaces rather than fighting over one. */}
            {row.color && (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            )}
            <span className="truncate">{row.name}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {row.cardCount}
            </span>
          </div>

          <MasteryBar
            knowledge={row.knowledge}
            shade={row.shade}
            className="flex-1 max-w-[16rem]"
          />

          <span className="shrink-0 text-xs text-muted-foreground">
            {SHADE_LABEL[row.shade]}
            {row.knowledge !== null && (
              <span className="font-mono"> {Math.round(row.knowledge * 100)}%</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
