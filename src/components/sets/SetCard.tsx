import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarDays, Layers, Link2, Lock } from 'lucide-react'
import { format } from 'date-fns'
import type { SetStudySummary } from '@/lib/sets/study-summary'
import { toSetVisibility } from '@/lib/sets/visibility'

interface SetCardProps {
  set: {
    id: string
    title: string
    description?: string | null
    visibility?: string
    _count?: {
      cards: number
    }
    createdAt: Date
  }
  /** Absent for a signed-out viewer, or for a set with no progress rows. */
  summary?: SetStudySummary
}

export function SetCard({ set, summary }: SetCardProps) {
  const cardCount = set._count?.cards ?? 0
  const shared = set.visibility !== undefined && toSetVisibility(set.visibility) !== 'private'
  const studied = summary && summary.studiedCards > 0

  return (
    <Link href={`/sets/${set.id}`} className="block group">
      <Card className="transition-all hover:shadow-md group-hover:border-primary/50">
        <CardHeader>
          <div className="flex justify-between items-start gap-2 mb-2">
            <Badge variant="secondary" className="flex gap-1 items-center">
              <Layers className="w-3 h-3" />
              {cardCount} cards
            </Badge>
            {/* Visibility shipped in queue item 1 and was shown nowhere in the
                list — the one place a learner scans to check what is shared. */}
            {set.visibility !== undefined && (
              <Badge
                variant="outline"
                className="flex gap-1 items-center shrink-0"
                title={shared ? 'Anyone with the link can view this set' : 'Only you can see this set'}
              >
                {shared ? <Link2 className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {shared ? 'Shared' : 'Private'}
              </Badge>
            )}
          </div>
          <CardTitle className="line-clamp-1 group-hover:text-primary transition-colors">
            {set.title}
          </CardTitle>
          <CardDescription className="line-clamp-2 min-h-[2.5rem]">
            {set.description || 'No description provided.'}
          </CardDescription>
        </CardHeader>

        {/* Study signal. Rendered ONLY when something has been studied: an
            unstudied set shows nothing rather than "0% · 0 due", which reads
            as a judgement about material nobody has opened. */}
        {studied && (
          <div className="px-6 -mt-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {summary.averageConfidence !== null && (
              <span className="tabular-nums">
                confidence {summary.averageConfidence.toFixed(1)}/10
              </span>
            )}
            <span className="tabular-nums">
              {summary.studiedCards} of {cardCount} studied
            </span>
            {summary.dueCount > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {summary.dueCount} due
              </Badge>
            )}
          </div>
        )}

        <CardFooter className="flex justify-between items-center text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            {summary?.lastStudiedAt
              ? `studied ${format(new Date(summary.lastStudiedAt), 'MMM d')}`
              : format(new Date(set.createdAt), 'MMM d, yyyy')}
          </div>
          {/* A SPAN, not a Button. The whole card is already a link, and a
              <button> inside an <a> is invalid HTML — it also gave keyboard
              users a second stop that navigates to the same place. */}
          <span className="text-primary group-hover:underline">View Set</span>
        </CardFooter>
      </Card>
    </Link>
  )
}
