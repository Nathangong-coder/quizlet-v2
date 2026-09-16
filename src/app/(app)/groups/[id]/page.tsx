import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Users, ArrowLeft, Layers, Target } from 'lucide-react'
import { auth } from '@/auth'
import { loadGroup, loadGroupOverview } from '@/lib/groups/load'
import type { SetLeaderboard } from '@/lib/groups/progress'
import { studyNext, memberTotals, countNobody } from '@/lib/groups/pulse'
import { readableSetWhere } from '@/lib/sets/visibility'
import { subjectPath } from '@/lib/subjects/taxonomy'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { Button } from '@/components/ui/button'
import { Metric } from '@/components/ui/metric'
import { Leaderboard, LeaderboardLegend } from '@/components/groups/Leaderboard'
import { GroupForm } from '@/components/groups/GroupForm'
import { GroupTabs } from '@/components/groups/GroupTabs'
import { InvitePeopleDialog, PendingRequests, VisibilityToggle } from '@/components/groups/Membership'
import { loadPendingRequests, loadPendingInvites } from '@/lib/groups/discover'
import {
  InviteLink,
  RemoveMemberButton,
  LeaveGroupButton,
  DeleteGroupButton,
  RemoveSetButton,
  AddSetDialog,
} from '@/components/groups/GroupControls'
import { cn } from '@/lib/utils'

/**
 * `/groups/[id]` — one read, four tabs (owner, 2026-09-14: "a more
 * interactive, cleaner UI"). Overview is the group's pulse: every set as a
 * bar per member, and the cards the fewest people have down — where the
 * group studies next. Sets, Members and Settings hold what the old single
 * scroll held. Membership is checked in `loadGroup` (null → 404, not 403: a
 * stranger must not learn the id is real). Set reads inside go through
 * `composeSetWhere`; `readableSetWhere` is referenced here for the
 * enforcement test's source-level check.
 */
