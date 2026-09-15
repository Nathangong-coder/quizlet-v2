'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Eye, EyeOff, Globe, Lock, Search, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { cn } from '@/lib/utils'
import { inviteUser, listInvitableUsers, requestToJoin, respondToInvite, respondToJoinRequest, setGroupVisibility } from '@/actions/group-membership'
import type { GroupVisibility } from '@/lib/groups/roles'
import type { PendingRequestRow, PendingInviteRow } from '@/lib/groups/discover'

/**
 * The privacy contract, in one place, shown wherever consent is asked:
 * requesting to join, accepting an invitation. Same three lines as the
 * invite-link page.
 */
export function ConsentNote({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('rounded-lg border border-warning/40 bg-warning-subtle text-sm', compact ? 'p-3' : 'p-4')} role="note" aria-label="What this group will see">
      <p className="font-semibold">What this group will see</p>
      <ul className="mt-2 space-y-1.5">
        <li className="flex gap-2"><Eye className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><span><span className="font-medium">Your progress on the group&rsquo;s sets</span> — cards studied and mastered, confidence, when you last studied — on a leaderboard members can see.</span></li>
        <li className="flex gap-2"><EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /><span><span className="font-medium">Nothing else.</span> Not your other sets, answers, history, email or name — your handle only.</span></li>
        <li className="flex gap-2"><EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /><span><span className="font-medium">Leaving stops it immediately.</span> Nothing is copied.</span></li>
      </ul>
    </div>
  )
}

export function ConsentCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
      <span>I understand that members of this group will see my progress on its sets.</span>
    </label>
  )
}

