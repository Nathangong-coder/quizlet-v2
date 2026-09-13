import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { auth } from '@/auth'
import { loadGroupSetProgress } from '@/lib/groups/load'
import { readableSetWhere } from '@/lib/sets/visibility'
import { Button } from '@/components/ui/button'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { Leaderboard, LeaderboardLegend } from '@/components/groups/Leaderboard'
import { cn } from '@/lib/utils'

/**
 * `/groups/[id]/sets/[setId]` — the full leaderboard for one set and, card by
 * card, who has it down and who is still on it. The point of the card grid:
 * find the person to ask. Membership + attachment + readability are all
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
  const cardById = new Map(set.cards.map((c) => [c.id, c]))

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
        <SectionHeader title="Card by card" hint="who to ask" />
        <SectionBody>
          <ul className="divide-y divide-border/70">
            {leaderboard.cards.map((c) => {
              const card = cardById.get(c.cardId)
              if (!card) return null
              const nobody = c.masteredBy.length === 0
              return (
                <li key={c.cardId} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6">
                  <div className="min-w-0">
                    <div className="font-medium">{card.term}</div>
                    <div className="line-clamp-2 text-sm text-muted-foreground">{card.definition}</div>
                  </div>
                  <div className="text-sm">
                    {nobody ? (
                      <span className="text-muted-foreground">Nobody has this one down yet{c.learningBy.length > 0 ? ` — ${c.learningBy.length} learning` : ''}.</span>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Ask </span>
                        {c.masteredBy.map((m, i) => (
                          <span key={m.userId}>
                            {i > 0 && <span className="text-muted-foreground">, </span>}
                            {m.userId === viewerId ? (
                              <span className="font-medium">you</span>
                            ) : m.handle ? (
                              <Link href={`/u/${m.handle}`} className="font-medium hover:underline underline-offset-4">@{m.handle}</Link>
                            ) : (
                              <span className="font-medium">a member</span>
                            )}
                          </span>
                        ))}
                        {c.learningBy.length > 0 && <span className="text-muted-foreground"> · {c.learningBy.length} learning</span>}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </SectionBody>
      </Section>
    </div>
  )
}
