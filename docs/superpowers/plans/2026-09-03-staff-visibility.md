# Staff Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a staff-only window onto the KLP engine — real roles replacing the `KLT_EDITORS` env var, an inspector for every KLP, per-learner engine records, coverage, and a concept list that expands to every topic and its key points instead of showing two roots.

**Architecture:** `User.role` rides on the primary-key lookup `jwtCallback` already performs on every session resolution, so staff status costs no extra query and cannot go stale in a JWT. Pure role predicates (`src/lib/auth/roles.ts`, Prisma-free, client-importable) are separated from async gates (`src/lib/staff/access.ts`, which call `auth()`); only gates authorize. The staff pages are built against the *target* schema, so Specs 2/3/5 fill columns that already exist. Separately, the concept list stops choosing one tree rung and becomes a parented disclosure tree.

**Tech Stack:** Next.js App Router (server components + `'use server'` actions), TypeScript, Prisma/Postgres (Neon), Auth.js JWT sessions, Vitest + Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-staff-visibility-design.md`

## Global Constraints

- **Baseline:** `npx vitest run` is **2504 passed / 1 failed (2505)**. The one failure is a known flake: `tests/actions/use-server-exports.test.ts` times out at 5000ms under full-suite contention and passes alone in ~3s. Do not treat it as a regression; Task 6 raises that timeout.
- **`'use server'` exports are RPC endpoints.** Every export of a file-level `'use server'` module is callable by anyone with the action id, not only the ones something imports. Every async export of `src/actions/staff.ts` must call a gate in its own body. No named re-exports from action modules — `tests/actions/klt-gated-exports-guard.test.ts` treats those as violations unconditionally.
- **Edge safety.** Nothing added here may become reachable from `src/auth.config.ts`; `tests/auth/edge-safety.test.ts` walks the transitive import graph and must keep passing untouched. `src/lib/auth/roles.ts` must import **nothing** — no Prisma, no `@/auth`.
- **String columns carry a const, never a literal.** `USER_ROLES` is the vocabulary for `User.role`, exactly as `CARD_KLP_STATUSES` is for `Card.klpStatus`. A typo in a bare string literal compiles and silently never matches.
- **`notFound()`, never a redirect or a permission message,** on every staff route — matching `src/app/(app)/concepts/page.tsx`. Someone who should not know a route exists must not learn that it does.
- **Null knowledge is never rendered as 0.** `avg(pKnown)` over zero learners is `null` and displays as an em dash. See `shadeForKnowledge`.
- Run tests with `npx vitest run <path>`. Commit after every task.

---

### Task 1: Role vocabulary and pure predicates

**Files:**
- Create: `src/lib/auth/roles.ts`
- Test: `tests/auth/roles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `USER_ROLES: readonly ['learner','staff','admin']`, `type UserRole`, `isStaff(role?: string | null): boolean`, `isAdmin(role?: string | null): boolean`, `isKnownRole(value: unknown): value is UserRole`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth/roles.test.ts
import { describe, it, expect } from 'vitest'
import { USER_ROLES, isStaff, isAdmin, isKnownRole } from '@/lib/auth/roles'

describe('USER_ROLES', () => {
  it('is exactly the three known roles, in ascending capability order', () => {
    expect(USER_ROLES).toEqual(['learner', 'staff', 'admin'])
  })
})

describe('isStaff', () => {
  it('admits staff and admin', () => {
    expect(isStaff('staff')).toBe(true)
    expect(isStaff('admin')).toBe(true)
  })

  it('refuses learner', () => {
    expect(isStaff('learner')).toBe(false)
  })

  // The analogue of the empty-id case isKltEditor guarded. A role read from a
  // session that failed to resolve must not admit anyone — a gate that opens
  // on missing input is not a gate.
  it('refuses undefined, null, empty string and any unknown value', () => {
    expect(isStaff(undefined)).toBe(false)
    expect(isStaff(null)).toBe(false)
    expect(isStaff('')).toBe(false)
    expect(isStaff('Admin')).toBe(false)
    expect(isStaff('superuser')).toBe(false)
  })
})

describe('isAdmin', () => {
  it('admits only admin', () => {
    expect(isAdmin('admin')).toBe(true)
    expect(isAdmin('staff')).toBe(false)
    expect(isAdmin('learner')).toBe(false)
  })

  it('refuses undefined, null, empty string and any unknown value', () => {
    expect(isAdmin(undefined)).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin('')).toBe(false)
    expect(isAdmin('ADMIN')).toBe(false)
  })
})

describe('isKnownRole', () => {
  it('narrows only the three members', () => {
    expect(isKnownRole('learner')).toBe(true)
    expect(isKnownRole('nope')).toBe(false)
    expect(isKnownRole(undefined)).toBe(false)
    expect(isKnownRole(7)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/roles.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/roles`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/roles.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth/roles.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/roles.ts tests/auth/roles.test.ts
git commit -m "feat(auth): add the user role vocabulary and pure predicates"
```

---

### Task 2: Schema — `User.role` and `RoleGrant`

**Files:**
- Modify: `prisma/schema.prisma` (the `User` model, and a new model after it)
- Create: `prisma/migrations/20260903000000_user_roles/migration.sql`

**Interfaces:**
- Consumes: `USER_ROLES` (Task 1) — as the documented vocabulary, not as an import.
- Produces: `User.role: String`, `RoleGrant` with fields `id, userId, role, grantedById, createdAt, revokedAt`.

- [ ] **Step 1: Add the column and model to the schema**

Add to `model User`, after `normalizedHandle`:

```prisma
  /// Install-wide capability. Vocabulary: USER_ROLES in src/lib/auth/roles.ts
  /// (learner|staff|admin). Import that const rather than writing a literal —
  /// this is a String column, so a typo compiles and never matches.
  ///
  /// Read on EVERY session resolution by jwtCallback, which already performs
  /// this primary-key lookup for sessionVersion. Deliberately NOT a JWT claim:
  /// a claim is written at sign-in and lives until the token expires, so
  /// revoking staff would leave the person staff for days — the exact failure
  /// sessionVersion exists to prevent, reintroduced one field over.
  role             String  @default("learner")
  roleGrants       RoleGrant[] @relation("RoleGrantSubject")
  rolesGranted     RoleGrant[] @relation("RoleGrantActor")
```

Add after `model User`:

```prisma
/// How a User.role got to be what it is.
///
/// `User.role` is the live answer; this is the history. "Who made this person
/// staff, and when" is the first question asked when something goes wrong, and
/// it is unrecoverable if not written at the time.
///
/// `grantedById` is nullable with SetNull: a grant made by the CLI has no
/// actor, and deleting the granter must not delete the record of the grant.
/// Revocation writes `revokedAt` and updates User.role. Rows are never deleted.
model RoleGrant {
  id          String    @id @default(cuid())
  userId      String
  role        String
  grantedById String?
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?
  user        User      @relation("RoleGrantSubject", fields: [userId], references: [id], onDelete: Cascade)
  grantedBy   User?     @relation("RoleGrantActor", fields: [grantedById], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Write the migration**

```sql
-- prisma/migrations/20260903000000_user_roles/migration.sql

-- Every existing row becomes a learner. This migration deliberately does NOT
-- read KLT_EDITORS: `prisma migrate deploy` runs inside `npm run build`, where
-- that variable may be absent, and a grant that silently stamps nobody would
-- lock the operator out with no signal. Use `npm run grant-role` instead.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'learner';

CREATE TABLE "RoleGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "RoleGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoleGrant_userId_createdAt_idx" ON "RoleGrant"("userId", "createdAt");

ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate the client and verify the schema is valid**

Run: `npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" and a successful generate.

- [ ] **Step 4: Apply the migration**

Run: `npx dotenv -e .env -- npx prisma migrate deploy` (or `npx prisma migrate deploy` with `DATABASE_URL` exported)
Expected: "1 migration found" and applied. If the database is unreachable, stop and report — do NOT proceed to Task 3 against an unmigrated database.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260903000000_user_roles
git commit -m "feat(db): add User.role and the RoleGrant audit table"
```

---

### Task 3: Carry the role on the session

**Files:**
- Modify: `src/lib/auth/session.ts`
- Modify: `types/next-auth.d.ts`
- Test: `tests/auth/session-role.test.ts`

**Interfaces:**
- Consumes: `User.role` (Task 2), `DEFAULT_ROLE` (Task 1).
- Produces: `session.user.role: string` on every resolved session; `ROLE_CLAIM` is deliberately NOT introduced.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth/session-role.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.findUnique } } }))

import { jwtCallback, sessionCallback } from '@/lib/auth/session'

beforeEach(() => vi.clearAllMocks())

describe('role on the session', () => {
  it('reads the role from the database on every resolution, not from the token', async () => {
    // The token carries a STALE role. The database says learner. The database wins.
    h.findUnique.mockResolvedValue({ sessionVersion: 3, role: 'learner' })

    const token = await jwtCallback({ token: { sub: 'u1', sv: 3, role: 'admin' } })
    expect(token).not.toBeNull()

    const session = await sessionCallback({
      session: { user: { id: undefined, name: 'A' } },
      token: token!,
    })
    expect(session.user?.role).toBe('learner')
  })

  it('stamps the role on first issue alongside the session version', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 0, role: 'staff' })

    const token = await jwtCallback({ token: {}, user: { id: 'u2' } })

    const session = await sessionCallback({ session: { user: {} }, token: token! })
    expect(session.user?.id).toBe('u2')
    expect(session.user?.role).toBe('staff')
  })

  it('falls back to learner when the row somehow has no role', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 0 })

    const token = await jwtCallback({ token: { sub: 'u3', sv: 0 } })
    const session = await sessionCallback({ session: { user: {} }, token: token! })
    expect(session.user?.role).toBe('learner')
  })

  it('still revokes on a session-version mismatch, role notwithstanding', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 9, role: 'admin' })
    expect(await jwtCallback({ token: { sub: 'u4', sv: 8 } })).toBeNull()
  })

  it('selects role in the SAME query as sessionVersion — no second round trip', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 0, role: 'admin' })
    await jwtCallback({ token: { sub: 'u5', sv: 0 } })

    expect(h.findUnique).toHaveBeenCalledTimes(1)
    expect(h.findUnique.mock.calls[0][0].select).toEqual({ sessionVersion: true, role: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/session-role.test.ts`
Expected: FAIL — `session.user.role` is undefined; the `select` assertion fails.

- [ ] **Step 3: Implement**

In `src/lib/auth/session.ts`, add `role` to the `TokenLike` and `SessionUserLike` types and to both `select` clauses, and copy it across in `sessionCallback`:

```ts
import { DEFAULT_ROLE } from '@/lib/auth/roles'

export const SESSION_VERSION_CLAIM = 'sv' as const

type TokenLike = {
  sub?: string
  [SESSION_VERSION_CLAIM]?: number
  role?: string
  [key: string]: unknown
}

type SessionUserLike = { id?: string; role?: string; name?: unknown; email?: unknown; image?: unknown }
```

In the `user?.id` branch:

```ts
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { sessionVersion: true, role: true },
    })
    return {
      ...token,
      sub: user.id,
      [SESSION_VERSION_CLAIM]: row?.sessionVersion ?? 0,
      role: row?.role ?? DEFAULT_ROLE,
    }
```

In the refresh branch:

```ts
  const current = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { sessionVersion: true, role: true },
  })
  if (!current) return null
  if (token[SESSION_VERSION_CLAIM] !== current.sessionVersion) return null

  // REWRITTEN every resolution, never trusted from the incoming token. The
  // token is a cache the browser holds; the database is the answer. A revoked
  // admin must stop being an admin on their next request, not when their token
  // expires.
  return { ...token, role: current.role ?? DEFAULT_ROLE }
```

And in `sessionCallback`, after the id assignment:

```ts
  if (session.user) {
    session.user.role = typeof token.role === 'string' ? token.role : DEFAULT_ROLE
  }
```

- [ ] **Step 4: Update the type augmentation**

```ts
// types/next-auth.d.ts
import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      /** USER_ROLES in src/lib/auth/roles.ts. Always present; 'learner' by default. */
      role: string
    } & DefaultSession["user"]
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/auth/session-role.test.ts tests/auth/edge-safety.test.ts && npx tsc --noEmit`
Expected: PASS on both suites; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/session.ts types/next-auth.d.ts tests/auth/session-role.test.ts
git commit -m "feat(auth): resolve User.role on every session, in the query already being made"
```

---

### Task 4: The gates

**Files:**
- Create: `src/lib/staff/access.ts`
- Test: `tests/staff/access.test.ts`

