import { appOrigin } from '@/lib/mail/origin'
import { consoleTransport, resendTransport, type MailTransport } from '@/lib/mail/transport'
import {
  feedbackTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
  type MailBody,
} from '@/lib/mail/templates'

const DEFAULT_FROM = 'Quizlet <onboarding@resend.dev>'

/**
 * Where /help submissions land.
 *
 * An env var rather than a literal, because this is an operator's personal
 * inbox and the repo's `.env.example` convention exists for exactly that. The
 * fallback keeps the feature working with no configuration at all, which is
 * what makes it testable end to end locally.
 *
 * Resolved per call, like `transport()` above, so a restarted dev server sees
 * the current environment rather than whatever was set at module load.
 */
export function feedbackRecipient(): string {
  return process.env.FEEDBACK_TO?.trim() || 'ngong7053@gmail.com'
}

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
async function sendQuietly(to: string, build: () => MailBody, replyTo?: string) {
  let subject = '(template not built)'
  try {
    const body = build()
    subject = body.subject
    await transport().send({ to, ...body, ...(replyTo ? { replyTo } : {}) })
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

/**
 * Deliver one feedback message. Returns whether it actually went out.
 *
 * THE RETURN VALUE IS THE POINT, and it is why this does not simply call
 * `sendQuietly`. Everywhere else in this module a failure is genuinely
 * unrecoverable — nobody is waiting on the outcome of a verification mail
 * except the user, who will click "resend". Here there IS a caller who can act
 * on it: `submitFeedback` has already persisted the row, and the boolean is
 * what sets `delivered`. Collapsing that to void would make every message look
 * undelivered forever, which is a worse lie than the one this design exists to
 * prevent.
 *
 * Still MUST NEVER THROW — the caller runs it inside `after()`.
 */
export async function sendFeedbackEmail(input: {
  name: string
  email: string
  subject: string
  message: string
}): Promise<boolean> {
  const to = feedbackRecipient()
  try {
    const body = feedbackTemplate(input)
    // reply_to, never from: an unverified from-address is rejected outright,
    // and this function swallowing that rejection is what would make it silent.
    await transport().send({ to, ...body, replyTo: input.email })
    return true
  } catch (error) {
    console.error('[mail] feedback delivery failed', { to, subject: input.subject, error })
    return false
  }
}
