# Set visibility — private vs. link-shareable

**Date:** 2026-08-08
**Status:** design, approved
**Resolves:** the "Set/card visibility is undecided" item in `CLAUDE.md`'s Future Considerations, and the explicitly-deferred `startQuizAttempt` finding in `docs/superpowers/specs/2026-08-04-answer-analysis-display-design.md`
**Sibling:** deletion & forgetting (not yet designed — see §9)

---

## 1. The decision

Sets are **private by default** and the owner may toggle any set to
**link-shareable**. There is no public directory, no discovery, and no third
state. A link-shareable set is readable by anyone holding its id, including
signed-out visitors; studying it requires an account.

This is a product decision that has been open since 2026-08-04. It was
deliberately not answered inside Spec 2b's bug-fix pass, because the
open-by-id behaviour is consistent across the whole app rather than an
isolated oversight, and patching one call site would have been inconsistent
rather than a fix.

## 2. What is broken today

Every one of these was verified in code on 2026-08-08, not inferred:

| Path | Current gate | Exposure |
| --- | --- | --- |
| `src/app/sets/[id]/page.tsx:22` | **none** | full set, signed-out |
| `src/app/sets/[id]/match/page.tsx:22` | **none** | full set, signed-out |
| `src/app/sets/[id]/quiz/page.tsx:12` | any session | full set |
| `src/app/sets/[id]/review/page.tsx:23` | any session | full set |
| `src/app/sets/[id]/print/page.tsx:24` | any session | full set |
| `src/actions/quiz.ts:356` (`startQuizAttempt`) | any session | full set + writes an attempt |
| `src/actions/quiz.ts:250` | any session | full set |
| `src/actions/card-autocomplete.ts:20` | any session | full set, fed to an AI prompt on the caller's key |

`src/app/sets/[id]/page.tsx` computes `isOwner` but uses it only to gate the
Edit and Delete buttons, never visibility.

**Not broken, checked and confirmed:** `sets/[id]/edit/page.tsx` verifies
ownership and redirects; `updateSet`/`deleteSet`, `import-spreadsheet.ts`,
and `uploads.ts` all check `userId`; the set list (`src/app/sets/page.tsx`)
scopes to `userId`, so there is no discovery surface. **The exposure is
read-by-id only — there is no write exposure.** That materially lowers the
severity and is why this is a normal spec rather than a hotfix.

`card-autocomplete.ts` is a new finding from this design pass, not previously
recorded anywhere.

## 3. Data model

```prisma
model Set {
  // ... existing fields
  /// Vocabulary: SET_VISIBILITIES in src/lib/sets/visibility.ts (private|link).
  /// Import that const rather than writing a literal — this is a String
  /// column, so a typo compiles and never matches.
  visibility String @default("private")
}
```

A `String` with a shared `as const`, not a Prisma enum, following
`CARD_KLP_STATUSES` (`src/lib/cards/klp-status.ts`) and `AI_TASKS`
(`src/lib/ai/model-routing.ts`). The project's established pattern for a
persisted closed vocabulary is a single `as const` with the type derived from
it, plus a narrowing function at the DB boundary and a test pinning the set.

```ts
// src/lib/sets/visibility.ts
export const SET_VISIBILITIES = ['private', 'link'] as const
export type SetVisibility = (typeof SET_VISIBILITIES)[number]
export function toSetVisibility(raw: string): SetVisibility  // unknown -> 'private'
```

`toSetVisibility` degrades an unrecognised value to **`private`**, not
`link`. An unreadable value must fail closed: the cost of wrongly hiding a set
is an annoyed owner, the cost of wrongly exposing one is the bug this spec
exists to close.

The migration is additive — one `ALTER TABLE ... ADD COLUMN ... DEFAULT
'private'`. Every existing row becomes private, which closes the current
exposure rather than grandfathering it. New sets default to private, so
sharing is always an explicit act.

## 4. The predicate, and why it is a query fragment

```ts
// src/lib/sets/visibility.ts — pure, no DB import
export function canReadSet(
  set: { userId: string; visibility: string },
  viewerId: string | null,
): boolean

// src/lib/sets/visibility.ts — a Prisma `where` fragment, not a post-hoc check
export function readableSetWhere(viewerId: string | null): Record<string, unknown>
//   viewerId ? { OR: [{ userId: viewerId }, { visibility: 'link' }] }
//            : { visibility: 'link' }
```

**The fragment is the important half.** Every bug in §2 is the same shape:
`findUnique({ where: { id } })` followed by an owner check that is absent, or
present but gating only the UI. A post-hoc `canReadSet(set, viewer)` call
reproduces exactly that hazard — it is one forgotten line away from a leak,
and the forgotten line looks like working code.

