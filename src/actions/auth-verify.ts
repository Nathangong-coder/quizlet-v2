'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { mintToken } from '@/lib/auth/tokens'
import { sendVerificationEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

/**
 * ONE message for every input. The UI must render this and never branch.
 */
export const RESEND_FIXED_MESSAGE =
  'If that account exists and still needs verifying, we’ve sent a new link to its email address.'

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
