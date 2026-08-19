# Credentials auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign up and sign in with a username/email and password, alongside the existing GitHub OAuth, with sign-up gated behind an env flag until password reset exists.

**Architecture:** The Credentials provider lives in `src/auth.ts` (Node runtime) and **never** in `src/auth.config.ts`, which `src/middleware.ts` bundles into the edge runtime. Hashing is `bcryptjs` at cost 12 behind a pure-ish module (`src/lib/auth/password.ts`); the `authorize` body and the session callbacks are extracted into their own modules so they can be unit-tested without booting Auth.js. JWT sessions are made revocable by a `User.sessionVersion` column compared on every session resolution.

**Tech Stack:** Next.js 16 App Router, `next-auth@5.0.0-beta.31`, `@auth/prisma-adapter`, Prisma 7 + Neon adapter, `bcryptjs`, Vitest, Tailwind + shadcn-style `@/components/ui/*`.

**Spec:** `docs/superpowers/specs/2026-08-17-credentials-auth-design.md` — read it before Task 1, especially §2 (the edge trap) and §8 (the six anticipated defects). This plan argues from it.

**Queue context:** `docs/superpowers/BUILD-QUEUE.md` item **6e**. Branch: `spec3b-tunable-scoring` (the user chose to keep building on it rather than merge first, 2026-08-18).

## Global Constraints

