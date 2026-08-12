# Set visibility — private vs link-shareable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every set private by default, let the owner toggle any set to link-shareable, and enforce that consistently across all ten read paths that currently leak sets by id.

**Architecture:** One `Set.visibility` column with a shared `as const` vocabulary. Readability is expressed as a Prisma `where` **fragment** (`readableSetWhere`) that call sites spread into their existing query, so a forgotten check returns nothing instead of everything. A pure `canReadSet` covers the two places that already hold a row (the asset route, the UI). Visibility governs reading only — every write path stays owner-only and is untouched.

**Tech Stack:** TypeScript, Prisma 7 (Postgres/Neon), Next.js 16 App Router, React 19, Vitest 4, Zod 4, shadcn/base-ui.

**Spec:** `docs/superpowers/specs/2026-08-08-set-visibility-design.md`

---

## Global Constraints

- Test runner is Vitest 4. Full suite: `npx vitest run` (~10s, currently **825 tests / 76 files**). Single file: `npx vitest run <path>`.
- Tests import via the `@/` alias and live under `tests/<area>/`.
- Pure modules must not import `@/lib/db`. `src/lib/sets/visibility.ts` is pure — it produces `where` fragments, it never runs queries.
- **404, never 403.** Every enforcement point returns the same not-found result it would for an absent id. Pages use `notFound()`; actions return the string they already return, `'Set not found'`. A distinguishable "forbidden" confirms a private set exists to someone probing ids.
- **`readableSetWhere` returns a bare `OR` for a signed-in viewer.** Spreading it into a `where` that already has its own `OR` silently REPLACES that `OR`. No call site in this plan has one — every one queries by `id` alone — but if that ever changes they must be combined under an explicit `AND: [...]`, never merged by spread.
- Visibility governs **reading only**. `updateSet`, `deleteSet`, uploads, spreadsheet import and the edit page stay owner-only and are not touched by this plan.
- Signed-out access to a link-shared set is a **requirement** on the **set detail page**. An early `if (!session) notFound()` there would be a regression. `/quiz`, `/review`, `/match` and `/print` all require an account — the first three via `src/middleware.ts:8-10`, the last via its own check. **Corrected 2026-08-09 during implementation:** an earlier version of this line also listed `/match` as signed-out-readable. It is not, and matching is studying, so it should not be. `match/page.tsx` still gains a null-tolerant `auth()` call as defence in depth, but its anonymous branch is unreachable behind middleware — the comment there says so.
- Migrations must be additive. Never accept a database reset; never pass `--force-reset` or `--accept-data-loss`. Return BLOCKED if a migration is anything else.
- Run `npx tsc --noEmit` as well as the suite. Vitest does not type-check.
- `npm run lint` baseline before this plan: **187 problems (130 errors, 57 warnings)**. Compare against that; do not fix unrelated pre-existing ones.
- Commit after every task. Do not skip hooks.

---

## File Structure

**Create:**
- `src/lib/sets/visibility.ts` — vocabulary, `canReadSet`, `readableSetWhere`, `toSetVisibility` (Task 1)
- `src/components/sets/VisibilityToggle.tsx` — owner-only control + copy link (Task 8)

**Modify:**
- `prisma/schema.prisma` — `Set.visibility` (Task 2)
- `src/app/sets/[id]/page.tsx`, `/match/page.tsx`, `/quiz/page.tsx`, `/review/page.tsx`, `/print/page.tsx` (Task 3)
- `src/actions/quiz.ts` — `startQuizAttempt` + the `set.findUnique` at `:250` (Task 4)
- `src/app/sets/[id]/print/page.tsx` — attempt ownership (Task 4)
- `src/actions/card-autocomplete.ts` — tighten to owner-only (Task 5)
- `src/app/api/assets/[id]/route.ts` — visibility-aware GET (Task 6)
- `src/actions/klp.ts` — readable scope + gap-fill (Task 7)
- `src/actions/sets.ts` — `setSetVisibility` action (Task 8)

**Tests created:** `tests/sets/visibility.test.ts`, `tests/sets/visibility-enforcement.test.ts`, `tests/actions/klp-gap-fill.test.ts`, `tests/api/asset-visibility.test.ts`.

---

### Task 1: The visibility vocabulary and predicate

