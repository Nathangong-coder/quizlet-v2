import { appOrigin } from '@/lib/mail/origin'
import { consoleTransport, resendTransport, type MailTransport } from '@/lib/mail/transport'
import { passwordResetTemplate, verifyEmailTemplate } from '@/lib/mail/templates'

const DEFAULT_FROM = 'Quizlet <onboarding@resend.dev>'

/**
 * Resolved per call rather than at module load, so a test (and a dev server
 * restarted with a new key) sees the current environment.
 */
function transport(): MailTransport {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return consoleTransport
  return resendTransport(key, process.env.MAIL_FROM?.trim() || DEFAULT_FROM)
}

/**
 * MUST NEVER THROW.
 *
 * Every caller runs inside `after()`, where an exception is unhandled and
 * silently kills the rest of the callback — so a mail failure would take out
 * whatever else that callback was doing. It logs with a distinctive `[mail]`
 * prefix instead.
 *
 * The cost, stated plainly: a broken mail configuration is QUIET. A user whose
 * message bounced sees "check your inbox" and nothing arrives. The console
 * transport and the live gate are what cover that; there is no bounce handling
 * and no in-app delivery dashboard.
 */
async function sendQuietly(to: string, body: { subject: string; text: string; html: string }) {
  try {
    await transport().send({ to, ...body })
  } catch (error) {
    console.error('[mail] delivery failed', { to, subject: body.subject, error })
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  await sendQuietly(to, verifyEmailTemplate({ origin: appOrigin(), token }))
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  await sendQuietly(to, passwordResetTemplate({ origin: appOrigin(), token }))
}
