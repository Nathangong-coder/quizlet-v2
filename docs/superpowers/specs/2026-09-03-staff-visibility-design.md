# Stage 8 rebuild, Spec 1 — Staff visibility: roles, the engine view, and the concept ladder

**Date:** 2026-09-03
**Status:** approved, ready for an implementation plan
**Queue position:** FIRST. See `docs/superpowers/BUILD-QUEUE.md` § "Build order — RE-CUT 2026-09-03 (second pass)".
**Closes:** G10 (no operator surface onto the engine).

## Why this is first

The user's words: *"I want to see if what I think you're building is good or not."*

Specs 2 and 3 rewrite how KLPs are authored and add a relation layer. Both are judged by reading
their output, and today there is nowhere to read it. `KlpEditor` shows one card's key points inside
the set builder; nothing shows a KLP's posterior, its verdict mix, which learners failed it, or
which cards have no KLPs at all. Building the engine before the window onto it means grading the
rebuild by running quizzes and guessing.

So this spec ships the window, **built against the target schema**. `/staff/klps` renders a
Relations column that is empty until Spec 3 fills it, and a verdict-mix column that reads today's
three statuses and widens to thirteen at Spec 5. Later specs light up panels that already exist.

## 1. Roles

### 1.1 The column

`User.role`, a `String` with `@default("learner")`. Vocabulary lives in `src/lib/auth/roles.ts`:

```ts
export const USER_ROLES = ['learner', 'staff', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]
```

A String column plus a const, not a Prisma enum — the same choice `Card.klpStatus` documents. A new
member costs no migration, and the const is what stops a typo compiling. Import it; never write the
literal.

**Two layers, and they must not be merged.** `src/lib/auth/roles.ts` holds only *pure predicates* on
a role value — `isStaff(role)`, `isAdmin(role)`, both returning false for `undefined` and for any
string outside `USER_ROLES`. It imports nothing, least of all Prisma, so a client component may
import it to decide whether to draw a link (§6, edge safety). The *gates* — `requireStaff()`,
`requireAdmin()`, which call `auth()` and return the session or null — live in
`src/lib/staff/access.ts`, alongside `requireSetKltAccess`'s precedent. Only gates authorize;
predicates only render.

| Role | May |
| --- | --- |
| `learner` | Nothing extra. The default, and what every existing row becomes. |
| `staff` | Read the engine: every KLP, any learner's verdicts/tags/misconceptions, coverage. **Read only.** |
| `admin` | All of `staff`, plus granting roles, plus everything `KLT_EDITORS` gates today — preset authoring, set reports, concept editing on sets they do not own. |

`staff` is deliberately read-only. The capability the user asked for is *seeing* the engine; the
capability to mutate other people's structure already exists under `KLT_EDITORS` and stays at the
higher rung. Splitting them now costs one extra member and gives the eventual teacher role
somewhere to land that does not carry write access to strangers' decks.

### 1.2 Freshness is free

`jwtCallback` (`src/lib/auth/session.ts`) already performs one primary-key lookup on **every**
session resolution, to compare `User.sessionVersion` against the token's `sv` claim. Add `role` to
that same `select`.

Consequences, all of them good:

- **No extra query.** The read is already happening on every request that calls `auth()`.
- **No stale staff badge.** The role must NOT be stored as a JWT claim. A claim is written at
  sign-in and lives until the token expires, so revoking staff would leave the person staff for
  days — the exact failure mode `sessionVersion` exists to prevent, reintroduced one field over.
  The role is read fresh and attached to the session on each resolution.
- **Authorization may trust `session.user.role`**, because it was read from the database on this
  request. There is no second gate query to write and no second source of truth to drift.

`sessionCallback` copies `role` onto `session.user` alongside `id`. `sv` stays uncopied, for the
reason that file already gives.

### 1.3 `KLT_EDITORS` is replaced, not shadowed

Two sources of truth for one capability is the bug, not the fix. `src/lib/klt/editors.ts` is
deleted. `isKltEditor(userId)` becomes `isAdmin(session)` in `src/lib/auth/roles.ts`, and the six
call sites move:

