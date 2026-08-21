# Open the Doors — Invite Codes, Email Verification & Password Reset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `CREDENTIALS_SIGNUP_ENABLED=true` a decision rather than a gamble, by shipping a mail transport, a finite pool of invite codes that caps account growth, required email verification, and a working password reset.

**Architecture:** Three new pure-ish modules (`src/lib/auth/tokens.ts`, `src/lib/mail/`, `src/lib/invites/`) plus five new routes. Bearer tokens are stored only as `sha256(purpose + ':' + raw)` in one `UserToken` table; every consumption is a single atomic `updateMany` asserting `count === 1`, never a read-then-write. Invite redemption is the same shape — a `usesRemaining` counter that decrements toward zero, so the gate is one atomic update rather than a cross-column comparison Prisma cannot express. Every mail-sending action returns one fixed response for every input and does all of its work inside `after()`, so neither the text nor the timing is an enumeration oracle.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7 + Postgres (Neon adapter), Auth.js (next-auth 5 beta) with JWT sessions, bcryptjs, Vitest, Tailwind. Mail via a hand-rolled `fetch` POST to the Resend HTTP API — **no `resend` npm package**.

**Spec:** `docs/superpowers/specs/2026-08-20-open-the-doors-design.md` — read it alongside this plan. Every task below cites the section it implements.

---

## Global Constraints

Copied verbatim from the spec and from the repo's build queue. These apply to **every** task.

- **The Credentials provider lives in `src/auth.ts` only.** `src/middleware.ts` bundles `src/auth.config.ts` for the **edge runtime**. Nothing reachable from `auth.config.ts` may import Prisma or bcrypt, even transitively. `tests/auth/edge-safety.test.ts` enforces this and **needs no change** — its `FORBIDDEN` list already contains `@/lib/db` and the walk is transitive. **Do not add a task for it** (spec §2).
- **Verify this project alone**, because `cursor-agents/` is a separate git repo in the project root that breaks bare tooling (BUILD-QUEUE trap 2):
  ```bash
  npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
  npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
  ```
- **Baselines to compare against** (branch `spec3b-tunable-scoring`, after item 6e): **127 test files / 1522 passing**, `tsc` clean, `next build` clean, `npm run lint` **175 problems (131 errors, 44 warnings)** — all pre-existing. Do not fix unrelated lint.
- **`prisma migrate dev` is unusable from an agent shell** (trap 5). Generate SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, write it to `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy`. Note the flag is `--from-config-datasource`; `--from-schema-datasource` was removed in this Prisma version.
- **`.env` contains only `DATABASE_URL`** (trap 1). To run the app locally: `NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev`.
- **A signed-in session IS reachable from an agent session** (trap 6, closed by item 6e). `npm run seed:dev-user` then sign in at `/login` as `dev_user` / `dev@localhost.test`. **GitHub OAuth specifically remains unreachable** — no `GITHUB_ID` in `.env`.
- **The schema contains zero Prisma enums.** Every closed vocabulary is a `String` column plus a shared `as const` TS constant, following `src/lib/cards/klp-status.ts`. `UserToken.purpose` follows that (spec §2).
- **A raw statement whose result you never read must use `$executeRaw`, never `$queryRaw`** (trap 8). No task here needs raw SQL, but do not introduce one.
- **Component tests** need `// @vitest-environment jsdom` as the literal first line and must call `afterEach(cleanup)` themselves — `vitest.config.ts` has no `globals: true` (trap 9). A client component that imports a server action breaks jsdom tests at load; mock the action module (trap 7).
- **`tsx` scripts live in `scripts/`** and need a `main()` wrapper — top-level `await` breaks under the CJS output format (trap 4).
- **Windows:** `pkill` does not stop the Next dev server. Use `netstat -ano | grep :3000` then `taskkill /PID <pid> /F` (trap 3).
- **Enumeration rule (spec §5), non-negotiable:** `requestPasswordReset`, `resendVerification`, and `signUp`'s duplicate-account path each return **one fixed message for every input** and perform all their work inside `after()`. Invite-code errors are **exempt** and may be specific.
- **Flipping `CREDENTIALS_SIGNUP_ENABLED` to `true` is a human decision, not a task in this plan** (spec §8).
- **Rate limiting is Vercel Firewall configuration, not code** (spec §10). Task 12 writes the runbook; nothing else touches it.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src/lib/auth/tokens.ts` | The only place raw tokens are generated, hashed, minted, peeked, consumed, or invalidated. |
| `src/lib/mail/transport.ts` | `MailTransport` interface; `resendTransport` (raw `fetch`); `consoleTransport`. |
| `src/lib/mail/origin.ts` | `appOrigin()` — absolute link origin from env, never from the request. |
| `src/lib/mail/templates.ts` | Pure `{ subject, text, html }` builders. |
| `src/lib/mail/send.ts` | Transport selection + the two send helpers. **Never throws.** |
| `src/lib/invites/code.ts` | Pure Crockford Base32: generate, normalize, format. |
| `src/lib/invites/redeem.ts` | The cheap pre-check and the atomic decrement. |
| `scripts/mint-invite.ts` | `npm run invite` — mint, `--list`, `--revoke`. |
| `src/actions/auth-verify.ts` | `resendVerification`, `consumeEmailVerification`. |
| `src/actions/auth-reset.ts` | `requestPasswordReset`, `peekResetToken`, `completePasswordReset`. |
| `src/app/signup/check-email/page.tsx` | "Check your inbox", showing the address as typed. |
| `src/components/auth/ResendVerification.tsx` | The resend control, shared by check-email and the verify-failure page. |
| `src/app/verify/[token]/page.tsx` | Consume a verify token, or offer a resend. |
| `src/app/forgot/page.tsx` + `src/components/auth/ForgotForm.tsx` | Request a reset. |
| `src/app/reset/[token]/page.tsx` + `src/components/auth/ResetPasswordForm.tsx` | Consume a reset token. |

**Modified:** `prisma/schema.prisma`, `src/actions/auth-signup.ts`, `src/components/auth/SignUpForm.tsx`, `src/components/auth/LoginForm.tsx`, `src/lib/auth/credentials.ts`, `src/auth.ts`, `src/actions/password.ts`, `src/lib/auth/signup-flag.ts`, `package.json`, `.env.example`, `CLAUDE.md`, `docs/superpowers/BUILD-QUEUE.md`, `tests/auth/credentials-authorize.test.ts`.

---

### Task 1: Schema — `UserToken`, `InviteCode`, `User.invitedByCodeId`

Implements spec §3.

**Files:**
- Modify: `prisma/schema.prisma` (the `User` model, ~line 9-79; append the two new models at the end of the file)
- Create: `prisma/migrations/20260820000000_invites_and_user_tokens/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `UserToken { id, userId, user, tokenHash, purpose, expiresAt, usedAt, createdAt }` and `InviteCode { id, code, label, maxUses, usesRemaining, expiresAt, revokedAt, createdAt, redeemedBy }`; `User.invitedByCodeId: String?`, `User.invitedByCode: InviteCode?`, `User.userTokens: UserToken[]`. Every later task depends on these names.

- [ ] **Step 1: Add the two models to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
model UserToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// sha256(purpose + ':' + rawToken), hex. NEVER the raw token — a token in a
  /// database is a bearer credential exactly like a password.
  ///
  /// The purpose is mixed into the hash on purpose. It makes a verification
  /// token unable to hash to a reset row's value, so forgetting the `purpose`
  /// clause in a `where` fails closed instead of opening a confused-deputy
  /// hole. See src/lib/auth/tokens.ts.
  tokenHash String    @unique

  /// Vocabulary: TOKEN_PURPOSES in src/lib/auth/tokens.ts
  /// ('password_reset' | 'email_verify'). String column + shared const,
  /// matching src/lib/cards/klp-status.ts; this schema has no Prisma enums.
  purpose   String

  expiresAt DateTime
  /// Single-use. Enforced by an atomic conditional update asserting
  /// count === 1, never by read-then-write.
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  /// Supports "invalidate every other outstanding token of this purpose".
  @@index([userId, purpose])
}

model InviteCode {
  id            String    @id @default(cuid())

  /// Normalised Crockford Base32, stored in PLAINTEXT — deliberately. A leaked
  /// reset token is account takeover; a leaked invite costs one signup slot
  /// from a pool that is already bounded, and the operator genuinely needs to
  /// read codes back out. See the design's §6.
  code          String    @unique
  /// Free text for the operator: "discord launch", "study group A".
  label         String?

  /// Immutable, for display: "3 of 5 used".
  maxUses       Int
  /// The atomic gate. Counts DOWN, because Prisma cannot compare two columns
  /// in a `where` — a `usesCount < maxUses` gate would need raw SQL, while a
  /// decrement toward zero is a plain conditional update.
  usesRemaining Int

  expiresAt     DateTime?
  revokedAt     DateTime?
  createdAt     DateTime  @default(now())

  redeemedBy    User[]
}
```

- [ ] **Step 2: Add the three fields to the `User` model**

Inside `model User`, immediately after the `sessionVersion` field and before the `accounts` relation, add:

```prisma
  /// Which invite let this account in, or null for GitHub accounts, the seeded
  /// dev user, and everything predating invite codes. Nullable permanently.
  /// This is the audit trail — "who came in on which code" — for one FK.
  ///
  /// SetNull on delete, so deleting an InviteCode erases the audit trail for
  /// accounts that used it. Prefer `npm run invite -- --revoke`, which
  /// preserves the row.
  invitedByCodeId  String?
  invitedByCode    InviteCode?       @relation(fields: [invitedByCodeId], references: [id], onDelete: SetNull)
```

and add `userTokens     UserToken[]` to the relation list (next to `accounts`, `sessions`).

- [ ] **Step 3: Document `emailVerified`'s second meaning**

Replace the bare `emailVerified    DateTime?` line in `model User` with:

```prisma
  /// Owned by the Auth.js adapter, but load-bearing for us too: for a
  /// CREDENTIALS account, null means password sign-in is REFUSED.
  ///
  /// GitHub sign-in is NOT gated by it and must never be. The check lives in
  /// authorizeCredentials (src/lib/auth/credentials.ts) and nowhere else, so
  /// an OAuth account with emailVerified: null signs in exactly as it does
  /// today. GitHub's verification of its own users is GitHub's business; this
  /// column governs the addresses *we* let people self-register.
  emailVerified    DateTime?
```

- [ ] **Step 4: Validate and generate the migration SQL**

```bash
npx prisma validate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Write the printed SQL into `prisma/migrations/20260820000000_invites_and_user_tokens/migration.sql`.

- [ ] **Step 5: Append the grandfather statement to the migration**

At the **end** of that same `migration.sql`, append:

```sql
-- Grandfather every account that predates the verification gate.
--
-- NON-NEGOTIABLE. `emailVerified` is null for every account that exists today,
-- including the seeded `dev_user`, which has a password. Shipping the gate
-- (src/lib/auth/credentials.ts) without this locks that account out on deploy,
-- and it is the account an agent uses to run live gates. The statement asserts
-- "everything predating the gate is grandfathered", which is exactly true.
UPDATE "User" SET "emailVerified" = NOW() WHERE "emailVerified" IS NULL;
```

- [ ] **Step 6: Apply it and prove there is zero residual drift**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```
Expected: the third command prints `-- This is an empty migration.`

- [ ] **Step 7: Prove existing accounts were grandfathered**

```bash
npx tsx --env-file=.env -e "const{prisma}=require('./src/lib/db');prisma.user.count({where:{emailVerified:null}}).then(n=>{console.log('unverified users:',n);return prisma.\$disconnect()})"
```
Expected: `unverified users: 0`. If it is not 0, the grandfather statement did not run — do not proceed.

- [ ] **Step 8: Confirm the suite and types are unchanged**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
```
Expected: `tsc` silent; 1522 tests passing.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add UserToken and InviteCode, grandfather emailVerified"
```

---

### Task 2: `src/lib/auth/tokens.ts` — generate, purpose-bound hash, atomic consume

Implements spec §4. **One of the two security-core tasks — review this hardest.**

**Files:**
- Create: `src/lib/auth/tokens.ts`
- Test: `tests/auth/tokens.test.ts`

**Interfaces:**
- Consumes: the `UserToken` model from Task 1.
- Produces:
  - `TOKEN_PURPOSES: readonly ['password_reset', 'email_verify']`, `type TokenPurpose`
  - `TOKEN_TTL_MS: Record<TokenPurpose, number>`
  - `generateRawToken(): string`
  - `hashToken(purpose: TokenPurpose, raw: string): string`
  - `expiresAtFor(purpose: TokenPurpose, now?: Date): Date`
  - `type TokenDb = Pick<Prisma.TransactionClient, 'userToken'>`
  - `invalidateTokens(db: TokenDb, input: { userId: string; purpose: TokenPurpose }): Promise<void>`
  - `mintToken(db: TokenDb, input: { userId: string; purpose: TokenPurpose }): Promise<string>` — returns the RAW token
  - `peekToken(db: TokenDb, input: { purpose: TokenPurpose; raw: string }): Promise<boolean>`
  - `type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: 'invalid_or_expired' }`
  - `consumeToken(db: TokenDb, input: { purpose: TokenPurpose; raw: string }): Promise<ConsumeResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/auth/tokens.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TOKEN_PURPOSES,
  TOKEN_TTL_MS,
  generateRawToken,
  hashToken,
  expiresAtFor,
  invalidateTokens,
  mintToken,
  peekToken,
  consumeToken,
} from '@/lib/auth/tokens'

function fakeDb() {
  return {
    userToken: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }),
    },
  }
}

describe('the purpose is bound into the hash', () => {
  it('produces DIFFERENT hashes for the same raw string under different purposes', () => {
    // This is the whole point of the binding: a verification token cannot be
    // presented at the reset endpoint even if every query filter is dropped.
    const raw = 'the-same-secret'
    expect(hashToken('email_verify', raw)).not.toBe(hashToken('password_reset', raw))
  })

  it('is deterministic and hex', () => {
    const a = hashToken('email_verify', 'abc')
    expect(a).toBe(hashToken('email_verify', 'abc'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never returns the raw token inside the hash', () => {
    expect(hashToken('password_reset', 'plaintext-secret')).not.toContain('plaintext-secret')
  })
})

describe('generateRawToken', () => {
  it('is 32 bytes of base64url — URL-path safe, no + or /', () => {
    const raw = generateRawToken()
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    // 32 bytes base64url-encodes to 43 characters, unpadded.
    expect(raw).toHaveLength(43)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateRawToken()))
    expect(seen.size).toBe(200)
  })
})