Pushing the rule into the `where` inverts the failure mode: a call site that
forgets it returns *nothing*, which is a visible bug, rather than *everything*,
which is a silent one. This is the same argument `buildCardScopeWhere`
(`src/lib/memory/scope.ts`) already makes for scope semantics — one definition,
embedded in the query, so per-model duplication cannot drift.

`canReadSet` still exists, for the two places that legitimately hold a row
already: the asset route (which reaches the set through a join) and the UI,
which needs to render an owner-only toggle.

**One mechanical caution for the implementer.** `readableSetWhere` returns a
bare `OR` for a signed-in viewer, so spreading it into a `where` that already
has its own `OR` silently replaces that `OR` rather than combining with it.
None of §5's call sites has one today — every one of them queries by `id`
alone — but the set list (`src/app/sets/page.tsx`) does use `OR` for search,
and is deliberately not in the table because it is already scoped to `userId`.
If a future call site needs both, they must be combined under an explicit
`AND: [...]`, never merged by spread.

**404, never 403.** A distinguishable "forbidden" response confirms to an id-
prober that a private set exists. Every enforcement point returns the same
not-found result it would for a genuinely absent id. `notFound()` in pages,
`{ success: false, error: 'Set not found' }` in actions — matching the string
those actions already return, so the two cases are indistinguishable from
outside.

## 5. Enforcement points

| Site | Change |
| --- | --- |
| `sets/[id]/page.tsx` | `where: { id, ...readableSetWhere(viewerId) }` |
| `sets/[id]/match/page.tsx` | same |
| `sets/[id]/quiz/page.tsx` | same |
| `sets/[id]/review/page.tsx` | same |
| `sets/[id]/print/page.tsx` | same |
| `quiz.ts` — `startQuizAttempt` | same |
| `quiz.ts:250` | same |
| `/api/assets/[id]` GET | resolve asset → card → set; allow when `canReadSet` |
| `card-autocomplete.ts` | tighten to **owner-only** (see below) |
| `klp.ts` — `extractKlpsForCards` | scope widens from owned to readable (§7) |

Write paths — `updateSet`, `deleteSet`, uploads, spreadsheet import, the edit
page — stay **owner-only** and are unchanged. Visibility governs reading; it
never grants writing.

**Two call sites need a `viewerId` they do not currently have.**
`sets/[id]/match/page.tsx` calls no `auth()` at all, and `sets/[id]/page.tsx`
calls it but may hold a null session — both must pass `session?.user?.id ??
null` and rely on `readableSetWhere`'s anonymous branch rather than
short-circuiting on a missing session. Signed-out access to a link-shared set
is a requirement (§1), so an early `if (!session) notFound()` in either page
would be a regression, not a safety measure. The three pages that currently
require a session (`/quiz`, `/review`, `/print`) keep that requirement —
studying and printing need an account regardless of visibility.

**`card-autocomplete` tightens rather than widens.** It is an authoring aid:
its output is only useful while editing, and editing is owner-only. Granting
it to readers would let anyone with a link spend their own AI budget to have
a model paraphrase someone else's set, for no legitimate purpose. Owner-only
is both safer and simpler.

## 6. Assets

`/api/assets/[id]` currently requires a session and `asset.userId ===
session.user.id`. Left alone, every image, audio file and video on a shared
set 403s for the recipient and 401s for a signed-out viewer — so "view a
shared set" would silently mean "view a shared *text-only* set", with broken
placeholders and nothing on screen explaining why.

The GET handler resolves the asset to its card's set and allows the fetch when
`canReadSet` passes, using the **same predicate** as the pages so the two
cannot drift. An asset not yet linked to any set (uploads create the row
before it is attached) stays owner-only — there is no set to consult, and the
existing owner check is correct for that case.

`Cache-Control` moves from `private` to `public` **only** for assets on
link-shareable sets. A shared asset served with `private` is re-fetched per
viewer for no benefit; an owner-only asset served with `public` could be
cached by a shared proxy, which is precisely the leak this spec closes.

DELETE is unchanged: owner-only.

## 7. KLPs on a set you do not own

**Decision: viewers may generate KLPs, on their own credentials, but only to
fill a gap.**

`extractKlpsForCards` is currently scoped `where: { set: { userId } }`, and its
doc comment correctly calls that an authorization boundary — extraction is a
*write*: `writeKlpVersion` supersedes live `CardKlp` rows and mutates
`Card.klpStatus`, `klpVersion`, `klpSourceHash`, `klpError`.

Without viewer extraction, a non-owner's quiz has no KLPs, so True/False falls
back, MC distractors degrade, and Spec 2a records every answer as `no_klps` —
polluting *the viewer's own* learner profile with analysis that could not run.
That is a bad enough outcome to justify widening the boundary.