**Interfaces:**
- Consumes: `isStaff`, `isAdmin` (Task 1); `auth()` from `@/auth`.
- Produces: `interface StaffSession { userId: string; role: UserRole }`, `requireStaff(): Promise<StaffSession | null>`, `requireAdmin(): Promise<StaffSession | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/staff/access.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/auth', () => ({ auth: h.auth }))

import { requireStaff, requireAdmin } from '@/lib/staff/access'

beforeEach(() => vi.clearAllMocks())

describe('requireStaff', () => {
  it('resolves for staff and for admin', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    expect(await requireStaff()).toEqual({ userId: 'u1', role: 'staff' })

    h.auth.mockResolvedValue({ user: { id: 'u2', role: 'admin' } })
    expect(await requireStaff()).toEqual({ userId: 'u2', role: 'admin' })
  })

  it('returns null for a learner, a signed-out visitor, and a session with no id', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u3', role: 'learner' } })
    expect(await requireStaff()).toBeNull()

    h.auth.mockResolvedValue(null)
    expect(await requireStaff()).toBeNull()

    // A staff role with no id must NOT resolve — an empty subject is not a user.
    h.auth.mockResolvedValue({ user: { role: 'admin' } })
    expect(await requireStaff()).toBeNull()
  })

  it('returns null when the role is absent or unrecognised', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u4' } })
    expect(await requireStaff()).toBeNull()

    h.auth.mockResolvedValue({ user: { id: 'u5', role: 'superuser' } })
    expect(await requireStaff()).toBeNull()
  })
})

describe('requireAdmin', () => {
  it('resolves for admin only', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    expect(await requireAdmin()).toEqual({ userId: 'u1', role: 'admin' })
  })

  it('returns null for staff — the read role is not the grant role', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u2', role: 'staff' } })
    expect(await requireAdmin()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/staff/access.test.ts`
Expected: FAIL — cannot resolve `@/lib/staff/access`.

- [ ] **Step 3: Implement**

```ts
// src/lib/staff/access.ts
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

/** Grant roles, and everything KLT_EDITORS used to gate. Admin only. */
export function requireAdmin(): Promise<StaffSession | null> {
  return resolve(isAdmin)
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/staff/access.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staff/access.ts tests/staff/access.test.ts
git commit -m "feat(staff): add requireStaff and requireAdmin gates"
```

---

### Task 5: `npm run grant-role`

**Files:**
- Create: `scripts/grant-role.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `USER_ROLES`, `isKnownRole` (Task 1); `RoleGrant` (Task 2).
- Produces: the CLI. Nothing imports it.

- [ ] **Step 1: Write the script**

```ts
// scripts/grant-role.ts
/**
 * Grant, list and revoke install-wide roles.
 *
 * Terminal-first, deliberately: this is the BOOTSTRAP. /staff/roles can grant
 * once someone is already an admin, and this is how the first one exists — and
 * how an operator who revoked themselves gets back in without a redeploy.
 *
 * The migration does NOT read KLT_EDITORS, so after deploying, run this once.
 *
 * Run:
 *   npm run grant-role -- --list
 *   npm run grant-role -- --user <userId> --role admin
 *   npm run grant-role -- --email someone@example.com --role staff
 *   npm run grant-role -- --user <userId> --revoke
 */
import { prisma } from '../src/lib/db'
import { USER_ROLES, isKnownRole, DEFAULT_ROLE } from '../src/lib/auth/roles'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function resolveUserId(): Promise<string> {
  const id = flag('user')
  if (id) return id
  const email = flag('email')
  if (!email) throw new Error('Pass --user <userId> or --email <address>')
  const row = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!row) throw new Error(`No user with email ${email}`)
  return row.id
}

async function main() {
  if (has('list')) {
    const users = await prisma.user.findMany({
      where: { role: { not: DEFAULT_ROLE } },
      select: { id: true, email: true, handle: true, role: true },
      orderBy: { role: 'asc' },
    })
    if (users.length === 0) {
      console.log('Nobody holds a role above learner.')
      console.log('Bootstrap with: npm run grant-role -- --email you@example.com --role admin')
      return
    }
    for (const u of users) {
      console.log(`${u.role.padEnd(8)} ${u.handle ?? u.email}  (${u.id})`)
    }
    return
  }

  const userId = await resolveUserId()

  if (has('revoke')) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { role: DEFAULT_ROLE } }),
      prisma.roleGrant.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])
    console.log(`${userId} is now a ${DEFAULT_ROLE}.`)
    return
  }

  const role = flag('role')
  if (!isKnownRole(role)) {
    throw new Error(`--role must be one of: ${USER_ROLES.join(', ')}`)
  }

  await prisma.$transaction([
    // Close any open grant first, so the history reads as a sequence of
    // states rather than two simultaneous ones.
    prisma.roleGrant.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({ where: { id: userId }, data: { role } }),
    // grantedById is null: the CLI has no actor. That is the honest record.
    prisma.roleGrant.create({ data: { userId, role, grantedById: null } }),
  ])

  console.log(`${userId} is now a ${role}.`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 2: Add the npm script**

In `package.json`, in `"scripts"`, after `"invite"`:

```json
    "grant-role": "tsx --env-file=.env scripts/grant-role.ts",
```

- [ ] **Step 3: Verify it runs and reports an empty install**

Run: `npm run grant-role -- --list`
Expected: "Nobody holds a role above learner." plus the bootstrap hint.

- [ ] **Step 4: Grant yourself admin and confirm**

Run: `npm run grant-role -- --email ruigong34@icloud.com --role admin`
Then: `npm run grant-role -- --list`
Expected: one `admin` row. If the email does not match a `User` row, find the id with `npm run grant-role -- --list` after checking the database, and use `--user <id>`.

- [ ] **Step 5: Commit**

```bash
git add scripts/grant-role.ts package.json
git commit -m "feat(staff): add npm run grant-role, the role bootstrap"
```

---

### Task 6: Cut `KLT_EDITORS` over to roles

**Files:**
- Delete: `src/lib/klt/editors.ts`, `tests/klt/editors.test.ts`
- Modify: `src/lib/klt/access.ts`, `src/actions/klt-presets.ts`, `src/actions/set-reports.ts`, `src/app/(app)/concepts/page.tsx`, `src/components/klt/ConceptTree.tsx`, `src/app/(app)/sets/[id]/concepts/page.tsx`
- Modify: `tests/klt/access.test.ts`, `tests/app/concepts-page.test.tsx`, `tests/klt/presets.test.ts`, `tests/actions/klt-gated-exports-guard.test.ts`, `tests/actions/use-server-exports.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `isAdmin` (Task 1), `requireAdmin` (Task 4).
- Produces: no new exports. `SetKltAccess.viaAllowlist` is renamed to `viaRole`; `SetKltView.viaAllowlist` likewise.

- [ ] **Step 1: Update the two `access.ts` gates**

In `src/lib/klt/access.ts`, replace the `isKltEditor` import with `import { isAdmin } from '@/lib/auth/roles'`, rename both `viaAllowlist` fields to `viaRole`, and compute them from the session:

```ts
export async function requireSetKltAccess(setId: string): Promise<SetKltAccess | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const viaRole = isAdmin(session?.user?.role)
  const set = await prisma.set.findFirst({
    where: viaRole ? { id: setId } : { id: setId, userId },
    select: { id: true, title: true },
  })
  if (!set) return null

  return { userId, setId: set.id, setTitle: set.title, viaRole }
}
```

and in `requireSetKltView`:

```ts
  const viaRole = viewerId !== null && isAdmin(session?.user?.role)
```

Update the module doc comment: the rule is now "the set's owner, OR an **admin**", and the operator list is a role, not an env var.

- [ ] **Step 2: Update the three remaining call sites**

`src/actions/klt-presets.ts` — `isCallerKltAdmin` becomes:

```ts
async function isCallerKltAdmin(): Promise<boolean> {
  return (await requireAdmin()) !== null
}
```

with `import { requireAdmin } from '@/lib/staff/access'` replacing the `isKltEditor` and `auth` imports (keep `auth` only if still used elsewhere in the file).

`src/actions/set-reports.ts` line ~103:

```ts
    if (!(await requireAdmin())) return { success: false, error: 'Not found' }
