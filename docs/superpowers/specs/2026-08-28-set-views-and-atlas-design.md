# Set Views & Atlas — Design

**Date:** 2026-08-28
**Status:** approved, unbuilt
**Branch:** `spec3b-tunable-scoring`
**Depends on:** `2026-08-28-app-shell-design.md` (built). **Completes** the two-part request
made on 2026-08-27; the sharing half is `2026-08-27-public-sets-and-discovery-design.md`.

---

## 1. What this is

The set page becomes three views — **Study / Knowledge / Analysis** — reached by a tab strip
under the set title, not by a button. Everything about what you *know* moves out of the study
flow and into Knowledge: the concept tree (shaded by mastery), your categories, your
confidence, and this set's study history. Analysis answers a different question — *why do I
get things wrong* — and ships partly real, partly marked in-progress.

This also brings the **Atlas** half of the visual direction, of which only the `/browse` set
glyph exists today: spatial node-and-edge surfaces where **mastery is shading**.

### 1.1 Three decisions revised from the 2026-08-27 conversation

Recorded so the change is deliberate rather than drift:

1. **`/sets/[id]/concepts` is NOT redirected away.** The earlier decision folded it into
   Knowledge. The owner asked on 2026-08-28 to keep the full editor at its own route. It stays,
   unchanged, and Knowledge embeds the canvas rather than replacing the editor.
