import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { verifyPassword, verifyAgainstDummy } from '@/lib/auth/password'

/**
 * ONE message for every failure — unknown account and wrong password alike.
 *
 * Telling them apart is a user-enumeration oracle, and the usability gain is
 * small: a person who cannot sign in tries the other password either way.
 *
 * The user-facing string (`GENERIC_FAILURE`) is defined once, in
 * `src/components/auth/LoginForm.tsx` — a client component, not here.
 * Importing this module from the browser bundle would drag Prisma in with
 * it, so the constant cannot live here even though this is where the
 * behavior it describes is decided. Keep the two in sync by hand; nothing
 * enforces it.
 */

export interface AuthorizedUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

/**
 * Three outcomes, not two, so the pure function stays testable without booting
 * Auth.js.
 *
 * `rejected` covers unknown account AND wrong password — indistinguishable by
 * design. `unverified` means the password was CORRECT and the address is not
 * verified; see the gate note below for why that is not an oracle.
 */
export type AuthorizeOutcome =
  | { kind: 'ok'; user: AuthorizedUser }
  | { kind: 'rejected' }
  | { kind: 'unverified' }

/**
 * The `authorize` body, extracted from `src/auth.ts` so it can be tested
 * without booting Auth.js.
 */
export async function authorizeCredentials(input: {
  identifier?: unknown
  password?: unknown
}): Promise<AuthorizeOutcome> {
  const identifier = input.identifier
  const password = input.password
  if (typeof identifier !== 'string' || typeof password !== 'string') return { kind: 'rejected' }

  // No early return for identifier === ''. It still issues a DB query, and
  // that is harmless: `email` is non-null so `{ email: '' }` cannot match a
  // real row, and Prisma equality never matches a null `normalizedHandle`, so
  // `{ normalizedHandle: '' }` cannot either — both OR branches miss. Do NOT
  // "optimize" this with an early return: that would reintroduce exactly the
  // fast, no-bcrypt path the dummy compare below exists to close.
  const user = await prisma.user.findFirst({
    where: identifierWhere(identifier),
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      passwordHash: true,
      emailVerified: true,
    },
  })

  // Both misses below run a real bcrypt comparison rather than returning here.
  // See verifyAgainstDummy: an early return is a timing oracle for "does this
  // address have an account", and for "does that account use a password".
  if (!user || !user.passwordHash) {
    return verifyAgainstDummy(password).then(() => ({ kind: 'rejected' }) as const)
  }

  // NOTE: no policy check on sign-in. A password predating a policy change is
  // still that user's password, and rejecting it here would lock them out
  // while reporting "incorrect" — recoverable now that /forgot exists, but
  // still the wrong answer: the user did nothing wrong and the message would
  // not explain what changed.
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return { kind: 'rejected' }

  // THE VERIFICATION GATE, and it lives here and NOWHERE else — which is what
  // keeps GitHub sign-in ungated. An OAuth account with emailVerified: null
  // signs in exactly as it did before this shipped.
  //
  // It is enumeration-safe BECAUSE OF WHEN IT FIRES: only after the password
  // verifies. At that moment the person already knows the account exists and
  // knows its password, so "verify your email" reveals nothing they did not
  // supply. Moving this check any earlier turns it into an oracle.
  if (!user.emailVerified) return { kind: 'unverified' }

  // Deliberately reconstructed field by field: whatever is returned here flows
  // into the JWT pipeline, and spreading `user` would carry passwordHash with it.
  return {
    kind: 'ok',
    user: { id: user.id, email: user.email, name: user.name, image: user.image },
  }
}