- **The Credentials provider goes in `src/auth.ts` ONLY.** Adding it to `src/auth.config.ts` bundles a hashing library into edge middleware and breaks every protected route at request time — invisible to `tsc` and to the unit suite. Spec §2.
- **Hashing is `bcryptjs`, cost factor 12.** Not native `bcrypt`, not argon2 — this codebase has no native dependencies and Vercel's build trips over compile steps. Spec §3.
- **Password policy: minimum 12 characters, maximum 72 bytes, no composition rules.** Spec §3. (The 72-byte ceiling is bcrypt's silent truncation point, added by this plan — see Task 2.)
- **One error message for every sign-in failure:** `"Email or password is incorrect."` Distinguishing "no such account" from "wrong password" is a user-enumeration oracle. Spec §3.
- **Always run a bcrypt comparison, even when the user does not exist** — compare against a fixed dummy hash. A short-circuit `return null` answers in ~1 ms where a real account takes ~250 ms, which is a timing oracle. Spec §3.
- **Uniqueness is decided by the P2002 constraint violation, never a pre-flight `SELECT`.** Same TOCTOU argument as `saveHandle` in item 6d. Spec §4.
- **Never auto-link an OAuth login to a matching email.** Keep Auth.js's `OAuthAccountNotLinked` refusal; explain it in copy instead. Spec §4/§7.
- **Sign-up ships behind a flag, off by default** (`CREDENTIALS_SIGNUP_ENABLED`). Decided with the user 2026-08-18, resolving spec §10. **Sign-IN is never gated** — that is what closes trap 6, and a seeded dev account must be able to log in with the flag off.
- **Handle rules are imported from `src/lib/users/handle.ts`, never re-derived.** Spec §4.
- Environment traps that apply throughout, from `docs/superpowers/BUILD-QUEUE.md`:
  - Verify with `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` and `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"` (trap 2).
  - `prisma migrate dev` needs a TTY and cannot be run from an agent shell — generate the SQL and `migrate deploy` it (trap 5, spelled out in Task 1).
  - Every `*.test.tsx` needs `// @vitest-environment jsdom` as its **literal first line** and must call `afterEach(cleanup)` itself (trap 9).
  - A client component that imports a server action kills every jsdom test that renders it — mock the action module (trap 7).
- **Baselines to compare against** (branch `spec3b-tunable-scoring`, after item 6f): 116 test files / **1412 passing**, `tsc` clean, `next build` clean, lint **176 problems**. Do not fix unrelated lint.

## File Structure

**New — library (each file one responsibility, all unit-testable without Auth.js):**

| File | Responsibility |
| --- | --- |
| `src/lib/auth/password.ts` | Hash, verify, dummy-compare, policy check. The **only** file importing `bcryptjs`. |
| `src/lib/auth/identifier.ts` | Pure: turn a typed identifier into a Prisma `where` matching email **or** handle. No bcrypt import, so it stays edge-safe and trivially testable. |
| `src/lib/auth/credentials.ts` | The `authorize` body: lookup → dummy-or-real compare → user or null. Takes no Auth.js types. |
| `src/lib/auth/session.ts` | `jwtCallback` / `sessionCallback`, carrying `sessionVersion`. Extracted so revocation is testable. |
| `src/lib/auth/signup-flag.ts` | `isSignupOpen()` — reads `CREDENTIALS_SIGNUP_ENABLED`. |

**New — actions, pages, components, script:**

| File | Responsibility |
| --- | --- |
| `src/actions/auth-signup.ts` | `signUp()` — flag check, validation, create user. |
| `src/actions/password.ts` | `savePassword()` — set or change a password, bump `sessionVersion`. Kept out of `account.ts` so hashing never enters that module. |
| `src/app/signup/page.tsx` | Server page: flag gate + render form. |
| `src/app/login/page.tsx` | Server page: reads `?error=` and `?callbackUrl=`, renders form. |
| `src/components/auth/SignUpForm.tsx` | Client form. |
| `src/components/auth/LoginForm.tsx` | Client form + error copy incl. `OAuthAccountNotLinked`. |
| `src/components/account/PasswordPanel.tsx` | "Set a password" / "Change password" panel. |
| `scripts/seed-dev-user.ts` | Dev-only seeded account — the piece that ends the human-gate bottleneck. |

**Modified:** `prisma/schema.prisma`, `src/auth.ts`, `src/auth.config.ts` (only `pages.signIn`), `src/middleware.ts`, `src/app/sets/[id]/review/page.tsx`, `src/app/account/page.tsx`, `src/components/Navbar.tsx`, `package.json`, `.env.example`, `CLAUDE.md`, `docs/superpowers/BUILD-QUEUE.md`.

**Tests:** `tests/auth/password.test.ts`, `tests/auth/identifier.test.ts`, `tests/auth/credentials-authorize.test.ts`, `tests/auth/session-version.test.ts`, `tests/auth/edge-safety.test.ts`, `tests/actions/signup.test.ts`, `tests/actions/password.test.ts`, `tests/components/LoginForm.test.tsx`, `tests/components/SignUpForm.test.tsx`.

---

### Task 1: Schema — `passwordHash`, `passwordSetAt`, `sessionVersion`

**Files:**
- Modify: `prisma/schema.prisma` (the `User` model, after the `emailUpdates` block around line 40)
- Create: `prisma/migrations/20260818000000_user_password_credentials/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `User.passwordHash: string | null`, `User.passwordSetAt: Date | null`, `User.sessionVersion: number` (default `0`, non-null).

- [ ] **Step 1: Add the three columns to the `User` model**

In `prisma/schema.prisma`, immediately after the `emailUpdates Boolean @default(false)` line:

```prisma
  /// bcrypt hash of the user's password, or null for an OAuth-only account.
  ///
  /// Nullable PERMANENTLY, not as a migration step. An account created through
  /// GitHub has no password and never needs one; an account created with a
  /// password may later link GitHub. Both states are legitimate forever, so
  /// code must never treat null as "not migrated yet".
  passwordHash     String?
  /// When the password was last set or changed. Displayed on /account; also the
  /// only record that a credentials account exists at all.
  passwordSetAt    DateTime?

  /// Bumped to invalidate every outstanding JWT for this user.
  ///
  /// Sessions are JWT (see src/auth.ts), which means there is no session row to
  /// delete — a token stays valid until it expires. Without this column
  /// "change my password" would not sign out an attacker already holding one,
  /// i.e. it would be theatre. The value is embedded in the token and compared
  /// on every session resolution; see src/lib/auth/session.ts.
  sessionVersion   Int               @default(0)
```

- [ ] **Step 2: Generate the migration SQL**

`prisma migrate dev` needs a TTY and cannot run from an agent shell (trap 5). Generate the script instead:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Expected output (exactly these three columns; if anything else appears, the schema has drifted and that must be resolved first):

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordSetAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Write it to a migration directory and apply it**

```bash
mkdir -p prisma/migrations/20260818000000_user_password_credentials
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/20260818000000_user_password_credentials/migration.sql
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Verify zero residual drift**

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Expected: `-- This is an empty migration.` Anything else means the applied migration does not match the schema.

- [ ] **Step 5: Verify the client picked up the fields**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(auth): password and session-version columns on User"
```

---

### Task 2: `src/lib/auth/password.ts` — hashing, verification, policy

**Files:**
- Create: `src/lib/auth/password.ts`
- Create: `tests/auth/password.test.ts`
- Modify: `package.json` (dependency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PASSWORD_MIN_LENGTH: 12`, `PASSWORD_MAX_BYTES: 72`
  - `type PasswordRejection = 'too_short' | 'too_long'`
  - `PASSWORD_REJECTION_MESSAGES: Record<PasswordRejection, string>`
  - `checkPassword(raw: string): { ok: true } | { ok: false; reason: PasswordRejection }`
  - `hashPassword(raw: string): Promise<string>`
  - `verifyPassword(raw: string, hash: string): Promise<boolean>`
  - `verifyAgainstDummy(raw: string): Promise<false>` — always false, always pays the bcrypt cost
  - `DUMMY_PASSWORD_HASH: string`

- [ ] **Step 1: Install bcryptjs**

```bash
npm install bcryptjs
```

Then check whether it ships its own types:

```bash
ls node_modules/bcryptjs/*.d.ts node_modules/bcryptjs/types.d.ts 2>/dev/null
```

If that lists nothing, also run `npm install --save-dev @types/bcryptjs`. (bcryptjs 3.x bundles types; 2.x does not.)

- [ ] **Step 2: Generate the dummy hash constant**

The dummy hash must be a **real** cost-12 bcrypt hash, so comparing against it costs the same as comparing against a real one. Generate it once and paste the literal — computing it at module load would spend ~250 ms on every cold start for a value that never changes:

```bash
node -e "const b=require('bcryptjs'); b.hash('dummy-password-for-timing-equalisation', 12).then(h=>console.log(h))"
```

(If bcryptjs 3.x resists `require` under this project's module settings, use `npx tsx -e "import bcrypt from 'bcryptjs'; bcrypt.hash('dummy-password-for-timing-equalisation', 12).then(console.log)"` instead.)

Copy the printed `$2b$12$…` string into Step 4's `DUMMY_PASSWORD_HASH`.

- [ ] **Step 3: Write the failing tests**

Create `tests/auth/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  checkPassword,
  hashPassword,
  verifyPassword,
  verifyAgainstDummy,
  DUMMY_PASSWORD_HASH,
} from '@/lib/auth/password'

describe('checkPassword', () => {
  it('accepts a password at exactly the minimum length', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH))).toEqual({ ok: true })
  })

  it('rejects one character below the minimum', () => {
    // The boundary is asserted from BOTH sides so an off-by-one in the
    // comparison operator cannot pass.
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      ok: false,
      reason: 'too_short',
    })
  })

  it('rejects a password longer than 72 BYTES, not 72 characters', () => {
    // bcrypt silently truncates past 72 bytes: two different long passwords
    // then hash identically, so accepting them would mean the extra
    // characters are security theatre. Emoji are 4 bytes each, so 20 of them
    // are 80 bytes in 20 characters.
    const emoji = '🔐'.repeat(20)
    expect(emoji.length).toBeLessThan(PASSWORD_MAX_BYTES)
    expect(Buffer.byteLength(emoji, 'utf8')).toBeGreaterThan(PASSWORD_MAX_BYTES)
    expect(checkPassword(emoji)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('accepts a 72-byte password', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MAX_BYTES))).toEqual({ ok: true })
  })

  it('does NOT trim — leading and trailing spaces are part of the password', () => {
    // Handles are trimmed; passwords must not be. Trimming would silently
    // change what the user typed and make a stored password unenterable.
    const padded = '  ' + 'a'.repeat(PASSWORD_MIN_LENGTH) + '  '
    expect(checkPassword(padded)).toEqual({ ok: true })
  })
})

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  }, 20_000)

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
  }, 20_000)

  it('never returns the password in the hash, and uses cost 12', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toContain('correct')
    // The cost factor is the whole defence for a leaked database. A silent
    // drop to the library default (10) is 4x cheaper to crack and is
    // invisible to every other test here.
    expect(hash.slice(0, 7)).toMatch(/^\$2[aby]\$12$/)
  }, 20_000)

  it('produces a different hash for the same password each time (salted)', async () => {
    const a = await hashPassword('correct horse battery staple')
    const b = await hashPassword('correct horse battery staple')
    expect(a).not.toBe(b)
  }, 30_000)

  it('returns false rather than throwing on a malformed hash', async () => {
    // A row with a corrupt or truncated hash must fail closed, not 500 the
    // login route.
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false)
  })
})

describe('DUMMY_PASSWORD_HASH', () => {
  it('is a real cost-12 hash, so comparing against it costs what a real one costs', () => {
    // If this were a placeholder string, bcrypt would reject it instantly and
    // the timing-equalisation in verifyAgainstDummy would protect nothing.
    expect(DUMMY_PASSWORD_HASH.slice(0, 7)).toMatch(/^\$2[aby]\$12$/)
    expect(DUMMY_PASSWORD_HASH.length).toBe(60)
  })

  it('verifyAgainstDummy is always false, whatever it is given', async () => {
    expect(await verifyAgainstDummy('')).toBe(false)
    expect(await verifyAgainstDummy('dummy-password-for-timing-equalisation')).toBe(false)
  }, 20_000)
})
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
npx vitest run tests/auth/password.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/auth/password"`.

- [ ] **Step 5: Write the implementation**

Create `src/lib/auth/password.ts` (paste your generated hash from Step 2 into `DUMMY_PASSWORD_HASH`):

```ts
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
export const DUMMY_PASSWORD_HASH = '$2b$12$REPLACE_WITH_GENERATED_HASH'

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
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run tests/auth/password.test.ts
```

Expected: PASS, all cases. If `DUMMY_PASSWORD_HASH` still contains `REPLACE_WITH_GENERATED_HASH`, the length and prefix assertions will fail — go back to Step 2.

- [ ] **Step 7: Mutation-test the two rules that matter**

This repo's convention is to prove a guard can fail. Introduce each mutant, confirm the suite reddens, then revert:

1. `BCRYPT_COST = 10` → the cost-12 assertion must fail.
2. `verifyAgainstDummy` returning `false` **without** awaiting the comparison → no test fails. **That is expected and is the point:** timing is not observable from a unit test. Record it in the commit message as a known-unguarded property whose only defence is the code comment, rather than pretending it is covered.
3. `Buffer.byteLength(raw, 'utf8')` → `raw.length` → the emoji test must fail.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/password.ts tests/auth/password.test.ts package.json package-lock.json
git commit -m "feat(auth): bcrypt hashing, password policy and a timing-equalising dummy compare"
```

---

### Task 3: `authorize` — email-or-handle lookup and the generic failure

**Files:**
- Create: `src/lib/auth/identifier.ts`
- Create: `src/lib/auth/credentials.ts`
- Create: `tests/auth/identifier.test.ts`
- Create: `tests/auth/credentials-authorize.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `verifyAgainstDummy` from `@/lib/auth/password`; `normalizeHandle` from `@/lib/users/handle`.
- Produces:
  - `identifierWhere(raw: string): { OR: Array<{ email: string } | { normalizedHandle: string }> }` from `@/lib/auth/identifier`
  - `CREDENTIALS_FAILURE_MESSAGE: 'Email or password is incorrect.'`
  - `authorizeCredentials(input: { identifier?: unknown; password?: unknown }): Promise<{ id: string; email: string; name: string | null; image: string | null } | null>` from `@/lib/auth/credentials`

- [ ] **Step 1: Write the failing test for the identifier lookup**

Create `tests/auth/identifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { identifierWhere } from '@/lib/auth/identifier'

describe('identifierWhere', () => {
  it('matches an email case-insensitively by lowercasing it', () => {
    // Email is stored as the provider gave it; a user typing Alice@X.com must
    // still sign in. Lowercasing the needle is the cheap half of that.
    expect(identifierWhere('Alice@Example.com')).toEqual({
      OR: [{ email: 'alice@example.com' }, { normalizedHandle: 'alice@example.com' }],
    })
  })

  it('matches a handle through normalizedHandle, not handle', () => {
    // `handle` is the display form. Querying it would make `Alice_NG` and
    // `alice_ng` different logins for one account.
    const where = identifierWhere('Alice_NG')
    expect(where.OR).toContainEqual({ normalizedHandle: 'alice_ng' })
    expect(JSON.stringify(where)).not.toContain('"handle"')
  })

  it('trims surrounding whitespace', () => {
    expect(identifierWhere('  alice  ')).toEqual({
      OR: [{ email: 'alice' }, { normalizedHandle: 'alice' }],
    })
  })

  it('never produces an empty OR branch, which would match every row', () => {
    // A `where` of `{}` or `{ OR: [] }` behaves as "any user" in Prisma for
    // findFirst — an empty identifier must not become a login as somebody.
    const where = identifierWhere('')
    expect(where.OR).toEqual([{ email: '' }, { normalizedHandle: '' }])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/auth/identifier.test.ts
```

Expected: FAIL — cannot resolve `@/lib/auth/identifier`.

- [ ] **Step 3: Implement the identifier lookup**

Create `src/lib/auth/identifier.ts`:

```ts
import { normalizeHandle } from '@/lib/users/handle'

/**
 * Accept EITHER an email or a handle in the one sign-in field.
 *
 * Costs one extra `OR` branch and removes the most common login failure —
 * "which one did I use?". There is no ambiguity to resolve: a handle cannot
 * contain `@` (see HANDLE_PATTERN), so the two branches can never both match
 * different users.
 *
 * Pure and bcrypt-free on purpose, so it can be tested without hashing and
 * stays safe to import from anywhere.
 */
export function identifierWhere(raw: string) {
  const needle = normalizeHandle(raw)
  return { OR: [{ email: needle }, { normalizedHandle: needle }] }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/auth/identifier.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing tests for `authorizeCredentials`**

Create `tests/auth/credentials-authorize.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  verifyPassword: vi.fn(),
  verifyAgainstDummy: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ prisma: { user: { findFirst: h.findFirst } } }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, verifyPassword: h.verifyPassword, verifyAgainstDummy: h.verifyAgainstDummy }
})

import { authorizeCredentials } from '@/lib/auth/credentials'

const USER = {
  id: 'u1',
  email: 'alice@example.com',
  name: 'Alice',
  image: null,
  passwordHash: '$2b$12$hash',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.verifyAgainstDummy.mockResolvedValue(false)
})

