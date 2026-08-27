# Public sets, fork & discovery — design

**Date:** 2026-08-27
**Status:** DESIGNED, NOT STARTED. No plan, no code.
**Branch:** builds on `spec3b-tunable-scoring` (still unmerged).
**Supersedes for execution:** `specs/2026-08-17-sharing-collaboration-and-discovery-design.md`
(the 6c design). That document stays authoritative for **collaborators** (its §2) and for
**"For you"**'s deeper reasoning (its §7); everything else it says is restated here against
the code as it exists on 2026-08-27, which has moved.

---

## §0 Why this document exists when 6c already had one

The 6c design was written on 2026-08-17 and never built. Four things changed under it:

1. **Handles shipped.** `User.handle` / `User.normalizedHandle`, `src/lib/users/handle.ts`,
   and `RESERVED_HANDLES` — which **already reserves `browse`** — all landed with item 6d.
   6c's §4 is DONE. Its build order step 1 is a no-op.
2. **Credentials signup is ON** (item 8, flag flipped 2026-08-24). A public directory now
   lists content to people who can actually arrive. 6c §10 named moderation as "a real
   obligation the moment strangers' content is listed" and left it undesigned. This
   document designs it, because the precondition it was waiting for has arrived.
3. **The KLT topic layer shipped** (item 9). `SetKltNode` did not exist when 6c was
   written. It is per-set placement over a **global** `Klt`, which changes what a fork can
   carry — see §7.4.
4. **The owner scoped this down and then back up.** Collaborators are OUT. Fork is IN.

