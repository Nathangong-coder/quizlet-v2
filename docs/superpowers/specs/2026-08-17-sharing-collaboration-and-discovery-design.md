# Sharing, collaboration & discovery — design

**Date:** 2026-08-17
**Status:** DESIGNED, NOT STARTED. No plan, no code.
**Branch:** would build on `spec3b-tunable-scoring` (still unmerged).

Requested by the user 2026-08-17 while reviewing queue item 6b. Four features that
look separate and are not:

1. **Editable by** — grant another user edit rights on your set.
2. **Make my own copy** — fork any set you can read into a set you own outright.
3. **Public sets** — a third visibility, plus a browsable directory crediting a handle.
4. **Homepage IA** — `/` becomes Recents / For you / Your sets instead of a redirect.

They interlock through one module: `src/lib/sets/visibility.ts`. That module exists
because a security pass found **ten** read-by-id exposures (queue item 1), and every
feature here widens what it permits. That is the reason this is a design first.

---

## §0 What already exists, verified in code

- `SET_VISIBILITIES = ['private', 'link']`. `Set.visibility` is a **String column**, so
  a typo compiles and silently never matches — hence the const.
- `toSetVisibility` **fails closed** to `private` on an unrecognised value.
- `readableSetWhere(viewerId)` is a Prisma `where` fragment spread into every set read.
  The fragment (not a post-hoc predicate) is the point: a call site that forgets it
  returns **nothing**, which is visible, rather than **everything**, which is silent.
- A test asserts there are **no surviving `prisma.set.findUnique` calls** on read paths,
  because `findUnique` cannot accept the fragment.
- `/api/assets/[id]` resolves an asset's visibility through
  `contentBlocks[0].card.set` with **`take: 1`**.
- `User` has `name` (from OAuth) and no handle. `Set` has no fork or collaborator link.

---

## §1 Visibility becomes three-valued

```ts
export const SET_VISIBILITIES = ['private', 'link', 'public'] as const
```

- `private` — owner and collaborators only.
- `link` — anyone holding the id. **Not listed anywhere.**
- `public` — anyone, **and listed in the directory**.

`link` and `public` are deliberately NOT collapsed. They answer different questions —
"may this be read?" and "should this be advertised?" — and a learner who shared a
study-group link did not thereby ask to be published. Collapsing them would silently
publish every already-shared set the moment this ships.

`toSetVisibility` keeps failing closed to `private`. `public` must never be the
degradation target.

### The `OR` trap, which this change makes live

`readableSetWhere` returns a **bare `OR`** for a signed-in viewer, and its own doc
comment warns that spreading it into a `where` that already has one **replaces** it.
Today no call site has its own `OR`. The directory will: search-by-title over
title/description is an `OR`, and so is any multi-field filter.

**Rule:** the directory and every new multi-predicate read compose as
`{ AND: [readableSetWhere(viewerId), { OR: [...search...] }] }`. Never spread both at
one level. A test should assert the composed shape, because getting this wrong widens
the search to every set in the database and returns *plausible* results while doing it.

---

## §2 Collaborators — "Editable by"

```prisma
model SetCollaborator {
  id        String   @id @default(cuid())
  setId     String
  userId    String
  role      String   // COLLABORATOR_ROLES — 'editor' for now
  invitedBy String
  createdAt DateTime @default(now())
  @@unique([setId, userId])
  @@index([userId])
}
```

### Reading and writing are two different questions

Adding a collaborator to a **private** set grants them read. So `readableSetWhere` gains
a collaborator arm, and a **new** `writableSetWhere` appears beside it:

```ts
readableSetWhere(viewerId) // owner OR link OR public OR collaborator
writableSetWhere(viewerId) // owner OR collaborator{role:'editor'}   — signed-in only
```

`writableSetWhere` must be used the same way — as a fragment inside the query, not a
check after it. The whole argument from item 1 applies unchanged.