describe('TTLs', () => {
  it('gives reset one hour and verification 24', () => {
    expect(TOKEN_TTL_MS.password_reset).toBe(60 * 60 * 1000)
    expect(TOKEN_TTL_MS.email_verify).toBe(24 * 60 * 60 * 1000)
  })

  it('covers every purpose in the vocabulary', () => {
    for (const purpose of TOKEN_PURPOSES) {
      expect(typeof TOKEN_TTL_MS[purpose]).toBe('number')
    }
  })

  it('expiresAtFor adds the purpose TTL to the given instant', () => {
    const now = new Date('2026-08-20T12:00:00.000Z')
    expect(expiresAtFor('password_reset', now).toISOString()).toBe('2026-08-20T13:00:00.000Z')
    expect(expiresAtFor('email_verify', now).toISOString()).toBe('2026-08-21T12:00:00.000Z')
  })
})

describe('mintToken', () => {
  let db: ReturnType<typeof fakeDb>
  beforeEach(() => {
    db = fakeDb()
  })

  it('invalidates the user’s other outstanding tokens of the SAME purpose first', async () => {
    // Otherwise a second "resend" leaves the first link live.
    await mintToken(db, { userId: 'u1', purpose: 'email_verify' })
    expect(db.userToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', purpose: 'email_verify', usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('stores the HASH and never the raw token', async () => {
    const raw = await mintToken(db, { userId: 'u1', purpose: 'password_reset' })
    const data = db.userToken.create.mock.calls[0][0].data
    expect(data.tokenHash).toBe(hashToken('password_reset', raw))
    expect(JSON.stringify(data)).not.toContain(raw)
  })

  it('stores the purpose and a future expiry', async () => {
    await mintToken(db, { userId: 'u1', purpose: 'password_reset' })
    const data = db.userToken.create.mock.calls[0][0].data
    expect(data.purpose).toBe('password_reset')
    expect(data.userId).toBe('u1')
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('consumeToken', () => {
  let db: ReturnType<typeof fakeDb>
  beforeEach(() => {
    db = fakeDb()
  })

  it('claims the row with ONE atomic conditional update, not a read-then-write', async () => {
    // MUTANT 2/3/4 GUARD. The mock cannot evaluate a `where`, so the shape is
    // asserted directly: dropping `usedAt: null`, `purpose`, or the expiry
    // comparison fails here. The live gate (spec §12 steps 4 and 8) is what
    // proves the semantics against real Postgres.
    await consumeToken(db, { purpose: 'password_reset', raw: 'r' })
    expect(db.userToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashToken('password_reset', 'r'),
        purpose: 'password_reset',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    })
    // And the claim comes FIRST. A read-then-write would look up the row
    // before deciding, which is exactly the race two clicks on one link win.
    expect(db.userToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.userToken.findUnique.mock.invocationCallOrder[0],
    )
    expect(db.userToken.create).not.toHaveBeenCalled()
  })

  it('returns the userId when exactly one row was claimed', async () => {
    const res = await consumeToken(db, { purpose: 'email_verify', raw: 'r' })
    expect(res).toEqual({ ok: true, userId: 'u1' })
  })

  it('refuses when zero rows were claimed — used, expired, or unknown', async () => {
    db.userToken.updateMany.mockResolvedValue({ count: 0 })
    const res = await consumeToken(db, { purpose: 'email_verify', raw: 'r' })
    expect(res).toEqual({ ok: false, reason: 'invalid_or_expired' })
    expect(db.userToken.findUnique).not.toHaveBeenCalled()
  })

  it('a token minted for one purpose is rejected at the other', async () => {
    // The hash binding, end to end: the same raw string produces a different
    // lookup key, so the row is simply not found.
    const raw = await mintToken(db, { userId: 'u1', purpose: 'email_verify' })
    const mintedHash = db.userToken.create.mock.calls[0][0].data.tokenHash
    await consumeToken(db, { purpose: 'password_reset', raw })
    const lookedUp = db.userToken.updateMany.mock.calls.at(-1)![0].where.tokenHash
    expect(lookedUp).not.toBe(mintedHash)
  })
})

describe('peekToken', () => {
  it('validates without consuming — no write of any kind', async () => {
    const db = fakeDb()
    db.userToken.findUnique.mockResolvedValue({ userId: 'u1' })
    const ok = await peekToken(db, { purpose: 'password_reset', raw: 'r' })
    expect(ok).toBe(true)
    expect(db.userToken.updateMany).not.toHaveBeenCalled()
    expect(db.userToken.create).not.toHaveBeenCalled()
  })

  it('is false for a token that does not resolve', async () => {
    const db = fakeDb()
    db.userToken.findUnique.mockResolvedValue(null)
    expect(await peekToken(db, { purpose: 'password_reset', raw: 'r' })).toBe(false)
  })
})

describe('invalidateTokens', () => {
  it('marks every outstanding token of that purpose used', async () => {
    const db = fakeDb()
    await invalidateTokens(db, { userId: 'u9', purpose: 'password_reset' })
    expect(db.userToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u9', purpose: 'password_reset', usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run tests/auth/tokens.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/auth/tokens"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'

/**
 * The only place raw bearer tokens are generated, hashed, minted, or consumed.
 *
 * A token in a database is a bearer credential exactly like a password, so
 * nothing here ever persists a raw value — only sha256(purpose + ':' + raw).
 */

/**
 * The closed vocabulary for `UserToken.purpose`.
 *
 * A `String` column plus a shared `as const`, following
 * `src/lib/cards/klp-status.ts`; this schema has no Prisma enums.
 */
export const TOKEN_PURPOSES = ['password_reset', 'email_verify'] as const

export type TokenPurpose = (typeof TOKEN_PURPOSES)[number]

/** Reset is short because a live reset link is an account takeover waiting to happen. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verify: 24 * 60 * 60 * 1000, // 24 hours
}

/**
 * 32 bytes from a CSPRNG, base64url.
 *
 * base64url specifically — the value goes into a URL path segment, and
 * standard base64's `+` and `/` would need escaping that a mail client's link
 * detection will get wrong. Not a UUID: a v4 UUID is 122 bits and some
 * generators are not cryptographically seeded.
 */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * sha256(`${purpose}:${raw}`), hex.
 *
 * Fast on purpose: the input is already 256 bits of CSPRNG output, so slow
 * hashing buys nothing and costs a request.
 *
 * WHY THE PURPOSE IS INSIDE THE HASH. The alternative is a `purpose` clause in
 * every `where`, which is a guard someone can forget. Binding it in means the
 * same raw string produces two different stored values, so a verification
 * token *cannot* be presented at the reset endpoint even if every query filter
 * is dropped. It costs about twenty characters and removes a whole class of
 * confused-deputy bug.
 */
export function hashToken(purpose: TokenPurpose, raw: string): string {
  return createHash('sha256').update(`${purpose}:${raw}`).digest('hex')
}

export function expiresAtFor(purpose: TokenPurpose, now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_TTL_MS[purpose])
}

/**
 * Structural, so the same functions work against `prisma` and against a `tx`
 * inside `prisma.$transaction`. A type-only import — nothing from Prisma
 * exists at runtime in this module.
 */
export type TokenDb = Pick<Prisma.TransactionClient, 'userToken'>

/** Kill every outstanding token of one purpose for one user. */
export async function invalidateTokens(
  db: TokenDb,
  input: { userId: string; purpose: TokenPurpose },
): Promise<void> {
  await db.userToken.updateMany({
    where: { userId: input.userId, purpose: input.purpose, usedAt: null },
    data: { usedAt: new Date() },
  })
}

/**
 * Mint a token and return the RAW value — the only moment it exists outside a
 * URL. Minting invalidates the user's other outstanding tokens of the same
 * purpose, so a second "resend" does not leave the first link live.
 */
export async function mintToken(
  db: TokenDb,
  input: { userId: string; purpose: TokenPurpose },
): Promise<string> {
  await invalidateTokens(db, input)
  const raw = generateRawToken()
  await db.userToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashToken(input.purpose, raw),
      expiresAt: expiresAtFor(input.purpose),
    },
  })
  return raw
}

/**
 * Is this token currently valid? Reads only.
 *
 * Exists so `/reset/[token]` can render a form on GET without burning the
 * token — the POST is what consumes it.
 */
export async function peekToken(
  db: TokenDb,
  input: { purpose: TokenPurpose; raw: string },
): Promise<boolean> {
  const row = await db.userToken.findUnique({
    where: { tokenHash: hashToken(input.purpose, input.raw) },
    select: { usedAt: true, expiresAt: true },
  })
  if (!row) return false
  if (row.usedAt) return false
  return row.expiresAt.getTime() > Date.now()
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid_or_expired' }

/**
 * Claim a token, atomically. THE SINGLE MOST IMPORTANT GUARD IN THIS FEATURE.
 *
 * NOT findFirst-then-update. Two concurrent clicks on the same emailed link
 * would both read `usedAt: null` and both succeed. One conditional update
 * asserting `count === 1` cannot be raced: Postgres serialises the row.
 *
 * The `findUnique` afterwards is safe precisely BECAUSE the claim already
 * fired — this caller now owns the row, so reading its userId is not a
 * check-then-act.
 */
export async function consumeToken(
  db: TokenDb,
  input: { purpose: TokenPurpose; raw: string },
): Promise<ConsumeResult> {
  const tokenHash = hashToken(input.purpose, input.raw)
  const { count } = await db.userToken.updateMany({
    where: {
      tokenHash,
      purpose: input.purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  })
  if (count !== 1) return { ok: false, reason: 'invalid_or_expired' }

  const row = await db.userToken.findUnique({ where: { tokenHash }, select: { userId: true } })
  if (!row) return { ok: false, reason: 'invalid_or_expired' }
  return { ok: true, userId: row.userId }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/auth/tokens.test.ts
```
Expected: PASS, all cases.

- [ ] **Step 5: Mutation-test the three guards (spec §11 mutants 2, 3, 4)**

For each mutation below: apply it to `src/lib/auth/tokens.ts`, run `npx vitest run tests/auth/tokens.test.ts`, confirm it **FAILS**, then revert.

1. Delete `usedAt: null,` from `consumeToken`'s `where`. → must fail.
2. Delete `purpose: input.purpose,` from `consumeToken`'s `where`. → must fail.
3. Delete `expiresAt: { gt: new Date() },` from `consumeToken`'s `where`. → must fail.
4. Change `hashToken` to `createHash('sha256').update(raw).digest('hex')` (drop the purpose binding). → must fail on the cross-purpose tests.

If any mutation leaves the suite green, the test is not a guard — fix the test before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/tokens.ts tests/auth/tokens.test.ts
git commit -m "feat(auth): purpose-bound bearer tokens with atomic single-use consumption"
```

---

### Task 3: `src/lib/mail/` — transport, origin, templates, non-throwing send

Implements spec §9.

**Files:**
- Create: `src/lib/mail/transport.ts`, `src/lib/mail/origin.ts`, `src/lib/mail/templates.ts`, `src/lib/mail/send.ts`
- Test: `tests/mail/origin.test.ts`, `tests/mail/templates.test.ts`, `tests/mail/send.test.ts`
- Modify: `.env.example` (the two new variables land here in Task 12; do not touch it now)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface MailMessage { to: string; subject: string; text: string; html: string }`
  - `interface MailTransport { send(message: MailMessage): Promise<void> }`
  - `resendTransport(apiKey: string, from: string): MailTransport`
  - `consoleTransport: MailTransport`
  - `appOrigin(env?: NodeJS.ProcessEnv): string`
  - `verifyEmailTemplate(input: { origin: string; token: string }): Omit<MailMessage, 'to'>`
  - `passwordResetTemplate(input: { origin: string; token: string }): Omit<MailMessage, 'to'>`
  - `sendVerificationEmail(to: string, token: string): Promise<void>` — never throws
  - `sendPasswordResetEmail(to: string, token: string): Promise<void>` — never throws

- [ ] **Step 1: Write the failing tests**

Create `tests/mail/origin.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { appOrigin } from '@/lib/mail/origin'

describe('appOrigin', () => {
  it('prefers NEXTAUTH_URL', () => {
    expect(appOrigin({ NEXTAUTH_URL: 'https://study.example.com' })).toBe('https://study.example.com')
  })

  it('strips a trailing slash so links do not double up', () => {
    expect(appOrigin({ NEXTAUTH_URL: 'https://study.example.com/' })).toBe('https://study.example.com')
  })

  it('falls back to https://$VERCEL_URL', () => {
    expect(appOrigin({ VERCEL_URL: 'quizlet-v2.vercel.app' })).toBe('https://quizlet-v2.vercel.app')
  })

  it('falls back to localhost last', () => {
    expect(appOrigin({})).toBe('http://localhost:3000')
  })

  it('ignores an empty NEXTAUTH_URL rather than emitting a link to nowhere', () => {
    expect(appOrigin({ NEXTAUTH_URL: '   ', VERCEL_URL: 'x.vercel.app' })).toBe('https://x.vercel.app')
  })

  it('takes NOTHING from a caller-supplied host', () => {
    // Building an absolute URL from the Host header is the classic poisoned
    // reset link: an attacker sets `Host: evil.com` and the server mails YOUR
    // user a link to their own valid token, on the attacker's domain.
    // appOrigin's only argument is an env bag; there is no request in scope.
    expect(appOrigin.length).toBeLessThanOrEqual(1)
  })
})
```

Create `tests/mail/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { verifyEmailTemplate, passwordResetTemplate } from '@/lib/mail/templates'

const ORIGIN = 'https://study.example.com'
const TOKEN = 'abc-123_XYZ'

describe('verifyEmailTemplate', () => {
  it('carries an ABSOLUTE link to /verify/<token> in both text and html', () => {
    const t = verifyEmailTemplate({ origin: ORIGIN, token: TOKEN })
    const link = `${ORIGIN}/verify/${TOKEN}`
    expect(t.text).toContain(link)
    expect(t.html).toContain(link)
  })

  it('has a subject that says what it is', () => {
    expect(verifyEmailTemplate({ origin: ORIGIN, token: TOKEN }).subject).toMatch(/verify/i)
  })

  it('names the 24-hour window', () => {
    expect(verifyEmailTemplate({ origin: ORIGIN, token: TOKEN }).text).toMatch(/24 hours/)
  })
})

describe('passwordResetTemplate', () => {
  it('carries an ABSOLUTE link to /reset/<token>, not /verify/', () => {
    const t = passwordResetTemplate({ origin: ORIGIN, token: TOKEN })
    expect(t.text).toContain(`${ORIGIN}/reset/${TOKEN}`)
    expect(t.html).toContain(`${ORIGIN}/reset/${TOKEN}`)
    expect(t.text).not.toContain('/verify/')
  })

  it('names the 1-hour window', () => {
    expect(passwordResetTemplate({ origin: ORIGIN, token: TOKEN }).text).toMatch(/1 hour/)
  })

  it('tells a recipient who did not ask that they need do nothing', () => {
    // The mail goes to an address someone else may have typed.
    expect(passwordResetTemplate({ origin: ORIGIN, token: TOKEN }).text).toMatch(/ignore/i)
  })
})

describe('both templates', () => {
  it('escape the token before putting it in an href attribute', () => {
    const t = verifyEmailTemplate({ origin: ORIGIN, token: 'a"onmouseover="x' })
    expect(t.html).not.toContain('onmouseover="x"')
  })
})
```

Create `tests/mail/send.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { consoleTransport, resendTransport } from '@/lib/mail/transport'
import { sendVerificationEmail } from '@/lib/mail/send'

const MESSAGE = { to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' }

describe('consoleTransport', () => {
  it('prints the message, link included, so an agent can drive the flow locally', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await consoleTransport.send({ ...MESSAGE, text: 'open https://x.test/verify/tok' })
    const printed = log.mock.calls.flat().join('\n')
    expect(printed).toContain('a@example.com')
    expect(printed).toContain('https://x.test/verify/tok')
    log.mockRestore()
  })
})

describe('resendTransport', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs to the Resend API with a bearer key and the from address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await resendTransport('re_key', 'Quizlet <no@x.test>').send(MESSAGE)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ from: 'Quizlet <no@x.test>', to: 'a@example.com', subject: 's' })
  })

  it('throws on a non-ok response, so send.ts is the one that decides to swallow it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad domain' }),
    )
    await expect(resendTransport('re_key', 'f@x.test').send(MESSAGE)).rejects.toThrow()
  })
})

