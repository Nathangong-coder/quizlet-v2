'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bell, Check, Users, UserPlus, MailCheck, MailX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { markNotificationsRead } from '@/actions/group-membership'
import { NOTIFICATION_KIND_LABELS, type NotificationKind } from '@/lib/notifications/kinds'
import { InviteActions, RequestActions } from '@/components/groups/Membership'

export interface NotificationView {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  href: string | null
  meta: Record<string, unknown> | null
  read: boolean
  at: string
}

const ICONS: Record<NotificationKind, typeof Bell> = {
  group_invite: UserPlus,
  group_join_request: Users,
  group_request_accepted: MailCheck,
  group_request_declined: MailX,
  group_invite_accepted: MailCheck,
  group_invite_declined: MailX,
}

/**
 * The notifications page's list. An unread row is bold with a dot; an
 * actionable one (an invitation to you, a request on your group) carries
 * its accept / decline until it is decided, at which point the action
 * marks it read. "Mark all read" is the only bulk control.
 */
export function NotificationList({ items }: { items: NotificationView[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const unread = items.filter((n) => !n.read).length

  function markAll() {
    startTransition(async () => {
      const res = await markNotificationsRead('all')
      if (!res.success) return void toast.error(res.error)
      router.refresh()
    })
  }

  function markOne(id: string) {
    startTransition(async () => {
      await markNotificationsRead([id])
      router.refresh()
    })
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{unread === 0 ? 'Nothing unread.' : `${unread} unread`}</p>
        <Button size="sm" variant="ghost" onClick={markAll} disabled={isPending || unread === 0}><Check className="h-3.5 w-3.5" aria-hidden="true" />Mark all read</Button>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground"><Bell className="h-6 w-6" aria-hidden="true" /></div>
          <h2 className="mt-4 text-lg font-semibold">No notifications yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">Invitations to study groups, requests to join yours, and the answers to both land here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell
            const inviteId = typeof n.meta?.inviteId === 'string' ? n.meta.inviteId : null
            const requestId = typeof n.meta?.requestId === 'string' ? n.meta.requestId : null
            const actionable = !n.read && ((n.kind === 'group_invite' && inviteId) || (n.kind === 'group_join_request' && requestId))
            return (
              <li key={n.id} className={cn('flex gap-3 px-4 py-3', !n.read && 'bg-accent/30')}>
                <span className={cn('mt-0.5 rounded-full p-2', n.read ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary')}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={cn('text-sm', !n.read && 'font-semibold')}>
                      {!n.read && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-label="unread" />}
                      {n.title}
                    </p>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.at}>{new Date(n.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>
                  </div>
                  <p className="text-xs text-muted-foreground">{NOTIFICATION_KIND_LABELS[n.kind] ?? n.kind}{n.body && <> · {n.body}</>}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {actionable && n.kind === 'group_invite' && inviteId && <InviteActions inviteId={inviteId} groupName={n.title.replace(/^.*invited you to /, '')} />}
                    {actionable && n.kind === 'group_join_request' && requestId && <RequestActions requestId={requestId} />}
                    {n.href && !actionable && <Link href={n.href} onClick={() => !n.read && markOne(n.id)} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">Open →</Link>}
                    {!n.read && !actionable && <button type="button" onClick={() => markOne(n.id)} className="text-xs text-muted-foreground underline-offset-4 hover:underline">Mark read</button>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