| File | Change |
| --- | --- |
| `src/lib/klt/access.ts` | `viaAllowlist` → `viaRole`, computed from the session role, in both `requireSetKltAccess` and `requireSetKltView`. |
| `src/actions/klt-presets.ts` | `isCallerKltAdmin` reads the role. Its doc comment's reasoning is unchanged. |
| `src/actions/set-reports.ts` | Same swap; the `'Not found'` posture stays. |
| `src/app/(app)/concepts/page.tsx` | Same swap; the `notFound()` posture stays. |
| `src/components/klt/ConceptTree.tsx` | Prop rename only (`viaAllowlist` → `viaRole`). |
| `src/app/(app)/sets/[id]/concepts/page.tsx` | Comment only. |

Tests moving with them: `tests/klt/editors.test.ts` (rewritten as `tests/auth/roles.test.ts`),
`tests/klt/access.test.ts`, `tests/app/concepts-page.test.tsx`, `tests/klt/presets.test.ts`.

**`tests/actions/klt-gated-exports-guard.test.ts` must be updated in the same change.** Its
`GATE_PATTERNS` array names `isKltEditor` by regex; leaving it stale would let the guard silently
stop recognising the gate it exists to enforce. The new staff action module (§2.3) is added to the
set of modules that guard covers.

### 1.4 The bootstrap, and the lockout it avoids

**The migration will not read `KLT_EDITORS`.** `prisma migrate deploy` runs inside `npm run build`,
where that variable may not be present — a data migration reading it would stamp nobody, fail
silently, and leave the operator locked out of `/concepts` with no signal that anything went wrong.
A gate that opens on missing config is not a gate; a migration that grants on present config is the
same mistake facing the other way.

Instead:

- The migration adds the column with its default and nothing else.
- `npm run grant-role -- <userId> <role>` (`scripts/grant-role.ts`) is the way in, the same posture
  as `npm run invite`. It writes the `RoleGrant` row and prints the result.
- Recovery from a bad grant therefore never needs a redeploy.

`KLT_EDITORS` is removed from `.env.example` and from the environment notes in
`docs/superpowers/BUILD-QUEUE.md` in the same commit, so no later reader configures a variable
nothing reads.

### 1.5 `RoleGrant`

