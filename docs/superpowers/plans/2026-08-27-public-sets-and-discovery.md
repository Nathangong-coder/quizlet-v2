# Public sets, fork & discovery — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a third set visibility (`public`), a browsable `/browse` directory, fork ("make my own copy"), a real homepage with Jump back in + Recommended, report/unlist moderation, and the "Instrument" visual chassis those surfaces are built in.

**Architecture:** Every read of a `Set` by client-supplied id composes the Prisma fragment `readableSetWhere(viewerId)` into its `where` — the fragment is the guard, so a call site that forgets it returns nothing (visible) rather than everything (silent). Adding `public` widens that fragment, so the fragment changes first and everything else is built on top. Risky arithmetic (fork size caps, recommendation ranking, glyph layout) lives in pure functions with unit tests; the DB shells around them stay thin and untested, following `getLearnerMetrics`' precedent.

**Tech Stack:** Next.js App Router (server components + server actions), Prisma 7 / Postgres, `@vercel/blob@^2.5.0` (`copy` for server-side blob duplication), Vitest 4, Tailwind v4 with `@theme inline` tokens.

**Spec:** `docs/superpowers/specs/2026-08-27-public-sets-and-discovery-design.md`

## Global Constraints

- **`SET_VISIBILITIES` is the vocabulary.** `Set.visibility` is a `String` column — a typo compiles and silently never matches. Import the const; never write a literal.
- **`toSetVisibility` fails closed to `private`.** `public` must NEVER be a degradation target.
- **Never spread two `OR`s at one level.** Every multi-predicate set read composes as `{ AND: [readableSetWhere(v), ...] }`.
- **Never `prisma.set.findUnique` on a read path.** `findUnique` cannot accept the fragment. `tests/sets/visibility-enforcement.test.ts` asserts there are none.
- **Forks are always created `private`.** Visibility is never inherited.
- **Fork attribution always renders from `forkedFromTitle`/`forkedFromHandle`**, never from the FK. Link only when the source resolves under `readableSetWhere(viewer)`.
- **Recommended never writes.** No `create`/`update`/`upsert`/`delete` anywhere in `src/lib/sets/recommend.ts`.
- **Baselines to hold** (branch `spec3b-tunable-scoring`, after item 9): **153 test files / 1790 tests passing**; `tsc --noEmit` clean; `next build` clean; `npm run lint` **175 problems (131 errors, 44 warnings)** — do not fix unrelated lint.
- **Commands:** `npm test` (vitest run), `npx tsc --noEmit`, `npm run lint`, `npx next build`.
- **A wrong test path in a vitest command fails SILENTLY** — it matches nothing and reports success. Verify every path by glob before trusting a green run.

## Wave structure (for parallel sub-agent execution)

Tasks are grouped into waves by dependency. **Within a wave, file ownership is disjoint** — no two tasks touch the same file. The parent runs the full suite, `tsc` and lint **between** waves and commits per wave. Sub-agents run only their own test files plus named regression guards; they must NOT run the full suite (concurrent edits make it fail for unrelated reasons, which trains everyone to dismiss real regressions).

| Wave | Tasks | Owns |
| --- | --- | --- |
| 1 | 1, 2, 3 | `prisma/*` · `src/lib/sets/visibility.ts` + its test · `globals.css` + new `ui/` primitives |
| 2 | 4, 5, 6, 7 | `actions/sets.ts` + `VisibilityMenu` · `lib/sets/recents.ts` + set page · `lib/sets/fork.ts` · `lib/sets/moderation.ts` |
| 3 | 8, 9, 10 | `app/browse/*` + `lib/sets/directory.ts` + glyph · `actions/sets-fork.ts` + fork components · `app/page.tsx` + `components/home/*` |
| 4 | 11, 12, 13, 14 | `lib/sets/recommend.ts` + `RecommendedStrip` + `app/page.tsx` · `Navbar.tsx` + `app/sets/page.tsx` + `app/account/page.tsx` · `tests/sets/visibility-enforcement.test.ts` · `app/sets/[id]/page.tsx` |

**Task 13 must run LAST within wave 4** — it asserts source-level properties of files tasks 11 and 14 are still writing. Dispatch 11, 12 and 14 together; dispatch 13 once they report.

---

# WAVE 1

---

### Task 1: Schema & migration

**Files:**
- Modify: `prisma/schema.prisma` (model `Set` ~line 100; model `User` ~line 9)
- Create: `prisma/migrations/20260828000000_public_sets_and_discovery/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `Set.listingBlocked: boolean`, `Set.publishedAt: Date | null`, `Set.forkedFromId/forkedFromTitle/forkedFromHandle: string | null`, `Set.forks: Set[]`, `Set.forkedFrom: Set | null`, `Set.views: SetView[]`, `Set.reports: SetReport[]`; models `SetView` and `SetReport`; `User.setViews: SetView[]`, `User.setReports: SetReport[]`.

**You own `prisma/schema.prisma` exclusively this wave. No other task may touch it.**

- [ ] **Step 1: Add the new columns to `model Set`**

In `prisma/schema.prisma`, inside `model Set`, after the existing `visibility` field and its comment block, add:

```prisma
  /// Operator moderation. Independent of `visibility` ON PURPOSE: flipping
  /// visibility is something the OWNER can undo in one click and silently, so
  /// it cannot carry a decision made ABOUT the owner. This excludes the set
  /// from /browse; it does NOT affect readability by id.
  listingBlocked   Boolean        @default(false)
  /// First transition to `public`. The directory's cursor sorts on it, and a
  /// set that was published, unpublished and republished keeps its original
  /// date rather than jumping to the front of the list again.
  publishedAt      DateTime?

  /// Fork attribution. `forkedFromId` is the LIVE link and may go dark
  /// (SetNull on source delete); the two denormalized fields are captured AT
  /// FORK TIME and are what actually renders. See spec §7.3 — rendering from
  /// the FK leaks the title of a set the author has since made private.
  forkedFromId     String?
  forkedFromTitle  String?
  forkedFromHandle String?
  forkedFrom       Set?           @relation("SetForks", fields: [forkedFromId], references: [id], onDelete: SetNull)
  forks            Set[]          @relation("SetForks")
  views            SetView[]
  reports          SetReport[]
```

And add to the `@@index` block at the bottom of `model Set`:

```prisma
  @@index([visibility, listingBlocked, publishedAt])
  @@index([forkedFromId])
```

- [ ] **Step 2: Add the two new models**

Append after `model Set`:

```prisma
/// "Jump back in" — sets this user has OPENED, not sets they have studied.
///
/// An UPSERT, not an append-only log: one row per (user, set), `viewedAt`
/// overwritten. This is a navigation convenience, and real history already
/// exists in `StudySession`/`StudyEvent`. A second append-only table would be
/// a second notion of activity that can disagree with them.
///
/// NOT EVIDENCE. Nothing here reaches the learner model, mastery, or
/// `StudyEvent`.
model SetView {
  id       String   @id @default(cuid())
  userId   String
  setId    String
  viewedAt DateTime @default(now())
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  set      Set      @relation(fields: [setId], references: [id], onDelete: Cascade)

  @@unique([userId, setId])
  @@index([userId, viewedAt])
}

/// A report against a PUBLIC set.
///
/// `reason` vocabulary: REPORT_REASONS in src/lib/sets/moderation.ts. This is
/// a String column, so import that const rather than writing a literal.
///
/// `@@unique([setId, reporterId])` makes reporting idempotent — the button
/// cannot be used to flood the table.
model SetReport {
  id         String   @id @default(cuid())
  setId      String
  reporterId String?
  reason     String
  detail     String?  @db.Text
  status     String   @default("open") // open | actioned | dismissed
  createdAt  DateTime @default(now())
  set        Set      @relation(fields: [setId], references: [id], onDelete: Cascade)
  reporter   User?    @relation(fields: [reporterId], references: [id], onDelete: SetNull)

  @@unique([setId, reporterId])
  @@index([status, createdAt])
}
```

- [ ] **Step 3: Add the back-relations to `model User`**

In `model User`, alongside the other relation lists, add:

```prisma
  setViews         SetView[]
  setReports       SetReport[]
```

- [ ] **Step 4: Write the migration by hand**

Create `prisma/migrations/20260828000000_public_sets_and_discovery/migration.sql`:

```sql
-- Public sets, fork attribution, recents and moderation.
--
-- `visibility` is NOT altered here. It is already a TEXT column with a
-- 'private' default; adding 'public' to SET_VISIBILITIES is a change to the
-- application's vocabulary, not to the column. Existing rows are untouched and
-- no set becomes public as a result of this migration — which is the point:
-- collapsing `link` into `public` would publish every already-shared set on
-- deploy (spec §3).
ALTER TABLE "Set" ADD COLUMN "listingBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "forkedFromId" TEXT,
ADD COLUMN "forkedFromTitle" TEXT,
ADD COLUMN "forkedFromHandle" TEXT;

CREATE TABLE "SetView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SetReport" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SetView_userId_setId_key" ON "SetView"("userId", "setId");
CREATE INDEX "SetView_userId_viewedAt_idx" ON "SetView"("userId", "viewedAt");
CREATE UNIQUE INDEX "SetReport_setId_reporterId_key" ON "SetReport"("setId", "reporterId");
CREATE INDEX "SetReport_status_createdAt_idx" ON "SetReport"("status", "createdAt");
CREATE INDEX "Set_visibility_listingBlocked_publishedAt_idx" ON "Set"("visibility", "listingBlocked", "publishedAt");
CREATE INDEX "Set_forkedFromId_idx" ON "Set"("forkedFromId");

ALTER TABLE "SetView" ADD CONSTRAINT "SetView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetView" ADD CONSTRAINT "SetView_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetReport" ADD CONSTRAINT "SetReport_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetReport" ADD CONSTRAINT "SetReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Set" ADD CONSTRAINT "Set_forkedFromId_fkey" FOREIGN KEY ("forkedFromId") REFERENCES "Set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Regenerate the client and check for drift**

Run: `npx prisma generate`
Expected: succeeds.

> **⚠ CORRECTED 2026-08-27 after Task 1 reported it. DO NOT run the command this
> step originally carried:**
> `prisma migrate diff --from-migrations … --shadow-database-url "$DATABASE_URL"`.
> Two things were wrong with it. Prisma 7.8.0 has **removed** `--shadow-database-url`
> and renamed `--to-schema-datamodel` to `--to-schema`, so it errors out rather than
> running — which is lucky, because **had the flag still existed it would have pointed
> the shadow database at the live Neon database, and `migrate diff` RESETS the shadow
> database and replays every migration into it.** Running the plan verbatim would have
> wiped real data. A true migrations-directory diff needs `shadowDatabaseUrl` in
> `prisma.config.ts`, which is not set. Use the read-only comparison below instead.

Run: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`

This compares the **live database** to the schema rather than the migrations directory to
the schema. It is read-only and it is a weaker check — because your migration is written
but not yet applied, it necessarily re-emits your migration's own contents. What it proves
is still worth having: every statement it emits must be **byte-identical in name, type,
default and FK action** to your hand-written `migration.sql`, and it must emit **nothing
else**. Anything extra is real drift.

Expected: an **empty** migration. **One known exception**: the diff also emits `DROP INDEX "SetKltNode_ancestorIds_idx"`. That index is the GIN index hand-added in `20260826000000_klt_per_set`, which the Prisma schema cannot express, so it is reported as drift on every run. **Ignore that one line; it must NOT be added to your migration.** Any other line is real drift — fix the schema or the SQL until only that line remains.

If `$DATABASE_URL` is unavailable, skip this step and say so in your report — do not fabricate the result.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260828000000_public_sets_and_discovery
git commit -m "feat(sets): schema for public sets, fork attribution, recents and reports"
```

**Report to the parent:** whether `migrate diff` ran, and its exact output.

---

### Task 2: Three-valued visibility

**Files:**
- Modify: `src/lib/sets/visibility.ts` (whole file)
- Modify: `tests/sets/visibility.test.ts` (whole file)

**Interfaces:**
- Consumes: nothing (pure module, no Prisma import).
- Produces:
  ```ts
  export const SET_VISIBILITIES: readonly ['private', 'link', 'public']
  export type SetVisibility = 'private' | 'link' | 'public'
  export const READABLE_VISIBILITIES: Exclude<SetVisibility, 'private'>[]  // derived by filter, so not a tuple
  export function toSetVisibility(raw: string): SetVisibility
  export function canReadSet(set: { userId: string; visibility: string }, viewerId: string | null): boolean
  export function readableSetWhere(viewerId: string | null): Record<string, unknown>
  export function listableSetWhere(): Record<string, unknown>
  export function composeSetWhere(viewerId: string | null, ...clauses: Record<string, unknown>[]): Record<string, unknown>
  ```

**Other agents are editing other files concurrently. Do NOT run the full suite.**

`src/components/sets/VisibilityMenu.tsx` types its `OPTIONS` as `Record<SetVisibility, …>`, so adding `'public'` **will break `tsc` in that file**. That is expected. Task 4 owns it and fixes it in wave 2. Do not touch it.

- [ ] **Step 1: Rewrite the existing tests for three values**