**Also decided with the owner 2026-08-27 and carried here:** the app-wide IA split the
build queue deferred at its item-9 entry ("a place to EDIT your own sets, separate from a
place to browse and quiz on anyone's", *"should be designed WITH 6c"*). That is §11.

---

## §1 Scope

**In:**

- A third visibility, `public`, and a `/browse` directory (§3, §6).
- `SetView` — "jump back in", covering sets you *opened*, not only sets you *studied* (§5).
- **Fork** — "make my own copy", including blob duplication (§7).
- A real homepage: Jump back in · Recommended · Your sets (§8, §9).
- **Report + unlist** moderation (§10).
- Navigation: Home / Browse / Library (§11).
- **Phase 0, the "Instrument" chassis** — the token and primitive work every new surface
  above is built in, so it is not built twice (§2).

**Out, and deliberately:**

- **Collaborators / "Editable by."** 6c §2 stands unchanged and unbuilt. It is the largest
  privilege change in that document and nothing here needs it.
- **The set-page Study / Knowledge / Analysis restructure**, and the Atlas visual work on
  those surfaces. Its own design, written after this one lands.
- **Ownership transfer**, **collaborator invitations**, **`/{handle}` profile pages**.

---

## §2 Phase 0 — the "Instrument" chassis

Sequencing decision taken with the owner: the visual direction is settled *before* the
sharing work, not after, so `/browse` and the homepage are built once.

**The diagnosis.** The owner's complaint is that the app "feels a bit boring, like
Quizlet" and "has an AI feel". The Ledger design system
(`specs/2026-08-15-design-system-and-scope-redesign-design.md`) already fixed the *root*
problem it was built for — every token was zero-chroma, so components reached for raw
`text-blue-500`. What it did not do is give the app a **voice**. The subject matter here
is a graph of what a person knows, moving over time: KLPs, concept trees, mastery
posteriors, forgetting curves. Exactly one surface shows that through — the concept
canvas — and it is the one surface the owner singled out as good. Everything else renders
that subject as a generic grid of shadowed cards, which is the shape every AI-scaffolded
CRUD app converges on.

**The direction, chosen by the owner from three options: "Atlas chassis + Instrument data."**

- **Instrument** is the chassis, and it is what Phase 0 builds. Dense editorial layout:
  hairline rules instead of shadowed cards, a real display type scale on Fraunces (which
  is already loaded and currently only ever used at `text-3xl`), mono tabular figures on
  every metric, a tighter spacing scale. The reference is a data terminal or a broadsheet,
  not a SaaS dashboard.
- **Atlas** is the spatial language for knowledge surfaces — node-and-edge territories,
  mastery as shading. Phase 0 ships **only one piece of it**: the set glyph in §6.3. The
  rest belongs to the set-views design.

**What Phase 0 actually changes:**

| Change | Where |
| --- | --- |
| Type scale: display / title / body / caption / metric, with Fraunces at display+title | `globals.css` `@layer base` |
| Ruled section primitive (`<Section>`), replacing shadcn `Card` on list and detail surfaces | `src/components/ui/section.tsx` (new) |
| Border weight down to a hairline; radius down; surface elevation removed | tokens in `globals.css` |
| `.metric` extended into a real component with unit and null handling | `src/components/ui/metric.tsx` (new) |

**Scope of the conversion, chosen by the owner: "core journey + tokens."** Home, `/browse`,
Library, the set views, and the study modes get converted. Tokens change globally, so
`/settings/*`, `/account`, `/profile/*` and the auth pages inherit the new palette and type
without being individually redesigned.

**The cost the owner accepted:** between this spec and the set-views spec, the app is
visibly half-converted. New surfaces look new; the set page and study modes look old.

**Explicitly NOT in Phase 0:** shadcn is not removed, `Card` is not deleted, and the 175
existing lint problems are not touched. This is a re-skin of the surfaces named above, not
a component-library migration.

---

## §3 Visibility becomes three-valued

```ts
export const SET_VISIBILITIES = ['private', 'link', 'public'] as const
```

- `private` — owner only.
- `link` — anyone holding the id. **Not listed anywhere.**
- `public` — anyone, **and listed in `/browse`**.

`link` and `public` are NOT collapsed, for 6c §1's reason: they answer "may this be read?"
and "should this be advertised?", and a learner who shared a study-group link did not ask
to be published. Collapsing them publishes every already-shared set on deploy.

`toSetVisibility` keeps failing closed to `private`. **`public` must never be a degradation
target**, and a test asserts an unrecognised value does not resolve to it.

### 3.1 The `OR` trap is worse than 6c thought, and the fix is different

6c §1 warns that `readableSetWhere` returns a bare `OR` for a signed-in viewer, so
spreading it into a `where` that already has one **replaces** it. True. But reading the
module as it stands adds a second half 6c did not have:

```ts
// today
export function readableSetWhere(viewerId: string | null): Record<string, unknown> {
  if (viewerId === null) return { visibility: 'link' }          // NOT an OR
  return { OR: [{ userId: viewerId }, { visibility: 'link' }] } // an OR
}
```

The naive extension makes the signed-out branch an `OR` too, so **both** branches acquire
the hazard, and the directory — whose search is itself an `OR` over title/description — is
the first call site in the app to have one of its own.

**Use `in`, not a second `OR`:**

```ts
const READABLE_VISIBILITIES = ['link', 'public'] as const

export function readableSetWhere(viewerId: string | null): Record<string, unknown> {
  if (viewerId === null) return { visibility: { in: READABLE_VISIBILITIES } }
  return { OR: [{ userId: viewerId }, { visibility: { in: READABLE_VISIBILITIES } }] }
}
```

The signed-out branch stays a single non-`OR` key, so it composes safely by spreading.
The signed-in branch keeps exactly the one `OR` it has today — no new hazard is created.

**The composition rule still holds and is still mandatory:** every read with its own
multi-field predicate composes as `{ AND: [readableSetWhere(v), { OR: [...] }] }`, never by
spreading both at one level. A test asserts the composed shape, because getting it wrong
widens the search to every set in the database **and returns plausible results while doing
it** — which is why it cannot be caught by looking at the page.

### 3.2 `canReadSet` gains `public`

`canReadSet` (the row-in-hand variant, used by `/api/assets/[id]` and by the UI) must
admit `public`. Missing this renders every public set's media as a broken placeholder —
the failure is visible, which is the only reason it is survivable.

### 3.3 Publishing requires a handle

`setSetVisibility(setId, 'public')` refuses when the owner has no `handle`, because §6
credits creators by handle and a directory row with no author is not shippable. The
`VisibilityMenu` shows the `public` option with an inline "choose a handle first" step
rather than a disabled row with no explanation.

`private` and `link` never require a handle. Publishing is the only act that needs a public
identity, which is 6c §4's rule and the reason handles are optional at all.

---

## §4 Schema

```prisma
// on Set
visibility      String    @default("private")   // now private|link|public
/// Operator moderation (§10). Independent of `visibility` ON PURPOSE: flipping
/// visibility is something the OWNER can undo in one click, so it cannot carry a
/// decision made ABOUT the owner. Excludes the set from /browse; does not affect
/// readability by id.
listingBlocked  Boolean   @default(false)
publishedAt     DateTime?                        // first transition to `public`

/// Fork attribution — denormalized AT FORK TIME, never rendered from the FK. §7.3
forkedFromId     String?
forkedFromTitle  String?
forkedFromHandle String?

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

model SetReport {
  id         String   @id @default(cuid())
  setId      String
  reporterId String?
  reason     String   // REPORT_REASONS — src/lib/sets/moderation.ts
  detail     String?  @db.Text
  status     String   @default("open") // open | actioned | dismissed
  createdAt  DateTime @default(now())

  @@unique([setId, reporterId])
  @@index([status, createdAt])
}
```

`Set.forkedFromId` is a self-relation with **`onDelete: SetNull`** — the link may go dark,
and §7.3 is entirely about surviving that.

---

## §5 `SetView` — "jump back in"

**Decision, taken with the owner over the 6c design's version.** 6c §6 defines Recents as
sets you last *studied*, reusing `loadSetStudySummaries`. That does not solve the problem
the owner actually described: you open a set someone shared, read it, never answer a
question, and the link is gone forever. Recents is keyed on **viewing**.

### 5.1 An upsert, not a log

`@@unique([userId, setId])`, one row per pair, `viewedAt` overwritten. This is a
"jump back in" list, not history. Real history already exists in `StudySession` and
`StudyEvent`, and a second append-only table would be a second notion of activity that can
disagree with them.

### 5.2 Written from `after()`, never during render

The write happens in `src/app/sets/[id]/page.tsx` via `after()` from `next/server`
— the same pattern KLP extraction already uses. Writing during a Server Component's render
is unsafe under caching and PPR, and this write must never be able to fail the page: a
recents row is worth strictly less than the set the reader came for.

Signed-in only. There is nowhere to key an anonymous visitor and no session to show it back
in.

The owner's own sets are recorded too. Opening your own set is the most common way you
"jump back in", and excluding it would make the block empty for the account that has the
most to show.

### 5.3 What it does NOT do

`SetView` is not evidence. It never reaches the learner model, never affects mastery, never
appears in `StudyEvent`. It is a navigation convenience.

---

## §6 `/browse` — the directory

### 6.1 The query

```ts
{
  AND: [
    readableSetWhere(viewerId),
    { visibility: 'public', listingBlocked: false },
    ...(q ? [{ OR: [
        { title:       { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ] }] : []),
  ]
}
```

`readableSetWhere` is present even though `visibility: 'public'` appears to make it
redundant. It is not redundant, for 6c §5's reason: the day someone adds "also show my own
private sets here", a hand-rolled filter leaks and a composed one does not. **Never
hand-roll the predicate.**

**Cursor-paginated**, not offset — offset paging drifts as sets are published mid-scroll.
Cursor on `(publishedAt, id)`.

### 6.2 What a row shows

Title · description · card count · category chips · `@handle` · `Make my own copy` (§7).

Fork attribution renders per §7.3 when the row is itself a fork.

**Sort:** most-forked, then newest. Deliberately **not** most-studied — study counts come
from `StudySession` rows belonging to individual learners, and turning private study
behaviour into a public ranking signal is a privacy decision nobody has made.

### 6.3 The set glyph — the one piece of Atlas in this spec

Each row carries a compact node-cluster glyph instead of a stock icon: a small
deterministic constellation derived from the set's **category counts**, which the row
already loads.

**Derived from category counts ONLY, never from `SetKltNode`.** Loading a concept tree per
row in a paginated list is how this becomes slow, and the visual difference at 48px is
nil. Deterministic from `setId` + category names, so a set's glyph is stable across
renders and pages.

---

## §7 Fork — "make my own copy"

**Decided with the owner 2026-08-27** (reversing this document's own initial
recommendation to defer it): a public set nobody can adapt is close to useless, so fork
ships with the directory. The 6c §3 decision stands — **the copy is the forker's
outright**. They edit it freely and control its visibility like any set of theirs,
including publishing it. Attribution is carried, not enforced.

### 7.1 What is copied

| Copied | Not copied |
| --- | --- |
| Cards — term, definition, position | `CardProgress`, `ConfidenceEvent` |
| `CardContentBlock` rows | `StudyEvent`, `StudySession`, `QuizAttempt`, `QuizAnswer` |
| `CardCategory` + assignments | `KlpState` and every analysis row |
| `CardAsset` rows **and their blobs** (§7.2) | `CardKlp` — re-extracted, §7.5 |
| `SetKltNode` placements (§7.4) | `SetView`, `SetReport` |

**The fork is created `private`, always.** Visibility is never inherited — a fork of a
public set that auto-published would publish a copy of someone else's work under a new
name without a single deliberate act.

The title is copied verbatim, and the attribution line (§7.3) is what disambiguates it.
Appending "(copy)" was considered and rejected: it is wrong the moment the fork diverges,
and the forker renames it in one click if they care.

Forking **your own** set is allowed and is simply a duplicate. It is not a special case
worth a branch.

### 7.2 Assets MUST be duplicated, and the defect is confirmed in the code

This is the strongest finding 6c made, and reading
`src/app/api/assets/[id]/route.ts` on 2026-08-27 confirms it is still live:

```ts
contentBlocks: {
  select: { card: { select: { set: { select: { userId: true, visibility: true } } } } },
  take: 1,   // <-- here
},
```

Permission is decided by **whichever `CardContentBlock` row Postgres happens to return
first**. That is correct today only because every block using an asset lives in one set. A
fork that *shares* the asset row puts Alice's card and Bob's card in the same
`contentBlocks` list, and the permission answer becomes non-deterministic: Bob's private
fork could make Alice's asset readable, or Alice's set could gate Bob's.

Second, independent reason: `CardAsset.setId` is `onDelete: Cascade`. Alice deleting her
set deletes the asset row and every fork loses its media.

So a fork **copies the `CardAsset` row and copies the blob**. `storageKey` is `@unique`
(it holds the blob URL, per `src/actions/uploads.ts`), so sharing is not even
representable.

**Mechanics.** `@vercel/blob@^2.5.0` exports `copy(fromUrl, toPathname, { access })`, so
this is a server-side copy — no download-and-re-upload. Ordering:

1. Copy every blob **first**, outside any transaction, collecting new URLs. A network call
   inside a Postgres transaction holds it open for the duration of the copy, which for a
   25 MB video set is seconds.
2. Then run the row creation in one `prisma.$transaction`.
3. If the transaction throws, `del()` the copies in the catch.

**Known residual:** if the process dies between step 1 and step 3, the copied blobs are
orphaned. Accepted, and recorded in §14 rather than solved — a reconciliation job is a
larger piece of work than the feature.

### 7.3 Attribution renders from the denormalized fields, never the FK

Three states the FK alone cannot survive, all from 6c §3:

1. **Source deleted** → `SetNull` erases the link and the credit with it.
2. **Source made private** → rendering "from Alice's *Merger Model Secrets*" **leaks the
   title and existence of a set Alice just made private**, on a page Alice does not
   control. This is the privacy defect in this feature.
3. **Source renamed** → the credit should describe what was actually forked.

**Rule.** Always render `forkedFromTitle` / `forkedFromHandle`. Render it as a **link**
only when `forkedFromId` still resolves *and* the source is readable **by the current
viewer**, evaluated through `readableSetWhere` like any other read. Otherwise plain text.
The credit line therefore never asserts the source still exists or is still readable.

### 7.4 The concept tree DOES carry — a change from 6c

`SetKltNode` did not exist when 6c was written. Reading it now:

```prisma
model SetKltNode {
  setId String; kltId String; parentKltId String?; depth Int; ancestorIds String[]
  color String?; icon String?
  @@unique([setId, kltId])
}
```

The node points at a **global `Klt`**, not at a per-set concept. Only the *placement* is
per-set. So a fork copies `SetKltNode` rows verbatim with a new `setId`, and the hierarchy
— which is genuinely authored work, often the most valuable thing in a mature set —
carries perfectly with no id remapping at all.

`KlpTopic` (KLP → `Klt`) is **not** copied, because the KLPs it references are not copied.
The re-extraction in §7.5 produces the fork's own `KlpTopic` rows through the existing
pipeline, and they land against the skeleton the copied nodes already provide.

### 7.5 KLPs are re-extracted, and every card starts `pending`

Copying `CardKlp` rows would carry a `version` history describing edits made to *someone
else's* card. The versioning exists so history stays truthful, and copied history is not
(6c §3).

New cards get `klpStatus: 'pending'` and the existing `after()`-triggered extraction
handles them.

**This answers 6c §10's open question about `skipped` cards:** everything becomes
`pending`, uniformly. `skipped` means "no AI key at author time"; the forker may have one,
and a uniform starting state is self-healing where a copied one is not. The consequence —
the fork's KLPs may differ from what was previewed on the source — is correct, since they
are the forker's KLPs extracted under the forker's model.

### 7.6 The size cap, which 6c left as an open number

Copying blobs makes forking genuinely expensive. Two gates, checked **before** any copy
begins so a refusal costs nothing:

- `FORK_MAX_CARDS = 1000`
- `FORK_ASSET_BUDGET_BYTES = 100 MB` — the summed `sizeBytes` of assets reachable from the
  set's content blocks.

Both are exported consts in `src/lib/sets/fork.ts` with the arithmetic as a **pure,
tested function**, per the repo convention that the risky arithmetic is unit-testable
without a database. A refusal names which gate failed and by how much; "this set is too
large" with no number is not actionable.

100 MB is chosen against the existing per-file caps in `src/actions/uploads.ts`
(image 10 / audio 25 / video 25 MB) — roughly four videos or ten images, which is a
generous real set and a bounded copy.

### 7.7 The fork action's guard

`forkSet(setId)` reads the source through `findFirst({ where: { id, ...readableSetWhere(viewerId) } })`.
**Fork is a read of the source and a write to a new set** — it needs no write access to
the source, and must never be given any. It requires a session: there is nowhere to put an
anonymous fork.

---

## §8 The homepage

`/` stops redirecting to `/sets` and becomes three blocks.

1. **Jump back in** — `SetView`, most recent N, resolved through `readableSetWhere` at read
   time. A set you viewed and that later went private must disappear, and the only way to
   guarantee that is to re-authorize on every read rather than trusting the stored row.
2. **Recommended** — §9.
3. **Your sets** — the current `/sets` grid, capped, with "see all" → `/sets`.

**Each block renders nothing rather than an empty shell**, per 6c §6 and the rule `SetCard`
already follows. A new account sees "Your sets" and a create prompt, not three empty
headings.

**Signed out**, `/` is a real landing page: what the app is, a `/browse` teaser of public
sets, and sign in / sign up. Today a signed-out visitor gets redirected to `/sets` and told
"Sign in to see your sets", which is the least informative possible first screen.

`/sets` survives as the full library.

---

## §9 Recommended — and why it is the weakest thing here

**Decided with the owner:** rank public sets by the learner's weak categories, reusing
`getLearnerMetrics` (`src/lib/metrics/read.ts`) rather than inventing a second signal.

Mechanically this needs **no schema change**: `CardCategory` is set-scoped, and
`groupCategoriesByName` (`src/lib/memory/scope.ts:123`) already collapses rows across sets
by `normalizedName`.

**And "the same operation" is doing something much weaker across accounts.** `CLAUDE.md`
records the limit (2026-08-14): a user-authored category is often a **format or modality**
— "label the image", "talking", "vocabulary" — not a subject. Within one account that is
harmless because the learner knows what they meant. Across accounts it is actively wrong:
one user's `vocabulary` is Spanish, another's is finance, and `normalizedName` says they
are the same topic. This is a **string match wearing a concept's clothing**, and the
roadmap's standing rule is that a bad cluster silently corrupts every metric downstream of
it.

**Three mitigations, all mandatory, all shipping together:**

- **Always state the reason** — "Because you're weak on *valuation*". A wrong match then
  reads as obviously wrong to the learner instead of as a mysterious ranking. Cheapest and
  most important of the three.
- **Require real evidence on both sides.** Only categories clearing the learner's own
  `MetricThresholds.minObservations` qualify, and only categories carried by ≥ 3 cards in
  the target set. A one-card coincidence must not surface a whole set.
- **Nothing here writes.** Recommended is a recommendation surface, not evidence. It never
  reaches the learner model, and a test asserts the module has no write path.

Excludes sets you own and sets you have already forked.

**Four empty states, not one**, mirroring `diagnoseEmptyState`
(`src/lib/metrics/coverage.ts:131`): no public sets exist yet; you have no categorized
cards; your evidence is below your own floor; nothing matched. The remedies differ, and
merging them produces the "is this broken?" confusion the 3B gate hit twice.

---

## §10 Moderation — report + unlist

**Decided with the owner 2026-08-27.** 6c §10 left this undesigned; `CREDENTIALS_SIGNUP_ENABLED`
is now ON, so the directory will list content from people the owner has never met. The
minimum that avoids a manual database edit as the first response to a problem:

**Report.** Any signed-in viewer may report a public set: a closed `reason` vocabulary
(`REPORT_REASONS` in `src/lib/sets/moderation.ts` — an `as const`, same rule as
`SET_VISIBILITIES`, because this is a `String` column) plus optional detail.
`@@unique([setId, reporterId])` makes it idempotent, so a report button cannot be used to
flood the table.

**Unlist.** An operator — the existing `KLT_EDITORS` allowlist (`src/lib/klt/editors.ts`),
which already has exactly the right posture: *"unset means NOBODY, never everybody"* — sets
`Set.listingBlocked = true`. The set vanishes from `/browse` and stays readable by id.

**Why `listingBlocked` and not just flipping `visibility` back to `link`:** the owner can
change `visibility` in one click, silently, and would immediately undo the moderation
decision without ever being told one was made. A separate column carries a decision made
*about* the owner rather than *by* them. The set's own page tells the owner it has been
unlisted.

**Not in scope:** an operator review queue UI, appeals, automated detection, or any
action against the *account*. Reports land in a table an operator reads with a query. That
is a deliberate floor, not an oversight — it is the smallest thing that is not nothing.

---

## §11 Navigation — the IA split the queue deferred

The build queue's item-9 entry deferred the "My Sets / Sets navigation split" and said it
*"should be designed WITH 6c"*. This is that.

| | Today | After |
| --- | --- | --- |
| `/` | redirects to `/sets` | Home (§8) |
| `/browse` | — | the directory (§6) |
| `/sets` | "My Sets" | **Library** — your full collection |
| navbar | My Sets · AI Settings · Learning · Account · + New Set | Home · Browse · Library · Learning · Account · + New Set |

"Library" rather than "My Sets" because the navbar item next to it is now Browse, and
*My Sets* vs *Browse* names the wrong axis — the distinction is yours-vs-everyone's, which
"Library" already carries and which stops being true the moment you fork someone's set into
it. AI Settings moves under Account, which already exists as a page.

---

## §12 Security regression surface

Adding `public` widens **every** existing read path at once. Each needs a decision, and the
default is not obviously "yes" (6c §8):

| Path | May a `public` set be…? |
| --- | --- |
| `/sets/[id]` | readable — **yes**, that is the feature |
| `startQuizAttempt` | quizzable — **yes** |
| `/sets/[id]/match`, `/review` | studiable — **yes** |
| `/sets/[id]/print` | printable — **yes**; note it already had an ownership bug (`78d58e0`) |
| `/api/assets/[id]` | media readable — **yes**, or public sets render broken (§3.2) |
 | `/sets/[id]/concepts` (KLT view) | structure readable — **yes**; `requireSetKltView` already delegates to `readableSetWhere` |
| `card-autocomplete.ts` | a source for AI suggestions — **NO**. Owner-only, unchanged. |
| `/sets/[id]/edit` | editable — **NO**. Owner-only, unchanged. |
| `setSetVisibility` | changeable by a reader — **NO**. Owner-only, unchanged. |

### 12.1 The enforcement checklist must grow

`tests/sets/visibility-enforcement.test.ts` holds `ENFORCED_PATHS`, seven entries today,
and its comment is explicit: *"THIS LIST IS THE ENFORCEMENT CHECKLIST. A path missing from
it is a path nobody is checking — which is exactly how all ten original leaks happened."*

New entries:

- `src/app/page.tsx` (Jump back in + Recommended both read sets by id)
- `src/app/browse/page.tsx`
- `src/actions/sets-fork.ts`
- `src/lib/sets/recommend.ts`

### 12.2 Three new tests this spec owes

1. **Composition shape.** The directory's `where` is an `AND` of `readableSetWhere` and the
   search `OR` — asserted structurally, because the failure mode returns plausible results.
2. **`public` is never a degradation target.** `toSetVisibility('anything-else') === 'private'`,
   already covered, extended to assert it is not `'public'` specifically.
3. **Recommended never writes.** The module's source contains no `prisma.*.create` /
   `update` / `upsert` / `delete`, source-level, in the same style as the enforcement test —
   because what fails in practice is a call site, not a function.

---

## §13 Defects killed on paper

Seven from 6c §9 carry, and this pass adds three.

1. **Asset sharing across a fork makes `/api/assets/[id]` non-deterministic** (`take: 1`
   over a now-multi-set `contentBlocks`). **Confirmed still live in the code**, 2026-08-27.
   Forced the copy-the-blob decision. §7.2
2. **Fork attribution leaks a private set's title** once the source is unpublished. Forced
   denormalized credit + viewer-scoped linking. §7.3
3. **`readableSetWhere`'s `OR` is silently replaced** by the directory's search `OR`. §3.1
4. **Collapsing `link` into `public`** would publish every already-shared set on deploy. §3
5. **Copying `CardKlp` rows** would carry version history describing another person's
   edits, defeating the reason KLPs are versioned. §7.5
6. **Cross-user category matching is a string match, not a concept match.** §9
7. **Relaxing `setSetVisibility`** would let a non-owner publish someone else's set. §12
8. **NEW — the signed-out branch of `readableSetWhere` becomes an `OR` too** under the
   naive extension, doubling the hazard surface at the exact moment the first call site
   with its own `OR` arrives. Fixed with `in` rather than a second `OR`. §3.1
9. **NEW — a fork inheriting the source's visibility** would republish someone else's work
   under a new name with no deliberate act. Forks are always created `private`. §7.1
10. **NEW — moderating by flipping `visibility`** hands the decision straight back to the
    person it was made about, silently. Forced a separate `listingBlocked` column. §10

---

## §14 Build order

Each step is separately shippable and separately verifiable. Do not merge them.

0. **Phase 0 — the Instrument chassis** (§2). Tokens, type scale, `Section`, `Metric`.
   Nothing below is built in the old language.
1. **`public` + the `in` fix + `canReadSet`** (§3). The smallest change that touches the
   security module. Verify the existing enforcement suite still holds **before** adding to
   it.
2. **Publishing gate on handles** (§3.3) + `VisibilityMenu`.
3. **`SetView` + `after()` write** (§5).
4. **`/browse`** (§6), including the set glyph. Read-only, no new write paths.
5. **Fork** (§7). The blob copying is the bulk of the work. Ship the pure size-cap
   arithmetic and its tests first.
6. **Homepage: Jump back in + Your sets** (§8). No new data.
7. **Moderation: report + unlist** (§10).
8. **Recommended** (§9). Last, because it is worth least and is likeliest to be wrong.

Steps 1–4 are worth doing as one unit. Step 8 could legitimately be cut.

---

## §15 Open, not decided

- **Orphaned blobs** when a fork's transaction fails after the copy (§7.2). Accepted; no
  reconciliation job designed.
- **Un-publishing a set that has forks.** Forks survive by design; nothing tells the forker
  the source is gone. Probably fine.
- **`/{handle}` creator pages.** Handles are rendered in the directory but link nowhere.
  `RESERVED_HANDLES` already anticipates this route existing.
- **Report volume.** No rate limit beyond `@@unique([setId, reporterId])`. One report per
  person per set is already a strong bound; revisit if it is not.
- **Collaborators.** 6c §2, unbuilt, unchanged.
- **Does `listingBlocked` survive a fork?** Currently no — the fork is a new set with a
  clean slate. Arguably wrong if the reason for blocking was the *content*.

---

## §16 Verification

**Agent-runnable, against `npm run dev` and the real dev database:**

1. Suite / `tsc --noEmit` / `next build` / lint against the item-9 baselines
   (153 files / 1790 tests; lint 175 problems, unchanged).
2. Publish a set without a handle → refused, with the handle prompt. Claim a handle →
   publish succeeds.
3. A second account sees the set in `/browse`; a signed-out visitor does too.
4. A `private` and a `link` set are **absent** from `/browse` for both.
5. Open a shared set as the second account → it appears under Jump back in on `/`.
   Make the set private as the owner → it **disappears** from the second account's home.
6. Fork a set carrying an image. Assert: a **new** `storageKey`, both assets fetch 200
   independently, and deleting the source set leaves the fork's image intact.
7. Fork attribution: make the source private → the fork's credit line degrades from a link
   to plain text, and the source's title is still shown (it was captured at fork time) but
   nothing new leaks.
8. Report a set as the second account; unlist it with `KLT_EDITORS` set → gone from
   `/browse`, still readable by id, and the owner sees the notice.
9. Directory search with a term matching a **private** set's title returns nothing — the
   `AND` composition test, live.

**Owed to the human, not agent-runnable:** a judgment call on whether the Instrument
chassis actually reads as less generic. That is the whole point of Phase 0 and no test
covers it.
