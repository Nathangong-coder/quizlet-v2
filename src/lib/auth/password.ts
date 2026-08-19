/**
 * Password hashing and policy.
 *
 * The ONLY module in the app that imports a hashing library. Nothing reachable
 * from `src/auth.config.ts` or `src/middleware.ts` may import this file, even
 * transitively: middleware runs on the edge runtime, which has no native
 * modules and no Node built-ins, and the failure is at REQUEST time — `tsc`
 * and the unit suite both pass straight over it.
 * `tests/auth/edge-safety.test.ts` enforces that.
 */

import bcrypt from 'bcryptjs'

/**
 * Length beats composition rules, which mostly produce `Password1!`. No
 * character-class requirements, deliberately.
 */
export const PASSWORD_MIN_LENGTH = 12

/**
 * bcrypt hashes at most 72 bytes and silently ignores the rest. A 100-byte
 * password and its first 72 bytes therefore hash identically — so rather than
 * let a user believe the tail is protecting them, reject it. Measured in
 * BYTES, not characters: non-ASCII is multi-byte and the truncation is not.
 */
export const PASSWORD_MAX_BYTES = 72

export type PasswordRejection = 'too_short' | 'too_long'

export const PASSWORD_REJECTION_MESSAGES: Record<PasswordRejection, string> = {
  too_short: `Passwords are at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `That password is too long (the limit is ${PASSWORD_MAX_BYTES} bytes).`,
}

export type PasswordCheck = { ok: true } | { ok: false; reason: PasswordRejection }

/**
 * Note what is NOT here: no trimming. A handle is trimmed because surrounding
 * space is never intended; a password's spaces are part of it, and trimming
 * would store something other than what was typed.
 */
export function checkPassword(raw: string): PasswordCheck {
  if (raw.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' }
  if (Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX_BYTES) return { ok: false, reason: 'too_long' }
  return { ok: true }
}

/**
 * Cost factor 12. This is the single number protecting a leaked database, and
 * it is deliberately slow: the cost is paid once per login, which is the
 * operation we want to be expensive.
 */
const BCRYPT_COST = 12

export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, BCRYPT_COST)
}

export async function verifyPassword(raw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(raw, hash)
  } catch {
    // A malformed or truncated hash must fail closed rather than 500 the login
    // route — the outcome is the same as a wrong password.
    return false
  }
}

/**
 * A real cost-12 hash of a fixed string nobody knows.
 *
 * Hardcoded rather than computed at module load: the value never changes, and
 * computing it would spend a full bcrypt round on every cold start.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$xGD2ovOojtjuz/cKokwWROALzJp96FJRTWCBqyOxOe1sfeihsgOAO'

/**
 * Always false, and always slow.
 *
 * Called when no user matched, or when the matched user has no password. A
 * short-circuit `return null` there answers in ~1 ms where a real account takes
 * ~250 ms, which tells an attacker which addresses have accounts without ever
 * showing them a different message.
 */
export async function verifyAgainstDummy(raw: string): Promise<false> {
  await verifyPassword(raw, DUMMY_PASSWORD_HASH)
  return false
}