**Files:**
- Create: `src/lib/sets/visibility.ts`
- Test: `tests/sets/visibility.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SET_VISIBILITIES`, `type SetVisibility`, `toSetVisibility(raw: string): SetVisibility`, `canReadSet(set: { userId: string; visibility: string }, viewerId: string | null): boolean`, `readableSetWhere(viewerId: string | null): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sets/visibility.test.ts
import { describe, it, expect } from 'vitest'
import {
  SET_VISIBILITIES, toSetVisibility, canReadSet, readableSetWhere,
} from '@/lib/sets/visibility'

const OWNER = 'user-owner'
const OTHER = 'user-other'

describe('SET_VISIBILITIES', () => {
  it('pins the vocabulary the Prisma column documents', () => {
    expect([...SET_VISIBILITIES]).toEqual(['private', 'link'])
  })
})

describe('toCardKlpStatus-style narrowing', () => {
  it('passes known values through', () => {
    for (const v of SET_VISIBILITIES) expect(toSetVisibility(v)).toBe(v)
  })

  it('FAILS CLOSED on an unrecognised value', () => {
    // Wrongly hiding a set annoys the owner; wrongly exposing one is the bug
    // this module exists to close. Unknown must never resolve to 'link'.
    expect(toSetVisibility('public')).toBe('private')
    expect(toSetVisibility('')).toBe('private')
    expect(toSetVisibility('Link')).toBe('private')
  })
})

describe('canReadSet', () => {
  const priv = { userId: OWNER, visibility: 'private' }
  const link = { userId: OWNER, visibility: 'link' }

  it('lets the owner read their own set in either state', () => {
    expect(canReadSet(priv, OWNER)).toBe(true)
    expect(canReadSet(link, OWNER)).toBe(true)
  })

  it('denies another signed-in user a private set', () => {
    expect(canReadSet(priv, OTHER)).toBe(false)
  })

  it('allows another signed-in user a link-shared set', () => {
    expect(canReadSet(link, OTHER)).toBe(true)
  })

  it('denies an anonymous viewer a private set', () => {
    expect(canReadSet(priv, null)).toBe(false)
  })

  it('allows an anonymous viewer a link-shared set', () => {
    // Signed-out viewing of a share link is a requirement, not an oversight.
    expect(canReadSet(link, null)).toBe(true)
  })

  it('treats an unrecognised stored visibility as private', () => {
    expect(canReadSet({ userId: OWNER, visibility: 'garbage' }, OTHER)).toBe(false)
    expect(canReadSet({ userId: OWNER, visibility: 'garbage' }, OWNER)).toBe(true)
  })
})

describe('readableSetWhere', () => {
  it('matches owned OR link-shared for a signed-in viewer', () => {
    expect(readableSetWhere(OWNER)).toEqual({
      OR: [{ userId: OWNER }, { visibility: 'link' }],
    })
  })

  it('matches only link-shared for an anonymous viewer', () => {
    // NOT `{ OR: [{ userId: null }, ...] }` — a null userId would match
    // nothing in Postgres and is a confusing way to express "no owner match".
    expect(readableSetWhere(null)).toEqual({ visibility: 'link' })
  })

  it('never returns an empty object', () => {
    // An empty fragment spread into a `where` is a no-op that matches EVERY
    // set — the exact failure this module exists to prevent.
    expect(Object.keys(readableSetWhere(OWNER)).length).toBeGreaterThan(0)
    expect(Object.keys(readableSetWhere(null)).length).toBeGreaterThan(0)
  })

  it('agrees with canReadSet on every combination', () => {
    // The two must not drift: the fragment guards queries, the predicate
    // guards rows already in hand, and a disagreement is a silent hole.
    for (const viewer of [OWNER, OTHER, null]) {
      for (const visibility of SET_VISIBILITIES) {
        const set = { userId: OWNER, visibility }
        const frag = readableSetWhere(viewer)
        const matchesByFragment =
          'OR' in frag
            ? (frag.OR as { userId?: string; visibility?: string }[]).some(
                (c) => c.userId === set.userId || c.visibility === set.visibility,
              )
            : (frag as { visibility: string }).visibility === set.visibility
        expect(matchesByFragment, `${viewer}/${visibility}`).toBe(canReadSet(set, viewer))
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sets/visibility.test.ts`
Expected: FAIL — cannot resolve `@/lib/sets/visibility`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/sets/visibility.ts

/**
 * Who can read a set.
 *
 * A single `as const` with the type DERIVED from it, following
 * `CARD_KLP_STATUSES` (`src/lib/cards/klp-status.ts`) and `AI_TASKS`
 * (`src/lib/ai/model-routing.ts`). `Set.visibility` is a `String` column, so a
 * typo compiles cleanly and silently never matches — import this const rather
 * than writing a literal.
 *
 * Two states only. There is no public directory and no discovery: `link` means
 * "anyone holding the id may read it", nothing more.
 */
export const SET_VISIBILITIES = ['private', 'link'] as const

export type SetVisibility = (typeof SET_VISIBILITIES)[number]

/**
 * Narrow a value read from the database.
 *
 * FAILS CLOSED: an unrecognised value resolves to `private`, never `link`. The
 * cost of wrongly hiding a set is an annoyed owner; the cost of wrongly
 * exposing one is the bug this module exists to close. Note this differs from
 * `toCardKlpStatus`, which degrades to the column default because that default
 * is harmless — here the safe value and the default happen to coincide, and
 * the safety is the reason, not the coincidence.
 */
export function toSetVisibility(raw: string): SetVisibility {
  return (SET_VISIBILITIES as readonly string[]).includes(raw)
    ? (raw as SetVisibility)
    : 'private'
}

/**
 * Can this viewer read this set? For callers that ALREADY hold the row.
 *
 * Only two legitimately do: the asset route, which reaches the set through a
 * join from the asset, and the UI, which needs to know whether to render the
 * owner-only visibility control. Everything else must use `readableSetWhere`
 * — see its doc comment for why that distinction matters.
 *
 * `viewerId` is `null` for an anonymous visitor. It must never be a session's
 * possibly-undefined id passed through unchecked: `undefined === undefined`
 * would make two signed-out visitors "the same user" and match a set whose
 * `userId` was somehow null.
 */
