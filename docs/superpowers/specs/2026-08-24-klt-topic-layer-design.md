# Key Learning Topics (KLTs) & the missed-work surface — design

**Date:** 2026-08-24
**Queue item:** `docs/superpowers/BUILD-QUEUE.md` #9 ("Surfacing missed KLPs and weak topics")
**Status:** designed, not built
**Answers:** BUILD-QUEUE #9's two open questions. Q1 ("what does *flagged* mean") — **what the learner got wrong**, not starred cards and not authored categories. Q2 ("new surface or rework") — **a new panel on `/profile/learner`**, existing panels untouched.

---

## 1. The problem

Three things are wrong at once, and they share one root cause.

**A KLP is unreadable as a study-list row.** Measured against the live corpus on 2026-08-24 — 153 live `CardKlp` rows across 69 cards — the propositions run **median 16 words** (p25 13, p75 19, max 31). Real examples:

> *"Lease debt is added back when moving from Equity Value to Enterprise Value because EV excludes interest expense and depreciation."*
> *"Restricted cash is cash set aside for a specific purpose (such as an acquisition reserve) and is unavailable for general operating use."*

`StudyNext` renders that text as the row. A ranked list of twelve such sentences is a wall, not a shortlist.

**There is no concept grain.** `CLAUDE.md`'s Stage 8 decision made user-authored Categories the concept nodes, and its own 2026-08-14 note records why that is only half-right: a category is whatever the learner found useful to label with, and in practice that is often a **format** ("label the image", "talking", "vocabulary") rather than a subject. So "you are weak on X" either names a format, or — for the many uncategorized cards — names nothing at all. That note predicted the fix: *"KLP-inherent topics living beside user categories, not replacing them."* This spec is that.

**Nothing says what you got wrong.** Per-answer error analysis exists on the quiz results screen (Spec 2b), aggregate mastery exists on `/profile/learner` (Spec 3C), and the raw feed exists on `/profile/memory`. None of the three answers *"here is what you keep missing, and here is what to do about it."*

The root cause is that the system has exactly **one** grain between "card" and "everything" — the KLP — and it is being asked to serve as both the machine's grading contract and the human's reading unit. Those want opposite lengths.

---

## 2. Decisions

Taken with the user on 2026-08-24.

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **Three grains, not one.** KLT (broad topic) → KLP `label` (short) → KLP `text` (full proposition). | The proposition must stay long: a distractor is made by corrupting one named KLP, and short-answer grading judges the claim. "Debt impact on WACC" has nothing to negate and nothing to grade. Readability is served by adding grains above it, never by shortening it. |
| 2 | **KLTs attach to KLPs, not to cards.** | Every downstream metric is KLP-grained (`KlpState`, `AnswerKlpResult`, `AnswerErrorTag`, Spec 3B targeting). Card-level topics do not roll up, and they misdiagnose: on a card whose two KLPs are *bankruptcy priority* and *the tax shield*, card-level topics flag both when the learner missed one. |
| 3 | **KLTs live BESIDE categories, not instead of them.** | Categories keep authoring, chips, and activity filtering. KLTs do concept-grain mastery. Nothing shipped regresses, and if extraction quality disappoints, one panel is deleted rather than a page rebuilt. |
| 4 | **`Klt.normalizedName` is globally unique — one node for all users.** | The user's stated reason: a later cross-user leaderboard/comparison on sets and topics. Deliberately unlike `CardCategory`, which is `@@unique([setId, normalizedName])`. |
| 5 | **Identity by reconciliation against the existing vocabulary**, not free text. | An open vocabulary fragments into synonyms — the documented reason `ACCURACY_TYPES` is closed. "WACC" / "Weighted Average Cost of Capital" / "Cost of Capital" must converge. |
| 6 | **1–3 KLTs per KLP, ranked; ALL ranks count toward topic mastery.** | The user's call, taken against the recommendation in §9.1. Broad topics accumulate evidence faster, which matters on a thin corpus. |
| 7 | **Which ranks count toward mastery is a tuning knob**, defaulting to all 3. | The user's standing preference is that study strategies be settings, not constants baked into metrics. If weak-topic lists get noisy at scale, this is a dial, not a migration. |
| 8 | **Users cannot rename or merge the global vocabulary.** | A merge moves every other account's mastery. Merges are an operator script, same posture as `npm run invite`. |
| 9 | **The new surface leads with aggregate weakness and expands to recent misses.** | Aggregate answers "what should I study"; the drill-down answers "why do you think that". Either alone is untrustworthy or unactionable. |
| 10 | **The KLT pass may never delete or supersede a `CardKlp` row.** | See §6. This is the one rule whose violation is unrecoverable. |

