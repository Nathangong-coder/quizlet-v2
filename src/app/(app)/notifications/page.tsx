import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { loadNotifications } from '@/lib/notifications/load'
import { PageHeader } from '@/components/ui/page-header'
import { NotificationList } from '@/components/notifications/NotificationList'

export const metadata: Metadata = { title: 'Notifications' }

/**
 * `/notifications` — everything addressed to you: group invitations (with
 * accept / decline right here), requests to join a group you own, and the
 * decisions on your own requests. The rail's badge is the unread count.
 */
export default async function NotificationsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fnotifications')
  const rows = await loadNotifications(session.user.id)
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" lede="Invitations, requests, and what came of them." />
      <NotificationList items={rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, meta: r.meta, read: r.readAt !== null, at: r.createdAt.toISOString() }))} />
    </div>
  )
}