export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  const { tab } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/groups/${id}`)}`)
  const viewerId = session.user.id
  void readableSetWhere

  const group = await loadGroup(viewerId, id)
  if (!group) notFound()
  const overview = await loadGroupOverview(viewerId, group)
  const isOwner = group.viewerRole === 'owner'
  const [requests, invites] = isOwner ? await Promise.all([loadPendingRequests(group.id), loadPendingInvites(group.id)]) : [[], []]
  const readableSets = group.sets.filter((s) => s.readable && overview[s.setId])
  const cardsInPlay = readableSets.reduce((n, s) => n + s.cardCount, 0)
  const next = studyNext(group.sets.map((s) => ({ setId: s.setId, title: s.title ?? '', readable: s.readable })), overview, group.members.length, 6)
  const totals = memberTotals(group.members.map((m) => m.userId), overview)

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'sets', label: 'Sets', count: group.sets.length },
    { key: 'members', label: requests.length > 0 ? `Members · ${requests.length} waiting` : 'Members', count: group.members.length },
    ...(isOwner ? [{ key: 'settings', label: 'Settings' }] : []),
  ]

  return (
    <div className="max-w-5xl">
      <Button variant="ghost" size="sm" render={<Link href="/groups" />} className="mb-4">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All groups
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Users className="h-4 w-4" aria-hidden="true" />
            Study group
          </div>
          <h1 className="display mt-1">{group.name}</h1>
          {group.description && <p className="lede mt-2">{group.description}</p>}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex -space-x-2">
              {group.members.slice(0, 6).map((m) => (
                <span key={m.userId} className="rounded-full ring-2 ring-background">
                  <AvatarMark userId={m.userId} avatarUrl={m.avatarUrl} image={m.image} seed={m.handle ?? m.userId} name={m.handle} size={28} />
                </span>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
              {group.members.length > 6 && ` · +${group.members.length - 6} more`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {isOwner ? <DeleteGroupButton groupId={group.id} name={group.name} /> : <LeaveGroupButton groupId={group.id} />}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric value={group.members.length} label="Members" />
        <Metric value={group.sets.length} label="Sets" />
        <Metric value={cardsInPlay} label="Cards in play" emptyLabel="—" />
        <Metric value={readableSets.length > 0 ? countNobody(overview) : null} label="Cards nobody has down" emptyLabel="—" />
      </div>

      <div className="mt-8">
        <GroupTabs
          tabs={tabs}
          initial={tab}
          panels={{
            overview: (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <section aria-labelledby="pulse">
                  <h2 id="pulse" className="label mb-3">Where everyone is</h2>
                  {readableSets.length === 0 ? (
                    <EmptySets groupId={group.id} />
                  ) : (
                    <ul className="space-y-4">
                      {readableSets.map((s) => (
                        <li key={s.linkId} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-baseline justify-between gap-3">
                            <Link href={`/groups/${group.id}/sets/${s.setId}`} className="truncate font-heading font-bold hover:underline underline-offset-4">{s.title}</Link>
                            <span className="shrink-0 text-xs text-muted-foreground">{s.cardCount} cards</span>
                          </div>
                          <PulseBars board={overview[s.setId].leaderboard} viewerId={viewerId} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {readableSets.length > 0 && <div className="mt-3"><LeaderboardLegend /></div>}
                </section>
                <section aria-labelledby="next">
                  <h2 id="next" className="label mb-3 inline-flex items-center gap-1.5"><Target className="h-3.5 w-3.5" aria-hidden="true" />Study next</h2>
                  {next.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Add a set and this fills with the cards the group has not got down.</p>
                  ) : (
                    <ol className="space-y-2">
                      {next.map((c) => (
                        <li key={c.cardId} className="rounded-lg border border-border bg-card p-3 text-sm">
                          <div className="font-medium">{c.term}</div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">{c.setTitle}</span>
                            <span className="shrink-0">{c.masteredCount === 0 ? 'nobody has it down' : `${c.masteredCount} of ${c.memberCount} have it`}{c.learningCount > 0 && ` · ${c.learningCount} learning`}</span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">The cards the fewest members have mastered, across every set here. The full card-by-card view is on each set.</p>
                </section>
              </div>
            ),
            sets: (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Sets the group studies. Anyone can add a set they can share.</p>
                  <AddSetDialog groupId={group.id} />
                </div>
                {group.sets.length === 0 ? (
                  <EmptySets groupId={group.id} />
                ) : (
                  <div className="space-y-6">
                    <LeaderboardLegend />
                    {group.sets.map((s) => (
                      <div key={s.linkId} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            {s.readable ? (
                              <Link href={`/groups/${group.id}/sets/${s.setId}`} className="font-heading text-lg font-bold hover:underline underline-offset-4">{s.title}</Link>
                            ) : (
                              <span className="font-heading text-lg font-bold text-muted-foreground">No longer shared</span>
                            )}
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {s.readable ? (
                                <>
                                  <span className="metric">{s.cardCount}</span> cards
                                  {s.ownerHandle && <> · by @{s.ownerHandle}</>}
                                  {subjectPath(s.subject) && <> · {subjectPath(s.subject)}</>}
                                </>
                              ) : (
                                'Its owner made it private. It comes back if they share it again.'
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {s.readable && (
                              <>
                                <Link href={`/sets/${s.setId}`} className="text-sm underline underline-offset-4">Study</Link>
                                <Link href={`/groups/${group.id}/sets/${s.setId}`} className="text-sm underline underline-offset-4">Card by card</Link>
                              </>
                            )}
                            <RemoveSetButton groupId={group.id} setId={s.setId} />
                          </div>
                        </div>
                        {s.readable && overview[s.setId] && (
                          <div className="mt-4">
                            <Leaderboard board={overview[s.setId].leaderboard} viewerId={viewerId} compact />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
            members: (
              <div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Everyone here agreed, on joining, that members see their progress on this group&rsquo;s sets — and nothing outside them.
                </p>
                {isOwner && <PendingRequests requests={requests} invites={invites} />}
                <div className="mb-4 rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="label">Invite someone</div>
                    {isOwner && <InvitePeopleDialog groupId={group.id} />}
                  </div>
                  <InviteLink groupId={group.id} inviteCode={group.inviteCode} isOwner={isOwner} />
                </div>
                <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card">
                  {group.members.map((m) => {
                    const t = totals.get(m.userId)
                    return (
                      <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                        <AvatarMark userId={m.userId} avatarUrl={m.avatarUrl} image={m.image} seed={m.handle ?? m.userId} name={m.handle} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {m.handle ? <Link href={`/u/${m.handle}`} className="font-medium hover:underline underline-offset-4">@{m.handle}</Link> : <span className="text-muted-foreground">member</span>}
                            {m.userId === viewerId && <span className="text-xs text-muted-foreground">(you)</span>}
                            {m.role === 'owner' && <span className="label">owner</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            joined {m.joinedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {t && cardsInPlay > 0 && <> · <span className="metric">{t.mastered}</span> of {cardsInPlay} cards mastered</>}
                          </div>
                        </div>
                        {t && cardsInPlay > 0 && (
                          <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-muted sm:flex" role="img" aria-label={`${t.mastered} mastered, ${t.learning} learning`}>
                            <div className="h-full bg-success" style={{ width: `${(t.mastered / cardsInPlay) * 100}%` }} />
                            <div className="h-full bg-warning" style={{ width: `${(t.learning / cardsInPlay) * 100}%` }} />
                          </div>
                        )}
                        {isOwner && m.role !== 'owner' && <RemoveMemberButton groupId={group.id} userId={m.userId} handle={m.handle} />}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ),
            settings: isOwner ? (
              <div className="max-w-xl space-y-6">
                <GroupForm groupId={group.id} initialName={group.name} initialDescription={group.description ?? ''} />
                <VisibilityToggle groupId={group.id} visibility={group.visibility} />
                <div className="rounded-lg border border-border bg-card p-4 text-sm">
                  <div className="label mb-1">Invite link</div>
                  <p className="text-muted-foreground">Anyone with the link can join after accepting what members see. Turn it over and the old link stops working.</p>
                  <div className="mt-2"><InviteLink groupId={group.id} inviteCode={group.inviteCode} isOwner={isOwner} /></div>
                </div>
              </div>
            ) : null,
          }}
        />
      </div>
    </div>
  )
}

function EmptySets({ groupId }: { groupId: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground"><Layers className="h-5 w-5" aria-hidden="true" /></div>
      <p className="mt-3 text-sm text-muted-foreground">No sets yet. Add one of your shared sets and the leaderboard starts here.</p>
      <div className="mt-4"><AddSetDialog groupId={groupId} /></div>
    </div>
  )
}

/** One bar per member for a set — mastered / learning / not started. */
function PulseBars({ board, viewerId }: { board: SetLeaderboard; viewerId: string }) {
  const pct = (n: number) => (board.cardCount === 0 ? 0 : (n / board.cardCount) * 100)
  return (
    <ul className="mt-3 space-y-1.5">
      {board.standings.map((s) => {
        const learning = s.studied - s.mastered
        return (
          <li key={s.userId} className="flex items-center gap-2 text-xs">
            <span className={cn('w-20 truncate', s.userId === viewerId && 'font-semibold')}>{s.userId === viewerId ? 'you' : s.handle ? `@${s.handle}` : 'member'}</span>
            <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${s.mastered} mastered, ${learning} learning, ${s.unstudied} not started`}>
              <span className="h-full bg-success" style={{ width: `${pct(s.mastered)}%` }} />
              <span className="h-full bg-warning" style={{ width: `${pct(learning)}%` }} />
            </span>
            <span className="w-16 text-right text-muted-foreground tabular-nums">{s.mastered} of {board.cardCount}</span>
          </li>
        )
      })}
    </ul>
  )
}