describe('authorizeCredentials', () => {
  it('returns the user when the password verifies', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).toEqual({ id: 'u1', email: 'alice@example.com', name: 'Alice', image: null })
  })

  it('NEVER returns the password hash to Auth.js', async () => {
    // Whatever this returns is what lands in the JWT-building pipeline.
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).not.toHaveProperty('passwordHash')
  })

  it('returns null on a wrong password', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(false)

    expect(await authorizeCredentials({ identifier: 'alice', password: 'wrongwrongwrong' })).toBeNull()
  })

  it('runs a dummy comparison when no user matches, instead of returning early', async () => {
    // The defect this closes: an early return answers in ~1ms where a real
    // account takes ~250ms, which tells an attacker which addresses exist.
    h.findFirst.mockResolvedValue(null)

    const result = await authorizeCredentials({ identifier: 'nobody', password: 'a'.repeat(12) })

    expect(result).toBeNull()
    expect(h.verifyAgainstDummy).toHaveBeenCalledWith('a'.repeat(12))
  })

  it('runs a dummy comparison for an OAuth-only account with no password', async () => {
    // Same oracle, different route: a GitHub user has passwordHash null, and
    // returning early there leaks that the address is registered.
    h.findFirst.mockResolvedValue({ ...USER, passwordHash: null })

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).toBeNull()
    expect(h.verifyAgainstDummy).toHaveBeenCalled()
    expect(h.verifyPassword).not.toHaveBeenCalled()
  })

  it('rejects non-string input without touching the database', async () => {
    expect(await authorizeCredentials({ identifier: undefined, password: 'a'.repeat(12) })).toBeNull()
    expect(await authorizeCredentials({ identifier: 'alice', password: 123 })).toBeNull()
    expect(h.findFirst).not.toHaveBeenCalled()
  })

  it('queries by email OR normalizedHandle, and selects no other user', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    await authorizeCredentials({ identifier: 'Alice@Example.com', password: 'a'.repeat(12) })

    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'alice@example.com' }, { normalizedHandle: 'alice@example.com' }],
    })
  })

  it('does not apply the sign-up length policy to sign-in', async () => {
    // A password shorter than today's minimum may already exist (the policy
    // can change). Rejecting it here would lock those accounts out while
    // reporting "incorrect", which is unrecoverable without password reset.
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'short' })

    expect(result).not.toBeNull()
  })
})
```

- [ ] **Step 6: Run them and watch them fail**

```bash
npx vitest run tests/auth/credentials-authorize.test.ts
```

Expected: FAIL — cannot resolve `@/lib/auth/credentials`.

- [ ] **Step 7: Implement `authorizeCredentials`**

Create `src/lib/auth/credentials.ts`:

```ts
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { verifyPassword, verifyAgainstDummy } from '@/lib/auth/password'

/**
 * ONE message for every failure — unknown account and wrong password alike.
 *
 * Telling them apart is a user-enumeration oracle, and the usability gain is
 * small: a person who cannot sign in tries the other password either way.
 */
export const CREDENTIALS_FAILURE_MESSAGE = 'Email or password is incorrect.'

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
 * as CREDENTIALS_FAILURE_MESSAGE.
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
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run tests/auth/credentials-authorize.test.ts tests/auth/identifier.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 9: Mutation-test the enumeration guards**

Introduce each, confirm a test reddens, revert:

1. `if (!user || !user.passwordHash) return null` (drop the dummy compare) → the two "runs a dummy comparison" tests must fail.
2. `return { ...user }` instead of the field-by-field object → the "NEVER returns the password hash" test must fail.
3. `identifierWhere` querying `{ handle: needle }` instead of `normalizedHandle` → the query-shape test must fail.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth/identifier.ts src/lib/auth/credentials.ts tests/auth/identifier.test.ts tests/auth/credentials-authorize.test.ts
git commit -m "feat(auth): authorize by email or handle, failing identically on every miss"
```

---

### Task 4: Wire the provider into `auth.ts` only, with revocable sessions

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `tests/auth/session-version.test.ts`
- Create: `tests/auth/edge-safety.test.ts`
- Modify: `src/auth.ts`

No `next-auth.d.ts` augmentation is needed: v5's default `Session["user"]` already carries `id`, which is why the existing `session.user.id = token.sub` compiles today. If `tsc` disagrees after the wiring, add `src/types/next-auth.d.ts` rather than casting.

**Interfaces:**
- Consumes: `authorizeCredentials` (Task 3).
- Produces: `jwtCallback`, `sessionCallback`, `SESSION_VERSION_CLAIM` from `@/lib/auth/session`; a working `signIn('credentials', …)`.

- [ ] **Step 1: Write the failing tests for the session callbacks**

Create `tests/auth/session-version.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.findUnique } } }))

import { jwtCallback, sessionCallback } from '@/lib/auth/session'

beforeEach(() => vi.clearAllMocks())

describe('jwtCallback on sign-in', () => {
  it('stamps the id and the current sessionVersion onto the token', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 3 })

    const token = await jwtCallback({ token: {}, user: { id: 'u1' } })

    expect(token).toMatchObject({ sub: 'u1', sv: 3 })
  })

  it('reads the version from the database rather than trusting the user object', async () => {
    // The `user` argument comes from an adapter or a provider and is not
    // guaranteed to carry every column. Reading it here — once, at sign-in —
    // is what makes the comparison below meaningful.
    h.findUnique.mockResolvedValue({ sessionVersion: 7 })

    const token = await jwtCallback({ token: {}, user: { id: 'u1', sessionVersion: 0 } })

    expect(token).toMatchObject({ sv: 7 })
  })
})

describe('jwtCallback on a later request', () => {
  it('keeps the token when the version still matches', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 3 })

    const token = await jwtCallback({ token: { sub: 'u1', sv: 3 } })

    expect(token).toMatchObject({ sub: 'u1', sv: 3 })
  })

  it('INVALIDATES the token when the stored version has moved on', async () => {
    // This is the whole point of the column. Without it, "change my password"
    // does not sign out an attacker already holding a token — there is no
    // session row to delete under the JWT strategy.
    h.findUnique.mockResolvedValue({ sessionVersion: 4 })

    expect(await jwtCallback({ token: { sub: 'u1', sv: 3 } })).toBeNull()
  })

  it('invalidates a token whose user no longer exists', async () => {
    h.findUnique.mockResolvedValue(null)

    expect(await jwtCallback({ token: { sub: 'u1', sv: 3 } })).toBeNull()
  })

  it('invalidates a token carrying no version claim at all', async () => {
    // Tokens issued before this shipped have no `sv`. Treating "absent" as
    // "matches" would leave every pre-existing token permanently unrevokable,
    // which is exactly the state this exists to end.
    h.findUnique.mockResolvedValue({ sessionVersion: 0 })

    expect(await jwtCallback({ token: { sub: 'u1' } })).toBeNull()
  })

  it('invalidates a token with no subject without querying', async () => {
    expect(await jwtCallback({ token: {} })).toBeNull()
    expect(h.findUnique).not.toHaveBeenCalled()
  })
})

describe('sessionCallback', () => {
  it('copies the token subject onto session.user.id', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'Alice' } },
      token: { sub: 'u1', sv: 1 },
    })

    expect(session.user.id).toBe('u1')
  })

  it('does not leak the version claim into the client-visible session', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'Alice' } },
      token: { sub: 'u1', sv: 1 },
    })

    expect(JSON.stringify(session)).not.toContain('"sv"')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run tests/auth/session-version.test.ts
```

Expected: FAIL — cannot resolve `@/lib/auth/session`.

- [ ] **Step 3: Implement the callbacks**

Create `src/lib/auth/session.ts`:

```ts
import { prisma } from '@/lib/db'

/**
 * The token claim holding `User.sessionVersion`.
 *
 * Short because it rides in every request's cookie.
 */
export const SESSION_VERSION_CLAIM = 'sv' as const

type TokenLike = { sub?: string; [SESSION_VERSION_CLAIM]?: number; [key: string]: unknown }

/**
 * Revocation for a strategy that has none.
 *
 * Sessions are JWT (`src/auth.ts`), so there is no row to delete: a stolen or
 * stale token stays valid until it expires. Every resolution therefore
 * re-reads the user's `sessionVersion` and drops the token if it has moved.
 *
 * The cost is one primary-key lookup per session resolution. That was accepted
 * rather than optimised with a TTL claim, because a server component cannot
 * set cookies — so a "last checked at" stamp written here would frequently
 * fail to persist, and the optimisation would be unreliable in exactly the
 * places it was meant to help. Correct and predictable beats clever here.
 *
 * NOTE ON MIDDLEWARE: `src/middleware.ts` builds its own Auth.js instance from
 * `authConfig`, which does NOT carry these callbacks — it cannot, since Prisma
 * does not run on the edge. Middleware therefore accepts a revoked-but-unexpired
 * token for its is-signed-in check; every page, action and route that calls
 * `auth()` still rejects it. Revocation is enforced where data is reached, not
 * at the redirect.
 */
