'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { mintToken, peekToken, consumeToken, invalidateTokens } from '@/lib/auth/tokens'
import { checkPassword, PASSWORD_REJECTION_MESSAGES, hashPassword } from '@/lib/auth/password'
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

/** Validate WITHOUT consuming, so a GET can render the form without burning the link. */
export async function peekResetToken(rawToken: string): Promise<boolean> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return false
  return peekToken(prisma, { purpose: 'password_reset', raw: rawToken })
}

/** The one message every failure produces — used or expired are the same to a caller. */
const RESET_FAILED_MESSAGE =
  'That reset link has expired or has already been used. Request a new one.'

/**
 * Consume a reset link and set a new password.
 *
 * Four writes, one transaction:
 *  - consume the token atomically (single-use is enforced there, not here);
 *  - write passwordHash + passwordSetAt;
 *  - set emailVerified IF NULL — clicking a link in an inbox proves the inbox,
 *    which is what gives an unverified, locked-out user exactly one path back;
 *  - bump sessionVersion, because this is a password change and every
 *    outstanding JWT for the account must die (see src/lib/auth/session.ts);
 *  - invalidate the user's other outstanding password_reset tokens.
 *
 * Hashing happens OUTSIDE the transaction, and the policy check happens before
 * the token is touched — a too-short password must not cost the user their link.
 */
export async function completePasswordReset(input: {
  token: string
  password: string
}): Promise<ActionResult<void>> {
  const policy = checkPassword(input.password)
  if (!policy.ok) return { success: false, error: PASSWORD_REJECTION_MESSAGES[policy.reason] }

  const passwordHash = await hashPassword(input.password)

  return prisma.$transaction(async (tx): Promise<ActionResult<void>> => {
    const claimed = await consumeToken(tx, { purpose: 'password_reset', raw: input.token })
    if (!claimed.ok) return { success: false, error: RESET_FAILED_MESSAGE }

    const user = await tx.user.findUnique({
      where: { id: claimed.userId },
      select: { sessionVersion: true, emailVerified: true },
    })
    if (!user) return { success: false, error: RESET_FAILED_MESSAGE }

    await tx.user.update({
      where: { id: claimed.userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        sessionVersion: user.sessionVersion + 1,
        // Only when null. Overwriting an existing stamp would rewrite history
        // for no gain.
        ...(user.emailVerified ? {} : { emailVerified: new Date() }),
      },
    })

    await invalidateTokens(tx, { userId: claimed.userId, purpose: 'password_reset' })
    return { success: true, data: undefined }
  })
}
