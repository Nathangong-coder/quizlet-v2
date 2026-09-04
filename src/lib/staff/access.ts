/**
 * The gates. Predicates render; these authorize.
 *
 * Null covers every failure identically — signed out, learner, unrecognised
 * role — and callers turn all of them into the same `notFound()` or the same
 * 'Not found' ActionResult, following requireSetKltAccess's posture: a
 * distinguishable "forbidden" tells a stranger that a route or a row is real.
 *
 * The role read here came from the database on THIS request (jwtCallback
 * re-reads it every resolution), so there is no second query to make and no
 * second source of truth to drift.
 */
import { auth } from '@/auth'
import { isAdmin, isStaff, isKnownRole, type UserRole } from '@/lib/auth/roles'

export interface StaffSession {
  userId: string
  role: UserRole
}

async function resolve(predicate: (role?: string | null) => boolean): Promise<StaffSession | null> {
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  // An absent id must never pass, however staff-looking the role is.
  if (!userId) return null
  if (!isKnownRole(role)) return null
  if (!predicate(role)) return null
  return { userId, role }
}

/** Read the engine. Staff or admin. */
export function requireStaff(): Promise<StaffSession | null> {
  return resolve(isStaff)
}

/** Grant roles, and everything the old KLT operator allowlist used to gate. Admin only. */
export function requireAdmin(): Promise<StaffSession | null> {
  return resolve(isAdmin)
}
