'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { checkHandle, HANDLE_REJECTION_MESSAGES } from '@/lib/users/handle'
import type { ActionResult } from '@/types/action'

export interface AccountSettings {
  /** Display handle, or null if never chosen. */
  handle: string | null
  /** The OAuth account email. Read-only by design — see the schema comment. */
  email: string
  /** Optional "write to me here" address. */
  contactEmail: string | null
  emailUpdates: boolean
  /** Whether a password is set. The hash itself never leaves the server. */
  hasPassword: boolean
}

/**
 * One action PER FIELD, not one `saveAccount` taking a partial object.
 *
 * The four `/settings/ai` panels share a single `LearnerTuning` row and each
 * sends only its own field precisely so that saving one cannot revert the other
 * three — a contract that needed a live gate to prove, because a
 * read-modify-write panel produces the same database row as a correct one right
 * up until two panels are open at once. Separate actions make that failure mode
 * unrepresentable here rather than merely tested for.
 */

export async function getAccountSettings(): Promise<ActionResult<AccountSettings>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        handle: true,
        email: true,
        contactEmail: true,
        emailUpdates: true,
        // Selected as a boolean-producing field, never returned raw: a hash in
        // a server-component payload is a hash on the wire.
        passwordHash: true,
      },
    })
    if (!user) return { success: false, error: 'Account not found' }

    const { passwordHash, ...rest } = user
    return { success: true, data: { ...rest, hasPassword: passwordHash !== null } }
  } catch (error) {
    console.error('Get account settings error:', error)
    return { success: false, error: 'Failed to load your account' }
  }
}

export async function saveHandle(raw: string): Promise<ActionResult<{ handle: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const checked = checkHandle(raw)
  if (!checked.ok) {
    return { success: false, error: HANDLE_REJECTION_MESSAGES[checked.reason] }
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      // BOTH forms, always. `checkHandle` returns them together so this cannot
      // write one without the other and leave the uniqueness key unenforced.
      data: { handle: checked.handle, normalizedHandle: checked.normalized },
    })
    revalidatePath('/account')
    return { success: true, data: { handle: checked.handle } }
  } catch (error) {
    // P2002 is the unique-constraint violation. It is reached in ordinary use,
    // not just under a race: two people simply want the same name. Checking
    // availability with a SELECT first and trusting it would be a TOCTOU bug —
    // the constraint is the only thing that actually decides, so the collision
    // is handled where the database reports it.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'That handle is already taken.' }
    }
    console.error('Save handle error:', error)
    return { success: false, error: 'Failed to save your handle' }
  }
}

/**
 * Shape check only, deliberately.
 *
 * This address is not identity — it cannot recover or take over an account —
 * so it does not need a verification round trip to be edited. `email` above
 * does, which is exactly why the two are separate columns.
 */
const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function saveContactEmail(raw: string): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const value = raw.trim()
  // Empty CLEARS it. A settings field you can set but not unset is a trap, and
  // the column is nullable precisely so "none" is representable.
  if (value.length > 0 && !CONTACT_EMAIL_PATTERN.test(value)) {
    return { success: false, error: 'That does not look like an email address.' }
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { contactEmail: value.length > 0 ? value : null },
    })
    revalidatePath('/account')
    return { success: true, data: undefined }
  } catch (error) {
    console.error('Save contact email error:', error)
    return { success: false, error: 'Failed to save your contact email' }
  }
}

export async function saveEmailUpdates(enabled: boolean): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { emailUpdates: enabled },
    })
    revalidatePath('/account')
    return { success: true, data: undefined }
  } catch (error) {
    console.error('Save email updates error:', error)
    return { success: false, error: 'Failed to save your email preference' }
  }
}