describe('sendVerificationEmail', () => {
  const OLD = { ...process.env }
  afterEach(() => {
    process.env = { ...OLD }
    vi.restoreAllMocks()
  })

  it('NEVER throws, even when the transport blows up', async () => {
    // It runs inside after(), where an exception is unhandled and silently
    // kills the callback. Swallowing here is deliberate; the cost is that a
    // broken mail configuration is quiet.
    process.env.RESEND_API_KEY = 're_key'
    process.env.MAIL_FROM = 'Quizlet <no@x.test>'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network is down')))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendVerificationEmail('a@example.com', 'tok')).resolves.toBeUndefined()
    expect(err.mock.calls.flat().join(' ')).toContain('[mail]')
  })

  it('uses the console transport when RESEND_API_KEY is absent', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendVerificationEmail('a@example.com', 'tok')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('/verify/tok')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run tests/mail
```
Expected: FAIL — unresolved imports for all three modules.

- [ ] **Step 3: Write `src/lib/mail/origin.ts`**

```ts
/**
 * Where absolute links in outgoing mail point.
 *
 * FROM ENV, NEVER FROM THE REQUEST. Building an absolute URL out of the `Host`
 * header is the classic poisoned-reset-link bug: an attacker sets
 * `Host: evil.com`, and your server mails *your user* a link carrying their
 * own valid token, on the attacker's domain. There is deliberately no request
 * parameter here for anyone to reach for.
 */
export function appOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.NEXTAUTH_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const vercel = env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel}`

  return 'http://localhost:3000'
}
```

- [ ] **Step 4: Write `src/lib/mail/transport.ts`**

```ts
export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>
}

/**
 * Resend over plain `fetch`.
 *
 * No `resend` npm dependency, deliberately: their API is one POST, wrapping it
 * is ten lines, and this keeps the transport swappable. Also keeps the module
 * edge-safe — it imports nothing.
 *
 * This THROWS on failure. Deciding to swallow is `send.ts`'s job, because only
 * it knows the call is happening inside `after()`.
 */
export function resendTransport(apiKey: string, from: string): MailTransport {
  return {
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })
      if (!res.ok) {
        throw new Error(`Resend rejected the message: ${res.status} ${await res.text()}`)
      }
    },
  }
}

/**
 * A design goal, not a dev convenience.
 *
 * With RESEND_API_KEY absent, verification and reset links print to the server
 * log — so an agent can drive this whole feature end to end locally by reading
 * links out of stdout, with no inbox involved.
 */
export const consoleTransport: MailTransport = {
  async send(message) {
    console.log(
      ['[mail] (console transport — no RESEND_API_KEY set)',
       `  to:      ${message.to}`,
       `  subject: ${message.subject}`,
       message.text].join('\n'),
    )
  },
}
```

- [ ] **Step 5: Write `src/lib/mail/templates.ts`**

```ts
import type { MailMessage } from '@/lib/mail/transport'

/** Pure — the interesting half of mail, so it can be unit-tested. */
export type MailBody = Omit<MailMessage, 'to'>

/** Minimal, because the only interpolated values are an origin and a token. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function linkBody(input: { heading: string; blurb: string; url: string; cta: string }): string {
  const safe = escapeHtml(input.url)
  return [
    `<p>${escapeHtml(input.heading)}</p>`,
    `<p>${escapeHtml(input.blurb)}</p>`,
    `<p><a href="${safe}">${escapeHtml(input.cta)}</a></p>`,
    `<p>${safe}</p>`,
  ].join('\n')
}

export function verifyEmailTemplate(input: { origin: string; token: string }): MailBody {
  const url = `${input.origin}/verify/${input.token}`
  return {
    subject: 'Verify your email address',
    text: [
      'Confirm your email address to finish setting up your account.',
      '',
      url,
      '',
      'This link works for 24 hours. If you did not create an account, ignore this message.',
    ].join('\n'),
    html: linkBody({
      heading: 'Confirm your email address to finish setting up your account.',
      blurb: 'This link works for 24 hours. If you did not create an account, ignore this message.',
      url,
      cta: 'Verify my email',
    }),
  }
}

export function passwordResetTemplate(input: { origin: string; token: string }): MailBody {
  const url = `${input.origin}/reset/${input.token}`
  return {
    subject: 'Reset your password',
    text: [
      'Choose a new password for your account.',
      '',
      url,
      '',
      'This link works for 1 hour and can be used once. If you did not ask for it, ignore this message — nothing has changed.',
    ].join('\n'),
    html: linkBody({
      heading: 'Choose a new password for your account.',
      blurb:
        'This link works for 1 hour and can be used once. If you did not ask for it, ignore this message — nothing has changed.',
      url,
      cta: 'Set a new password',
    }),
  }
}
```

- [ ] **Step 6: Write `src/lib/mail/send.ts`**

```ts
import { appOrigin } from '@/lib/mail/origin'
import { consoleTransport, resendTransport, type MailTransport } from '@/lib/mail/transport'
import { passwordResetTemplate, verifyEmailTemplate } from '@/lib/mail/templates'

const DEFAULT_FROM = 'Quizlet <onboarding@resend.dev>'

/**
 * Resolved per call rather than at module load, so a test (and a dev server
 * restarted with a new key) sees the current environment.
 */
function transport(): MailTransport {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return consoleTransport
  return resendTransport(key, process.env.MAIL_FROM?.trim() || DEFAULT_FROM)
}

/**
 * MUST NEVER THROW.
 *
 * Every caller runs inside `after()`, where an exception is unhandled and
 * silently kills the rest of the callback — so a mail failure would take out
 * whatever else that callback was doing. It logs with a distinctive `[mail]`
 * prefix instead.
 *
 * The cost, stated plainly: a broken mail configuration is QUIET. A user whose
 * message bounced sees "check your inbox" and nothing arrives. The console
 * transport and the live gate are what cover that; there is no bounce handling
 * and no in-app delivery dashboard.
 */
async function sendQuietly(to: string, body: { subject: string; text: string; html: string }) {
  try {
    await transport().send({ to, ...body })
  } catch (error) {
    console.error('[mail] delivery failed', { to, subject: body.subject, error })
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  await sendQuietly(to, verifyEmailTemplate({ origin: appOrigin(), token }))
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  await sendQuietly(to, passwordResetTemplate({ origin: appOrigin(), token }))
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run tests/mail
```
Expected: PASS.

- [ ] **Step 8: Prove the console transport prints a usable link**

```bash
npx tsx -e "require('./src/lib/mail/send').sendVerificationEmail('you@example.com','TESTTOKEN')"
```
Expected: a `[mail]` block containing `http://localhost:3000/verify/TESTTOKEN`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mail tests/mail
git commit -m "feat(mail): resend + console transports, pure templates, non-throwing send"
```

---

### Task 4: `src/lib/invites/code.ts` + `scripts/mint-invite.ts` + `npm run invite`

Implements spec §6 (format, normalisation, minting).

**Files:**
- Create: `src/lib/invites/code.ts`, `scripts/mint-invite.ts`
- Modify: `package.json` (scripts)
- Test: `tests/invites/code.test.ts`

**Interfaces:**
- Consumes: the `InviteCode` model from Task 1.
- Produces:
  - `INVITE_ALPHABET: string` (32 chars), `INVITE_CODE_LENGTH: 10`
  - `generateInviteCode(): string` — normalised form, no hyphen
  - `normalizeInviteCode(raw: string): string`
  - `formatInviteCode(code: string): string` — `XXXXX-XXXXX`

- [ ] **Step 1: Write the failing test**

Create `tests/invites/code.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
  normalizeInviteCode,
  formatInviteCode,
} from '@/lib/invites/code'

describe('the alphabet', () => {
  it('is Crockford Base32 — 32 symbols with no I, L, O or U', () => {
    expect(INVITE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ')
    expect(INVITE_ALPHABET).toHaveLength(32)
    for (const banned of ['I', 'L', 'O', 'U']) {
      expect(INVITE_ALPHABET).not.toContain(banned)
    }
  })
})

describe('generateInviteCode', () => {
  it('is 10 symbols from the alphabet — 50 bits', () => {
    const code = generateInviteCode()
    expect(code).toHaveLength(INVITE_CODE_LENGTH)
    for (const ch of code) expect(INVITE_ALPHABET).toContain(ch)
  })

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteCode()))
    expect(seen.size).toBe(500)
  })

  it('produces codes that survive their own normalisation', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode()
      expect(normalizeInviteCode(code)).toBe(code)
    }
  })
})

describe('normalizeInviteCode', () => {
  it('uppercases', () => {
    expect(normalizeInviteCode('abcdef2345')).toBe('ABCDEF2345')
  })

  it('strips hyphens and spaces — the display form round-trips', () => {
    expect(normalizeInviteCode('ABCDE-FG234')).toBe('ABCDEFG234')
    expect(normalizeInviteCode('  ABCDE FG234  ')).toBe('ABCDEFG234')
  })

  it('maps every ambiguous character the way Crockford says', () => {
    // Read aloud or written down, these are the four that get confused.
    expect(normalizeInviteCode('I')).toBe('1')
    expect(normalizeInviteCode('l')).toBe('1')
    expect(normalizeInviteCode('L')).toBe('1')
    expect(normalizeInviteCode('O')).toBe('0')
    expect(normalizeInviteCode('o')).toBe('0')
  })

  it('handles a realistic mis-transcription end to end', () => {
    // Someone reads "0J1K..." aloud and the listener writes O, J, l, K.
    expect(normalizeInviteCode('oj1k-2m3n4p')).toBe(normalizeInviteCode('0J1K2M3N4P'))
  })

  it('drops anything outside the alphabet rather than passing it to a query', () => {
    expect(normalizeInviteCode("ABCDE'; DROP TABLE--FG234")).toBe('ABCDEDR0PTABLEFG234')
  })

  it('is idempotent', () => {
    const once = normalizeInviteCode('abc-de f2 34')
    expect(normalizeInviteCode(once)).toBe(once)
  })
})