export function canReadSet(
  set: { userId: string; visibility: string },
  viewerId: string | null,
): boolean {
  if (viewerId !== null && set.userId === viewerId) return true
  return toSetVisibility(set.visibility) === 'link'
}

/**
 * A Prisma `where` fragment for "sets this viewer may read". Spread it into an
 * existing `where` alongside the id.
 *
 * THE FRAGMENT IS THE POINT, not a convenience over `canReadSet`. Every one of
 * the ten pre-existing leaks had the same shape: `findUnique({ where: { id } })`
 * followed by an ownership check that was absent, or present but gating only
 * the UI. A post-hoc predicate reproduces exactly that hazard — it is one
 * forgotten line away from a leak, and the forgotten line looks like working
 * code.
 *
 * Embedding the rule in the query inverts the failure mode: a call site that
 * forgets it returns NOTHING, which is a visible bug, rather than EVERYTHING,
 * which is a silent one. Same argument `buildCardScopeWhere`
 * (`src/lib/memory/scope.ts`) makes for scope semantics.
 *
 * Returns a bare `OR` for a signed-in viewer, so spreading this into a `where`
 * that already has its own `OR` REPLACES it. No current call site has one; if
 * that changes, combine under an explicit `AND: [...]`.
 */
export function readableSetWhere(viewerId: string | null): Record<string, unknown> {
  if (viewerId === null) return { visibility: 'link' }
  return { OR: [{ userId: viewerId }, { visibility: 'link' }] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sets/visibility.test.ts && npx tsc --noEmit`
Expected: both PASS.

- [ ] **Step 5: Mutation check**

Introduce each, run the test file, confirm at least one test FAILS, then revert:
- (a) `toSetVisibility` returns `'link'` on an unknown value
- (b) `canReadSet` returns true when `viewerId === null` and the set is private
- (c) `readableSetWhere(null)` returns `{}`
- (d) `readableSetWhere` omits the `{ visibility: 'link' }` arm for a signed-in viewer
- (e) `canReadSet` compares `set.userId === viewerId` without the null guard

Report all five. If any survives, add an assertion that kills it and re-verify.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sets/visibility.ts tests/sets/visibility.test.ts
git commit -m "feat(visibility): add the set-readability vocabulary and predicate"
```

---

### Task 2: The visibility column

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: Task 1's `SET_VISIBILITIES` (referenced in the doc comment only)
- Produces: `Set.visibility` on the generated client

- [ ] **Step 1: Add the column**

In `model Set`, below `description`:

```prisma
  /// Vocabulary: SET_VISIBILITIES in src/lib/sets/visibility.ts (private|link).
  /// Import that const rather than writing a literal — this is a String
  /// column, so a typo compiles and never matches.
  ///
  /// Defaults to `private`, and the migration therefore makes every EXISTING
  /// set private too. That is the intent: sets were readable by anyone holding
  /// the id, and this closes that rather than grandfathering it.
  visibility   String         @default("private")
```

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name add_set_visibility`
Expected: one additive `ALTER TABLE "Set" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private'`, no reset prompt. If drift is reported, STOP and return BLOCKED — do not pass `--force-reset` or `--accept-data-loss`.

- [ ] **Step 3: Verify**

Run: `npx prisma validate && npx tsc --noEmit`
Expected: schema valid, type-check clean.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(visibility): add Set.visibility, defaulting every set to private"
```

---

### Task 3: Enforce on the five set pages

**Files:**
- Modify: `src/app/sets/[id]/page.tsx`, `src/app/sets/[id]/match/page.tsx`, `src/app/sets/[id]/quiz/page.tsx`, `src/app/sets/[id]/review/page.tsx`, `src/app/sets/[id]/print/page.tsx`
- Test: `tests/sets/visibility-enforcement.test.ts`

**Interfaces:**
- Consumes: Task 1's `readableSetWhere`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the failing test**

The pages are server components, so this file tests the **query shape** each page builds — that `readableSetWhere` is present and correctly composed — rather than rendering them. That is the property at risk: the predicate is already proven correct by Task 1, and what fails in practice is a call site that never calls it.

```ts
// tests/sets/visibility-enforcement.test.ts
import { describe, it, expect } from 'vitest'
import { readableSetWhere } from '@/lib/sets/visibility'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * Every read path that fetches a Set by client-supplied id. If you add one,
 * add it here — this list IS the enforcement checklist, and a path missing
 * from it is a path nobody is checking.
 */
const ENFORCED_PATHS = [
  'src/app/sets/[id]/page.tsx',
  'src/app/sets/[id]/match/page.tsx',
  'src/app/sets/[id]/quiz/page.tsx',
  'src/app/sets/[id]/review/page.tsx',
  'src/app/sets/[id]/print/page.tsx',
  'src/actions/quiz.ts',
]

describe('every set read path applies readableSetWhere', () => {
  for (const path of ENFORCED_PATHS) {
    it(`${path} imports and uses readableSetWhere`, () => {
      const src = readFileSync(join(ROOT, path), 'utf8')
      expect(src, `${path} must import the predicate`).toContain('readableSetWhere')
    })

    it(`${path} has no unguarded prisma.set.findUnique`, () => {
      // `findUnique` takes a unique field only, so `readableSetWhere` CANNOT be
      // spread into it — Prisma rejects a non-unique filter there. Every one of
      // these sites must therefore have moved to `findFirst`. A surviving
      // `findUnique` on the set is proof the guard was not actually applied.
      const src = readFileSync(join(ROOT, path), 'utf8')
      expect(src).not.toMatch(/prisma\.set\.findUnique/)
    })
  }
})

describe('the fragment composes correctly with an id lookup', () => {
  it('ANDs with the id rather than replacing it', () => {
    const where = { id: 'set1', ...readableSetWhere('u1') }
    expect(where.id).toBe('set1')
    expect(where.OR).toBeDefined()
  })

  it('does not clobber an existing OR when composed naively', () => {
    // Documents the hazard rather than permitting it: this is what a spread
    // does to a where that already has an OR. No current call site has one.
    const naive = { OR: [{ title: 'x' }], ...readableSetWhere('u1') }
    expect(naive.OR).toEqual(readableSetWhere('u1').OR)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sets/visibility-enforcement.test.ts`
Expected: FAIL — none of the six files mentions `readableSetWhere`, and all still use `prisma.set.findUnique`.

- [ ] **Step 3: Convert each page**

`findUnique` accepts only unique fields, so it cannot carry the fragment. Every site becomes `findFirst`, which is why the test asserts no `findUnique` on the set survives.

In `src/app/sets/[id]/page.tsx` — note it must keep working signed-out:

```ts
import { readableSetWhere } from '@/lib/sets/visibility'
// ...
  const viewerId = session?.user?.id ?? null

  const [set, progressList] = await Promise.all([
    prisma.set.findFirst({
      where: { id, ...readableSetWhere(viewerId) },
      include: { /* unchanged */ },
    }),
    // ...unchanged
  ])

  if (!set) notFound()
```

In `src/app/sets/[id]/match/page.tsx` — this page currently calls no `auth()` at all; add it, and do NOT add a sign-in requirement:

```ts
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
// ...
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(viewerId) },
    include: { /* unchanged */ },
  })
```

In `quiz/page.tsx`, `review/page.tsx` and `print/page.tsx`, keep the existing sign-in guard and change only the query:

```ts
  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(session.user.id) },
    include: { /* unchanged */ },
  })
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: the enforcement file passes for the five pages; `src/actions/quiz.ts` still FAILS — that is Task 4.

