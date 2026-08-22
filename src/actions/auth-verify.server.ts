'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { mintToken, consumeToken, invalidateTokens } from '@/lib/auth/tokens'
import { sendVerificationEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

/**
 * Send another verification link.
 *
 * THE ENUMERATION INVARIANT (design §5): one fixed response for every input,
 * and ALL work inside after(). Identical text alone is not sufficient —
 * sending mail takes a couple of hundred milliseconds and not sending takes
 * none, so a caller can time the difference and learn which addresses have
 * accounts. after() returns the response before any of that work begins.
 */
export async function resendVerification(input: {
  identifier: string
}): Promise<ActionResult<void>> {
  const identifier = typeof input.identifier === 'string' ? input.identifier : ''

  after(async () => {
    try {
      const user = await prisma.user.findFirst({
        where: identifierWhere(identifier),
        select: { id: true, email: true, emailVerified: true },
      })
      // Only an account that exists AND still needs verifying. Re-sending to a
      // verified account turns "resend" into unlimited mail to any address that
      // has ever registered here.
      if (!user || user.emailVerified) return

      const token = await mintToken(prisma, { userId: user.id, purpose: 'email_verify' })
      await sendVerificationEmail(user.email, token)
    } catch (error) {
      // after() has no error boundary: an exception here is unhandled and
      // kills the callback silently. Logged with the same prefix send.ts uses.
      console.error('[mail] resendVerification failed', error)
    }
  })

  return { success: true, data: undefined }
}

/**
 * Turn a verification link into a verified address.
 *
 * Does NOT sign the user in. The token sits in a URL, which lands in browser
 * history, in the referrer of anything the page loads, and in whatever proxy
 * logged the request — proving control of an inbox is not the same as holding
 * a credential.
 *
 * KNOWN AND ACCEPTED: this consumes on a GET, so a mail-scanning link
 * prefetcher can burn the token before the human clicks it. The failure page
 * therefore always offers a resend rather than a dead end, which is what makes
 * that recoverable instead of fatal.
 */
export async function consumeEmailVerification(rawToken: string): Promise<{ ok: boolean }> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return { ok: false }

  return prisma.$transaction(async (tx) => {
    const claimed = await consumeToken(tx, { purpose: 'email_verify', raw: rawToken })
    if (!claimed.ok) return { ok: false }

    const user = await tx.user.findUnique({
      where: { id: claimed.userId },
      select: { emailVerified: true },
    })

    // Only when null — never overwrite an existing verification stamp.
    // completePasswordReset (src/actions/auth-reset.server.ts) honours the same
    // rule: a password reset can already have stamped emailVerified, and an
    // OLDER verify link clicked afterward must not rewrite that history.
    if (!user?.emailVerified) {
      await tx.user.update({
        where: { id: claimed.userId },
        data: { emailVerified: new Date() },
      })
    }
    // A second link in an older mail must not stay live after this one worked.
    await invalidateTokens(tx, { userId: claimed.userId, purpose: 'email_verify' })
    return { ok: true }
  })
}
