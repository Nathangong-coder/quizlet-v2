'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  checkPassword,
  PASSWORD_REJECTION_MESSAGES,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password'
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

  const policy = checkPassword(input.next)
  if (!policy.ok) return { success: false, error: PASSWORD_REJECTION_MESSAGES[policy.reason] }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true, sessionVersion: true },
  })
  if (!user) return { success: false, error: 'Account not found' }

  if (user.passwordHash) {
    // Required, not optional. An unattended open session is otherwise enough
    // to take the account permanently: there is no password reset to recover
    // it with, so this check is the whole defence.
    if (!input.current) {
      return { success: false, error: 'Enter your current password.' }
    }
    const ok = await verifyPassword(input.current, user.passwordHash)
    if (!ok) return { success: false, error: 'That current password is incorrect.' }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      passwordHash: await hashPassword(input.next),
      passwordSetAt: new Date(),
      // Invalidates every token already issued for this account, on this
      // device and any other. Under the JWT strategy there is no session row to
      // delete, so without this a password change would not actually lock
      // anyone out — see src/lib/auth/session.ts.
      sessionVersion: user.sessionVersion + 1,
    },
  })

  revalidatePath('/account')
  return { success: true, data: undefined }
}