2. **Knowledge gets a Map | List toggle**, not a map alone. The list is not a fallback: it is
   the view that must **outlive the concept tree**, because the owner intends non-tree topic
   sources later (CLAUDE.md's "KLP-inherent topics living beside user categories"). It is
   therefore built against a topic-source-agnostic shape, not against `SetKltNode`.
3. **Analysis ships mostly real.** It was to be a locked placeholder. But
   `getLearnerMetrics({ scope: { setIds: [id] } })` already returns misconceptions, a
   forgetting curve and pace outliers for exactly one set, and the panels that render them
   already exist. Stubbing the whole tab would have hidden working analysis behind a
   placeholder. Only the error-taxonomy band view — genuinely Spec 4 — is marked in progress.

---

## 2. Routes

A **route group inside the shell's group**: `src/app/(app)/sets/[id]/(views)/`.

| File | URL | Gets the tab strip |
| --- | --- | --- |
| `(views)/layout.tsx` | — | supplies it |
| `(views)/page.tsx` | `/sets/[id]` | ✅ Study |
| `(views)/knowledge/page.tsx` | `/sets/[id]/knowledge` | ✅ |
| `(views)/analysis/page.tsx` | `/sets/[id]/analysis` | ✅ |
| `edit/page.tsx` | `/sets/[id]/edit` | ❌ authoring |
| `concepts/page.tsx` | `/sets/[id]/concepts` | ❌ the full tree editor, preserved |

**Why a group and not a `layout.tsx` at `sets/[id]`.** A layout there would also wrap `edit`
and `concepts`. `edit` is a long authoring form and `concepts` is a full-bleed canvas; neither
wants a tab strip claiming it is one of three peer views of the set. The five study
activities are already outside `(app)` entirely from the shell work, so they were never at
risk — but `edit` and `concepts` still are, and the group is what protects them.

The header (title, description, fork attribution, card count, owner actions) moves **into the
layout**, so it does not re-render or drift between the three tabs.

---

## 3. The tab strip

```
Financial Modelling
DCF, LBO and comps drills · 84 cards

  Study   Knowledge   Analysis
 ─────────
```

Three tabs, exact-match active state. `src/lib/sets/views.ts` holds it, pure:

```ts
export function setViewTabs(setId: string): SetViewTab[]
export function isSetViewCurrent(pathname: string, href: string): boolean
```

**The same active-state trap as the rail, for the third time in this codebase.** `/sets/abc`
is a prefix of `/sets/abc/knowledge`, so a `startsWith` test marks Study current on every tab.
`ProfileNav.isCurrentTab` documents it, `isRailItemCurrent` re-documents it; this is why the
rule now gets a test that asserts **at most one tab is ever current** across every path,
rather than three individual assertions someone can "fix" one at a time.

---

## 4. Study

Unchanged except for what left. Activity tiles, flashcard carousel, terms list — the study
flow is the one thing that was not the complaint. It loses the outline **Concepts** button,
which is now a tab.

Category chips and confidence stay on the cards. Knowledge **aggregates** them; it does not
take them away. A chip on a card answers "what is this?" in context; the same data in
Knowledge answers "how am I doing across them?" Those are different questions and the second
does not replace the first.

---

## 5. Knowledge

Everything here is about **you and this set**. Order, top to bottom:

### 5.1 A four-metric header
Cards studied · mean confidence · due now · concepts tracked. `Metric` renders `—` for null,
never `0` — an unstudied set must not report "you know none of this".

### 5.2 The concept map — `Map | List`

**Map** embeds the existing `ConceptCanvas`, with each node shaded by mastery. The owner keeps
their edit affordances; a reader gets the same picture without them. One concept surface, not
two implementations of one tree.

**List** is a ranked table: concept, mastery bar, KLPs, evidence count. It takes a
`TopicMasteryRow[]` — `{ key, name, depth, knowledge, klpCount, analyzedAnswers }` — and
**knows nothing about `SetKltNode`**. That is the point: when KLP-inherent topics arrive
beside user categories, they produce the same rows and this view renders them unchanged.

The chosen view is a URL param (`?view=list`), not local state, so it survives a reload and
can be linked.

### 5.3 Mastery shading — the one function that must not be wrong

`src/lib/klt/mastery-shade.ts`, pure:

```ts
export type MasteryShade = 'unknown' | 'weak' | 'developing' | 'solid' | 'strong'
export function shadeForKnowledge(knowledge: number | null): MasteryShade
```

**`null` maps to `unknown`, NEVER to `weak`.** Null means no KLP under that concept cleared
the learner's own observation floor — *no evidence*, which is a different claim from *bad
evidence*. Rendering it as weak paints every untouched concept in the alarm colour, which
makes a fresh set look like a disaster and makes the shading worth ignoring. This is the same
rule `pickWeakCategories` follows (it drops null rather than treating it as 0),
`SetStudySummary.averageConfidence` follows, and `LearnerTopicProfile.knowledge` exists to
express. It has now been stated in four places, so it gets a test that fails loudly.

`unknown` renders as a **hatched outline**, not a grey fill: a grey fill in a scale that also
contains colours reads as a low value on that scale. An outline reads as "not measured".

### 5.4 Categories
Your set-scoped categories with per-category mastery, using the same shading. Cards in no
category roll up to an explicit **Uncategorized** bucket, matching `filterCardsByCategories`'s
existing OR-plus-uncategorized semantics rather than inventing a second convention.

### 5.5 Confidence
Distribution of `CardProgress.confidence` (1–10) across this set, and the count never
scheduled. Uses the existing `dueAt === null` means DUE convention — diverging would make this
page disagree with what Review mode actually offers, and a learner cannot tell which is lying.

### 5.6 This set's history
`StudySession` rows for this set: kind, when, duration, item count, and the persisted
`insight`. Links to `/profile/activity/[id]`, which already renders one session in full.

---

## 6. Analysis

Same scope object, different question. Three real panels, then one honest placeholder.

1. **Retention** — the forgetting curve for this set (`metrics.forgetting`).
2. **Misconceptions** — deterministically derived, already computed (`metrics.misconceptions`).
3. **Correct but not fluent** — pace outliers, each scored against its own mode's baseline
   (`metrics.paceOutliers`).
4. **In progress: error taxonomy.** A clearly-marked, non-interactive block naming what is
   coming — error rates by dimension/type/target from `AnswerErrorTag`, and the significance
   bands that rank them. This is Spec 4 work and depends on accumulated tags.

**The placeholder must not be a fake chart.** A dimmed rendering of invented bands is
indistinguishable from real data at a glance, and this repo's standing rule is that
degradation never fabricates. It is a short statement of what will appear and what it needs,
on a hatched ground matching `unknown` above.

### 6.1 Empty states name their cause
`diagnoseEmptyState` (`src/lib/metrics/coverage.ts`) already distinguishes causes. Analysis
reuses it rather than rendering one "no data yet" for four different situations — the "is this
broken?" confusion the 3B gate hit twice.

---

## 7. Signed-out and non-owner viewers

A link-shared or public set is readable **signed out**. Knowledge and Analysis are about a
viewer's own progress, which a signed-out visitor does not have.

- **Signed out:** both tabs render. Knowledge shows the concept map **unshaded** (the
  structure belongs to the set and is already readable) plus a sign-in prompt where the
  personal panels would be. Analysis shows the prompt alone. Neither 404s, and neither
  pretends there is data.
- **Signed in, not the owner:** fully functional. Study writes are keyed `(userId, cardId)`,
  so a viewer's confidence and answers are genuinely their own — the set page already says so.

**Every set read on all three pages composes `readableSetWhere`,** and all three go on
`ENFORCED_PATHS`. The move from `sets/[id]/page.tsx` to `(views)/page.tsx` breaks that list's
existing entry, which is by design: it fails loudly rather than silently dropping the check.

---

## 8. Testing

**Pure, unit tested:**

| Function | Module | What must not regress |
| --- | --- | --- |
| `shadeForKnowledge` | `lib/klt/mastery-shade.ts` | null → `unknown`, never `weak` |
| `isSetViewCurrent` | `lib/sets/views.ts` | Study not current on `/knowledge` |
| `setViewTabs` | `lib/sets/views.ts` | three tabs, unique hrefs |
| `shapeTopicMastery` | `lib/sets/knowledge.ts` | null knowledge survives as null |
| `shapeConfidenceHistogram` | `lib/sets/knowledge.ts` | null `dueAt` counts as due |

**Guards proven red by mutation:**

- `shadeForKnowledge(null)` returning `'weak'`. **Mutate:** `knowledge ?? 0`. Must go red.
  Verify the mutation actually landed before trusting green — a replace that hits an
  explanatory comment quoting the code looks identical to a guard that cannot fail
  (2026-08-28).
- At most one tab current for every path in the set. **Mutate:** `startsWith`.
- All three view pages apply `readableSetWhere`. **Mutate:** drop it from one.
- `edit` and `concepts` are NOT inside `(views)`. **Mutate:** move one in.

---

## 9. Migration

**None.** Every number on both tabs comes from data that already exists — `CardProgress`,
`StudyEvent`, `StudySession`, `KlpState`, `SetKltNode`, `CardCategory`. No new column, no
backfill. That is a deliberate constraint on this spec, not a happy accident: a view that
needs new writes to be useful cannot be judged until the writes have accumulated.

---

## 10. Out of scope

- **Error-taxonomy bands.** §6 item 4. Spec 4.
- **KLP-inherent topics beside user categories.** The List view is *shaped* for them; nothing
  produces them yet. CLAUDE.md's 2026-08-14 note is the standing description.
- **Editing structure from Knowledge.** The canvas keeps its edit affordances for the owner,
  but `/sets/[id]/concepts` remains the place the tree is authored.
- **Cross-set concept comparison.** `/profile/learner` is the consolidated view and already
  exists.

---

## 11. Live gate

Not agent-runnable here (`.env` has only `DATABASE_URL`, so `auth()` throws `MissingSecret`).

1. `/sets/[id]`, `/knowledge` and `/analysis` all render with the rail and one tab strip.
2. On `/sets/[id]/knowledge`, **Study is not highlighted**. (§3)
3. `/sets/[id]/edit` and `/sets/[id]/concepts` have **no** tab strip.
4. `/sets/[id]/concepts` still opens the full drag-and-drop editor, unchanged.
5. A concept with no answered KLPs renders **hatched**, not in the weak colour. (§5.3)
6. `?view=list` survives a reload and shows the same concepts as the map.
7. Signed out on a public set: both tabs render, map is unshaded, no crash. (§7)
8. Signed out, `/sets/<private-set-id>/knowledge` 404s.
9. A set with zero study history shows named empty states, not four blank panels.
