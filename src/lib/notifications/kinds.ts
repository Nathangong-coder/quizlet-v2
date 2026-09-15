/**
 * The closed vocabulary of `Notification.kind`. Persisted, so a rename
 * strands rows — add, never rename. Each kind has a human label for the
 * notifications page and an icon key the rail resolves.
 */
export const NOTIFICATION_KINDS = [
  'group_invite',
  'group_join_request',
  'group_request_accepted',
  'group_request_declined',
  'group_invite_accepted',
  'group_invite_declined',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export function isNotificationKind(v: string): v is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(v)
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  group_invite: 'Group invitation',
  group_join_request: 'Join request',
  group_request_accepted: 'Request accepted',
  group_request_declined: 'Request declined',
  group_invite_accepted: 'Invitation accepted',
  group_invite_declined: 'Invitation declined',
}

/** Kinds that carry an action the reader must take (accept / decline). */
export const ACTIONABLE_KINDS: readonly NotificationKind[] = ['group_invite', 'group_join_request']
