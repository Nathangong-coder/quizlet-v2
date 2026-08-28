'use server'

import { after } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { feedbackSchema } from '@/lib/feedback/schema'
import { withinFeedbackRate, feedbackWindowStart, FEEDBACK_MAX_PER_HOUR } from '@/lib/feedback/rate'
import { sendFeedbackEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

/**
 * Accept one message from /help.
 *
 * THE ROW IS WRITTEN BEFORE MAIL IS ATTEMPTED, and that ordering is the entire
 * reason the `Feedback` table exists. `src/lib/mail/send.ts` must never throw —
 * every caller runs inside `after()`, where an exception is unhandled — so it
 * swallows delivery failures. With email-only delivery, a missing or expired
 * RESEND_API_KEY means the sender reads "thanks, sent" and the message exists
 * nowhere. RESEND_API_KEY is absent in development, so that is the DEFAULT
 * state here, not an edge case.
 *
 * Signed in only. A signed-out form here would be an unauthenticated write
 * endpoint that emails an operator's personal inbox — a spam relay with extra
 * steps.
 *
 * The identity comes from the session and is never read from the input. Every
 * export in a `'use server'` file is a public endpoint, so a `userId` argument
 * would let any caller file a report as anyone.
 */
export async function submitFeedback(input: {
  name: string
  email: string
  subject: string
  message: string
}): Promise<ActionResult<{ delivered: boolean }>> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { success: false, error: 'Sign in to send feedback.' }

  const parsed = feedbackSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const recentCount = await prisma.feedback.count({
    where: { userId, createdAt: { gte: feedbackWindowStart() } },
  })
  if (!withinFeedbackRate(recentCount)) {
    return {
      success: false,
      error: `That is ${FEEDBACK_MAX_PER_HOUR} messages in an hour. Give it a little while.`,
    }
  }

  // Persist FIRST. Everything after this point can fail without losing the
  // message.
  const row = await prisma.feedback.create({
    data: { userId, ...parsed.data },
  })

  after(async () => {
    const delivered = await sendFeedbackEmail(parsed.data)
    if (!delivered) return
    try {
      await prisma.feedback.update({ where: { id: row.id }, data: { delivered: true } })
    } catch (error) {
      // The message is already stored and already sent; failing to record the
      // flag is the least consequential thing that can go wrong here, and it
      // must not escape `after()`, which has no error boundary.
      console.error('[feedback] could not mark delivered', { id: row.id, error })
    }
  })

  // `delivered: false` at this point is honest rather than pessimistic — the
  // send has not been attempted yet. The UI says "we have it", not "it sent".
  return { success: true, data: { delivered: false } }
}
