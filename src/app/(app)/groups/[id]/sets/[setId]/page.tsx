import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { auth } from '@/auth'
import { loadGroupSetProgress } from '@/lib/groups/load'
import { readableSetWhere } from '@/lib/sets/visibility'
import { Button } from '@/components/ui/button'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { Leaderboard, LeaderboardLegend } from '@/components/groups/Leaderboard'
import { CoverageGrid } from '@/components/groups/CoverageGrid'
import { cn } from '@/lib/utils'

/**
 * `/groups/[id]/sets/[setId]` — the full leaderboard for one set and, card by
 * card, who has it down and who is still on it: a card × member grid, sorted
 * hardest first, with a member pick to see only what they are missing. The
 * point of the grid: find the person to ask, and the card to do next. Membership + attachment + readability are all
 * checked in the loader (null → 404).
 */
export default async function GroupSetPage({ params }: { params: Promise<{ id: string; setId: string }> }) {
  const { id, setId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/groups/${id}/sets/${setId}`)}`)
  const viewerId = session.user.id
  void readableSetWhere

  const data = await loadGroupSetProgress(viewerId, id, setId)
  if (!data) notFound()
  const { set, leaderboard } = data

  return (
    <div className="max-w-5xl">
      <Button variant="ghost" size="sm" render={<Link href={`/groups/${id}`} />} className="mb-4">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the group
      </Button>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">In this group</div>
          <h1 className="display mt-1">{set.title}</h1>
        </div>
        <Link href={`/sets/${set.id}`} className={cn('text-sm underline underline-offset-4')}>Study this set</Link>
      </header>

      <Section className="mt-8">
        <SectionHeader title="Leaderboard" hint="ranked by cards mastered" />
        <SectionBody>
          <LeaderboardLegend />
          <div className="mt-3">
            <Leaderboard board={leaderboard} viewerId={viewerId} />
          </div>
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader title="Card by card" hint="who has which card down" />
        <SectionBody>
          <CoverageGrid board={leaderboard} cards={set.cards.map((c) => ({ id: c.id, term: c.term }))} viewerId={viewerId} />
        </SectionBody>
      </Section>
    </div>
  )
}