- [ ] **Step 5: Commit**

```bash
git add "src/app/sets/[id]" tests/sets/visibility-enforcement.test.ts
git commit -m "feat(visibility): enforce readability on the five set pages"
```

---

### Task 4: Enforce in the quiz actions, and fix the print attempt leak

**Files:**
- Modify: `src/actions/quiz.ts`
- Modify: `src/app/sets/[id]/print/page.tsx`
- Test: `tests/actions/quiz-submit-ownership.test.ts` (existing — extend)

**Interfaces:**
- Consumes: Task 1's `readableSetWhere`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the failing test**

Append to `tests/actions/quiz-submit-ownership.test.ts`, matching its existing mock shape (add `set: { findFirst }` to the mocked client):

```ts
describe('startQuizAttempt respects set visibility', () => {
  it('refuses another user\'s private set with the same error as a missing one', async () => {
    // Not-found, never forbidden: a distinguishable error confirms to an
    // id-prober that a private set exists.
    h.setFindFirst.mockResolvedValue(null)
    const res = await startQuizAttempt('someone-elses-set', ['multiple-choice'], BASE_SETUP)
    expect(res.success).toBe(false)
    expect((res as { error: string }).error).toBe('Set not found')
  })

  it('scopes the lookup with readableSetWhere rather than by id alone', async () => {
    h.setFindFirst.mockResolvedValue(null)
    await startQuizAttempt('s1', ['multiple-choice'], BASE_SETUP)
    expect(h.setFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 's1',
          OR: [{ userId: OWNER }, { visibility: 'link' }],
        }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/quiz-submit-ownership.test.ts`
Expected: FAIL — the action still calls `prisma.set.findUnique` scoped by id alone.

- [ ] **Step 3: Guard both set fetches in `quiz.ts`**

Add the import:

```ts
import { readableSetWhere } from '@/lib/sets/visibility';
```

`startQuizAttempt` (around `:356`):

```ts
    const set = await prisma.set.findFirst({
      where: { id: setId, ...readableSetWhere(session.user.id) },
      include: { /* unchanged */ },
    });
    if (!set) return { success: false, error: 'Set not found' };
```

The sibling-card fetch on the MC generation path (around `:250`):

```ts
    const set = await prisma.set.findFirst({
      where: { id: card.setId, ...readableSetWhere(session.user.id) },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };
```

- [ ] **Step 4: Fix the print page's attempt leak**

`src/app/sets/[id]/print/page.tsx` fetches the attempt with
`findUnique({ where: { id: sp.attemptId } })` and checks only
`attempt.setId !== id`. Any signed-in user can therefore print any attempt on a
set they can read — leaking another learner's `selectedCardIds` and generated
options. This is the identical bug class Spec 2b fixed in
`getQuizAttemptSummary` and `getQuizAttemptCards` and missed here.