/** "Request to join" on a public group: consent + an optional line to the owner. */
export function RequestToJoinButton({ groupId, groupName, state }: { groupId: string; groupName: string; state: 'none' | 'member' | 'pending' | 'declined' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()

  if (state === 'member') return <Button size="sm" variant="outline" render={<Link href={`/groups/${groupId}`} />}>Open</Button>
  if (state === 'pending') return <span className="text-xs text-muted-foreground">Request sent — waiting on the owner</span>

  function send() {
    startTransition(async () => {
      const res = await requestToJoin({ groupId, message, acknowledged })
      if (!res.success) return void toast.error(res.error)
      toast.success(`Asked to join ${groupName}`)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" />}>{state === 'declined' ? 'Ask again' : 'Request to join'}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Ask to join {groupName}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">The owner decides. If they accept, you are in — on the terms below, which you agree to now.</p>
        <div className="mt-3"><ConsentNote compact /></div>
        <label className="mt-3 block text-sm">
          <span className="label">A line to the owner (optional)</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} rows={2} placeholder="Prepping for the same superday…" className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <div className="mt-3"><ConsentCheckbox checked={acknowledged} onChange={setAcknowledged} /></div>
        <div className="mt-4 flex gap-2">
          <Button type="button" onClick={send} disabled={!acknowledged || isPending}>{isPending ? 'Sending…' : 'Send request'}</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Owner: the public-user directory, searchable by handle, one Invite per row. */
export function InvitePeopleDialog({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<{ id: string; handle: string; bio: string | null; invited: boolean }[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const t = setTimeout(() => {
      listInvitableUsers(groupId, q).then((res) => {
        if (cancelled) return
        if (res.success) setUsers(res.data)
        else toast.error(res.error)
      })
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, q, groupId])

  function invite(userId: string) {
    startTransition(async () => {
      const res = await inviteUser(groupId, userId)
      if (!res.success) return void toast.error(res.error)
      setUsers((prev) => prev?.map((u) => (u.id === userId ? { ...u, invited: true } : u)) ?? null)
      toast.success('Invitation sent')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Invite people
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite someone</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Anyone with a public profile. They accept — and agree to what the group sees — before they are in.</p>
        <label className="mt-3 flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by handle" aria-label="Search by handle" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" autoFocus />
        </label>
        {users === null ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : users.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nobody matches{q ? ` "${q}"` : ''}.</p>
        ) : (
          <ul className="mt-3 max-h-80 divide-y divide-border overflow-y-auto">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/u/${u.handle}`} className="block truncate font-medium hover:underline underline-offset-4">@{u.handle}</Link>
                  {u.bio && <span className="block truncate text-xs text-muted-foreground">{u.bio}</span>}
                </span>
                {u.invited ? <span className="text-xs text-muted-foreground">Invited</span> : <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => invite(u.id)}>Invite</Button>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Owner: the queue of people asking in, with accept / decline. */
export function PendingRequests({ requests, invites }: { requests: PendingRequestRow[]; invites: PendingInviteRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  function decide(id: string, accept: boolean) {
    startTransition(async () => {
      const res = await respondToJoinRequest(id, accept)
      if (!res.success) return void toast.error(res.error)
      toast.success(accept ? 'Accepted — they are in' : 'Declined')
      router.refresh()
    })
  }
  if (requests.length === 0 && invites.length === 0) return null
  return (
    <div className="mb-4 space-y-3">
      {requests.length > 0 && (
        <div className="rounded-lg border border-primary/40 bg-accent/40 p-3">
          <div className="label mb-2">Asking to join · {requests.length}</div>
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <AvatarMark userId={r.userId} avatarUrl={r.avatarUrl} image={r.image} seed={r.handle ?? r.userId} name={r.handle} size={28} />
                <span className="min-w-0 flex-1">
                  {r.handle ? <Link href={`/u/${r.handle}`} className="font-medium hover:underline underline-offset-4">@{r.handle}</Link> : <span className="text-muted-foreground">someone</span>}
                  {r.message && <span className="block truncate text-xs text-muted-foreground">&ldquo;{r.message}&rdquo;</span>}
                </span>
                <Button size="sm" onClick={() => decide(r.id, true)} disabled={isPending}><Check className="h-3.5 w-3.5" aria-hidden="true" />Accept</Button>
                <Button size="sm" variant="ghost" onClick={() => decide(r.id, false)} disabled={isPending}><X className="h-3.5 w-3.5" aria-hidden="true" />Decline</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {invites.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Invited, not yet answered: {invites.map((i) => (i.handle ? `@${i.handle}` : 'someone')).join(', ')}
        </p>
      )}
    </div>
  )
}

/** Owner: private ↔ public. */
export function VisibilityToggle({ groupId, visibility }: { groupId: string; visibility: GroupVisibility }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  function set(v: GroupVisibility) {
    if (v === visibility) return
    startTransition(async () => {
      const res = await setGroupVisibility(groupId, v)
      if (!res.success) return void toast.error(res.error)
      toast.success(v === 'public' ? 'Listed — anyone can ask to join' : 'Private — invite link and invitations only')
      router.refresh()
    })
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="label mb-1">Who can find this group</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Group visibility">
        {([
          { v: 'private', icon: Lock, title: 'Private', body: 'Only by invite link, or an invitation from you.' },
          { v: 'public', icon: Globe, title: 'Public', body: 'Listed in the groups directory. Anyone signed in can ask to join; you decide.' },
        ] as const).map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={visibility === o.v} disabled={isPending} onClick={() => set(o.v)} className={cn('rounded-lg border p-3 text-left', visibility === o.v ? 'border-primary bg-accent' : 'border-border hover:border-primary/50')}>
            <span className="inline-flex items-center gap-1.5 font-semibold"><o.icon className="h-4 w-4" aria-hidden="true" />{o.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{o.body}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** In a notification: accept (with consent) or decline an invitation. */
export function InviteActions({ inviteId, groupName }: { inviteId: string; groupName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [isPending, startTransition] = useTransition()
  function respond(accept: boolean) {
    startTransition(async () => {
      const res = await respondToInvite(inviteId, accept, acknowledged)
      if (!res.success) return void toast.error(res.error)
      toast.success(accept ? `You joined ${groupName}` : 'Declined')
      setOpen(false)
      if (accept) router.push(`/groups/${res.data.groupId}`)
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button type="button" size="sm" />}>Accept</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Join {groupName}</DialogTitle></DialogHeader>
          <ConsentNote compact />
          <div className="mt-3"><ConsentCheckbox checked={acknowledged} onChange={setAcknowledged} /></div>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={() => respond(true)} disabled={!acknowledged || isPending}>{isPending ? 'Joining…' : 'Join group'}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Button type="button" size="sm" variant="ghost" onClick={() => respond(false)} disabled={isPending}>Decline</Button>
    </div>
  )
}

/** In a notification (owner's side): accept or decline a join request. */
export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  function decide(accept: boolean) {
    startTransition(async () => {
      const res = await respondToJoinRequest(requestId, accept)
      if (!res.success) return void toast.error(res.error)
      toast.success(accept ? 'Accepted — they are in' : 'Declined')
      router.refresh()
    })
  }
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" onClick={() => decide(true)} disabled={isPending}>Accept</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => decide(false)} disabled={isPending}>Decline</Button>
    </div>
  )
}
