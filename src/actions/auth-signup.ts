'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { checkHandle, HANDLE_REJECTION_MESSAGES } from '@/lib/users/handle'
import {
  checkPassword,
  PASSWORD_REJECTION_MESSAGES,
  hashPassword,
} from '@/lib/auth/password'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import {
  previewInviteCode,
  redeemInviteCode,
  InviteUnavailableError,
  INVITE_UNAVAILABLE_MESSAGE,
} from '@/lib/invites/redeem'
import { mintToken } from '@/lib/auth/tokens'
import { sendVerificationEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

/** Shape check only; the verification round trip is what actually proves it. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Create an account.
 *
 * THE ORDER OF OPERATIONS BELOW IS LOAD-BEARING, not stylistic:
 *
 *  3. The invite pre-check is a COST FILTER, not the gate. It rejects garbage
 *     before ~250ms of bcrypt, so /signup is not a CPU amplifier.
 *  4. Hashing happens OUTSIDE the transaction. Holding a Postgres transaction
 *     open across a quarter-second of bcrypt is how a serverless app exhausts
 *     its connection pool under any concurrency at all.
 *  5. The transaction is the gate: atomic decrement, then create. A P2002 on
 *     the duplicate email or handle rolls the decrement back, so a typo does
 *     not burn someone's code.
 *  6. Mail happens in after(), so the response time does not distinguish a
 *     duplicate account from a fresh one.
 */
export async function signUp(input: {
  handle: string
  email: string
  password: string
  inviteCode: string
}): Promise<ActionResult<{ email: string }>> {
  // Checked HERE, not only on the page. A server action is a public endpoint;
  // a page-level guard is a UI affordance, not access control. The flag is now
  // a master kill switch rather than the primary control — invite codes are
  // the cap. See src/lib/auth/signup-flag.ts.
  if (!isSignupOpen()) {
    return {
      success: false,
      error: 'Sign-up with a password isn’t open yet. Sign in with GitHub for now.',
    }
  }

  const handle = checkHandle(input.handle)
  if (!handle.ok) return { success: false, error: HANDLE_REJECTION_MESSAGES[handle.reason] }

  const email = input.email.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    return { success: false, error: 'That does not look like an email address.' }
  }

  const password = checkPassword(input.password)
  if (!password.ok) {
    return { success: false, error: PASSWORD_REJECTION_MESSAGES[password.reason] }
  }

  if (!(await previewInviteCode(prisma, input.inviteCode))) {
    return { success: false, error: INVITE_UNAVAILABLE_MESSAGE }
  }

  const passwordHash = await hashPassword(input.password)

  let userId: string
  try {
    const created = await prisma.$transaction(async (tx) => {
      const inviteId = await redeemInviteCode(tx, input.inviteCode)
      return tx.user.create({
        data: {
          // Both forms together — checkHandle returns them as a pair precisely
          // so a caller cannot write one and leave the uniqueness key null.
          handle: handle.handle,
          normalizedHandle: handle.normalized,
          email,
          passwordHash,
          passwordSetAt: new Date(),
          invitedByCodeId: inviteId,
          // Explicit, not merely defaulted: for a credentials account this null
          // is what refuses sign-in until the address is verified.
          emailVerified: null,
        },
        select: { id: true },
      })
    })
    userId = created.id
  } catch (error) {
    if (error instanceof InviteUnavailableError) {
      return { success: false, error: INVITE_UNAVAILABLE_MESSAGE }
    }
    // P2002 covers BOTH unique columns, and the message deliberately does not
    // say which one. "That email is already registered" is a user-enumeration
    // oracle available to anyone who can type an address into a form.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return {
        success: false,
        error: 'Those details can’t be used. Try something different, or sign in instead.',
      }
    }
    console.error('Sign up error:', error)
    return { success: false, error: 'Could not create your account' }
  }

  // Fire and forget: the response is already decided, so the mail's couple of
  // hundred milliseconds are not observable from outside.
  after(async () => {
    const token = await mintToken(prisma, { userId, purpose: 'email_verify' })
    await sendVerificationEmail(email, token)
  })

  return { success: true, data: { email } }
}