export async function jwtCallback({
  token,
  user,
}: {
  token: TokenLike
  user?: { id?: string } | null
}): Promise<TokenLike | null> {
  if (user?.id) {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { sessionVersion: true },
    })
    // Read from the database rather than from `user`: the argument's shape
    // depends on the provider and adapter, and a missing field would silently
    // stamp `undefined`.
    return { ...token, sub: user.id, [SESSION_VERSION_CLAIM]: row?.sessionVersion ?? 0 }
  }

  if (!token.sub) return null

  const current = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { sessionVersion: true },
  })
  if (!current) return null

  // Strict equality, so an ABSENT claim invalidates. Tokens issued before this
  // shipped carry no `sv`; treating absent as "fine" would leave every one of
  // them permanently unrevokable.
  if (token[SESSION_VERSION_CLAIM] !== current.sessionVersion) return null

  return token
}

export async function sessionCallback({
  session,
  token,
}: {
  session: { user?: { id?: string } & Record<string, unknown> } & Record<string, unknown>
  token: TokenLike
}) {
  if (session.user && token.sub) {
    session.user.id = token.sub
  }
  // `sv` is deliberately not copied across: it is a revocation mechanism, not
  // information the browser has any use for.
  return session
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/auth/session-version.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the provider and callbacks into `src/auth.ts`**

Replace `src/auth.ts` entirely:

```ts
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"
import { authConfig } from "@/auth.config"
import { authorizeCredentials } from "@/lib/auth/credentials"
import { jwtCallback, sessionCallback } from "@/lib/auth/session"

/**
 * The NODE-runtime half of auth. The Credentials provider lives HERE and
 * nowhere else.
 *
 * `src/auth.config.ts` is the edge-safe half: `src/middleware.ts` bundles it
 * for the edge runtime, which has no native modules and no Node built-ins.
 * Adding Credentials there would pull bcrypt into that bundle and break every
 * protected route at REQUEST time — with no type error and no failing test.
 * `tests/auth/edge-safety.test.ts` is what keeps that from happening quietly.
 *
 * Providers are MERGED, not replaced: GitHub keeps working.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      // `credentials` is declared only so Auth.js knows the field names; the
      // built-in sign-in page is not used (pages.signIn points at /login).
      credentials: {
        identifier: { label: "Email or handle", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: (raw) => authorizeCredentials(raw ?? {}),
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
})
```

If `tsc` complains about the callback parameter types, adapt the *call site* by widening `jwtCallback`/`sessionCallback` parameter types in `src/lib/auth/session.ts` — do **not** cast the callbacks to `any`, which would defeat the type checking that catches a mis-shaped token.

- [ ] **Step 6: Type-check the wiring**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```

Expected: no output. If `jwt` returning `null` is rejected by the installed `next-auth` beta's types, that is a real finding — record it and fall back to returning a token with `sub` deleted, plus a `sessionCallback` that returns a session with no `user.id`; update the tests to match the fallback rather than weakening the invalidation.

- [ ] **Step 7: Write the edge-safety guard**

Create `tests/auth/edge-safety.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = process.cwd()

/**
 * Modules that must never reach the edge bundle.
 *
 * bcrypt and friends because the edge runtime has no native modules; Prisma
 * because it does not run there either; `@/auth` because importing it from the
 * edge half would drag the whole Node graph across in one line.
 */
const FORBIDDEN = [
  'bcryptjs',
  'bcrypt',
  'argon2',
  '@node-rs/argon2',
  '@prisma/client',
  '@/lib/db',
  '@/auth',
  '@/lib/auth/password',
  '@/lib/auth/credentials',
  '@/lib/auth/session',
]

/** The two entry points that are bundled for the edge runtime. */
const EDGE_ENTRY_POINTS = ['src/auth.config.ts', 'src/middleware.ts']

function readImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []
  const pattern = /(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1])
  return specifiers
}

/** Resolve a specifier to a file in this repo, or null if it is a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Every specifier reachable from `entry`, following local files transitively. */
function transitiveImports(entry: string): { specifier: string; via: string }[] {
  const seen = new Set<string>()
  const found: { specifier: string; via: string }[] = []
  const queue = [join(ROOT, entry)]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const specifier of readImports(file)) {
      found.push({ specifier, via: file })
      const local = resolveLocal(specifier, file)
      if (local) queue.push(local)
    }
  }
  return found
}

describe('the edge bundle', () => {
  // Transitive, not a text search of the two files. A one-line re-export is
  // all it takes to pull bcrypt into middleware, and the failure is at request
  // time in production: `tsc` and every other test pass straight over it.
  // Same class of invisible failure as trap 8's $queryRaw.
  it.each(EDGE_ENTRY_POINTS)('%s reaches no Node-only module, at any depth', (entry) => {
    const reached = transitiveImports(entry)
    const violations = reached.filter((r) => FORBIDDEN.includes(r.specifier))
    expect(violations).toEqual([])
  })

  it('actually walks past the entry point (the guard can fail)', () => {
    // Without this, a broken resolver would make the assertion above vacuous:
    // it would scan one file, find nothing, and pass forever.
    const reached = transitiveImports('src/middleware.ts')
    expect(reached.map((r) => r.specifier)).toContain('@/auth.config')
    expect(reached.some((r) => r.via.endsWith('auth.config.ts'))).toBe(true)
  })

  it('the Credentials provider is wired in src/auth.ts, not auth.config.ts', () => {
    const nodeHalf = readFileSync(join(ROOT, 'src/auth.ts'), 'utf8')
    const edgeHalf = readFileSync(join(ROOT, 'src/auth.config.ts'), 'utf8')
    expect(nodeHalf).toContain('next-auth/providers/credentials')
    expect(edgeHalf).not.toContain('credentials')
  })
})
```

- [ ] **Step 8: Run the guard**

```bash
npx vitest run tests/auth/edge-safety.test.ts
```

Expected: PASS.

- [ ] **Step 9: Prove the guard can fail**

Temporarily add `import { hashPassword } from '@/lib/auth/password'` to `src/auth.config.ts` and run the guard again.

Expected: FAIL, naming `src/auth.config.ts`. Then add it instead to a module `auth.config.ts` imports (create a throwaway `src/lib/auth/_probe.ts` importing bcryptjs, import that from `auth.config.ts`) and confirm it **still** fails — that is the transitive case, and it is the one a plain text search would miss. Revert both probes.

- [ ] **Step 10: Full suite + build**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx next build
```

Expected: all tests pass (1412 + the new ones); build clean.

- [ ] **Step 11: Commit**

```bash
git add src/auth.ts src/lib/auth/session.ts tests/auth/session-version.test.ts tests/auth/edge-safety.test.ts
git commit -m "feat(auth): credentials provider in the node half only, with revocable JWT sessions"
```

---

### Task 5: The sign-up flag and the `signUp` action

**Files:**
- Create: `src/lib/auth/signup-flag.ts`
- Create: `src/actions/auth-signup.ts`
- Create: `tests/actions/signup.test.ts`

**Interfaces:**
- Consumes: `checkHandle`, `HANDLE_REJECTION_MESSAGES` (`@/lib/users/handle`); `checkPassword`, `PASSWORD_REJECTION_MESSAGES`, `hashPassword` (`@/lib/auth/password`).
- Produces:
  - `isSignupOpen(): boolean` from `@/lib/auth/signup-flag`
  - `signUp(input: { handle: string; email: string; password: string }): Promise<ActionResult<{ email: string }>>` from `@/actions/auth-signup`

- [ ] **Step 1: Write the failing tests**

Create `tests/actions/signup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), hashPassword: vi.fn() }))

vi.mock('@/lib/db', () => ({ prisma: { user: { create: h.create } } }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword }
})

import { signUp } from '@/actions/auth-signup'

const VALID = { handle: 'alice_ng', email: 'alice@example.com', password: 'a'.repeat(12) }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CREDENTIALS_SIGNUP_ENABLED = 'true'
  h.hashPassword.mockResolvedValue('$2b$12$hashed')
  h.create.mockResolvedValue({ id: 'u1' })
})

afterEach(() => {
  delete process.env.CREDENTIALS_SIGNUP_ENABLED
})

describe('the flag', () => {
  it('refuses when sign-up is closed, without touching the database', async () => {
    // The page guard is not enough on its own: a server action is a public
    // endpoint and can be called without ever loading the page.
    delete process.env.CREDENTIALS_SIGNUP_ENABLED
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('treats any value other than "true" as closed', async () => {
    for (const value of ['false', '1', 'yes', '']) {
      process.env.CREDENTIALS_SIGNUP_ENABLED = value
      h.create.mockClear()
      const res = await signUp(VALID)
      expect(res.success, value).toBe(false)
      expect(h.create).not.toHaveBeenCalled()
    }
  })
})

describe('signUp', () => {
  it('creates the user with BOTH handle forms, a hash, and a set-at stamp', async () => {
    const res = await signUp(VALID)
    expect(res.success).toBe(true)

    const data = h.create.mock.calls[0][0].data
    expect(data.handle).toBe('alice_ng')
    expect(data.normalizedHandle).toBe('alice_ng')
    expect(data.email).toBe('alice@example.com')
    expect(data.passwordHash).toBe('$2b$12$hashed')
    expect(data.passwordSetAt).toBeInstanceOf(Date)
  })

  it('lowercases the email it stores', async () => {
    // Sign-in lowercases the needle (identifierWhere). Storing a mixed-case
    // address would make the account unreachable by its own email.
    await signUp({ ...VALID, email: 'Alice@Example.COM' })
    expect(h.create.mock.calls[0][0].data.email).toBe('alice@example.com')
  })

  it('NEVER stores the raw password', async () => {
    await signUp(VALID)
    expect(JSON.stringify(h.create.mock.calls[0][0].data)).not.toContain(VALID.password)
  })

  it('rejects a bad handle before hashing anything', async () => {
    const res = await signUp({ ...VALID, handle: 'ab' })
    expect(res.success).toBe(false)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a reserved handle', async () => {
    const res = await signUp({ ...VALID, handle: 'admin' })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/reserved/i)
  })

  it('rejects a short password', async () => {
    const res = await signUp({ ...VALID, password: 'short' })
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a malformed email', async () => {
    for (const bad of ['alice', 'alice@', '@example.com', 'a b@c.co']) {
      const res = await signUp({ ...VALID, email: bad })
      expect(res.success, bad).toBe(false)
    }
    expect(h.create).not.toHaveBeenCalled()
  })

  it('turns a P2002 collision into a message that does NOT say which field collided', async () => {
    // Saying "that email is taken" confirms an address has an account to
    // anyone who can type one in. The handle half is not secret, but a single
    // message is the only version that cannot leak the email half.
    h.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).not.toMatch(/email/i)
  })

  it('never runs a pre-flight uniqueness SELECT', async () => {
    // A check-then-write is a TOCTOU bug; the constraint is what decides.
    // `prisma.user` is mocked with `create` alone, so any findFirst/findUnique
    // call would throw rather than pass silently.
    await expect(signUp(VALID)).resolves.toMatchObject({ success: true })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run tests/actions/signup.test.ts
```