But widening it unconstrained means anyone holding a link can replace the
propositions the owner's entire error-analysis substrate is built on, using
whatever model their credential happens to point at. Two constraints remove
that without blocking viewers:

1. **Gap-fill only.** A viewer may extract for a card with no live `CardKlp`
   rows. A viewer may **never** supersede a card whose extraction already
   succeeded. The owner's work is never overwritten; a viewer is never blocked
   on a card nobody has processed.
2. **A viewer's failure never marks the owner's card.** `klpStatus: 'failed'`,
   `klpStatus: 'skipped'` and `klpError` are written only on the owner's path.
   A viewer's failed extraction degrades for that viewer and leaves the card
   exactly as it found it — otherwise a viewer with no AI credential would
   stamp `skipped` on a stranger's card and suppress the owner's own retry UI.

Owner behaviour is completely unchanged: owners still re-extract on edit, and
staleness still supersedes.

**Concurrency.** Owner and viewer can now race on one card. `writeKlpVersion`
already retries once on the `@@unique([cardId, version, index])` collision
(`src/actions/klp.ts:203-208`) — that path was written for the existing
save-vs-`ensureKlpsReady` race and handles a cross-user race identically, since
it turns on the card, not the caller. Constraint 1 also shrinks the window: two
gap-fills on the same card are the only collision possible, and the loser's
retry sees the winner's committed rows and returns them.

**History is safe.** The hardening pass established that superseded `CardKlp`
rows persist for tag attribution, so nothing a viewer does can orphan the
owner's `AnswerKlpResult` history.

**Cost.** AI runs on the acting user's credentials — `generateJson({ userId })`
already works this way. A viewer with no credential simply gets no extraction,
which constraint 2 makes harmless.

## 8. UI

**Owner, on the set detail page:** a visibility control with the two states
named plainly ("Only me" / "Anyone with the link"), and a copy-link button that
appears only in the shared state. Switching to shared must state what it means
in one line — anyone with the link can view and study this set, but not edit
it — rather than relying on the label alone.

**Non-owner, on a shared set:** a banner naming whose set it is and stating
that their progress is their own. Study writes are keyed `(userId, cardId)`, so
this is literally true — a viewer's confidence, events and quiz history never
touch the owner's — but it is not something a user should have to infer.

Study activity entry points render for viewers exactly as they do for owners.
Edit and Delete remain owner-only, as they already are.

## 9. Explicitly out of scope

- **Copy-to-my-account.** A "duplicate this set" action is the cleanest
  ownership story for a recipient, but it is a real feature — card, content
  block, category and asset copying, with asset re-pointing — not a visibility
  toggle. Deferred deliberately.
- **A public directory or search.** No discovery surface. `src/app/sets/page.tsx`
  stays scoped to `userId`.
- **Per-card or per-category visibility.** The set is the unit.
- **Revocable or expiring share tokens.** Visibility is a boolean on the set;
  un-sharing is toggling it back. A rotating token per share is a different and
  larger design.
- **Deletion and forgetting** — the sibling spec, covering granular per-attempt
  and per-answer reset, and extending `forgetCard`/`forgetSet` to the quiz
  evidence and derived learner state they currently leave behind. It shares no
  machinery with this spec.

## 10. Testing

**The predicate** is pure and table-driven: the full cross product of
{owner, other signed-in user, anonymous} × {private, link}, plus
`toSetVisibility` narrowing and its fail-closed default. Six readability cases,
all cheap.

**Every enforcement point gets its own test**, and this is the part that
matters. A correct predicate proves nothing about a call site that forgot to
use it — forgetting is exactly how all eight of §2's bugs happened. Each site
is asserted twice: a non-owner gets not-found on a private set, and gets the
set on a link-shared one.

**Two regression tests for the specific bugs being closed**, so they cannot
silently return: an anonymous request to `sets/[id]` for a private set, and a
non-owner `startQuizAttempt` against a private set.

**The asset route** is tested for owner/private, non-owner/private (denied),
non-owner/link (allowed), anonymous/link (allowed), and the unlinked-asset case
(owner-only).

**KLP gap-fill** is tested at the boundary: a viewer extracting on a card with
no KLPs succeeds; a viewer extracting on a `ready` card does not supersede it;
a viewer's failure leaves `klpStatus` and `klpError` untouched.

Follow the `vi.hoisted()` + `vi.mock('@/lib/db')` pattern established in
`tests/actions/quiz-summary-analysis.test.ts`, and the existing
`tests/actions/quiz-submit-ownership.test.ts` for the ownership-assertion shape.
