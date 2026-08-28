import { cn } from '@/lib/utils'
import { SHADE_CLASS, SHADE_LABEL } from '@/lib/klt/mastery-shade'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'

/**
 * Concepts as a ranked list, weakest measured first.
 *
 * THE VIEW THAT HAS TO OUTLIVE THE CONCEPT TREE. It takes `TopicMasteryRow[]`
 * and imports nothing from KLT — no `SetKltNode`, no `kltId`, no tree. The
 * roadmap intends KLP-inherent topics living beside user categories (CLAUDE.md,
 * 2026-08-14), and when those land they will produce rows of this shape from a
 * different source and render here unchanged. Typing this against the tree
 * would have guaranteed a rewrite.
 *
 * Server component: it is a table with no interaction.
 */
export function MasteryList({ rows }: { rows: TopicMasteryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8">
        No concepts or categories on this set yet. Add categories to your cards, or build a
        concept structure, and this fills in.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="label pb-2 font-normal text-muted-foreground">Concept</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground">Mastery</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground text-right">
              Key points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="py-2.5 pr-4">
                <span
                  // Depth is null for a user-authored category, which has no
                  // tree position. Indenting it as though it were depth 0 would
                  // claim it is a root concept; it is a different axis.
                  style={row.depth !== null ? { paddingLeft: row.depth * 14 } : undefined}
                  className="inline-block"
                >
                  {row.name}
                </span>
              </td>
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-block h-2.5 w-16 shrink-0 rounded-full border',
                      SHADE_CLASS[row.shade],
                    )}
                    aria-hidden="true"
                  />
                  {/*
                    The words, not the colour alone. A shade carried only by a
                    fill is unreadable to anyone who cannot distinguish the hues
                    — and for `unknown` the distinction that matters (no
                    evidence vs. bad evidence) is not expressible in a colour at
                    all.
                  */}
                  <span
                    className={cn(
                      'text-xs',
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
              <td className="py-2.5 text-right font-mono text-muted-foreground">
                {row.klpCount || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