---

## 3. Schema change

```prisma
model CardKlp {
  // ... existing fields unchanged ...
  label String?   // NEW: 3-6 word rendering, e.g. "Debt impact on WACC"
  topics KlpTopic[]
}

model Card {
  // ... existing fields unchanged ...
  kltStatus String  @default("pending")   // NEW: reuses CARD_KLP_STATUSES vocabulary
  kltError  String?                       // NEW
}

/// A general concept a KLP is about. GLOBAL, not per-user and not per-set:
/// `normalizedName` is unique across the whole install so "WACC" is one node
/// for every learner — the precondition for cross-user comparison.
model Klt {
  id             String     @id @default(cuid())
  name           String     // display form, e.g. "WACC"
  normalizedName String     @unique
  createdAt      DateTime   @default(now())
  links          KlpTopic[]

  @@index([normalizedName])
}

/// KLP -> KLT, ranked 1..3.
model KlpTopic {
  id     String  @id @default(cuid())
  klpId  String
  kltId  String
  rank   Int     // 1 = primary
  klp    CardKlp @relation(fields: [klpId], references: [id], onDelete: Cascade)
  klt    Klt     @relation(fields: [kltId], references: [id], onDelete: Cascade)

  @@unique([klpId, kltId])
  @@index([kltId])
  @@index([klpId, rank])
}
```

**`label` is nullable and stays nullable.** A card whose KLT pass has not run, failed, or was skipped for want of a credential still renders — falling back to `text`, exactly as `StudyNext` does today. A non-null constraint would make the summarizer a hard dependency of the study list.

**`kltStatus` sits on `Card`, not on `CardKlp`.** `writeKlpVersion` already commits a card's KLPs as one atomic version-set, so the card is the natural unit of work; and it lets the gap-fill self-healing that `ensureKlpsReady` implements be reused verbatim rather than reinvented at a second grain.

**`Klt` rows are never garbage-collected.** A `Klt` with zero live links is simply not displayed. Deleting it would churn ids that a future leaderboard's history points at, for no storage saving worth naming.

---

## 4. The pipeline

### 4.1 Trigger and batching

Mirrors `extractKlpsForCards` (`src/actions/klp.ts:54`) deliberately, so there is one pattern to learn rather than two:

- `writeKlpVersion` commits a card's KLPs → the card's `kltStatus` is `pending`.
- An `after()`-scheduled pass picks up pending cards, batched at `KLT_BATCH_SIZE = 10` cards per call.
- Routed to the `autocomplete` task tier, same as extraction — this is structured summarization, not judgment. **No new `AI_TASKS` member**; that vocabulary stays closed.
- The pass must never throw. Every failure is recorded on the card, per the doc comment on `extractKlpsForCards`.
- `isOwner` is threaded through exactly as extraction threads it: a viewer on a link-shared set must never stamp `failed`/`skipped` onto a stranger's card and suppress the owner's own retry UI.

### 4.2 One call, both grains

`summarize-klts` v1 in `src/lib/ai/prompts/registry.ts`. Input: set title, the batch's live KLPs by `ref`, and the candidate vocabulary (§4.3). Output per KLP: a `label` (3–6 words) and 1–3 topic names, each marked as reused-from-candidates or newly minted.