```

`src/app/(app)/concepts/page.tsx`:

```ts
import { requireAdmin } from '@/lib/staff/access'
// ...
export default async function ConceptsPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  // ...unchanged
```

Rename the `viaAllowlist` prop on `ConceptTree` to `viaRole` and update `src/app/(app)/sets/[id]/concepts/page.tsx`'s comment about `KLT_EDITORS` to name the admin role.

- [ ] **Step 3: Update the guard test — it names the old gate by regex**

In `tests/actions/klt-gated-exports-guard.test.ts`:

```ts
const GATE_PATTERNS = [
  /requireSetKltAccess\s*\(/,
  /isCallerKltAdmin\s*\(\s*\)/,
  /requireAdmin\s*\(/,
  /requireStaff\s*\(/,
]
```

and extend the module list to cover the new action module (created in Task 7):

```ts
const FILES = ['klt-seed.ts', 'klt-tree.ts', 'klt-presets.ts', 'klt.ts', 'staff.ts']
```

Note: `staff.ts` does not exist yet. Add it to `FILES` in **Task 7**, not here — a guard that reads a missing file fails. In this task, only `GATE_PATTERNS` changes.

- [ ] **Step 4: Fix the flaky sibling while you are here**

`tests/actions/use-server-exports.test.ts` walks the source tree and times out at the 5000ms default under full-suite contention (the known baseline failure). Give that one test room:

```ts
  it('flags no non-async exports from any file-level "use server" module', { timeout: 30_000 }, () => {
```

- [ ] **Step 5: Update the three moved test files**

Delete `tests/klt/editors.test.ts` (Task 1's `tests/auth/roles.test.ts` replaces it).

In `tests/klt/access.test.ts` and `tests/klt/presets.test.ts`, replace `process.env.KLT_EDITORS = ADMIN` with an auth mock returning `{ user: { id: ADMIN, role: 'admin' } }`, and assert `viaRole` where `viaAllowlist` was asserted.

In `tests/app/concepts-page.test.tsx`, replace every `process.env.KLT_EDITORS` line with a role on the mocked session, and rename the third test:

```ts
  it('calls notFound() for a signed-in learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone', role: 'learner' } })
    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalledTimes(1)
    expect(h.setFindMany).not.toHaveBeenCalled()
  })

  it('calls notFound() for staff — reading the engine is not editing structure', async () => {
    h.auth.mockResolvedValue({ user: { id: 'someone', role: 'staff' } })
    await expect(ConceptsPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
```

The `beforeEach` no longer needs `delete process.env.KLT_EDITORS`. The passing test sets `role: 'admin'`.

- [ ] **Step 6: Remove the dead variable from `.env.example`**

Delete the `KLT_EDITORS` line and its comment. Add nothing in its place — roles live in the database now.

- [ ] **Step 7: Delete the module and run the affected suites**

```bash
rm src/lib/klt/editors.ts tests/klt/editors.test.ts
```

Run: `npx vitest run tests/klt tests/app/concepts-page.test.tsx tests/actions && npx tsc --noEmit`
Expected: PASS. `tsc` catches any missed `viaAllowlist` reference.

- [ ] **Step 8: Verify nothing still references the old gate**

Run: `grep -rn "KLT_EDITORS\|isKltEditor\|viaAllowlist" src tests scripts .env.example docs/superpowers/BUILD-QUEUE.md`
Expected: matches ONLY in `docs/` prose describing history. Zero in `src`, `tests`, `scripts`, `.env.example`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(auth): replace the KLT_EDITORS allowlist with the admin role"
```

---

### Task 7: Staff queries and the gated action module

**Files:**
- Create: `src/lib/staff/queries.ts`
- Create: `src/actions/staff.ts`
- Test: `tests/staff/actions-gating.test.ts`
- Modify: `tests/actions/klt-gated-exports-guard.test.ts` (add `staff.ts` to `FILES`)

**Interfaces:**
- Consumes: `requireStaff`, `requireAdmin` (Task 4).
- Produces:
  - `interface StaffKlpRow { id, text, label, cardId, cardTerm, setId, kind, weight, version, supersededAt, topics: {name,rank}[], learnerCount, meanPKnown: number | null, verdicts: Record<string, number> }`
  - `interface StaffCoverageRow { setId, setTitle, ownerLabel, total, byKlpStatus: Record<string, number>, byKltStatus: Record<string, number>, failures: { cardId, term, klpError }[] }`
  - `listStaffKlps(input: { setId?: string; search?: string; includeSuperseded?: boolean }): Promise<ActionResult<StaffKlpRow[]>>`
  - `listStaffCoverage(): Promise<ActionResult<StaffCoverageRow[]>>`
  - `listStaffOverview(): Promise<ActionResult<StaffOverview>>`

- [ ] **Step 1: Write the failing gating test**

```ts
// tests/staff/actions-gating.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), prisma: {} as Record<string, unknown> }))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: h.prisma }))

import * as staff from '@/actions/staff'

beforeEach(() => vi.clearAllMocks())

/**
 * Every export of a 'use server' module is an RPC endpoint. This asserts the
 * REFUSAL half: a gate proven to admit is worth little without one proven to
 * refuse. It calls every export generically, so a new action added later
 * without a gate fails here without anyone remembering to add a case.
 */
describe('src/actions/staff.ts refuses a learner on every export', () => {
  const exported = Object.entries(staff).filter(
    ([, v]) => typeof v === 'function',
  ) as [string, (arg?: unknown) => Promise<{ success: boolean; error?: string }>][]

  it('exports at least three actions', () => {
    expect(exported.length).toBeGreaterThanOrEqual(3)
  })

  for (const [name, fn] of exported) {
    it(`${name} returns Not found for a learner`, async () => {
      h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
      const res = await fn({})
      expect(res).toEqual({ success: false, error: 'Not found' })
    })

    it(`${name} returns Not found for a signed-out visitor`, async () => {
      h.auth.mockResolvedValue(null)
      const res = await fn({})
      expect(res).toEqual({ success: false, error: 'Not found' })
    })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/staff/actions-gating.test.ts`
Expected: FAIL — cannot resolve `@/actions/staff`.

- [ ] **Step 3: Write the query layer**

```ts
// src/lib/staff/queries.ts
/**
 * The staff surface's reads.
 *
 * A PLAIN module with no 'use server' directive, deliberately. Everything here
 * is ungated by construction; the gate lives in src/actions/staff.ts, and if
 * these functions were exported from that module they would each be a callable
 * RPC endpoint handing the whole install to anyone with the action id.
 */
import { prisma } from '@/lib/db'
import { CARD_KLP_STATUSES } from '@/lib/cards/klp-status'

export interface StaffKlpRow {
  id: string
  text: string
  label: string | null
  cardId: string
  cardTerm: string
  setId: string
  kind: string
  weight: number
  version: number
  supersededAt: Date | null
  topics: { name: string; rank: number }[]
  learnerCount: number
  /** NULL when no learner has evidence. Never 0 — see shadeForKnowledge. */
  meanPKnown: number | null
  /** AnswerKlpResult.status -> count. Three keys today, thirteen after Spec 5. */
  verdicts: Record<string, number>
}

export interface StaffKlpQuery {
  setId?: string
  search?: string
  includeSuperseded?: boolean
}

export async function loadStaffKlps(q: StaffKlpQuery): Promise<StaffKlpRow[]> {
  const klps = await prisma.cardKlp.findMany({
    where: {
      ...(q.includeSuperseded ? {} : { supersededAt: null }),
      ...(q.setId ? { card: { setId: q.setId } } : {}),
      ...(q.search
        ? {
            OR: [
              { text: { contains: q.search, mode: 'insensitive' as const } },
              { label: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      text: true,
      label: true,
      cardId: true,
      kind: true,
      weight: true,
      version: true,
      supersededAt: true,
      card: { select: { term: true, setId: true } },
      topics: { select: { rank: true, klt: { select: { name: true } } } },
    },
    orderBy: [{ card: { position: 'asc' } }, { index: 'asc' }],
    take: 500,
  })

  if (klps.length === 0) return []
  const ids = klps.map((k) => k.id)

  // Two grouped aggregates rather than nested includes: a per-KLP include of
  // every KlpState and AnswerKlpResult row would load the whole evidence table
  // to render a count.
  const [states, verdicts] = await Promise.all([
    prisma.klpState.groupBy({
      by: ['klpId'],
      where: { klpId: { in: ids } },
      _count: { _all: true },
      _avg: { pKnown: true },
    }),
    prisma.answerKlpResult.groupBy({
      by: ['klpId', 'status'],
      where: { klpId: { in: ids } },
      _count: { _all: true },
    }),
  ])

  const stateBy = new Map(states.map((s) => [s.klpId, s]))
  const verdictBy = new Map<string, Record<string, number>>()
  for (const v of verdicts) {
    const bucket = verdictBy.get(v.klpId) ?? {}
    bucket[v.status] = v._count._all
    verdictBy.set(v.klpId, bucket)
  }

  return klps.map((k) => {
    const state = stateBy.get(k.id)
    const learnerCount = state?._count._all ?? 0
    return {
      id: k.id,
      text: k.text,
      label: k.label,
      cardId: k.cardId,
      cardTerm: k.card.term,
      setId: k.card.setId,
      kind: k.kind,
      weight: k.weight,
      version: k.version,
      supersededAt: k.supersededAt,
      topics: k.topics.map((t) => ({ name: t.klt.name, rank: t.rank })),
      learnerCount,
      // Zero learners means NO EVIDENCE, which is not zero knowledge.
      meanPKnown: learnerCount === 0 ? null : (state?._avg.pKnown ?? null),
      verdicts: verdictBy.get(k.id) ?? {},
    }
  })
}

export interface StaffCoverageRow {
  setId: string
  setTitle: string
  ownerLabel: string
  total: number
  byKlpStatus: Record<string, number>
  byKltStatus: Record<string, number>
  failures: { cardId: string; term: string; klpError: string | null }[]
}

export async function loadStaffCoverage(): Promise<StaffCoverageRow[]> {
  const sets = await prisma.set.findMany({
    select: {
      id: true,
      title: true,
      user: { select: { handle: true, name: true, email: true } },
      cards: {
        select: { id: true, term: true, klpStatus: true, kltStatus: true, klpError: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return sets.map((s) => {
    const byKlpStatus: Record<string, number> = {}
    const byKltStatus: Record<string, number> = {}
    for (const status of CARD_KLP_STATUSES) {
      byKlpStatus[status] = 0
      byKltStatus[status] = 0
    }
    for (const c of s.cards) {
      byKlpStatus[c.klpStatus] = (byKlpStatus[c.klpStatus] ?? 0) + 1
      byKltStatus[c.kltStatus] = (byKltStatus[c.kltStatus] ?? 0) + 1
    }
    return {
      setId: s.id,
      setTitle: s.title,
      ownerLabel: s.user.handle ?? s.user.name ?? s.user.email,
      total: s.cards.length,
      byKlpStatus,
      byKltStatus,
      failures: s.cards
        .filter((c) => c.klpStatus === 'failed')
        .map((c) => ({ cardId: c.id, term: c.term, klpError: c.klpError })),
    }
  })
}

export interface StaffOverview {
  liveKlps: number
  supersededKlps: number
  cardsByKlpStatus: Record<string, number>
  learnersWithEvidence: number
  sets: number
}

export async function loadStaffOverview(): Promise<StaffOverview> {
  const [live, superseded, byStatus, learners, sets] = await Promise.all([
    prisma.cardKlp.count({ where: { supersededAt: null } }),
    prisma.cardKlp.count({ where: { supersededAt: { not: null } } }),
    prisma.card.groupBy({ by: ['klpStatus'], _count: { _all: true } }),
    prisma.klpState.findMany({ distinct: ['userId'], select: { userId: true } }),
    prisma.set.count(),
  ])

  const cardsByKlpStatus: Record<string, number> = {}
  for (const status of CARD_KLP_STATUSES) cardsByKlpStatus[status] = 0
  for (const row of byStatus) cardsByKlpStatus[row.klpStatus] = row._count._all

  return {
    liveKlps: live,
    supersededKlps: superseded,
    cardsByKlpStatus,
    learnersWithEvidence: learners.length,
    sets,
  }
}
```

- [ ] **Step 4: Write the action module**

```ts
// src/actions/staff.ts
'use server'

/**
 * The staff surface's server actions.
 *
 * EVERY export here is a callable RPC endpoint, not only the ones a page
 * imports — the finding tests/actions/klt-gated-exports-guard.test.ts exists to
 * enforce. So every export calls a gate in its OWN body, no helper is exported
 * for reuse (shared internals live in src/lib/staff/queries.ts, a plain
 * module), and nothing is re-exported by name.
 */
import { requireStaff } from '@/lib/staff/access'
import {
  loadStaffKlps,
  loadStaffCoverage,
  loadStaffOverview,
  type StaffKlpRow,
  type StaffKlpQuery,
  type StaffCoverageRow,
  type StaffOverview,
} from '@/lib/staff/queries'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }

export async function listStaffKlps(input: StaffKlpQuery): Promise<ActionResult<StaffKlpRow[]>> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadStaffKlps(input ?? {}) }
}

export async function listStaffCoverage(): Promise<ActionResult<StaffCoverageRow[]>> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadStaffCoverage() }
}

export async function listStaffOverview(): Promise<ActionResult<StaffOverview>> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadStaffOverview() }
}
```

- [ ] **Step 5: Add `staff.ts` to the exports guard**

In `tests/actions/klt-gated-exports-guard.test.ts`:

```ts
const FILES = ['klt-seed.ts', 'klt-tree.ts', 'klt-presets.ts', 'klt.ts', 'staff.ts']
```

and widen the `it(...)` description to name it.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/staff tests/actions/klt-gated-exports-guard.test.ts && npx tsc --noEmit`
Expected: PASS. The gating test's generic loop covers all three actions in both directions.

- [ ] **Step 7: Commit**

```bash
git add src/lib/staff/queries.ts src/actions/staff.ts tests/staff/actions-gating.test.ts tests/actions/klt-gated-exports-guard.test.ts
git commit -m "feat(staff): add gated staff queries for KLPs, coverage and the overview"
```

---

### Task 8: `/staff` index and the page-gate test helper

**Files:**
- Create: `src/app/(app)/staff/page.tsx`
- Create: `src/app/(app)/staff/StaffNav.tsx`
- Test: `tests/app/staff-pages.test.tsx`

**Interfaces:**
- Consumes: `requireStaff` (Task 4), `loadStaffOverview` (Task 7).
- Produces: `StaffNav` (client component, tab links).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/app/staff-pages.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(),
  overview: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
  usePathname: () => '/staff',
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/staff/queries', () => ({ loadStaffOverview: h.overview }))

import StaffPage from '@/app/(app)/staff/page'

beforeEach(() => {
  vi.clearAllMocks()
  h.overview.mockResolvedValue({
    liveKlps: 12,
    supersededKlps: 3,
    cardsByKlpStatus: { pending: 166, ready: 125, failed: 0, skipped: 0 },
    learnersWithEvidence: 2,
    sets: 4,
  })
})
afterEach(cleanup)

describe('/staff', () => {
  it('404s for a signed-out visitor, and never reads any data', async () => {
    h.auth.mockResolvedValue(null)
    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.overview).not.toHaveBeenCalled()
  })

  it('404s for a learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.overview).not.toHaveBeenCalled()
  })

  it('renders the engine counts for staff', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    render(await StaffPage())
    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('166')).toBeInTheDocument()
  })

  it('renders for an admin too', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    render(await StaffPage())
    expect(h.notFound).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/staff-pages.test.tsx`
Expected: FAIL — cannot resolve `@/app/(app)/staff/page`.

- [ ] **Step 3: Write the nav**

```tsx
// src/app/(app)/staff/StaffNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/staff', label: 'Overview' },
  { href: '/staff/klps', label: 'Key points' },
  { href: '/staff/coverage', label: 'Coverage' },
  { href: '/staff/learners', label: 'Learners' },
] as const

/**
 * EXACT MATCH, never startsWith — the rule src/lib/shell/nav.ts documents.
 * `/staff` is a prefix of every tab here, so a prefix test would light the
 * Overview tab on every page.
 */
export function StaffNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const tabs = isAdmin ? [...TABS, { href: '/staff/roles', label: 'Roles' }] : TABS

  return (
    <nav aria-label="Staff" className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className={cn(
            'px-3 py-2 text-sm border-b-2 -mb-px',
            pathname === t.href
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Write the page**

```tsx
// src/app/(app)/staff/page.tsx
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadStaffOverview } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from './StaffNav'

/**
 * The engine at a glance.
 *
 * notFound() — a real 404 — for anyone below staff, never a redirect and never
 * a "you are not allowed" message: someone who should not know this route
 * exists must not learn that it does. Same posture as /concepts.
 */
export default async function StaffPage() {
  const staff = await requireStaff()
  if (!staff) notFound()

  const o = await loadStaffOverview()

  const tiles: { label: string; value: number; hint?: string }[] = [
    { label: 'Live key points', value: o.liveKlps },
    { label: 'Superseded', value: o.supersededKlps, hint: 'kept — history stays truthful' },
    { label: 'Cards awaiting extraction', value: o.cardsByKlpStatus.pending ?? 0 },
    { label: 'Cards extracted', value: o.cardsByKlpStatus.ready ?? 0 },
    { label: 'Extraction failures', value: o.cardsByKlpStatus.failed ?? 0 },
    { label: 'Learners with evidence', value: o.learnersWithEvidence },
    { label: 'Sets', value: o.sets },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Engine</h1>
        <p className="text-sm text-muted-foreground">
          What the extraction, mastery and diagnosis passes have actually produced.
        </p>
      </div>

      <StaffNav isAdmin={isAdmin(staff.role)} />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border p-4">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{t.value}</dd>
            {t.hint && <p className="mt-1 text-[11px] text-muted-foreground">{t.hint}</p>}
          </div>
        ))}
      </dl>
    </div>
  )
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/app/staff-pages.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/staff" tests/app/staff-pages.test.tsx
git commit -m "feat(staff): add the /staff overview and tab nav"
```

---

### Task 9: `/staff/klps` — the inspector

**Files:**
- Create: `src/app/(app)/staff/klps/page.tsx`
- Create: `src/components/staff/KlpTable.tsx`
- Test: append to `tests/app/staff-pages.test.tsx`; create `tests/staff/klp-table.test.tsx`

**Interfaces:**
- Consumes: `requireStaff` (Task 4), `loadStaffKlps`, `StaffKlpRow` (Task 7).
- Produces: `KlpTable({ rows }: { rows: StaffKlpRow[] })`, a server component.

- [ ] **Step 1: Write the failing table test**

```tsx
// tests/staff/klp-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { KlpTable } from '@/components/staff/KlpTable'
import type { StaffKlpRow } from '@/lib/staff/queries'

afterEach(cleanup)

function row(over: Partial<StaffKlpRow> = {}): StaffKlpRow {
  return {
    id: 'k1',
    text: 'Depreciation reduces EBIT by the full 10.',
    label: 'EBIT falls 10',
    cardId: 'c1',
    cardTerm: 'Depreciation walkthrough',
    setId: 's1',
    kind: 'mechanism',
    weight: 5,
    version: 1,
    supersededAt: null,
    topics: [{ name: 'income statement', rank: 1 }],
    learnerCount: 3,
    meanPKnown: 0.62,
    verdicts: { passed: 4, failed: 2 },
    ...over,
  }
}

describe('KlpTable', () => {
  it('prefers the short label and still exposes the full text', () => {
    render(<KlpTable rows={[row()]} />)
    expect(screen.getByText('EBIT falls 10')).toBeInTheDocument()
    expect(screen.getByTitle('Depreciation reduces EBIT by the full 10.')).toBeInTheDocument()
  })

  it('falls back to the text when the topic pass has not run', () => {
    render(<KlpTable rows={[row({ label: null })]} />)
    expect(screen.getByText('Depreciation reduces EBIT by the full 10.')).toBeInTheDocument()
  })

  // The G1 finding: no evidence is not zero knowledge, and rendering 0% would
  // make an unasked key point indistinguishable from a failed one.
  it('renders an em dash, never 0%, when no learner has evidence', () => {
    render(<KlpTable rows={[row({ learnerCount: 0, meanPKnown: null })]} />)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('renders the verdict mix from whatever statuses are present, not a fixed three', () => {
    render(<KlpTable rows={[row({ verdicts: { passed: 1, inversion: 2, omission: 5 } })]} />)
    expect(screen.getByText(/inversion/)).toBeInTheDocument()
    expect(screen.getByText(/omission/)).toBeInTheDocument()
  })

  it('renders the Relations column as pending, so Spec 3 fills a column that exists', () => {
    render(<KlpTable rows={[row()]} />)
    expect(screen.getByRole('columnheader', { name: /relations/i })).toBeInTheDocument()
  })

  it('marks a superseded row as superseded', () => {
    render(<KlpTable rows={[row({ supersededAt: new Date('2026-08-01') })]} />)
    expect(screen.getByText(/superseded/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/staff/klp-table.test.tsx`
Expected: FAIL — cannot resolve `@/components/staff/KlpTable`.

- [ ] **Step 3: Write the table**

```tsx
// src/components/staff/KlpTable.tsx
import Link from 'next/link'
import type { StaffKlpRow } from '@/lib/staff/queries'

/**
 * Every key point, with the evidence standing behind it.
 *
 * TWO COLUMNS SHIP DELIBERATELY THIN. `Relations` is empty until Spec 3 and
 * renders an em dash; `Verdicts` reads whatever statuses exist rather than a
 * hardcoded three, so Spec 5's widening to thirteen labels needs no change
 * here. A column added later would move every other column and re-open layout
 * decisions already made — which is the whole reason this page is built first.
 */
export function KlpTable({ rows }: { rows: StaffKlpRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No key points match. A set whose cards are all still <code>pending</code> has none yet —
        check Coverage.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left align-bottom">
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Key point</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Card</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Kind</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Weight</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Topics</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Learners</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Mean known</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Verdicts</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Relations</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 align-top">
              <td className="py-2 pr-4 max-w-xs">
                <span title={r.text}>{r.label ?? r.text}</span>
                {r.supersededAt && (
                  <span className="ml-2 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">
                    superseded
                  </span>
                )}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">v{r.version}</span>
              </td>
              <td className="py-2 pr-4">
                <Link href={`/sets/${r.setId}/edit`} className="hover:underline">
                  {r.cardTerm}
                </Link>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{r.kind}</td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.weight}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.topics.length === 0
                  ? '—'
                  : r.topics
                      .slice()
                      .sort((a, b) => a.rank - b.rank)
                      .map((t) => t.name)
                      .join(', ')}
              </td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.learnerCount}</td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">
                {/* Null is NO EVIDENCE. 0% would read as "nobody knows this",
                    which is a different and much stronger claim. */}
                {r.meanPKnown === null ? '—' : `${Math.round(r.meanPKnown * 100)}%`}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {Object.keys(r.verdicts).length === 0
                  ? '—'
                  : Object.entries(r.verdicts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, n]) => `${status} ${n}`)
                      .join(' · ')}
              </td>
              <td className="py-2 text-xs text-muted-foreground" title="Filled by Spec 3 — relations">
                —
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Write the page**

```tsx
// src/app/(app)/staff/klps/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireStaff } from '@/lib/staff/access'
import { loadStaffKlps } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'
import { KlpTable } from '@/components/staff/KlpTable'

/**
 * Set-scoped by default, with a search across text and label.
 *
 * Install-wide LISTING with no filter is deliberately not offered: the corpus
 * is in the thousands and a page rendering all of them is a page nobody reads.
 * `take: 500` in loadStaffKlps is the backstop.
 */
export default async function StaffKlpsPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string; q?: string; superseded?: string }>
}) {
  const staff = await requireStaff()
  if (!staff) notFound()

  const params = await searchParams
  const sets = await prisma.set.findMany({
    select: { id: true, title: true },
    orderBy: { updatedAt: 'desc' },
  })

  const setId = params.set ?? sets[0]?.id
  const rows = await loadStaffKlps({
    setId: params.q ? undefined : setId,
    search: params.q,
    includeSuperseded: params.superseded === '1',
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Key points</h1>
      <StaffNav isAdmin={isAdmin(staff.role)} />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Set</span>
          <select name="set" defaultValue={setId} className="rounded-md border px-2 py-1.5 text-sm">
            {sets.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Search all sets</span>
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="text or label"
            className="rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="superseded" value="1" defaultChecked={params.superseded === '1'} />
          Show superseded
        </label>
        <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">Apply</button>
      </form>

      <KlpTable rows={rows} />
    </div>
  )
}
```

- [ ] **Step 5: Add the page gate test**

Append to `tests/app/staff-pages.test.tsx` — add `loadStaffKlps: h.klps` to the `@/lib/staff/queries` mock factory and `prisma` to the mocks, then:

```tsx
import StaffKlpsPage from '@/app/(app)/staff/klps/page'

describe('/staff/klps', () => {
  it('404s for a learner and reads no key points', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(
      StaffKlpsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.klps).not.toHaveBeenCalled()
  })

  it('404s for a signed-out visitor', async () => {
    h.auth.mockResolvedValue(null)
    await expect(
      StaffKlpsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/staff/klp-table.test.tsx tests/app/staff-pages.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/staff/klps" src/components/staff/KlpTable.tsx tests/staff/klp-table.test.tsx tests/app/staff-pages.test.tsx
git commit -m "feat(staff): add the /staff/klps inspector with target-schema columns"
```

---

### Task 10: `/staff/coverage`

**Files:**
- Create: `src/app/(app)/staff/coverage/page.tsx`
- Test: append to `tests/app/staff-pages.test.tsx`

**Interfaces:**
- Consumes: `requireStaff` (Task 4), `loadStaffCoverage`, `StaffCoverageRow` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/app/staff-pages.test.tsx`, adding `loadStaffCoverage: h.coverage` to the queries mock:

```tsx
import StaffCoveragePage from '@/app/(app)/staff/coverage/page'

describe('/staff/coverage', () => {
  beforeEach(() => {
    h.coverage.mockResolvedValue([
      {
        setId: 's1',
        setTitle: 'Accounting - Knowledge',
        ownerLabel: 'nathan',
        total: 50,
        byKlpStatus: { pending: 50, ready: 0, failed: 0, skipped: 0 },
        byKltStatus: { pending: 50, ready: 0, failed: 0, skipped: 0 },
        failures: [],
      },
    ])
  })

  it('404s for a learner and reads no coverage', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(StaffCoveragePage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.coverage).not.toHaveBeenCalled()
  })

  it('shows the extraction gap that demand-driven extraction left invisible', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    render(await StaffCoveragePage())
    expect(screen.getByText('Accounting - Knowledge')).toBeInTheDocument()
    expect(screen.getByText('0/50')).toBeInTheDocument()
  })

  it('reports klpStatus and kltStatus separately — the two passes fail independently', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    render(await StaffCoveragePage())
    expect(screen.getByRole('columnheader', { name: /key points/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /topics/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/staff-pages.test.tsx`
Expected: FAIL — cannot resolve the coverage page.

- [ ] **Step 3: Write the page**

```tsx
// src/app/(app)/staff/coverage/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadStaffCoverage } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'

/**
 * How much of the corpus the engine has actually seen.
 *
 * Audit finding G2 was that 166 of 291 cards had never been extracted, with
 * ZERO recorded failures, because extraction was demand-driven — a number
 * invisible from the code and from every existing screen. This page is where
 * Spec 2's backfill is watched.
 *
 * REPORTS ONLY. Retry controls are deliberately out of scope: retryKlpExtraction
 * is owner-scoped, making it staff-callable across other people's sets is a
 * write capability, and Spec 2 changes how extraction works anyway.
 *
 * klpStatus and kltStatus get SEPARATE columns because the two passes fail
 * independently — a card can have good key points and no topics. One merged
 * column would offer the wrong retry for the wrong failure.
 */
export default async function StaffCoveragePage() {
  const staff = await requireStaff()
  if (!staff) notFound()

  const rows = await loadStaffCoverage()
  const totals = rows.reduce(
    (acc, r) => ({
      cards: acc.cards + r.total,
      ready: acc.ready + (r.byKlpStatus.ready ?? 0),
    }),
    { cards: 0, ready: 0 },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Coverage</h1>
        <p className="text-sm text-muted-foreground">
          {totals.ready} of {totals.cards} cards have key points
          {totals.cards > 0 && ` — ${Math.round((totals.ready / totals.cards) * 100)}%`}.
        </p>
      </div>

      <StaffNav isAdmin={isAdmin(staff.role)} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="pb-2 font-normal text-muted-foreground">Set</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground">Owner</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Key points</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Topics</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground">Failures</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.setId} className="border-b last:border-0 align-top">
                <td className="py-2 pr-4">
                  <Link href={`/staff/klps?set=${r.setId}`} className="hover:underline">
                    {r.setTitle}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{r.ownerLabel}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {r.byKlpStatus.ready ?? 0}/{r.total}
                </td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {r.byKltStatus.ready ?? 0}/{r.total}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {r.failures.length === 0
                    ? '—'
                    : r.failures.map((f) => (
                        <div key={f.cardId} title={f.klpError ?? undefined}>
                          {f.term}
                        </div>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/app/staff-pages.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/staff/coverage" tests/app/staff-pages.test.tsx
git commit -m "feat(staff): add /staff/coverage, the extraction-gap watch window"
```

---

### Task 11: `/staff/learners` and `/staff/learners/[id]`

**Files:**
- Create: `src/app/(app)/staff/learners/page.tsx`
- Create: `src/app/(app)/staff/learners/[id]/page.tsx`
- Modify: `src/lib/staff/queries.ts` (add `loadLearnerIndex`, `loadLearnerRecord`)
- Modify: `src/actions/staff.ts` (add `listStaffLearners`, gated)
- Test: append to `tests/app/staff-pages.test.tsx`

**Interfaces:**
- Consumes: `requireStaff` (Task 4).
- Produces:
  - `loadLearnerIndex(): Promise<{ userId: string; label: string; klpStates: number; lastObservedAt: Date | null }[]>`
  - `loadLearnerRecord(userId: string): Promise<LearnerRecord | null>` where `LearnerRecord = { label: string; weakest: { klpId, text, pKnown, observations }[]; recentAnswers: { id, createdAt, mode, analysisStatus, cardTerm, verdicts: {status,klpText}[], tags: {dimension,type,significance}[] }[]; analysisStatusCounts: Record<string, number> }`

- [ ] **Step 1: Write the failing test**

Append to `tests/app/staff-pages.test.tsx`, adding `loadLearnerIndex: h.learnerIndex, loadLearnerRecord: h.learnerRecord` to the queries mock:

```tsx
import StaffLearnerPage from '@/app/(app)/staff/learners/[id]/page'

describe('/staff/learners/[id]', () => {
  beforeEach(() => {
    h.learnerRecord.mockResolvedValue({
      label: 'nathan',
      weakest: [{ klpId: 'k1', text: 'EBIT falls by the full depreciation', pKnown: 0.18, observations: 4 }],
      recentAnswers: [],
      analysisStatusCounts: { analyzed: 12, no_klps: 3 },
    })
  })

  it('404s for a learner reading another learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', role: 'learner' } })
    await expect(
      StaffLearnerPage({ params: Promise.resolve({ id: 'u1' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.learnerRecord).not.toHaveBeenCalled()
  })

  it('404s for an unknown learner rather than rendering an empty record', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', role: 'staff' } })
    h.learnerRecord.mockResolvedValue(null)
    await expect(
      StaffLearnerPage({ params: Promise.resolve({ id: 'nope' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('shows the weakest key points and the analysis-status denominator', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', role: 'staff' } })
    render(await StaffLearnerPage({ params: Promise.resolve({ id: 'u1' }) }))
    expect(screen.getByText('EBIT falls by the full depreciation')).toBeInTheDocument()
    // analysisStatus matters: a relational tag table cannot distinguish
    // "analyzed and clean" from "could not analyze" — both are zero rows.
    expect(screen.getByText(/no_klps/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/staff-pages.test.tsx`
Expected: FAIL — cannot resolve the learner page.

- [ ] **Step 3: Add the queries**

Append to `src/lib/staff/queries.ts`:

```ts
export interface LearnerRecord {
  label: string
  weakest: { klpId: string; text: string; pKnown: number; observations: number }[]
  recentAnswers: {
    id: string
    createdAt: Date
    mode: string
    /** 'legacy' stands in for a NULL column — see analysisStatusCounts. */
    analysisStatus: string
    cardTerm: string
    verdicts: { status: string; klpText: string }[]
    tags: { dimension: string; type: string; significance: number }[]
  }[]
  /**
   * WHY THIS IS HERE: a relational tag table cannot distinguish "analyzed and
   * clean" from "could not analyze" — both are zero rows. Error rates need a
   * denominator of ANALYZED answers, or a legacy-heavy corpus silently reads
   * as a better learner.
   *
   * `QuizAnswer.analysisStatus` is NULLABLE, and null means one specific
   * thing: a row written before Spec 2a shipped. It is bucketed as 'legacy'
   * rather than left as a null key — `Object.fromEntries` would stringify it
   * to "null", which reads as a status the vocabulary does not contain.
   */
  analysisStatusCounts: Record<string, number>
}

export async function loadLearnerIndex() {
  const grouped = await prisma.klpState.groupBy({
    by: ['userId'],
    _count: { _all: true },
    _max: { lastObservedAt: true },
  })
  if (grouped.length === 0) return []

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, handle: true, name: true, email: true },
  })
  const labelBy = new Map(users.map((u) => [u.id, u.handle ?? u.name ?? u.email]))

  return grouped
    .map((g) => ({
      userId: g.userId,
      label: labelBy.get(g.userId) ?? g.userId,
      klpStates: g._count._all,
      lastObservedAt: g._max.lastObservedAt,
    }))
    .sort((a, b) => (b.lastObservedAt?.getTime() ?? 0) - (a.lastObservedAt?.getTime() ?? 0))
}

export async function loadLearnerRecord(userId: string): Promise<LearnerRecord | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true, name: true, email: true },
  })
  if (!user) return null

  const [states, answers, statuses] = await Promise.all([
    prisma.klpState.findMany({
      where: { userId },
      select: { klpId: true, pKnown: true, observations: true, klp: { select: { text: true, label: true } } },
      orderBy: { pKnown: 'asc' },
      take: 25,
    }),
    // `QuizAnswer.userId` exists directly and is indexed (@@index([userId,
    // createdAt])). Filtering through `attempt: { userId }` would be a join
    // that skips that index for the exact ordering asked for.
    prisma.quizAnswer.findMany({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        mode: true,
        analysisStatus: true,
        card: { select: { term: true } },
        klpResults: { select: { status: true, klp: { select: { text: true, label: true } } } },
        errorTags: { select: { dimension: true, type: true, significance: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.quizAnswer.groupBy({
      by: ['analysisStatus'],
      where: { userId },
      _count: { _all: true },
    }),
  ])

  return {
    label: user.handle ?? user.name ?? user.email,
    weakest: states.map((s) => ({
      klpId: s.klpId,
      text: s.klp.label ?? s.klp.text,
      pKnown: s.pKnown,
      observations: s.observations,
    })),
    recentAnswers: answers.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      mode: a.mode,
      // Null means "written before Spec 2a", which is a real category and not
      // an absence. Naming it keeps it out of the analysed denominator.
      analysisStatus: a.analysisStatus ?? 'legacy',
      cardTerm: a.card.term,
      verdicts: a.klpResults.map((r) => ({ status: r.status, klpText: r.klp.label ?? r.klp.text })),
      tags: a.errorTags.map((t) => ({
        dimension: t.dimension,
        type: t.type,
        significance: t.significance,
      })),
    })),
    analysisStatusCounts: Object.fromEntries(
      statuses.map((s) => [s.analysisStatus ?? 'legacy', s._count._all]),
    ),
  }
}
```

**Relation names verified against `prisma/schema.prisma`:** `QuizAnswer.klpResults`, `QuizAnswer.errorTags`, `QuizAnswer.mode`, and `QuizAnswer.userId` all exist as written. `analysisStatus` is `String?` — hence the `?? 'legacy'` on both read paths.

- [ ] **Step 4: Add the gated action**

In `src/actions/staff.ts`:

```ts
export async function listStaffLearners(): Promise<
  ActionResult<Awaited<ReturnType<typeof loadLearnerIndex>>>
> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadLearnerIndex() }
}
```

with `loadLearnerIndex` added to the import from `@/lib/staff/queries`.

- [ ] **Step 5: Write both pages**

```tsx
// src/app/(app)/staff/learners/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadLearnerIndex } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'

export default async function StaffLearnersPage() {
  const staff = await requireStaff()
  if (!staff) notFound()

  const learners = await loadLearnerIndex()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Learners</h1>
      <StaffNav isAdmin={isAdmin(staff.role)} />
      {learners.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has answered anything yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {learners.map((l) => (
            <li key={l.userId} className="flex items-center justify-between gap-3 p-3">
              <Link href={`/staff/learners/${l.userId}`} className="font-medium hover:underline">
                {l.label}
              </Link>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {l.klpStates} key points measured
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

```tsx
// src/app/(app)/staff/learners/[id]/page.tsx
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadLearnerRecord } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../../StaffNav'

/**
 * One learner's engine record.
 *
 * An unknown id 404s rather than rendering an empty record — an empty page for
 * a real learner and an empty page for a typo would be indistinguishable.
 */
export default async function StaffLearnerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const staff = await requireStaff()
  if (!staff) notFound()

  const { id } = await params
  const record = await loadLearnerRecord(id)
  if (!record) notFound()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{record.label}</h1>
      <StaffNav isAdmin={isAdmin(staff.role)} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Analysed answers</h2>
        <p className="text-xs text-muted-foreground">
          Error rates need a denominator of <em>analysed</em> answers. Zero tags means
          &ldquo;clean&rdquo; only for the analysed ones.
        </p>
        <ul className="flex flex-wrap gap-3 text-sm">
          {Object.entries(record.analysisStatusCounts).map(([status, n]) => (
            <li key={status} className="rounded border px-2 py-1">
              <span className="font-mono">{status}</span>{' '}
              <span className="font-mono tabular-nums text-muted-foreground">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Weakest key points</h2>
        <ul className="divide-y rounded-lg border">
          {record.weakest.map((w) => (
            <li key={w.klpId} className="flex items-baseline justify-between gap-4 p-3 text-sm">
              <span>{w.text}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {Math.round(w.pKnown * 100)}% · {w.observations} obs
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent answers</h2>
        <ul className="divide-y rounded-lg border">
          {record.recentAnswers.map((a) => (
            <li key={a.id} className="space-y-1 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{a.cardTerm}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {a.mode} · {a.analysisStatus}
                </span>
              </div>
              {a.verdicts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {a.verdicts.map((v) => `${v.status}: ${v.klpText}`).join(' · ')}
                </p>
              )}
              {a.tags.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {a.tags.map((t) => `${t.dimension}/${t.type} (${t.significance})`).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/app/staff-pages.test.tsx tests/staff && npx tsc --noEmit`
Expected: PASS. The Task 7 gating test's generic loop now also covers `listStaffLearners`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/staff/learners" src/lib/staff/queries.ts src/actions/staff.ts tests/app/staff-pages.test.tsx
git commit -m "feat(staff): add the per-learner engine record"
```

---

### Task 12: `/staff/roles` — the grant dashboard

**Files:**
- Create: `src/app/(app)/staff/roles/page.tsx`
- Create: `src/actions/staff-roles.ts`
- Create: `src/components/staff/RoleControls.tsx`
- Test: `tests/staff/role-actions.test.ts`; append to `tests/app/staff-pages.test.tsx`
- Modify: `tests/actions/klt-gated-exports-guard.test.ts` (`FILES` gains `staff-roles.ts`)

**Interfaces:**
- Consumes: `requireAdmin` (Task 4), `isKnownRole`, `DEFAULT_ROLE` (Task 1), `RoleGrant` (Task 2).
- Produces: `grantRole(input: { userId: string; role: string }): Promise<ActionResult<null>>`, `revokeRole(input: { userId: string }): Promise<ActionResult<null>>`, `searchUsers(input: { q: string }): Promise<ActionResult<{ id, label, role }[]>>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/staff/role-actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userUpdate: vi.fn(),
  grantCreate: vi.fn(),
  grantUpdateMany: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { update: h.userUpdate, findMany: vi.fn().mockResolvedValue([]) },
    roleGrant: { create: h.grantCreate, updateMany: h.grantUpdateMany },
    $transaction: h.transaction,
  },
}))

import { grantRole, revokeRole } from '@/actions/staff-roles'

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockResolvedValue([])
})

describe('grantRole', () => {
  it('refuses a learner, a staff member, and a signed-out caller', async () => {
    for (const session of [
      { user: { id: 'u1', role: 'learner' } },
      // STAFF IS NOT ADMIN: reading the engine is not granting access to it.
      { user: { id: 'u1', role: 'staff' } },
      null,
    ]) {
      h.auth.mockResolvedValue(session)
      expect(await grantRole({ userId: 'u2', role: 'admin' })).toEqual({
        success: false,
        error: 'Not found',
      })
      expect(h.transaction).not.toHaveBeenCalled()
    }
  })

  it('refuses a role outside the vocabulary', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    const res = await grantRole({ userId: 'u2', role: 'superuser' })
    expect(res.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('writes the grant and stamps the actor', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await grantRole({ userId: 'u2', role: 'staff' })
    expect(res.success).toBe(true)
    expect(h.grantCreate).toHaveBeenCalledWith({
      data: { userId: 'u2', role: 'staff', grantedById: 'admin-1' },
    })
  })
})

describe('revokeRole', () => {
  /**
   * THE GUARD THAT CANNOT FAIL VISIBLY. The last admin revoking themselves
   * locks the install out of /staff/roles permanently, recoverable only by
   * CLI. Assert the refusal, not just the success path.
   */
  it('refuses an admin revoking their own role', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await revokeRole({ userId: 'admin-1' })
    expect(res).toEqual({
      success: false,
      error: 'You cannot revoke your own role. Use npm run grant-role.',
    })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('revokes someone else', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await revokeRole({ userId: 'u2' })
    expect(res.success).toBe(true)
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('refuses a staff caller', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    expect(await revokeRole({ userId: 'u2' })).toEqual({ success: false, error: 'Not found' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/staff/role-actions.test.ts`
Expected: FAIL — cannot resolve `@/actions/staff-roles`.

- [ ] **Step 3: Write the actions**

```ts
// src/actions/staff-roles.ts
'use server'

/**
 * Granting and revoking roles.
 *
 * A SEPARATE module from src/actions/staff.ts because these are WRITES on the
 * admin gate, and the read module is on the staff gate. Mixing them would mean
 * one file where some exports need requireAdmin and others requireStaff, which
 * is exactly the shape a reviewer misreads.
 *
 * Every export gates in its own body — each is an RPC endpoint.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/staff/access'
import { isKnownRole, DEFAULT_ROLE, USER_ROLES } from '@/lib/auth/roles'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }

export async function grantRole(input: {
  userId: string
  role: string
}): Promise<ActionResult<null>> {
  const admin = await requireAdmin()
  if (!admin) return NOT_FOUND

  if (!isKnownRole(input.role)) {
    return { success: false, error: `Role must be one of: ${USER_ROLES.join(', ')}` }
  }

  await prisma.$transaction([
    // Close any open grant first, so the history reads as a sequence of states.
    prisma.roleGrant.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({ where: { id: input.userId }, data: { role: input.role } }),
    prisma.roleGrant.create({
      data: { userId: input.userId, role: input.role, grantedById: admin.userId },
    }),
  ])

  revalidatePath('/staff/roles')
  return { success: true, data: null }
}

export async function revokeRole(input: { userId: string }): Promise<ActionResult<null>> {
  const admin = await requireAdmin()
  if (!admin) return NOT_FOUND

  // The last admin revoking themselves locks the install out of this page
  // permanently. Refuse it here rather than trusting a disabled button.
  if (input.userId === admin.userId) {
    return { success: false, error: 'You cannot revoke your own role. Use npm run grant-role.' }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: input.userId }, data: { role: DEFAULT_ROLE } }),
    prisma.roleGrant.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  revalidatePath('/staff/roles')
  return { success: true, data: null }
}

export async function searchUsers(input: {
  q: string
}): Promise<ActionResult<{ id: string; label: string; role: string }[]>> {
  if (!(await requireAdmin())) return NOT_FOUND

  const q = input.q.trim()
  if (q.length < 2) return { success: true, data: [] }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { handle: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, handle: true, name: true, email: true, role: true },
    take: 10,
  })

  return {
    success: true,
    data: users.map((u) => ({ id: u.id, label: u.handle ?? u.name ?? u.email, role: u.role })),
  }
}
```

- [ ] **Step 4: Write the controls and the page**

```tsx
// src/components/staff/RoleControls.tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { grantRole, revokeRole, searchUsers } from '@/actions/staff-roles'
import { USER_ROLES } from '@/lib/auth/roles'

export function RoleControls({ selfId }: { selfId: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; label: string; role: string }[]>([])
  const [pending, start] = useTransition()

  function find() {
    start(async () => {
      const res = await searchUsers({ q })
      if (!res.success) return toast.error(res.error)
      setResults(res.data)
      if (res.data.length === 0) toast.message('No match.')
    })
  }

  function assign(userId: string, role: string) {
    start(async () => {
      const res = await grantRole({ userId, role })
      toast[res.success ? 'success' : 'error'](res.success ? `Now a ${role}.` : res.error)
    })
  }

  function drop(userId: string) {
    start(async () => {
      const res = await revokeRole({ userId })
      toast[res.success ? 'success' : 'error'](res.success ? 'Revoked.' : res.error)
    })
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find by handle, name or email"
          className="flex-1 rounded-md border px-2 py-1.5 text-sm"
        />
        <button onClick={find} disabled={pending} className="rounded-md border px-3 py-1.5 text-sm">
          Search
        </button>
      </div>

      <ul className="divide-y">
        {results.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {u.label} <span className="font-mono text-xs text-muted-foreground">{u.role}</span>
            </span>
            <span className="flex gap-1">
              {USER_ROLES.filter((r) => r !== u.role).map((r) => (
                <button
                  key={r}
                  onClick={() => (r === 'learner' ? drop(u.id) : assign(u.id, r))}
                  disabled={pending || (u.id === selfId)}
                  title={u.id === selfId ? 'You cannot change your own role here' : undefined}
                  className="rounded border px-2 py-1 text-xs disabled:opacity-40"
                >
                  {r === 'learner' ? 'revoke' : r}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

```tsx
// src/app/(app)/staff/roles/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/staff/access'
import { DEFAULT_ROLE } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'
import { RoleControls } from '@/components/staff/RoleControls'

/**
 * Who can read other people's work, and who gave them that.
 *
 * ADMIN ONLY — requireAdmin, not requireStaff. Reading the engine is not
 * granting access to it. Every mutation re-checks in its own action body; this
 * gate protects the page, not the writes.
 */
export default async function StaffRolesPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()

  const holders = await prisma.user.findMany({
    where: { role: { not: DEFAULT_ROLE } },
    select: {
      id: true,
      handle: true,
      name: true,
      email: true,
      role: true,
      roleGrants: {
        where: { revokedAt: null },
        select: { createdAt: true, grantedBy: { select: { handle: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { role: 'asc' },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Staff can read any learner&rsquo;s answers and diagnoses. Admins can also grant that.
        </p>
      </div>

      <StaffNav isAdmin />

      <ul className="divide-y rounded-lg border">
        {holders.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">Nobody holds a role above learner.</li>
        )}
        {holders.map((u) => {
          const grant = u.roleGrants[0]
          return (
            <li key={u.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span>
                {u.handle ?? u.name ?? u.email}
                {u.id === admin.userId && (
                  <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{u.role}</span>
                {grant && (
                  <>
                    {' · '}
                    {grant.createdAt.toISOString().slice(0, 10)}
                    {' · by '}
                    {grant.grantedBy?.handle ?? grant.grantedBy?.email ?? 'CLI'}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <RoleControls selfId={admin.userId} />
    </div>
  )
}
```

- [ ] **Step 5: Add the page gate test and extend the exports guard**

Append to `tests/app/staff-pages.test.tsx`:

```tsx
import StaffRolesPage from '@/app/(app)/staff/roles/page'

describe('/staff/roles', () => {
  it('404s for STAFF — reading the engine is not granting access to it', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    await expect(StaffRolesPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404s for a learner and a signed-out visitor', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(StaffRolesPage()).rejects.toThrow('NEXT_NOT_FOUND')
    h.auth.mockResolvedValue(null)
    await expect(StaffRolesPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
```

This needs `prisma.user.findMany` on the `@/lib/db` mock in that file — add it.

In `tests/actions/klt-gated-exports-guard.test.ts`:

```ts
const FILES = ['klt-seed.ts', 'klt-tree.ts', 'klt-presets.ts', 'klt.ts', 'staff.ts', 'staff-roles.ts']
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/staff tests/app/staff-pages.test.tsx tests/actions/klt-gated-exports-guard.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/staff/roles" src/actions/staff-roles.ts src/components/staff/RoleControls.tsx tests/staff/role-actions.test.ts tests/app/staff-pages.test.tsx tests/actions/klt-gated-exports-guard.test.ts
git commit -m "feat(staff): add the /staff/roles grant dashboard"
```

---

### Task 13: Rail entry for staff

**Files:**
- Modify: `src/lib/shell/nav.ts`, `src/components/shell/RailNav.tsx`
- Modify: whichever component renders `<RailNav>` (find with `grep -rn "<RailNav" src`)
- Test: `tests/shell/nav.test.ts` (extend the existing file if present; create if not)

**Interfaces:**
- Consumes: `isStaff` (Task 1).
- Produces: `railItems(signedIn: boolean, role?: string | null): RailItem[]`; `RailIcon` gains `'gauge'`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/shell/nav.test.ts
import { railItems } from '@/lib/shell/nav'

describe('railItems and the staff entry', () => {
  it('hides Staff from a learner and from a signed-out visitor', () => {
    expect(railItems(true, 'learner').map((i) => i.href)).not.toContain('/staff')
    expect(railItems(false, 'admin').map((i) => i.href)).not.toContain('/staff')
  })

  it('shows Staff to staff and admin', () => {
    expect(railItems(true, 'staff').map((i) => i.href)).toContain('/staff')
    expect(railItems(true, 'admin').map((i) => i.href)).toContain('/staff')
  })

  it('defaults to hidden when no role is passed', () => {
    expect(railItems(true).map((i) => i.href)).not.toContain('/staff')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/nav.test.ts`
Expected: FAIL — `railItems` takes one argument; `/staff` never present.

- [ ] **Step 3: Implement**

In `src/lib/shell/nav.ts`:

```ts
import { isStaff } from '@/lib/auth/roles'

export type RailIcon = 'home' | 'compass' | 'library' | 'plus' | 'login' | 'gauge'

export function railItems(signedIn: boolean, role?: string | null): RailItem[] {
  if (!signedIn) {
    return [
      { href: '/', label: 'Home', icon: 'home' },
      { href: '/browse', label: 'Browse', icon: 'compass' },
      { href: '/login', label: 'Sign in', icon: 'login' },
    ]
  }
  const items: RailItem[] = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/browse', label: 'Browse', icon: 'compass' },
    { href: '/sets', label: 'Library', icon: 'library' },
    { href: '/sets/new', label: 'New set', icon: 'plus' },
  ]
  // A signed-out visitor never sees it regardless of role — there is no role
  // without a session, and the early return above already guarantees that.
  if (isStaff(role)) items.push({ href: '/staff', label: 'Staff', icon: 'gauge' })
  return items
}
```

In `src/components/shell/RailNav.tsx`: add `Gauge` to the lucide import and `gauge: Gauge` to `ICONS`, add a `role?: string | null` prop, and pass it: `const items = railItems(signedIn, role)`.

Then thread `role` from the shell's session down to `<RailNav>` in whichever component renders it, and in `MobileRail.tsx` if it calls `railItems` too.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/shell && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shell/nav.ts src/components/shell tests/shell/nav.test.ts
git commit -m "feat(staff): surface the staff rail entry for staff and admins"
```

---

### Task 14: Thread `parentKey` through the topic pipeline

**Files:**
- Modify: `src/lib/metrics/klt-rollup.ts` (`RawKltRow`, `rollUpKltLinks`, `kltRowsToTopicRows`)
- Modify: `src/lib/memory/topic-profile.ts` (`TopicRow`, `LearnerTopicProfile`, `shapeTopicProfile`, and the category `toTopicRows`)
- Test: `tests/metrics/klt-rollup.test.ts` (extend), `tests/memory/topic-profile.test.ts` (extend)

**Interfaces:**
- Consumes: `KltNodeRow.ancestorIds` (root-first, excluding self — so the LAST element is the direct parent).
- Produces: `RawKltRow.parentName: string | null`, `TopicRow.parentKey?: string | null`, `LearnerTopicProfile.parentKey: string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/metrics/klt-rollup.test.ts
import { rollUpKltLinks, kltRowsToTopicRows } from '@/lib/metrics/klt-rollup'

const link = (id: string) => ({
  rank: 1,
  klp: { id, supersededAt: null as Date | null, cardId: 'c1' },
})

describe('parentKey', () => {
  it('reads the DIRECT parent off the last ancestor id, translated to a normalized name', () => {
    const rows = rollUpKltLinks([
      { kltId: 'a', normalizedName: 'accounting', name: 'Accounting', depth: 0, ancestorIds: [], links: [] },
      { kltId: 'b', normalizedName: 'income statement', name: 'Income statement', depth: 1, ancestorIds: ['a'], links: [link('k1')] },
      { kltId: 'c', normalizedName: 'depreciation', name: 'Depreciation', depth: 2, ancestorIds: ['a', 'b'], links: [link('k2')] },
    ])

    expect(rows.find((r) => r.normalizedName === 'accounting')!.parentName).toBeNull()
    expect(rows.find((r) => r.normalizedName === 'income statement')!.parentName).toBe('accounting')
    // The LAST ancestor, not the first — ancestorIds is root-first.
    expect(rows.find((r) => r.normalizedName === 'depreciation')!.parentName).toBe('income statement')
  })

  it('is null when the parent id is not among the rows', () => {
    const rows = rollUpKltLinks([
      { kltId: 'b', normalizedName: 'orphan', name: 'Orphan', depth: 1, ancestorIds: ['gone'], links: [link('k1')] },
    ])
    expect(rows[0].parentName).toBeNull()
  })

  it('survives kltRowsToTopicRows', () => {
    const topicRows = kltRowsToTopicRows(
      [{ normalizedName: 'depreciation', name: 'Depreciation', depth: 2, parentName: 'income statement', links: [link('k2')] }],
      2,
    )
    expect(topicRows[0].parentKey).toBe('income statement')
  })
})
```

```ts
// append to tests/memory/topic-profile.test.ts
describe('parentKey on the profile', () => {
  it('carries through, first non-undefined wins, mirroring depth', () => {
    const out = shapeTopicProfile({
      topics: [
        { normalizedName: 'a', displayName: 'A', color: null, depth: 0, parentKey: null, klpIds: ['k1'], supersededKlpIds: [], cardIds: ['c1'] },
        { normalizedName: 'b', displayName: 'B', color: null, depth: 1, parentKey: 'a', klpIds: ['k2'], supersededKlpIds: [], cardIds: ['c1'] },
      ],
      knowledge: {},
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(out.find((t) => t.key === 'b')!.parentKey).toBe('a')
    expect(out.find((t) => t.key === 'a')!.parentKey).toBeNull()
  })

  it('is null for a user-authored category, which has no tree position', () => {
    const out = shapeTopicProfile({
      topics: [
        { normalizedName: 'vocab', displayName: 'Vocab', color: '#fff', klpIds: ['k1'], supersededKlpIds: [], cardIds: ['c1'] },
      ],
      knowledge: {},
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(out[0].parentKey).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/metrics/klt-rollup.test.ts tests/memory/topic-profile.test.ts`
Expected: FAIL — `parentName`/`parentKey` undefined.

- [ ] **Step 3: Implement in `klt-rollup.ts`**

Add to `RawKltRow`:

```ts
  /**
   * The DIRECT parent's normalizedName within this set, or null at a root.
   *
   * `ancestorIds` is root-first and excludes self, so the parent is its LAST
   * element — not its first, which is the subject root. Null when the parent id
   * is not among the rows handed in, which happens legitimately: a node whose
   * links are all superseded is dropped by kltRowsToTopicRows.
   */
  parentName: string | null
```

In `rollUpKltLinks`, before the final `map`:

```ts
  const nameByKltId = new Map(rows.map((r) => [r.kltId, r.normalizedName]))
```

and in the returned object:

```ts
    parentName:
      row.ancestorIds.length === 0
        ? null
        : (nameByKltId.get(row.ancestorIds[row.ancestorIds.length - 1]) ?? null),
```

In `kltRowsToTopicRows`, add `parentKey: row.parentName,` to the pushed object.

- [ ] **Step 4: Implement in `topic-profile.ts`**

Add to `TopicRow`:

```ts
  /**
   * The parent topic's normalizedName, or null at a root. OPTIONAL for the same
   * reason `depth` is: a user-authored category has no tree position, so it has
   * no parent either.
   */
  parentKey?: string | null
```

Add to `LearnerTopicProfile`:

```ts
  /** Parent topic key, or null for a root and for every category. */
  parentKey: string | null
```

In `shapeTopicProfile`'s `out.push`, directly after `depth`:

```ts
      // First non-undefined wins, mirroring `depth` immediately above. Two sets
      // may file the same concept under different parents; selectConceptRows
      // reparents anything inconsistent rather than trusting this.
      parentKey: rows.find((r) => r.parentKey !== undefined)?.parentKey ?? null,
```

Find the category-side `toTopicRows` in the same file and leave it alone — omitting `parentKey` makes it `undefined`, which the line above turns into `null`. That is the intended behaviour and the second test asserts it.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/metrics tests/memory && npx tsc --noEmit`
Expected: PASS. `tsc` will flag any other constructor of `RawKltRow` missing `parentName` — fix each by passing `null` where no tree position exists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics/klt-rollup.ts src/lib/memory/topic-profile.ts tests/metrics tests/memory
git commit -m "feat(metrics): carry the direct parent through the topic pipeline"
```

---

### Task 15: `selectConceptRows` returns a parented tree

**Files:**
- Modify: `src/lib/sets/knowledge.ts`
- Modify: `tests/sets/knowledge.test.ts`

**Interfaces:**
- Consumes: `LearnerTopicProfile.parentKey` (Task 14).
- Produces: `TopicMasteryRow` gains `parentKey: string | null` and `hasChildren: boolean`. `selectConceptListDepth`, `PREFERRED_LIST_DEPTH`, `MAX_CONCEPTS_LISTED` are **deleted**.

- [ ] **Step 1: Write the failing test**

Replace the `describe('selectConceptListDepth')` block in `tests/sets/knowledge.test.ts` with:

```ts
import { selectConceptRows } from '@/lib/sets/knowledge'
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

function topic(key: string, parentKey: string | null, depth: number | null): LearnerTopicProfile {
  return {
    key,
    name: key,
    color: null,
    depth,
    parentKey,
    klpCount: 2,
    measuredKlpCount: 2,
    knowledge: 0.5,
    verbosityIndex: null,
    knowledgeGapTerseness: null,
    readiness: null,
  }
}

describe('selectConceptRows', () => {
  /**
   * THE REPORTED BUG. Both the depth-1 and depth-2 rungs exceeded the old
   * MAX_CONCEPTS_LISTED of 5, so selectConceptListDepth fell back to the
   * shallowest rung and the list showed exactly two roots. Every node must now
   * be present.
   */
  it('returns every concept at every depth, not one rung', () => {
    const topics = [
      topic('dcf', null, 0),
      topic('accounting', null, 0),
      ...Array.from({ length: 6 }, (_, i) => topic(`mid${i}`, 'dcf', 1)),
      ...Array.from({ length: 9 }, (_, i) => topic(`leaf${i}`, 'mid0', 2)),
    ]
    const rows = selectConceptRows(topics)
    expect(rows).toHaveLength(17)
    expect(rows.map((r) => r.key)).toContain('leaf8')
  })

  it('marks interior nodes as having children and leaves as not', () => {
    const rows = selectConceptRows([topic('a', null, 0), topic('b', 'a', 1)])
    expect(rows.find((r) => r.key === 'a')!.hasChildren).toBe(true)
    expect(rows.find((r) => r.key === 'b')!.hasChildren).toBe(false)
  })

  /**
   * kltRowsToTopicRows DROPS a topic whose links are all superseded, so a
   * parent genuinely can be absent. An orphan must render as a root — never
   * vanish, which is the bug this whole task exists to fix, recreated one level
   * down.
   */
  it('reparents an orphan to the root instead of dropping it', () => {
    const rows = selectConceptRows([topic('child', 'gone', 2)])
    expect(rows).toHaveLength(1)
    expect(rows[0].parentKey).toBeNull()
  })

  /**
   * Two sets may file the same concept under different parents, and
   * shapeTopicProfile merges them by name — so a cycle is reachable. A cycle
   * would hang the renderer.
   */
  it('breaks a parent cycle by rooting the offending node', () => {
    const rows = selectConceptRows([topic('a', 'b', 1), topic('b', 'a', 1)])
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.parentKey === null).length).toBeGreaterThanOrEqual(1)
  })

  it('treats a category (null depth, null parent) as a root', () => {
    const rows = selectConceptRows([topic('vocab', null, null)])
    expect(rows[0].parentKey).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sets/knowledge.test.ts`
Expected: FAIL — `hasChildren` and `parentKey` do not exist; the first test returns 2 rows, not 17.

- [ ] **Step 3: Implement**

Delete `PREFERRED_LIST_DEPTH`, `MAX_CONCEPTS_LISTED` and `selectConceptListDepth` entirely, with their doc comment. Add to `TopicMasteryRow`:

```ts
  /** Parent row key, or null for a root. Rows form a forest, not one rung. */
  parentKey: string | null
  /** Whether any other row names this one as its parent. */
  hasChildren: boolean
```

In `shapeTopicMastery`, add `parentKey: t.parentKey,` to the mapped object and `hasChildren: false` (Step 4 fills it in). Then replace `selectConceptRows`:

```ts
/**
 * Every concept, parented — the whole forest, not one rung.
 *
 * THIS USED TO PICK A DEPTH. `selectConceptListDepth` walked upward from a
 * preferred rung until one fit under a cap of five, falling back to the
 * shallowest populated rung; on a tree whose depth-1 and depth-2 rungs both
 * exceeded five that fallback was depth 0, and the list showed two roots and
 * nothing else. The premise was the bug: a list only has to pick a level when
 * it renders a flat array. `MasteryList` renders a disclosure tree now, so
 * every node is present and the reader chooses the depth.
 *
 * TWO INVARIANTS, both load-bearing, both tested:
 *  - An ORPHAN becomes a root. `kltRowsToTopicRows` drops a topic whose links
 *    are all superseded, so a named parent genuinely may not be here. Dropping
 *    the child too would hide a concept the learner is being tested on.
 *  - A CYCLE is broken by rooting. Two sets may file one concept under
 *    different parents and `shapeTopicProfile` merges them by name, so a cycle
 *    is reachable — and would hang the renderer.
 */
export function selectConceptRows(topics: LearnerTopicProfile[]): TopicMasteryRow[] {
  const rows = shapeTopicMastery(topics)
  const byKey = new Map(rows.map((r) => [r.key, r]))

  const resolvedParent = new Map<string, string | null>()
  for (const row of rows) {
    let parent = row.parentKey
    if (parent === null || !byKey.has(parent)) {
      resolvedParent.set(row.key, null)
      continue
    }
    // Walk to a root. Revisiting this row means a cycle; root it.
    const seen = new Set<string>([row.key])
    let cursor: string | null = parent
    let cyclic = false
    while (cursor !== null) {
      if (seen.has(cursor)) {
        cyclic = true
        break
      }
      seen.add(cursor)
      const next: string | null = byKey.get(cursor)?.parentKey ?? null
      cursor = next !== null && byKey.has(next) ? next : null
    }
    resolvedParent.set(row.key, cyclic ? null : parent)
  }

  const childCount = new Map<string, number>()
  for (const [, parent] of resolvedParent) {
    if (parent !== null) childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
  }

  return rows.map((r) => ({
    ...r,
    parentKey: resolvedParent.get(r.key) ?? null,
    hasChildren: (childCount.get(r.key) ?? 0) > 0,
  }))
}
```

- [ ] **Step 4: Update the doc comment at line ~236**

The comment describing `topics` as "the one rung `selectConceptListDepth` picked" is now false. Replace with: "Every concept, parented. What the list renders as a disclosure tree."

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/sets && npx tsc --noEmit`
Expected: PASS, 5 new tests. `tsc` flags `MasteryList` (fixed in Task 16).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sets/knowledge.ts tests/sets/knowledge.test.ts
git commit -m "fix(knowledge): return every concept parented instead of one rung"
```

---

### Task 16: `MasteryList` becomes a disclosure tree

**Files:**
- Modify: `src/components/sets/knowledge/MasteryList.tsx`
- Test: `tests/sets/mastery-list.test.tsx`

**Interfaces:**
- Consumes: `TopicMasteryRow` with `parentKey`/`hasChildren` (Task 15).
- Produces: `MasteryList` is now a **client** component (it holds expansion state).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/sets/mastery-list.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MasteryList } from '@/components/sets/knowledge/MasteryList'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'

afterEach(cleanup)

function row(key: string, parentKey: string | null, hasChildren: boolean): TopicMasteryRow {
  return {
    key,
    name: key,
    depth: parentKey === null ? 0 : 1,
    parentKey,
    hasChildren,
    knowledge: 0.5,
    klpCount: 2,
    measuredKlpCount: 2,
    shade: 'shaky',
  }
}

describe('MasteryList', () => {
  it('shows roots expanded and hides deeper rungs until asked', () => {
    render(<MasteryList setId="s1" rows={[row('dcf', null, true), row('wacc', 'dcf', false)]} />)
    expect(screen.getByText('dcf')).toBeInTheDocument()
    expect(screen.queryByText('wacc')).not.toBeInTheDocument()
  })

  it('reveals children on expand — the dropdown the roots never had', () => {
    render(<MasteryList setId="s1" rows={[row('dcf', null, true), row('wacc', 'dcf', false)]} />)
    fireEvent.click(screen.getByRole('button', { name: /expand dcf/i }))
    expect(screen.getByText('wacc')).toBeInTheDocument()
  })

  it('gives a leaf no expander for children but still one for key points', () => {
    render(<MasteryList setId="s1" rows={[row('solo', null, false)]} />)
    expect(screen.queryByRole('button', { name: /expand solo/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /key points for solo/i })).toBeInTheDocument()
  })

  it('renders the empty state unchanged', () => {
    render(<MasteryList setId="s1" rows={[]} />)
    expect(screen.getByText(/no concept structure/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sets/mastery-list.test.tsx`
Expected: FAIL — `MasteryList` takes no `setId` and renders every row flat.

- [ ] **Step 3: Implement**

Convert the component to `'use client'`, take `setId`, hold an expanded set, and render depth-first. Keep the existing `<td>` bodies for mastery and key-point counts **verbatim** — including both explanatory comments — and change only the concept cell and the row set:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHADE_LABEL } from '@/lib/klt/mastery-shade'
import { MasteryBar } from '@/components/ui/mastery-bar'
import { ConceptKlps } from '@/components/sets/knowledge/ConceptKlps'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'

export function MasteryList({ setId, rows }: { setId: string; rows: TopicMasteryRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [klpsOpen, setKlpsOpen] = useState<Set<string>>(new Set())

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, TopicMasteryRow[]>()
    for (const r of rows) {
      const list = map.get(r.parentKey)
      if (list) list.push(r)
      else map.set(r.parentKey, [r])
    }
    return map
  }, [rows])

  // Depth-first, roots first, honouring the order shapeTopicMastery produced
  // (weakest measured first) within each level.
  const visible = useMemo(() => {
    const out: { row: TopicMasteryRow; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const row of childrenOf.get(parent) ?? []) {
        out.push({ row, depth })
        if (expanded.has(row.key)) walk(row.key, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [childrenOf, expanded])

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8">
        No concept structure on this set yet. Build one, and the concepts your cards teach
        appear here with what you know about each.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="label pb-2 font-normal text-muted-foreground">Concept</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground w-1/2">Mastery</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground text-right">Key points</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ row, depth }) => (
            <React.Fragment key={row.key}>
              <tr className="border-b last:border-0">
                <td className="py-2.5 pr-4 align-middle">
                  {/* The indent is REAL now. Rows are a forest, not one rung,
                      so depth is a claim the list can honestly make. */}
                  <span className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                    {row.hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggle(expanded, row.key, setExpanded)}
                        aria-label={`${expanded.has(row.key) ? 'Collapse' : 'Expand'} ${row.name}`}
                        aria-expanded={expanded.has(row.key)}
                        className="rounded p-0.5 hover:bg-muted"
                      >
                        {expanded.has(row.key) ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-[1.375rem]" />
                    )}
                    {row.name}
                    <button
                      type="button"
                      onClick={() => toggle(klpsOpen, row.key, setKlpsOpen)}
                      aria-label={`Key points for ${row.name}`}
                      aria-expanded={klpsOpen.has(row.key)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Sparkles className="h-3 w-3" />
                    </button>
                  </span>
                </td>
                <td className="py-2.5 pr-4 align-middle">
                  <div className="flex items-center gap-3">
                    <MasteryBar knowledge={row.knowledge} shade={row.shade} className="max-w-[12rem]" />
                    {/*
                      The words, not the colour alone. A shade carried only by a
                      fill is unreadable to anyone who cannot distinguish the hues
                      — and for `unknown` the distinction that matters (no
                      evidence vs. bad evidence) is not expressible in a colour at
                      all.
                    */}
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        row.shade === 'unknown' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {SHADE_LABEL[row.shade]}
                      {row.knowledge !== null && (
                        <span className="font-mono text-muted-foreground">
                          {' '}
                          {Math.round(row.knowledge * 100)}%
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                  {/*
                    MEASURED OF TOTAL, not the total alone. A concept can report
                    90% off three of its forty key points; the bar is deliberately
                    withheld in that case (see `MIN_MEASURED_FRACTION`) and this
                    column is where a learner sees WHY, instead of a colour that
                    vanished for no visible reason.
                  */}
                  {row.klpCount ? `${row.measuredKlpCount}/${row.klpCount}` : '—'}
                </td>
              </tr>
              {klpsOpen.has(row.key) && (
                <tr className="border-b last:border-0">
                  <td colSpan={3} className="bg-muted/30 px-4 py-2" style={{ paddingLeft: depth * 16 + 32 }}>
                    <ConceptKlps setId={setId} topicKey={row.key} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Add `import React from 'react'` at the top for `React.Fragment`.

`ConceptKlps` is created in Task 17. To keep this task independently testable, create a stub first:

```tsx
// src/components/sets/knowledge/ConceptKlps.tsx
'use client'
export function ConceptKlps({ setId, topicKey }: { setId: string; topicKey: string }) {
  return <p className="text-xs text-muted-foreground">Loading key points for {topicKey}…</p>
}
```

- [ ] **Step 4: Update the caller**

In `src/components/sets/knowledge/ConceptMastery.tsx`, pass `setId`: `<MasteryList setId={setId} rows={rows} />`. Update its doc comment — the list no longer "shows one rung of the tree (`selectConceptListDepth`)"; it shows the whole forest as a disclosure tree.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/sets && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sets/knowledge tests/sets/mastery-list.test.tsx
git commit -m "feat(knowledge): render concepts as an expandable tree, not one rung"
```

---

### Task 17: Expand a concept to its key points

**Files:**
- Rewrite: `src/components/sets/knowledge/ConceptKlps.tsx`
- Modify: `src/actions/klt-tree.ts` (add `listTopicKlps`, gated by `requireSetKltView`)
- Modify: `tests/actions/klt-gated-exports-guard.test.ts` (`READ_GATE_ALLOWLIST`)
- Test: `tests/sets/concept-klps.test.tsx`

**Interfaces:**
- Consumes: `requireSetKltView` (existing).
- Produces: `listTopicKlps(setId: string, topicKey: string): Promise<ActionResult<{ id: string; text: string; pKnown: number | null; observations: number }[]>>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/sets/concept-klps.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/actions/klt-tree', () => ({ listTopicKlps: h.list }))

import { ConceptKlps } from '@/components/sets/knowledge/ConceptKlps'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ConceptKlps', () => {
  it('lists the key points filed under the concept', async () => {
    h.list.mockResolvedValue({
      success: true,
      data: [{ id: 'k1', text: 'EBIT falls by the full depreciation', pKnown: 0.4, observations: 3 }],
    })
    render(<ConceptKlps setId="s1" topicKey="depreciation" />)
    await waitFor(() =>
      expect(screen.getByText('EBIT falls by the full depreciation')).toBeInTheDocument(),
    )
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('shows an em dash, never 0%, for a key point with no evidence', async () => {
    h.list.mockResolvedValue({
      success: true,
      data: [{ id: 'k1', text: 'Unasked point', pKnown: null, observations: 0 }],
    })
    render(<ConceptKlps setId="s1" topicKey="x" />)
    await waitFor(() => expect(screen.getByText('Unasked point')).toBeInTheDocument())
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('reports a failure instead of rendering an empty list', async () => {
    h.list.mockResolvedValue({ success: false, error: 'Not found' })
    render(<ConceptKlps setId="s1" topicKey="x" />)
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument())
  })

  it('says so plainly when a concept has no key points yet', async () => {
    h.list.mockResolvedValue({ success: true, data: [] })
    render(<ConceptKlps setId="s1" topicKey="x" />)
    await waitFor(() => expect(screen.getByText(/no key points/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sets/concept-klps.test.tsx`
Expected: FAIL — the stub renders "Loading key points…" and never calls the action.

- [ ] **Step 3: Add the gated action**

In `src/actions/klt-tree.ts`:

```ts
/**
 * The live key points filed under one concept in one set, with this viewer's
 * own posterior on each.
 *
 * On `requireSetKltView`, the READ gate — a link-shared set's key points are
 * readable by anyone who can already read its cards, which is the same argument
 * `listConceptCards` makes. Never `requireSetKltAccess`: reading is not editing.
 */
export async function listTopicKlps(
  setId: string,
  topicKey: string,
): Promise<ActionResult<{ id: string; text: string; pKnown: number | null; observations: number }[]>> {
  const view = await requireSetKltView(setId)
  if (!view) return { success: false, error: 'Not found' }

  const links = await prisma.klpTopic.findMany({
    where: {
      klt: { normalizedName: topicKey },
      klp: { supersededAt: null, card: { setId: view.setId } },
    },
    select: { klp: { select: { id: true, text: true, label: true } } },
    orderBy: { rank: 'asc' },
    take: 50,
  })
  if (links.length === 0) return { success: true, data: [] }

  const states = view.viewerId
    ? await prisma.klpState.findMany({
        where: { userId: view.viewerId, klpId: { in: links.map((l) => l.klp.id) } },
        select: { klpId: true, pKnown: true, observations: true },
      })
    : []
  const stateBy = new Map(states.map((s) => [s.klpId, s]))

  return {
    success: true,
    data: links.map((l) => {
      const state = stateBy.get(l.klp.id)
      return {
        id: l.klp.id,
        text: l.klp.label ?? l.klp.text,
        // Null is NO EVIDENCE, not zero knowledge.
        pKnown: state?.pKnown ?? null,
        observations: state?.observations ?? 0,
      }
    }),
  }
}
```

Add `listTopicKlps` to `READ_GATE_ALLOWLIST['klt-tree.ts']` in `tests/actions/klt-gated-exports-guard.test.ts`, with a one-line justification comment matching the style of the two already there.

- [ ] **Step 4: Write the component**

```tsx
// src/components/sets/knowledge/ConceptKlps.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { listTopicKlps } from '@/actions/klt-tree'

interface Klp {
  id: string
  text: string
  pKnown: number | null
  observations: number
}

/**
 * The key points behind one concept's mastery number.
 *
 * Fetched on expand rather than with the list, following `ConceptCards`: a set
 * can have hundreds of key points, and loading every concept's to render a
 * collapsed row would make opening the tab pay for a question nobody asked.
 */
export function ConceptKlps({ setId, topicKey }: { setId: string; topicKey: string }) {
  const [klps, setKlps] = useState<Klp[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `.then`, not async/await — `react-hooks/set-state-in-effect` flags a
  // setState reachable from an async function called directly in an effect.
  const load = useCallback(() => {
    return listTopicKlps(setId, topicKey).then((res) => {
      if (!res.success) {
        setError(res.error || 'Failed to load key points')
        return
      }
      setKlps(res.data)
    })
  }, [setId, topicKey])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (klps === null) return <p className="text-xs text-muted-foreground">Loading key points…</p>
  if (klps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No key points here yet. They appear once this set&rsquo;s cards have been extracted.
      </p>
    )
  }

  return (
    <ul className="space-y-1">
      {klps.map((k) => (
        <li key={k.id} className="flex items-baseline justify-between gap-4 text-xs">
          <span>{k.text}</span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {k.pKnown === null ? '—' : `${Math.round(k.pKnown * 100)}%`}
            {k.observations > 0 && ` · ${k.observations} obs`}
          </span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/sets tests/actions && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sets/knowledge/ConceptKlps.tsx src/actions/klt-tree.ts tests/sets/concept-klps.test.tsx tests/actions/klt-gated-exports-guard.test.ts
git commit -m "feat(knowledge): expand a concept to the key points behind its number"
```

---

### Task 18: Full suite, live check, and docs

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/BUILD-QUEUE.md`

- [ ] **Step 1: Run the full suite and lint**

Run: `npx vitest run 2>&1 | tail -20 && npx eslint && npx tsc --noEmit`
Expected: **2504 + the new tests passing**, zero regressions against the baseline. The `use-server-exports.test.ts` timeout should now be gone (Task 6 raised it). If any pre-existing test fails, fix it — the baseline had exactly one known flake and it was addressed.

- [ ] **Step 2: Live-verify against the real database**

Start the dev server (`npm run dev`) and check, signed in as the admin granted in Task 5:

1. `/staff` renders real counts; the pending-cards number matches the audit's gap.
2. `/staff/klps` lists key points with weights, and the Relations column shows an em dash.
3. `/staff/coverage` shows a set at `0/50` if one is still unextracted.
4. `/staff/roles` lists your own row and refuses to revoke you.
5. A set's Knowledge tab, list view, now expands past the two roots, and a concept expands to its key points.

Then **mutation-test one guard**: temporarily change `requireStaff` to `requireAdmin`-equivalent-of-nothing (make it return a fake session unconditionally), confirm a learner reaches `/staff`, and revert. A guard never seen to fail is a guard never seen to work.

- [ ] **Step 3: Update `CLAUDE.md`**

In the auth section, after the paragraph on `CREDENTIALS_SIGNUP_ENABLED`, add:

```markdown
  **Roles (Spec 1, 2026-09-03).** `User.role` (`learner | staff | admin`, vocabulary in
  `src/lib/auth/roles.ts`) replaced the `KLT_EDITORS` env allowlist. It is resolved on every
  session by the primary-key lookup `jwtCallback` already makes for `sessionVersion` — never
  stored as a JWT claim, which would leave a revoked admin admin until their token expired.
  Pure predicates (`isStaff`/`isAdmin`, Prisma-free, client-importable) are separate from the
  async gates (`requireStaff`/`requireAdmin` in `src/lib/staff/access.ts`); only gates
  authorize. Bootstrap and recovery are `npm run grant-role` — the migration deliberately does
  not read the old env var, because `prisma migrate deploy` runs inside `npm run build` where
  it may be absent, and a silent no-op grant locks the operator out.
```

- [ ] **Step 4: Update `docs/superpowers/BUILD-QUEUE.md`**

Mark Spec 1 built in the build-order section, note that `/staff/coverage` shipped with it (the user's call), and remove `KLT_EDITORS` from the environment notes. Add a line under Spec 3 and Spec 5 recording that `/staff/klps` already has an empty Relations column and a status-agnostic verdict-mix column waiting for them.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/BUILD-QUEUE.md
git commit -m "docs: record Spec 1 as built and roles as replacing KLT_EDITORS"
```

---

## Self-Review

**Spec coverage.** §1.1 roles → Tasks 1-2. §1.2 session freshness → Task 3. §1.3 `KLT_EDITORS` replacement, including the guard-test update → Task 6. §1.4 bootstrap → Task 5. §1.5 `RoleGrant` → Task 2 (schema) and Tasks 5/12 (writes). §2.1 routes → Tasks 8-12. §2.2 inspector columns, including the empty Relations column → Task 9. §2.3 `'use server'` hazard → Task 7 and Task 12. §2.4 learner record → Task 11. §2.5 self-revocation guard → Task 12. §3 coverage → Task 10. §4 concept ladder → Tasks 14-17. §5 nav and privacy → Task 13 (nav) and Task 12 (who-holds-what). §6 testing → each task's own tests plus Task 18's full run. §7 out-of-scope items appear nowhere, as intended.

**Two deviations from the spec, both deliberate and both minor.** (a) The spec's §2.5 names `searchUsers` implicitly; it is specified explicitly in Task 12. (b) Role writes live in `src/actions/staff-roles.ts` rather than `src/actions/staff.ts`, because the two modules sit on different gates and one file mixing `requireStaff` and `requireAdmin` exports is the shape a reviewer misreads.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. The one stub (`ConceptKlps`, Task 16 Step 3) is explicitly labelled a stub, exists so Task 16 is independently testable, and is rewritten in Task 17 Step 4.

**Type consistency.** `StaffKlpRow`, `StaffCoverageRow`, `StaffOverview` and `LearnerRecord` are defined once in Task 7/11 and consumed with those exact field names in Tasks 9-11. `parentName` is the `RawKltRow` field (Task 14) and `parentKey` is the `TopicRow`/`LearnerTopicProfile`/`TopicMasteryRow` field (Tasks 14-15) — the rename happens once, in `kltRowsToTopicRows`, and is asserted there. `viaAllowlist` → `viaRole` is renamed in Task 6 and never referenced afterwards. `railItems` gains its second parameter in Task 13 only.

**One bug found and fixed during this review.** Task 11 originally typed `LearnerRecord.analysisStatus` as `string` and grouped on it directly. `QuizAnswer.analysisStatus` is `String?`, and null means one specific thing — a row written before Spec 2a. `Object.fromEntries` would have stringified that key to `"null"`, producing a status the closed vocabulary does not contain, on the exact page whose job is to show what the analysis denominator really is. Both read paths now bucket it as `'legacy'`. The same pass replaced `where: { attempt: { userId } }` with `where: { userId }`, which is a real column on `QuizAnswer` and half of the `@@index([userId, createdAt])` the query orders by, and dropped a needless `klpResults[0].mode` in favour of `QuizAnswer.mode`.
