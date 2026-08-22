import { appOrigin } from '@/lib/mail/origin'
import { consoleTransport, resendTransport, type MailTransport } from '@/lib/mail/transport'
import { passwordResetTemplate, verifyEmailTemplate, type MailBody } from '@/lib/mail/templates'

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
 * `build` is a thunk, not a pre-built body, so that template construction
 * (and `appOrigin()`) happens *inside* the try — not as an argument
 * expression evaluated before this function is ever entered. Nothing in
 * those calls throws today, but "MUST NEVER THROW" has to cover the whole
 * call, not just the network hop, or the promise this function's name makes
 * is false.
 *
 * The cost, stated plainly: a broken mail configuration is QUIET. A user whose
 * message bounced sees "check your inbox" and nothing arrives. The console
 * transport and the live gate are what cover that; there is no bounce handling
 * and no in-app delivery dashboard.
 */
async function sendQuietly(to: string, build: () => MailBody) {
  let subject = '(template not built)'
  try {
    const body = build()
    subject = body.subject
    await transport().send({ to, ...body })
  } catch (error) {
    console.error('[mail] delivery failed', { to, subject, error })
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  await sendQuietly(to, () => verifyEmailTemplate({ origin: appOrigin(), token }))
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  await sendQuietly(to, () => passwordResetTemplate({ origin: appOrigin(), token }))
}
