'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { mintToken } from '@/lib/auth/tokens'
import { sendPasswordResetEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

export const FORGOT_FIXED_MESSAGE =
  'If that account exists, we’ve sent a link to its email address.'

/**
 * Start a password reset.
 *
 * THE ENUMERATION INVARIANT (design §5): one fixed response for every input,
 * and all work inside after() so the timing cannot be read either.
 *
 * A TOKEN IS ONLY MINTED FOR AN ACCOUNT THAT ALREADY HAS A passwordHash. An
 * OAuth-only account already has a working way in, so mailing it a reset link
 * would convert "controls the inbox" into "owns the account" on the strength
 * of an email claim GitHub gave us and we never verified. The response is
 * byte-identical either way, so refusing leaks nothing. An OAuth user who
 * wants a password uses /account, which requires being signed in — which they
 * can be, via GitHub.
 */
export async function requestPasswordReset(input: {
  identifier: string
}): Promise<ActionResult<void>> {
  const identifier = typeof input.identifier === 'string' ? input.identifier : ''

  after(async () => {
    try {
      const user = await prisma.user.findFirst({
        where: identifierWhere(identifier),
        select: { id: true, email: true, passwordHash: true },
      })
      if (!user || !user.passwordHash) return

      const token = await mintToken(prisma, { userId: user.id, purpose: 'password_reset' })
      // The ACCOUNT address, never the string that was typed — otherwise
      // signing in with a handle would let anyone have someone else's token
      // delivered to an inbox they control.
      await sendPasswordResetEmail(user.email, token)
    } catch (error) {
      console.error('[mail] requestPasswordReset failed', error)
    }
  })

  return { success: true, data: undefined }
}