describe('formatInviteCode', () => {
  it('groups a 10-symbol code as XXXXX-XXXXX', () => {
    expect(formatInviteCode('ABCDEFG234')).toBe('ABCDE-FG234')
  })

  it('round-trips through normalisation', () => {
    const code = generateInviteCode()
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/invites/code.test.ts
```
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write `src/lib/invites/code.ts`**

```ts
import { randomBytes } from 'node:crypto'

/**
 * Crockford Base32 — no I, L, O or U.
 *
 * I/L look like 1, O looks like 0, and U is excluded so a random draw cannot
 * spell something unfortunate. 5 bits per symbol.
 */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 10 symbols x 5 bits = 50 bits. */
export const INVITE_CODE_LENGTH = 10

/**
 * A fresh code in its normalised (hyphen-free) form.
 *
 * No rejection sampling is needed and its absence is not an oversight: the
 * alphabet is exactly 32 symbols and 256 % 32 === 0, so `byte % 32` is already
 * uniform over the alphabet. With a non-power-of-two alphabet this would be
 * biased and would need a redraw loop.
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let out = ''
  for (const byte of bytes) out += INVITE_ALPHABET[byte % INVITE_ALPHABET.length]
  return out
}

/**
 * Crockford's decoding rules, so a code survives being read aloud, written
 * down, or typed with the hyphen the display form adds.
 *
 * Order matters: uppercase first, THEN substitute the ambiguous characters
 * (so lowercase `l` and `o` are covered by the same two rules), THEN drop
 * everything still outside the alphabet. Dropping first would delete the very
 * characters the substitution exists to rescue.
 */
export function normalizeInviteCode(raw: string): string {
  const upper = raw.toUpperCase()
  const substituted = upper.replace(/[IL]/g, '1').replace(/O/g, '0')
  let out = ''
  for (const ch of substituted) {
    if (INVITE_ALPHABET.includes(ch)) out += ch
  }
  return out
}

/** Display only. `XXXXX-XXXXX` is easier to read back over a phone. */
export function formatInviteCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)}-${code.slice(half)}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/invites/code.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write `scripts/mint-invite.ts`**

```ts
/**
 * Mint, list and revoke invite codes.
 *
 * Terminal-only, deliberately: no admin role, no admin page, no new privilege
 * concept. Revisit when handing out codes is frequent enough to be annoying.
 *
 * Run:
 *   npm run invite -- --uses 5 --days 30 --label "discord launch"
 *   npm run invite -- --list
 *   npm run invite -- --revoke ABCDE-FG234
 */

import { prisma } from '../src/lib/db'
import { generateInviteCode, formatInviteCode, normalizeInviteCode } from '../src/lib/invites/code'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  // First statement in main(), matching scripts/seed-dev-user.ts. Minting a
  // code against production from a dev shell hands out real accounts.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('mint-invite refuses to run with NODE_ENV=production')
  }

  if (has('list')) {
    const codes = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })
    if (codes.length === 0) {
      console.log('No invite codes yet.')
      return
    }
    for (const c of codes) {
      const used = c.maxUses - c.usesRemaining
      const state = c.revokedAt
        ? 'REVOKED'
        : c.expiresAt && c.expiresAt.getTime() <= Date.now()
          ? 'EXPIRED'
          : c.usesRemaining === 0
            ? 'EXHAUSTED'
            : 'live'
      console.log(
        `${formatInviteCode(c.code)}  ${used} of ${c.maxUses} used  ${state}` +
          (c.label ? `  "${c.label}"` : ''),
      )
    }
    return
  }

  const revoke = flag('revoke')
  if (revoke) {
    const code = normalizeInviteCode(revoke)
    const { count } = await prisma.inviteCode.updateMany({
      where: { code, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    console.log(count === 1 ? `Revoked ${formatInviteCode(code)}.` : 'No live code matched.')
    return
  }

  const uses = Number(flag('uses') ?? 1)
  if (!Number.isInteger(uses) || uses < 1) {
    throw new Error('--uses must be a positive integer')
  }
  const days = flag('days') ? Number(flag('days')) : undefined
  if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
    throw new Error('--days must be a positive number')
  }

  const code = generateInviteCode()
  await prisma.inviteCode.create({
    data: {
      code,
      label: flag('label') ?? null,
      maxUses: uses,
      // Both counters start equal; maxUses never moves again, so
      // `maxUses - usesRemaining` is always the used count.
      usesRemaining: uses,
      expiresAt: days === undefined ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    },
  })

  console.log('Invite code (printed once — it is not shown again by --list in this form):')
  console.log(`  ${formatInviteCode(code)}`)
  console.log(`  uses:    ${uses}`)
  console.log(`  expires: ${days === undefined ? 'never' : `${days} days`}`)
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

- [ ] **Step 6: Add the npm script**

In `package.json`, after the `"seed:dev-user"` line, add:

```json
    "invite": "tsx --env-file=.env scripts/mint-invite.ts"
```

- [ ] **Step 7: Run the script for real**

```bash
npm run invite -- --uses 2 --days 30 --label "plan task 4 smoke test"
npm run invite -- --list
```
Expected: a `XXXXX-XXXXX` code printed, then listed as `0 of 2 used  live  "plan task 4 smoke test"`. **Keep this code** — Task 5's live check uses it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/invites tests/invites scripts/mint-invite.ts package.json
git commit -m "feat(invites): Crockford Base32 codes plus a mint/list/revoke script"
```

---

### Task 5: `signUp` redeems an invite and sends verification mail

Implements spec §7.1. **The second security-core task — review this hardest.**

**Files:**
- Create: `src/lib/invites/redeem.ts`
- Create: `src/app/signup/check-email/page.tsx` (minimal; Task 6 adds the resend control)
- Modify: `src/actions/auth-signup.ts`, `src/components/auth/SignUpForm.tsx`, `src/app/signup/page.tsx`
- Test: `tests/invites/redeem.test.ts`, `tests/actions/signup.test.ts` (extend)

**Interfaces:**
- Consumes: `mintToken` (Task 2), `sendVerificationEmail` (Task 3), `normalizeInviteCode` (Task 4).
- Produces:
  - `class InviteUnavailableError extends Error` with `readonly kind = 'invite_unavailable'`
  - `INVITE_UNAVAILABLE_MESSAGE: string`
  - `previewInviteCode(db: InviteDb, code: string): Promise<boolean>` — the cheap pre-check
  - `redeemInviteCode(tx: InviteTx, code: string): Promise<string>` — atomic; returns the `InviteCode.id`; throws `InviteUnavailableError`
  - `signUp(input: { handle, email, password, inviteCode })` — the `inviteCode` field is new and required

- [ ] **Step 1: Write the failing test for the redeem module**

Create `tests/invites/redeem.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  previewInviteCode,
  redeemInviteCode,
  InviteUnavailableError,
} from '@/lib/invites/redeem'

function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    inviteCode: {
      findUnique: vi.fn().mockResolvedValue({
        usesRemaining: 3,
        revokedAt: null,
        expiresAt: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'inv1' }),
      ...overrides,
    },
  }
}

describe('previewInviteCode — the cheap filter, NOT the gate', () => {
  it('normalises before querying, so a hyphenated code works', async () => {
    const db = fakeDb()
    await previewInviteCode(db, 'ABCDE-FG234')
    expect(db.inviteCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'ABCDEFG234' },
      select: { usesRemaining: true, revokedAt: true, expiresAt: true },
    })
  })

  it('rejects an unknown code', async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(null) })
    expect(await previewInviteCode(db, 'ABCDEFG234')).toBe(false)
  })

  it('rejects an exhausted, a revoked, and an expired code', async () => {
    const exhausted = fakeDb({
      findUnique: vi.fn().mockResolvedValue({ usesRemaining: 0, revokedAt: null, expiresAt: null }),
    })
    expect(await previewInviteCode(exhausted, 'X')).toBe(false)

    const revoked = fakeDb({
      findUnique: vi.fn().mockResolvedValue({ usesRemaining: 5, revokedAt: new Date(), expiresAt: null }),
    })
    expect(await previewInviteCode(revoked, 'X')).toBe(false)

    const expired = fakeDb({
      findUnique: vi.fn().mockResolvedValue({
        usesRemaining: 5,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      }),
    })
    expect(await previewInviteCode(expired, 'X')).toBe(false)
  })

  it('accepts a live code with a future expiry', async () => {
    const db = fakeDb({
      findUnique: vi.fn().mockResolvedValue({
        usesRemaining: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    })
    expect(await previewInviteCode(db, 'X')).toBe(true)
  })
})

describe('redeemInviteCode — the gate', () => {
  it('decrements with ONE atomic conditional update carrying every guard', async () => {
    // MUTANT 1 GUARD. A mock cannot evaluate a `where`, so the clause set is
    // asserted directly — removing `usesRemaining: { gt: 0 }` (or the revoked
    // or expiry clause) fails here. Spec §12 step 5 proves the semantics live.
    const db = fakeDb()
    await redeemInviteCode(db, 'abcde-fg234')
    const call = db.inviteCode.updateMany.mock.calls[0][0]
    expect(call.where.code).toBe('ABCDEFG234')
    expect(call.where.usesRemaining).toEqual({ gt: 0 })
    expect(call.where.revokedAt).toBeNull()
    expect(call.where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ])
    expect(call.data).toEqual({ usesRemaining: { decrement: 1 } })
  })

  it('returns the invite id so the caller can record the audit trail', async () => {
    const db = fakeDb()
    expect(await redeemInviteCode(db, 'ABCDEFG234')).toBe('inv1')
  })

  it('throws InviteUnavailableError when the decrement claimed nothing', async () => {
    // count === 0 means dead, revoked, expired — or its last slot was taken by
    // someone else between the pre-check and here. Two people racing for the
    // final slot cannot both get in.
    const db = fakeDb({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) })
    await expect(redeemInviteCode(db, 'X')).rejects.toBeInstanceOf(InviteUnavailableError)
  })

  it('never reads before it writes', async () => {
    const db = fakeDb()
    await redeemInviteCode(db, 'ABCDEFG234')
    const order = [
      db.inviteCode.updateMany.mock.invocationCallOrder[0],
      db.inviteCode.findFirst.mock.invocationCallOrder[0],
    ]
    expect(order[0]).toBeLessThan(order[1])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/invites/redeem.test.ts
```
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write `src/lib/invites/redeem.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { normalizeInviteCode } from '@/lib/invites/code'

export type InviteDb = Pick<Prisma.TransactionClient, 'inviteCode'>

/**
 * Invite-code errors are EXEMPT from the enumeration rule and may be specific.
 * A code is not a user; saying it is dead enumerates nothing about people, and
 * guessing codes is bounded by 50 bits plus the Firewall rule on POST /signup.
 */
export const INVITE_UNAVAILABLE_MESSAGE =
  'That invite code isn’t valid, has expired, or has been used up.'

export class InviteUnavailableError extends Error {
  readonly kind = 'invite_unavailable'
  constructor() {
    super(INVITE_UNAVAILABLE_MESSAGE)
    this.name = 'InviteUnavailableError'
  }
}

/**
 * A COST FILTER, NOT THE GATE.
 *
 * It exists so an obviously dead code is rejected BEFORE ~250ms of bcrypt —
 * otherwise /signup is a CPU amplifier anyone can fire with random codes. It
 * is TOCTOU by construction and that is fine: `redeemInviteCode` decides.
 */
export async function previewInviteCode(db: InviteDb, raw: string): Promise<boolean> {
  const code = normalizeInviteCode(raw)
  if (!code) return false

  const row = await db.inviteCode.findUnique({
    where: { code },
    select: { usesRemaining: true, revokedAt: true, expiresAt: true },
  })
  if (!row) return false
  if (row.usesRemaining <= 0) return false
  if (row.revokedAt) return false
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false
  return true
}

/**
 * THE GATE. Claim one slot, atomically, and return the invite's id.
 *
 * `count === 0` means the code was dead, revoked, expired, or its last use was
 * taken by someone else between the pre-check and here. Two people racing for
 * the final slot cannot both get in — Postgres serialises the row.
 *
 * MUST be called inside the same transaction as `user.create`, so a P2002 on a
 * duplicate email or handle rolls the decrement back. A typo must not burn
 * someone's code.
 */
export async function redeemInviteCode(db: InviteDb, raw: string): Promise<string> {
  const code = normalizeInviteCode(raw)
  const { count } = await db.inviteCode.updateMany({
    where: {
      code,
      usesRemaining: { gt: 0 },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: { usesRemaining: { decrement: 1 } },
  })
  if (count !== 1) throw new InviteUnavailableError()

  const row = await db.inviteCode.findFirst({ where: { code }, select: { id: true } })
  if (!row) throw new InviteUnavailableError()
  return row.id
}
```

- [ ] **Step 4: Run the redeem tests to verify they pass**

```bash
npx vitest run tests/invites/redeem.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mutation-test the invite gate (spec §11 mutant 1)**

Apply each, run `npx vitest run tests/invites/redeem.test.ts`, confirm FAIL, revert:
1. Delete `usesRemaining: { gt: 0 },` from `redeemInviteCode`'s `where`.
2. Delete `revokedAt: null,`.
3. Change `if (count !== 1)` to `if (count < 0)`.

- [ ] **Step 6: Rewrite `src/actions/auth-signup.ts`**

Replace the whole file:

```ts
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
```

- [ ] **Step 7: Extend `tests/actions/signup.test.ts`**

Replace the mock block at the top (lines 1-24) with the version below, then **update every existing `signUp(VALID)` call site** — `VALID` now carries `inviteCode`, so the existing bodies need no other change:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  create: vi.fn(),
  hashPassword: vi.fn(),
  inviteFindUnique: vi.fn(),
  inviteUpdateMany: vi.fn(),
  inviteFindFirst: vi.fn(),
  mintToken: vi.fn(),
  sendVerificationEmail: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}))

// after() runs its callback out of band in production. The tests need to be
// able to await it, so the mock records the promise instead of dropping it.
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterTasks.push(Promise.resolve().then(fn))
  },
}))

// `prisma.user` deliberately exposes NO create: the only legitimate create is
// on the transaction client, so a version that writes outside the transaction
// throws rather than passing silently.
vi.mock('@/lib/db', () => ({
  prisma: {
    inviteCode: { findUnique: h.inviteFindUnique },
    user: {},
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        inviteCode: { updateMany: h.inviteUpdateMany, findFirst: h.inviteFindFirst },
        user: { create: h.create },
      }),
  },
}))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword }
})
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return { ...actual, mintToken: h.mintToken }
})
vi.mock('@/lib/mail/send', () => ({ sendVerificationEmail: h.sendVerificationEmail }))

import { signUp } from '@/actions/auth-signup'

const VALID = {
  handle: 'alice_ng',
  email: 'alice@example.com',
  password: 'a'.repeat(12),
  inviteCode: 'ABCDE-FG234',
}

async function drainAfter() {
  const tasks = h.afterTasks.splice(0)
  await Promise.all(tasks)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterTasks.length = 0
  process.env.CREDENTIALS_SIGNUP_ENABLED = 'true'
  h.hashPassword.mockResolvedValue('$2b$12$hashed')
  h.create.mockResolvedValue({ id: 'u1' })
  h.inviteFindUnique.mockResolvedValue({ usesRemaining: 3, revokedAt: null, expiresAt: null })
  h.inviteUpdateMany.mockResolvedValue({ count: 1 })
  h.inviteFindFirst.mockResolvedValue({ id: 'inv1' })
  h.mintToken.mockResolvedValue('raw-token')
  h.sendVerificationEmail.mockResolvedValue(undefined)
})

afterEach(() => {
  delete process.env.CREDENTIALS_SIGNUP_ENABLED
})
```

Then append this new describe block to the end of the file:

```ts
describe('invite redemption', () => {
  it('records which code let the account in, and creates it UNVERIFIED', async () => {
    const res = await signUp(VALID)
    expect(res.success).toBe(true)
    const data = h.create.mock.calls[0][0].data
    expect(data.invitedByCodeId).toBe('inv1')
    expect(data.emailVerified).toBeNull()
  })

  it('refuses a dead code BEFORE spending a bcrypt round', async () => {
    // /signup would otherwise be a CPU amplifier anyone can fire with random
    // codes: ~250ms of hashing per request, before any account exists.
    h.inviteFindUnique.mockResolvedValue({ usesRemaining: 0, revokedAt: null, expiresAt: null })
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/invite code/i)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses an unknown code', async () => {
    h.inviteFindUnique.mockResolvedValue(null)
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses when the last slot is taken between the pre-check and the decrement', async () => {
    // The pre-check passes, the atomic update claims nothing. This is the race
    // the counter exists for, and the pre-check cannot see it.
    h.inviteUpdateMany.mockResolvedValue({ count: 0 })
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/invite code/i)
  })

  it('decrements and creates on the SAME transaction client', async () => {
    // `prisma.user` has no `create` in the mock, so a create outside the
    // transaction throws. That is the structural guarantee that a P2002
    // rollback also restores the invite use — a typo must not burn a code.
    await signUp(VALID)
    expect(h.inviteUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('restores the invite use on a duplicate account, via the rollback', async () => {
    h.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    // Neither field named, exactly as before.
    expect(res.error).not.toMatch(/email/i)
    // And no compensating write: the transaction is what restores it.
    expect(h.inviteUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.inviteUpdateMany.mock.calls[0][0].data).toEqual({ usesRemaining: { decrement: 1 } })
  })
})

describe('verification mail', () => {
  it('mints an email_verify token and sends it, in after()', async () => {
    await signUp(VALID)
    // Nothing sent yet — the response was already returned.
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.mintToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'email_verify',
    })
    expect(h.sendVerificationEmail).toHaveBeenCalledWith('alice@example.com', 'raw-token')
  })

  it('sends nothing when the account was not created', async () => {
    h.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    await signUp(VALID)
    await drainAfter()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 8: Add the invite field to `SignUpForm`**

In `src/components/auth/SignUpForm.tsx`:

1. Add state: `const [inviteCode, setInviteCode] = useState('')`
2. Change the call to `await signUp({ handle, email, password, inviteCode })`
3. **Replace the auto-sign-in block** (the `signIn('credentials', ...)` call and everything after it inside `startTransition`) with:

```ts
      // No auto-sign-in any more: the account is unverified, and
      // authorizeCredentials refuses an unverified credentials account. Send
      // them to the screen that shows the address they typed instead — that is
      // the primary typo defence, and it works better than the email itself,
      // because they see `me@gmial.com` while they still remember typing it.
      router.push(`/signup/check-email?email=${encodeURIComponent(res.data.email)}`)
```

Also delete the now-unused `import { signIn } from 'next-auth/react'`.

4. Add the field as the **first** input in the form, above Handle:

```tsx
      <div className="space-y-1">
        <label htmlFor="signup-invite" className="text-sm font-medium">
          Invite code
        </label>
        <Input
          id="signup-invite"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          autoComplete="off"
          placeholder="ABCDE-FG234"
        />
        <p className="text-xs text-muted-foreground">
          Hyphens, spaces and letter case do not matter.
        </p>
      </div>
```

- [ ] **Step 9: Create the minimal `check-email` page**

Create `src/app/signup/check-email/page.tsx`:

```tsx
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Shows the address AS TYPED. This is the primary typo defence, and it beats
 * the email itself: the user sees `me@gmial.com` on screen while they still
 * remember typing it.
 *
 * Not gated by CREDENTIALS_SIGNUP_ENABLED — someone who signed up before the
 * flag was flipped off still needs to be able to read this.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const params = await searchParams
  // Capped rather than trusted: this is a query parameter and it is echoed
  // back to the page. React escapes it, so the cap is about a wall of text,
  // not about injection.
  const email = (params.email ?? '').slice(0, 200)

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            {email ? (
              <>
                We sent a verification link to <strong>{email}</strong>. Open it to finish setting
                up your account.
              </>
            ) : (
              <>We sent you a verification link. Open it to finish setting up your account.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The link works for 24 hours. If the address above is wrong, sign up again with the
            correct one.
          </p>
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 10: Fix the stale copy on the sign-up page**

In `src/app/signup/page.tsx`, replace the `CardDescription` body:

```tsx
          <CardDescription>
            You need an invite code. We will email you a link to confirm your address.
          </CardDescription>
```

- [ ] **Step 11: Run the tests**

```bash
npx vitest run tests/actions/signup.test.ts tests/invites
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: PASS; `tsc` silent.

- [ ] **Step 12: Commit**

```bash
git add src/lib/invites/redeem.ts src/actions/auth-signup.ts src/components/auth/SignUpForm.tsx src/app/signup tests/actions/signup.test.ts tests/invites/redeem.test.ts
git commit -m "feat(signup): redeem an invite code atomically and mail a verification link"
```

---

### Task 6: `resendVerification` + the resend control

Implements spec §7.2 and the §5 invariant.

**Files:**
- Create: `src/actions/auth-verify.ts`, `src/components/auth/ResendVerification.tsx`
- Modify: `src/app/signup/check-email/page.tsx`
- Test: `tests/actions/auth-verify.test.ts`, `tests/components/ResendVerification.test.tsx`

**Interfaces:**
- Consumes: `mintToken` (Task 2), `sendVerificationEmail` (Task 3), `identifierWhere` (`@/lib/auth/identifier`).
- Produces: `RESEND_FIXED_MESSAGE: string`; `resendVerification(input: { identifier: string }): Promise<ActionResult<void>>` — **always** `{ success: true }`.

- [ ] **Step 1: Write the failing action test**

Create `tests/actions/auth-verify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The mock set is deliberately wider than this task needs: Task 7 adds
// consumeEmailVerification to the same file and would otherwise have to
// rewrite these blocks.
const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  mintToken: vi.fn(),
  consumeToken: vi.fn(),
  invalidateTokens: vi.fn(),
  txUserUpdate: vi.fn(),
  sendVerificationEmail: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}))

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterTasks.push(Promise.resolve().then(fn))
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: h.findFirst },
    $transaction: (fn: (tx: unknown) => unknown) => fn({ user: { update: h.txUserUpdate } }),
  },
}))
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return {
    ...actual,
    mintToken: h.mintToken,
    consumeToken: h.consumeToken,
    invalidateTokens: h.invalidateTokens,
  }
})
vi.mock('@/lib/mail/send', () => ({ sendVerificationEmail: h.sendVerificationEmail }))

