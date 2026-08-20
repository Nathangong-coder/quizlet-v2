'use server'

import { prisma } from '@/lib/db'
import { checkHandle, HANDLE_REJECTION_MESSAGES } from '@/lib/users/handle'
import {
  checkPassword,
  PASSWORD_REJECTION_MESSAGES,
  hashPassword,
} from '@/lib/auth/password'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import type { ActionResult } from '@/types/action'

/** Shape check only; there is no verification round trip to do better with. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function signUp(input: {
  handle: string
  email: string
  password: string
}): Promise<ActionResult<{ email: string }>> {
  // Checked HERE, not only on the page. A server action is a public endpoint;
  // a page-level guard is a UI affordance, not access control.
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

  try {
    await prisma.user.create({
      data: {
        // Both forms together — checkHandle returns them as a pair precisely so
        // a caller cannot write one and leave the uniqueness key null.
        handle: handle.handle,
        normalizedHandle: handle.normalized,
        email,
        passwordHash: await hashPassword(input.password),
        passwordSetAt: new Date(),
      },
    })
    return { success: true, data: { email } }
  } catch (error) {
    // P2002 covers BOTH unique columns, and the message deliberately does not
    // say which one. "That email is already registered" is a user-enumeration
    // oracle available to anyone who can type an address into a form. The
    // honest alternative — mailing the address owner — needs a mail provider
    // that does not exist (design §7).
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return {
        success: false,
        error: 'Those details can’t be used. Try something different, or sign in instead.',
      }
    }
    console.error('Sign up error:', error)
    return { success: false, error: 'Could not create your account' }
  }
}