Expected: FAIL — cannot resolve `@/actions/auth-signup`.

- [ ] **Step 3: Implement the flag**

Create `src/lib/auth/signup-flag.ts`:

```ts
/**
 * Is public credentials sign-up open?
 *
 * Off unless explicitly `true`. Decided with the user 2026-08-18, resolving
 * §10 of the design: there is **no password reset**, because there is no mail
 * provider — so a user who forgets their password is locked out permanently.
 * Behind a flag, the provider exists for a seeded dev account (which is what
 * lets an agent run its own live gates — BUILD-QUEUE trap 6) without offering
 * strangers an account they can lose forever.
 *
 * Flip it by setting CREDENTIALS_SIGNUP_ENABLED=true once email delivery
 * exists and reset is built.
 *
 * Note what this does NOT gate: signing IN. A seeded account must be able to
 * log in with the flag off, and an existing password user must not be locked
 * out by a config change.
 */
export function isSignupOpen(): boolean {
  return process.env.CREDENTIALS_SIGNUP_ENABLED === 'true'
}
```

- [ ] **Step 4: Implement the action**

Create `src/actions/auth-signup.ts`:

```ts
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
        error: 'Those details can’t be used. Try a different handle or email, or sign in instead.',
      }
    }
    console.error('Sign up error:', error)
    return { success: false, error: 'Could not create your account' }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/actions/signup.test.ts
```

Expected: PASS.

- [ ] **Step 6: Mutation-test the flag and the leak**

1. `isSignupOpen` returning `process.env.CREDENTIALS_SIGNUP_ENABLED !== 'false'` (default-open) → the "any value other than true" test must fail.
2. Removing the `isSignupOpen` check from the action (leaving only a future page guard) → the first flag test must fail.
3. P2002 message changed to `'That email is already registered.'` → the no-`/email/i` test must fail.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/signup-flag.ts src/actions/auth-signup.ts tests/actions/signup.test.ts
git commit -m "feat(auth): flagged sign-up that leaks neither field on collision"
```

---

### Task 6: `/signup` — page and form

**Files:**
- Create: `src/app/signup/page.tsx`
- Create: `src/components/auth/SignUpForm.tsx`
- Create: `tests/components/SignUpForm.test.tsx`

**Interfaces:**
- Consumes: `signUp` (Task 5), `isSignupOpen` (Task 5), `PASSWORD_MIN_LENGTH` (Task 2), `HANDLE_MAX_LENGTH` (`@/lib/users/handle`).
- Produces: a `/signup` route; `SignUpForm` (default export).

- [ ] **Step 1: Write the failing component test**

Create `tests/components/SignUpForm.test.tsx` (`// @vitest-environment jsdom` must be the literal first line — trap 9):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(cleanup)

const h = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }))

// A client component importing a server action pulls next-auth into jsdom and
// the file dies at load, before any test runs (BUILD-QUEUE trap 7).
vi.mock('@/actions/auth-signup', () => ({ signUp: h.signUp }))
vi.mock('next-auth/react', () => ({ signIn: h.signIn }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import SignUpForm from '@/components/auth/SignUpForm'

function fill(values: { handle?: string; email?: string; password?: string; confirm?: string }) {
  if (values.handle !== undefined)
    fireEvent.change(screen.getByLabelText(/handle/i), { target: { value: values.handle } })
  if (values.email !== undefined)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: values.email } })
  if (values.password !== undefined)
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: values.password } })
  if (values.confirm !== undefined)
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: values.confirm } })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.signUp.mockResolvedValue({ success: true, data: { email: 'alice@example.com' } })
  h.signIn.mockResolvedValue({ error: undefined })
})