import { resendVerification, RESEND_FIXED_MESSAGE } from '@/actions/auth-verify'

async function drainAfter() {
  await Promise.all(h.afterTasks.splice(0))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterTasks.length = 0
  h.mintToken.mockResolvedValue('raw-token')
})

describe('the enumeration invariant', () => {
  const CASES: Array<[string, unknown]> = [
    ['an unverified account', { id: 'u1', email: 'a@example.com', emailVerified: null }],
    ['an ALREADY verified account', { id: 'u1', email: 'a@example.com', emailVerified: new Date() }],
    ['no account at all', null],
  ]

  it('returns a byte-identical result for every input', async () => {
    const results: string[] = []
    for (const [, row] of CASES) {
      h.findFirst.mockResolvedValue(row)
      const res = await resendVerification({ identifier: 'whatever' })
      results.push(JSON.stringify(res))
    }
    expect(new Set(results).size).toBe(1)
    expect(JSON.parse(results[0])).toEqual({ success: true, data: undefined })
  })

  it('does ALL of its work inside after(), so the two paths cannot be timed apart', async () => {
    // Identical text is not sufficient. Sending mail takes a couple of hundred
    // milliseconds and not sending takes none, so a caller can time the
    // difference and learn which addresses have accounts.
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: null })
    await resendVerification({ identifier: 'a@example.com' })
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.sendVerificationEmail).toHaveBeenCalled()
  })
})