Replace `tests/sets/visibility.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest'
import {
  SET_VISIBILITIES, READABLE_VISIBILITIES, toSetVisibility, canReadSet,
  readableSetWhere, listableSetWhere, composeSetWhere,
} from '@/lib/sets/visibility'

const OWNER = 'user-owner'
const OTHER = 'user-other'

describe('SET_VISIBILITIES', () => {
  it('pins the vocabulary the Prisma column documents', () => {
    expect([...SET_VISIBILITIES]).toEqual(['private', 'link', 'public'])
  })

  it('READABLE_VISIBILITIES is exactly the non-private members', () => {
    // Drift here is a silent hole: a value in SET_VISIBILITIES but not in
    // READABLE_VISIBILITIES is unreadable by anyone but its owner, and the
    // reverse makes `private` readable.
    expect([...READABLE_VISIBILITIES]).toEqual(
      SET_VISIBILITIES.filter((v) => v !== 'private'),
    )
  })
})

describe('toSetVisibility', () => {
  it('passes known values through', () => {
    for (const v of SET_VISIBILITIES) expect(toSetVisibility(v)).toBe(v)
  })

  it('FAILS CLOSED on an unrecognised value', () => {
    expect(toSetVisibility('')).toBe('private')
    expect(toSetVisibility('Link')).toBe('private')
    expect(toSetVisibility('garbage')).toBe('private')
  })

  it('NEVER degrades to public', () => {
    // The specific assertion spec §3 demands. `public` is the widest state in
    // the system; reaching it by accident is the worst outcome this module
    // has. Note this replaces an older test that asserted
    // toSetVisibility('public') === 'private' — which was correct when
    // `public` was not a member and is wrong now.
    for (const raw of ['', 'Public', 'PUBLIC', 'garbage', 'pubic', 'link ']) {
      expect(toSetVisibility(raw), raw).not.toBe('public')
    }
  })
})

describe('canReadSet', () => {
  const priv = { userId: OWNER, visibility: 'private' }
  const link = { userId: OWNER, visibility: 'link' }
  const pub = { userId: OWNER, visibility: 'public' }

  it('lets the owner read their own set in every state', () => {
    for (const s of [priv, link, pub]) expect(canReadSet(s, OWNER)).toBe(true)
  })

  it('denies another signed-in user a private set', () => {
    expect(canReadSet(priv, OTHER)).toBe(false)
  })

  it('allows another signed-in user a link-shared or public set', () => {
    expect(canReadSet(link, OTHER)).toBe(true)
    expect(canReadSet(pub, OTHER)).toBe(true)
  })

  it('denies an anonymous viewer a private set', () => {
    expect(canReadSet(priv, null)).toBe(false)
  })

  it('allows an anonymous viewer a link-shared or public set', () => {
    expect(canReadSet(link, null)).toBe(true)
    // Without this, every public set renders its media as a broken
    // placeholder: /api/assets/[id] decides through canReadSet.
    expect(canReadSet(pub, null)).toBe(true)
  })

  it('treats an unrecognised stored visibility as private', () => {
    expect(canReadSet({ userId: OWNER, visibility: 'garbage' }, OTHER)).toBe(false)
    expect(canReadSet({ userId: OWNER, visibility: 'garbage' }, OWNER)).toBe(true)
  })

  it('does not match a NULL owner against an anonymous viewer', () => {
    const malformed = { userId: null, visibility: 'private' } as unknown as {
      userId: string
      visibility: string
    }
    expect(canReadSet(malformed, null)).toBe(false)
  })
})

describe('readableSetWhere', () => {
  it('matches owned OR readable-visibility for a signed-in viewer', () => {
    expect(readableSetWhere(OWNER)).toEqual({
      OR: [{ userId: OWNER }, { visibility: { in: READABLE_VISIBILITIES } }],
    })
  })

  it('uses `in`, NOT a second OR, for an anonymous viewer', () => {
    // Spec §3.1. The naive extension would return
    // `{ OR: [{visibility:'link'}, {visibility:'public'}] }`, which turns the
    // signed-out branch into an OR too — so spreading it into the directory's
    // where (which has its own search OR) would REPLACE one of them and widen
    // the query to every set in the database, silently, while still returning
    // plausible results.
    const frag = readableSetWhere(null)
    expect(frag).toEqual({ visibility: { in: READABLE_VISIBILITIES } })
    expect(frag).not.toHaveProperty('OR')
  })

  it('has exactly one OR for a signed-in viewer and none for anonymous', () => {
    expect(Object.keys(readableSetWhere(OWNER))).toEqual(['OR'])
    expect(Object.keys(readableSetWhere(null))).toEqual(['visibility'])
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
        const frag = readableSetWhere(viewer) as {
          OR?: { userId?: string; visibility?: { in: readonly string[] } }[]
          visibility?: { in: readonly string[] }
        }
        const matchesByFragment = frag.OR
          ? frag.OR.some(
              (c) =>
                c.userId === set.userId ||
                (c.visibility?.in.includes(set.visibility) ?? false),
            )
          : (frag.visibility?.in.includes(set.visibility) ?? false)
        expect(matchesByFragment, `${viewer}/${visibility}`).toBe(canReadSet(set, viewer))
      }
    }
  })
})

describe('listableSetWhere', () => {
  it('lists only public, unblocked sets', () => {
    expect(listableSetWhere()).toEqual({ visibility: 'public', listingBlocked: false })
  })

  it('excludes link-shared sets from listing', () => {
    // link and public are NOT collapsed: they answer "may this be read?" and
    // "should this be advertised?". A learner who shared a study-group link
    // did not thereby ask to be published.
    expect(listableSetWhere()).not.toMatchObject({ visibility: 'link' })
  })
})

describe('composeSetWhere', () => {
  it('ANDs the readable fragment with every clause', () => {
    const search = { OR: [{ title: { contains: 'x' } }] }
    expect(composeSetWhere(OWNER, listableSetWhere(), search)).toEqual({
      AND: [readableSetWhere(OWNER), listableSetWhere(), search],
    })
  })

  it('keeps BOTH ORs alive rather than one replacing the other', () => {
    // THE test for spec §3.1's defect. Spreading readableSetWhere(OWNER) and a
    // search OR into one object leaves exactly one OR key; composing must
    // leave two, in separate AND members.
    const search = { OR: [{ title: { contains: 'x' } }] }
    const composed = composeSetWhere(OWNER, search) as { AND: Record<string, unknown>[] }
    const orCount = composed.AND.filter((c) => 'OR' in c).length
    expect(orCount).toBe(2)

    const spreadInstead = { ...readableSetWhere(OWNER), ...search }
    expect(Object.keys(spreadInstead).filter((k) => k === 'OR')).toHaveLength(1)
  })

  it('never produces an empty AND', () => {
    const composed = composeSetWhere(null) as { AND: Record<string, unknown>[] }
    expect(composed.AND.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sets/visibility.test.ts`
Expected: FAIL — `READABLE_VISIBILITIES`, `listableSetWhere`, `composeSetWhere` are not exported, and the vocabulary assertion fails.

- [ ] **Step 3: Rewrite the module**

Replace the body of `src/lib/sets/visibility.ts` below its existing top-of-file doc comment. Update that comment's final paragraph (currently "Two states only. There is no public directory and no discovery…") to:

```ts
/**
 * Three states. `private` is owner-only; `link` means "anyone holding the id
 * may read it, and it is listed NOWHERE"; `public` means readable AND listed
 * in /browse.
 *
 * `link` and `public` are deliberately NOT collapsed. They answer different
 * questions — "may this be read?" and "should this be advertised?" — and a
 * learner who shared a study-group link did not thereby ask to be published.
 * Collapsing them would silently publish every already-shared set on deploy.
 */
export const SET_VISIBILITIES = ['private', 'link', 'public'] as const

export type SetVisibility = (typeof SET_VISIBILITIES)[number]

/**
 * The visibilities that are readable by someone who is not the owner.
 *
 * Derived by exclusion rather than written out, so adding a fourth visibility
 * cannot leave this list silently stale — the one way this module goes wrong
 * without any test noticing.
 */
export const READABLE_VISIBILITIES = SET_VISIBILITIES.filter(
  (v): v is Exclude<SetVisibility, 'private'> => v !== 'private',
)
```

Keep `toSetVisibility` and `canReadSet` **exactly as they are** — `canReadSet` needs one change:

```ts
export function canReadSet(
  set: { userId: string; visibility: string },
  viewerId: string | null,
): boolean {
  if (viewerId !== null && set.userId === viewerId) return true
  // `!== 'private'` rather than `=== 'link'`. Written positively against the
  // readable list, this is the one line that has to change every time a
  // visibility is added; written negatively it never does.
  return toSetVisibility(set.visibility) !== 'private'
}
```

Replace `readableSetWhere` and add the two new functions:

```ts
export function readableSetWhere(viewerId: string | null): Record<string, unknown> {
  // `in`, NOT a second OR. Making this branch an OR would give BOTH branches
  // the replace-my-OR hazard at exactly the moment the directory arrives as
  // the first call site with an OR of its own. See spec §3.1.
  const readable = { visibility: { in: READABLE_VISIBILITIES } }
  if (viewerId === null) return readable
  return { OR: [{ userId: viewerId }, readable] }
}

/**
 * A Prisma `where` fragment for "sets that may be ADVERTISED in the directory".
 *
 * Separate from `readableSetWhere` because listing and reading are different
 * questions. `listingBlocked` is an OPERATOR decision (spec §10) and is
 * checked here rather than in `readableSetWhere` on purpose: an unlisted set
 * stays readable by anyone holding its id — moderation removes it from the
 * shop window, it does not retroactively break every link already shared.
 *
 * ALWAYS compose this with `readableSetWhere` via `composeSetWhere`, never
 * alone. `visibility: 'public'` looks like it makes the readable fragment
 * redundant; the day someone adds "also show my own private sets here" is the
 * day a hand-rolled filter leaks and a composed one does not.
 */
export function listableSetWhere(): Record<string, unknown> {
  return { visibility: 'public', listingBlocked: false }
}

/**
 * Compose the readable fragment with additional clauses under an explicit
 * `AND`.
 *
 * THE REASON THIS EXISTS: `readableSetWhere` returns a bare `OR` for a
 * signed-in viewer, and JavaScript object spread makes a second `OR` REPLACE
 * it rather than combine with it. The directory's title/description search is
 * an `OR`. Spreading both at one level widens the query to every set in the
 * database — and it still returns plausible-looking results while doing it,
 * which is why the failure cannot be caught by looking at the page.
 *
 * Use this for every set read that carries a predicate of its own. A read with
 * nothing but an id may still spread the fragment directly.
 */
export function composeSetWhere(
  viewerId: string | null,
  ...clauses: Record<string, unknown>[]
): Record<string, unknown> {
  return { AND: [readableSetWhere(viewerId), ...clauses] }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sets/visibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the regression guards you might have broken**

Run: `npx vitest run tests/sets/visibility-enforcement.test.ts tests/api`
Expected: PASS. These read the *source* of call sites, not their behaviour, so they should be unaffected — but `canReadSet`'s change is what makes public assets fetchable and `tests/api` is where that lives.

- [ ] **Step 6: Mutation-test the `in` fix**

Temporarily change `readableSetWhere`'s anonymous branch to `{ OR: READABLE_VISIBILITIES.map((v) => ({ visibility: v })) }`.

Run: `npx vitest run tests/sets/visibility.test.ts`
Expected: **FAIL** on "uses `in`, NOT a second OR". If it passes, the test is not protecting anything — fix the test, not the implementation. **Revert the mutation before continuing.**

- [ ] **Step 7: Commit**

```bash
git add src/lib/sets/visibility.ts tests/sets/visibility.test.ts
git commit -m "feat(sets): three-valued visibility with in-based readable fragment"
```

**Report to the parent:** the mutation-test result, and every file outside your ownership that `tsc` now complains about.

---

### Task 3: The Instrument chassis

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/components/ui/section.tsx`
- Create: `src/components/ui/metric.tsx`
- Create: `tests/components/instrument-chassis.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // section.tsx
  export function Section(p: { children: React.ReactNode; className?: string }): JSX.Element
  export function SectionHeader(p: { title: string; hint?: string; action?: React.ReactNode; className?: string }): JSX.Element
  export function SectionBody(p: { children: React.ReactNode; className?: string }): JSX.Element
  // metric.tsx
  export function Metric(p: { value: number | null; unit?: string; label: string; emptyLabel?: string; className?: string }): JSX.Element
  ```

**You own `src/app/globals.css` exclusively. No other task touches it.** Scope: tokens + type scale + two primitives. **Do NOT** remove shadcn, delete `Card`, convert existing pages, or touch lint problems.

- [ ] **Step 1: Write the failing test**

Create `tests/components/instrument-chassis.test.tsx`. **Its first line must be the jsdom docblock** — vitest 4 does not honour `environmentMatchGlobs` in this repo (see `vitest.config.ts`), so each `.test.tsx` opts in per-file:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { Metric } from '@/components/ui/metric'