Label and topics come from **one call** because they are the same act of reading the proposition. Splitting them doubles cost for no gain.

Refs are batch indices, never cuids — same rule as extraction, and for the same reason: a hallucinated ref must not write one KLP's topics onto another. The writer skips unknown refs.

### 4.3 Candidate assembly is TypeScript's job, not the model's

The prompt receives a capped list (**150 names**) built from, in priority order:

1. **KLTs already linked to live KLPs in the same set.** Strongest prior — a set is usually one subject.
2. **Token-overlap matches** between existing `Klt.normalizedName`s and the batch's KLP text. Plain Postgres; no embeddings.
3. **The globally most-linked KLTs**, to fill remaining slots.

Deduped, then truncated at the cap in that order, so set-local topics are never crowded out by globally popular ones.

**No embedding infrastructure.** At 153 KLPs it buys nothing, and it is a large dependency to take on speculatively. Revisit when the vocabulary passes a few thousand nodes and token overlap starts missing obvious synonyms.

### 4.4 Minting is constrained after the model returns

The model is told to reuse a candidate when one fits and mint only when none does. That instruction is not trusted; the writer enforces:

- normalize (lowercase, trim, collapse internal whitespace) → `normalizedName`
- reject empty, `> 4` words, or `> 40` characters
- commit via **`upsert` on `normalizedName`**

The upsert is what makes dedup correct rather than merely likely: two batches minting "WACC" concurrently converge on one row instead of racing to a P2002.

A rejected topic is dropped, not repaired. A KLP that ends with zero valid topics is left untopiced with `kltStatus: 'ready'` — it still gets its `label`, and it appears under "Uncategorized" in the new panel. Fabricating a topic to fill the slot would be the KLT analogue of Spec 2a's rule that degradation never invents a tag.

### 4.5 Failure, self-healing, backfill

- No usable credential → `kltStatus: 'skipped'`; any other error → `'failed'`, message truncated to 500 chars in `kltError`. Same split, same truncation as `markFailed`.
- Gap-fill on read, mirroring `ensureKlpsReady`; retry affordance in `KlpEditor` beside the existing KLP retry.
- **`scripts/backfill-klts.ts`** for the 153 existing KLPs, following `scripts/backfill-klp-state.ts`. Idempotent, resumable, batched — it runs against every card with live KLPs and `kltStatus != 'ready'`.

---

## 5. Versioning

`CardKlp` is versioned: an edit supersedes the live rows and writes version n+1 with **new ids**.

- **`label` belongs to the KLP row**, so it inherits versioning for free and is written by the same pass that writes the topics.
- **A card edit resets `kltStatus` to `pending`.** The new version's rows have no label and no topics until the pass reruns.
- **Superseded KLPs keep their `KlpTopic` rows.** `shapeTopicProfile` already separates *live* KLPs (which drive knowledge) from *attributable* ones (live + superseded, which attribute historical error tags — see `topic-profile.ts:20-32`). Deleting old links would re-break the readiness bug that split exists to fix: an edit would empty the numerator while answers stayed in the denominator, and readiness would jump toward 1.0.

---

## 6. Mastery safety — the one unrecoverable rule

**`KlpState` is a cache; `AnswerKlpResult` is the record.** `src/lib/metrics/cache.ts:17` states it: the posterior after N observations is a function of the posterior after N−1 and the new one. `rebuildKlpStates(tx, userId, klpIds)` (`state-writer.ts:141`) already replays any KLP's state from surviving history, scoped to a named id list.

So a corrupted *posterior* is repairable. A destroyed *evidence row* is not — and `AnswerKlpResult.klp` is `onDelete: Cascade` (`schema.prisma:548`). Deleting a `CardKlp` deletes its answer history permanently.

**The rule:**

> The KLT pass writes exactly three things: `CardKlp.label` (in-place `UPDATE`), `Klt` rows, and `KlpTopic` rows. It issues no `DELETE` and no `supersededAt` write against `CardKlp`, and does not touch `KlpState` or `AnswerKlpResult` at all.

