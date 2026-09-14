import Link from 'next/link'
import { formatScore, type RankedRow } from '@/lib/games/scores'
import type { GameId } from '@/lib/games/pieces'
import { cn } from '@/lib/utils'

/**
 * A leaderboard for one (game, mode) of one set: rank, handle, score. Server
 * component; the rows come from `loadLeaderboard`. `viewerId` highlights
 * your own line. Empty boards say so rather than rendering a bare table.
 */
export function ScoreBoard({
  game,
  title,
  rows,
  viewerId,
  compact = false,
}: {
  game: GameId
  title: string
  rows: RankedRow[]
  viewerId: string | null
  compact?: boolean
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card', compact ? 'p-3' : 'p-4')}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-heading text-sm font-bold">{title}</h3>
        {rows.length > 0 && <span className="label whitespace-nowrap">top {rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">No runs yet. Sign in with a handle and yours goes here.</p>
      ) : (
        <ol className="divide-y divide-border/60 text-sm">
          {rows.slice(0, compact ? 5 : rows.length).map((r) => (
            <li key={r.userId} className={cn('flex items-center gap-3 py-1.5', r.userId === viewerId && 'font-semibold text-primary')}>
              <span className="metric w-6 text-right text-muted-foreground">{r.rank}</span>
              {r.handle ? (
                <Link href={`/u/${r.handle}`} className="min-w-0 flex-1 truncate hover:underline underline-offset-4">@{r.handle}</Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">member</span>
              )}
              <span className="metric">{formatScore(game, r.score)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
