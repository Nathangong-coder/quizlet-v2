'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  checkPassword,
  PASSWORD_REJECTION_MESSAGES,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password'
import { invalidateTokens } from '@/lib/auth/tokens'
import type { ActionResult } from '@/types/action'

/**
 * Set or change this account's password.
 *
 * Its own module rather than a fifth function in `account.ts`: that file is
 * deliberately hashing-free, and one action per field is the convention there.
 *
 * Two states, both legitimate forever:
 * - an OAuth-only account setting its FIRST password — nothing to verify;
 * - a password account CHANGING it — the current one is required.
 */
export async function savePassword(input: {
  current?: string
  next: string
}): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const userId = session.user.id

  const policy = checkPassword(input.next)
  if (!policy.ok) return { success: false, error: PASSWORD_REJECTION_MESSAGES[policy.reason] }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, sessionVersion: true, emailVerified: true },
  })
  if (!user) return { success: false, error: 'Account not found' }

  if (user.passwordHash) {
    // Required, not optional. An unattended open session is otherwise enough
    // to take the account permanently, and while /forgot can now recover a
    // forgotten password, it cannot undo a takeover by someone sitting at an
    // open session. This check is that defence.
    if (!input.current) {
      return { success: false, error: 'Enter your current password.' }
    }
    const ok = await verifyPassword(input.current, user.passwordHash)
    if (!ok) return { success: false, error: 'That current password is incorrect.' }
  }

  const passwordHash = await hashPassword(input.next)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        // Invalidates every token already issued for this account, on this
        // device and any other. Under the JWT strategy there is no session row
        // to delete, so without this a password change would not actually lock
        // anyone out — see src/lib/auth/session.ts.
        sessionVersion: user.sessionVersion + 1,
        // A GitHub account created after the verification gate shipped has
        // emailVerified: null; without this, setting a password here would
        // lock the user out of password sign-in immediately. They are
        // demonstrably signed in and in control, and there is no
        // self-registered address to have typo'd.
        ...(user.emailVerified ? {} : { emailVerified: new Date() }),
      },
    })

    // An attacker requests a reset, the owner notices and changes their
    // password from /account — without this, the attacker's emailed link stays
    // live for the rest of the hour.
    await invalidateTokens(tx, { userId, purpose: 'password_reset' })
  })

  // No revalidatePath here, deliberately. sessionVersion just moved past the
  // acting token too — this device is signed out along with every other one,
  // so there is nothing on /account left to revalidate for this caller.
  // Calling it anyway raced the redirect from the now-stale session against
  // the success toast; the panel navigates to /login instead.
  return { success: true, data: undefined }
}