describe('SignUpForm', () => {
  it('refuses to submit when the two passwords differ, without calling the action', async () => {
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'b'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(h.signUp).not.toHaveBeenCalled()
  })

  it('submits handle, email and password when they match', async () => {
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'a'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(h.signUp).toHaveBeenCalledWith({
        handle: 'alice',
        email: 'alice@example.com',
        password: 'a'.repeat(12),
      }),
    )
  })

  it('signs the new account straight in rather than leaving them at a form', async () => {
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'a'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith('credentials', {
        identifier: 'alice@example.com',
        password: 'a'.repeat(12),
        redirect: false,
      }),
    )
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/sets'))
  })

  it('shows the action’s error and does NOT sign in', async () => {
    h.signUp.mockResolvedValue({ success: false, error: 'Those details can’t be used.' })
    render(<SignUpForm />)
    fill({
      handle: 'alice',
      email: 'alice@example.com',
      password: 'a'.repeat(12),
      confirm: 'a'.repeat(12),
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/can’t be used/i)).toBeInTheDocument()
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('renders the password fields as type=password', async () => {
    // A visible password field on a shared screen is the kind of defect nobody
    // reports and everybody notices.
    render(<SignUpForm />)
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/confirm/i)).toHaveAttribute('type', 'password')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/components/SignUpForm.test.tsx
```

Expected: FAIL — cannot resolve `@/components/auth/SignUpForm`.

- [ ] **Step 3: Implement the form**

Create `src/components/auth/SignUpForm.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signUp } from '@/actions/auth-signup'
import { HANDLE_MAX_LENGTH } from '@/lib/users/handle'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export default function SignUpForm() {
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    // Checked on the client only — the server does not need it. The two fields
    // exist to catch a typo in something the user cannot recover if it is
    // wrong, since there is no password reset.
    if (password !== confirm) {
      setError('Those passwords do not match.')
      return
    }

    startTransition(async () => {
      const res = await signUp({ handle, email, password })
      if (!res.success) {
        setError(res.error)
        return
      }
      // Straight in. Making someone type the password they just chose into a
      // second form is a step with no purpose.
      const signedIn = await signIn('credentials', {
        identifier: res.data.email,
        password,
        redirect: false,
      })
      if (signedIn?.error) {
        setError('Your account was created, but signing in failed. Try signing in.')
        return
      }
      router.push('/sets')
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="signup-handle" className="text-sm font-medium">
          Handle
        </label>
        <Input
          id="signup-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          maxLength={HANDLE_MAX_LENGTH}
          autoComplete="username"
          placeholder="your_handle"
        />
        <p className="text-xs text-muted-foreground">
          Letters, numbers and underscores. This is the name others see.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters. Length matters more than symbols.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="signup-confirm" className="text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="signup-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Creating…' : 'Create account'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Implement the page**

Create `src/app/signup/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import SignUpForm from '@/components/auth/SignUpForm'
import { isSignupOpen } from '@/lib/auth/signup-flag'

/**
 * Behind CREDENTIALS_SIGNUP_ENABLED. `notFound()` rather than a "coming soon"
 * page: there is nothing here to wait for yet, and a form that always refuses
 * reads as broken.
 *
 * The action re-checks the flag itself — this guard is the affordance, not the
 * enforcement.
 */
export default async function SignUpPage() {
  if (!isSignupOpen()) notFound()

  const session = await auth()
  if (session?.user?.id) redirect('/sets')

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            There is no password reset yet — keep your password somewhere safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignUpForm />
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="underline hover:text-foreground">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Run the component test**

```bash
npx vitest run tests/components/SignUpForm.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Mutation-test the two client rules**

1. Remove the `password !== confirm` guard → the mismatch test must fail.
2. Call `signIn` before checking `res.success` → the "shows the error and does NOT sign in" test must fail.

- [ ] **Step 7: Commit**

```bash
git add src/app/signup src/components/auth/SignUpForm.tsx tests/components/SignUpForm.test.tsx
git commit -m "feat(auth): a signup page behind the flag, signing the new account straight in"
```

---

### Task 7: `/login` — page, form, and every redirect that used to point at `/api/auth/signin`

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/LoginForm.tsx`
- Create: `tests/components/LoginForm.test.tsx`
- Modify: `src/auth.config.ts` (add `pages`)
- Modify: `src/middleware.ts:14`
- Modify: `src/app/sets/[id]/review/page.tsx:22`
- Modify: `src/components/Navbar.tsx`
- Modify: `src/components/auth/SignInButton.tsx`

**Interfaces:**
- Consumes: `signIn` from `next-auth/react`; `CREDENTIALS_FAILURE_MESSAGE` (Task 3); `isSignupOpen` (Task 5).
- Produces: a `/login` route accepting `?callbackUrl=` and `?error=`; `LoginForm` (default export) taking `{ callbackUrl: string; signupOpen: boolean; initialError?: string }`.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/LoginForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(cleanup)

const h = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }))

vi.mock('next-auth/react', () => ({ signIn: h.signIn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))

import LoginForm from '@/components/auth/LoginForm'

beforeEach(() => {
  vi.clearAllMocks()
  h.signIn.mockResolvedValue({ error: undefined })
})

function fill(identifier: string, password: string) {
  fireEvent.change(screen.getByLabelText(/email or handle/i), { target: { value: identifier } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } })
}

describe('LoginForm', () => {
  it('signs in and lands on the callback url', async () => {
    render(<LoginForm callbackUrl="/sets/abc/quiz" signupOpen={false} />)
    fill('alice', 'a'.repeat(12))
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith('credentials', {
        identifier: 'alice',
        password: 'a'.repeat(12),
        redirect: false,
      }),
    )
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/sets/abc/quiz'))
  })

  it('shows ONE generic message on a failed sign-in', async () => {
    // Distinguishing "no such account" from "wrong password" is a
    // user-enumeration oracle. This assertion is the UI half of that rule.
    h.signIn.mockResolvedValue({ error: 'CredentialsSignin' })
    render(<LoginForm callbackUrl="/sets" signupOpen={false} />)
    fill('alice', 'wrongwrongwrong')
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/email or password is incorrect/i)
    expect(alert).not.toHaveTextContent(/no account|not found|unknown|no such/i)
    expect(h.push).not.toHaveBeenCalled()
  })

  it('explains OAuthAccountNotLinked instead of showing the raw code', async () => {
    // The real dead end from design §7: someone signed up by password, then
    // tried GitHub with the same address. Auth.js refuses — correctly — and
    // without this copy the user sees an opaque error string.
    render(<LoginForm callbackUrl="/sets" signupOpen={false} initialError="OAuthAccountNotLinked" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/already/i)
    expect(alert).not.toHaveTextContent('OAuthAccountNotLinked')
  })

  it('offers the GitHub route as well', async () => {
    render(<LoginForm callbackUrl="/sets" signupOpen={false} />)
    fireEvent.click(screen.getByRole('button', { name: /github/i }))
    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith('github', { callbackUrl: '/sets' }),
    )
  })

  it('hides the sign-up link when sign-up is closed, and shows it when open', () => {
    // A link to a route that 404s is worse than no link.
    const { unmount } = render(<LoginForm callbackUrl="/sets" signupOpen={false} />)
    expect(screen.queryByRole('link', { name: /create an account/i })).toBeNull()
    unmount()

    render(<LoginForm callbackUrl="/sets" signupOpen={true} />)
    expect(screen.getByRole('link', { name: /create an account/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/components/LoginForm.test.tsx
```

Expected: FAIL — cannot resolve `@/components/auth/LoginForm`.

- [ ] **Step 3: Implement the form**

Create `src/components/auth/LoginForm.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** The one message every credentials failure produces. See lib/auth/credentials.ts. */
const GENERIC_FAILURE = 'Email or password is incorrect.'

/**
 * Auth.js error codes that arrive as `?error=` on a redirect back here.
 *
 * `OAuthAccountNotLinked` is the one that matters: someone signed up with a
 * password and is now trying GitHub with the same address. Auth.js refuses by
 * design — auto-linking would trust a provider's unverified email claim — so
 * the fix is copy that explains the situation, not a config change.
 */
const ERROR_COPY: Record<string, string> = {
  CredentialsSignin: GENERIC_FAILURE,
  OAuthAccountNotLinked:
    'That email already has an account here. Sign in with your password instead, then link GitHub later.',
}

function messageFor(code: string): string {
  return ERROR_COPY[code] ?? 'Something went wrong signing you in. Please try again.'
}

export default function LoginForm({
  callbackUrl,
  signupOpen,
  initialError,
}: {
  callbackUrl: string
  signupOpen: boolean
  initialError?: string
}) {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    initialError ? messageFor(initialError) : null,
  )
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      // redirect:false so the failure lands here as a value rather than as a
      // navigation to Auth.js's own error page.
      const res = await signIn('credentials', { identifier, password, redirect: false })
      if (res?.error) {
        setError(messageFor(res.error))
        return
      }
      router.push(callbackUrl)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="login-identifier" className="text-sm font-medium">
            Email or handle
          </label>
          <Input
            id="login-identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="login-password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => signIn('github', { callbackUrl })}
      >
        Continue with GitHub
      </Button>

      {signupOpen ? (
        <p className="text-sm text-muted-foreground">
          New here?{' '}
          <Link href="/signup" className="underline hover:text-foreground">
            Create an account
          </Link>
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Implement the page**

Create `src/app/login/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import LoginForm from '@/components/auth/LoginForm'
import { isSignupOpen } from '@/lib/auth/signup-flag'

/**
 * The real sign-in page, replacing Auth.js's built-in one.
 *
 * `pages.signIn` in auth.config.ts points here, so the middleware redirect and
 * any bare `signIn()` call land on this page rather than on a generated form.
 *
 * Signing IN is never gated by CREDENTIALS_SIGNUP_ENABLED — a seeded dev
 * account and any existing password user must always be able to get in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const session = await auth()
  if (session?.user?.id) redirect('/sets')

  const params = await searchParams
  // Relative paths only: an absolute callbackUrl from the query string is an
  // open-redirect straight off the sign-in page.
  const raw = params.callbackUrl ?? '/sets'
  const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/sets'

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your password, or continue with GitHub.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            callbackUrl={callbackUrl}
            signupOpen={isSignupOpen()}
            initialError={params.error}
          />
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Point every existing entry point at `/login`**

`src/auth.config.ts` — add `pages` (and nothing else; the Credentials provider must never appear here):

```ts
export const authConfig = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  // Auth.js's built-in /api/auth/signin page cannot offer a password field for
  // a provider it does not know about — the Credentials provider lives in the
  // Node half (src/auth.ts). Pointing at the real page makes the middleware
  // redirect and any bare signIn() call land somewhere that can sign you in.
  pages: {
    signIn: '/login',
  },
} satisfies NextAuthConfig
```

`src/middleware.ts:14` — carry the destination so the user lands where they were going:

```ts
  if (isProtectedRoute && !req.auth) {
    const url = new URL("/login", req.nextUrl)
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
    return Response.redirect(url)
  }
```

`src/app/sets/[id]/review/page.tsx:22`:

```ts
  if (!session?.user?.id) redirect('/login?callbackUrl=' + encodeURIComponent(`/sets/${id}/review`))
```

(Use whatever the param variable is actually called in that file — check the surrounding lines rather than assuming `id`.)

`src/components/Navbar.tsx` — the signed-out branch becomes a link to the page, since there are now two ways in:

```tsx
            <Link href="/login" className={cn(buttonVariants({ size: 'sm' }))}>
              Sign in
            </Link>
```

Delete the now-unused `handleSignIn` import. Leave `handleSignOut` and `src/lib/actions/auth.ts` alone — sign-out is unchanged.

`src/components/auth/SignInButton.tsx` — point it at the page rather than straight at GitHub:

```tsx
'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function SignInButton({ className }: { className?: string }) {
  return (
    <Link href="/login" className={cn(buttonVariants({ variant: 'outline' }), className)}>
      Sign In
    </Link>
  )
}
```

- [ ] **Step 6: Verify nothing still points at the built-in page**

```bash
grep -rn "api/auth/signin" src/
```

Expected: no output. (`src/app/api/auth/[...nextauth]` route handlers are a different path and must stay.)

- [ ] **Step 7: Run the tests, the type check and the build**

```bash
npx vitest run tests/components/LoginForm.test.tsx
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx next build
```

Expected: PASS / no output / clean build.

- [ ] **Step 8: Mutation-test the copy rules**

1. `ERROR_COPY.CredentialsSignin` changed to `'No account with that email.'` → the generic-message test must fail.
2. `messageFor` falling back to the raw `code` → the OAuthAccountNotLinked test must fail.
3. The open-redirect guard in the page removed → no test covers it (the page is a server component with no test harness here). **Write it down in the commit message as a reviewed-not-tested line** rather than leaving it implied.

- [ ] **Step 9: Commit**

```bash
git add src/app/login src/components/auth/LoginForm.tsx tests/components/LoginForm.test.tsx src/auth.config.ts src/middleware.ts src/app/sets src/components/Navbar.tsx src/components/auth/SignInButton.tsx
git commit -m "feat(auth): a real login page, and every redirect pointed at it"
```

---

### Task 8: "Set a password" on `/account`

**Files:**
- Create: `src/actions/password.ts`
- Create: `src/components/account/PasswordPanel.tsx`
- Create: `tests/actions/password.test.ts`
- Modify: `src/actions/account.ts` (`AccountSettings` gains `hasPassword`)
- Modify: `src/app/account/page.tsx` (the Sign-in card)
- Modify: `tests/actions/account.test.ts` (the `getAccountSettings` fixture)

**Interfaces:**
- Consumes: `checkPassword`, `hashPassword`, `verifyPassword` (Task 2).
- Produces: `savePassword(input: { current?: string; next: string }): Promise<ActionResult<void>>`; `AccountSettings.hasPassword: boolean`.

- [ ] **Step 1: Write the failing action tests**

Create `tests/actions/password.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: h.findUnique, update: h.update } },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword, verifyPassword: h.verifyPassword }
})

import { savePassword } from '@/actions/password'

const NEW = 'n'.repeat(12)

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.hashPassword.mockResolvedValue('$2b$12$new')
  h.update.mockResolvedValue({})
  h.findUnique.mockResolvedValue({ passwordHash: null, sessionVersion: 2 })
})

describe('savePassword', () => {
  it('refuses a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await savePassword({ next: NEW })
    expect(res).toEqual({ success: false, error: 'Unauthorized' })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('sets a first password for an OAuth-only account without asking for a current one', async () => {
    const res = await savePassword({ next: NEW })
    expect(res.success).toBe(true)
    expect(h.verifyPassword).not.toHaveBeenCalled()
    expect(h.update.mock.calls[0][0].data.passwordHash).toBe('$2b$12$new')
  })

  it('requires the CURRENT password when one is already set', async () => {
    // Without this, anyone with a borrowed open session takes the account
    // permanently — there is no reset to recover it with.
    h.findUnique.mockResolvedValue({ passwordHash: '$2b$12$old', sessionVersion: 2 })
    const res = await savePassword({ next: NEW })
    expect(res.success).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects a wrong current password', async () => {
    h.findUnique.mockResolvedValue({ passwordHash: '$2b$12$old', sessionVersion: 2 })
    h.verifyPassword.mockResolvedValue(false)
    const res = await savePassword({ current: 'wrongwrongwrong', next: NEW })
    expect(res.success).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('BUMPS sessionVersion, so a password change signs other sessions out', async () => {
    // The whole reason the column exists. A JWT cannot be deleted; changing
    // the password without bumping this leaves a stolen token working.
    h.findUnique.mockResolvedValue({ passwordHash: '$2b$12$old', sessionVersion: 2 })
    h.verifyPassword.mockResolvedValue(true)

    await savePassword({ current: 'o'.repeat(12), next: NEW })

    expect(h.update.mock.calls[0][0].data.sessionVersion).toBe(3)
  })

  it('bumps on a FIRST password too', async () => {
    // Setting a password is also a security-state change, and any token issued
    // before it should not outlive it.
    await savePassword({ next: NEW })
    expect(h.update.mock.calls[0][0].data.sessionVersion).toBe(3)
  })

  it('stamps passwordSetAt', async () => {
    await savePassword({ next: NEW })
    expect(h.update.mock.calls[0][0].data.passwordSetAt).toBeInstanceOf(Date)
  })

  it('enforces the length policy on the new password', async () => {
    const res = await savePassword({ next: 'short' })
    expect(res.success).toBe(false)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('scopes every read and write to the caller, never to an id from the argument', async () => {
    await savePassword({ next: NEW })
    expect(h.findUnique.mock.calls[0][0].where).toEqual({ id: 'u1' })
    expect(h.update.mock.calls[0][0].where).toEqual({ id: 'u1' })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run tests/actions/password.test.ts
```

Expected: FAIL — cannot resolve `@/actions/password`.

- [ ] **Step 3: Implement the action**

Create `src/actions/password.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/actions/password.test.ts
```

Expected: PASS.

- [ ] **Step 5: Surface whether a password exists**

In `src/actions/account.ts`, add `hasPassword: boolean` to the `AccountSettings` interface and derive it in `getAccountSettings`:

```ts
export interface AccountSettings {
  handle: string | null
  email: string
  contactEmail: string | null
  emailUpdates: boolean
  /** Whether a password is set. The hash itself never leaves the server. */
  hasPassword: boolean
}
```

```ts
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
```

- [ ] **Step 6: Add the test that the hash never leaves the server**

Append to `tests/actions/account.test.ts`'s `getAccountSettings` describe block:

```ts
  it('reports whether a password exists without returning the hash', async () => {
    h.userFindUnique.mockResolvedValue({
      handle: 'alice',
      email: 'alice@github.example',
      contactEmail: null,
      emailUpdates: false,
      passwordHash: '$2b$12$secret',
    })
    const res = await getAccountSettings()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.hasPassword).toBe(true)
    expect(JSON.stringify(res.data)).not.toContain('$2b$12$secret')
  })

  it('reports hasPassword false for an OAuth-only account', async () => {
    h.userFindUnique.mockResolvedValue({
      handle: 'alice',
      email: 'alice@github.example',
      contactEmail: null,
      emailUpdates: false,
      passwordHash: null,
    })
    const res = await getAccountSettings()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.hasPassword).toBe(false)
  })
```

The existing `getAccountSettings` fixture must gain `passwordHash: null` or its assertions will read `undefined` — update it.

- [ ] **Step 7: Build the panel**

Create `src/components/account/PasswordPanel.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { savePassword } from '@/actions/password'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (next !== confirm) {
      setError('Those passwords do not match.')
      return
    }
    startTransition(async () => {
      const res = await savePassword({ current: hasPassword ? current : undefined, next })
      if (!res.success) {
        setError(res.error)
        return
      }
      setCurrent('')
      setNext('')
      setConfirm('')
      // Stated plainly: the bump signs every other session out, and a person
      // who is not told that will read it as a bug.
      toast.success('Password saved. Other devices have been signed out.')
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-3"
    >
      {hasPassword ? (
        <div className="space-y-1">
          <label htmlFor="current-password" className="text-sm font-medium">
            Current password
          </label>
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="max-w-sm"
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="new-password" className="text-sm font-medium">
          {hasPassword ? 'New password' : 'Password'}
        </label>
        <Input
          id="new-password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className="max-w-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="confirm-password" className="text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="max-w-sm"
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={isPending || next.length === 0}>
        {isPending ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
      </Button>

      <p className="text-xs text-muted-foreground">
        At least {PASSWORD_MIN_LENGTH} characters. There is no password reset yet — if you
        forget it, GitHub is the only way back in.
      </p>
    </form>
  )
}
```

- [ ] **Step 8: Put it on the page**

In `src/app/account/page.tsx`, replace the Sign-in card's "planned, not built" paragraph:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Sign-in</CardTitle>
          <CardDescription>How you get into this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm">
            <span className="font-medium">GitHub</span>
            <span className="text-muted-foreground"> — {account.email}</span>
          </p>
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">
              {account.hasPassword ? 'Password' : 'Add a password'}
            </p>
            <PasswordPanel hasPassword={account.hasPassword} />
          </div>
        </CardContent>
      </Card>
```

Import it, and update the page's docblock: the "Password — not built" bullet is now wrong, and leaving it would tell the next reader something false.

- [ ] **Step 9: Run everything touched**

```bash
npx vitest run tests/actions/password.test.ts tests/actions/account.test.ts
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```

Expected: PASS / no output.

- [ ] **Step 10: Mutation-test the two account-takeover guards**

1. Drop the `if (user.passwordHash)` current-password branch → two tests must fail.
2. Remove `sessionVersion: user.sessionVersion + 1` → the two bump tests must fail.
3. Return `user` directly from `getAccountSettings` (hash included) → the "does not contain the hash" test must fail.

- [ ] **Step 11: Commit**

```bash
git add src/actions/password.ts src/actions/account.ts src/components/account/PasswordPanel.tsx src/app/account/page.tsx tests/actions/password.test.ts tests/actions/account.test.ts
git commit -m "feat(account): set or change a password, signing other sessions out"
```

---

### Task 9: `scripts/seed-dev-user.ts` — the piece that ends the gate bottleneck

**Files:**
- Create: `scripts/seed-dev-user.ts`
- Modify: `package.json` (script entry)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `hashPassword` (Task 2), `checkHandle` (`@/lib/users/handle`).
- Produces: `npm run seed:dev-user`.

- [ ] **Step 1: Write the script**

Trap 4: `tsx` scripts must live inside the project and need a `main()` wrapper — top-level `await` breaks under the CJS output format.

Create `scripts/seed-dev-user.ts`:

```ts
/**
 * Create (or re-password) a local development account.
 *
 * This is the script that ends the live-gate bottleneck. Auth was GitHub-only
 * and `.env` carries no GITHUB_ID, so no signed-in page was reachable from an
 * agent session and EVERY live gate on this project was owed to a human
 * (BUILD-QUEUE trap 6). With a credentials provider plus this account, an
 * agent can sign in against a dev database and run its own.
 *
 * Run:  npm run seed:dev-user
 * Reads DEV_USER_EMAIL, DEV_USER_HANDLE, DEV_USER_PASSWORD from the env file.
 */

import { prisma } from '../src/lib/db'
import { hashPassword, checkPassword } from '../src/lib/auth/password'
import { checkHandle } from '../src/lib/users/handle'

async function main() {
  // First line of the script, before anything is read or written. A seeded
  // account with a known password in production is a back door, and "I was
  // sure it was dev" is exactly how one gets created.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev-user refuses to run with NODE_ENV=production')
  }

  const email = (process.env.DEV_USER_EMAIL ?? 'dev@localhost.test').toLowerCase()
  const rawHandle = process.env.DEV_USER_HANDLE ?? 'dev_user'
  const password = process.env.DEV_USER_PASSWORD

  if (!password) {
    throw new Error('Set DEV_USER_PASSWORD in your env file (12+ characters)')
  }
  const policy = checkPassword(password)
  if (!policy.ok) {
    throw new Error(`DEV_USER_PASSWORD is rejected by the password policy: ${policy.reason}`)
  }
  const handle = checkHandle(rawHandle)
  if (!handle.ok) {
    throw new Error(`DEV_USER_HANDLE is rejected: ${handle.reason}`)
  }

  const passwordHash = await hashPassword(password)

  // Upsert, so re-running it resets the password of an account that already
  // exists rather than failing on the unique constraint.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, passwordSetAt: new Date() },
    create: {
      email,
      handle: handle.handle,
      normalizedHandle: handle.normalized,
      passwordHash,
      passwordSetAt: new Date(),
    },
    select: { id: true, email: true, handle: true },
  })

  console.log('Seeded dev user:')
  console.log(`  id:     ${user.id}`)
  console.log(`  email:  ${user.email}`)
  console.log(`  handle: ${user.handle}`)
  console.log('Sign in at /login with that email or handle and DEV_USER_PASSWORD.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 2: Add the npm script**

In `package.json`, beside the other `tsx --env-file=.env` scripts:

```json
    "seed:dev-user": "tsx --env-file=.env scripts/seed-dev-user.ts",
```

- [ ] **Step 3: Document the new variables**

Append to `.env.example`:

```bash
# Credentials sign-up. OFF unless exactly "true" — there is no password reset
# (no mail provider), so a forgotten password means a lost account. Signing IN
# with a password is always available and is NOT gated by this.
CREDENTIALS_SIGNUP_ENABLED=""

# Local development account for `npm run seed:dev-user`. Never set these in
# production — the script refuses to run there.
DEV_USER_EMAIL="dev@localhost.test"
DEV_USER_HANDLE="dev_user"
DEV_USER_PASSWORD=""
```

- [ ] **Step 4: Run it against the dev database**

Add `DEV_USER_PASSWORD` to the local `.env` (12+ characters), then:

```bash
npm run seed:dev-user
```

Expected: the three-line summary. Run it a **second** time and confirm it succeeds again — that proves the upsert path, which is what makes the script usable for resetting a forgotten dev password.

- [ ] **Step 5: Verify the production refusal**

```bash
NODE_ENV=production npx tsx --env-file=.env scripts/seed-dev-user.ts
```

Expected: throws `seed-dev-user refuses to run with NODE_ENV=production`, and **no** database write. (On PowerShell: `$env:NODE_ENV='production'; npx tsx --env-file=.env scripts/seed-dev-user.ts; $env:NODE_ENV=''`.)

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-dev-user.ts package.json .env.example
git commit -m "chore(auth): a dev-only seeded account, so an agent can run its own live gates"
```

---

### Task 10: End-to-end verification against the running app

This is the task the whole feature is for: from here on, an agent can run its own gates. Do it properly.

**Files:** none — this is verification.

- [ ] **Step 1: Full suite, type check, build, lint**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx next build
npm run lint 2>&1 | tail -3
```

Expected: all tests pass (1412 baseline + the new files), no `tsc` output, clean build, lint **176 problems or fewer** — compare against the baseline and do not fix unrelated ones.

- [ ] **Step 2: Start the dev server with a secret**

`.env` has no `NEXTAUTH_SECRET`, so `auth()` throws `MissingSecret` and the app misbehaves in confusing ways (trap 1). Pass one to the process:

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only CREDENTIALS_SIGNUP_ENABLED=true npm run dev
```

- [ ] **Step 3: Sign in as the seeded user**

Navigate to `/login`, enter the seeded **handle** and password, submit.

Expected: lands on `/sets`, and the navbar shows Learning / Account / Sign out. **This is the trap-6 close** — record it explicitly.

- [ ] **Step 4: Confirm the identifier really accepts both forms**

Sign out, sign in again with the **email** instead. Expected: same result.

- [ ] **Step 5: Confirm the failure message is generic and identical**

Try a wrong password on a real account, then a completely unknown identifier.

Expected: the **same** message — "Email or password is incorrect." — in both cases. A difference here is the enumeration oracle the design exists to avoid.

- [ ] **Step 6: Confirm the protected-route redirect round-trips**

Signed out, navigate to `/sets/<some-id>/quiz`.

Expected: redirected to `/login?callbackUrl=%2Fsets%2F<id>%2Fquiz`; after signing in, you land on the quiz page, not on `/sets`.

- [ ] **Step 7: Confirm the flag gates sign-up but not sign-in**

Restart the server **without** `CREDENTIALS_SIGNUP_ENABLED`:

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```

Expected: `/signup` returns 404; `/login` shows no "Create an account" link; **signing in still works**. That last one is the whole point of gating only sign-up.

- [ ] **Step 8: Confirm revocation actually revokes**

Signed in, open `/account`, change the password. Then, **without signing out**, reload any protected page.

Expected: the reload signs you out (the `sessionVersion` bump invalidated the token you were holding). Sign in with the new password. If reloading leaves you signed in, `jwtCallback` is not invalidating and the `sessionVersion` column is decorative — stop and fix it before committing.

- [ ] **Step 9: Confirm GitHub OAuth still works, or record that it cannot be checked**

`.env` has no `GITHUB_ID`/`GITHUB_SECRET`, so this is very likely **not runnable locally**. Do not claim it passed. Record it as owed to the human, alongside the `OAuthAccountNotLinked` copy (Task 7), which needs a real GitHub account whose email matches a password account.

- [ ] **Step 10: Write down what you actually observed**

Update `docs/superpowers/BUILD-QUEUE.md` item 6e with: the checks that passed, the two that could not be run locally and why, and the new baselines (test file count, test count, lint count). Findings, not a summary — the queue's value is that it records what went wrong.

---

### Task 11: Documentation — the queue, `CLAUDE.md`, and the trap that is now closed

**Files:**
- Modify: `docs/superpowers/BUILD-QUEUE.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-17-credentials-auth-design.md`

- [ ] **Step 1: Close item 6e in the queue**

Rewrite the item-6e block as a DONE entry in the style of items 3–6f: what shipped, the mutants introduced and killed, what the live gate covered, and what it could not reach. Note explicitly that **Task 4's decision (§10) was "behind a flag"**, chosen by the user on 2026-08-18.

- [ ] **Step 2: Amend trap 6**

Trap 6 in the "Environment gotchas" section is no longer true as written. Replace it with the new state: a signed-in session **is** reachable from an agent session via `npm run seed:dev-user` + `/login`, provided the dev server runs with `NEXTAUTH_SECRET=dev-only`. Keep the note that **GitHub OAuth** specifically remains unreachable (no `GITHUB_ID`), because that is still true and still blocks the `OAuthAccountNotLinked` check.

- [ ] **Step 3: Update `CLAUDE.md`**

Under "Decided stack", the Auth line currently says only Auth.js/NextAuth. Add the two facts a future session must not get wrong:

```markdown
- **Auth:** Auth.js (NextAuth), JWT sessions. Two providers: GitHub OAuth and **Credentials**
  (username/handle or email + password, bcryptjs cost 12). The Credentials provider lives in
  `src/auth.ts` and **must never** be added to `src/auth.config.ts` — `src/middleware.ts` bundles
  that file for the **edge runtime**, where a hashing library breaks every protected route at
  request time, invisibly to `tsc` and to the test suite. `tests/auth/edge-safety.test.ts` walks
  the transitive import graph to enforce it. Sign-up is gated by `CREDENTIALS_SIGNUP_ENABLED`
  (off unless exactly `"true"`) because there is **no password reset** — no mail provider exists.
  Signing in is never gated. JWTs cannot be revoked, so `User.sessionVersion` is compared on every
  session resolution and bumped on password change; without it a password change is theatre.
```

- [ ] **Step 4: Mark the spec built**

Change the design doc's `**Status:**` line to `BUILT 2026-08-18` and add a short "What changed from the design" section: the flag decision resolving §10, the 72-byte password ceiling this plan added, and any place the implementation diverged.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers CLAUDE.md
git commit -m "docs: close credentials auth, and amend the trap it removes"
```

---

## Self-review notes

Checked against the spec, 2026-08-18:

- **§1 schema** → Task 1. **§2 edge trap** → Task 4 (guard) + the global constraint. **§3 hashing** → Task 2. **§4 sign-up** → Tasks 5–6. **§5 sign-in** → Task 7. **§6 seed script** → Task 9. **§7 known limits** → surfaced in copy (Tasks 6, 8) and in the docs (Task 11). **§8 defects 1–6** → 1: Task 4 Step 9; 2: Tasks 4 + 8; 3: Task 3 Steps 5/9; 4: Task 5; 5: Task 7 copy; 6: no rate limiting is built, deliberately — recorded, not silently dropped. **§10** → decided: behind a flag.
- **Spec §9 task 6** ("email-or-handle lookup") is folded into Task 3, whose `authorize` is its only consumer; **spec §9 task 9** (`OAuthAccountNotLinked`) is folded into Task 7's error copy rather than being a separate error page, since Auth.js delivers the code to `/login?error=` once `pages.signIn` is set.
- **Not covered by any automated test, by construction, and each stated where it lives:** the timing equalisation (unit tests cannot observe wall-clock timing — Task 2 Step 7), the open-redirect guard on `/login` (server component, no harness — Task 7 Step 8), and GitHub OAuth end-to-end (no credentials in `.env` — Task 10 Step 9).
