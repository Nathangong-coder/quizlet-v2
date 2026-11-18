// Server-only: telling the operator that something needs them.
import { sendOwnerNotification } from '@/lib/mail/send'

export type OwnerEvent = { kind: 'waitlist_request'; email: string; note: string | null }

/**
 * Tell the owner about one event. MUST NEVER THROW — callers run it inside
 * `after()`, where a throw is unhandled.
 *
 * THE SINGLE SEAM for owner notifications: email today (to `feedbackRecipient()`,
 * through the mail transport, which falls back to the console transport when
 * `RESEND_API_KEY` is absent). A CallMeBot / WhatsApp channel plugs in HERE
 * later (spec §5.6), beside the email, so no caller changes.
 */
export async function notifyOwner(event: OwnerEvent): Promise<void> {
  try {
    await sendOwnerNotification(event)
  } catch (error) {
    // sendOwnerNotification already swallows delivery failures; this covers
    // anything else. The event itself is not logged: it carries an email.
    console.error('[notify] owner notification failed', { kind: event.kind, error: error instanceof Error ? error.name : 'unknown' })
  }
}
