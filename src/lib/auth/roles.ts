/**
 * The role vocabulary, and the PURE predicates over it.
 *
 * This module imports NOTHING — no Prisma, no `@/auth`. That is deliberate and
 * enforced by tests/auth/edge-safety.test.ts: a client component asks `isStaff`
 * whether to draw a link, and anything heavier here would drag the database
 * client into a bundle that cannot run it.
 *
 * PREDICATES ONLY RENDER; GATES AUTHORIZE. The async gates that resolve a real
 * session live in src/lib/staff/access.ts. Never authorize from a role value a
 * client handed you — authorize from a gate that read the session itself.
 *
 * A String column plus a const, not a Prisma enum — the same choice
 * Card.klpStatus documents. A new member costs no migration, and the const is
 * what stops a typo compiling.
 */
export const USER_ROLES = ['learner', 'staff', 'admin'] as const

export type UserRole = (typeof USER_ROLES)[number]

export const DEFAULT_ROLE: UserRole = 'learner'

export function isKnownRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** Staff or admin. False for anything unrecognised, including undefined. */
export function isStaff(role?: string | null): boolean {
  return role === 'staff' || role === 'admin'
}

/** Admin only. */
export function isAdmin(role?: string | null): boolean {
  return role === 'admin'
}
