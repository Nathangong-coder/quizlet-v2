import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatStudyTime, type SetLeaderboard, type MemberSetStanding } from '@/lib/groups/progress'

/**
 * The per-set leaderboard: ranked by mastered cards, with the breakdown the
 * owner asked for — mastered / studied / unstudied as a stacked bar, mean
 * confidence, time, last studied. `compact` drops the last two columns for
 * the group page's overview.
 */
export function Leaderboard({
  board,
  viewerId,
  compact = false,
}: {
  board: SetLeaderboard
  viewerId: string
  compact?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">#</th>
            <th scope="col" className="py-2 pr-3 font-medium">Member</th>
            <th scope="col" className="py-2 pr-3 font-medium">Mastered</th>
            <th scope="col" className="py-2 pr-3 font-medium">Progress</th>
            <th scope="col" className="py-2 pr-3 font-medium">Confidence</th>
            {!compact && <th scope="col" className="py-2 pr-3 font-medium">Time</th>}
            {!compact && <th scope="col" className="py-2 font-medium">Last studied</th>}
          </tr>
        </thead>
        <tbody>
          {board.standings.map((s) => (
            <StandingRow key={s.userId} s={s} cardCount={board.cardCount} isViewer={s.userId === viewerId} compact={compact} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StandingRow({ s, cardCount, isViewer, compact }: { s: MemberSetStanding; cardCount: number; isViewer: boolean; compact: boolean }) {
  const pct = (n: number) => (cardCount === 0 ? 0 : (n / cardCount) * 100)
  const learning = s.studied - s.mastered
  return (
    <tr className={cn('border-b border-border/60', isViewer && 'bg-accent/40')}>
      <td className="metric py-2.5 pr-3 text-muted-foreground">{s.rank}</td>
      <td className="py-2.5 pr-3 font-medium">
        {s.handle ? (
          <Link href={`/u/${s.handle}`} className="hover:underline underline-offset-4">@{s.handle}</Link>
        ) : (
          <span className="text-muted-foreground">member</span>
        )}
        {isViewer && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
      </td>
      <td className="py-2.5 pr-3">
        <span className="metric font-semibold">{s.mastered}</span>
        <span className="text-muted-foreground"> / {cardCount}</span>
      </td>
      <td className="py-2.5 pr-3">
        <div
          className="flex h-2.5 w-36 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${s.mastered} mastered, ${learning} learning, ${s.unstudied} not started`}
          title={`${s.mastered} mastered · ${learning} learning · ${s.unstudied} not started`}
        >
          <div className="h-full bg-success" style={{ width: `${pct(s.mastered)}%` }} />
          <div className="h-full bg-warning" style={{ width: `${pct(learning)}%` }} />
        </div>
      </td>
      <td className="metric py-2.5 pr-3">{s.averageConfidence === null ? <span className="text-muted-foreground">—</span> : `${s.averageConfidence}/10`}</td>
      {!compact && <td className="metric py-2.5 pr-3">{formatStudyTime(s.timeMs)}</td>}
      {!compact && (
        <td className="py-2.5 text-muted-foreground">
          {s.lastStudiedAt ? s.lastStudiedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'not yet'}
        </td>
      )}
    </tr>
  )
}

export function LeaderboardLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-success" aria-hidden="true" />mastered (confidence 7+)</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warning" aria-hidden="true" />learning</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-muted" aria-hidden="true" />not started</span>
    </p>
  )
}
