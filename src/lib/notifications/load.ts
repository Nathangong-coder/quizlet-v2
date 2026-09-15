import type { Prisma } from '@prisma/client'
import type { NotificationKind } from './kinds'

/**
 * Notification reads and the one writer. Server-only (Prisma is imported
 * lazily so the kinds module stays client-importable).
 */

export interface NotificationRow {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  href: string | null
  meta: Record<string, unknown> | null
  readAt: Date | null
  createdAt: Date
}

export const NOTIFICATIONS_PAGE = 50

export async function unreadCount(userId: string): Promise<number> {
  const { prisma } = await import('@/lib/db')
  return prisma.notification.count({ where: { userId, readAt: null } })
}

export async function loadNotifications(userId: string, limit = NOTIFICATIONS_PAGE): Promise<NotificationRow[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, kind: true, title: true, body: true, href: true, meta: true, readAt: true, createdAt: true },
  })
  return rows.map((r) => ({ ...r, kind: r.kind as NotificationKind, meta: (r.meta as Record<string, unknown> | null) ?? null }))
}

/** The one writer. Called from the group actions after their own write succeeds. */
export async function notify(input: { userId: string; kind: NotificationKind; title: string; body?: string; href?: string; meta?: Record<string, unknown> }): Promise<void> {
  const { prisma } = await import('@/lib/db')
  await prisma.notification.create({
    data: { userId: input.userId, kind: input.kind, title: input.title, body: input.body ?? null, href: input.href ?? null, meta: (input.meta as Prisma.InputJsonObject | undefined) ?? undefined },
  })
}

/**
 * Resolve a pending request/invite notification once it is decided: the
 * accept/decline buttons should disappear from every copy of it. Matched on
 * `meta`, which carries the request or invite id.
 */
export async function settleActionable(userId: string, metaKey: 'requestId' | 'inviteId', id: string): Promise<void> {
  const { prisma } = await import('@/lib/db')
  await prisma.notification.updateMany({
    where: { userId, meta: { path: [metaKey], equals: id }, readAt: null },
    data: { readAt: new Date() },
  })
}