describe('Section', () => {
  it('renders a titled, ruled section with its body', () => {
    render(
      <Section>
        <SectionHeader title="Jump back in" hint="3 sets" />
        <SectionBody>content</SectionBody>
      </Section>,
    )
    expect(screen.getByRole('heading', { name: 'Jump back in' })).toBeInTheDocument()
    expect(screen.getByText('3 sets')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders an action slot when given one', () => {
    render(
      <Section>
        <SectionHeader title="Your sets" action={<a href="/sets">See all</a>} />
        <SectionBody>x</SectionBody>
      </Section>,
    )
    expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument()
  })
})

describe('Metric', () => {
  it('renders a value with its unit and label', () => {
    render(<Metric value={12} unit="cards" label="Due" />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('cards')).toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
  })

  it('renders an em dash for null, NEVER a zero', () => {
    // Null-is-not-zero, the rule `SetStudySummary.averageConfidence` and
    // `LearnerTopicProfile.knowledge` already follow: 0 reads as "you know
    // none of this" on a set nobody has opened, which is a different and
    // false claim from "no evidence yet".
    render(<Metric value={null} label="Confidence" />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('uses an overridable empty label', () => {
    render(<Metric value={null} label="Confidence" emptyLabel="not studied" />)
    expect(screen.getByText('not studied')).toBeInTheDocument()
  })

  it('carries tabular figures so columns do not reflow', () => {
    const { container } = render(<Metric value={1234} label="Cards" />)
    expect(container.querySelector('.metric')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/instrument-chassis.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/section`.

- [ ] **Step 3: Create `src/components/ui/section.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A ruled section — the Instrument chassis's replacement for a shadcn `Card`
 * on list and detail surfaces.
 *
 * A hairline top rule and open space, not a bordered box with elevation. The
 * app's grid-of-shadowed-cards look is what makes it read as generic; a
 * broadsheet separates sections with rules and typography instead, which
 * carries hierarchy without drawing a container around every idea.
 *
 * `Card` is NOT deleted and remains correct where a thing really is a discrete
 * object you click (a set in a grid). This is for the containers AROUND those.
 */
export function Section({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('border-t border-border pt-4 mt-10 first:mt-0', className)}>
      {children}
    </section>
  )
}

export function SectionHeader({
  title,
  hint,
  action,
  className,
}: {
  title: string
  /** A short count or qualifier. Sits with the title, never below it. */
  hint?: string
  /** Right-aligned affordance — "See all", a filter, a menu. */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 mb-4', className)}>
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className="font-heading text-xl tracking-tight truncate">{title}</h2>
        {hint && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">{hint}</span>
        )}
      </div>
      {action && <div className="shrink-0 text-sm">{action}</div>}
    </div>
  )
}

export function SectionBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn(className)}>{children}</div>
}
```

- [ ] **Step 4: Create `src/components/ui/metric.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * One figure with its label.
 *
 * NULL IS NOT ZERO, and this component exists mainly to enforce that. A `0`
 * where there is no evidence reads as "you know none of this" — a different
 * and false claim from "nobody has measured this yet". The same rule already
 * governs `SetStudySummary.averageConfidence` and
 * `LearnerTopicProfile.knowledge`; scattering the ternary across every caller
 * is how one of them eventually renders the zero.
 *
 * The figure carries `.metric` (font-mono + tabular-nums, defined in
 * globals.css) so a column of values never reflows as they change.
 */
export function Metric({
  value,
  unit,
  label,
  emptyLabel = '—',
  className,
}: {
  value: number | null
  unit?: string
  label: string
  /** What to show instead of a figure when `value` is null. */
  emptyLabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <div className="flex items-baseline gap-1.5">
        {value === null ? (
          <span className="text-muted-foreground text-lg">{emptyLabel}</span>
        ) : (
          <>
            <span className="metric text-2xl leading-none">{value}</span>
            {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
          </>
        )}
      </div>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/components/instrument-chassis.test.tsx`
Expected: PASS.

- [ ] **Step 6: Apply the chassis tokens to `globals.css`**

In `:root`, change these three values only (dark mode's `--border`/`--input` already use alpha and stay as they are):

```css
  /* Hairline. Was oklch(0.910 0 0) — a visible grey box around everything.
     A rule you can barely see still separates; a rule you can see contains. */
  --border: oklch(0.935 0 0);
  --input: oklch(0.900 0 0);

  /* Was 0.625rem. The Instrument chassis is ruled and typographic, and a
     generous corner radius is the single strongest "SaaS card" signal in the
     whole token set. */
  --radius: 0.375rem;
```

In `.dark`, change:

```css
  --border: oklch(1 0 0 / 9%);
```

Then, in `@layer base`, replace the existing `h1, h2, h3` block with a real display scale:

```css
  /* Hierarchy comes from a change of VOICE, not only of size. Page and section
     titles take the display serif; everything else stays in Plex Sans.
     `text-wrap: balance` on headings so a two-line title breaks evenly rather
     than leaving one orphaned word — the cheapest typographic tell there is. */
  h1,
  h2,
  h3 {
    @apply font-heading;
    font-optical-sizing: auto;
    text-wrap: balance;
  }

  /* The display size. Fraunces is loaded and, before this, was never used
     above text-3xl anywhere in the app — so the one face chosen to give the
     product a voice was whispering. Page titles opt in with `.display`. */
  .display {
    @apply font-heading tracking-tight;
    font-size: clamp(2rem, 1.4rem + 2.2vw, 3.25rem);
    line-height: 1.04;
    font-optical-sizing: auto;
    font-variation-settings: 'SOFT' 0, 'WONK' 1;
    text-wrap: balance;
  }

  /* A standfirst under a display title. */
  .lede {
    @apply text-muted-foreground;
    font-size: 1.0625rem;
    line-height: 1.55;
    max-width: 62ch;
  }

  /* Small caps-ish label for column heads and metric labels. */
  .label {
    @apply text-xs uppercase tracking-wider text-muted-foreground;
  }
```

Leave the existing `.metric` rule exactly as it is.

- [ ] **Step 7: Verify the app still builds and nothing regressed visually at the token level**

Run: `npx vitest run tests/components`
Expected: PASS (existing component tests must not break — you changed only token *values* and added new classes).

Run: `npx tsc --noEmit 2>&1 | grep -E "section.tsx|metric.tsx" || echo "no chassis type errors"`
Expected: `no chassis type errors`. (Other files may error from Task 2's concurrent change — that is not yours.)

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/components/ui/section.tsx src/components/ui/metric.tsx tests/components/instrument-chassis.test.tsx
git commit -m "feat(ui): Instrument chassis — display scale, hairline rules, Section and Metric"
```

**Report to the parent:** whether `font-variation-settings` is valid for the loaded Fraunces (check `src/app/layout.tsx` for how it is loaded — if it is not a variable font, drop that line and say so).

---

## ⛔ PARENT CHECKPOINT — after Wave 1

Run all four, in this order, and fix before dispatching Wave 2:

```bash
npm test
npx tsc --noEmit
npm run lint
npx next build
```

Expected: tests ≥ 1790 + the new ones; `tsc` clean **except** `src/components/sets/VisibilityMenu.tsx` (Task 4 fixes it — if anything else errors, dispatch a fix before proceeding); lint 175 problems.

---

# WAVE 2

---

### Task 4: The publishing gate & VisibilityMenu

**Files:**
- Modify: `src/actions/sets.ts` (`setSetVisibility`, ~line 410-442)
- Modify: `src/components/sets/VisibilityMenu.tsx`
- Create: `tests/actions/set-visibility-publish.test.ts`

**Interfaces:**
- Consumes: `SET_VISIBILITIES`, `SetVisibility`, `toSetVisibility` (Task 2).
- Produces: `setSetVisibility(setId: string, visibility: string): Promise<ActionResult<{ visibility: SetVisibility }>>` — unchanged signature; new failure `'handle_required'`.

**This task is the one that unbreaks `tsc`.** Task 2 added `'public'` to `SetVisibility`, and `VisibilityMenu`'s `OPTIONS: Record<SetVisibility, …>` is now missing a key.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/set-visibility-publish.test.ts`. Follow the in-memory-Prisma-fake pattern from `tests/actions/klt-tree.test.ts` — everything inside one `vi.hoisted` block, because `vi.mock` factories hoist above every other top-level statement:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    userId: 'u1' as string | null,
    sets: [] as { id: string; userId: string; visibility: string; publishedAt: Date | null }[],
    users: [] as { id: string; handle: string | null }[],
  }
  return {
    state,
    db: {
      set: {
        updateMany: vi.fn(async ({ where, data }: never) => {
          const w = where as { id: string; userId: string }
          const d = data as Record<string, unknown>
          const rows = state.sets.filter((s) => s.id === w.id && s.userId === w.userId)
          for (const r of rows) Object.assign(r, d)
          return { count: rows.length }
        }),
        findFirst: vi.fn(async ({ where }: never) => {
          const w = where as { id: string; userId: string }
          return state.sets.find((s) => s.id === w.id && s.userId === w.userId) ?? null
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: never) => {
          const w = where as { id: string }
          return state.users.find((u) => u.id === w.id) ?? null
        }),
      },
    },
  }
})

vi.mock('@/lib/db', () => ({ prisma: h.db }))
vi.mock('@/auth', () => ({
  auth: async () => (h.state.userId ? { user: { id: h.state.userId } } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setSetVisibility } from '@/actions/sets'

beforeEach(() => {
  h.state.userId = 'u1'
  h.state.sets = [{ id: 's1', userId: 'u1', visibility: 'private', publishedAt: null }]
  h.state.users = [{ id: 'u1', handle: null }]
})

describe('setSetVisibility', () => {
  it('allows private and link with no handle', async () => {
    for (const v of ['link', 'private'] as const) {
      const res = await setSetVisibility('s1', v)
      expect(res.success, v).toBe(true)
    }
  })

  it('REFUSES public when the owner has no handle', async () => {
    // Spec §3.3: /browse credits creators by handle, and a directory row with
    // no author is not shippable. This is the only act in the app that needs a
    // public identity — which is why handles stay optional everywhere else.
    const res = await setSetVisibility('s1', 'public')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toMatch(/handle/i)
    expect(h.state.sets[0].visibility).toBe('private')
  })

  it('allows public once a handle exists', async () => {
    h.state.users[0].handle = 'alice'
    const res = await setSetVisibility('s1', 'public')
    expect(res.success).toBe(true)
    expect(h.state.sets[0].visibility).toBe('public')
  })

  it('stamps publishedAt on the FIRST publish only', async () => {
    h.state.users[0].handle = 'alice'
    await setSetVisibility('s1', 'public')
    const first = h.state.sets[0].publishedAt
    expect(first).toBeInstanceOf(Date)

    await setSetVisibility('s1', 'link')
    await setSetVisibility('s1', 'public')
    // Republishing must not jump the set back to the front of the directory,
    // which sorts on publishedAt.
    expect(h.state.sets[0].publishedAt).toEqual(first)
  })

  it('rejects an unrecognised value rather than coercing it', async () => {
    const res = await setSetVisibility('s1', 'pubic')
    expect(res.success).toBe(false)
    expect(h.state.sets[0].visibility).toBe('private')
  })

  it('reports not-found for another user’s set', async () => {
    h.state.userId = 'u2'
    h.state.users.push({ id: 'u2', handle: 'bob' })
    const res = await setSetVisibility('s1', 'public')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toMatch(/not found/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/actions/set-visibility-publish.test.ts`
Expected: FAIL — public is accepted with no handle, and `publishedAt` is never set.

- [ ] **Step 3: Implement the gate in `src/actions/sets.ts`**

Replace the body of `setSetVisibility` between the `parsed` check and the `updateMany`:

```ts
    // Publishing is the ONE act that needs a public identity, because /browse
    // credits creators by handle and a directory row with no author is not
    // shippable. `private` and `link` never require one — which is what keeps
    // handles optional for everyone who never publishes.
    if (parsed === 'public') {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { handle: true },
      })
      if (!user?.handle) {
        return {
          success: false,
          error: 'Choose a handle before publishing — it is how you are credited in Browse.',
        }
      }
    }

    // Read the current row before writing, so `publishedAt` can be stamped on
    // the FIRST publish only. The directory's cursor sorts on it; refreshing
    // it on every republish would let an owner jump to the front of Browse by
    // toggling visibility twice.
    const existing = await prisma.set.findFirst({
      where: { id: setId, userId: session.user.id },
      select: { publishedAt: true },
    })

    const data: { visibility: SetVisibility; publishedAt?: Date } = { visibility: parsed }
    if (parsed === 'public' && existing && existing.publishedAt === null) {
      data.publishedAt = new Date()
    }

    const updated = await prisma.set.updateMany({
      where: { id: setId, userId: session.user.id },
      data,
    })
```

Then extend the revalidation below it (the set is now listed somewhere new):

```ts
    revalidatePath(`/sets/${setId}`)
    revalidatePath('/sets')
    revalidatePath('/browse')
    revalidatePath('/')
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/actions/set-visibility-publish.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `public` option to `VisibilityMenu`**

In `src/components/sets/VisibilityMenu.tsx`, add the third entry to `OPTIONS`:

```tsx
  public: {
    trigger: 'Public',
    label: 'Anyone, and listed in Browse',
    hint: 'Listed publicly and credited to your handle. Anyone can study it or make their own copy.',
  },
```

The action can now fail with a handle message. Surface it rather than swallowing it — find where the component handles a failed `setSetVisibility` result and make sure the error string is shown in the toast (it is `res.error`), and add a link to `/account` when it mentions a handle:

```tsx
        if (!res.success) {
          const needsHandle = /handle/i.test(res.error)
          toast.error(res.error, needsHandle ? {
            action: { label: 'Choose one', onClick: () => { window.location.href = '/account' } },
          } : undefined)
          return
        }
```

- [ ] **Step 6: Verify `tsc` is clean for this file**

Run: `npx tsc --noEmit 2>&1 | grep VisibilityMenu || echo "VisibilityMenu clean"`
Expected: `VisibilityMenu clean`.

Run: `npx vitest run tests/actions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/actions/sets.ts src/components/sets/VisibilityMenu.tsx tests/actions/set-visibility-publish.test.ts
git commit -m "feat(sets): publishing requires a handle, and publishedAt stamps once"
```

---

### Task 5: SetView — "jump back in"

**Files:**
- Create: `src/lib/sets/recents.ts`
- Create: `tests/sets/recents.test.ts`
- Modify: `src/app/sets/[id]/page.tsx` (add the `after()` write only — do NOT restructure this page)

**Interfaces:**
- Consumes: `readableSetWhere` (Task 2).
- Produces:
  ```ts
  export const RECENTS_LIMIT = 8
  export interface RecentSet {
    id: string; title: string; description: string | null
    cardCount: number; visibility: string
    ownerHandle: string | null; isOwn: boolean; viewedAt: Date
  }
  export function recordSetView(userId: string, setId: string): Promise<void>
  export function loadRecentSets(userId: string, limit?: number): Promise<RecentSet[]>
  export function shapeRecents(rows: RecentRow[], viewerId: string): RecentSet[]
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/sets/recents.test.ts`. Only the **pure** shaping function is tested — the DB shell follows `getLearnerMetrics`' precedent and stays untested:

```ts
import { describe, it, expect } from 'vitest'
import { shapeRecents, RECENTS_LIMIT, type RecentRow } from '@/lib/sets/recents'

const row = (over: Partial<RecentRow> = {}): RecentRow => ({
  viewedAt: new Date('2026-08-27T10:00:00Z'),
  set: {
    id: 's1',
    title: 'Merger Model',
    description: null,
    visibility: 'link',
    userId: 'owner',
    user: { handle: 'alice' },
    _count: { cards: 12 },
  },
  ...over,
})

describe('shapeRecents', () => {
  it('flattens a joined row into a RecentSet', () => {
    const [r] = shapeRecents([row()], 'viewer')
    expect(r).toEqual({
      id: 's1',
      title: 'Merger Model',
      description: null,
      cardCount: 12,
      visibility: 'link',
      ownerHandle: 'alice',
      isOwn: false,
      viewedAt: new Date('2026-08-27T10:00:00Z'),
    })
  })

  it('marks the viewer’s own set', () => {
    const [r] = shapeRecents([row({ set: { ...row().set, userId: 'viewer' } })], 'viewer')
    expect(r.isOwn).toBe(true)
  })

  it('carries a null handle rather than inventing one', () => {
    // User.name is the OAuth provider's REAL-NAME field and must never reach a
    // surface where it can be read as a public credit. No handle means no
    // credit line, not a fallback to a real name.
    const [r] = shapeRecents([row({ set: { ...row().set, user: { handle: null } } })], 'viewer')
    expect(r.ownerHandle).toBeNull()
  })

  it('preserves input order', () => {
    // The query orders by viewedAt desc; re-sorting here would be a second
    // notion of recency that can disagree with the index the query uses.
    const out = shapeRecents(
      [row({ set: { ...row().set, id: 'a' } }), row({ set: { ...row().set, id: 'b' } })],
      'viewer',
    )
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('returns an empty array for no rows', () => {
    expect(shapeRecents([], 'viewer')).toEqual([])
  })
})

describe('RECENTS_LIMIT', () => {
  it('is small enough to be one scannable strip', () => {
    expect(RECENTS_LIMIT).toBeGreaterThan(0)
    expect(RECENTS_LIMIT).toBeLessThanOrEqual(12)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sets/recents.test.ts`
Expected: FAIL — cannot resolve `@/lib/sets/recents`.

- [ ] **Step 3: Create `src/lib/sets/recents.ts`**

```ts
import { readableSetWhere } from '@/lib/sets/visibility'

/** How many sets the homepage strip shows. One row, no pagination. */
export const RECENTS_LIMIT = 8

export interface RecentRow {
  viewedAt: Date
  set: {
    id: string
    title: string
    description: string | null
    visibility: string
    userId: string
    user: { handle: string | null }
    _count: { cards: number }
  }
}

export interface RecentSet {
  id: string
  title: string
  description: string | null
  cardCount: number
  visibility: string
  /**
   * The creator's public handle, or null.
   *
   * NEVER falls back to `User.name` — that field comes from the OAuth provider
   * and is usually a real full name. No handle means no credit line.
   */
  ownerHandle: string | null
  isOwn: boolean
  viewedAt: Date
}

/**
 * Flatten joined rows. Pure, so the null-handle rule and the ownership flag
 * are tested without a database — the two places this quietly goes wrong.
 *
 * Deliberately does NOT re-sort. The query orders by `viewedAt desc` against
 * the `[userId, viewedAt]` index; re-sorting here would be a second notion of
 * recency that can disagree with it.
 */
export function shapeRecents(rows: RecentRow[], viewerId: string): RecentSet[] {
  return rows.map((r) => ({
    id: r.set.id,
    title: r.set.title,
    description: r.set.description,
    cardCount: r.set._count.cards,
    visibility: r.set.visibility,
    ownerHandle: r.set.user.handle,
    isOwn: r.set.userId === viewerId,
    viewedAt: r.viewedAt,
  }))
}

/**
 * Stamp that this user opened this set.
 *
 * An UPSERT — one row per (user, set). This is a "jump back in" list, not
 * history; `StudySession` already carries real history and a second
 * append-only table would be a second notion of activity that can disagree
 * with it.
 *
 * CALL THIS FROM `after()`, never during a Server Component's render. Writing
 * during render is unsafe under caching and PPR, and this write must never be
 * able to fail the page: a recents row is worth strictly less than the set the
 * reader came for. It therefore swallows its own errors.
 *
 * NOT EVIDENCE. Nothing here reaches the learner model, mastery or StudyEvent.
 */
export async function recordSetView(userId: string, setId: string): Promise<void> {
  const { prisma } = await import('@/lib/db')
  try {
    await prisma.setView.upsert({
      where: { userId_setId: { userId, setId } },
      create: { userId, setId },
      update: { viewedAt: new Date() },
    })
  } catch (error) {
    console.error('recordSetView failed', { setId, error })
  }
}

/**
 * The sets this user most recently opened, re-authorized at read time.
 *
 * `readableSetWhere` is applied HERE and not merely at write time on purpose:
 * a set you viewed and that its owner later made private must disappear from
 * your homepage, and the only way to guarantee that is to re-ask the question
 * on every read rather than trusting a stored row.
 */
export async function loadRecentSets(
  userId: string,
  limit: number = RECENTS_LIMIT,
): Promise<RecentSet[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.setView.findMany({
    where: { userId, set: readableSetWhere(userId) },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: {
      viewedAt: true,
      set: {
        select: {
          id: true, title: true, description: true, visibility: true, userId: true,
          user: { select: { handle: true } },
          _count: { select: { cards: true } },
        },
      },
    },
  })
  return shapeRecents(rows as RecentRow[], userId)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sets/recents.test.ts`
Expected: PASS.

- [ ] **Step 5: Record the view from the set page**

In `src/app/sets/[id]/page.tsx`, add the imports:

```ts
import { after } from 'next/server'
import { recordSetView } from '@/lib/sets/recents'
```

and immediately after the existing `if (!set) notFound()` line, add:

```ts
  // AFTER the notFound guard, so a probe for a set id that does not exist (or
  // that this viewer may not read) never writes a row — which would make the
  // recents table a record of what someone guessed at.
  //
  // In `after()` rather than inline: writing during a Server Component's
  // render is unsafe under caching and PPR, and a recents row must never be
  // able to fail the page. Same pattern as KLP extraction.
  if (session?.user?.id) {
    const viewerId = session.user.id
    after(() => recordSetView(viewerId, set.id))
  }
```

Change **nothing else on this page.** Task 5 does not restructure it.

- [ ] **Step 6: Verify the page still type-checks and its guard test still passes**

Run: `npx tsc --noEmit 2>&1 | grep "sets/\[id\]/page" || echo "set page clean"`
Expected: `set page clean`.

Run: `npx vitest run tests/sets/visibility-enforcement.test.ts`
Expected: PASS — the page must still contain `readableSetWhere` and no `prisma.set.findUnique`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sets/recents.ts tests/sets/recents.test.ts "src/app/sets/[id]/page.tsx"
git commit -m "feat(sets): record set views and load a recents strip"
```

---

### Task 6: Fork size caps (pure)

**Files:**
- Create: `src/lib/sets/fork.ts`
- Create: `tests/sets/fork.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const FORK_MAX_CARDS = 1000
  export const FORK_ASSET_BUDGET_BYTES = 104857600
  export interface ForkSizeInput { cardCount: number; assetSizes: number[] }
  export type ForkSizeVerdict =
    | { ok: true; totalAssetBytes: number }
    | { ok: false; reason: 'too_many_cards' | 'assets_too_large'; limit: number; actual: number }
  export function checkForkSize(input: ForkSizeInput): ForkSizeVerdict
  export function describeForkRefusal(v: Extract<ForkSizeVerdict, { ok: false }>): string
  ```

**Pure module. No Prisma, no `@vercel/blob`, no imports from `@/lib/db`.** Task 9 builds the action on top of it.

- [ ] **Step 1: Write the failing test**

Create `tests/sets/fork.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  checkForkSize, describeForkRefusal, FORK_MAX_CARDS, FORK_ASSET_BUDGET_BYTES,
} from '@/lib/sets/fork'

describe('checkForkSize', () => {
  it('allows an ordinary set', () => {
    const v = checkForkSize({ cardCount: 84, assetSizes: [1_000_000, 2_000_000] })
    expect(v).toEqual({ ok: true, totalAssetBytes: 3_000_000 })
  })

  it('allows a set with no assets at all', () => {
    expect(checkForkSize({ cardCount: 10, assetSizes: [] })).toEqual({
      ok: true, totalAssetBytes: 0,
    })
  })

  it('allows exactly the card limit', () => {
    // `>` not `>=`. A set at exactly the limit is within it, and off-by-one
    // here is a refusal the user cannot act on.
    expect(checkForkSize({ cardCount: FORK_MAX_CARDS, assetSizes: [] }).ok).toBe(true)
  })

  it('refuses one card over the limit, naming the numbers', () => {
    const v = checkForkSize({ cardCount: FORK_MAX_CARDS + 1, assetSizes: [] })
    expect(v).toEqual({
      ok: false, reason: 'too_many_cards', limit: FORK_MAX_CARDS, actual: FORK_MAX_CARDS + 1,
    })
  })

  it('allows exactly the asset budget', () => {
    expect(checkForkSize({ cardCount: 1, assetSizes: [FORK_ASSET_BUDGET_BYTES] }).ok).toBe(true)
  })

  it('refuses one byte over the asset budget', () => {
    const v = checkForkSize({ cardCount: 1, assetSizes: [FORK_ASSET_BUDGET_BYTES + 1] })
    expect(v).toEqual({
      ok: false,
      reason: 'assets_too_large',
      limit: FORK_ASSET_BUDGET_BYTES,
      actual: FORK_ASSET_BUDGET_BYTES + 1,
    })
  })

  it('sums many assets rather than checking each', () => {
    const half = FORK_ASSET_BUDGET_BYTES / 2
    const v = checkForkSize({ cardCount: 1, assetSizes: [half, half, 1] })
    expect(v.ok).toBe(false)
  })

  it('checks cards BEFORE assets', () => {
    // Both gates fail here. Cards is the cheaper fact and the one the user can
    // most easily act on, so it is the one reported.
    const v = checkForkSize({
      cardCount: FORK_MAX_CARDS + 1,
      assetSizes: [FORK_ASSET_BUDGET_BYTES + 1],
    })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('too_many_cards')
  })

  it('ignores negative or non-finite sizes rather than trusting them', () => {
    // sizeBytes comes from an upload path; a bad row must not be able to buy
    // budget back for a genuinely oversized set.
    const v = checkForkSize({ cardCount: 1, assetSizes: [-5, NaN, 1000] })
    expect(v).toEqual({ ok: true, totalAssetBytes: 1000 })
  })
})

describe('describeForkRefusal', () => {
  it('names the card limit and the actual count', () => {
    const msg = describeForkRefusal({
      ok: false, reason: 'too_many_cards', limit: 1000, actual: 1500,
    })
    expect(msg).toContain('1,500')
    expect(msg).toContain('1,000')
  })

  it('reports asset sizes in MB, not bytes', () => {
    // "this set is too large" with no number is not actionable, and
    // 104857600 is not a number anybody reads.
    const msg = describeForkRefusal({
      ok: false, reason: 'assets_too_large', limit: 104857600, actual: 157286400,
    })
    expect(msg).toContain('150 MB')
    expect(msg).toContain('100 MB')
    expect(msg).not.toContain('104857600')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sets/fork.test.ts`
Expected: FAIL — cannot resolve `@/lib/sets/fork`.

- [ ] **Step 3: Create `src/lib/sets/fork.ts`**

```ts
/**
 * Fork size gates.
 *
 * Forking duplicates every blob (spec §7.2 — sharing an asset row makes
 * `/api/assets/[id]` non-deterministic, because it resolves permission through
 * `contentBlocks[0]` with `take: 1`). That makes forking a genuinely expensive
 * operation, so it needs a bound.
 *
 * Pure and dependency-free, so the arithmetic is tested without a database —
 * the repo convention that the risky arithmetic is always unit-testable. The
 * gates are checked BEFORE any blob copy begins, so a refusal costs nothing.
 */

/** Cards in the source set. */
export const FORK_MAX_CARDS = 1000

/**
 * Summed `CardAsset.sizeBytes` reachable from the set's content blocks.
 *
 * 100 MB, chosen against the per-file caps in `src/actions/uploads.ts`
 * (image 10 / audio 25 / video 25 MB): roughly four videos or ten images,
 * which is a generous real set and a bounded copy.
 */
export const FORK_ASSET_BUDGET_BYTES = 100 * 1024 * 1024

export interface ForkSizeInput {
  cardCount: number
  /** One entry per asset reachable from the set. May contain junk; see below. */
  assetSizes: number[]
}

export type ForkSizeVerdict =
  | { ok: true; totalAssetBytes: number }
  | {
      ok: false
      reason: 'too_many_cards' | 'assets_too_large'
      limit: number
      actual: number
    }

export function checkForkSize({ cardCount, assetSizes }: ForkSizeInput): ForkSizeVerdict {
  // Cards first: it is the cheaper fact and the one a user can most easily act
  // on, so when both gates fail it is the one reported.
  if (cardCount > FORK_MAX_CARDS) {
    return { ok: false, reason: 'too_many_cards', limit: FORK_MAX_CARDS, actual: cardCount }
  }

  // `sizeBytes` arrives from an upload path. A negative or NaN row must not be
  // able to buy budget back for a genuinely oversized set.
  const totalAssetBytes = assetSizes.reduce(
    (sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0),
    0,
  )

  if (totalAssetBytes > FORK_ASSET_BUDGET_BYTES) {
    return {
      ok: false,
      reason: 'assets_too_large',
      limit: FORK_ASSET_BUDGET_BYTES,
      actual: totalAssetBytes,
    }
  }

  return { ok: true, totalAssetBytes }
}

const MB = 1024 * 1024
const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`

/**
 * A refusal that names which gate failed and by how much.
 *
 * "This set is too large" with no number is not actionable, and raw bytes are
 * not a number anybody reads.
 */
export function describeForkRefusal(
  v: Extract<ForkSizeVerdict, { ok: false }>,
): string {
  if (v.reason === 'too_many_cards') {
    return `This set has ${v.actual.toLocaleString('en-US')} cards, and copies are limited to ${v.limit.toLocaleString('en-US')}.`
  }
  return `This set's media comes to ${mb(v.actual)}, and copies are limited to ${mb(v.limit)}.`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sets/fork.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-test the boundary**

Change `if (cardCount > FORK_MAX_CARDS)` to `>=`.

Run: `npx vitest run tests/sets/fork.test.ts`
Expected: **FAIL** on "allows exactly the card limit". **Revert.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/sets/fork.ts tests/sets/fork.test.ts
git commit -m "feat(sets): fork size gates as tested pure arithmetic"
```

---

### Task 7: Moderation vocabulary & report action

**Files:**
- Create: `src/lib/sets/moderation.ts`
- Create: `src/actions/set-reports.ts`
- Create: `src/components/sets/ReportSetDialog.tsx`
- Create: `tests/sets/moderation.test.ts`

**Interfaces:**
- Consumes: `isKltEditor` from `@/lib/klt/editors` (Task 7 does not modify it).
- Produces:
  ```ts
  // moderation.ts
  export const REPORT_REASONS: readonly ['spam', 'abusive', 'copyright', 'misleading', 'other']
  export type ReportReason = (typeof REPORT_REASONS)[number]
  export function toReportReason(raw: string): ReportReason | null
  export const REPORT_REASON_LABELS: Record<ReportReason, string>
  // set-reports.ts
  export function reportSet(setId: string, reason: string, detail?: string): Promise<ActionResult<void>>
  export function setListingBlocked(setId: string, blocked: boolean): Promise<ActionResult<void>>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/sets/moderation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  REPORT_REASONS, REPORT_REASON_LABELS, toReportReason,
} from '@/lib/sets/moderation'

describe('REPORT_REASONS', () => {
  it('is a closed vocabulary', () => {
    expect([...REPORT_REASONS]).toEqual([
      'spam', 'abusive', 'copyright', 'misleading', 'other',
    ])
  })

  it('labels every reason', () => {
    // A reason with no label renders as a raw enum string in the UI.
    for (const r of REPORT_REASONS) {
      expect(REPORT_REASON_LABELS[r], r).toBeTruthy()
    }
    expect(Object.keys(REPORT_REASON_LABELS).sort()).toEqual([...REPORT_REASONS].sort())
  })
})

describe('toReportReason', () => {
  it('passes known reasons through', () => {
    for (const r of REPORT_REASONS) expect(toReportReason(r)).toBe(r)
  })

  it('returns NULL for an unknown value rather than a default', () => {
    // Unlike `toSetVisibility`, there is NO safe default here. Coercing an
    // unrecognised reason to 'other' would file a report the reporter did not
    // make, under a category they did not choose — and the row is what an
    // operator later acts on. Reject instead.
    expect(toReportReason('')).toBeNull()
    expect(toReportReason('Spam')).toBeNull()
    expect(toReportReason('harassment')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sets/moderation.test.ts`
Expected: FAIL — cannot resolve `@/lib/sets/moderation`.

- [ ] **Step 3: Create `src/lib/sets/moderation.ts`**

```ts
/**
 * Why a public set was reported.
 *
 * A closed `as const` vocabulary for the same reason `SET_VISIBILITIES` is one:
 * `SetReport.reason` is a String column, so a typo compiles cleanly and
 * silently never matches. Import this rather than writing a literal.
 *
 * These strings are PERSISTED. Renaming one strands every existing row — the
 * same constraint `CORRUPTIONS` carries in the analysis layer.
 */
export const REPORT_REASONS = [
  'spam',
  'abusive',
  'copyright',
  'misleading',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or advertising',
  abusive: 'Abusive or hateful content',
  copyright: "Copies someone else's material",
  misleading: 'Deliberately wrong or misleading',
  other: 'Something else',
}

/**
 * Narrow a submitted reason, or NULL.
 *
 * Deliberately does NOT fail closed to a default the way `toSetVisibility`
 * does. There is no safe default: coercing an unrecognised value to `other`
 * files a report the reporter did not make under a category they did not
 * choose, and the row is what an operator later acts on. A malformed
 * submission is rejected, not reinterpreted.
 */
export function toReportReason(raw: string): ReportReason | null {
  return (REPORT_REASONS as readonly string[]).includes(raw) ? (raw as ReportReason) : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sets/moderation.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/actions/set-reports.ts`**

```ts
'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { isKltEditor } from '@/lib/klt/editors'
import { toReportReason } from '@/lib/sets/moderation'
import { composeSetWhere, listableSetWhere } from '@/lib/sets/visibility'
import type { ActionResult } from '@/lib/actions/result'

/**
 * Report a PUBLIC set.
 *
 * Only public sets are reportable: a link-shared set was handed to you
 * personally, and a report queue that accepts them turns a private share into
 * something an operator reviews.
 *
 * Idempotent by `@@unique([setId, reporterId])`, so the button cannot be used
 * to flood the table. A second report from the same person UPDATES their
 * existing row rather than erroring — the reporter should not be told "you
 * already did that" and left unsure whether it registered.
 */
export async function reportSet(
  setId: string,
  reason: string,
  detail?: string,
): Promise<ActionResult<void>> {
  try {
    const session = await auth()
    if (!session?.user?.id) return { success: false, error: 'Authentication required' }

    const parsed = toReportReason(reason)
    if (parsed === null) return { success: false, error: 'Unrecognised report reason' }

    // The set must be one this viewer can actually SEE listed. Composed, never
    // hand-rolled — same rule as every other set read.
    const set = await prisma.set.findFirst({
      where: { AND: [{ id: setId }, composeSetWhere(session.user.id, listableSetWhere())] },
      select: { id: true },
    })
    if (!set) return { success: false, error: 'Set not found' }

    await prisma.setReport.upsert({
      where: { setId_reporterId: { setId: set.id, reporterId: session.user.id } },
      create: {
        setId: set.id,
        reporterId: session.user.id,
        reason: parsed,
        detail: detail?.slice(0, 2000) || null,
      },
      update: { reason: parsed, detail: detail?.slice(0, 2000) || null, status: 'open' },
    })

    return { success: true, data: undefined }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Unlist (or relist) a set. OPERATOR ONLY.
 *
 * Writes `Set.listingBlocked`, NOT `Set.visibility`. Spec §10: visibility is
 * something the owner can change back in one click and silently, so it cannot
 * carry a decision made ABOUT the owner. A separate column makes the decision
 * stick and makes it visible to the owner on their own set page.
 *
 * The set stays READABLE by anyone holding its id. Moderation removes it from
 * the shop window; it does not retroactively break every link already shared.
 *
 * Gated by `isKltEditor` — the existing operator allowlist, which already has
 * the right posture: unset means NOBODY, never everybody.
 */
export async function setListingBlocked(
  setId: string,
  blocked: boolean,
): Promise<ActionResult<void>> {
  try {
    const session = await auth()
    if (!session?.user?.id) return { success: false, error: 'Not found' }
    // Not-found rather than forbidden, for the same reason every read path
    // 404s: a distinguishable error tells a stranger the operator gate exists.
    if (!isKltEditor(session.user.id)) return { success: false, error: 'Not found' }

    const updated = await prisma.set.updateMany({
      where: { id: setId },
      data: { listingBlocked: blocked },
    })
    if (updated.count === 0) return { success: false, error: 'Not found' }

    revalidatePath('/browse')
    revalidatePath(`/sets/${setId}`)
    return { success: true, data: undefined }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
```

**Check the import path for `ActionResult` first** — run `grep -rn "export type ActionResult\|export interface ActionResult" src/` and use whatever path it actually lives at, not the one written above.

- [ ] **Step 6: Create `src/components/sets/ReportSetDialog.tsx`**

A client component: a "Report" text button opening a `Popover` (the repo already uses `@/components/ui/popover` in `VisibilityMenu.tsx` — follow that file's structure), a radio list built from `REPORT_REASONS`/`REPORT_REASON_LABELS`, an optional detail `textarea`, and a submit calling `reportSet`. On success show `toast.success('Thanks — an operator will take a look.')` and close. On failure show `toast.error(res.error)`.

**Do not** use `alert()`, `confirm()`, or any browser modal — `ActivityTiles` documents why that was removed.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/sets/moderation.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit 2>&1 | grep -E "set-reports|moderation|ReportSetDialog" || echo "moderation clean"`
Expected: `moderation clean`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sets/moderation.ts src/actions/set-reports.ts src/components/sets/ReportSetDialog.tsx tests/sets/moderation.test.ts
git commit -m "feat(sets): report reasons, report action and operator unlist"
```

---

## ⛔ PARENT CHECKPOINT — after Wave 2

```bash
npm test && npx tsc --noEmit && npm run lint && npx next build
```

Expected: all green; `tsc` fully clean now (Task 4 fixed `VisibilityMenu`); lint still 175.

---

# WAVE 3

---

### Task 8: The `/browse` directory

**Files:**
- Create: `src/lib/sets/directory.ts`
- Create: `src/lib/sets/glyph.ts`
- Create: `src/components/sets/SetGlyph.tsx`
- Create: `src/components/sets/DirectoryCard.tsx`
- Create: `src/app/browse/page.tsx`
- Create: `tests/sets/directory.test.ts`
- Create: `tests/sets/glyph.test.ts`

**Interfaces:**
- Consumes: `composeSetWhere`, `listableSetWhere`, `readableSetWhere` (Task 2); `Section`, `SectionHeader`, `SectionBody` (Task 3); `ReportSetDialog` (Task 7).
- Produces:
  ```ts
  // directory.ts
  export const DIRECTORY_PAGE_SIZE = 24
  export function buildDirectoryWhere(viewerId: string | null, q?: string): Record<string, unknown>
  export interface DirectoryEntry {
    id: string; title: string; description: string | null; cardCount: number
    handle: string | null; categories: { name: string; color: string | null }[]
    forkCount: number; publishedAt: Date | null
    forkedFromTitle: string | null; forkedFromHandle: string | null; forkedFromId: string | null
  }
  export function loadDirectory(viewerId: string | null, q: string | undefined, cursor?: string): Promise<{ entries: DirectoryEntry[]; nextCursor: string | null }>
  // glyph.ts
  export interface GlyphNode { x: number; y: number; r: number }
  export function buildGlyph(seed: string, categoryCount: number): GlyphNode[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/sets/directory.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDirectoryWhere, DIRECTORY_PAGE_SIZE } from '@/lib/sets/directory'
import { readableSetWhere, listableSetWhere } from '@/lib/sets/visibility'

const VIEWER = 'u1'

describe('buildDirectoryWhere', () => {
  it('composes readable AND listable under an explicit AND', () => {
    expect(buildDirectoryWhere(VIEWER)).toEqual({
      AND: [readableSetWhere(VIEWER), listableSetWhere()],
    })
  })

  it('adds the search OR as a THIRD AND member, never by spreading', () => {
    // THE assertion for spec §3.1. Spreading a search OR into a where that
    // already carries readableSetWhere's OR replaces it, widening the
    // directory to every set in the database — and it returns plausible
    // results while doing it, so the page looks fine.
    const where = buildDirectoryWhere(VIEWER, 'merger') as {
      AND: Record<string, unknown>[]
    }
    expect(where.AND).toHaveLength(3)
    expect(where.AND.filter((c) => 'OR' in c)).toHaveLength(2)
  })

  it('searches title and description, case-insensitively', () => {
    const where = buildDirectoryWhere(null, 'merger') as { AND: Record<string, unknown>[] }
    const search = where.AND.find(
      (c) => 'OR' in c && JSON.stringify(c).includes('title'),
    ) as { OR: Record<string, unknown>[] }
    expect(search.OR).toEqual([
      { title: { contains: 'merger', mode: 'insensitive' } },
      { description: { contains: 'merger', mode: 'insensitive' } },
    ])
  })

  it('omits the search clause entirely for a blank query', () => {
    // `{ contains: '' }` matches every row, which is not the same thing as
    // "no filter" once it is sitting inside an OR alongside other clauses.
    for (const q of [undefined, '', '   ']) {
      const where = buildDirectoryWhere(VIEWER, q) as { AND: unknown[] }
      expect(where.AND, String(q)).toHaveLength(2)
    }
  })

  it('never omits the readable fragment, even though listable implies public', () => {
    // Not redundant: the day someone adds "also show my own private sets
    // here", a hand-rolled filter leaks and a composed one does not.
    const where = buildDirectoryWhere(null) as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual(readableSetWhere(null))
  })

  it('excludes unlisted sets', () => {
    const where = buildDirectoryWhere(VIEWER) as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual({ visibility: 'public', listingBlocked: false })
  })
})

describe('DIRECTORY_PAGE_SIZE', () => {
  it('is a bounded page', () => {
    expect(DIRECTORY_PAGE_SIZE).toBeGreaterThan(0)
    expect(DIRECTORY_PAGE_SIZE).toBeLessThanOrEqual(50)
  })
})
```

Create `tests/sets/glyph.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildGlyph } from '@/lib/sets/glyph'

describe('buildGlyph', () => {
  it('is deterministic for the same seed', () => {
    // A glyph that changes between renders or between pages is not an
    // identity, it is noise.
    expect(buildGlyph('set-abc', 4)).toEqual(buildGlyph('set-abc', 4))
  })

  it('differs between seeds', () => {
    expect(buildGlyph('set-abc', 4)).not.toEqual(buildGlyph('set-xyz', 4))
  })

  it('renders at least one node even with no categories', () => {
    // An uncategorized set still needs a mark. An empty glyph reads as a
    // failed render, not as "no categories".
    expect(buildGlyph('s', 0).length).toBeGreaterThan(0)
  })

  it('caps the node count so a 40-category set does not become mush', () => {
    expect(buildGlyph('s', 40).length).toBeLessThanOrEqual(7)
  })

  it('keeps every node inside the 0..1 unit box', () => {
    for (const n of buildGlyph('seed-with-some-length', 5)) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(1)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(1)
      expect(n.r).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/sets/directory.test.ts tests/sets/glyph.test.ts`
Expected: FAIL — modules do not resolve. **If it reports 0 tests and exits 0, your paths are wrong** — a wrong vitest path matches nothing and still reports success.

- [ ] **Step 3: Create `src/lib/sets/glyph.ts`**

```ts
/**
 * A small deterministic constellation standing in for a set's shape.
 *
 * DERIVED FROM CATEGORY COUNT ONLY, never from `SetKltNode`. Loading a concept
 * tree per row in a paginated directory is how this feature becomes slow, and
 * at 48px the visual difference is nil.
 *
 * Deterministic from the seed, so a set's mark is stable across renders and
 * across pages — a glyph that changes is noise, not an identity.
 *
 * Coordinates are in a 0..1 unit box; the component maps them to its viewBox.
 */

export interface GlyphNode {
  x: number
  y: number
  r: number
}

/** Beyond this, a 48px mark is mush rather than a constellation. */
const MAX_NODES = 7

/** FNV-1a. Small, dependency-free, and adequately mixed for layout jitter. */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function buildGlyph(seed: string, categoryCount: number): GlyphNode[] {
  // At least one node: an uncategorized set still needs a mark, and an empty
  // glyph reads as a failed render rather than as "no categories".
  const count = Math.max(1, Math.min(MAX_NODES, categoryCount || 1))
  let state = hash(seed) || 1

  const next = () => {
    // xorshift32 — same generator each call, so the sequence is a pure
    // function of the seed.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 10000) / 10000
  }

  const nodes: GlyphNode[] = []
  for (let i = 0; i < count; i++) {
    // Nodes are placed around a ring with per-node jitter, which reads as a
    // cluster rather than as a chart. The ring keeps them apart at small
    // sizes; pure random placement collides constantly at n>4.
    const angle = (i / count) * Math.PI * 2 + next() * 0.7
    const radius = 0.22 + next() * 0.2
    nodes.push({
      x: clamp01(0.5 + Math.cos(angle) * radius),
      y: clamp01(0.5 + Math.sin(angle) * radius),
      r: 0.05 + next() * 0.045,
    })
  }
  return nodes
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}
```

- [ ] **Step 4: Create `src/lib/sets/directory.ts`**

```ts
import { composeSetWhere, listableSetWhere } from '@/lib/sets/visibility'

/** One page of the directory. Cursor-paginated, so it is a page and not an offset. */
export const DIRECTORY_PAGE_SIZE = 24

export interface DirectoryEntry {
  id: string
  title: string
  description: string | null
  cardCount: number
  handle: string | null
  categories: { name: string; color: string | null }[]
  forkCount: number
  publishedAt: Date | null
  forkedFromId: string | null
  forkedFromTitle: string | null
  forkedFromHandle: string | null
}

/**
 * The directory's `where`.
 *
 * `composeSetWhere` and NOT a spread. `readableSetWhere` returns a bare `OR`
 * for a signed-in viewer, and the search below is also an `OR` — spreading
 * both at one level makes the second REPLACE the first, widening the query to
 * every set in the database while still returning plausible results. That is
 * the failure mode this function exists to make impossible.
 *
 * `listableSetWhere` looks like it makes the readable fragment redundant. It
 * is kept anyway: the day someone adds "also show my own private sets here",
 * a hand-rolled filter leaks and a composed one does not.
 */
export function buildDirectoryWhere(
  viewerId: string | null,
  q?: string,
): Record<string, unknown> {
  const trimmed = q?.trim()
  const clauses: Record<string, unknown>[] = [listableSetWhere()]

  // Omitted entirely for a blank query. `{ contains: '' }` matches every row,
  // which is not the same thing as "no filter" once it sits inside an OR
  // alongside other clauses.
  if (trimmed) {
    clauses.push({
      OR: [
        { title: { contains: trimmed, mode: 'insensitive' } },
        { description: { contains: trimmed, mode: 'insensitive' } },
      ],
    })
  }

  return composeSetWhere(viewerId, ...clauses)
}

/**
 * Thin DB shell over `buildDirectoryWhere`. Untested here by the same
 * convention as `getLearnerMetrics` — the predicate it delegates to is
 * covered, and no DB fixture in this suite would add signal.
 *
 * Cursor-paginated on id, ordered by fork count then recency. Offset paging
 * drifts as sets are published mid-scroll.
 *
 * Sort is deliberately NOT "most studied": study counts come from
 * `StudySession` rows belonging to individual learners, and turning private
 * study behaviour into a public ranking signal is a privacy decision nobody
 * has made.
 */
export async function loadDirectory(
  viewerId: string | null,
  q: string | undefined,
  cursor?: string,
): Promise<{ entries: DirectoryEntry[]; nextCursor: string | null }> {
  const { prisma } = await import('@/lib/db')

  const rows = await prisma.set.findMany({
    where: buildDirectoryWhere(viewerId, q),
    orderBy: [{ forks: { _count: 'desc' } }, { publishedAt: 'desc' }, { id: 'desc' }],
    take: DIRECTORY_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, title: true, description: true, publishedAt: true,
      forkedFromId: true, forkedFromTitle: true, forkedFromHandle: true,
      user: { select: { handle: true } },
      categories: { select: { name: true, color: true }, take: 6 },
      _count: { select: { cards: true, forks: true } },
    },
  })

  const page = rows.slice(0, DIRECTORY_PAGE_SIZE)
  return {
    entries: page.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      cardCount: r._count.cards,
      forkCount: r._count.forks,
      publishedAt: r.publishedAt,
      handle: r.user.handle,
      categories: r.categories,
      forkedFromId: r.forkedFromId,
      forkedFromTitle: r.forkedFromTitle,
      forkedFromHandle: r.forkedFromHandle,
    })),
    nextCursor: rows.length > DIRECTORY_PAGE_SIZE ? page[page.length - 1].id : null,
  }
}
```

- [ ] **Step 5: Run the pure tests to verify they pass**

Run: `npx vitest run tests/sets/directory.test.ts tests/sets/glyph.test.ts`
Expected: PASS, with a non-zero test count.

- [ ] **Step 6: Create `src/components/sets/SetGlyph.tsx`**

A server-safe (no `'use client'`) SVG component: `<SetGlyph setId={id} categoryCount={n} className?>`. Render a `viewBox="0 0 100 100"` SVG, `aria-hidden="true"`, with `buildGlyph(setId, categoryCount)` mapped to `<circle cx={x*100} cy={y*100} r={r*100} />` filled `currentColor` at varying opacity, plus faint `<line>` elements connecting consecutive nodes (`stroke="currentColor"`, `strokeOpacity={0.25}`). Colour comes from `text-primary/70` on the wrapper so it follows the theme in both modes.

- [ ] **Step 7: Create `src/components/sets/DirectoryCard.tsx`**

Server component taking `entry: DirectoryEntry`. Layout: the glyph at the left, then title (linking to `/sets/${entry.id}`), description clamped to two lines, then a footer row of `{cardCount} cards` · `@handle` (plain text, not a link — `/{handle}` does not exist) · category chips using the existing chip styling from `TermsList.tsx`, plus the fork credit when present.

Fork credit rule (spec §7.3): render `forkedFromTitle`/`forkedFromHandle` as **plain text**. This component never links it — the viewer-scoped readability check that would justify a link is Task 9's `ForkAttribution`, used on the set page where one extra query is affordable.

- [ ] **Step 8: Create `src/app/browse/page.tsx`**

```tsx
import { auth } from '@/auth'
import { loadDirectory } from '@/lib/sets/directory'
import { readableSetWhere } from '@/lib/sets/visibility'
import { DirectoryCard } from '@/components/sets/DirectoryCard'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import Link from 'next/link'

/**
 * The public directory.
 *
 * `readableSetWhere` is imported and applied through `buildDirectoryWhere` /
 * `composeSetWhere` — see `src/lib/sets/directory.ts`. This page is on the
 * ENFORCED_PATHS checklist in tests/sets/visibility-enforcement.test.ts, which
 * asserts the name appears here.
 *
 * Readable signed-out by design: a directory nobody can see without an account
 * is not a directory.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>
}) {
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const { q, cursor } = await searchParams
  const { entries, nextCursor } = await loadDirectory(viewerId, q, cursor)

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="display">Browse</h1>
      <p className="lede mt-3">
        Sets people have published. Study any of them — your progress stays your own —
        or make your own copy to edit.
      </p>

      <Section className="mt-8">
        <SectionHeader
          title={q ? `Results for “${q}”` : 'Published sets'}
          hint={entries.length === 0 ? undefined : `${entries.length}${nextCursor ? '+' : ''}`}
        />
        <SectionBody>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8">
              {q
                ? `Nothing published matches “${q}”.`
                : 'Nothing has been published yet. If you have a set worth sharing, publish it from its Edit screen.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {entries.map((e) => (
                <DirectoryCard key={e.id} entry={e} />
              ))}
            </div>
          )}
        </SectionBody>
      </Section>

      {nextCursor && (
        <div className="mt-8">
          <Link
            href={`/browse?${new URLSearchParams({ ...(q ? { q } : {}), cursor: nextCursor })}`}
            className="text-sm underline underline-offset-4"
          >
            More
          </Link>
        </div>
      )}
    </div>
  )
}
```

**Note the `void readableSetWhere`** — the enforcement test is source-level and asserts the identifier appears in this file. That is a real constraint of the guard, not a decoration; if you restructure so the name genuinely does not belong here, tell the parent rather than deleting the line.

- [ ] **Step 9: Verify**

Run: `npx vitest run tests/sets/directory.test.ts tests/sets/glyph.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit 2>&1 | grep -E "browse|directory|glyph|DirectoryCard|SetGlyph" || echo "directory clean"`
Expected: `directory clean`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/sets/directory.ts src/lib/sets/glyph.ts src/components/sets/SetGlyph.tsx src/components/sets/DirectoryCard.tsx src/app/browse/page.tsx tests/sets/directory.test.ts tests/sets/glyph.test.ts
git commit -m "feat(browse): public directory with composed where and set glyphs"
```

---

### Task 9: Fork

**Files:**
- Create: `src/actions/sets-fork.ts`
- Create: `src/components/sets/ForkButton.tsx`
- Create: `src/components/sets/ForkAttribution.tsx`
- Create: `tests/actions/fork.test.ts`

**Interfaces:**
- Consumes: `checkForkSize`, `describeForkRefusal`, `FORK_MAX_CARDS`, `FORK_ASSET_BUDGET_BYTES` (Task 6); `readableSetWhere` (Task 2).
- Produces: `forkSet(setId: string): Promise<ActionResult<{ setId: string }>>`.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/fork.test.ts` using the in-memory-fake pattern. **The blob copy must be mocked** — assert it is called once per asset and that each produces a distinct `storageKey`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  interface SetRow {
    id: string; title: string; description: string | null; visibility: string
    userId: string; listingBlocked: boolean; publishedAt: Date | null
    forkedFromId: string | null; forkedFromTitle: string | null; forkedFromHandle: string | null
  }
  const state = {
    userId: 'bob' as string | null,
    sets: [] as SetRow[],
    cards: [] as { id: string; setId: string; term: string; definition: string; position: number; klpStatus: string }[],
    assets: [] as { id: string; setId: string | null; userId: string; storageKey: string; sizeBytes: number; mimeType: string; originalName: string; kind: string; textExtract: string | null }[],
    blocks: [] as { id: string; cardId: string; assetId: string | null; side: string; type: string; text: string | null; position: number }[],
    kltNodes: [] as { id: string; setId: string; kltId: string; parentKltId: string | null; depth: number; ancestorIds: string[]; color: string | null; icon: string | null }[],
    users: [{ id: 'alice', handle: 'alice' }, { id: 'bob', handle: null }] as { id: string; handle: string | null }[],
    seq: 0,
  }
  const id = (p: string) => `${p}-${++state.seq}`
  const copied: { from: string; to: string }[] = []

  const db = {
    set: {
      findFirst: vi.fn(async ({ where }: never) => {
        const w = where as { id?: string; AND?: unknown[] }
        const target = w.id ?? ((w.AND as { id: string }[] | undefined)?.[0]?.id)
        const s = state.sets.find((x) => x.id === target)
        if (!s) return null
        // The fake honours ownership + visibility the way readableSetWhere does.
        const readable = s.userId === state.userId || s.visibility !== 'private'
        if (!readable) return null
        return {
          ...s,
          user: state.users.find((u) => u.id === s.userId) ?? { handle: null },
          cards: state.cards
            .filter((c) => c.setId === s.id)
            .map((c) => ({ ...c, contentBlocks: state.blocks.filter((b) => b.cardId === c.id) })),
          kltNodes: state.kltNodes.filter((n) => n.setId === s.id),
          categories: [],
        }
      }),
      create: vi.fn(async ({ data }: never) => {
        const d = data as Partial<SetRow>
        const row: SetRow = {
          id: id('set'), title: d.title!, description: d.description ?? null,
          visibility: d.visibility ?? 'private', userId: d.userId!,
          listingBlocked: false, publishedAt: null,
          forkedFromId: d.forkedFromId ?? null,
          forkedFromTitle: d.forkedFromTitle ?? null,
          forkedFromHandle: d.forkedFromHandle ?? null,
        }
        state.sets.push(row)
        return row
      }),
    },
    card: { createMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async ({ data }: never) => { const d = data as { setId: string; term: string; definition: string; position: number; klpStatus: string }; const row = { id: id('card'), ...d }; state.cards.push(row); return row }) },
    cardAsset: { create: vi.fn(async ({ data }: never) => { const d = data as Record<string, unknown>; const row = { id: id('asset'), ...(d as never) } as never; state.assets.push(row); return row }) },
    cardContentBlock: { create: vi.fn(async ({ data }: never) => { const d = data as Record<string, unknown>; const row = { id: id('block'), ...(d as never) } as never; state.blocks.push(row); return row }) },
    setKltNode: { createMany: vi.fn(async ({ data }: never) => { for (const d of data as never[]) state.kltNodes.push({ id: id('node'), ...(d as never) } as never); return { count: (data as never[]).length } }) },
    cardCategory: { create: vi.fn(async () => ({ id: id('cat') })) },
    cardCategoryAssignment: { createMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  }
  return { state, db, copied, id }
})

vi.mock('@/lib/db', () => ({ prisma: h.db }))
vi.mock('@/auth', () => ({
  auth: async () => (h.state.userId ? { user: { id: h.state.userId } } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(async (from: string, to: string) => {
    h.copied.push({ from, to })
    return { url: `https://blob.test/${to}-${h.copied.length}` }
  }),
  del: vi.fn(async () => undefined),
}))

import { forkSet } from '@/actions/sets-fork'

beforeEach(() => {
  h.copied.length = 0
  h.state.seq = 0
  h.state.userId = 'bob'
  h.state.sets = [{
    id: 'src', title: 'Merger Model', description: 'd', visibility: 'public',
    userId: 'alice', listingBlocked: false, publishedAt: new Date(),
    forkedFromId: null, forkedFromTitle: null, forkedFromHandle: null,
  }]
  h.state.cards = [{ id: 'c1', setId: 'src', term: 't', definition: 'd', position: 0, klpStatus: 'done' }]
  h.state.assets = [{ id: 'a1', setId: 'src', userId: 'alice', storageKey: 'https://blob.test/orig', sizeBytes: 1000, mimeType: 'image/png', originalName: 'x.png', kind: 'image', textExtract: null }]
  h.state.blocks = [{ id: 'b1', cardId: 'c1', assetId: 'a1', side: 'term', type: 'image', text: null, position: 0 }]
  h.state.kltNodes = [{ id: 'n1', setId: 'src', kltId: 'klt1', parentKltId: null, depth: 0, ancestorIds: [], color: 'violet', icon: null }]
})

describe('forkSet', () => {
  it('creates the copy PRIVATE regardless of the source', async () => {
    const res = await forkSet('src')
    expect(res.success).toBe(true)
    const fork = h.state.sets.find((s) => s.userId === 'bob')!
    // Inheriting `public` would republish someone else's work under a new name
    // with no deliberate act. Spec §7.1.
    expect(fork.visibility).toBe('private')
  })

  it('denormalizes the source title and handle at fork time', async () => {
    await forkSet('src')
    const fork = h.state.sets.find((s) => s.userId === 'bob')!
    expect(fork.forkedFromId).toBe('src')
    expect(fork.forkedFromTitle).toBe('Merger Model')
    expect(fork.forkedFromHandle).toBe('alice')
  })

  it('COPIES the blob to a new storageKey rather than sharing the row', async () => {
    // Spec §7.2 — the strongest finding in the design. /api/assets/[id]
    // resolves permission through contentBlocks[0] with take:1, so a SHARED
    // asset row makes that answer depend on Postgres row order.
    await forkSet('src')
    expect(h.copied).toHaveLength(1)
    const newAsset = h.state.assets.find((a) => a.userId === 'bob')!
    expect(newAsset.storageKey).not.toBe('https://blob.test/orig')
  })

  it('sets every copied card to klpStatus pending', async () => {
    await forkSet('src')
    const forked = h.state.cards.filter((c) => c.setId !== 'src')
    expect(forked.length).toBeGreaterThan(0)
    for (const c of forked) expect(c.klpStatus).toBe('pending')
  })

  it('carries the concept-tree skeleton verbatim', async () => {
    // SetKltNode points at a GLOBAL Klt and stores only placement, so the
    // hierarchy copies with no id remapping. Spec §7.4.
    await forkSet('src')
    const forkId = h.state.sets.find((s) => s.userId === 'bob')!.id
    const nodes = h.state.kltNodes.filter((n) => n.setId === forkId)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kltId: 'klt1', depth: 0, color: 'violet' })
  })

  it('refuses a private set belonging to someone else', async () => {
    h.state.sets[0].visibility = 'private'
    const res = await forkSet('src')
    expect(res.success).toBe(false)
    expect(h.copied).toHaveLength(0)
  })

  it('refuses when signed out', async () => {
    h.state.userId = null
    const res = await forkSet('src')
    expect(res.success).toBe(false)
  })

  it('refuses an oversized set BEFORE copying any blob', async () => {
    h.state.assets[0].sizeBytes = 999 * 1024 * 1024
    const res = await forkSet('src')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain('MB')
    // The whole point of gating before the copy: a refusal must cost nothing.
    expect(h.copied).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/actions/fork.test.ts`
Expected: FAIL — cannot resolve `@/actions/sets-fork`.

- [ ] **Step 3: Implement `src/actions/sets-fork.ts`**

```ts
'use server'

import { randomUUID } from 'node:crypto'
import { copy, del } from '@vercel/blob'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { readableSetWhere } from '@/lib/sets/visibility'
import { checkForkSize, describeForkRefusal } from '@/lib/sets/fork'
import type { ActionResult } from '@/lib/actions/result'

/**
 * Copy any set this viewer may READ into a set they own outright.
 *
 * Fork is a READ of the source and a WRITE to a new set. It needs no write
 * access to the source and must never be given any — `readableSetWhere` is
 * therefore the only guard it has, and the only one it needs.
 */
export async function forkSet(setId: string): Promise<ActionResult<{ setId: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Authentication required' }
  const viewerId = session.user.id

  const source = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(viewerId) },
    include: {
      user: { select: { handle: true } },
      categories: true,
      kltNodes: true,
      cards: {
        orderBy: { position: 'asc' },
        include: {
          contentBlocks: { orderBy: { position: 'asc' } },
          categoryAssignments: { select: { categoryId: true } },
        },
      },
    },
  })
  // Not-found rather than forbidden, like every other read path: a
  // distinguishable error confirms a set id is real.
  if (!source) return { success: false, error: 'Set not found' }

  // Every asset actually REACHABLE from a content block — not
  // `CardAsset.setId`, which records where an asset was UPLOADED, not where it
  // is used. The asset route makes the same distinction for the same reason.
  const assetIds = [
    ...new Set(
      source.cards.flatMap((c) =>
        c.contentBlocks.map((b) => b.assetId).filter((a): a is string => a !== null),
      ),
    ),
  ]
  const assets = assetIds.length
    ? await prisma.cardAsset.findMany({ where: { id: { in: assetIds } } })
    : []

  // BEFORE any copy, so a refusal costs nothing.
  const size = checkForkSize({
    cardCount: source.cards.length,
    assetSizes: assets.map((a) => a.sizeBytes),
  })
  if (!size.ok) return { success: false, error: describeForkRefusal(size) }

  // Blobs are copied OUTSIDE the transaction. A network call inside a Postgres
  // transaction holds it open for the whole copy, which for a 25 MB video set
  // is seconds of a held connection.
  const newKeyByAssetId = new Map<string, string>()
  const copiedKeys: string[] = []
  try {
    for (const asset of assets) {
      const result = await copy(
        asset.storageKey,
        `${randomUUID()}_${asset.originalName}`,
        { access: 'private' },
      )
      newKeyByAssetId.set(asset.id, result.url)
      copiedKeys.push(result.url)
    }

    const fork = await prisma.$transaction(async (tx) => {
      const created = await tx.set.create({
        data: {
          title: source.title,
          description: source.description,
          userId: viewerId,
          // ALWAYS private, never inherited. A fork that auto-published would
          // republish someone else's work under a new name with no deliberate
          // act. Spec §7.1.
          visibility: 'private',
          publishedAt: null,
          forkedFromId: source.id,
          // Denormalized AT FORK TIME. Rendering from the live FK would leak
          // the title of a set the author later makes private. Spec §7.3.
          forkedFromTitle: source.title,
          forkedFromHandle: source.user.handle,
        },
      })

      const categoryIdMap = new Map<string, string>()
      for (const cat of source.categories) {
        const newCat = await tx.cardCategory.create({
          data: {
            setId: created.id,
            name: cat.name,
            normalizedName: cat.normalizedName,
            color: cat.color,
          },
        })
        categoryIdMap.set(cat.id, newCat.id)
      }

      const newAssetIdMap = new Map<string, string>()
      for (const asset of assets) {
        const newAsset = await tx.cardAsset.create({
          data: {
            userId: viewerId,
            setId: created.id,
            storageKey: newKeyByAssetId.get(asset.id)!,
            originalName: asset.originalName,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            kind: asset.kind,
            textExtract: asset.textExtract,
          },
        })
        newAssetIdMap.set(asset.id, newAsset.id)
      }

      for (const card of source.cards) {
        const newCard = await tx.card.create({
          data: {
            setId: created.id,
            term: card.term,
            definition: card.definition,
            position: card.position,
            // Uniformly pending, including cards the source left 'skipped'.
            // KLPs are re-extracted rather than copied: copied version history
            // describes edits made to SOMEONE ELSE'S card, which defeats the
            // reason KLPs are versioned at all. Spec §7.5.
            klpStatus: 'pending',
          },
        })

        for (const block of card.contentBlocks) {
          await tx.cardContentBlock.create({
            data: {
              cardId: newCard.id,
              side: block.side,
              type: block.type,
              text: block.text,
              position: block.position,
              assetId: block.assetId ? (newAssetIdMap.get(block.assetId) ?? null) : null,
            },
          })
        }

        const assignments = card.categoryAssignments
          .map((a) => categoryIdMap.get(a.categoryId))
          .filter((id): id is string => id !== undefined)
          .map((categoryId) => ({ cardId: newCard.id, categoryId }))
        if (assignments.length) {
          await tx.cardCategoryAssignment.createMany({ data: assignments })
        }
      }

      // The concept tree carries VERBATIM. `SetKltNode` points at a GLOBAL
      // `Klt` and stores only placement, so there is no id to remap — and the
      // hierarchy is often the most valuable authored thing in a mature set.
      // Spec §7.4.
      if (source.kltNodes.length) {
        await tx.setKltNode.createMany({
          data: source.kltNodes.map((n) => ({
            setId: created.id,
            kltId: n.kltId,
            parentKltId: n.parentKltId,
            depth: n.depth,
            ancestorIds: n.ancestorIds,
            color: n.color,
            icon: n.icon,
          })),
        })
      }

      return created
    })

    revalidatePath('/sets')
    revalidatePath('/')
    return { success: true, data: { setId: fork.id } }
  } catch (error) {
    // Roll the blobs back by hand — they were copied outside the transaction,
    // so nothing else will.
    //
    // KNOWN RESIDUAL: if the process dies between the copy and the commit, the
    // copies are orphaned. Accepted in spec §7.2/§15 rather than solved — a
    // reconciliation job is a larger piece of work than this whole feature.
    for (const key of copiedKeys) {
      await del(key).catch(() => undefined)
    }
    return { success: false, error: (error as Error).message }
  }
}
```

**Two things to check against the real schema before trusting this verbatim:** the `ActionResult` import path (`grep -rn "export type ActionResult" src/`), and whether `CardCategory` really has `normalizedName` and `color` columns (`sed -n '356,381p' prisma/schema.prisma`). Adjust and tell the parent if either differs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/actions/fork.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-test the two guards that matter**

(a) Change the created set's `visibility` to inherit `source.visibility`.
Run: expected **FAIL** on "creates the copy PRIVATE". Revert.

(b) Move the `checkForkSize` call to *after* the blob-copy loop.
Run: expected **FAIL** on "refuses an oversized set BEFORE copying any blob". Revert.

If either passes, the test is not protecting anything — fix the test.

- [ ] **Step 6: Create `src/components/sets/ForkButton.tsx`**

Client component. A button "Make my own copy" calling `forkSet(setId)` inside `useTransition`, disabled while pending with the label "Copying…" (blob copies are slow and a dead button reads as a broken one). On success `toast.success('Copied to your library')` and `router.push('/sets/' + res.data.setId)`. On failure `toast.error(res.error)`.

- [ ] **Step 7: Create `src/components/sets/ForkAttribution.tsx`**

Server component:

```tsx
export async function ForkAttribution({
  forkedFromId, forkedFromTitle, forkedFromHandle, viewerId,
}: {
  forkedFromId: string | null
  forkedFromTitle: string | null
  forkedFromHandle: string | null
  viewerId: string | null
}) { /* … */ }
```

Rules (spec §7.3), and they are the whole component:

- Render **nothing** when `forkedFromTitle` is null.
- The text ALWAYS comes from `forkedFromTitle`/`forkedFromHandle`. Never from a live join.
- Link to `/sets/${forkedFromId}` **only** when `forkedFromId` is non-null **and** `prisma.set.findFirst({ where: { id: forkedFromId, ...readableSetWhere(viewerId) }, select: { id: true } })` returns a row. Otherwise plain text.
- Copy: `Copied from <title> by @<handle>`, with `by @handle` omitted when the handle is null.

- [ ] **Step 8: Show both on the set page**

In `src/app/sets/[id]/page.tsx`, add `<ForkAttribution … viewerId={session?.user?.id ?? null} />` under the title, and `<ForkButton setId={id} />` in the button row **only when `!isOwner`** — you fork someone else's set; duplicating your own is a different verb and does not belong on this row.

Task 5 also edits this file, in an earlier wave. Rebase onto its commit before starting.

- [ ] **Step 9: Verify**

Run: `npx vitest run tests/actions/fork.test.ts tests/sets/visibility-enforcement.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/actions/sets-fork.ts src/components/sets/ForkButton.tsx src/components/sets/ForkAttribution.tsx tests/actions/fork.test.ts "src/app/sets/[id]/page.tsx"
git commit -m "feat(sets): fork with blob duplication and viewer-scoped attribution"
```

---

### Task 10: The homepage

**Files:**
- Modify: `src/app/page.tsx` (replaces the redirect entirely)
- Create: `src/components/home/SetStrip.tsx`
- Create: `src/components/home/Landing.tsx`
- Create: `tests/components/set-strip.test.tsx`

**Interfaces:**
- Consumes: `loadRecentSets`, `RecentSet`, `RECENTS_LIMIT` (Task 5); `Section`/`SectionHeader`/`SectionBody` (Task 3); `SetGlyph` (Task 8); `SetCard`, `loadSetStudySummaries` (existing).
- Produces: `SetStrip({ sets }: { sets: RecentSet[] })`.

**Do NOT add a Recommended block. Task 11 adds it in wave 4.**

- [ ] **Step 1: Write the failing test**

Create `tests/components/set-strip.test.tsx` (jsdom docblock first line):

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SetStrip } from '@/components/home/SetStrip'
import type { RecentSet } from '@/lib/sets/recents'

const set = (over: Partial<RecentSet> = {}): RecentSet => ({
  id: 's1', title: 'Merger Model', description: null, cardCount: 12,
  visibility: 'link', ownerHandle: 'alice', isOwn: false,
  viewedAt: new Date('2026-08-27T10:00:00Z'), ...over,
})

describe('SetStrip', () => {
  it('links each set to its page', () => {
    render(<SetStrip sets={[set()]} />)
    expect(screen.getByRole('link', { name: /Merger Model/ })).toHaveAttribute(
      'href', '/sets/s1',
    )
  })

  it('credits the handle for someone else’s set', () => {
    render(<SetStrip sets={[set()]} />)
    expect(screen.getByText('@alice')).toBeInTheDocument()
  })

  it('does NOT credit a handle on your own set', () => {
    // "@you" on your own material is noise, and on a strip that mixes yours
    // with other people's the absence of a credit IS the signal.
    render(<SetStrip sets={[set({ isOwn: true })]} />)
    expect(screen.queryByText('@alice')).not.toBeInTheDocument()
  })

  it('omits the credit entirely when there is no handle', () => {
    // Never falls back to User.name — that is the OAuth real-name field.
    render(<SetStrip sets={[set({ ownerHandle: null })]} />)
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  it('renders nothing at all for an empty list', () => {
    // Spec §8: a block renders NOTHING rather than an empty shell. A new
    // account must see a create prompt, not three empty headings.
    const { container } = render(<SetStrip sets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/set-strip.test.tsx`
Expected: FAIL — cannot resolve `@/components/home/SetStrip`.

- [ ] **Step 3: Create `src/components/home/SetStrip.tsx`**

A horizontal scrolling row (`flex gap-4 overflow-x-auto`) of compact tiles. Each tile: `SetGlyph`, title, `{cardCount} cards`, and `@handle` **only when `!isOwn && ownerHandle !== null`**. `return null` for an empty array — that is the tested contract, not a nicety.

- [ ] **Step 4: Create `src/components/home/Landing.tsx`**

The signed-out hero: an `h1.display`, a `p.lede` explaining what the app is, sign-in / sign-up links, and a link into `/browse`. No data fetching. It replaces the current signed-out experience, which is a redirect to `/sets` followed by "Sign in to see your sets" — the least informative possible first screen.

- [ ] **Step 5: Replace `src/app/page.tsx`**

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadRecentSets } from '@/lib/sets/recents'
import { loadSetStudySummaries } from '@/lib/sets/study-summary'
import { SetCard } from '@/components/sets/SetCard'
import { SetStrip } from '@/components/home/SetStrip'
import { Landing } from '@/components/home/Landing'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'

/** How many of your own sets the homepage shows before "See all". */
const OWN_SETS_PREVIEW = 6

/**
 * The homepage.
 *
 * Was a bare `redirect('/sets')`. Recents is keyed on VIEWING, not studying:
 * the case this page exists for is opening a set someone shared, reading it,
 * never answering a question, and losing the link forever.
 *
 * On the ENFORCED_PATHS checklist — every set read here goes through
 * `readableSetWhere`, including `loadRecentSets`, which re-authorizes at read
 * time so a set that has since gone private disappears.
 */
export default async function Home() {
  const session = await auth()
  if (!session?.user?.id) return <Landing />
  const userId = session.user.id

  const [recents, ownSets] = await Promise.all([
    loadRecentSets(userId),
    prisma.set.findMany({
      where: { AND: [{ userId }, readableSetWhere(userId)] },
      orderBy: { updatedAt: 'desc' },
      take: OWN_SETS_PREVIEW,
      include: { _count: { select: { cards: true } } },
    }),
  ])
  const summaries = await loadSetStudySummaries(prisma, userId, ownSets.map((s) => s.id))

  const hasNothing = recents.length === 0 && ownSets.length === 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="display">Your desk</h1>

      {hasNothing ? (
        <div className="mt-8">
          <p className="lede">
            Nothing here yet. Make a set of your own, or find one someone has published.
          </p>
          <div className="flex gap-4 mt-6 text-sm">
            <Link href="/sets/new" className="underline underline-offset-4">Create a set</Link>
            <Link href="/browse" className="underline underline-offset-4">Browse published sets</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Each block renders NOTHING rather than an empty shell — a new
              account must not meet three empty headings. */}
          {recents.length > 0 && (
            <Section className="mt-8">
              <SectionHeader title="Jump back in" hint={`${recents.length}`} />
              <SectionBody><SetStrip sets={recents} /></SectionBody>
            </Section>
          )}

          {ownSets.length > 0 && (
            <Section>
              <SectionHeader
                title="Your sets"
                action={<Link href="/sets" className="underline underline-offset-4">See all</Link>}
              />
              <SectionBody>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {ownSets.map((s) => (
                    <SetCard key={s.id} set={s} summary={summaries[s.id]} />
                  ))}
                </div>
              </SectionBody>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/components/set-strip.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit 2>&1 | grep -E "app/page|home/" || echo "home clean"`
Expected: `home clean`.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/components/home tests/components/set-strip.test.tsx
git commit -m "feat(home): a real homepage with Jump back in and Your sets"
```

---

## ⛔ PARENT CHECKPOINT — after Wave 3

```bash
npm test && npx tsc --noEmit && npm run lint && npx next build
```

Tasks 9 and 10 both grew `src/app/sets/[id]/page.tsx` and `src/app/page.tsx`. Resolve any conflict here, not inside a sub-agent.

---

# WAVE 4

---

### Task 11: Recommended

**Files:**
- Create: `src/lib/sets/recommend.ts`
- Create: `src/components/home/RecommendedStrip.tsx`
- Create: `tests/sets/recommend.test.ts`
- Modify: `src/app/page.tsx` (add the third block only)

**Interfaces:**
- Consumes: `getLearnerMetrics` (`@/lib/metrics/read`), `LearnerTopicProfile` (`@/lib/memory/topic-profile`), `composeSetWhere`/`listableSetWhere` (Task 2), `Section` (Task 3).
- Produces:
  ```ts
  export const MIN_CARDS_PER_CATEGORY = 3
  export interface WeakCategory { key: string; name: string; knowledge: number }
  export interface CandidateSet { id: string; title: string; ownerHandle: string | null; cardCount: number; categoryCounts: Record<string, number> }
  export interface Recommendation { setId: string; title: string; ownerHandle: string | null; cardCount: number; because: string }
  export type RecommendReason = 'no_public_sets' | 'no_categorized_cards' | 'below_floor' | 'no_match'
  export function pickWeakCategories(topics: LearnerTopicProfile[]): WeakCategory[]
  export function rankRecommendations(weak: WeakCategory[], candidates: CandidateSet[]): Recommendation[]
  export function diagnoseRecommendEmpty(i: { publicSetCount: number; topicCount: number; weakCount: number }): RecommendReason
  ```

**`src/lib/sets/recommend.ts` MUST contain no `prisma.*.create`/`update`/`upsert`/`delete`.** Task 13 adds a source-level test asserting that. Recommended is a recommendation surface, not evidence.

- [ ] **Step 1: Write the failing test**

Create `tests/sets/recommend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  pickWeakCategories, rankRecommendations, diagnoseRecommendEmpty,
  MIN_CARDS_PER_CATEGORY, type CandidateSet,
} from '@/lib/sets/recommend'
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

const topic = (over: Partial<LearnerTopicProfile> = {}): LearnerTopicProfile => ({
  key: 'valuation', name: 'Valuation', color: null, depth: null,
  klpCount: 10, knowledge: 0.3, verbosityIndex: 0,
  knowledgeGapTerseness: 0, readiness: 0.5, ...over,
})

const candidate = (over: Partial<CandidateSet> = {}): CandidateSet => ({
  id: 's1', title: 'DCF Drills', ownerHandle: 'alice', cardCount: 40,
  categoryCounts: { valuation: 12 }, ...over,
})

describe('pickWeakCategories', () => {
  it('keeps only topics with measured knowledge, weakest first', () => {
    const out = pickWeakCategories([
      topic({ key: 'a', knowledge: 0.8 }),
      topic({ key: 'b', knowledge: 0.2 }),
    ])
    expect(out.map((w) => w.key)).toEqual(['b', 'a'])
  })

  it('DROPS a topic with null knowledge rather than treating it as zero', () => {
    // Null means "no KLP cleared the learner's own observation floor" — no
    // evidence, not bad evidence. Treating it as 0 would make every untouched
    // topic the learner's single weakest area and drive the whole ranking.
    expect(pickWeakCategories([topic({ knowledge: null })])).toEqual([])
  })

  it('drops topics that are already strong', () => {
    expect(pickWeakCategories([topic({ knowledge: 0.95 })])).toEqual([])
  })

  it('returns an empty array for no topics', () => {
    expect(pickWeakCategories([])).toEqual([])
  })
})

describe('rankRecommendations', () => {
  const weak = [{ key: 'valuation', name: 'Valuation', knowledge: 0.2 }]

  it('names the reason on every recommendation', () => {
    // The cheapest and most important of the three mitigations. Cross-user
    // category matching is a string match wearing a concept's clothing; if the
    // match is wrong, the learner must be able to SEE that it is wrong rather
    // than face a mysterious ranking.
    const [r] = rankRecommendations(weak, [candidate()])
    expect(r.because).toContain('Valuation')
  })

  it(`requires at least ${MIN_CARDS_PER_CATEGORY} cards in the matching category`, () => {
    // A one-card coincidence must not surface a whole set.
    const thin = candidate({ categoryCounts: { valuation: MIN_CARDS_PER_CATEGORY - 1 } })
    expect(rankRecommendations(weak, [thin])).toEqual([])

    const enough = candidate({ categoryCounts: { valuation: MIN_CARDS_PER_CATEGORY } })
    expect(rankRecommendations(weak, [enough])).toHaveLength(1)
  })

  it('ranks the weakest matching category first', () => {
    const out = rankRecommendations(
      [
        { key: 'accounting', name: 'Accounting', knowledge: 0.6 },
        { key: 'valuation', name: 'Valuation', knowledge: 0.1 },
      ],
      [
        candidate({ id: 'acc', categoryCounts: { accounting: 10 } }),
        candidate({ id: 'val', categoryCounts: { valuation: 10 } }),
      ],
    )
    expect(out.map((r) => r.setId)).toEqual(['val', 'acc'])
  })

  it('returns nothing when no category matches', () => {
    expect(rankRecommendations(weak, [candidate({ categoryCounts: { spanish: 50 } })])).toEqual([])
  })

  it('recommends each set at most once', () => {
    const out = rankRecommendations(
      [
        { key: 'valuation', name: 'Valuation', knowledge: 0.1 },
        { key: 'accounting', name: 'Accounting', knowledge: 0.2 },
      ],
      [candidate({ categoryCounts: { valuation: 10, accounting: 10 } })],
    )
    expect(out).toHaveLength(1)
  })
})

describe('diagnoseRecommendEmpty', () => {
  it('distinguishes all four causes', () => {
    // Four empty states, not one, mirroring diagnoseEmptyState. The remedies
    // differ, and merging them produces the "is this broken?" confusion the 3B
    // gate hit twice.
    expect(diagnoseRecommendEmpty({ publicSetCount: 0, topicCount: 5, weakCount: 2 }))
      .toBe('no_public_sets')
    expect(diagnoseRecommendEmpty({ publicSetCount: 9, topicCount: 0, weakCount: 0 }))
      .toBe('no_categorized_cards')
    expect(diagnoseRecommendEmpty({ publicSetCount: 9, topicCount: 5, weakCount: 0 }))
      .toBe('below_floor')
    expect(diagnoseRecommendEmpty({ publicSetCount: 9, topicCount: 5, weakCount: 2 }))
      .toBe('no_match')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sets/recommend.test.ts`
Expected: FAIL — cannot resolve `@/lib/sets/recommend`.

- [ ] **Step 3: Implement `src/lib/sets/recommend.ts`**

Pure functions plus one read-only DB shell `loadRecommendations(userId)`. Header comment, verbatim:

```ts
/**
 * "Recommended" — public sets matching the learner's weak categories.
 *
 * THE WEAKEST THING IN THIS FEATURE, AND KNOWINGLY SO. `CardCategory` is
 * set-scoped and `groupCategoriesByName` collapses rows across sets by
 * `normalizedName`, so this works mechanically with no schema change. But a
 * user-authored category is often a FORMAT or MODALITY — "label the image",
 * "talking", "vocabulary" — not a subject (CLAUDE.md, 2026-08-14). Within one
 * account that is harmless because the learner knows what they meant. Across
 * accounts it is actively wrong: one user's `vocabulary` is Spanish and
 * another's is finance, and `normalizedName` says they are the same topic.
 * This is a string match wearing a concept's clothing.
 *
 * Three mitigations, all mandatory (spec §9):
 *   1. ALWAYS state the reason. A wrong match then reads as obviously wrong
 *      instead of as a mysterious ranking.
 *   2. Require real evidence on BOTH sides — the learner's own observation
 *      floor, and MIN_CARDS_PER_CATEGORY in the target set.
 *   3. NOTHING HERE WRITES. This is a recommendation surface, not evidence,
 *      and it must never feed the learner model. A test asserts this module
 *      contains no Prisma write.
 */
```

`pickWeakCategories`: drop `knowledge === null` (no evidence is not bad evidence — treating null as 0 would make every untouched topic the learner's weakest area and drive the whole ranking), drop `knowledge >= WEAK_CEILING` (0.75), sort ascending, return `{ key, name, knowledge }`.

`rankRecommendations`: for each weak category in order, take candidates whose `categoryCounts[weak.key] >= MIN_CARDS_PER_CATEGORY`, skip any set already recommended, and emit `because: \`Because you're weak on ${weak.name}\``.

`loadRecommendations(userId)`: call `getLearnerMetrics({ userId, scope: {} })`, `pickWeakCategories(metrics.profile.topics)`, then query public sets with `composeSetWhere(userId, listableSetWhere(), { userId: { not: userId } }, { forks: { none: { userId } } })`, selecting categories with `_count` of assignments, shape into `CandidateSet[]`, and return `rankRecommendations(...)` plus the `diagnoseRecommendEmpty` verdict when empty.

**Check `HistoryScope`'s empty-scope shape** (`src/lib/memory/scope.ts`) before writing `scope: {}` — use whatever that module's "consolidated view" value actually is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sets/recommend.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/components/home/RecommendedStrip.tsx`**

Renders each recommendation as a tile with the title, `@handle`, card count, and **the `because` line, always visible** — not a tooltip, not a hover. Renders the four distinct empty-state messages from `RecommendReason`; never a single generic "nothing to show".

- [ ] **Step 6: Add the block to `src/app/page.tsx`**

Insert between "Jump back in" and "Your sets", following the same `{x.length > 0 && …}` pattern. Add `loadRecommendations(userId)` to the existing `Promise.all`.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/sets/recommend.test.ts`
Expected: PASS.

Run: `grep -nE "prisma\.[a-zA-Z]+\.(create|update|upsert|delete)" src/lib/sets/recommend.ts && echo "WRITE FOUND — FIX IT" || echo "no writes, correct"`
Expected: `no writes, correct`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sets/recommend.ts src/components/home/RecommendedStrip.tsx tests/sets/recommend.test.ts src/app/page.tsx
git commit -m "feat(home): recommended sets from weak categories, with stated reasons"
```

---

### Task 12: Navigation & Library

**Files:**
- Modify: `src/components/Navbar.tsx`
- Modify: `src/app/sets/page.tsx` (heading + copy only)

**Interfaces:** consumes nothing new; produces nothing new.

**Copy changes and one nav item. Do NOT restructure `/sets`' query or its grid.**

- [ ] **Step 1: Update the navbar**

In `src/components/Navbar.tsx`:

- Change the brand link from `/sets` to `/`.
- In the signed-in block, replace the `My Sets` link with, in order: `Home` → `/`, `Browse` → `/browse`, `Library` → `/sets`.
- **Remove the `AI Settings` link.** `/account` exists and is where it belongs; five ghost buttons plus a primary plus a sign-out is already a crowded bar. **Add a link to `/settings/ai` on the `/account` page** so the route does not become unreachable — check `src/app/account/page.tsx` and add it there.
- In the signed-out block, add `Browse` → `/browse` beside `Sign in`. A directory nobody can reach without an account is not a directory.

Add this comment above the links:

```tsx
        {/* "Library", not "My Sets". The item beside it is now Browse, and
            My Sets vs Browse names the wrong axis — the distinction is
            yours-vs-everyone's, which stops being true the moment you fork
            someone's set into it. */}
```

- [ ] **Step 2: Update `/sets`' heading**

In `src/app/sets/page.tsx`, change `<h1 className="text-3xl font-bold tracking-tight">My Sets</h1>` to `<h1 className="display">Library</h1>` and the subtitle to `Everything you have made or copied.` Change **nothing else** — not the query, not the grid, not the empty states.

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/components tests/app`
Expected: PASS. If a test asserts the string "My Sets", update it to "Library" and note it in your report.

Run: `npx tsc --noEmit 2>&1 | grep -E "Navbar|sets/page" || echo "nav clean"`
Expected: `nav clean`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navbar.tsx src/app/sets/page.tsx src/app/account/page.tsx
git commit -m "feat(nav): Home / Browse / Library, and AI settings moves under Account"
```

---

### Task 13: Extend the enforcement checklist

**Files:**
- Modify: `tests/sets/visibility-enforcement.test.ts`

**Interfaces:** consumes every module built above. Produces nothing.

**This task is the guard for the whole feature. It runs LAST because it asserts things the earlier tasks built.**

- [ ] **Step 1: Verify every path exists before asserting on it**

Run:

```bash
for f in src/app/page.tsx src/app/browse/page.tsx src/actions/sets-fork.ts src/lib/sets/recommend.ts src/lib/sets/recents.ts src/lib/sets/directory.ts src/actions/set-reports.ts; do
  test -f "$f" && echo "OK   $f" || echo "MISS $f"
done
```

Expected: all `OK`. **A path that does not exist makes its assertion vacuous** — `readFileSync` throws, so it fails loudly here, but a *wrong* path in the vitest command itself matches nothing and reports success. Do not skip this step.

- [ ] **Step 2: Extend `ENFORCED_PATHS`**

Add to the array, with comments:

```ts
  // The homepage reads sets by id in two places — recents and recommendations
  // — and both are reachable by anyone with an account.
  'src/app/page.tsx',
  'src/app/browse/page.tsx',
  // Fork READS the source. It needs no write access to it and must never be
  // given any, so the read guard is the only guard it has.
  'src/actions/sets-fork.ts',
  'src/lib/sets/recents.ts',
  'src/lib/sets/directory.ts',
  'src/lib/sets/recommend.ts',
  'src/actions/set-reports.ts',
```

Note `src/lib/sets/directory.ts`, `recommend.ts` and `set-reports.ts` reach the predicate through `composeSetWhere`, not `readableSetWhere` directly. **Change the assertion to accept either**, and say why:

```ts
    it(`${path} applies the visibility predicate`, () => {
      const src = readFileSync(join(ROOT, path), 'utf8')
      // `composeSetWhere` counts: it IS `readableSetWhere` plus an explicit
      // AND, and it is the required form for any read carrying a predicate of
      // its own. Accepting only the bare name would push call sites toward the
      // spread that this whole module exists to prevent.
      expect(
        src.includes('readableSetWhere') || src.includes('composeSetWhere'),
        `${path} must apply the predicate`,
      ).toBe(true)
    })
```

- [ ] **Step 3: Add the two new guard suites**

Append:

```ts
describe('discovery reads compose rather than spread', () => {
  // The failure this catches returns PLAUSIBLE results — a directory widened
  // to every set in the database still renders a page full of sets. It cannot
  // be caught by looking at the screen, only by looking at the shape.
  const COMPOSING_PATHS = [
    'src/lib/sets/directory.ts',
    'src/lib/sets/recommend.ts',
    'src/actions/set-reports.ts',
  ]

  for (const path of COMPOSING_PATHS) {
    it(`${path} never spreads readableSetWhere alongside its own predicate`, () => {
      const src = readFileSync(join(ROOT, path), 'utf8')
      expect(src).not.toMatch(/\.\.\.readableSetWhere\([^)]*\),\s*\n?\s*OR:/)
    })
  }
})

describe('recommendations never write', () => {
  it('src/lib/sets/recommend.ts contains no Prisma write', () => {
    // "For you" is a recommendation surface, not evidence. A cross-user
    // category match is a string match wearing a concept's clothing, and the
    // roadmap's standing rule is that a bad cluster silently corrupts every
    // metric downstream of it. Source-level, because what fails in practice is
    // a call site somebody adds later, not a function.
    const src = readFileSync(join(ROOT, 'src/lib/sets/recommend.ts'), 'utf8')
    expect(src).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/)
  })
})

describe('forks are never born public', () => {
  it('src/actions/sets-fork.ts pins visibility to private', () => {
    // Inheriting the source's visibility would republish someone else's work
    // under a new name with no deliberate act.
    const src = readFileSync(join(ROOT, 'src/actions/sets-fork.ts'), 'utf8')
    expect(src).toMatch(/visibility:\s*'private'/)
    expect(src).not.toMatch(/visibility:\s*(source|src)\.visibility/)
  })
})
```

- [ ] **Step 4: Run and mutation-test every new guard**

Run: `npx vitest run tests/sets/visibility-enforcement.test.ts`
Expected: PASS with a non-zero count.

Then, one at a time, break each guard and confirm it goes RED. **A guard that cannot fail is not a guard**, and this repo has already shipped five of them:

| Mutation | Must fail |
| --- | --- |
| Delete `composeSetWhere` from `directory.ts` | "applies the visibility predicate" |
| Add `prisma.setView.create(…)` to `recommend.ts` | "contains no Prisma write" |
| Change fork's `visibility: 'private'` to `source.visibility` | "pins visibility to private" |

**Revert every mutation.** Report any guard that stayed green — that is a finding, not a nuisance.

- [ ] **Step 5: Commit**

```bash
git add tests/sets/visibility-enforcement.test.ts
git commit -m "test(sets): extend the enforcement checklist to discovery, fork and recommendations"
```

---

### Task 14: Report entry point & the unlist notice

**Files:**
- Modify: `src/app/sets/[id]/page.tsx`

**Interfaces:** consumes `ReportSetDialog` (Task 7), `toSetVisibility` (Task 2).

**Found by the plan's own spec-coverage review:** Task 7 builds `ReportSetDialog` and `setListingBlocked`, but nothing renders the dialog and nothing tells an owner their set was unlisted. Spec §10 requires both — *"The set's own page tells the owner it has been unlisted."* Without this task the moderation feature is reachable only from a database client.

Tasks 5 and 9 also edit this file, in earlier waves. Rebase before starting.

- [ ] **Step 1: Select the two new fields**

In the `prisma.set.findFirst` call, add `listingBlocked: true` to what is loaded (the query currently uses `include`, so scalars come back already — confirm, and only add a `select` if it does not).

- [ ] **Step 2: Render the report affordance for a non-owner**

Inside the existing `{!isOwner && …}` block, beneath the "Someone shared this set with you" notice, add the report entry point — but **only for a `public` set**:

```tsx
        {toSetVisibility(set.visibility) === 'public' && (
          // Only public sets are reportable. A link-shared set was handed to
          // you personally, and a report queue that accepts them turns a
          // private share into something an operator reviews.
          <div className="mt-3">
            <ReportSetDialog setId={id} />
          </div>
        )}
```

- [ ] **Step 3: Render the unlist notice for the owner**

Directly beneath the card count, add:

```tsx
      {isOwner && set.listingBlocked && (
        // The whole reason `listingBlocked` is a column separate from
        // `visibility`: a moderation decision has to STICK and has to be
        // VISIBLE. Flipping visibility back would be undone by the owner in
        // one click, silently, without them ever learning a decision was made.
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning-subtle p-4 text-sm">
          <p className="font-medium">This set has been removed from Browse.</p>
          <p className="text-muted-foreground mt-1">
            It is still readable by anyone holding its link, and you can still edit and
            study it. Publishing it again will not re-list it.
          </p>
        </div>
      )}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/sets/visibility-enforcement.test.ts`
Expected: PASS — this page must still contain `readableSetWhere` and no `prisma.set.findUnique`.

Run: `npx tsc --noEmit 2>&1 | grep "sets/\[id\]/page" || echo "set page clean"`
Expected: `set page clean`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/sets/[id]/page.tsx"
git commit -m "feat(sets): report entry point on public sets, unlist notice for the owner"
```

---

## ⛔ PARENT CHECKPOINT — after Wave 4

```bash
npm test && npx tsc --noEmit && npm run lint && npx next build
```

Then run the live gate below.

---

## Live gate (spec §16) — parent only, against `npm run dev` and the real dev database

**Environment trap:** `.env` carries only `DATABASE_URL`. `NEXTAUTH_SECRET` is absent, so `auth()` throws `MissingSecret` and the app misbehaves in confusing ways. Pass secrets to the process; do NOT edit `.env`. See `docs/superpowers/BUILD-QUEUE.md` for the exact invocation. `KLT_EDITORS` must be set to a real user id for step 8.

1. **Publish without a handle** → refused, handle prompt shown. Claim a handle at `/account` → publish succeeds.
2. **Second account sees it in `/browse`**; a signed-out visitor does too.
3. **A `private` and a `link` set are ABSENT** from `/browse` for both.
4. **Open a shared set as the second account** → it appears under Jump back in on `/`. Make the set private as the owner → it **disappears** from the second account's home.
5. **Fork a set carrying an image.** Assert a NEW `storageKey`, both assets fetch 200 independently, and **deleting the source set leaves the fork's image intact.**
6. **Fork attribution degrades.** Make the source private → the credit line drops from a link to plain text.
7. **Report + unlist.** Report as the second account; unlist with `KLT_EDITORS` set → gone from `/browse`, **still readable by id**, owner sees the notice.
8. **Directory search for a PRIVATE set's exact title returns nothing** — the `AND` composition, live. This is the one that catches the widened-OR defect, and it is the single most important step in this gate.

**Owed to the human, not agent-runnable:** whether the Instrument chassis actually reads as less generic. No test covers it, and it is the whole point of Phase 0.