### Edit is not administer, and conflating them is the defect to avoid

An editor may change **cards, categories, KLPs, title, description**. An editor may
**not**:

- change visibility (publishing someone else's set is not an editing act),
- delete the set,
- add or remove collaborators,
- transfer ownership.

Those stay **owner-only** and need their own guard — `ownedSetWhere`, or an explicit
`set.userId === viewerId`. Three guards, not one, because "can edit" is the middle of
three privilege levels and a two-valued check will inevitably be used for all three.

`setSetVisibility` is the specific call site most likely to get this wrong: it currently
checks ownership, and the temptation when adding collaborators is to relax it to
"writable". It must not be relaxed.

### Call sites that move from owner-only to writable-by

Each needs deciding individually, not sweeping:

| Call site | Today | Should become |
| --- | --- | --- |
| `updateSet` | owner | writable |
| `deleteSet` | owner | **owner** (unchanged) |
| `setSetVisibility` | owner | **owner** (unchanged) |
| card / category / KLP writes | owner | writable |
| `card-autocomplete.ts` | owner (tightened `fae943e`) | writable — it uses the *caller's own* AI credentials, so a collaborator spends their own quota |
| collaborator CRUD | — | **owner** |

---

## §3 Fork — "Make my own copy"

**Decided with the user 2026-08-17:** the copy is Bob's outright. He edits it freely and
controls its visibility like any other set of his, including publishing it. Attribution
is carried, not enforced.

```prisma
// on Set
forkedFromId     String?   // FK, SetNull — the live link, may go dark
forkedFromTitle  String?   // denormalized AT FORK TIME
forkedFromHandle String?   // denormalized AT FORK TIME
```

### Why attribution is denormalized as well as linked

Three states the FK alone cannot survive:

1. **Source deleted** → `SetNull` erases the link, and with it the credit. A fork that
   silently stops crediting anyone is worse than no attribution feature.
2. **Source unpublished or made private** → rendering "from Alice's *Merger Model
   Secrets*" would **leak the title and existence of a set Alice just made private**,
   on a page Alice does not control. This is the privacy defect in this feature.
3. **Source renamed** → the credit should describe what was actually forked.

**Rule:** always render from the denormalized fields. Render it as a **link** only when
`forkedFromId` still resolves *and* the source is readable **by the current viewer**,
evaluated through `readableSetWhere` like any other read. Otherwise render plain text.
The credit line therefore never asserts the source still exists or is still public.

### What a fork copies

| Copied | Not copied |
| --- | --- |
| Cards (term, definition, position) | `CardProgress`, `ConfidenceEvent` |
| `CardContentBlock` rows | `StudyEvent`, `QuizAttempt`, `QuizAnswer` |
| `CardCategory` + assignments | `KlpState` and every analysis row |
| `CardAsset` rows **and their blobs** | `CardKlp` — see below |

**KLPs are re-extracted, not copied.** New cards get `klpStatus: 'pending'` and the
existing `after()`-triggered extraction handles them. Copying `CardKlp` rows would carry
a `version` history describing edits made to *someone else's* card — the versioning
exists so history stays truthful, and copied history is not.

### Assets MUST be duplicated, not referenced — a security defect if not

This is the strongest finding in this design, and it is not obvious.

`/api/assets/[id]` decides permission by walking
`asset.contentBlocks[0].card.set` with **`take: 1`**. That is correct today because every
block using an asset lives in the same set. A fork that **shares** the asset row puts
Alice's card and Bob's card in that same `contentBlocks` list — so the permission answer
depends on **which row Postgres happens to return first**. Bob's private fork could make
Alice's asset readable, or Alice's set could gate Bob's, non-deterministically.

Second, independent reason: `CardAsset.setId` is `onDelete: Cascade`. Alice deleting her
set deletes the asset row, and every fork loses its media.

So forking **copies the `CardAsset` row and copies the blob** to a new `storageKey`
(which is `@unique`, so it cannot be shared anyway). This makes forking a set with media
a genuinely expensive operation — worth a size cap and a progress state, and worth
deciding whether very large sets are forkable at all.

---

## §4 Handles

**Decided with the user:** a handle separate from the OAuth name. Publishing must not
expose someone's real name by default.

```prisma
// on User
handle           String? @unique   // display form, e.g. "Alice_NG"
normalizedHandle String? @unique   // lowercased — the uniqueness key
```

Two columns for the same reason `CardCategory` carries `normalizedName`: `@unique` on
the display form alone lets `alice` and `Alice` coexist and then race for a URL.

- **Required only to publish**, never to use the app. The prompt appears at the publish
  step, where the reason for it is on screen.
- Format: 3–30 chars, `[A-Za-z0-9_]`, with a reserved list (`admin`, `api`, `settings`,
  `sets`, `profile`, `browse`, …) so a handle can never shadow a route.
- Changing it is allowed; old links break, and no redirects ship in v1. Say so at the
  point of change.
- `User.name` is never rendered on a public surface.

---

## §5 Discovery — the directory

A `/browse` route listing `visibility: 'public'` sets. Cursor-paginated (offset paging
drifts as sets are published mid-scroll).

Each result shows: title, description, card count, category chips, `@handle`, and a
**Make my own copy** action.

**Never** hand-roll the predicate. Discovery reads compose
`{ AND: [readableSetWhere(viewerId), …] }` per §1 — even though "public" seems like it
could be filtered directly, because the day someone adds "also show my own private sets
here" is the day a hand-rolled filter leaks.

Sort: most-forked, then newest. Deliberately **not** "most studied" — study counts come
from `StudySession` rows belonging to individual learners, and turning private study
behaviour into a public ranking signal is a privacy decision nobody has made yet.

---

## §6 Homepage

`/` stops redirecting to `/sets` and becomes three blocks:

1. **Recents** — sets you last studied. `loadSetStudySummaries` already computes
   `lastStudiedAt` for exactly this shape; reuse it rather than adding a second notion of
   recency that can disagree with the sets list.
2. **For you** — see §7.
3. **Your sets** — the current `/sets` grid, capped, with "see all".

Each block renders **nothing** rather than an empty shell when it has no content — the
same rule `SetCard` follows for unstudied sets. A new account should see "Your sets" and
a create prompt, not three empty headings.

`/sets` survives as the full library.

---

## §7 "For you" — and the reason it is the weakest thing here

**Decided with the user:** rank public sets by the learner's weak categories, reusing
`getLearnerMetrics` rather than inventing a second signal.

Mechanically this works with **no schema change**: `CardCategory` is set-scoped, and
`groupCategoriesByName` already collapses rows across sets by `normalizedName`. Matching
a learner's weak `normalizedName` values against public sets' category names is the same
operation Spec 3C already does within an account.

**The problem is that "the same operation" is doing something much weaker across
accounts, and this must be designed around rather than discovered later.**

`CLAUDE.md` already records the limit (2026-08-14): a user-authored category is often a
**format or modality** — "label the image", "talking", "vocabulary" — not a subject. Within
one account that is harmless, because the learner knows what they meant. Across accounts
it is actively wrong: one user's `vocabulary` is Spanish, another's is finance, and
`normalizedName` says they are the same topic. Cross-user category matching is a **string
match wearing a concept's clothing**, and the roadmap's standing rule is that a bad
cluster silently corrupts every metric downstream of it.

Three mitigations, all of which should ship together:

- **Always state the reason** — "Because you're weak on *valuation*". A wrong match then
  reads as obviously wrong to the learner instead of as a mysterious ranking. This is the
  cheapest and most important of the three.
- **Require real evidence on both sides.** Only categories clearing the learner's own
  `MetricThresholds.minObservations` qualify, and only categories carried by ≥ N cards in
  the target set. A one-card coincidence must not surface a whole set.
- **Never let "for you" feed anything back into the learner model.** It is a
  recommendation surface, not evidence. Nothing here writes.

Recommendations must also exclude sets you own, already forked, or previously dismissed.

**Empty states are four, not one**, mirroring `diagnoseEmptyState` (`src/lib/metrics/coverage.ts`):
no public sets exist yet; you have no categorized cards; your evidence is below your own
floor; nothing matched. The remedies differ and merging them produces the "is this broken?"
confusion the 3B gate hit twice.

---

## §8 Security regression surface

Adding `public` widens **every** existing read path at once. Each needs a decision, and
the default is not obviously "yes":

| Path | Should a public set be…? |
| --- | --- |
| `/sets/[id]` | readable — yes, that is the feature |
| `startQuizAttempt` | quizzable — yes |
| `/sets/[id]/print` | printable — yes; note it already had an ownership bug (`78d58e0`) |
| `/api/assets/[id]` | media readable — yes, or public sets render broken |
| `card-autocomplete` | source for AI suggestions — **no**, keep to writable-by |
| `/sets/[id]/edit` | editable — **no**, writable-by only |

The existing "no `set.findUnique` on read paths" test must be extended to cover the
directory, the homepage blocks and the fork action. A new equivalent should assert no
**write** action reaches a set without `writableSetWhere` or an owner check.

---

## §9 Defects killed on paper

1. **Asset sharing across a fork makes `/api/assets/[id]` non-deterministic** (`take: 1`
   over a now-multi-set `contentBlocks`). Forced the copy-the-blob decision. §3.
2. **Fork attribution leaks a private set's title** once the source is unpublished. Forced
   denormalized credit + viewer-scoped linking. §3.
3. **`readableSetWhere`'s bare `OR` is silently replaced** by a search `OR`, widening the
   directory to every set. Forced explicit `AND` composition. §1.
4. **Collapsing `link` into `public`** would publish every already-shared set on deploy. §1.
5. **Relaxing `setSetVisibility` to "writable"** would let a collaborator publish someone
   else's set. §2.
6. **Copying `CardKlp` rows** would carry version history describing another person's
   edits, defeating the reason KLPs are versioned. §3.
7. **Cross-user category matching is a string match, not a concept match.** §7.

---

## §10 Open, not decided

- **Ownership transfer** — out of scope. Named because "add an editor" is one step from
  someone asking for it.
- **Collaborator invitations** need an identity to address. There is no user search and no
  email invite flow; handles (§4) are the natural key, but that makes handles required for
  *being invited*, not just for publishing. Unresolved.
- **Fork size cap** — copying blobs makes this expensive. No number chosen.
- **Un-publishing a set that has forks** — forks survive by design (§3), but nothing tells
  the forker the source is gone. Probably fine; not decided.
- **Moderation / reporting** on a public directory. Not designed. Ships as a real
  obligation the moment strangers' content is listed.
- **Does forking copy `Card.klpStatus: 'skipped'` cards** (no AI key at author time)? They
  would re-extract under the forker's key, which is right, but the fork then differs from
  what was previewed.

---

## §11 Build order

Each step is separately shippable and separately verifiable. Do not merge them.

1. **Handles** (§4) — no dependencies, and publishing is blocked without it.
2. **`public` visibility + the `AND` composition rule** (§1) — the smallest change that
   touches the security module. Verify the existing ten-exposure test suite still holds.
3. **Directory** (§5) — read-only, no new write paths.
4. **Fork** (§3) — the blob copying is the bulk of the work.
5. **Homepage: Recents + Your sets** (§6) — no new data.
6. **Collaborators** (§2) — the largest privilege change; do it when the visibility module
   is otherwise settled.
7. **"For you"** (§7) — last, because it is worth least and is likeliest to be wrong.

Steps 1–3 are worth doing as one unit; 6 and 7 are each their own spec.
