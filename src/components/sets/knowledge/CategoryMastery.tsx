import { cn } from '@/lib/utils'
import { SHADE_CLASS, SHADE_LABEL } from '@/lib/klt/mastery-shade'
import type { CategoryMasteryRow } from '@/lib/sets/knowledge'

/**
 * Your own category labels, with what the app has measured for each.
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
 * presented as their label.
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
    <ul className="flex flex-wrap gap-2">
      {rows.map((row) => (
        <li
          key={row.key}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
            SHADE_CLASS[row.shade],
          )}
          title={`${SHADE_LABEL[row.shade]} · ${row.cardCount} card${row.cardCount === 1 ? '' : 's'}`}
        >
          {/* The learner's own colour survives as a dot. It identifies the
              category; the fill reports mastery. Two different jobs, so they
              get two different surfaces rather than fighting over one. */}
          {row.color && (
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
          )}
          <span>{row.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {row.knowledge !== null ? `${Math.round(row.knowledge * 100)}%` : '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}