describe('resendVerification', () => {
  it('mints and sends for an unverified account', async () => {
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: null })
    await resendVerification({ identifier: 'a@example.com' })
    await drainAfter()
    expect(h.mintToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'email_verify',
    })
    expect(h.sendVerificationEmail).toHaveBeenCalledWith('a@example.com', 'raw-token')
  })

  it('sends NOTHING to an already-verified account', async () => {
    // Otherwise "resend" is a way to make the app send unlimited messages to
    // any address that has ever registered.
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: new Date() })
    await resendVerification({ identifier: 'a@example.com' })
    await drainAfter()
    expect(h.mintToken).not.toHaveBeenCalled()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('sends nothing for an unknown identifier', async () => {
    h.findFirst.mockResolvedValue(null)
    await resendVerification({ identifier: 'nobody@example.invalid' })
    await drainAfter()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('accepts a handle as well as an email', async () => {
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: null })
    await resendVerification({ identifier: 'Alice_NG' })
    await drainAfter()
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'alice_ng' }, { normalizedHandle: 'alice_ng' }],
    })
  })

  it('never lets a mail failure escape into the after() callback', async () => {
    h.findFirst.mockRejectedValue(new Error('database is down'))
    await resendVerification({ identifier: 'a@example.com' })
    await expect(drainAfter()).resolves.toBeDefined()
  })

  it('exports the fixed message so the UI cannot invent a second one', () => {
    expect(RESEND_FIXED_MESSAGE).toMatch(/if that account/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/actions/auth-verify.test.ts
```
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write `src/actions/auth-verify.ts`**

```ts
'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { mintToken } from '@/lib/auth/tokens'
import { sendVerificationEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

/**
 * ONE message for every input. The UI must render this and never branch.
 */
export const RESEND_FIXED_MESSAGE =
  'If that account exists and still needs verifying, we’ve sent a new link to its email address.'

/**
 * Send another verification link.
 *
 * THE ENUMERATION INVARIANT (design §5): one fixed response for every input,
 * and ALL work inside after(). Identical text alone is not sufficient —
 * sending mail takes a couple of hundred milliseconds and not sending takes
 * none, so a caller can time the difference and learn which addresses have
 * accounts. after() returns the response before any of that work begins.
 */
export async function resendVerification(input: {
  identifier: string
}): Promise<ActionResult<void>> {
  const identifier = typeof input.identifier === 'string' ? input.identifier : ''

  after(async () => {
    try {
      const user = await prisma.user.findFirst({
        where: identifierWhere(identifier),
        select: { id: true, email: true, emailVerified: true },
      })
      // Only an account that exists AND still needs verifying. Re-sending to a
      // verified account turns "resend" into unlimited mail to any address that
      // has ever registered here.
      if (!user || user.emailVerified) return

      const token = await mintToken(prisma, { userId: user.id, purpose: 'email_verify' })
      await sendVerificationEmail(user.email, token)
    } catch (error) {
      // after() has no error boundary: an exception here is unhandled and
      // kills the callback silently. Logged with the same prefix send.ts uses.
      console.error('[mail] resendVerification failed', error)
    }
  })

  return { success: true, data: undefined }
}
```

- [ ] **Step 4: Run the action tests to verify they pass**

```bash
npx vitest run tests/actions/auth-verify.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write the resend component**

Create `src/components/auth/ResendVerification.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resendVerification, RESEND_FIXED_MESSAGE } from '@/actions/auth-verify'

/**
 * The response NEVER varies. There is deliberately no error state and no
 * success/failure branch here — a component that rendered one would reintroduce
 * the enumeration oracle the action exists to close.
 */
export default function ResendVerification({
  defaultIdentifier = '',
}: {
  defaultIdentifier?: string
}) {
  const [identifier, setIdentifier] = useState(defaultIdentifier)
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          await resendVerification({ identifier })
          setSent(true)
        })
      }}
      className="space-y-3"
    >
      <div className="space-y-1">
        <label htmlFor="resend-identifier" className="text-sm font-medium">
          Email or handle
        </label>
        <Input
          id="resend-identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
        />
      </div>

      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send another link'}
      </Button>

      {sent ? (
        <p className="text-sm text-muted-foreground" role="status">
          {RESEND_FIXED_MESSAGE}
        </p>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 6: Write the component test**

Create `tests/components/ResendVerification.test.tsx` — **`// @vitest-environment jsdom` must be the literal first line**:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ resendVerification: vi.fn() }))

// A client component importing a server action drags next-auth into jsdom and
// the file dies at load, before any test runs (BUILD-QUEUE trap 7).
vi.mock('@/actions/auth-verify', () => ({
  resendVerification: h.resendVerification,
  RESEND_FIXED_MESSAGE: 'If that account exists, we’ve sent a link.',
}))

import ResendVerification from '@/components/auth/ResendVerification'

beforeEach(() => {
  vi.clearAllMocks()
  h.resendVerification.mockResolvedValue({ success: true, data: undefined })
})
afterEach(cleanup)

describe('ResendVerification', () => {
  it('prefills the identifier it was given', () => {
    render(<ResendVerification defaultIdentifier="me@example.com" />)
    expect(screen.getByLabelText(/email or handle/i)).toHaveValue('me@example.com')
  })

  it('calls the action and then shows the ONE fixed message', async () => {
    render(<ResendVerification defaultIdentifier="me@example.com" />)
    await userEvent.click(screen.getByRole('button', { name: /send another link/i }))
    await waitFor(() =>
      expect(h.resendVerification).toHaveBeenCalledWith({ identifier: 'me@example.com' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/if that account exists/i)
  })

  it('shows nothing before the first submit', () => {
    render(<ResendVerification />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
```

- [ ] **Step 7: Mount the control on the check-email page**

In `src/app/signup/check-email/page.tsx`, add the import and replace the "sign up again" paragraph:

```tsx
import ResendVerification from '@/components/auth/ResendVerification'
```

```tsx
          <p className="text-sm text-muted-foreground">
            The link works for 24 hours. Nothing arrived? Check spam, then send another.
          </p>
          <ResendVerification defaultIdentifier={email} />
```

- [ ] **Step 8: Run the tests**

```bash
npx vitest run tests/actions/auth-verify.test.ts tests/components/ResendVerification.test.tsx
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: PASS; `tsc` silent.

- [ ] **Step 9: Commit**

```bash
git add src/actions/auth-verify.ts src/components/auth/ResendVerification.tsx src/app/signup/check-email tests/actions/auth-verify.test.ts tests/components/ResendVerification.test.tsx
git commit -m "feat(auth): resend verification behind the fixed-response rule"
```

---

### Task 7: `/verify/[token]`

Implements spec §7.3.

**Files:**
- Create: `src/app/verify/[token]/page.tsx`
- Modify: `src/actions/auth-verify.ts` (add `consumeEmailVerification`)
- Test: `tests/actions/auth-verify.test.ts` (extend)

**Interfaces:**
- Consumes: `consumeToken`, `invalidateTokens` (Task 2).
- Produces: `consumeEmailVerification(rawToken: string): Promise<{ ok: boolean }>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/actions/auth-verify.test.ts`. **No mock changes are needed** — Task 6 already
declared `consumeToken`, `invalidateTokens` and the `$transaction` shim in that file's mock set.
Widen the existing import line to `import { resendVerification, RESEND_FIXED_MESSAGE, consumeEmailVerification } from '@/actions/auth-verify'`, then append:

```ts

describe('consumeEmailVerification', () => {
  beforeEach(() => {
    h.consumeToken.mockResolvedValue({ ok: true, userId: 'u1' })
    h.txUserUpdate.mockResolvedValue({ id: 'u1' })
    h.invalidateTokens.mockResolvedValue(undefined)
  })

  it('consumes an EMAIL_VERIFY token — never a reset one', async () => {
    await consumeEmailVerification('raw')
    expect(h.consumeToken).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'email_verify',
      raw: 'raw',
    })
  })

  it('stamps emailVerified and reports success', async () => {
    const res = await consumeEmailVerification('raw')
    expect(res).toEqual({ ok: true })
    expect(h.txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: expect.any(Date) },
    })
  })

  it('invalidates the user’s other outstanding verify links', async () => {
    await consumeEmailVerification('raw')
    expect(h.invalidateTokens).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'email_verify',
    })
  })

  it('refuses an invalid or expired token WITHOUT writing anything', async () => {
    h.consumeToken.mockResolvedValue({ ok: false, reason: 'invalid_or_expired' })
    const res = await consumeEmailVerification('raw')
    expect(res).toEqual({ ok: false })
    expect(h.txUserUpdate).not.toHaveBeenCalled()
  })

  it('refuses a REUSED token — the atomic claim is what decides', async () => {
    h.consumeToken.mockResolvedValueOnce({ ok: true, userId: 'u1' })
    h.consumeToken.mockResolvedValueOnce({ ok: false, reason: 'invalid_or_expired' })
    expect(await consumeEmailVerification('raw')).toEqual({ ok: true })
    expect(await consumeEmailVerification('raw')).toEqual({ ok: false })
  })

  it('does NOT sign the user in', async () => {
    // The token is in a URL, which lands in browser history and in whatever
    // proxy logged the request. Verification proves the inbox; it is not a
    // credential.
    const mod = await import('@/actions/auth-verify')
    expect(Object.keys(mod)).not.toContain('signIn')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/actions/auth-verify.test.ts
```
Expected: FAIL — `consumeEmailVerification` is not exported.

- [ ] **Step 3: Add `consumeEmailVerification` to `src/actions/auth-verify.ts`**

Add the imports `consumeToken, invalidateTokens` to the existing `@/lib/auth/tokens` import, then append:

```ts
/**
 * Turn a verification link into a verified address.
 *
 * Does NOT sign the user in. The token sits in a URL, which lands in browser
 * history, in the referrer of anything the page loads, and in whatever proxy
 * logged the request — proving control of an inbox is not the same as holding
 * a credential.
 *
 * KNOWN AND ACCEPTED: this consumes on a GET, so a mail-scanning link
 * prefetcher can burn the token before the human clicks it. The failure page
 * therefore always offers a resend rather than a dead end, which is what makes
 * that recoverable instead of fatal.
 */
export async function consumeEmailVerification(rawToken: string): Promise<{ ok: boolean }> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return { ok: false }

  return prisma.$transaction(async (tx) => {
    const claimed = await consumeToken(tx, { purpose: 'email_verify', raw: rawToken })
    if (!claimed.ok) return { ok: false }

    await tx.user.update({
      where: { id: claimed.userId },
      data: { emailVerified: new Date() },
    })
    // A second link in an older mail must not stay live after this one worked.
    await invalidateTokens(tx, { userId: claimed.userId, purpose: 'email_verify' })
    return { ok: true }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/actions/auth-verify.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write the route**

Create `src/app/verify/[token]/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ResendVerification from '@/components/auth/ResendVerification'
import { consumeEmailVerification } from '@/actions/auth-verify'

/**
 * On success: redirect to /login?verified=1. Deliberately NOT an auto-sign-in
 * — see consumeEmailVerification.
 *
 * On failure: a plain page offering a resend, never a stack trace. An expired
 * link and a link a mail scanner already burned look identical from here, and
 * the remedy is the same for both.
 */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await consumeEmailVerification(decodeURIComponent(token))

  // redirect() throws to unwind, so it must sit outside any try/catch. There
  // is none here on purpose.
  if (result.ok) redirect('/login?verified=1')

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>That link didn’t work</CardTitle>
          <CardDescription>
            Verification links expire after 24 hours and can only be used once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter your email or handle and we’ll send a fresh one.
          </p>
          <ResendVerification />
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Show the confirmation on `/login`**

In `src/app/login/page.tsx`, widen the `searchParams` type to `Promise<{ callbackUrl?: string; error?: string; verified?: string; reset?: string }>` and add a notice above `<LoginForm …>` inside `CardContent`:

```tsx
          {params.verified === '1' ? (
            <p className="mb-4 text-sm text-foreground" role="status">
              Your email is verified. Sign in below.
            </p>
          ) : null}
          {params.reset === '1' ? (
            <p className="mb-4 text-sm text-foreground" role="status">
              Your password has been changed. Sign in with the new one.
            </p>
          ) : null}
```

(The `reset=1` branch is used by Task 9; adding both here avoids touching this file twice.)

- [ ] **Step 7: Verify types and the suite**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
```
Expected: `tsc` silent; suite green.

- [ ] **Step 8: Commit**

```bash
git add src/app/verify src/app/login/page.tsx src/actions/auth-verify.ts tests/actions/auth-verify.test.ts
git commit -m "feat(auth): consume email verification links at /verify/[token]"
```

---

### Task 8: `/forgot` + `requestPasswordReset`

Implements spec §7.4. Carries **mutant 5**.

**Files:**
- Create: `src/actions/auth-reset.ts`, `src/app/forgot/page.tsx`, `src/components/auth/ForgotForm.tsx`
- Modify: `src/components/auth/LoginForm.tsx` (add the link)
- Test: `tests/actions/auth-reset.test.ts`

**Interfaces:**
- Consumes: `identifierWhere`, `mintToken`, `sendPasswordResetEmail`.
- Produces: `FORGOT_FIXED_MESSAGE: string`; `requestPasswordReset(input: { identifier: string }): Promise<ActionResult<void>>` — always `{ success: true }`.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/auth-reset.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Wider than this task needs on purpose: Task 9 adds peekResetToken and
// completePasswordReset to the same file and would otherwise rewrite these.
const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  mintToken: vi.fn(),
  peekToken: vi.fn(),
  consumeToken: vi.fn(),
  invalidateTokens: vi.fn(),
  txUserFindUnique: vi.fn(),
  txUserUpdate: vi.fn(),
  hashPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}))

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterTasks.push(Promise.resolve().then(fn))
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: h.findFirst },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ user: { findUnique: h.txUserFindUnique, update: h.txUserUpdate } }),
  },
}))
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return {
    ...actual,
    mintToken: h.mintToken,
    peekToken: h.peekToken,
    consumeToken: h.consumeToken,
    invalidateTokens: h.invalidateTokens,
  }
})
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword }
})
vi.mock('@/lib/mail/send', () => ({ sendPasswordResetEmail: h.sendPasswordResetEmail }))

import { requestPasswordReset, FORGOT_FIXED_MESSAGE } from '@/actions/auth-reset'

const PASSWORD_USER = {
  id: 'u1',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hash',
}
const OAUTH_ONLY_USER = { id: 'u2', email: 'bob@example.com', passwordHash: null }

async function drainAfter() {
  await Promise.all(h.afterTasks.splice(0))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterTasks.length = 0
  h.mintToken.mockResolvedValue('raw-token')
})

describe('the enumeration invariant', () => {
  it('returns a byte-identical result for a known, an unknown, and an OAuth-only identifier', async () => {
    const results: string[] = []
    for (const row of [PASSWORD_USER, null, OAUTH_ONLY_USER]) {
      h.findFirst.mockResolvedValue(row)
      results.push(JSON.stringify(await requestPasswordReset({ identifier: 'x' })))
    }
    expect(new Set(results).size).toBe(1)
    expect(JSON.parse(results[0])).toEqual({ success: true, data: undefined })
  })

  it('touches the database only inside after(), so the paths cannot be timed apart', async () => {
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'alice@example.com' })
    expect(h.findFirst).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.findFirst).toHaveBeenCalled()
  })
})

describe('requestPasswordReset', () => {
  it('mints a password_reset token and mails it to an account that HAS a password', async () => {
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'alice@example.com' })
    await drainAfter()
    expect(h.mintToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'password_reset',
    })
    expect(h.sendPasswordResetEmail).toHaveBeenCalledWith('alice@example.com', 'raw-token')
  })

  it('MUTANT 5: sends nothing to an OAuth-only account', async () => {
    // An OAuth-only account already has a working way in. Mailing it a reset
    // link converts "controls the inbox" into "owns the account" on the
    // strength of an email claim GitHub gave us and we never verified.
    h.findFirst.mockResolvedValue(OAUTH_ONLY_USER)
    await requestPasswordReset({ identifier: 'bob@example.com' })
    await drainAfter()
    expect(h.mintToken).not.toHaveBeenCalled()
    expect(h.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('sends nothing for an unknown identifier', async () => {
    h.findFirst.mockResolvedValue(null)
    await requestPasswordReset({ identifier: 'nobody@example.invalid' })
    await drainAfter()
    expect(h.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('accepts a HANDLE, not just an email', async () => {
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'Alice_NG' })
    await drainAfter()
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'alice_ng' }, { normalizedHandle: 'alice_ng' }],
    })
  })

  it('mails the ACCOUNT address, never the address that was typed', async () => {
    // Otherwise anyone could have a valid token for someone else's account
    // delivered to an inbox they control by signing in with the handle.
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'alice_ng' })
    await drainAfter()
    expect(h.sendPasswordResetEmail).toHaveBeenCalledWith('alice@example.com', 'raw-token')
  })

  it('swallows a failure rather than killing the after() callback', async () => {
    h.findFirst.mockRejectedValue(new Error('database is down'))
    await requestPasswordReset({ identifier: 'x' })
    await expect(drainAfter()).resolves.toBeDefined()
  })

  it('exports one fixed message that promises nothing about existence', () => {
    expect(FORGOT_FIXED_MESSAGE).toMatch(/if that account exists/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/actions/auth-reset.test.ts
```
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write `src/actions/auth-reset.ts`**

```ts
'use server'

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { identifierWhere } from '@/lib/auth/identifier'
import { mintToken } from '@/lib/auth/tokens'
import { sendPasswordResetEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

export const FORGOT_FIXED_MESSAGE =
  'If that account exists, we’ve sent a link to its email address.'

/**
 * Start a password reset.
 *
 * THE ENUMERATION INVARIANT (design §5): one fixed response for every input,
 * and all work inside after() so the timing cannot be read either.
 *
 * A TOKEN IS ONLY MINTED FOR AN ACCOUNT THAT ALREADY HAS A passwordHash. An
 * OAuth-only account already has a working way in, so mailing it a reset link
 * would convert "controls the inbox" into "owns the account" on the strength
 * of an email claim GitHub gave us and we never verified. The response is
 * byte-identical either way, so refusing leaks nothing. An OAuth user who
 * wants a password uses /account, which requires being signed in — which they
 * can be, via GitHub.
 */
export async function requestPasswordReset(input: {
  identifier: string
}): Promise<ActionResult<void>> {
  const identifier = typeof input.identifier === 'string' ? input.identifier : ''

  after(async () => {
    try {
      const user = await prisma.user.findFirst({
        where: identifierWhere(identifier),
        select: { id: true, email: true, passwordHash: true },
      })
      if (!user || !user.passwordHash) return

      const token = await mintToken(prisma, { userId: user.id, purpose: 'password_reset' })
      // The ACCOUNT address, never the string that was typed — otherwise
      // signing in with a handle would let anyone have someone else's token
      // delivered to an inbox they control.
      await sendPasswordResetEmail(user.email, token)
    } catch (error) {
      console.error('[mail] requestPasswordReset failed', error)
    }
  })

  return { success: true, data: undefined }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/actions/auth-reset.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mutation-test the has-a-password condition (mutant 5)**

Change `if (!user || !user.passwordHash) return` to `if (!user) return`, run `npx vitest run tests/actions/auth-reset.test.ts`, confirm the MUTANT 5 test **FAILS**, then revert.

- [ ] **Step 6: Write the form and page**

Create `src/components/auth/ForgotForm.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requestPasswordReset, FORGOT_FIXED_MESSAGE } from '@/actions/auth-reset'

/**
 * One outcome. No error branch, no "we couldn't find that account" — either
 * would rebuild the enumeration oracle the action exists to close.
 */
export default function ForgotForm() {
  const [identifier, setIdentifier] = useState('')
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (sent) {
    return (
      <p className="text-sm text-foreground" role="status">
        {FORGOT_FIXED_MESSAGE}
      </p>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          await requestPasswordReset({ identifier })
          setSent(true)
        })
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="forgot-identifier" className="text-sm font-medium">
          Email or handle
        </label>
        <Input
          id="forgot-identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Sending…' : 'Send a reset link'}
      </Button>
    </form>
  )
}
```

Create `src/app/forgot/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ForgotForm from '@/components/auth/ForgotForm'

/**
 * Never gated by CREDENTIALS_SIGNUP_ENABLED. The flag governs creating
 * accounts; an existing password user must always be able to recover one.
 */
export default async function ForgotPage() {
  const session = await auth()
  if (session?.user?.id) redirect('/account')

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter your email or handle and we’ll send a link that works for one hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ForgotForm />
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 7: Link it from the login form**

In `src/components/auth/LoginForm.tsx`, immediately after the closing `</form>` tag, add:

```tsx
      <p className="text-sm text-muted-foreground">
        <Link href="/forgot" className="underline hover:text-foreground">
          Forgot your password?
        </Link>
      </p>
```

(`Link` is already imported in that file.)

- [ ] **Step 8: Verify**

```bash
npx vitest run tests/actions/auth-reset.test.ts
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: PASS; `tsc` silent.

- [ ] **Step 9: Commit**

```bash
git add src/actions/auth-reset.ts src/app/forgot src/components/auth/ForgotForm.tsx src/components/auth/LoginForm.tsx tests/actions/auth-reset.test.ts
git commit -m "feat(auth): request a password reset with an indistinguishable response"
```

---

### Task 9: `/reset/[token]` — consume the reset

Implements spec §7.5.

**Files:**
- Modify: `src/actions/auth-reset.ts` (add `peekResetToken`, `completePasswordReset`)
- Create: `src/app/reset/[token]/page.tsx`, `src/components/auth/ResetPasswordForm.tsx`
- Test: `tests/actions/auth-reset.test.ts` (extend)

**Interfaces:**
- Consumes: `peekToken`, `consumeToken`, `invalidateTokens` (Task 2), `checkPassword`/`hashPassword` (`@/lib/auth/password`).
- Produces:
  - `peekResetToken(rawToken: string): Promise<boolean>`
  - `completePasswordReset(input: { token: string; password: string }): Promise<ActionResult<void>>`

- [ ] **Step 1: Write the failing test**

Extend `tests/actions/auth-reset.test.ts`. **No mock changes are needed** — Task 8 already
declared `peekToken`, `consumeToken`, `invalidateTokens`, `hashPassword` and the `$transaction`
shim in that file's mock set. Widen the existing import line to
`import { requestPasswordReset, FORGOT_FIXED_MESSAGE, peekResetToken, completePasswordReset } from '@/actions/auth-reset'`,
then append:

```ts

describe('peekResetToken', () => {
  it('checks a PASSWORD_RESET token and consumes nothing', async () => {
    h.peekToken.mockResolvedValue(true)
    expect(await peekResetToken('raw')).toBe(true)
    expect(h.peekToken).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'password_reset',
      raw: 'raw',
    })
    expect(h.consumeToken).not.toHaveBeenCalled()
  })
})

describe('completePasswordReset', () => {
  beforeEach(() => {
    h.consumeToken.mockResolvedValue({ ok: true, userId: 'u1' })
    h.txUserFindUnique.mockResolvedValue({ sessionVersion: 4, emailVerified: null })
    h.txUserUpdate.mockResolvedValue({ id: 'u1' })
    h.invalidateTokens.mockResolvedValue(undefined)
    h.hashPassword.mockResolvedValue('$2b$12$new')
  })

  const VALID = { token: 'raw', password: 'a'.repeat(12) }

  it('rejects a password that fails policy BEFORE consuming the token', async () => {
    // Burning the token on a too-short password would make the user request a
    // whole new link to fix a typo.
    const res = await completePasswordReset({ token: 'raw', password: 'short' })
    expect(res.success).toBe(false)
    expect(h.consumeToken).not.toHaveBeenCalled()
  })

  it('hashes OUTSIDE the transaction', async () => {
    // Holding a Postgres transaction open across ~250ms of bcrypt is how a
    // serverless app exhausts its connection pool.
    await completePasswordReset(VALID)
    expect(h.hashPassword.mock.invocationCallOrder[0]).toBeLessThan(
      h.consumeToken.mock.invocationCallOrder[0],
    )
  })

  it('consumes the token atomically and writes the new password', async () => {
    const res = await completePasswordReset(VALID)
    expect(res.success).toBe(true)
    expect(h.consumeToken).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'password_reset',
      raw: 'raw',
    })
    const data = h.txUserUpdate.mock.calls[0][0].data
    expect(data.passwordHash).toBe('$2b$12$new')
    expect(data.passwordSetAt).toBeInstanceOf(Date)
  })

  it('BUMPS sessionVersion — it is a password change, so every JWT must die', async () => {
    await completePasswordReset(VALID)
    expect(h.txUserUpdate.mock.calls[0][0].data.sessionVersion).toBe(5)
  })

  it('sets emailVerified when it was null — the inbox proved itself', async () => {
    // This is what gives an unverified, locked-out user exactly one path back.
    await completePasswordReset(VALID)
    expect(h.txUserUpdate.mock.calls[0][0].data.emailVerified).toBeInstanceOf(Date)
  })

  it('does NOT move an emailVerified that already exists', async () => {
    const original = new Date('2026-01-01T00:00:00.000Z')
    h.txUserFindUnique.mockResolvedValue({ sessionVersion: 1, emailVerified: original })
    await completePasswordReset(VALID)
    expect(h.txUserUpdate.mock.calls[0][0].data.emailVerified).toBeUndefined()
  })

  it('invalidates the user’s other outstanding reset tokens', async () => {
    await completePasswordReset(VALID)
    expect(h.invalidateTokens).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'password_reset',
    })
  })

  it('refuses a used or expired token and writes nothing', async () => {
    h.consumeToken.mockResolvedValue({ ok: false, reason: 'invalid_or_expired' })
    const res = await completePasswordReset(VALID)
    expect(res.success).toBe(false)
    expect(h.txUserUpdate).not.toHaveBeenCalled()
  })

  it('refuses the SECOND use of the same link', async () => {
    h.consumeToken.mockResolvedValueOnce({ ok: true, userId: 'u1' })
    h.consumeToken.mockResolvedValueOnce({ ok: false, reason: 'invalid_or_expired' })
    expect((await completePasswordReset(VALID)).success).toBe(true)
    expect((await completePasswordReset(VALID)).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/actions/auth-reset.test.ts
```
Expected: FAIL — `peekResetToken` / `completePasswordReset` not exported.

- [ ] **Step 3: Add both functions to `src/actions/auth-reset.ts`**

Widen the tokens import to `import { mintToken, peekToken, consumeToken, invalidateTokens } from '@/lib/auth/tokens'`, add `import { checkPassword, PASSWORD_REJECTION_MESSAGES, hashPassword } from '@/lib/auth/password'`, then append:

```ts
/** Validate WITHOUT consuming, so a GET can render the form without burning the link. */
export async function peekResetToken(rawToken: string): Promise<boolean> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return false
  return peekToken(prisma, { purpose: 'password_reset', raw: rawToken })
}

/** The one message every failure produces — used or expired are the same to a caller. */
const RESET_FAILED_MESSAGE =
  'That reset link has expired or has already been used. Request a new one.'

/**
 * Consume a reset link and set a new password.
 *
 * Four writes, one transaction:
 *  - consume the token atomically (single-use is enforced there, not here);
 *  - write passwordHash + passwordSetAt;
 *  - set emailVerified IF NULL — clicking a link in an inbox proves the inbox,
 *    which is what gives an unverified, locked-out user exactly one path back;
 *  - bump sessionVersion, because this is a password change and every
 *    outstanding JWT for the account must die (see src/lib/auth/session.ts);
 *  - invalidate the user's other outstanding password_reset tokens.
 *
 * Hashing happens OUTSIDE the transaction, and the policy check happens before
 * the token is touched — a too-short password must not cost the user their link.
 */
export async function completePasswordReset(input: {
  token: string
  password: string
}): Promise<ActionResult<void>> {
  const policy = checkPassword(input.password)
  if (!policy.ok) return { success: false, error: PASSWORD_REJECTION_MESSAGES[policy.reason] }

  const passwordHash = await hashPassword(input.password)

  return prisma.$transaction(async (tx): Promise<ActionResult<void>> => {
    const claimed = await consumeToken(tx, { purpose: 'password_reset', raw: input.token })
    if (!claimed.ok) return { success: false, error: RESET_FAILED_MESSAGE }

    const user = await tx.user.findUnique({
      where: { id: claimed.userId },
      select: { sessionVersion: true, emailVerified: true },
    })
    if (!user) return { success: false, error: RESET_FAILED_MESSAGE }

    await tx.user.update({
      where: { id: claimed.userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        sessionVersion: user.sessionVersion + 1,
        // Only when null. Overwriting an existing stamp would rewrite history
        // for no gain.
        ...(user.emailVerified ? {} : { emailVerified: new Date() }),
      },
    })

    await invalidateTokens(tx, { userId: claimed.userId, purpose: 'password_reset' })
    return { success: true, data: undefined }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/actions/auth-reset.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write the form**

Create `src/components/auth/ResetPasswordForm.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { completePasswordReset } from '@/actions/auth-reset'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        // Client-side only; the server does not need it. It exists to catch a
        // typo in a value the user cannot see.
        if (password !== confirm) {
          setError('Those passwords do not match.')
          return
        }
        startTransition(async () => {
          const res = await completePasswordReset({ token, password })
          if (!res.success) {
            setError(res.error)
            return
          }
          // The reset bumped sessionVersion, so any session this browser held
          // is already dead. Straight to /login with the confirmation.
          router.push('/login?reset=1')
          router.refresh()
        })
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label htmlFor="reset-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="reset-password"
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
        <label htmlFor="reset-confirm" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="reset-confirm"
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
        {isPending ? 'Saving…' : 'Set my new password'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 6: Write the route**

Create `src/app/reset/[token]/page.tsx`:

```tsx
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'
import { peekResetToken } from '@/actions/auth-reset'

/**
 * GET validates without consuming — the POST is what claims the token. A GET
 * that consumed would let a mail scanner burn the link before the human sees
 * the form.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const raw = decodeURIComponent(token)
  const valid = await peekResetToken(raw)

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{valid ? 'Choose a new password' : 'That link didn’t work'}</CardTitle>
          <CardDescription>
            {valid
              ? 'Once you save it, every device signed in to this account is signed out.'
              : 'Reset links expire after an hour and can only be used once.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {valid ? (
            <ResetPasswordForm token={raw} />
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link href="/forgot" className="underline hover:text-foreground">
                Request a new link
              </Link>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 7: Verify**

```bash
npx vitest run tests/actions/auth-reset.test.ts
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: PASS; `tsc` silent.

- [ ] **Step 8: Commit**

```bash
git add src/actions/auth-reset.ts src/app/reset src/components/auth/ResetPasswordForm.tsx tests/actions/auth-reset.test.ts
git commit -m "feat(auth): consume reset links, rotating password, verification and sessionVersion"
```

---

### Task 10: The sign-in gate + the `code` plumbing question

Implements spec §7.6. **Contains one flagged unknown that must be resolved empirically, not assumed.**

**Files:**
- Modify: `src/lib/auth/credentials.ts`, `src/auth.ts`, `src/components/auth/LoginForm.tsx`
- Test: `tests/auth/credentials-authorize.test.ts` (rewrite the assertions — the return type changes)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export type AuthorizeOutcome =
    | { kind: 'ok'; user: AuthorizedUser }
    | { kind: 'rejected' }
    | { kind: 'unverified' }
  ```
  `authorizeCredentials` now returns `Promise<AuthorizeOutcome>` — **it no longer returns `AuthorizedUser | null`**. `src/auth.ts` is the only production caller.

- [ ] **Step 1: Rewrite the assertions in `tests/auth/credentials-authorize.test.ts`**

Every existing assertion of the form `expect(result).toBeNull()` becomes `expect(result).toEqual({ kind: 'rejected' })`, and every `expect(result).toEqual({ id: 'u1', … })` becomes `expect(result).toEqual({ kind: 'ok', user: { id: 'u1', … } })`. Fixtures gain `emailVerified`. Then append this new block:

```ts
describe('the verification gate', () => {
  const VERIFIED = { ...USER, emailVerified: new Date('2026-01-01') }
  const UNVERIFIED = { ...USER, emailVerified: null }

  it('returns unverified ONLY when the password was correct', async () => {
    // The gate is enumeration-safe because of WHEN it fires. At this moment the
    // caller already knows the account exists and knows its password, so
    // telling them "verify your email" reveals nothing they did not supply.
    h.findFirst.mockResolvedValue(UNVERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    expect(await authorizeCredentials({ identifier: 'a', password: 'p' })).toEqual({
      kind: 'unverified',
    })
  })

  it('returns rejected — NOT unverified — for a WRONG password on an unverified account', async () => {
    // Otherwise the gate becomes the oracle: "unverified" would confirm the
    // account exists to someone who guessed nothing right.
    h.findFirst.mockResolvedValue(UNVERIFIED)
    h.verifyPassword.mockResolvedValue(false)
    expect(await authorizeCredentials({ identifier: 'a', password: 'wrong' })).toEqual({
      kind: 'rejected',
    })
  })

  it('lets a verified account through', async () => {
    h.findFirst.mockResolvedValue(VERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    const res = await authorizeCredentials({ identifier: 'a', password: 'p' })
    expect(res).toEqual({
      kind: 'ok',
      user: { id: 'u1', email: 'alice@example.com', name: 'Alice', image: null },
    })
  })

  it('returns rejected for an unknown identifier, after a real dummy comparison', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await authorizeCredentials({ identifier: 'nobody', password: 'p' })).toEqual({
      kind: 'rejected',
    })
    expect(h.verifyAgainstDummy).toHaveBeenCalled()
  })

  it('never returns the password hash in the ok payload', async () => {
    h.findFirst.mockResolvedValue(VERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    const res = await authorizeCredentials({ identifier: 'a', password: 'p' })
    expect(JSON.stringify(res)).not.toContain('$2b$12$')
  })

  it('selects emailVerified — a gate reading an unselected field is silently open', async () => {
    h.findFirst.mockResolvedValue(VERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    await authorizeCredentials({ identifier: 'a', password: 'p' })
    expect(h.findFirst.mock.calls[0][0].select.emailVerified).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/auth/credentials-authorize.test.ts
```
Expected: FAIL — the current implementation returns a user or null.

- [ ] **Step 3: Change `src/lib/auth/credentials.ts`**

Replace the `authorizeCredentials` signature and body, keeping the existing comments about the dummy compare and field-by-field reconstruction:

```ts
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
```

- [ ] **Step 4: Map the outcomes in `src/auth.ts`**

Add the import `import { CredentialsSignin } from 'next-auth'` and, above the `NextAuth({…})` call:

```ts
/**
 * Thrown when the password was right but the address is not verified.
 *
 * Auth.js surfaces `code` on a CredentialsSignin subclass; the login form maps
 * it to copy offering a resend. Whether the code survives
 * `signIn('credentials', { redirect: false })` in this beta is verified
 * empirically in the task that shipped this — see the plan's Task 10 Step 6.
 */
class UnverifiedEmailError extends CredentialsSignin {
  code = 'unverified'
}
```

and replace the `authorize` line:

```ts
      authorize: async (raw) => {
        const outcome = await authorizeCredentials(raw ?? {})
        if (outcome.kind === 'ok') return outcome.user
        if (outcome.kind === 'unverified') throw new UnverifiedEmailError()
        // `rejected` -> null -> Auth.js's generic CredentialsSignin, which the
        // login form renders as its one byte-identical failure message.
        return null
      },
```

- [ ] **Step 5: Add the copy to `LoginForm`**

In `src/components/auth/LoginForm.tsx`, add to `ERROR_COPY`:

```ts
  unverified:
    'Your email address isn’t verified yet. Check your inbox for the link, or send another below.',
```

and render the resend control when that error is showing, immediately after the error paragraph inside the form:

```tsx
        {error === ERROR_COPY.unverified ? <ResendVerification defaultIdentifier={identifier} /> : null}
```

with `import ResendVerification from '@/components/auth/ResendVerification'` at the top.

- [ ] **Step 6: RESOLVE THE FLAGGED UNKNOWN EMPIRICALLY — do not assume**

Whether `code: 'unverified'` survives `signIn('credentials', { redirect: false })` in `next-auth@5.0.0-beta.31` is **unverified**. Establish it now:

```bash
npm run seed:dev-user
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```

In a second shell, un-verify the seeded account, then sign in through the browser at `/login` and read what the form displays:

```bash
npx tsx --env-file=.env -e "const{prisma}=require('./src/lib/db');prisma.user.update({where:{email:'dev@localhost.test'},data:{emailVerified:null}}).then(()=>prisma.\$disconnect())"
```

- **If the page shows the "isn't verified yet" copy and the resend control** — the code carries. Done; restore the account with `npm run seed:dev-user` and then re-verify it:
  ```bash
  npx tsx --env-file=.env -e "const{prisma}=require('./src/lib/db');prisma.user.update({where:{email:'dev@localhost.test'},data:{emailVerified:new Date()}}).then(()=>prisma.\$disconnect())"
  ```
- **If it shows the generic `Email or password is incorrect.`** — the code does **not** carry. Apply the spec's fallback and **spend no more than this one step on it**:
  1. In `src/auth.ts`, delete `UnverifiedEmailError` and return `null` for `unverified` as well, with a comment recording that the beta drops the code.
  2. In `LoginForm.tsx`, delete the `unverified` entry from `ERROR_COPY` and the conditional render; instead show the resend block **unconditionally** beneath the form:
     ```tsx
      <div className="space-y-2 rounded-md border border-border p-4">
        <p className="text-sm text-muted-foreground">
          Just signed up? Check your inbox for a verification link.
        </p>
        <ResendVerification defaultIdentifier={identifier} />
      </div>
     ```
     Being unconditional, it is never an oracle. The UX is slightly worse and the security properties are identical.
  3. Adjust the `LoginForm` test below to match whichever branch shipped.

**Record which branch you took, in the commit message and in the task report.**

- [ ] **Step 7: Run the full suite**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: green. If any other file calls `authorizeCredentials`, `tsc` names it — fix it there.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/credentials.ts src/auth.ts src/components/auth/LoginForm.tsx tests/auth/credentials-authorize.test.ts
git commit -m "feat(auth): refuse password sign-in until the email is verified"
```

---

### Task 11: `savePassword` invalidates reset tokens and verifies the address

Implements spec §7.7.

**Files:**
- Modify: `src/actions/password.ts`
- Test: `tests/actions/password.test.ts` (extend)

**Interfaces:**
- Consumes: `invalidateTokens` (Task 2).
- Produces: no new exports; `savePassword`'s behaviour widens.

- [ ] **Step 1: Write the failing test**

In `tests/actions/password.test.ts`, replace lines 3-19 (the hoisted block and the `@/lib/db`
mock) with:

```ts
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  invalidateTokens: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: h.findUnique },
    // The update now happens on the transaction client, alongside the token
    // invalidation — `prisma.user` deliberately exposes no `update`, so a
    // version that writes outside the transaction throws.
    $transaction: (fn: (tx: unknown) => unknown) => fn({ user: { update: h.update } }),
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword, verifyPassword: h.verifyPassword }
})
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return { ...actual, invalidateTokens: h.invalidateTokens }
})
```

and add two lines to the existing `beforeEach` (line 25-31), so the widened `select` has a value
and the new dependency resolves:

```ts
  h.invalidateTokens.mockResolvedValue(undefined)
  h.findUnique.mockResolvedValue({ passwordHash: null, sessionVersion: 2, emailVerified: null })
```

Then append:

```ts
describe('savePassword also closes the reset hole', () => {
  it('invalidates outstanding password_reset tokens', async () => {
    // Otherwise: an attacker requests a reset, the owner notices and changes
    // their password from /account, and the attacker's emailed link stays live
    // for the rest of the hour.
    // (The default fixture is an OAuth-only account, so no current password is
    // required — the invalidation must happen on that branch too.)
    await savePassword({ next: 'a'.repeat(12) })
    expect(h.invalidateTokens).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'password_reset',
    })
  })

  it('sets emailVerified when it is null', async () => {
    // A GitHub account created after the gate shipped has emailVerified: null.
    // Without this, setting a password on /account locks the user out of
    // password sign-in immediately — while they are demonstrably signed in and
    // in control, with no self-registered address to have typo'd.
    h.findUnique.mockResolvedValue({ passwordHash: null, sessionVersion: 0, emailVerified: null })
    await savePassword({ next: 'a'.repeat(12) })
    expect(h.update.mock.calls[0][0].data.emailVerified).toBeInstanceOf(Date)
  })

  it('does NOT move an emailVerified that already exists', async () => {
    const original = new Date('2026-01-01T00:00:00.000Z')
    h.findUnique.mockResolvedValue({
      passwordHash: '$2b$12$old',
      sessionVersion: 3,
      emailVerified: original,
    })
    await savePassword({ current: 'old-password', next: 'a'.repeat(12) })
    expect(h.update.mock.calls[0][0].data.emailVerified).toBeUndefined()
  })

  it('still bumps sessionVersion', async () => {
    h.findUnique.mockResolvedValue({
      passwordHash: '$2b$12$old',
      sessionVersion: 7,
      emailVerified: new Date(),
    })
    h.verifyPassword.mockResolvedValue(true)
    await savePassword({ current: 'old-password', next: 'a'.repeat(12) })
    expect(h.update.mock.calls[0][0].data.sessionVersion).toBe(8)
  })

  it('still requires a correct current password, and writes NOTHING without one', async () => {
    // Regression guard: the additions above must not weaken the check that is
    // the whole defence against an unattended open session.
    h.findUnique.mockResolvedValue({
      passwordHash: '$2b$12$old',
      sessionVersion: 3,
      emailVerified: null,
    })
    h.verifyPassword.mockResolvedValue(false)
    const res = await savePassword({ current: 'wrong', next: 'a'.repeat(12) })
    expect(res.success).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.invalidateTokens).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/actions/password.test.ts
```
Expected: FAIL on the three new behaviours.

- [ ] **Step 3: Update `src/actions/password.ts`**

Add `import { invalidateTokens } from '@/lib/auth/tokens'` and widen the `select` to include
`emailVerified: true`. Immediately after the existing `if (!session?.user?.id) return …` guard,
hoist the id — TS narrowing does not survive into the transaction closure, and a non-null
assertion there would be a cast this repo has been removing:

```ts
  const userId = session.user.id
```

Then replace the `prisma.user.update(...)` call with a transaction:

```ts
  const passwordHash = await hashPassword(input.next)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        // Invalidates every token already issued for this account, on this
        // device and any other. Under the JWT strategy there is no session row
        // to delete, so without this a password change would not actually lock
        // anyone out — see src/lib/auth/session.ts.
        sessionVersion: user.sessionVersion + 1,
        // A GitHub account created after the verification gate shipped has
        // emailVerified: null; without this, setting a password here would
        // lock the user out of password sign-in immediately. They are
        // demonstrably signed in and in control, and there is no
        // self-registered address to have typo'd.
        ...(user.emailVerified ? {} : { emailVerified: new Date() }),
      },
    })

    // An attacker requests a reset, the owner notices and changes their
    // password from /account — without this, the attacker's emailed link stays
    // live for the rest of the hour.
    await invalidateTokens(tx, { userId, purpose: 'password_reset' })
  })
```

(Hashing already happens outside the write; keep it that way. The `findUnique` above stays on
`prisma`, not `tx` — it is a read taken before the transaction opens.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/actions/password.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mutation-test the two additions**

Apply each, confirm the suite reddens, revert:
1. Delete the `invalidateTokens` call. → the first new test must fail.
2. Change `...(user.emailVerified ? {} : { emailVerified: new Date() })` to `emailVerified: new Date()`. → the "does NOT move" test must fail.

- [ ] **Step 6: Commit**

```bash
git add src/actions/password.ts tests/actions/password.test.ts
git commit -m "fix(account): a password change kills live reset links and verifies the address"
```

---

### Task 12: Documentation, environment, and the Firewall runbook

Implements spec §8, §10, §14.

**Files:**
- Modify: `.env.example`, `src/lib/auth/signup-flag.ts`, `src/lib/auth/credentials.ts` (one comment), `CLAUDE.md`, `docs/superpowers/BUILD-QUEUE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the two new variables to `.env.example`**

Replace the existing `# Email (Resend)` block with:

```
# Email (Resend). ABSENT -> the console transport: verification and reset links
# print to the server log, which is how this feature is driven end to end
# locally with no inbox involved. Set it (plus a verified sending domain) and
# real messages go out. See src/lib/mail/.
RESEND_API_KEY=""
MAIL_FROM="Quizlet <noreply@yourdomain.example>"
```

- [ ] **Step 2: Rewrite the `signup-flag.ts` doc comment**

Its current text says the flag is off *because there is no password reset*, which this work makes false. Leaving a stale reason in place is how the next reader concludes the flag can be deleted. Replace the whole comment block above `isSignupOpen`:

```ts
/**
 * Is public credentials sign-up open?
 *
 * A MASTER KILL SWITCH, not the primary control. Invite codes are the cap on
 * how many accounts can exist (src/lib/invites/); this flag is how you close
 * the door entirely without a deploy.
 *
 * Off unless explicitly `true`. Its original reason — "there is no password
 * reset" — no longer holds: /forgot and /reset/[token] exist, and sign-up now
 * requires an invite code and a verified email address. Flipping it to `true`
 * is a deliberate human decision about opening the app to strangers, not a
 * missing feature.
 *
 * Note what this does NOT gate: signing IN, resetting a password, or verifying
 * an address. A seeded account must be able to log in with the flag off, and an
 * existing user must never be locked out by a config change.
 */
```

- [ ] **Step 3: Reword the stale comment in `credentials.ts`**

The note justifying no password-policy check on sign-in ends "unrecoverable with no password reset", which is now half-false. The **behaviour must not change** — rejecting a legacy password at sign-in is still wrong. Task 10 Step 3 already rewrote it; confirm the file no longer contains the string `no password reset`:

```bash
grep -rn "no password reset" src/ || echo "clean"
```
Expected: `clean`. If anything is left (check `src/app/signup/page.tsx` and `src/components/auth/`), reword it.

- [ ] **Step 4: Update `CLAUDE.md`'s auth paragraph**

In the "Decided stack" section, replace the sentence beginning "Sign-up is gated by `CREDENTIALS_SIGNUP_ENABLED` (off unless exactly `"true"`) because there is **no password reset** — no mail provider exists." with:

```markdown
  Sign-up requires an **invite code** (`InviteCode`, a bearer code with `maxUses` + expiry,
  minted by `npm run invite`) and a **verified email address** — `emailVerified` is null for a
  new credentials account and `authorizeCredentials` refuses sign-in until it is set.
  `CREDENTIALS_SIGNUP_ENABLED` survives as a **master kill switch** (off unless exactly `"true"`),
  not as the growth control; invite codes are the cap. Password reset exists (`/forgot`,
  `/reset/[token]`) on one `UserToken` table whose `tokenHash` is `sha256(purpose + ':' + raw)` —
  the purpose is bound into the hash so a verification token cannot be presented at the reset
  endpoint. Mail goes through `src/lib/mail/` (raw `fetch` to Resend; **no `resend` package**),
  and with `RESEND_API_KEY` absent it falls back to a console transport that prints links to the
  server log. Signing in is never gated. JWTs cannot be revoked, so `User.sessionVersion` is
  compared on every session resolution and bumped on password change **and on reset**.
```

Also update the security note: `.env` now optionally carries `RESEND_API_KEY` and `MAIL_FROM`.

- [ ] **Step 5: Write the Firewall runbook into `BUILD-QUEUE.md`**

Add a new subsection under item 8's entry (which Step 6 rewrites). It is configuration, not code — **no test can assert any of it**:

```markdown
**Vercel Firewall rules — operator action, owed to the human. No code, no test.**

| Path | Limit | Why this path |
| --- | --- | --- |
| `POST /api/auth/callback/credentials` | 10/min/IP | The ~250ms bcrypt burner. CPU amplification as well as credential stuffing — and by design the unknown-account path costs the same, so an attacker does not even need real addresses. |
| `POST /signup` | 5/min/IP | Also the invite-code brute-force surface. 50 bits of code entropy assumes this rule exists. |
| `POST /forgot` | 5/min/IP | Mail-send amplification; someone else pays for the sends. |
| `POST /reset/*` | 10/min/IP | Token brute force. |

Server Actions POST to their own page's path carrying a `Next-Action` header, so path-based
rules do reach them.

**Per-account lockout is deliberately NOT built.** A hard lockout is itself an attack — anyone
who knows an address can lock its owner out on purpose, and there is no support desk to undo it.
Revisit only on evidence of real credential stuffing.
```

- [ ] **Step 6: Rewrite item 8's queue entry as built**

Replace the `### 8. ⬜ Open the doors …` heading and body with a `✅` entry naming: the spec and this plan; the commit range; the new test/lint/`tsc` baselines measured in Step 8 below; the §12 live-gate results from Step 7; and the two human-only gates still owed (a real Resend delivery, and the Firewall rules). Also record §14's known limits verbatim — a mail failure is silent to the user; no account deletion, so a fully-redeemed pool cannot be reclaimed; `invitedByCodeId` is `SetNull` so prefer `--revoke` over deleting a code; 50 bits assumes the Firewall rule; no admin UI.

- [ ] **Step 7: Run the agent-runnable half of the live gate (spec §12, steps 1-8)**

```bash
npm run seed:dev-user
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```

With **no `RESEND_API_KEY` set**, so links print to the server log. Set `CREDENTIALS_SIGNUP_ENABLED=true` on the dev process for the duration of the gate only. Record the actual observed result for each:

1. `npm run invite -- --uses 1 --label "live gate"` → sign up with it → the verification link appears in the server log.
2. Sign in before verifying → **refused**, with the verification copy (or the unconditional fallback, per Task 10 Step 6).
3. Follow the verify link → sign in **succeeds**.
4. Reuse the same verify link → **rejected** as already used.
5. Sign up again with the same now-exhausted code → **refused** with the invite message.
6. `/forgot` for the real account and for `nobody@example.invalid` → **byte-identical** responses (compare the rendered text exactly).
7. Follow the reset link, set a new password → the old session is **dead on the next request**.
8. Reuse the reset link → **rejected**.

Then stop the dev server (`netstat -ano | grep :3000`, `taskkill /PID <pid> /F`) and restore the dev account: `npm run seed:dev-user`.

- [ ] **Step 8: Measure the new baselines and record them**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx next build
npm run lint 2>&1 | tail -3
```

Write the resulting file/test counts and the lint problem count into BUILD-QUEUE's "Baselines" section, replacing the item 6e figures (127 files / 1522 tests, lint 175). **Do not fix unrelated lint.**

- [ ] **Step 9: Commit**

```bash
git add .env.example src/lib/auth/signup-flag.ts CLAUDE.md docs/superpowers/BUILD-QUEUE.md
git commit -m "docs: open the doors — flag meaning, mail env, firewall runbook, new baselines"
```

---

## What this plan deliberately does NOT do

Stated so a reviewer does not read them as gaps:

- **`tests/auth/edge-safety.test.ts` is not extended.** Its `FORBIDDEN` list already contains `@/lib/db` and the walk is transitive, so every new Prisma-importing module is covered for free. The mail module is `fetch`-only and edge-safe regardless (spec §2).
- **No `resend` npm dependency** (spec §9).
- **No rate-limiting code.** It is Vercel Firewall configuration; Task 12 writes the runbook (spec §10).
- **No per-account lockout.** A hard lockout is itself an attack (spec §1).
- **`CREDENTIALS_SIGNUP_ENABLED` is not flipped.** That is a human decision (spec §8).
- **No admin UI for invites.** Terminal-only, revisited when it hurts (spec §6).
- **No hosting change.** Explicitly out of scope; the live database held 4 users on 2026-08-20 (spec §0).
- **No magic-link sign-in.** Considered and rejected — a third auth path days after the second (spec §0).

## Human gates still owed after Task 12

1. **A real Resend delivery** — `RESEND_API_KEY` set against a verified sending domain, a message arriving in a real inbox, and its link working against the deployed origin. Not producible from an agent session.
2. **The Vercel Firewall rules** from §10 configured in the dashboard, and a burst of logins actually throttled.
3. **GitHub OAuth remains unreachable** (BUILD-QUEUE trap 6's surviving half) — including the check that an OAuth account with `emailVerified: null` still signs in, which is the one thing the verification gate must never break.