```ts
    // Owner-scoped: an attempt is one learner's personal quiz session. Reading
    // a set does NOT confer reading someone else's attempt on it. Same fix as
    // getQuizAttemptSummary / getQuizAttemptCards (Spec 2b).
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: sp.attemptId, userId: session.user.id },
    });
    if (!attempt || attempt.setId !== id) return notFound();
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, including the whole enforcement file from Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/actions/quiz.ts "src/app/sets/[id]/print/page.tsx" tests/actions/quiz-submit-ownership.test.ts
git commit -m "feat(visibility): guard the quiz actions and owner-scope the printed attempt"
```

---

### Task 5: Tighten card autocomplete to owner-only

**Files:**
- Modify: `src/actions/card-autocomplete.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing

This one **narrows** rather than widening. Autocomplete is an authoring aid: its
output is only useful while editing, and editing is owner-only. Granting it to
readers would let anyone with a link spend their own AI budget having a model
paraphrase someone else's set, for no legitimate purpose. Today it has no owner
check at all — a previously unrecorded exposure found while designing this spec.

- [ ] **Step 1: Add the owner check**

```ts
    // Owner-scoped, NOT readable-scoped. This is an authoring aid and authoring
    // is owner-only; a reader has no legitimate use for it, and the call bills
    // the caller's AI credential against someone else's content.
    const set = await prisma.set.findFirst({
      where: { id: setId, userId: session.user.id },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/actions/card-autocomplete.ts
git commit -m "fix(visibility): owner-scope card autocomplete"
```

---

### Task 6: Visibility-aware asset proxy

**Files:**
- Modify: `src/app/api/assets/[id]/route.ts`
- Test: `tests/api/asset-visibility.test.ts`

**Interfaces:**
- Consumes: Task 1's `canReadSet`
- Produces: nothing

Without this, every image, audio file and video on a shared set 403s for the
recipient and 401s for a signed-out viewer — so "view a shared set" would
silently mean "view a shared *text-only* set", with broken placeholders and
nothing on screen explaining why.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/asset-visibility.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  assetFindUnique: vi.fn(),
  blobGet: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: { cardAsset: { findUnique: h.assetFindUnique } } }))
vi.mock('@vercel/blob', () => ({ get: h.blobGet, del: vi.fn() }))

import { GET } from '@/app/api/assets/[id]/route'

const OWNER = 'user-owner'
const OTHER = 'user-other'
const params = Promise.resolve({ id: 'asset1' })

/** An asset attached to a card in a set with the given owner/visibility. */
const asset = (userId: string, visibility: string | null) => ({
  id: 'asset1', userId, storageKey: 'k', mimeType: 'image/png', originalName: 'a.png',
  contentBlocks: visibility === null
    ? []
    : [{ card: { set: { userId, visibility } } }],
})

beforeEach(() => {
  vi.clearAllMocks()
  h.blobGet.mockResolvedValue({
    statusCode: 200, stream: 'STREAM', blob: { contentType: 'image/png', size: 3 },
  })
})

describe('GET /api/assets/[id]', () => {
  it('serves the owner their own private-set asset', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await GET({} as never, { params })).status).toBe(200)
  })

  it('denies another user an asset on a private set', async () => {
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await GET({} as never, { params })).status).toBe(404)
  })

  it('serves another user an asset on a link-shared set', async () => {
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'link'))
    expect((await GET({} as never, { params })).status).toBe(200)
  })

  it('serves an ANONYMOUS viewer an asset on a link-shared set', async () => {
    h.auth.mockResolvedValue(null)
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'link'))
    expect((await GET({} as never, { params })).status).toBe(200)
  })

  it('denies an anonymous viewer an asset on a private set', async () => {
    h.auth.mockResolvedValue(null)
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await GET({} as never, { params })).status).toBe(404)
  })

  it('keeps an UNLINKED asset owner-only', async () => {
    // Uploads create the asset row before it is attached to any card, so there
    // is no set to consult and the owner check is the only correct rule.
    h.auth.mockResolvedValue({ user: { id: OTHER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, null))
    expect((await GET({} as never, { params })).status).toBe(404)
  })

  it('caches a shared asset publicly and a private one privately', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'private'))
    expect((await GET({} as never, { params })).headers.get('Cache-Control'))
      .toContain('private')

    h.assetFindUnique.mockResolvedValue(asset(OWNER, 'link'))
    expect((await GET({} as never, { params })).headers.get('Cache-Control'))
      .toContain('public')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/asset-visibility.test.ts`
Expected: FAIL — the route 401s anonymously and 403s for any non-owner.

- [ ] **Step 3: Rewrite the GET guard**

Replace the session guard and ownership check. Note the `include` — the asset
reaches a set only through its content blocks.

```ts
import { canReadSet } from '@/lib/sets/visibility';
// ...
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // No early 401: a link-shared set is readable signed-out, and its media has
  // to be too, or a shared set renders broken placeholders with nothing on
  // screen explaining why.
  const session = await auth();
  const viewerId = session?.user?.id ?? null;

  const { id: assetId } = await params;
  if (!assetId) {
    return NextResponse.json({ error: 'Asset ID required' }, { status: 400 });
  }

  const asset = await prisma.cardAsset.findUnique({
    where: { id: assetId },
    include: {
      contentBlocks: {
        select: { card: { select: { set: { select: { userId: true, visibility: true } } } } },
        take: 1,
      },
    },
  });

  // 404 for both "absent" and "forbidden": a distinguishable 403 confirms the
  // asset exists to someone probing ids.
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  // An asset not yet attached to any card has no set to consult — uploads
  // create the row before linking it — so the owner check is the only correct
  // rule there.
  const set = asset.contentBlocks[0]?.card?.set ?? null;
  const allowed = set
    ? canReadSet(set, viewerId)
    : viewerId !== null && asset.userId === viewerId;

  if (!allowed) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const shared = set !== null && canReadSet(set, null);
  // ... existing blob read unchanged, then:
  //   A shared asset served `private` is refetched per viewer for no benefit;
  //   an owner-only asset served `public` could be cached by a shared proxy,
  //   which is precisely the leak this spec closes.
  responseHeaders.set(
    'Cache-Control',
    shared ? 'public, max-age=604800' : 'private, max-age=604800',
  );
```

`CardAsset.contentBlocks` already exists (`prisma/schema.prisma:187`), so this
needs **no schema change and no migration**.

**Do not use `CardAsset.setId` instead.** It looks like a one-hop shortcut and
it is the wrong field: it records the set the asset was *uploaded for*, not
where it is *used*. An asset uploaded against set A but placed on a card in
set B would be judged by A's visibility while rendering inside B — readable
when it should not be, or broken when it should work. The content-block join
answers the question actually being asked: is this asset rendered on a set the
viewer may read? `take: 1` keeps it cheap; an asset on several cards in several
sets is not a case worth designing for, and the first block is representative
because a shared asset across sets is not reachable through the UI.

DELETE is unchanged: owner-only.

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/assets/[id]/route.ts" prisma/schema.prisma tests/api/asset-visibility.test.ts
git commit -m "feat(visibility): serve assets for link-shared sets"
```

---

### Task 7: KLP gap-fill for viewers

**Files:**
- Modify: `src/actions/klp.ts`
- Test: `tests/actions/klp-gap-fill.test.ts`

**Interfaces:**
- Consumes: Task 1's `readableSetWhere`
- Produces: nothing

Spec §7. `extractKlpsForCards` is scoped `where: { set: { userId } }`, and its
doc comment correctly calls that an authorization boundary — extraction is a
**write**, superseding live `CardKlp` rows and mutating `Card.klpStatus`.

Without viewer extraction a shared-set quiz has no KLPs, so True/False falls
back, MC distractors degrade, and Spec 2a records every answer `no_klps`,
polluting *the viewer's own* learner profile. Widened unconstrained, anyone with
a link could replace the propositions the owner's error analysis rests on. Two
constraints resolve both.

- [ ] **Step 1: Write the failing test**

```ts
// tests/actions/klp-gap-fill.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  cardKlpFindMany: vi.fn(),
  cardFindFirst: vi.fn(),
  cardUpdateMany: vi.fn(),
  setFindFirst: vi.fn(),
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    cardKlp: { findMany: h.cardKlpFindMany },
    card: { findFirst: h.cardFindFirst, updateMany: h.cardUpdateMany, findMany: vi.fn(() => []) },
    set: { findFirst: h.setFindFirst },
  },
}))