```prisma
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

`User.role` is the live answer; `RoleGrant` is the history of how it got there. "Who made this
person staff, and when" is the first question asked when something goes wrong, and it is
unrecoverable if not written at the time.

`grantedById` is nullable with `onDelete: SetNull`: a grant made by the CLI has no actor, and
deleting the granter must not delete the record of the grant. Revocation writes `revokedAt` on the
open row and updates `User.role`; rows are never deleted.

## 2. The staff surface

### 2.1 Routes

All under `src/app/(app)/staff/`, all gated, all returning `notFound()` on failure — never a
redirect and never "you are not allowed", following the posture
`src/app/(app)/concepts/page.tsx` already documents: someone who should not know the route exists
must not learn that it does.

| Route | Role | Contents |
| --- | --- | --- |
| `/staff` | staff | Index. Counts: KLPs live/superseded, cards by `klpStatus`, learners with any `KlpState`, sets. Links to the rest. |
| `/staff/klps` | staff | The KLP inspector. §2.2. |
| `/staff/coverage` | staff | Cards by `klpStatus`, per set. §3. |
| `/staff/learners/[id]` | staff | One learner's engine record. §2.4. |
| `/staff/roles` | **admin** | The grant dashboard. §2.5. |

### 2.2 `/staff/klps` — the inspector

Set-scoped by default (a `?set=` param, defaulting to the most recently updated set), with an
install-wide text search across `CardKlp.text` and `label`. Install-wide *listing* with no filter is
not offered: the live corpus is in the thousands, and a page that renders all of them is a page
nobody reads.

Per row:

| Column | Source | Note |
| --- | --- | --- |
| Label / text | `CardKlp.label ?? text` | `label` is nullable by design; fall back, never blank. |
| Card | `Card.term` | Links to the set builder. |
| Kind, weight | `CardKlp.kind`, `.weight` | Weight is audit finding G1 — 92% of live KLPs are 4-5. The column exists so that stops being invisible. |
| Version | `.version`, `.supersededAt` | Superseded rows hidden by default, shown by a toggle. History is the point of versioning; hiding it permanently would waste it. |
| Topics | `KlpTopic` → `Klt.name`, rank | Ranks 1 and 2. |
| Learners | `count(KlpState)` | How many people have any evidence on it. |
| Mean posterior | `avg(KlpState.pKnown)` | **Null when zero learners.** Never rendered as 0 — the codebase's existing rule (`shadeForKnowledge`), and the difference between "nobody knows this" and "nobody has been asked". |
| Verdict mix | `AnswerKlpResult.status`, grouped | Reads today's three; widens to thirteen at Spec 5 with no page change. |
| **Relations** | — | **Empty until Spec 3.** Renders an em dash with a tooltip naming the spec. |

The empty Relations column is the whole point of building this first, and it must ship empty rather
than be omitted: a column added later moves every other column and re-opens layout decisions already
made.

### 2.3 The action module and the `'use server'` hazard

Staff reads live in `src/actions/staff.ts`. **Every export of a file-level `'use server'` module is
a callable RPC endpoint**, not only the ones something imports — the finding recorded in
`tests/actions/klt-gated-exports-guard.test.ts`. An ungated `listAllKlps` export would hand every
KLP in the install to any caller holding the action id.

Therefore:

- Every async export of `src/actions/staff.ts` calls `requireStaff()` (or `requireAdmin()`) in its
  own body. No helper is exported for reuse; shared internals live in `src/lib/staff/*.ts`, a plain
  module with no `'use server'` directive.
- `src/actions/staff.ts` is added to the module list in `klt-gated-exports-guard.test.ts`, and
  `requireStaff`/`requireAdmin` join its `GATE_PATTERNS`.
- No named re-exports from that module, which the guard treats as a violation unconditionally.

### 2.4 `/staff/learners/[id]`

Reachable from `/staff` (a list of learners with any engine evidence) or by id. Shows, for one
learner: `KlpState` rows ordered by `pKnown`, recent `QuizAnswer`s with their `AnswerKlpResult`
verdicts and `AnswerErrorTag` rows, the `analysisStatus` distribution, and derived misconceptions
from the existing `src/lib/metrics/misconceptions.ts`.

It **reuses the learner dashboard's own computations** (`src/actions/learner-dashboard.ts`,
`src/lib/metrics/*`) with the subject id substituted for the session id, rather than
re-implementing them. Two implementations of "what does this learner know" that disagree is worse
than no staff view at all — the staff page would then be reporting numbers the learner never sees.

### 2.5 `/staff/roles`

Admin only. Lists every user with a non-`learner` role, plus a search to find one by handle or
email. Each row: current role, when granted, by whom, and a revoke control. Granting takes a user
and a role.

Two guards, each tested in both directions, because both are the kind that cannot fail visibly:

1. **An admin cannot revoke their own admin role.** The last admin revoking themselves locks the
   install out of `/staff/roles` permanently, recoverable only by CLI. Refuse it at the action.
2. **`requireAdmin()` is checked in the action body, not inferred from the page having rendered.**
   The page gate and the mutation gate are separate reachable surfaces.

## 3. `/staff/coverage`

Cards grouped by `klpStatus` (`pending | ready | failed | skipped`) per set, with `klpError` shown
for failures and `kltStatus` beside it as a separate column — the two passes fail independently and
the schema comment says so; one merged "status" would offer the wrong retry for the wrong failure.

This is the watch-window for Spec 2's backfill. Audit finding G2 was that 166 of 291 cards had never
been extracted, with zero recorded failures, because extraction was demand-driven — a number
invisible from the code and from every existing screen. Once this page exists it is invisible to
nobody.

Retry controls are **not** in this spec. `retryKlpExtraction` exists and is owner-scoped; making it
staff-callable across other people's sets is a write capability, and Spec 2 changes how extraction
works anyway. The page reports; it does not act.

## 4. The concept ladder

### 4.1 What is actually wrong

Nothing is broken. `src/lib/sets/knowledge.ts` sets `PREFERRED_LIST_DEPTH = 2` and
`MAX_CONCEPTS_LISTED = 5`, and `selectConceptListDepth` walks **upward** from the preferred depth
until it finds a rung at or under the cap, falling back to the shallowest populated rung when none
fits. On a tree whose depth-1 and depth-2 rungs both exceed five nodes, that fallback is depth 0 —
which is why the user sees `DCF` and `accounting` and nothing else. The function does exactly what
its doc comment says.

The premise is what is wrong: **a list does not have to pick a rung.** The rung rule exists because
`MasteryList` renders a flat array. Give it a tree and the constraint dissolves.

### 4.2 The change

- `TopicMasteryRow` gains `parentKey: string | null` and `hasChildren: boolean`.
- `selectConceptRows` returns **every** depth, parented, instead of one filtered rung.
  `selectConceptListDepth`, `PREFERRED_LIST_DEPTH` and `MAX_CONCEPTS_LISTED` are deleted along with
  their tests.
- `MasteryList` becomes a disclosure tree: roots expanded, deeper rungs collapsed, chevrons on rows
  with children.
- A **leaf concept expands once more, to the KLPs filed under it** — `label ?? text`, with the
  learner's own `pKnown` where there is evidence. This is the "reveal the KLPs in the list view"
  half of the ask, fetched on expand following `ConceptCards`' precedent: a set with hundreds of key
  points must not load them all to render a collapsed list.

`MasteryList` keeps importing nothing from KLT, as its doc comment requires — `parentKey` is a plain
string, so the shape still describes a hierarchy that the roadmap's KLP-inherent topics can produce
later.

### 4.3 This part is user-facing

Every signed-in user sees the Knowledge tab; the change is not behind a role. It belongs to this
spec because it is the visibility the user asked for, but it lands as a visible product change and
should be reviewed as one.

## 5. Navigation and privacy

A **Staff** rail entry appears only when `session.user.role !== 'learner'`. `railItems` takes the
role and stays pure (`src/lib/shell/nav.ts`); `isRailItemCurrent`'s exact-match rule is unchanged,
so `/staff` does not light up on `/staff/klps` — consistent with every other rail row.

Staff can read any learner's answers, error tags, and misconceptions. That is the requested
capability, and today the install has one operator. Two things follow, and both are in scope:

- `/staff/roles` shows who currently holds each role, so the answer to "who can read my work" is a
  page rather than an environment variable nobody can see.
- **Teachers are not this.** A teacher needs *scoped* reach — their own students — which is a
  `CohortMembership` table in a later spec, not a widening of `role`. Nothing here should be shaped
  to make that widening easy, because that widening is the wrong move.

## 6. Testing

Pure functions, tested directly: `USER_ROLES` membership, and `isStaff`/`isAdmin` against
`undefined`, `''`, and a string outside the vocabulary — all three false. That is the analogue of
the empty-id case `isKltEditor` guards today, and it is the one that matters: a role column read
from a session that failed to resolve must not admit anyone. Then `railItems` by role; the new
parented
`selectConceptRows` on a tree whose rungs all exceed the old cap (the exact live shape that produced
the bug), plus a single-root tree and a forest.

Gates, tested in both directions — a passing assertion that a gate *admits* is worth little without
one that it *refuses*:

- Each `/staff/*` page: `notFound()` for signed-out, for `learner`, and — for `/staff/roles` — for
  `staff`.
- Each `src/actions/staff.ts` export, called by a `learner` session.
- Self-revocation refused.
- `klt-gated-exports-guard.test.ts` extended to cover `src/actions/staff.ts`.

`tests/auth/edge-safety.test.ts` must keep passing untouched: nothing in this spec may be reachable
from `src/auth.config.ts`, and `src/lib/auth/roles.ts` must stay free of Prisma imports so a
component importing it for a display check does not drag the client into the edge bundle.

## 7. Out of scope, deliberately

- **Retry/repair controls on `/staff/coverage`.** Reporting only. Spec 2 owns extraction.
- **Editing KLPs from `/staff/klps`.** `KlpEditor` already edits them per card; a second write path
  into a versioned table is how supersession invariants get broken.
- **Cohorts / teacher scoping.** §5.
- **Anything relational.** The column ships empty. Spec 3.
- **The thirteen verdict labels.** The mix column reads whatever `status` holds. Spec 5.