An in-place `label` update is safe precisely because it changes neither `id` nor `version`. Superseding instead would mint new `klpId`s and orphan every accumulated posterior — a silent, total mastery reset, invisible to `tsc` and to any test that only checks the label landed.

### 6.1 Amendment — narrowing the append-only invariant

`writeKlpVersion` (`src/actions/klp.ts`) documents itself as **"THE ONLY MUTATION PATH FOR CardKlp"**, so that `CardKlp` stays append-only and `QuizQuestion.targetKlpIds` keeps pointing at rows whose text is what the question was built from. An in-place `label` update is a second writer, and taken literally the existing comment forbids it.

Resolved by **narrowing the invariant rather than breaking it**, because the alternative (superseding to write a label) is the catastrophic path §6 exists to prevent:

> `CardKlp` is append-only **with respect to the proposition**. `text`, `weight`, `kind`, `index`, `version`, `sourceHash`, `promptVersion`, `source` and `supersededAt` may only ever be written by `writeKlpVersion`. `label` is a derived display annotation carrying no semantic content, and is the sole column a second writer may update in place.

Rewriting a label cannot rewrite history: the proposition a question was built from is unchanged, so nothing downstream of `targetKlpIds` moves. Task 5 updates `writeKlpVersion`'s doc comment to state the narrowed rule, and adds a guard asserting the KLT writer's update touches `label` and no other column.

**Three layers:**

1. **Prevention** — the write surface above, and nothing else.
2. **Detection** — §7's guards, each mutation-tested.
3. **Recovery** — `rebuildKlpStates` over the affected `klpId`s, replaying from `AnswerKlpResult`, which this pipeline never writes.

---

## 7. Testing

Pure functions first, per the repo convention that the highest-risk logic is unit-testable.

| Area | Test |
| --- | --- |
| Normalization | `normalizeKltName` — case, whitespace, word cap, char cap, empty rejection. Golden vectors so the dedup key cannot drift silently. |
| Candidate assembly | Priority order (set-local → token overlap → global), dedup, cap at 150, and that set-local names survive truncation. |
| Mint constraints | Over-long / over-wordy / empty names are dropped, not repaired; a KLP with zero surviving topics is `ready` with a label and no links. |
| Rank → mastery | `shapeTopicProfile` over KLT-derived topics: all ranks counted at the default knob; only rank 1 when the knob is narrowed. |
| Hallucinated ref | An out-of-range `ref` writes nothing and does not abort its batch. |
| Concurrency | Two batches minting the same normalized name converge on one `Klt` row. |
| **Guard: no supersede** | Across a KLT pass, every `CardKlp` `id` / `version` / `supersededAt` is unchanged. |
| **Guard: no state change** | Across a KLT pass, every `KlpState` row is byte-identical. |
| **Guard: no deletes** | The pass's write surface contains no delete against `CardKlp` / `KlpState` / `AnswerKlpResult`. |
| Backfill | Idempotent — a second run over the same corpus writes no duplicate `KlpTopic` rows and no second `Klt`. |