import { ensureKlpsReady } from '@/actions/klp'

const OWNER = 'user-owner'
const VIEWER = 'user-viewer'

beforeEach(() => {
  vi.clearAllMocks()
  h.cardUpdateMany.mockResolvedValue({ count: 0 })
})

describe('ensureKlpsReady on a set you do not own', () => {
  it('serves KLPs the owner already extracted, without extracting', async () => {
    const live = [{ id: 'k1', index: 0, text: 't', weight: 3, kind: 'fact' }]
    h.cardKlpFindMany.mockResolvedValue(live)
    h.cardFindFirst.mockResolvedValue({
      id: 'c1', term: 'a', definition: 'b', klpStatus: 'ready',
      klpSourceHash: null, contentBlocks: [],
    })

    const out = await ensureKlpsReady(VIEWER, 'c1')
    expect(out).toEqual(live)
  })

  it('NEVER supersedes a ready card, even when the card looks stale', async () => {
    // Gap-fill only. A viewer must not replace the propositions the owner's
    // whole error-analysis substrate is built on, using whatever model their
    // credential happens to point at.
    const live = [{ id: 'k1', index: 0, text: 't', weight: 3, kind: 'fact' }]
    h.cardKlpFindMany.mockResolvedValue(live)
    h.cardFindFirst.mockResolvedValue({
      id: 'c1', term: 'a', definition: 'b', klpStatus: 'ready',
      klpSourceHash: 'STALE-HASH', contentBlocks: [],
    })

    const out = await ensureKlpsReady(VIEWER, 'c1')
    expect(out).toEqual(live)
    expect(h.cardUpdateMany).not.toHaveBeenCalled()
  })

  it('does fill a genuine gap — a card nobody has extracted yet', async () => {
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue({
      id: 'c1', term: 'a', definition: 'b', klpStatus: 'pending',
      klpSourceHash: null, contentBlocks: [],
    })

    await ensureKlpsReady(VIEWER, 'c1')
    // Reached extraction rather than short-circuiting: the card was looked up
    // under a READABLE scope, not an owner scope.
    expect(h.cardFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'c1' }),
      }),
    )
  })

  it('returns nothing for a card on a set the viewer cannot read at all', async () => {
    h.cardKlpFindMany.mockResolvedValue([])
    h.cardFindFirst.mockResolvedValue(null)
    expect(await ensureKlpsReady(VIEWER, 'c1')).toEqual([])
  })
})

