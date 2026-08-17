/**
 * Handle rules — the public name a creator is credited by.
 *
 * A handle is deliberately NOT `User.name`. That field arrives from the OAuth
 * provider and is usually somebody's real full name; publishing a set must not
 * quietly attach it to a page strangers can browse. See
 * `docs/superpowers/specs/2026-08-17-sharing-collaboration-and-discovery-design.md` §4.
 *
 * Pure and dependency-free, so every rule below is tested without a database.
 */

export const HANDLE_MIN_LENGTH = 3
export const HANDLE_MAX_LENGTH = 30

/**
 * Letters, digits and underscore only.
 *
 * No dots, and no hyphens: a handle is destined for a URL segment, and both
 * invite the confusable-name problem (`alice.ng` vs `alice-ng` vs `aliceng`
 * read as the same person to a human skimming a directory).
 */
const HANDLE_PATTERN = /^[A-Za-z0-9_]+$/

/**
 * Names a handle may never take.
 *
 * Two groups, and BOTH matter. The first is every top-level route in the app:
 * if handles ever become `/{handle}`, a user called `settings` shadows a real
 * page — and the cost of reserving them now is nothing, while the cost of
 * reclaiming one later is taking a name off a person who is using it.
 *
 * The second is names that let someone impersonate the system itself.
 */
export const RESERVED_HANDLES: readonly string[] = [
  // Routes that exist today
  'sets',
  'set',
  'profile',
  'settings',
  'account',
  'api',
  'auth',
  // Routes the roadmap already names
  'browse',
  'learning',
  'learner',
  'login',
  'logout',
  'signin',
  'signup',
  'signout',
  'new',
  'search',
  'explore',
  'help',
  'about',
  'terms',
  'privacy',
  // Impersonation
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'staff',
  'official',
  'quizlet',
  'moderator',
  'mod',
  'null',
  'undefined',
]
// NOTE: `me` was listed here and removed. At HANDLE_MIN_LENGTH 3 it is rejected
// as `too_short` before the reserved check ever runs, so the entry could not
// fire — a dead reservation that reads as protection while providing none. A
// test below pins the invariant: every entry must be a handle that WOULD
// otherwise be valid. If the minimum length ever drops, re-add the short names
// deliberately rather than discovering they were never covered.

/**
 * The uniqueness key.
 *
 * Lowercased, so `Alice` and `alice` cannot both exist and then race for the
 * same URL. Stored in its own column beside the display form, exactly as
 * `CardCategory` carries `normalizedName` beside `name` — a `@unique` on the
 * display form alone does not express this constraint.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase()
}

export type HandleRejection =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'reserved'

export const HANDLE_REJECTION_MESSAGES: Record<HandleRejection, string> = {
  empty: 'Choose a handle.',
  too_short: `Handles are at least ${HANDLE_MIN_LENGTH} characters.`,
  too_long: `Handles are at most ${HANDLE_MAX_LENGTH} characters.`,
  invalid_characters: 'Use letters, numbers and underscores only.',
  reserved: 'That handle is reserved. Please pick another.',
}

export type HandleCheck =
  | { ok: true; handle: string; normalized: string }
  | { ok: false; reason: HandleRejection }

/**
 * Validate a handle a user typed.
 *
 * Returns BOTH forms on success so a caller cannot persist one without the
 * other — writing `handle` and forgetting `normalizedHandle` would leave the
 * uniqueness constraint unenforced for that row, which is precisely the kind of
 * gap that only shows up once two people have collided.
 *
 * Order matters: length is checked before characters so that "ab" is reported
 * as too short rather than being silently fine on characters and then rejected
 * for a different reason on the next attempt.
 */
export function checkHandle(raw: string): HandleCheck {
  const handle = raw.trim()
  if (handle.length === 0) return { ok: false, reason: 'empty' }
  if (handle.length < HANDLE_MIN_LENGTH) return { ok: false, reason: 'too_short' }
  if (handle.length > HANDLE_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  if (!HANDLE_PATTERN.test(handle)) return { ok: false, reason: 'invalid_characters' }

  const normalized = normalizeHandle(handle)
  // Compared against the NORMALIZED form: `Admin` and `ADMIN` are the same
  // reservation, and a case-sensitive list would let both through.
  if (RESERVED_HANDLES.includes(normalized)) return { ok: false, reason: 'reserved' }

  return { ok: true, handle, normalized }
}
