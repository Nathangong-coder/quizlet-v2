import { cn } from '@/lib/utils'
import { SHADE_CLASS, SHADE_LABEL, type MasteryShade } from '@/lib/klt/mastery-shade'

/**
 * A mastery value as a filled bar.
 *
 * ONE component for both axes on the Knowledge tab — concepts and the learner's
 * own categories — because the two sit on one screen and a bar that means 60%
 * in one block and something else in the other is worse than no bar. The
 * concept list and the category list previously disagreed on more than this:
 * one was a table of coloured pills, the other a row of chips with a bare
 * percentage.
 *
 * AN UNMEASURED ROW GETS NO FILL AT ALL, only the hatched track. A zero-width
 * bar and a bar filled to zero are the same picture, and that picture reads as
 * "you know none of this" — the exact `knowledge ?? 0` misreading
 * `shadeForKnowledge` exists to prevent, reintroduced through the chart instead
 * of through the arithmetic.
 *
 * The percentage is `aria-hidden` on the bar and carried in the visible label
 * beside it, so a screen reader hears the number once.
 */
export function MasteryBar({
  knowledge,
  shade,
  className,
}: {
  knowledge: number | null
  shade: MasteryShade
  className?: string
}) {
  const measured = knowledge !== null && shade !== 'unknown'

  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full border bg-muted/40', className)}
      role="img"
      aria-label={
        measured
          ? `${SHADE_LABEL[shade]}, ${Math.round((knowledge as number) * 100)}%`
          : SHADE_LABEL.unknown
      }
    >
      {measured && (
        <div
          className={cn('h-full rounded-full border-0', SHADE_CLASS[shade])}
          // The fill is a percentage of the track, so it has to be an inline
          // width — Tailwind cannot generate a class per value.
          style={{ width: `${Math.round(Math.min(1, Math.max(0, knowledge as number)) * 100)}%` }}
        />
      )}
    </div>
  )
}
