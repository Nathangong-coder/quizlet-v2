import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Users, ArrowLeft } from 'lucide-react'
import { auth } from '@/auth'
import { loadGroup, loadGroupOverview } from '@/lib/groups/load'
import { readableSetWhere } from '@/lib/sets/visibility'
import { subjectPath } from '@/lib/subjects/taxonomy'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { Button } from '@/components/ui/button'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { Leaderboard, LeaderboardLegend } from '@/components/groups/Leaderboard'
import { GroupForm } from '@/components/groups/GroupForm'
import {
  InviteLink,
  RemoveMemberButton,
  LeaveGroupButton,
  DeleteGroupButton,
  RemoveSetButton,
  AddSetDialog,
} from '@/components/groups/GroupControls'

/**
 * `/groups/[id]` — members, the group's sets, and a compact leaderboard per
 * set. Membership is checked in `loadGroup` (null → 404, not 403: a stranger
 * must not learn the id is real). Set reads inside go through
 * `composeSetWhere`; `readableSetWhere` is referenced here for the
 * enforcement test's source-level check.
 */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/groups/${id}`)}`)
  const viewerId = session.user.id
  void readableSetWhere

  const group = await loadGroup(viewerId, id)
  if (!group) notFound()
  const overview = await loadGroupOverview(viewerId, group)
  const isOwner = group.viewerRole === 'owner'

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
        </div>
        <div className="flex shrink-0 gap-2">
          {isOwner ? <DeleteGroupButton groupId={group.id} name={group.name} /> : <LeaveGroupButton groupId={group.id} />}
        </div>
      </header>

      <Section className="mt-8">
        <SectionHeader title="Invite link" hint="anyone with it can join" />
        <SectionBody>
          <InviteLink groupId={group.id} inviteCode={group.inviteCode} isOwner={isOwner} />
          <p className="mt-2 text-xs text-muted-foreground">
            Whoever joins is shown, and has to accept, that members see their progress on this group&rsquo;s sets.
          </p>
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader title="Members" hint={`${group.members.length}`} />
        <SectionBody>
          <ul className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-sm">
                <AvatarMark userId={m.userId} avatarUrl={m.avatarUrl} image={m.image} seed={m.handle ?? m.userId} name={m.handle} size={24} />
                {m.handle ? <Link href={`/u/${m.handle}`} className="hover:underline underline-offset-4">@{m.handle}</Link> : <span className="text-muted-foreground">member</span>}
                {m.role === 'owner' && <span className="label">owner</span>}
                {isOwner && m.role !== 'owner' && <RemoveMemberButton groupId={group.id} userId={m.userId} handle={m.handle} />}
              </li>
            ))}
          </ul>
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader title="Sets" hint={`${group.sets.length}`} action={<AddSetDialog groupId={group.id} />} />
        <SectionBody>
          {group.sets.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No sets yet. Add one of your shared sets and the leaderboard starts here.</p>
          ) : (
            <div className="space-y-8">
              <LeaderboardLegend />
              {group.sets.map((s) => (
                <div key={s.linkId} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {s.readable ? (
                        <Link href={`/groups/${group.id}/sets/${s.setId}`} className="font-heading text-lg font-bold hover:underline underline-offset-4">
                          {s.title}
                        </Link>
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
                    <div className="flex items-center gap-1">
                      {s.readable && (
                        <Link href={`/sets/${s.setId}`} className="text-sm underline underline-offset-4">Study</Link>
                      )}
                      <RemoveSetButton groupId={group.id} setId={s.setId} />
                    </div>
                  </div>
                  {s.readable && overview[s.setId] && (
                    <div className="mt-4">
                      <Leaderboard board={overview[s.setId]} viewerId={viewerId} compact />
                      <Link href={`/groups/${group.id}/sets/${s.setId}`} className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline">
                        Card by card — who knows what
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionBody>
      </Section>

      {isOwner && (
        <Section>
          <SectionHeader title="Settings" />
          <SectionBody>
            <div className="max-w-xl">
              <GroupForm groupId={group.id} initialName={group.name} initialDescription={group.description ?? ''} />
            </div>
          </SectionBody>
        </Section>
      )}
    </div>
  )
}
