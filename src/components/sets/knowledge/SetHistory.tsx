import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

export interface SetHistoryRow {
  id: string
  kind: string
  startedAt: Date
  durationMs: number | null
  itemCount: number
}

const KIND_LABEL: Record<string, string> = {
  quiz: 'Quiz',
  matching: 'Matching game',
  confidence: 'Review',
}

/**
 * Your sessions on THIS set.
 *
 * Deliberately a short list with a link out rather than a second activity feed:
 * `/profile/memory` is the full history and `/profile/activity/[id]` already
 * renders one session properly. Reimplementing either here would be a second
 * notion of activity that can disagree with the first.
 */
export function SetHistory({ rows }: { rows: SetHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You have not studied this set yet. Anything you do in Study shows up here.
      </p>
    )
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
          <Link
            href={`/profile/activity/${row.id}`}
            className="underline-offset-4 hover:underline min-w-0"
          >
            {/* An unrecognised kind renders as itself rather than as "Unknown":
                the column is a free string, and a future mode should show its
                own name on day one rather than a shrug. */}
            {KIND_LABEL[row.kind] ?? row.kind}
          </Link>
          <span className="shrink-0 text-muted-foreground">
            <span className="font-mono">{row.itemCount}</span> item
            {row.itemCount === 1 ? '' : 's'}
            {row.durationMs !== null && (
              <>
                {' · '}
                <span className="font-mono">{Math.round(row.durationMs / 1000)}s</span>
              </>
            )}
            {' · '}
            {formatDistanceToNow(row.startedAt, { addSuffix: true })}
          </span>
        </li>
      ))}
    </ul>
  )
}