describe('ensureKlpsReady for the owner is unchanged', () => {
  it('still re-extracts a stale card the owner owns', async () => {
    h.cardKlpFindMany.mockResolvedValue([
      { id: 'k1', index: 0, text: 't', weight: 3, kind: 'fact' },
    ])
    h.cardFindFirst.mockResolvedValue({
      id: 'c1', term: 'a', definition: 'b', klpStatus: 'ready',
      klpSourceHash: 'STALE-HASH', contentBlocks: [], set: { userId: OWNER },
    })

    await ensureKlpsReady(OWNER, 'c1')
    // The owner's staleness path must survive: this is the self-healing layer
    // that stops distractors corrupting propositions the card no longer teaches.
    expect(h.cardFindFirst).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/klp-gap-fill.test.ts`
Expected: FAIL — the card lookup is owner-scoped, so a viewer gets `[]` in every case.

- [ ] **Step 3: Widen the read scope and add the gap-fill guard**

In `ensureKlpsReady`, replace the owner-scoped card lookup:

```ts
  // READABLE-scoped, not owner-scoped: a viewer studying a link-shared set
  // needs its KLPs, or True/False falls back, MC distractors degrade, and
  // every answer records `no_klps` — polluting the VIEWER'S OWN profile with
  // analysis that could not run. `set.userId` comes back so the gap-fill rule
  // below can tell owner from viewer.
  const card = await prisma.card.findFirst({
    where: { id: cardId, set: readableSetWhere(userId) },
    select: {
      id: true,
      term: true,
      definition: true,
      klpStatus: true,
      klpSourceHash: true,
      set: { select: { userId: true } },
      contentBlocks: {
        select: { side: true, type: true, text: true, assetId: true, position: true },
      },
    },
  });
  if (!card) return [];

  const isOwner = card.set.userId === userId;

  // Same pure predicate the save path uses — one definition of "stale".
  const isStale = selectStaleCardIds([card]).length > 0;
  if (existing.length > 0 && !(isOwner && isStale)) return existing;

  // GAP-FILL ONLY for a viewer. Extraction supersedes live CardKlp rows and
  // mutates the card, so an unconstrained widening would let anyone holding a
  // link replace the propositions the OWNER's error analysis rests on, using
  // whatever model their credential points at. A viewer may fill a hole; only
  // the owner may overwrite. Owner behaviour is completely unchanged.
  if (!isOwner && existing.length > 0) return existing;

  // 'skipped' means no usable key. Retrying per question would fire one doomed
  // call per card in the quiz.
  if (card.klpStatus === 'skipped') return existing;

  await extractOnce(userId, cardId, isOwner);
  return live();
```

- [ ] **Step 4: Stop a viewer's failure marking the owner's card**

`extractOnce` and `extractKlpsForCards` need to know whether this is the
owner's run. Thread a flag through, and skip the status write when it is not.

`extractOnce` (`:276`) gains the flag and includes it in the dedupe key:

```ts
function extractOnce(userId: string, cardId: string, isOwner: boolean): Promise<void> {
  const key = `${userId}:${cardId}`;
  const pending = inFlightExtractions.get(key);
  if (pending) return pending;

  const promise = extractKlpsForCards(userId, [cardId], isOwner).finally(() => {
    inFlightExtractions.delete(key);
  });
  inFlightExtractions.set(key, promise);
  return promise;
}
```

`extractKlpsForCards` takes an optional trailing flag, defaulting to the
owner's behaviour so the `after()` save path and the retry action are unchanged:

```ts
export async function extractKlpsForCards(
  userId: string,
  cardIds: string[],
  /**
   * False when a VIEWER triggered this on a set they do not own. A viewer's
   * failure must not write `klpStatus: 'failed' | 'skipped'` or `klpError` onto
   * a stranger's card: a viewer with no AI credential would otherwise stamp
   * 'skipped' on the owner's card and suppress the owner's own retry UI.
   * Defaults true so the `after()` save path and retryKlpExtraction are
   * unchanged.
   */
  isOwner: boolean = true,
): Promise<void> {
```

Widen its card query the same way, and gate every `markFailed` call on
`isOwner`:

```ts
    cards = await prisma.card.findMany({
      where: { id: { in: cardIds }, set: readableSetWhere(userId) },
      include: { contentBlocks: true, set: { select: { title: true } } },
    });
  } catch (err) {
    if (isOwner) await markFailed(cardIds, err, 'failed', userId);
    return;
  }
```

```ts
      if (failedIds.length > 0 && isOwner) {
        await markFailed(failedIds, err, isNoUsableCredential(err) ? 'skipped' : 'failed');
      }
```

Add the import: `import { readableSetWhere } from '@/lib/sets/visibility';`

**Concurrency is already handled.** Owner and viewer can now race on one card,
but `writeKlpVersion` already retries once on the
`@@unique([cardId, version, index])` collision (`src/actions/klp.ts:203-208`) —
that path was written for the existing save-vs-`ensureKlpsReady` race and works
identically here, because it turns on the card, not the caller. Gap-fill also
shrinks the window: two gap-fills on the same card are the only collision
possible, and the loser's retry sees the winner's committed rows.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, including `tests/actions/klp.test.ts` unchanged — the
`isOwner` default is what keeps the existing paths identical.

- [ ] **Step 6: Commit**

```bash
git add src/actions/klp.ts tests/actions/klp-gap-fill.test.ts
git commit -m "feat(visibility): let viewers gap-fill KLPs without touching the owner's card"
```

---

### Task 8: The toggle and the viewer banner

**Files:**
- Create: `src/components/sets/VisibilityToggle.tsx`
- Modify: `src/actions/sets.ts`
- Modify: `src/app/sets/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 1's `SET_VISIBILITIES`, `SetVisibility`, `toSetVisibility`
- Produces: `setSetVisibility(setId: string, visibility: string): Promise<ActionResult<{ visibility: SetVisibility }>>`

- [ ] **Step 1: Add the action**

In `src/actions/sets.ts`, following the ownership pattern `updateSet` already
uses:

```ts
/**
 * Owner-only. Visibility governs who may READ a set; changing it is a write,
 * so it is gated on ownership, not on readability.
 */
export async function setSetVisibility(
  setId: string,
  visibility: string,
): Promise<ActionResult<{ visibility: SetVisibility }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const parsed = toSetVisibility(visibility)
  // Reject rather than silently coerce: a save is an explicit user act, and
  // toSetVisibility fails CLOSED, so a typo would quietly make a set private
  // while the UI showed it as shared.
  if (parsed !== visibility) {
    return { success: false, error: 'Unrecognised visibility setting' }
  }

  const updated = await prisma.set.updateMany({
    where: { id: setId, userId: session.user.id },
    data: { visibility: parsed },
  })
  if (updated.count === 0) return { success: false, error: 'Set not found' }

  revalidatePath(`/sets/${setId}`)
  return { success: true, data: { visibility: parsed } }
}
```

`updateMany` with the owner in the `where` rather than `findUnique`-then-check,
for the same reason Task 1 prefers a fragment: the check cannot be forgotten.

- [ ] **Step 2: Build the toggle**

A `'use client'` component following `src/components/settings/CredentialList.tsx`
— server action plus `sonner` toasts. Two states, named plainly:

| Value | Label |
| --- | --- |
| `private` | Only me |
| `link` | Anyone with the link |

Requirements:
- Copy-link button, visible only in the `link` state, copying the set's absolute URL.
- Switching to `link` must state the consequence in one line, at the point of change, not in a tooltip: **"Anyone with the link can view and study this set. They can't edit it, and their progress stays their own."**
- Optimistic state with a revert on failure, so a rejected save cannot leave the control showing a state the database does not have.

- [ ] **Step 3: Mount it, and add the viewer banner**

In `src/app/sets/[id]/page.tsx`, `isOwner` is already computed. Render
`<VisibilityToggle setId={set.id} visibility={toSetVisibility(set.visibility)} />`
only when `isOwner`.

When `!isOwner`, render a banner instead: whose set it is, and that their
progress is their own. Study writes are keyed `(userId, cardId)`, so a viewer's
confidence, events and quiz history never touch the owner's — that is literally
true, and it is not something a user should have to infer.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run lint 2>&1 | tail -3`
Expected: type-check and suite pass; no new lint problems versus the **187** baseline.

- [ ] **Step 5: Commit**

```bash
git add src/components/sets/VisibilityToggle.tsx src/actions/sets.ts "src/app/sets/[id]/page.tsx"
git commit -m "feat(visibility): add the owner toggle and the viewer banner"
```

---

## Final verification

- [ ] `npx vitest run` — full suite green (expect **>825**; baseline before this plan is 825 / 76 files)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — no new problems versus the **187** baseline
- [ ] `grep -rn "prisma\.set\.findUnique" src/` returns only owner-checked write paths (`updateSet`, `deleteSet`, `uploads.ts`, `import-spreadsheet.ts`) — never a read path
- [ ] **By hand, signed out:** a private set's URL 404s; a link-shared set's URL renders, including its images
- [ ] **By hand, as a second user:** a private set 404s on `/sets/[id]`, `/match`, `/quiz`, `/review`, `/print`; a shared one works in all five
- [ ] **By hand, as owner:** toggle to shared, copy link, open in a private window, confirm it loads; toggle back and confirm the same URL 404s
- [ ] Confirm the toggle is absent entirely for a non-owner — not merely disabled

## Deliberately NOT in this plan

- **Copy-to-my-account.** Real feature (card, content-block, category and asset copying, with asset re-pointing), not a visibility toggle.
- **A public directory or search.** `src/app/sets/page.tsx` stays scoped to `userId`.
- **Per-card or per-category visibility.** The set is the unit.
- **Revocable or expiring share tokens.** Un-sharing is toggling back.
- **Deletion and forgetting** — the sibling spec, not yet written.
