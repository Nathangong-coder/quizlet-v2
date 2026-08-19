import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { verifyPassword, verifyAgainstDummy } from '@/lib/auth/password'

/**
 * ONE message for every failure — unknown account and wrong password alike.
 *
 * Telling them apart is a user-enumeration oracle, and the usability gain is
 * small: a person who cannot sign in tries the other password either way.
 *
 * (The user-facing string itself lives in the login form, a client
 * component, not here — importing this module from the browser bundle would
 * drag Prisma in with it.)
 */

export interface AuthorizedUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

/**
 * The `authorize` body, extracted from `src/auth.ts` so it can be tested
 * without booting Auth.js.
 *
 * Returns the user or null; it never throws and never explains. Auth.js turns
 * null into a generic `CredentialsSignin` error, which the login form renders
 * as its own generic message.
 */
export async function authorizeCredentials(input: {
  identifier?: unknown
  password?: unknown
}): Promise<AuthorizedUser | null> {
  const identifier = input.identifier
  const password = input.password
  if (typeof identifier !== 'string' || typeof password !== 'string') return null

  const user = await prisma.user.findFirst({
    where: identifierWhere(identifier),
    select: { id: true, email: true, name: true, image: true, passwordHash: true },
  })

  // Both misses below run a real bcrypt comparison rather than returning here.
  // See verifyAgainstDummy: an early return is a timing oracle for "does this
  // address have an account", and for "does that account use a password".
  if (!user || !user.passwordHash) {
    return verifyAgainstDummy(password).then(() => null)
  }

  // NOTE: no policy check on sign-in. A password predating a policy change is
  // still that user's password, and rejecting it here would lock them out
  // while reporting "incorrect" — unrecoverable with no password reset.
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return null

  // Deliberately reconstructed field by field: whatever is returned here flows
  // into the JWT pipeline, and spreading `user` would carry passwordHash with it.
  return { id: user.id, email: user.email, name: user.name, image: user.image }
}