**Every guard in bold is mutation-tested**: remove the protection, confirm the test goes red, restore it. This project has twice shipped guards that could not fail until the test itself was fixed (BUILD-QUEUE #4 and #3). A guard nobody has watched fail is not a guard.

Live verification is owed against the real DB, not only mocks — the recorded lesson is that a green suite once passed over a statement Postgres rejects.

---

## 8. Surface: "What you're getting wrong"

A **new panel at the top of `/profile/learner`**. `TopicMastery`, `StudyNext`, and `RetentionPanel` are untouched below it.

**Collapsed row (aggregate, leads):** the KLT heading, its weak KLP `label`s beneath, and the topic's knowledge figure. Ordered by weakness.

**Expanded row (episodic, on demand):** the specific recent misses that produced the number — the KLP's full `text`, when it was missed, in which mode, and the Spec 2b error tags already captured. This is what makes the aggregate trustworthy: the learner can check the claim against a quiz they remember taking.

**Empty and thin states reuse Spec 3C's `diagnoseEmptyState`** (`src/lib/metrics/coverage.ts`) rather than growing a second opinion about whether the learner has enough data — plus one new cause, *KLT summarization pending*, which distinguishes **wait** from **do something**. This is the same reason `coverage.ts` was built as shared substrate rather than dashboard-private.

**A null metric renders its own state, never a zero** — the existing `TopicMastery` rule (`TopicMastery.tsx:13-17`) applies here unchanged. "Not measured" is not "knows nothing".

**Untopiced KLPs appear under "Uncategorized"**, consistent with Spec 3C's treatment and with `UNCATEGORIZED_ID`.

---

## 9. Known limits and risks

### 9.1 All-ranks mastery will smear (accepted)

Decision 6 lets one KLP feed up to three topics' mastery. On a card like "Walk me through a DCF" — 5 KLPs, each plausibly touching `DCF`, `terminal value`, `WACC`, `discounting` — a single failed answer can mark several topics weak. The weak-topic list gets longer and less specific, which is the opposite of the request that motivated this spec.

Accepted knowingly. Mitigations: the cap of 3; specificity carried by the `label` grain rather than by topic count; and Decision 7's knob, which narrows to rank-1-only without a migration. **Revisit against real data once the corpus is thick enough to judge** — the current 153-KLP corpus cannot settle it.

### 9.2 Private-set content reaches another user's prompt

The reconcile candidates are global, so a KLT minted from a private set becomes a string in another user's summarization prompt. Bounded, not eliminated, by: the §4.4 mint constraints (≤ 4 words, ≤ 40 chars) forcing names toward general concepts; and by users only ever *seeing* KLTs their own KLPs link to. Given this repo closed ten read-by-id exposures to build `src/lib/sets/visibility.ts`, the residual risk is named here deliberately rather than assumed away. A per-user vocabulary would remove it entirely, at the cost of the cross-user comparison that motivated Decision 4.

### 9.3 A card edit already resets that card's mastery — pre-existing, not introduced here

`saveCardKlp` supersedes every live row and writes version n+1 with new `klpId`s. `KlpState` and `AnswerKlpResult` key on the old ids, so the new version starts from `BKT_PRIOR` at 0 observations. The evidence survives under the old ids; it stops counting toward the live KLP.

Arguably correct — a reworded proposition is a different thing to know — but it means a typo fix costs the card's accumulated mastery, and nothing in the UI says so. **Out of scope for this item**, recorded here so it is not rediscovered as a KLT bug. A fix would carry evidence forward when `text` is unchanged and only `weight`/`kind` moved.

### 9.4 Vocabulary quality degrades with order

Reconciliation is order-dependent: an early, badly-named KLT becomes an attractor that later KLPs are pulled into. The operator merge script (Decision 8) is the remedy, and it is manual. There is no automatic quality signal on the vocabulary.

### 9.5 Token overlap is not synonymy

§4.3's retrieval will not connect "gearing" to "leverage". Accepted for v1; the fallback is that the model mints a second node and an operator merges it. Embeddings are the escalation path if this becomes common.

---

## 10. Out of scope

- **No KLT hierarchy.** No `parentKltId`, no broad/narrow tree. That is the concept-graph bet `CLAUDE.md` defers, and its own warning applies — a bad cluster silently corrupts every downstream metric.
- **No rewriting of KLP `text`.** The propositions stay as they are; §2 Decision 1.
- **No user-facing merge/rename UI.** Decision 8.
- **No leaderboard.** Global `Klt` identity is the precondition Decision 4 establishes; the feature itself is separate work.
- **No change to Categories** — authoring, chips, activity filtering, and `filterCardsByCategories` are untouched.
- **No embeddings.** §4.3.
- **Spec 4's lessons** continue to be item 7. This spec gives them somewhere to point.
