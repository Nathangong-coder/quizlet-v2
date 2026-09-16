'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, RefreshCw, UserMinus, LogOut, Trash2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  regenerateInvite,
  leaveGroup,
  removeMember,
  deleteGroup,
  addSetToGroup,
  removeSetFromGroup,
  listAttachableSets,
} from '@/actions/groups'
import { inviteUrl } from '@/lib/groups/invite'

/**
 * The small interactive pieces of a group page. Each is one action, so a
 * failure in one cannot revert another (the account-panels rule).
 */

export function InviteLink({ groupId, inviteCode, isOwner }: { groupId: string; inviteCode: string; isOwner: boolean }) {
  const router = useRouter()
  const [code, setCode] = useState(inviteCode)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  // The DISPLAYED link is the path only: the origin is a browser fact that the
  // server render cannot know, and rendering it would hydrate differently. The
  // absolute link is built at copy time, where `window` exists.
  const path = inviteUrl(code, '')

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl(code, window.location.origin))
      setCopied(true)
      toast.success('Invite link copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy — select the link instead')
    }
  }

  function rotate() {
    startTransition(async () => {
      const res = await regenerateInvite(groupId)
      if (!res.success) return void toast.error(res.error)
      setCode(res.data.inviteCode)
      toast.success('New invite link — the old one no longer works')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="max-w-full truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">{path}</code>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {isOwner && (
        <Button type="button" variant="ghost" size="sm" onClick={rotate} disabled={isPending} title="Make a new link; the old one stops working">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          New link
        </Button>
      )}
    </div>
  )
}

export function RemoveMemberButton({ groupId, userId, handle }: { groupId: string; userId: string; handle: string | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      aria-label={`Remove ${handle ? '@' + handle : 'member'}`}
      onClick={() =>
        startTransition(async () => {
          const res = await removeMember(groupId, userId)
          if (!res.success) return void toast.error(res.error)
          toast.success('Member removed')
          router.refresh()
        })
      }
    >
      <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  )
}

export function LeaveGroupButton({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await leaveGroup(groupId)
          if (!res.success) return void toast.error(res.error)
          toast.success('You left the group. Nothing about your progress is shared with it any more.')
          router.push('/groups')
          router.refresh()
        })
      }
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
      Leave group
    </Button>
  )
}

export function DeleteGroupButton({ groupId, name }: { groupId: string; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete group
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{name}&rdquo;?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Every member loses access and the invite link stops working. Nobody&rsquo;s sets or progress are touched — the group never held a copy of either.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteGroup(groupId)
                if (!res.success) return void toast.error(res.error)
                router.push('/groups')
                router.refresh()
              })
            }
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveSetButton({ groupId, setId }: { groupId: string; setId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      aria-label="Remove set from group"
      onClick={() =>
        startTransition(async () => {
          const res = await removeSetFromGroup(groupId, setId)
          if (!res.success) return void toast.error(res.error)
          router.refresh()
        })
      }
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  )
}

export function AddSetDialog({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sets, setSets] = useState<{ id: string; title: string; cardCount: number; attached: boolean }[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listAttachableSets(groupId).then((res) => {
      if (cancelled) return
      if (res.success) setSets(res.data)
      else toast.error(res.error)
    })
    return () => { cancelled = true }
  }, [open, groupId])

  function add(setId: string) {
    startTransition(async () => {
      const res = await addSetToGroup(groupId, setId)
      if (!res.success) return void toast.error(res.error)
      setSets((prev) => prev?.map((s) => (s.id === setId ? { ...s, attached: true } : s)) ?? null)
      toast.success('Set added')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" />}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add a set
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add one of your sets</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Only sets that are shared (anyone with the link, or public) can be added — members have to be able to open them. Private sets are not listed; share one from its page first.
        </p>
        {sets === null ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : sets.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">You have no shared sets yet.</p>
        ) : (
          <ul className="mt-4 max-h-80 divide-y divide-border overflow-y-auto">
            {sets.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground"><span className="metric">{s.cardCount}</span> cards</span>
                </span>
                {s.attached ? (
                  <span className="text-xs text-muted-foreground">Added</span>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => add(s.id)}>Add</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
