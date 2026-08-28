import { cn } from '@/lib/utils'
import { SHADE_LABEL } from '@/lib/klt/mastery-shade'
import { MasteryBar } from '@/components/ui/mastery-bar'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'

/**
 * Concepts as a ranked list, weakest measured first.
 *
 * THE ROWS ARE CONCEPT-TREE NODES, at the one rung `selectConceptListDepth`
 * chose — the same `Klt` concepts the map draws, so switching between the two
 * views no longer switches what a "concept" is. It used to render the
 * user-authored CATEGORY axis, which is why the list could name things the map
 * had no node for and vice versa. Categories still have a block of their own,
 * below this one on the page; they are a different axis, not a coarser grain.
 *
 * It still takes `TopicMasteryRow[]` and imports nothing from KLT — no
 * `SetKltNode`, no `kltId`, no tree. The roadmap intends KLP-inherent topics
 * living beside user categories (CLAUDE.md, 2026-08-14), and when those land
 * they will produce rows of this shape from a different source and render here
 * unchanged. Typing this against the tree would have guaranteed a rewrite.
 *
 * Server component: it is a table with no interaction.
 */
export function MasteryList({ rows }: { rows: TopicMasteryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8">
        No concept structure on this set yet. Build one, and the concepts your cards teach
        appear here with what you know about each.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="label pb-2 font-normal text-muted-foreground">Concept</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground w-1/2">
              Mastery
            </th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground text-right">
              Key points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="py-2.5 pr-4 align-middle">
                {/* No depth indent. Every row here is on the SAME rung by
                    construction, so an indent could only ever be zero — and a
                    stray non-zero one would claim a hierarchy the list is not
                    showing. */}
                {row.name}
              </td>
              <td className="py-2.5 pr-4 align-middle">
                <div className="flex items-center gap-3">
                  <MasteryBar knowledge={row.knowledge} shade={row.shade} className="max-w-[12rem]" />
                  {/*
                    The words, not the colour alone. A shade carried only by a
                    fill is unreadable to anyone who cannot distinguish the hues
                    — and for `unknown` the distinction that matters (no
                    evidence vs. bad evidence) is not expressible in a colour at
                    all.
                  */}
                  <span
                    className={cn(
                      'shrink-0 text-xs',
                      row.shade === 'unknown' ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {SHADE_LABEL[row.shade]}
                    {row.knowledge !== null && (
                      <span className="font-mono text-muted-foreground">
                        {' '}
                        {Math.round(row.knowledge * 100)}%
                      </span>
                    )}
                  </span>
                </div>
              </td>
              <td className="py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                {/*
                  MEASURED OF TOTAL, not the total alone. A concept can report
                  90% off three of its forty key points; the bar is deliberately
                  withheld in that case (see `MIN_MEASURED_FRACTION`) and this
                  column is where a learner sees WHY, instead of a colour that
                  vanished for no visible reason.
                */}
                {row.klpCount ? `${row.measuredKlpCount}/${row.klpCount}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
