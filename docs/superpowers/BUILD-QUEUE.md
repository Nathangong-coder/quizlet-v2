# Build queue & carried-over findings

**Last updated:** 2026-08-24 (item 9 BUILT as the KLT topic layer, two verification steps owed; item 8's two human gates reported PASSED by the user 2026-08-24)
**Read this first** before starting any Stage 8 work. The order below is not derivable from spec filenames or dates.

This file is the canonical queue. A Claude-Code memory (`build-queue.md`) mirrors it, but **this file wins** — it is in the repo and readable by any tool.

**Build order for what remains, decided with the user 2026-08-20 — the numbers do NOT sort into it:**

1. ~~**Item 8 — open the doors**~~ **FULLY DONE.** Built and agent-gated 2026-08-21; the two human gates (real Resend delivery, Vercel Firewall) were reported PASSED by the user on 2026-08-24, and **`CREDENTIALS_SIGNUP_ENABLED` is now ON** — set via a deployed env var, not in `.env`. Nothing outstanding.
2. **Item 9 — surfacing missed KLPs / weak topics.** **BUILT 2026-08-24** as the KLT topic layer (`specs/2026-08-24-klt-topic-layer-design.md`). Two verification steps owed — see its entry. Next action after those is item 7.
3. **Item 7 — Spec 4**, plan setup + readiness + lesson generation. The biggest item; its lesson half now has its first design decision (see item 7's "LESSON OUTPUT TYPES").
4. **Item 6c — sharing & discovery.** Designed and ready — item 8 landing removes the "a stranger cannot sign up" blocker, though the flag itself is still off.

---

## The queue

### 1. ✅ Set visibility — DONE (2026-08-09)

Spec: `specs/2026-08-08-set-visibility-design.md` · Plan: `plans/2026-08-08-set-visibility.md`
Branch `spec3b-tunable-scoring`, ~10 commits, **not merged**. Pushed to `origin`.

Sets are private by default, owner-togglable to link-shareable. Closed 10 read-by-id exposures. Verified live against the dev server and the real DB, not just in tests.

### 2. ✅ Deletion & forgetting — DONE (2026-08-12), live-verified

Spec: `specs/2026-08-10-deletion-and-forgetting-design.md` · Plan: `plans/2026-08-10-deletion-and-forgetting.md`
Ledger: `.superpowers/sdd/2026-08-10-deletion-and-forgetting/progress.md`
Branch `spec3b-tunable-scoring` (same branch as item 1), **not merged**. Pushed to `origin`.

Forget now drops the **evidence**, not just the estimate, and a reset quiz is erased outright rather than kept as a scored receipt. All six verbs — `deleteStudyEvent`, `forgetCard`, `forgetSet`, `resetQuizAttempt`, `resetQuizAnswer`, `resetUserMemory` — route through one module: a pure planner (`src/lib/memory/erase.ts`) plus a transactional executor (`src/lib/memory/erase-execute.ts`) that snapshots, deletes, then replays `CardProgress` and `KlpState` from what survives. Both defects the spec found are fixed: `StudySession` was missing from the account reset, and `QuizAttempt.score` no longer goes stale on partial deletion.

**Task 11 live verification: checkpoints ①–④ ALL PASSED against the real database on 2026-08-12.** Method: full snapshot + predictions recorded **in advance**, then one action, then measure. Every prediction hit.
- **①** erase one answer → `answers −1`, **`events −1` (the FK cascade proven — no application code deletes that row)**, `attempt.score 77→65` recomputed via `overallQuizScore`, `session.itemCount 3→2` (stored planned count minus deletions, confirming the I-1 ruling).
- **②** erase the last two → the attempt **and** its session deleted outright, not left as a scored husk (the I-3 fix).
- **③a** forget a card with quiz history → **`klpStates −3`**, the behaviour change the whole spec exists for: those posteriors sat at `pKnown 0.871` and would previously have survived forever, beyond the backfill's reach. Two *different* attempts re-scored in one operation (96→95, 83→82); a `matching` answer erased via the card scope; the card's `CardKlp` definitions survived — you forget your history with a card, not the card.
- **③b** forget a starred, never-studied card → `CardProgress` row deleted unconditionally. That is **C-1** from Task 5's review, the one defect no mocked test could reach.
- `scripts/check-memory-integrity.ts` (run after each) asserts `KlpState.observations === count(surviving AnswerKlpResult)` for every row — a posterior still carrying a deleted answer reads `evidence + 1`. Clean throughout.

- **④** account reset → every memory count **0**, including `sessions` (Task 7's fix; pre-fix all 21 would have survived as husks). Content untouched: 78 cards, 152 KLPs, 7 categories, 2 credentials, 152 content blocks. The reset erases history, not the library.

**Unverified on purpose:** N-1 (set scope deleting `ConfidenceEvent` by `card: { setId }`, reaching cards whose *only* memory is a legacy confidence row). The corpus could not discriminate it — every card carrying `ConfidenceEvent` rows also had answers, so pre- and post-fix code behaved identically. Not worth manufacturing, since nothing derives from `ConfidenceEvent`. **Do not assume it was tested.**

**Two bugs Task 11 found that the entire mocked suite could not** — this is the argument for keeping live verification as a gate: the `$queryRaw`/`void` advisory-lock failure (trap 8 below), which had also broken quiz submission outright, and "Forget this card" being effectively unreachable in the UI (fixed `f4236d9`; clicking a term in the activity feed now scopes to that card).

**Known and deliberate:** matching-mode answers render through `MatchingReview`, which has no per-answer card, so they get no per-question erase control even on the permalink. Erasing them via the card or set scope works, as ③a confirmed.

### 2b. ✅ Empty quiz attempts — **DONE 2026-08-12, live-verified.**

Spec: `specs/2026-08-12-empty-quiz-attempts-design.md` · Plan: `plans/2026-08-12-empty-quiz-attempts.md`
Commits `31b1a09` (Tasks 1, 2, 4, 5) and `3811797` (Tasks 3, 6 + the in-flight guard), branch `spec3b-tunable-scoring`, **not merged**.

Tests **1021 → 1083** (96 files), `tsc` clean, lint **186 → 185** problems.

An attempt with no `QuizAnswer` rows no longer counts as history. `ANSWERED_ATTEMPT_WHERE` (`src/lib/quiz/history.ts`) hides it at the two read paths that surface it; submitting a quiz with nothing answered discards it outright through the existing `executeErasure({ kind: 'attempt' })`; and `rescoreSetAttempts` stops a card deletion from stranding a score whose evidence is gone.

**The open question from the deferral is resolved:** a card deletion **nulls the score**, it does not delete the attempt. Erasing memory is a request to destroy data; editing a set is not — and the cascaded population is reached by *another user's* edit.

**Live gate PASSED 2026-08-12** (run by the user; GitHub OAuth puts signed-in pages out of reach from an agent session — trap 6). Verified in the browser against the real database: a partly-answered quiz (2 of 5) survives and its results page shows exactly the answered questions; a blank submit shows "Quiz Skipped" and leaves nothing on `/profile`; an abandoned quiz never appears; deleting a tested card re-scores the attempt, and deleting every tested card nulls the score and drops it off `/profile`.

**One thing the gate could NOT reach, and why it matters less than it looks.** The intended check was "force an AI failure mid-quiz, confirm you get the results screen and not 'Quiz Skipped'" — the scenario `discardSkippedQuizAttempt`'s condition 1 exists for. It is **unreachable by disabling credentials**: `src/app/sets/[id]/quiz/page.tsx:28-31` gates the whole quiz page on *any* enabled credential, before mode selection, so you never reach a short-answer question. Reproducing it needs a credential that is enabled but broken — `saveCredential` does **not** verify keys (that is `testCredential`'s separate job), so a deliberately bogus key can be saved as the only enabled credential. Not run, because the 2-of-5 result already demonstrates `answeredCount()` returns non-zero from real React state and the discard refuses on it; the residual question is only whether a *grading failure* wipes that state before submit, and `answeredCount` never observes the server's response.

**Two findings worth more than the code:**
- The regression guards the plan named for the `updateSet` transaction conversion (`tests/cards/*`) are pure unit tests of helpers `updateSet` *calls* — they **cannot** detect a transaction-shape regression, and would have passed had the ordering been broken outright. Same failure mode as trap 8.
- Restructuring `handleSubmitQuiz` nearly added a `finishStudySession` call on the grading-crash path, because the old shared `try` already skipped it. Caught by mutation testing, not by review.

<details>
<summary>The pre-build analysis, kept for the reasoning (populations, why deferred creation was rejected)</summary>

Found during Task 11 live verification. **User's decision:** an un-answered quiz is a typo, not history — it should not appear at all.

Two distinct populations, and the obvious rule only covers one:
- **11 attempts, no answers and no score** — never answered. `startQuizAttempt` writes the row before any answer exists. "Don't create until first answer" fixes these.
- **5 attempts, no answers but a REAL score** (100, 99, 50…), all dated 2026-07-05 — these *did* have answers. The cards were deleted later, `QuizAnswer.cardId` cascaded, and the attempt kept a score for evidence that is gone. Deferred creation would not have prevented one of them.

So the rule is **zero answers ⇒ not history, scored or not.** Note the second population is the *same* invariant violation this deletion work exists to prevent — a derived number outliving its evidence — reached through the card-delete path rather than a forget verb. `scripts/check-memory-integrity.ts` already detects it (check 4).

**The design, as far as it got 2026-08-12** (brainstormed, no spec written — resume from here rather than from scratch):

- **Filter, don't delete.** One `ANSWERED_ATTEMPT_WHERE = { answers: { some: {} } }` in a new `src/lib/quiz/history.ts`, spread into exactly **two** reads: `getUserStats` (`src/actions/user.ts:42`) and the `repeatBonus` attempt window (`src/lib/metrics/read.ts:113`).
- **The risk is INVERTED from `readableSetWhere`** — do not spread this one everywhere. The other four `quizAttempt` readers (in-flight lookups in `quiz.ts`/`quiz-matching.ts`, the print page, `erase-execute`) must NOT filter: an in-flight attempt has zero answers until the first submit, so over-applying breaks the first question of every quiz. Forgetting it shows a husk; over-applying takes quizzing down.
- Safe to apply in `metrics/read.ts`: every error tag reaches an attempt via `quizAnswer.attemptId`, so any attempt a tag references has ≥1 answer by construction.
- **Re-score on card delete, cross-user.** `updateSet` deletes cards with a plain `prisma.card.deleteMany` (`src/actions/sets.ts:293` — the only card-delete path found) and nothing recomputes the affected `QuizAttempt.score`. Recompute **every attempt on the set** rather than snapshotting affected ones first: the snapshot version needs ids captured before the cascade destroys the link, which makes ordering load-bearing and loses a concurrently-submitted answer; recomputing from ground truth is race-*tolerant*, since a concurrent submit derives the same score itself. No `userId` filter — sets are link-shareable and `startQuizAttempt` is readability-scoped, so the owner's edit strands **other learners'** scores. No privacy cost: each score comes only from that user's own surviving answers.
- **Reuse, don't reimplement.** `planErasure` already has this exact rule at `src/lib/memory/erase.ts:380-410`. Extract it as `storedScore(answers)` into `src/lib/quiz/scoring.ts` (where `overallQuizScore` lives) and have both callers use it — the round-because-the-column-is-`Int` decision is currently duplicated in `quiz.ts` too.
- Must write `null`. `quiz.ts:571` and `:750` both guard `if (newScore !== null)`, which is precisely how an attempt keeps a score after losing all its evidence.
- **Out of scope, decided:** no cleanup sweep (the 2026-08-12 account reset already removed all 16), no change to empty `StudySession` rows (nothing lists them — `studySession.findMany` appears only in `erase-execute`), and card deletion does not become an erasure scope (`KlpState` already cascades correctly via `CardKlp → Card`, so the replay would be a no-op).
- **Left open** when deferred: whether a card deletion that empties an attempt should *delete* it, matching `planErasure:384` ("would otherwise linger in the activity feed as a ghost quiz"), or merely null the score and let the filter hide it. Argument for keeping them different is intent — erasing memory is a request to destroy data; editing a set is not, and deleting another learner's row costs a destructiveness budget the editor was never given.

**What was still broken** (all addressed by the build above; kept because the populations are the reasoning):
- **Abandoned quizzes** — `startQuizAttempt` writes the row before any answer exists; closing the tab left it on `/profile` permanently. Now hidden by the read filter; **the rows still accumulate**, deliberately — no reliable client signal exists to delete them on.
- **Cascaded evidence** — the `updateSet` path above. Now re-scored.
- **Printable tests** are a third population, zero-answer *by design* (`/sets/[id]/print` reads the attempt), which is why "defer `QuizAttempt` creation until the first answer" was rejected outright — it would break print.

It *looked* fixed at the time only because the 2026-08-12 account reset emptied the table.

</details>

### 3. ✅ Spec 3B — tunable scoring — **DONE 2026-08-13, live-verified**

All 10 tasks, one commit each (`c980cfa` … `8ccceea`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1083 → 1181** (100 files), `tsc` clean, lint **185** (unchanged).

`LearnerTuning` holds a strategy plus two sparse, Zod-validated override blobs; `getUserTuning`
resolves them into a complete band table and a complete threshold set. `computeArticulation`,
`shapeTopicProfile` and `rankCandidates` all take the thresholds as a parameter. `getLearnerMetrics`
threads the learner's bands, thresholds and strategy and returns a ranked KLP candidate list
(**still rendered nowhere** — 3C's job). The quiz results screen derives severity, significance and
repeatBonus at read time. Three panels on `/settings/ai`, each sending only its own field.

**Everything is mutation-tested.** 40+ mutants introduced and confirmed to redden. Three guards were
found to be incapable of failing and were rewritten before being trusted:
- the targeting purity test used ids already in alphabetical order, so an in-place sort was a no-op;
- the read-API strategy test used a fixture every strategy ranked identically;
- the new `loadAnsweredAttemptIds` guard matched the *import* rather than the call, so a file could
  import the helper and query around it.

**Three design defects were caught in the spec revision and never built.** See the spec's §0 and
§3.4.1: the unfiltered attempt window, the structurally-always-zero repeatBonus, and the
read-modify-write panel clobber.

**Two things the plan got wrong about the code**, both corrected in place:
- `export { X } from '…'` creates no local binding, and `articulation.ts` reads both constants as
  defaults — it must import and re-export.
- Widening `RawCategoryRow` with `weight`/`cardId` forces every `toTopicRows` fixture to carry
  fields the function ignores. Prisma's inferred row type already carries them; the extra fields
  ride along structurally.

**One structural change the plan did not anticipate:** the attempt-window query moved into
`src/lib/quiz/history.ts` as `loadAnsweredAttemptIds`. Item 2b's guard forbids
`ANSWERED_ATTEMPT_WHERE` in `src/actions/quiz.ts` — correctly, since its in-flight lookups must
never filter — and Task 7 needs that exact filtered window on the results screen. The query moved
to the one file allowed to hold it rather than the guard being loosened to admit `quiz.ts`.

**LIVE GATE PASSED 2026-08-13** (run by the user in the browser; verified from the database side
with `npm run tuning:check`, a new read-only script that calls the real `getLearnerMetrics` —
necessary because two of this spec's effects render nowhere until 3C).

- **Panels persist.** The stored row ended up as `bands: {too_terse:[1,2]}`,
  `thresholds: {minObservations: 1, articulationMinPKnown: 0.8}`, `strategy: balanced` — three
  fields written by three different panels, coexisting. That is the **discriminating** case for
  partial saves: an earlier snapshot with `bands: {}` could not tell the correct design from the
  write-all-three one, because both produce that row. The user separately confirmed the settings
  survived a quiz.
- **The observation floor demonstrably works.** With the floor at 1, the topic carrying the one
  studied card went `null (below floor)` → **0.131**, and its two KLPs went `sufficient: false`
  → `true`, sorting to ranks 0 and 1 above all 24 sub-threshold candidates.
- **The ranking arithmetic reconciles.** Scores 0.312 (weight 5) and 0.196 (weight 3) reproduce
  `balanced` by hand from pKnown 0.131 and readiness 0.5 — so the floor, the strategy, the KLP
  weight and the topic's readiness are all genuinely feeding the order rather than merely
  appearing in it.

**Two preconditions the gate discovered, both non-obvious and worth knowing before judging this
feature "empty":**
1. A card must be **both categorized and have live KLPs** to be rankable at all. At first run the
   library had 68 KLP-bearing cards and 4 categorized cards with **zero overlap**, so the ranked
   list would have stayed empty however much the user studied — indistinguishable from a broken
   feature. `tuning:check` now reports this coverage explicitly.
2. Categorizing a card **retroactively** pulls existing `KlpState` evidence into its topic —
   posteriors are keyed by KLP id, so no re-quizzing is needed.

**Left in a test state on purpose** (the user's call to revert or keep): `minObservations` 1,
`articulationMinPKnown` 0.8, a `too_terse` band override, and a `test-category` category.

### 4. ✅ Spec 3C — learner dashboard & study scope — **BUILT 2026-08-14. LIVE GATE PASSED 2026-08-17.**

All 12 tasks + Task 4B, eight commits (`aa979da` … `fd4e670`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1181 → 1286** (105 files), `tsc` clean, lint **185** (unchanged).

`/profile/learner` exists and is the first production caller of `getLearnerMetrics`. A fourth `LearnerTuning` blob holds the saved study scope, with a fourth `/settings/ai` panel and a quiz-setup prefill. Both Spec 3 §14 prompt-block defects are closed.

**Verified live, headless:** Task 4B took the ranked list from **28 to 152 candidates** on the real library — 124 uncategorized KLPs that targeting could not previously see. `npm run tuning:check` now reports coverage from the same helper the page uses, and prints the diagnosis the dashboard would render.

**Everything mutation-tested — 48 mutants, all killed.** Five of them only died after the *test* was fixed:
- a `parseStudyScope` spread copied the array **references**, so one caller mutated the shared module constant. Caught by its own "returns a fresh object" test failing an unrelated assertion.
- a `Uncategorized` mutant that only flipped `checked` rather than removing the option — invisible to every assertion.
- a fixed 600-char topic reserve in `capBlock` that could be set to **zero** with no test noticing; removed rather than kept as a magic number.
- a capBlock sweep that sampled one card-section size where the boundary happened not to bite (now sweeps 31).
- an assertion for the `By topic:` header, which survives while the line beneath it is dropped.

**Two type-level facts worth keeping:** `StoredStudyScope` must be a **type alias, not an interface** — TS infers an implicit index signature for aliases only, and Prisma's `InputJsonValue` requires one, so an interface needs a cast that defeats validating the blob. And making `studyScope` **required** on `shapeTuning`'s input is what made `tsc` name all three `select` clauses that needed it; optional would have compiled clean and handed `undefined` to the parser, which degrades silently to an empty scope — the setting would appear to save and then not exist.

**GATE PASSED 2026-08-17**, run by the user in one session (trap 6 — no signed-in page is reachable from an agent session). Checked: the four-panel partial-save proof, the saved-scope notice and "Show everything", the all-stale widening notice, the quiz prefill in and out of scope, and the empty-state copy quoting a floor of 1.

<details>
<summary>Superseded: the in-progress entry</summary>

Spec: `specs/2026-08-05-spec3c-learner-dashboard-design.md` — revised 2026-08-13 against shipped 3B, and **widened**: it now also carries a **saved study scope** setting (its §6), added at the user's request. §5 widened again 2026-08-14 to **four** empty causes.
Plan: `plans/2026-08-14-stage8-spec3c-learner-dashboard.md` — 12 tasks + Task 4B.

**Task 4B added 2026-08-14: uncategorized KLPs enter targeting.** Candidates walk `CardCategory` → card → live KLP, so a card with no category is in no topic and therefore in no candidate list, even though `KlpState` holds a real posterior for it. Only `readiness` is topic-derived, and `articulationGap` already treats null as "no articulation problem" — so the topic is load-bearing for the *query shape*, not the scoring. Uncategorized KLPs now rank; they do **not** get a topic-mastery row (a grab-bag is not a concept). This turns the 68-vs-4 empty dashboard from a thing to explain into a thing that works.

The dashboard is the **first production caller of `getLearnerMetrics`**. It renders `ranked` in the order received — 3B already applied the learner's strategy, so a component that re-sorts is a defect, and a test asserts the DOM follows a reordered fixture.

**Saved study scope** (§6): a fourth panel on `/settings/ai`, a fourth sparse blob (`studyScope`) on the existing `LearnerTuning` row, riding the partial `saveTuning` that 3B built. Two checkbox groups — sets and categories. **Decided with the user:** it scopes the dashboard default and the ranked list, and **prefills** quiz setup's category selection, overridable; it is **not** an enforced filter, and it **never** touches what is recorded. Sets store ids, categories store `normalizedName` (a `CardCategory` row is set-scoped, so ids would mean one set's "accounting" only).

**Must also close both Spec 3 §14 follow-ups** — still open, re-verified 2026-08-13:
- `profileToPromptBlock`'s callers hardcode `topics: []` (`src/lib/ai/context.ts:155`, `src/actions/training-plan.ts:34`), so topic-grain data reaches **no prompt**.
- `capBlock` truncates the topic section **first**, because the uncapped card section is concatenated ahead of it.

**Fix both together or neither** — closing the first alone silently drops the topic signal the moment an active learner's card section fills `MAX_PROFILE_CHARS`. Shipping a dashboard that shows topics while every prompt still sees `topics: []` would say plainly that the dashboard and the AI are looking at different learners.

**Four empty causes, not one** (§5), two of which the 3B gate produced and which read as a broken page: no history at all; evidence below the learner's floor; **no card that is both categorized and has live KLPs** (the real library had 68 KLP-bearing cards and 4 categorized cards with zero overlap, which yields an empty dashboard however much the learner studies); and a valid-but-narrow saved scope. The last two must not be merged — both are "nothing is categorized", but the remedies are opposite (categorize vs. widen). Also worth telling the learner: categorizing an already-studied card works retroactively.

**Do not hardcode 3 as the evidence floor** anywhere in the copy — it is `MetricThresholds.minObservations` per learner since 3B, and a learner who set it to 1 would be told they need evidence they already have.

</details>

### 5. ✅ Profile & sets UI overhaul — **BUILT 2026-08-14. LIVE GATE PASSED 2026-08-17.**

Plan: `plans/2026-08-14-profile-and-sets-ui-overhaul.md` (written from an audit — every task closes a named, checkable gap, not a taste call).
Commits `70d5f35`, `17b31f7`, `6e103f5`, branch `spec3b-tunable-scoring`, **not merged**.
Tests **1286 → 1311** (108 files), `tsc` clean, lint **185 → 178** — the 7 dead imports on the set detail page.

**Profile area.** Three sibling pages had no navigation between them (Spec 3C created that by adding the third) and the parent was titled *"Your Learning Memory"* while a child was *"Memory History"*. Now one `ProfileNav` tab strip on all three — **Overview / Learner Profile / Memory History** — with **exact-match** `aria-current`; a `startsWith` test would mark Overview current on every child route. `/profile`'s "Performance by Mode" panel was **removed, not restyled**: a flat average score per quiz type beside a BKT posterior asks the reader to reconcile two numbers answering different questions. Attempt *counts* stayed — activity facts, not judgements. The full-route spinner is gone; header and nav render before the stats, so a learner waiting on `getUserStats` can still navigate.

**Sets surfaces.** `SetCard` now shows a **Private/Shared badge** (visibility shipped in item 1 and appeared nowhere in the list), confidence, studied-of-total, a due badge, and last-studied in place of created. `loadSetStudySummaries` is one query for the page, shared with the set detail header so the two cannot disagree. The nested `<Button>` inside the card `<Link>` is gone — invalid HTML and a duplicate tab stop.

**A convention bug caught before it shipped:** the first implementation treated a **null `dueAt` as NOT due**. `getDueCards` (`src/lib/memory/schedule.ts:185`) does the opposite — `OR: [{ dueAt: null }, { dueAt: { lte: now } }]` — and the schema comment says so. Null means never scheduled, which is a reason to review. Diverging would have made the sets list report fewer due cards than Review mode then offers, with nothing to tell the learner which surface was lying.

**Mutation testing, 11 mutants, 10 killed and one deleted.** The null-average ternary (`count === 0 ? null : …`) turned out to be **unreachable** — a bucket only exists because a row created it — so it could be flipped to `? 0` with no test noticing. The branch was removed rather than kept; the real guarantee is that an unstudied set gets **no entry in the map at all**, which the test now pins. Same call as the 600-char reserve in Spec 3C Task 12.

**Also worth knowing:** two component tests failed on **timezone**, not logic — `new Date('...T00:00:00.000Z')` formats to the previous day west of Greenwich. Date fixtures compared against `format` output must use local-time constructors (`new Date(2026, 6, 1)`).

**GATE PASSED 2026-08-17** (trap 6): the nav appears on all three profile pages and marks the right tab; `/profile` renders header and nav before stats; `/sets` shows visibility on every card.

> **PARTLY SUPERSEDED by item 6b (2026-08-16).** The rest of this gate — "study state on a studied
> set, and neither a 0% nor a due count on an unstudied one" — **cannot be checked any more**: 6b
> removed confidence, studied-count and the due badge from `SetCard` outright at the user's request.
> The `SetCard` tests now pin their ABSENCE. Only the visibility badge and the last-studied date
> remain from this item's sets work.

### 6. ✅ Design system & scope redesign — **BUILT 2026-08-15. LIVE GATE PASSED 2026-08-16.**

Spec: `specs/2026-08-15-design-system-and-scope-redesign-design.md` (audit first, design second).
Five waves, one commit each (`20c865f` … `e80e88b`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1311 → 1340** (108 → 112 files), `tsc` clean, lint **178 → 176**.

Triggered by the user's report that "all the filters under profile is way too complicated", widened
at their request to the whole app's visual language. **Do this before Spec 4** — Spec 4 adds a third
scope picker (`inputScope`), and building it on the old model would have duplicated the mess again.

**The root cause of "it doesn't look professional" was in the tokens.** Every value in `globals.css`
was `oklch(L 0 0)` — zero chroma, including all five `--chart-*`; the only chromatic token was
`--destructive`. That absence is why **149** raw Tailwind palette values had accumulated across
`src/`. Now: one ink-indigo accent, a **sequential** `--know-0..4` ramp (mastery is an ordered
quantity, not a category), an ordinal `--severity-*` scale on a distinct hue axis, five real chart
hues, and Fraunces / IBM Plex Sans / IBM Plex Mono replacing Inter doing all three jobs.

**Dark mode was fully written and unreachable** — `.dark` was complete, nothing ever applied the
class, and the 7 files hardcoding `bg-gray-50` would have rendered broken if it were switched on.
Now real, with a navbar toggle placed outside the auth branch.

**Four chip implementations became one** (`SelectableChip`). Selection is an accent fill everywhere,
never the category's own colour: two of the four used `${color}20` with that colour as the *text*,
which a reachable dark mode turns unreadable. Identity survives as the dot; a check mark means
selection is never colour alone.

**The scope filter is one collapsed line.** The Card `<select>` is deleted (disabled unless exactly
one set was selected, explained only in a `title`); `source` stopped being scope and the "By mode"
chips *became* the control they used to sit uselessly beneath; the saved-scope notice, the "Show
everything" button and the chip panel folded into one line. `ProfileNav` now carries scope across
tabs — it was silently discarded before, though both pages parse the same `HistoryScope`.
`StudyScopePanel` lost the checkbox whose only extra state was invalid, deleting the block logic.

**One confirmed functional bug fixed:** Print Test built `?modes=&side=&count=` only while the print
page typed exactly those keys and read every card — so Starred/Failed/Categories were silently
dropped. Both halves fixed, the page now running the *same* `filterQuizCards` the quiz runs.

**Four findings worth more than the diff** are in the spec's §7 — including a third
guard-that-could-not-fail, and the card chip still being hideable despite the design saying it must
not be.

**LIVE GATE PASSED 2026-08-16** (run by the user — trap 6). The three load-bearing checks all
worked: **dark mode**, **Print Test with filters**, and the **`/settings/ai` panel saves**. Those
three were ranked risky for three different reasons — ~150 token substitutions are invisible to the
suite (a wrong-but-valid token compiles and passes), the print page half is a server component with
no test coverage in this repo, and the settings panel is the only one that **writes to the
database**, where Spec 3B's partial-save contract could break with no mock noticing. The three
cheap checks (scope line opening, scope surviving a tab change, by-mode chips) were **not separately
confirmed** — all are unit-tested with killed mutants and inert-if-broken. Recorded as unconfirmed
rather than assumed. Detail in the spec's §8.

### 6b. ✅ UI polish — set page, edit visibility, memory history table — **BUILT 2026-08-16. LIVE GATE PASSED 2026-08-17.**

No spec — a direct list of user-reported changes after living with item 6. Branch `spec3b-tunable-scoring`, **not merged**.
Tests **1340 → 1372** (112 → 114 files), `tsc` clean, `next build` clean, lint **176** (unchanged).

**Set surfaces.** Category chips came off the flashcard carousel (the filter bar above is the one
place category is a *control*), as did "Click card to flip" — and the flip target became a real
`<button>`, since that text was the only thing announcing an affordance a `<div onClick>` offered to
mouse users alone. `VisibilityToggle` is **deleted**; visibility is now a dropdown at the top of
`/sets/[id]/edit` (`VisibilityMenu`), and the activity tiles moved up into the block it vacated,
made small and given one shared surface instead of three chart hues. Confidence, studied-count and
the due badge are gone from both the set page and `SetCard`.

**Memory History.** "Showing" → "Filter by:", and the by-mode chip row under the stat tiles was
**removed, not restyled** — it was a second filter surface sitting below the numbers it filtered.
Its dimension became a third `MultiSelect` in the scope line beside sets and categories, which
required `HistoryScope.source` (single) → **`sources` (list)**; "how did I do on the two written
modes?" was previously unaskable. The feed is now a table (card / set / type / date / accuracy /
confidence) and a row's primary click opens `/profile/activity/<sessionId>` instead of narrowing the
page to that card — the old click produced a filtered copy of the list you were already reading.

**Four things worth more than the diff:**
- **The URL key did not change.** `sources` still serializes to `?source=`, comma-joined, so
  `ProfileNav`'s `SCOPE_PARAM_KEYS` needed no edit and single-value URLs written by the old version
  still parse. A test pins that.
- **`bySource` had to stop being counted under its own filter.** It is the picker's option list, so
  under the full scope, selecting Multiple Choice drove every other option to 0 — reading as those
  activities having been deleted, on the exact interaction that reveals the counts. Now counted with
  the source dimension removed and the others kept. This one had **no guard until one was written**;
  it was the only mutant of five that survived.
- **Moving the visibility control broke "Copy link" silently.** It used `window.location.href`,
  which on `/sets/<id>/edit` copies an edit URL the recipient cannot open. Rebuilt from `setId`.
- **The card-scope affordance had to be preserved deliberately.** Clicking a term was the ONLY route
  into card scope, which is the only route to "Forget this card" — already lost once (`f4236d9`).
  Reassigning the row click to the permalink would have lost it again, so it survives as its own
  always-visible button (never hover-only: that would also put it out of reach on touch).

**Five mutants introduced, five killed** (after the facet guard was written): truthy-`score` in
`outcomeText` swallowing a real 0%, an unconditional permalink linking `/profile/activity/null`,
the activity picker rendering on the learner dashboard (where filtering a knowledge model by answer
mode halves every posterior), `sources` dropped from `isConsolidated`, and the facet count above.

**GATE PASSED 2026-08-17** (trap 6): every surface here is signed-in only. Checked: the edit-page
visibility dropdown **persists and Copy link yields `/sets/<id>` not `/sets/<id>/edit`**; the
activity picker filters the feed and its option counts **do not collapse** when one is selected;
a feed row opens the right activity, and a row with no session renders unlinked; and the set page
shows tiles where the visibility panel was, with no confidence or studied numbers anywhere.

### 6d. ✅ Account page & the learning/account naming split — **BUILT 2026-08-17. LIVE GATE PASSED 2026-08-17.**

No spec — a direct user request. Branch `spec3b-tunable-scoring`, **not merged**.
Tests **1372 → 1404** (114 → 116 files), `tsc` clean, `next build` clean, lint **176** (unchanged).
**Migration `20260817000000_user_handle_and_contact` is APPLIED to the dev database**, verified
by a follow-up `migrate diff` reporting an empty migration.

`/account` exists: handle, account email (read-only), contact email, email-updates opt-in,
theme, and a sign-in section. The three `/profile/*` pages are now the **Learning** section —
navbar link, `/profile` `<h1>` and the `ProfileNav` landmark all renamed, with cross-links
both ways. This is **step 1 of item 6c's build order**: `User.handle` + `normalizedHandle`
ship here, so the sharing work starts at step 2.

**Two of the six requested items were deliberately NOT built, each for a stated reason** —
both decisions taken with the user:
- **Language** — the app has no i18n whatsoever (no library, no catalogue, every string a
  literal). A selector with one entry is a promise it cannot keep.
- **Password** — half of credentials auth, not a settings field. It ships with the login page
  or not at all. See the `wants-credentials-login` memory; note it would also close **trap 6**,
  since an agent could then sign in and run its own live gates.

**Three design points worth keeping:**
- **`contactEmail` is a separate column from `email`.** `email` is identity and the future
  password-reset address, so editing it needs a verification round trip it does not have —
  making it editable would be an account-takeover vector. A contact address cannot recover an
  account, so it is safe to edit freely. That split is what makes "add your email" buildable
  today.
- **One action per field**, not one `saveAccount(partial)`. The structural version of the
  `/settings/ai` partial-save contract — a clobber is unrepresentable here rather than merely
  tested for.
- **Handle collisions are resolved by the P2002 constraint violation, not a pre-flight SELECT.**
  A check-then-write is a TOCTOU bug, and the collision is ordinary use (two people want the
  same name), not an edge case.

**A dead reservation the tests caught:** `me` was in `RESERVED_HANDLES` but is 2 characters, so
`too_short` returns before the reserved check ever runs — protection that could not fire.
Removed, and an invariant test now pins that every reserved entry would otherwise be a *valid*
handle, which is what makes the "every reserved name is rejected as reserved" test a real claim.
Same call as the unreachable ternary in item 5 and the 600-char reserve in Spec 3C.

**Three mutants introduced, three killed:** writing `handle` without `normalizedHandle`
(leaving the uniqueness key null for that row), treating any database error as "already taken",
and comparing the reserved list case-sensitively.

**Deferred deliberately:** the routes are still `/profile/*`. Renaming them to `/learning/*`
touches **23 call sites** including `revalidatePath` strings and the memory-scope query params;
it wants its own commit and its own verification, not a ride-along.

**GATE PASSED 2026-08-17** (trap 6): a handle set and persisted; a reserved one
(`admin`) and a taken one; save and then **clear** a contact email; toggle email updates and
reload; confirm the theme choice matches the navbar toggle; confirm the navbar shows both
**Learning** and **Account**.

### 6f. ✅ Study candidates say what they are — **BUILT 2026-08-17.**

No spec — a direct user request after the gate run. Branch `spec3b-tunable-scoring`.
Tests **1404 → 1412**, `tsc` clean, `next build` clean, lint **176** (unchanged).

**`/profile/learner`'s study list rendered the literal words "Key point" for every row.**
`StudyNextRow` has always accepted `text`, `term` and `topicName`, and the page populated only
`topicName` — so the fallback in `CandidateRow` was the entire list. On a library where most
cards are uncategorized (Task 4B put 124 such KLPs into targeting) that is a page of identical
rows reading "Key point / Uncategorized".

Fixed by widening the two loaders' selects — `CardKlp.text` and `Card.term` — and gathering the
labels in the **same walk** that already builds `klpWeights`/`klpCardIds`, so no extra query.
Exposed as `LearnerMetrics.candidateLabels`, a `klpId → { text, term }` map kept **beside**
`ranked` rather than folded into it: `targeting.ts` scores, and a scoring module should not carry
prose it never reads. The page merges labels exactly where it already merged `topicName`.

**Two behaviour changes beyond the labels:**
- **The sub-threshold group is now ordered by `observations`, not by score.** Below the floor,
  `score` is largely a function of the BKT prior — most candidates are tied at it — so ordering
  by score there ranks noise and presents it with a measured recommendation's authority.
  Evidence is the one thing that genuinely differs, and "closest to being measurable" is the
  useful order. Ties fall back to score, then to input order (`Array.sort` is stable). The rule
  is scoped to the sub-threshold group: applying it above the floor would override the learner's
  chosen strategy with a proxy for "how much have I answered this".
- **The answer count renders on every row**, measured or not — it is the sub-threshold sort key,
  and an order with its key hidden is not readable as an order. **`pKnown` stays gated on
  `sufficient`**: "50% known" beside a single answer states a confidence the evidence cannot
  support, which is the floor's whole purpose. Zero renders as "No answers yet", not "0 answers",
  which on this list reads as a score rather than a state.

**Five mutants introduced, five killed** — the evidence ordering (twice: single-strategy and
all-strategy), the count hidden on unmeasured rows, and the proposition replaced by the literal
fallback. Before these tests, **none of the three behaviours had any coverage**: the first full
run after the change passed untouched.

### 6e. ✅ Credentials auth — **BUILT 2026-08-18/19. LIVE GATE PASSED 2026-08-19 — the first live gate in this project run by an agent, not handed to the human. Closes trap 6.**

Design + task order: `specs/2026-08-17-credentials-auth-design.md`. Plan: `plans/2026-08-18-credentials-auth.md`. Ledger: `.superpowers/sdd/2026-08-18-credentials-auth/progress.md`. Task 10 report: `.superpowers/sdd/2026-08-18-credentials-auth/task-10-report.md`.
22 commits (`fdb6c42` … `2d50cca`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1412 → 1522** (116 → 127 files), `tsc` clean, `next build` clean, lint **176 → 175** (131 errors, 44 warnings — one below the baseline this queue has tracked since item 6b).

**The final whole-feature review found one thing eleven task reviews could not, and it is the argument for running one.** Three separate strings told a password-only account it had GitHub: `/account` named GitHub as the sign-in method *and* as the source of the account email, and the password panel said GitHub was "the only way back in" — for an account Auth.js will refuse with `OAuthAccountNotLinked`. With no password reset, that last one is the difference between "keep this safe" and "you have a fallback". None of it was wrong when written; the app simply used to have exactly one way in, and the copy stated that as fact. It fell between tasks because every task's own diff was correct. Closed in `2d50cca` by deriving `hasGithub` the same way `hasPassword` is derived — selected, never returned raw — and gating the copy on it.

Sign up and sign in with a username-or-email plus password, alongside GitHub OAuth. Chosen over item 6c and item 7 because a public directory is for strangers and a stranger cannot sign up today, and because it closes trap 6. **Two facts made it smaller than it looked:** `session: { strategy: "jwt" }` was already set in `src/auth.ts`, and `User.handle`/`normalizedHandle` from item 6d meant the username half needed no new validation. **One fact made it dangerous:** `src/middleware.ts` imports `auth.config.ts` on the **edge runtime**, so the Credentials provider had to live in `src/auth.ts` only — enforced by a guard that walks the transitive import graph, not a string search.

**Sign-up sits behind `CREDENTIALS_SIGNUP_ENABLED`, off by default — the user's call, confirmed live on 2026-08-18/19.** The design's recommendation (public sign-up with no password reset carries more risk than the trap-6 win justifies) became the shipped behaviour. Sign-in is **never** gated — that is the entire point, since sign-in is what closes trap 6. **Includes `scripts/seed-dev-user.ts`** (Task 9), the piece that actually ends the human-gate bottleneck: it upserts `dev_user` / `dev@localhost.test` and refuses to run against a production `DATABASE_URL`.

**Three real defects found during build, none of them anticipated on paper:**
- **Task 7 shipped a Critical: the callback-URL open redirect was bypassable**, and closing it took three review rounds. `raw.startsWith('/') && !raw.startsWith('//')` validated a string the WHATWG URL parser then rewrites (folding backslashes, stripping control characters), so `?callbackUrl=/\evil.com` passed the guard and resolved off-origin through both `router.push` and `@auth/core`'s default redirect callback. Round 2 closed every reported payload but left a dot-segment class (`/..//evil.com`) that still resolved off-origin; round 3 parses the callback against one sentinel and validates the *output* against a different one, and a ~700,000-input fuzz across 11 attack classes then found zero escapes.
- **Task 4's edge-safety guard had a gap that would have hidden its own defeat.** The import-graph walk missed `await import(...)` dynamic imports and matched forbidden subpaths by exact string only, so `@prisma/client/edge` slipped straight through a check written to catch `@prisma/client`. Fixed by extracting `parseImports`/`isForbidden` as pure functions with their own tests.
- **Task 8's password-change action passed all nine of its tests while hashing the wrong field.** `hashPassword`/`verifyPassword` were mocked and no test inspected their *arguments*, so a mutant that called `hashPassword(input.current)` — locking the account to the OLD password on every change — was indistinguishable from correct. The seventh could-not-fail guard this plan produced.

**One design point worth keeping, because Task 10's gate depended on it:** revocation was traced end to end during Task 4's review and genuinely works. `jwtCallback`'s no-user branch returns the token unchanged on a `sessionVersion` match and `null` on mismatch, with **no healing path** — `sv` is only re-stamped at a fresh sign-in. But **the RSC `auth()` path discards the clearing `Set-Cookie` header** (`next-auth` `json()`s the response before returning it), so the cookie can outlive the session it names; eviction happens only on `/api/auth/session`, API routes and middleware. Recorded as Ruling R8 specifically so Task 10 would assert *denied access*, not a vanished cookie.

**LIVE GATE, run 2026-08-19 against `npm run dev` (secrets passed to the process — `.env` still carries neither) and the real dev database:**
1. **Suite/types/build/lint** — 127 files / 1517 tests passed, `tsc --noEmit` silent, `next build` compiled clean, lint **175** (131 errors, 44 warnings). (The final review's fix wave later took this to **1522**; the gate itself ran at 1517.)
2. **Handle sign-in** — `dev_user` + password → `/sets`, navbar shows Learning / Account / Sign out. **This is the trap-6 close.**
3. **Email sign-in** — `dev@localhost.test` + the same password → identical result, proving the either-identifier lookup runs against the real database, not a mock.
4. **Failure message is identical for both misses** — a wrong password on the real account and a fully unknown identifier both rendered the exact string `Email or password is incorrect.`, byte for byte. No enumeration oracle.
5. **Protected-route round trip** — signed out, `/sets/<id>/quiz` → redirected to `/login?callbackUrl=%2Fsets%2F<id>%2Fquiz`; signing in landed on the quiz page itself, not `/sets`. (`dev_user` started with zero sets; one was created through the UI to get a real id to redirect to.)
6. **The flag gates sign-up, not sign-in** — restarted the server without `CREDENTIALS_SIGNUP_ENABLED`: `/signup` 404s, `/login` shows no "Create an account" link, and signing in with the existing password still worked.
7. **Revocation denies access, exactly as Ruling R8 predicted** — changed the password at `/account`; the very next request to `/account` itself bounced to `/login?callbackUrl=%2Faccount`, and a fresh request to `/sets` rendered the signed-out "Sign in to see your sets" state. Denied access without a vanished cookie — the RSC-discards-`Set-Cookie` behaviour Task 4 flagged, observed live rather than assumed. Signed in with the new password to confirm it worked, then ran `npm run seed:dev-user` to restore the original password and confirmed that signs in too.

**Two things this gate could not run, and why — owed to the human:**
- **GitHub OAuth.** `.env` has no `GITHUB_ID`/`GITHUB_SECRET`. Clicking "Continue with GitHub" produced no server-side request at all (confirmed against the dev server log) — the provider is unreachable, not merely untested.
- **The `OAuthAccountNotLinked` copy** (Task 7) needs a real GitHub account whose email matches an existing password account — not producible from this environment.

### 6c. ⬜ Sharing, collaboration & discovery — **DESIGNED 2026-08-17, NOT STARTED.**

Design: `specs/2026-08-17-sharing-collaboration-and-discovery-design.md`. No plan, no code.

Requested by the user while reviewing 6b. Four interlocking features: **collaborators**
("Editable by"), **fork** ("make my own copy"), **public visibility + a browsable directory**
crediting a handle, and a **real homepage** (Recents / For you / Your sets) in place of the
current redirect to `/sets`.

They all widen `src/lib/sets/visibility.ts` — the module that exists because a security pass
found ten read-by-id exposures — which is why this was designed before any code.

**Three decisions taken with the user 2026-08-17:** a fork is the forker's outright (they may
publish it themselves, with carried attribution); "For you" ranks by the learner's weak
categories via `getLearnerMetrics`; and creators are credited by a **separate handle**, never
by `User.name`, which is the OAuth provider's real-name field.

**Seven defects killed on paper** — see the design's §9. The two worth knowing before touching
this: a fork that *shares* a `CardAsset` makes `/api/assets/[id]` **non-deterministic**, because
it resolves permission through `contentBlocks[0].card.set` with `take: 1` and a shared asset now
has blocks in two sets; and rendering fork attribution from the live FK **leaks the title of a
set the author just made private**. Both forced real design changes (copy the blob; denormalize
the credit and link it only when the viewer can read the source).

**Weakest part, deliberately built last:** cross-user category matching for "For you" is a
string match wearing a concept's clothing — `CLAUDE.md`'s 2026-08-14 note already records that
user categories are often *format* labels ("label the image", "vocabulary"), so one account's
`vocabulary` is Spanish and another's is finance. Mitigations in §7; do not let it write to the
learner model.

Build order is the design's §11: handles → `public` → directory → fork → homepage →
collaborators → "For you". Steps 1–3 are one unit; collaborators and "For you" each want their
own spec.

### 7. ⬜ Spec 4 — plan setup & readiness dashboard — **DESIGNED 2026-08-14, NOT STARTED.**

Belongs to Stage 8 Spec 4 (action plan & AI lessons). Designed with the user on 2026-08-14 and captured here so it survives; **no spec doc, no plan, no code.**

**The gap.** `TrainingPlanPanel` is one button at the bottom of the quiz page that calls `generateTrainingPlan(setId)` blind — no scope, no preconditions, no idea whether the profile it is about to send is worth anything. Quiz setup exists; plan setup does not.

**Shape.** Its own route, two states. *Setup*: scope pickers (prefilled from the saved study scope, overridable per plan) + readiness readout + generate. *Generated*: the plan, with setup collapsed to a one-line summary bar and a "Change" affordance that re-expands it.

**Readiness readout — five components, and the aggregation rule is the design:**

| Component | Reads | Why |
| --- | --- | --- |
| Breadth | in-scope cards with live KLPs / cards in scope | no KLPs, nothing to target |
| Depth | KLPs clearing **the learner's** floor / KLPs with any evidence | the one the 3B gate showed dominates |
| Recency | share of evidence in the last N days | a posterior from 3-month-old answers describes someone who no longer exists |
| Mode balance | evidence weighted by mode | Spec 2a already prices this — SA .95 / MC .75 / TF .50. An all-TF corpus carries half the evidentiary value per answer and nothing currently says so |
| Extraction | cards with `klpStatus: 'pending'` | distinguishes **wait** from **do something** |

**The verdict is the MINIMUM of the components, never the average.** Averaging lets breadth mask zero depth — exactly the state the library was in at the 3B gate (plenty of KLPs, none measured), which an average would have called "moderate". Three bands (thin/usable/solid), **never a percentage**: a number invites comparisons it cannot support and hides which part is thin. Each band names what would move it up — the component that produced the minimum. Computed in TypeScript, never asked of the AI, same rule as significance and mastery.

**Error states reuse Spec 3C's `diagnoseEmptyState`** (`src/lib/metrics/coverage.ts`) — the same four causes, plus a fifth: extraction pending. This is why `coverage.ts` is built as shared substrate in 3C rather than dashboard-private; two implementations would drift into disagreeing about whether the learner has enough data.

**Per-category table** — cards / with KLPs / measured / answers / last studied / verdict, per category plus Uncategorized. The honest half of the feature: it shows *where* the data is thin instead of averaging it away, which is what lets the learner deselect a category or go extract KLPs for it.

**Two decisions the user accepted:**
- **Regeneration is explicit, never automatic on a settings change.** Changing scope updates the readiness readout live (pure local computation) and surfaces a "Regenerate with these settings" button. A plan that silently reshuffles under the learner destroys the thing that makes it a plan, and it spends an AI call per toggle.
- **Store the inputs on the plan row** — `inputScope`, `inputCoverage`, and the thresholds in force. Cheap, and it is the difference between a plan artifact and an auditable recommendation: the plan can say what it was built from, and "your data has changed a lot since this plan" becomes computable.

**LESSON OUTPUT TYPES — decided with the user 2026-08-20.** The readiness/setup half above was designed 2026-08-14; the *lesson generation* half had no design at all, and this is the first decision taken on it. A lesson may carry:
- **Curated links to existing media** — the AI recommends video or reading that already exists (YouTube and similar) against a named weak KLP.
- **Media the learner already has** — the Stage 5 `CardAsset`/Vercel Blob work is reused, so a lesson can surface an image or video already attached to a card rather than inventing one.

The rule the user set is **"use existing media, if it exists"** — v1 curates and reuses, it does not synthesize. Two consequences to design around when this is specced: a curated link **rots** (the video is deleted or made private), so a lesson must degrade to its text without breaking, and a recommended link is an **unverified third-party claim** — the AI is asserting relevance to a KLP it cannot watch. Neither is a reason not to build it; both are reasons the lesson's own explanation must stand alone.

**FUTURE BET, explicitly not v1 — generated video/audio.** Synthesizing narrated audio or video from a lesson. Recorded here at the user's request so it is not lost. It is gated on **Stage 4 (voice), which is unbuilt**: TTS is the same capability the voice-interview stage needs, so building it here first would either duplicate that work or pre-empt its design. It also carries per-minute generation cost against the user's own provider keys, plus rendering and storage nobody has sized. Revisit after Stage 4, not before.

### 8. ✅ Open the doors — password reset + invite codes — **BUILT 2026-08-20/21. LIVE GATE PASSED 2026-08-21 (agent-runnable half).**

Design: `docs/superpowers/specs/2026-08-20-open-the-doors-design.md`. Plan: `docs/superpowers/plans/2026-08-20-open-the-doors.md`. 12 tasks, commit range `8cb51dd..fb8a851`.

Not descended from any spec — it came out of reviewing item 6e with the user on 2026-08-20. **Chosen by the user over Spec 4 and over 6c.**

**Password reset and invite codes shipped as ONE item, not two**, per the original reasoning: reset without a cap means uncontrolled growth, invite codes without reset means handing someone a code to an account they can permanently lose. Together they are what makes `CREDENTIALS_SIGNUP_ENABLED=true` a decision the user can actually take — the flag itself did **not** flip as part of this work; that stays a deliberate human call (§8 of the design).

**What shipped:** `UserToken` (purpose-bound `sha256(purpose + ':' + raw)` hash, single-use, atomic consume) and `InviteCode` (Crockford Base32, `maxUses`/`usesRemaining`, expiry, `--revoke`) tables; `src/lib/mail/` (raw `fetch` to Resend, no `resend` package, console-transport fallback when `RESEND_API_KEY` is absent); `/signup` now requires an invite code and redemption is atomic with account creation; `/signup/check-email`, `/verify/[token]`, `/forgot`, `/reset/[token]`; the sign-in gate refuses an unverified address; `savePassword`/reset both bump `User.sessionVersion` and invalidate sibling tokens; `scripts/mint-invite.ts` / `npm run invite`.

**New baselines (this branch, 2026-08-21, after item 8):**
- **Tests:** 140 files / **1655 passing** (excluding `cursor-agents`)
- **`tsc --noEmit`:** clean (excluding `cursor-agents`)
- **`next build`:** clean
- **`npm run lint`:** **175 problems** (131 errors, 44 warnings) — unchanged from the item 6e baseline. Do not fix unrelated ones.

**Live gate (spec §12, steps 1-8, run by an agent against a local dev server with `CREDENTIALS_SIGNUP_ENABLED=true` set on the process only, no `.env` change, `RESEND_API_KEY` unset so links print to the server log):**

| # | Step | Observed result |
| --- | --- | --- |
| 1 | Mint `--uses 1` code, sign up with it | Signed up with `72EPZ-WPAA8`; redirected to `/signup/check-email`; verification link printed to server log |
| 2 | Sign in before verifying | Refused: "Your email address isn't verified yet. Check your inbox for the link, or send another below." |
| 3 | Follow verify link | Redirected to `/login?verified=1` ("Your email is verified. Sign in below."); sign-in then succeeded, landing on `/sets` |
| 4 | Reuse the same verify link | Rejected: "That link didn't work. Verification links expire after 24 hours and can only be used once." |
| 5 | Sign up again with the now-exhausted code | After a second signup exhausted `72EPZ-WPAA8` (2 of 2 used), a third attempt was refused: "That invite code isn't valid, has expired, or has been used up." |
| 5b | P2002 rollback: fresh `--uses 1` code, duplicate email, then same code + fresh email | Duplicate attempt (`dev@localhost.test`) refused: "Those details can't be used. Try something different, or sign in instead." — invite stayed at 0 of 1 used (verified via `npm run invite -- --list`), i.e. the failed transaction did **not** burn the invite. Retried with the same code and a fresh email → succeeded, and the invite then correctly showed 1 of 1 used. |
| 6 | `/forgot` for a real account vs. `nobody@example.invalid` | Byte-identical rendered text for both: "If that account exists, we've sent a link to its email address." Server log confirmed a reset mail was queued only for the real account. |
| 7 | Follow reset link, set new password | Reset succeeded; a tab with an active session for that account, refreshed after the reset, showed "Sign in to see your sets" — the old session was dead on the next request |
| 8 | Reuse the reset link | Rejected: "That link didn't work. Reset links expire after an hour and can only be used once." |

All nine steps (1 through 8, plus 5b) passed as designed — no deviations found in the live gate itself. The dev server was stopped afterward and `npm run seed:dev-user` restored the seeded account; sign-in with it was re-verified.

**Human gates still owed (spec §12, steps 9-10 — not producible from an agent session):**
1. **A real Resend delivery** — `RESEND_API_KEY` set against a verified sending domain, a message arriving in a real inbox, and its link working against the deployed origin.
2. **The Vercel Firewall rules** (runbook below) configured in the dashboard, and a burst of logins actually throttled.

**§14 known limits, carried verbatim:**
- A mail failure is silent to the user. `send.ts` swallows to protect the `after()` callback, so a user whose mail bounced sees "check your inbox" and nothing arrives. There is no bounce handling and no delivery dashboard in-app. Resend's own dashboard is the only place to see it.
- No account deletion, still. Invite codes cap how many accounts *are created*, not how many exist. A pool that has been fully redeemed cannot be reclaimed.
- `invitedByCodeId` is `SetNull`, so deleting an `InviteCode` erases the audit trail for accounts that used it. Prefer `--revoke`, which preserves the row.
- 50 bits of code entropy assumes the Firewall rule exists. Without §10's `POST /signup` limit, a determined attacker with a botnet has a materially better chance than the number suggests.
- The stale comment in `credentials.ts` ("unrecoverable with no password reset", justifying no password-policy check on sign-in) becomes half-false once this ships. The *behaviour* should not change — rejecting a legacy password at sign-in is still bad — but the comment needs rewording so the next reader does not act on a premise that no longer holds. **Closed:** Task 10 already reworded it; Task 12 re-verified with `grep -rniE "no password reset|no way back into this account|once password reset exists" src/` → clean.
- No admin UI. Minting, listing, and revoking are terminal-only. Revisit when handing out codes is frequent enough to be annoying, not before.

**Vercel Firewall rules — operator action, owed to the human. No code, no test.**

| Path | Limit | Why this path |
| --- | --- | --- |
| `POST /api/auth/callback/credentials` | 10/min/IP | The ~250ms bcrypt burner. CPU amplification as well as credential stuffing — and by design the unknown-account path costs the same, so an attacker does not even need real addresses. |
| `POST /signup` | 5/min/IP | Also the invite-code brute-force surface. 50 bits of code entropy assumes this rule exists. |
| `POST /forgot` | 5/min/IP | Mail-send amplification; someone else pays for the sends. |
| `POST /reset/*` | 10/min/IP | Token brute force. |
| `POST /login` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |
| `POST /verify/*` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |
| `POST /signup/check-email` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |

Server Actions dispatch on a `Next-Action` header and an action ID, not on the path, so a crafted
POST can invoke any action from any route. Path rules bound the browser flow only — pair them with
a broad `POST /*` limit if the invite pool is the thing being protected. **Verify this against
Vercel's current Server Actions dispatch behaviour before relying on it.**

**Per-account lockout is deliberately NOT built.** A hard lockout is itself an attack — anyone
who knows an address can lock its owner out on purpose, and there is no support desk to undo it.
Revisit only on evidence of real credential stuffing.

### 9. 🟡 Surfacing missed KLPs and weak topics — **BUILT 2026-08-24 as the KLT topic layer. SECOND ITERATION DESIGNED 2026-08-25 (concept tree), NOT BUILT.**

**Next action: `specs/2026-08-25-klt-concept-tree-design.md`.** The 3-rung ladder shipped and
generated cleanly, but the user wants 6-10 levels, and the first real run proved why that cannot
work as stored: `balance sheet` occupies rank 1, 2 AND 3 simultaneously depending on which card
produced it, because each key point's ladder is proposed independently. The tree design makes
depth a property of the concept (`Klt.parentKltId`), links each key point to its LEAF only, and
turns per-level mastery into a subtree query — zero extra AI calls, which answers the user's
token-cost concern. It supersedes §10 of the 2026-08-24 spec and takes the concept-graph bet
`CLAUDE.md` deferred.

**Built in THREE phases, each with its own plan** (spec §13): (1) substrate — schema, generation,
invariants, rollup, minimal display; (2) editor + seeding — the tree UI behind `KLT_EDITORS`, with
both user-authored and AI-suggested skeletons; (3) refinement + semantic audits. Stopping after
phase 2 is a legitimate outcome.

**The constraint that shapes the whole design (spec §12.1): the model collapses middle rungs.**
Asked to place `depreciation add-back` it returns four rungs, not eight — skipping `technicals`,
`financial statements`, `operating activities`, `non-cash charges`. An earlier draft of the spec
made exactly that mistake by hand and the user caught it. Hence seeding the top and refining the
middle, rather than prompting harder for depth.

Design: `specs/2026-08-24-klt-topic-layer-design.md`. Plan: `plans/2026-08-24-klt-topic-layer.md`. 14 tasks, commit range `7015788..HEAD`. **Both open questions below are now answered** — kept for the reasoning that produced them.

**New baselines (this branch, 2026-08-24, after item 9):**
- **Tests:** 153 files / **1790 passing** (was 140 / 1655) — excluding `cursor-agents`
- **`tsc --noEmit`:** clean · **`next build`:** clean · **`npm run lint`:** **175 problems** — unchanged from the item 8 baseline
- **Schema drift:** zero (`migrate diff` reports an empty migration)

**VERIFIED LIVE, against the real database — the guarantee this whole item hangs on.** The
summarization pass ran over all 69 KLP-bearing cards and afterwards
`supersededKlps=0`, `klpStates=5` (unchanged), `liveKlps=153` (unchanged). §6 holds in
Postgres, not just in mocks. Both safety guards were also mutation-tested: making the writer
set `supersededAt` turns 4 tests red, and removing the `isOwner` check turns the stranger-card
test red.

**TWO STEPS STILL OWED, both blocked on secrets an agent cannot supply:**
1. **The vocabulary has never been generated. ROOT CAUSE FOUND 2026-08-24:
   `GOOGLE_KEY_ENCRYPTION_SECRET` in local `.env` is a 22-character passphrase, not a base64
   32-byte key.** Every attempt dies with "must be exactly 32 bytes when decoded from base64"
   (`src/lib/security/api-key.ts:19`), so no credential decrypts and the backfill
   marked all 69 cards `kltStatus: 'failed'` with "All 2 AI attempts failed". That is the
   CORRECT classification (attempts were made, so not `skipped`), but it means **zero `Klt` rows
   and zero labels exist**. **Do not simply generate a new secret** — the stored credentials were
   encrypted with a DIFFERENT, valid secret (almost certainly the one in Vercel's env vars).
   Copy that exact value in; generating a fresh one strands all three `AiCredential` rows
   permanently and they must be deleted and re-entered. `.env.example` documents the format:
   `openssl rand -base64 32`, 44 characters, and the §9.4 fragmentation risk is entirely unmeasured. Re-run
   `npm run backfill:klts` with the secret present, then inspect the resulting topic list by
   hand before trusting topic mastery. The script warns on its own if topics exceed 60% of cards.
2. **The panel has never been seen with data.** `/profile/learner` loads clean (200, no runtime
   error, `getLearnerDashboard` 2.7s), but the seeded `dev_user` owns no cards, so
   `diagnoseEmptyState`'s blocking `no_klps` branch renders instead of the panel. The library
   with 68 cards belongs to a different account. Component tests cover the panel's rendering
   (9 tests incl. expand, label fallback, null-never-zero); what is unverified is the panel
   **on the page, with real rows**.

**DEFECT FOUND AND FIXED 2026-08-24, after the build.** The user reported "the KLTs are
outputting the same things as the KLPs". Investigation showed they were NOT seeing KLT output at
all — `Klt=0`, `KlpTopic=0`, `labelledKlps=0`, so every surface was falling back through
`label ?? text` to the raw proposition. But it surfaced a real asymmetry: **topic names were
validated in TypeScript and labels were not.** A model that echoes the proposition back as its
`label` would have persisted, making the row read exactly as it did before the layer existed —
the whole feature silently doing nothing. `parseKltLabel` now drops anything over 8 words / 60
chars (never truncates), label and topics fail independently, the prompt interpolates the
enforced caps so it cannot drift from them, and the backfill warns when label yield is under 50%.
Guard mutation-tested: removing the caps turns 5 tests red. Baselines after the fix: **153 files
/ 1790 passing**, lint still 175.

**One thing found and fixed during implementation, worth knowing.** `summarizeKltsForCards` was
first written into `src/actions/klt.ts`. Exported from a `'use server'` file it became a
client-callable RPC endpoint **taking a `userId` as its first argument** — owner-scoped
internally by `readableSetWhere`, but with no business being reachable at all. It now lives in
`src/lib/klt/summarize.ts`; the action keeps only the retry. **`extractKlpsForCards` has the
identical shape and is still exported from `src/actions/klp.ts`** — same latent issue, not
touched here because it is out of this item's scope. Worth a follow-up.

**Also:** `server-only` is now a declared dependency and scripts that reach `generateJson` must
pass `--conditions=react-server` (see `backfill:klts`). Next resolves that condition internally;
plain `tsx` does not, so without it the import throws "cannot be imported from a Client
Component".

**Scope grew in design.** The request ("display missed KLPs/topics better") could not be met by a UI change alone: measured against the live corpus on 2026-08-24, KLPs run a **median of 16 words** (153 live rows, 69 cards), because a KLP is a *proposition* — the thing a distractor is corrupted from and a short answer is graded against. It cannot be shortened without breaking MC/TF generation. So the spec adds grains **above** it instead: a global `Klt` concept node and a short `CardKlp.label`, filled by an `after()`-triggered AI pass that mirrors KLP extraction.

**The rule that matters most (spec §6):** the KLT pass may never delete or supersede a `CardKlp` row. `AnswerKlpResult.klp` is `onDelete: Cascade`, and `KlpState` keys on `klpId` — superseding would silently reset every learner's mastery, invisibly to `tsc` and to any test that only checks the label landed. Guards are mutation-tested.

The user's words: "a better way of displaying the KLPs that they missed and/or topics (depending on what they flagged)."

**What already exists, so this is a rework and not a greenfield build** — three surfaces that each hold part of the answer and none of which is "here is what you got wrong, and here is what to do about it":
- the quiz results screen shows per-answer error analysis (Spec 2b);
- `/profile/learner` shows topic mastery plus the ranked study list (Spec 3C, with item 6f making the rows say what they actually are instead of the literal words "Key point");
- `/profile/memory` shows the raw event feed.

**Open question 1 — ANSWERED: "flagged" means what they got WRONG**, not starred cards and not authored categories. Original framing: Starred cards, the categories the learner authored, or both. These are different data paths: starring is `CardProgress.starred`, categories are `CardCategory`, and Spec 3C's saved study scope already filters by category.

**Open question 2 — ANSWERED: a new panel at the top of `/profile/learner`**, with `TopicMastery`/`StudyNext`/`RetentionPanel` untouched below it. Original framing: That page already owns roughly this job. The user has only ever seen it against a very thin corpus (6 quiz answers on the whole account), so it is genuinely unclear whether it is *insufficient* or merely *unpopulated* — and those have opposite remedies. Spec 3C's `diagnoseEmptyState` exists precisely because "nothing here" has four different causes.

**Sequencing note:** this makes item 7 better rather than competing with it — a plan needs somewhere to point when it says "you are weak here." Worth doing before Spec 4's lesson generation, not after.

## Where deferred issues are recorded

Never in memory — always in a spec's own section.

| Spec | Section | Status |
| --- | --- | --- |
| `2026-08-03-answer-analysis-capture-design.md` (2a) | "Known drift risks, deliberately out of scope" | **All 3 resolved.** Two fixed 2026-08-08; the third (reset ↔ quiz history) was already true in code. |
| `2026-08-04-answer-analysis-display-design.md` (2b) | "Explicitly NOT fixed" | **Resolved** — `startQuizAttempt` ownership, closed by the visibility work. |
| `2026-08-05-metrics-substrate-learner-profile-design.md` (Spec 3) | **§14 follow-ups** | **BOTH CLOSED 2026-08-14** by Spec 3C Task 12. |
| `2026-08-10-deletion-and-forgetting-design.md` | **§8 "Answers should not be resubmittable at all"** | **OPEN — decided 2026-08-10, not built.** Re-answering a graded question isn't evidence of knowledge, but every metric downstream treats it as though it were. The legitimate case (a missed high-weight KLP in short answer) is an AI-generated **follow-up question** with its own provenance — a different quiz type and UI, not a second pass. Remove the `replace` path in `createAnswerWithAnalysis` when that lands. |
| `CLAUDE.md` | Future Considerations | Forget: **pruned 2026-08-11** (item 2 built). Visibility: still carries the stale pre-fix paragraph — **delete it when this branch merges**, as its own note says. |

---

## Findings from the 2026-08-08/09 session

### Fixed

| Finding | Where | Commit |
| --- | --- | --- |
| `rebuildState`'s doc comment told the next reader a Spec 3B band edit needs a posterior replay. False since spec §3.3 was corrected — bands never reach BKT. Would have been read as an instruction. | `src/lib/metrics/cache.ts:32` | `00f0aef` |
| `StudySource` re-listed as two literal `z.enum([...])` arrays, so adding a mode type-checked everywhere then failed at **runtime** on `SessionInsight` parsing. Now derives from `STUDY_SOURCES`. | `src/lib/memory/scoring.ts`, `insight.ts` | `356b51d` |
| `Card.klpStatus`'s four literals scattered across 2 actions, a component and a Prisma comment, with no shared constant. Worst in `KlpEditor`, which renders retry/skipped affordances off `status === '...'` — a typo fails by showing nothing. | `src/lib/cards/klp-status.ts` (new) | `6680820` |
| `card-autocomplete.ts` fetched **any** set by id with no owner check and fed every card into an AI prompt. Previously unrecorded anywhere. Tightened to owner-only. | `src/actions/card-autocomplete.ts` | `fae943e` |
| `print/page.tsx` fetched a `QuizAttempt` by id checking only `attempt.setId`, so any signed-in user could print another learner's attempt (their `selectedCardIds` + generated options). Same class Spec 2b fixed twice and missed here. | `src/app/sets/[id]/print/page.tsx` | `78d58e0` |
| `profile.ts` fetched a set **title** from a URL-controlled scope with no check — anyone could pull another user's set title into their profile block. Found by the plan's own final-verification grep. | `src/lib/memory/profile.ts:420` | `92102b6` |
| Spec + plan both claimed `/match` is readable signed-out. It is not — middleware gates it — and matching *is* studying, so it shouldn't be. | docs + `match/page.tsx` comment | (doc commit) |
| `StudySession` was missing from `RESET_MEMORY_MODELS`; both `sessionId` FKs are `SetNull`, so a full account reset left every session row standing as an empty husk. | `src/lib/memory/erase.ts` | `6ff0a1d` |
| A quiz resubmit stepped confidence twice — the superseded answer's `StudyEvent` survived the replace, and `CardProgress` is incremental. | `src/actions/quiz.ts` | `c570d8a` |
| Quizzing a **starred** card silently unstarred it: the resubmit replay ran on every submission, and a starred-but-unstudied card replays over zero events → `recomputeCardProgress` returns null → the row is deleted and recreated with `starred: false`. | `src/actions/quiz.ts` | `c570d8a` |
| `/profile/activity/[id]` rendered a full quiz permalink that **nothing in the app linked to**. | `src/app/profile/page.tsx` | `b911ae4` |

### Still open — not bugs, but know them

- ~~`getLearnerMetrics` has zero production callers~~ — **CLOSED 2026-08-14.** `/profile/learner` and `safeProfileBlock` both call it now (Spec 3C).
- ~~Spec 3 §14's two prompt-block defects~~ — **CLOSED 2026-08-14** by Spec 3C Task 12.
- **`MIN_OBSERVATIONS = 3` hides every knowledge number.** Live DB has 19 answers, 1 user, every KLP seen exactly once, so **zero topics report non-null knowledge** and the signed verbosity index cannot go negative. Nothing is broken — the corpus is thin. **Do not seed synthetic study data**: the posterior is incremental and not self-correcting, so fabricated evidence does not cleanly come back out. Spec 3B makes the floor tunable, which is the real fix.

---

## Environment gotchas (will waste your time otherwise)

1. **`.env` contains only `DATABASE_URL`.** No `NEXTAUTH_SECRET`, so `auth()` throws `MissingSecret` and the app is broken locally — pages 500 or misbehave in confusing ways. For local verification, pass one to the dev process rather than editing the file:
   ```bash
   NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
   ```
   **CLAUDE.md's security note is stale** — it says `.env` holds live `GOOGLE_API_KEY` and `RESEND_API_KEY`. It no longer does.

2. **`cursor-agents/` is a separate git repo** cloned into the project root on 2026-08-09. It has its own `.git` and `package.json` and depends on an uninstalled `@cursor/sdk`. Because `tsconfig.json` includes `**/*.ts` and excludes only `node_modules`, it **breaks `tsc` and `vitest` for this project**:
   - `npx tsc --noEmit` → 1 error, entirely from `cursor-agents`
   - `npx vitest run` → 993 tests, 7 failing, all in `cursor-agents`

   Verify this project alone with:
   ```bash
   npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
   npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
   ```
   Left untouched deliberately — it is not part of this project. If it stays, it wants a `tsconfig`/`vitest` exclude.

3. **Windows:** `pkill` does not stop the Next dev server. Use `taskkill /PID <pid> /F` after finding it with `netstat -ano | grep :3001`.

4. **`tsx` scripts must live inside the project** (e.g. `scripts/`) or module resolution fails, and they need a `main()` wrapper — top-level `await` breaks under the CJS output format.

5. **`prisma migrate dev` is unusable from an agent shell** — it needs a TTY and has no non-interactive override (unlike `migrate deploy`). Either the human runs it, or generate the SQL and apply it yourself:
   ```bash
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```
   then write it to `prisma/migrations/<timestamp>_<name>/migration.sql` and `npx prisma migrate deploy`. Re-run the diff afterwards — "This is an empty migration" means zero residual drift. Note `--from-schema-datasource` was **removed** in this Prisma version; the flag is now `--from-config-datasource` (a `prisma.config.ts` exists).

6. **CLOSED 2026-08-19 by item 6e (credentials auth) — a signed-in session IS now reachable from an agent session.** This trap is no longer true as originally written below, and reading the old text would wrongly hand a future agent's own live gates to the human. Run:
   ```bash
   NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
   npm run seed:dev-user
   ```
   then sign in at `/login` with the seeded `dev_user` (or `dev@localhost.test`) credentials — either identifier resolves against the real database. `seed:dev-user` refuses to run against a production `DATABASE_URL`, and re-running it is safe (upsert). This is how item 6e's own live gate ran end to end with no human in the loop — the first gate in this project an agent ran itself.

   **Still true, and still a real hole: GitHub OAuth specifically remains unreachable.** `.env` has no `GITHUB_ID`/`GITHUB_SECRET`; clicking "Continue with GitHub" produces no server-side request at all (confirmed against the dev server log), not merely a failed one. So the `OAuthAccountNotLinked` copy check (Task 7 of the credentials-auth plan) is still owed to the human — it needs a real GitHub account whose email collides with an existing password account, which nothing in this environment can produce. Any plan step that specifically needs OAuth (as opposed to any signed-in page) still goes to the human as an explicit gate.

7. **A client component that gains a server-action import breaks every jsdom test that renders it.** A `'use server'` module pulls `next-auth` into the browser environment and the test file dies at load with `Cannot find module next/server` — before any test runs, so the failure looks unrelated to the change. Mock the action module (see `tests/components/QuizSummary.test.tsx`).

8. **A raw statement whose result you never read must use `$executeRaw`, never `$queryRaw`.** `$queryRaw` deserializes result columns, and the Neon driver adapter throws `P2010 / UnsupportedNativeDataType — Failed to deserialize column of type 'void'` on a `void`-returning function. This broke `pg_advisory_xact_lock` in `lockKlpStates` for three days (shipped `81e2d1f`, fixed `1bcbc74`), taking down **quiz answer submission** as well as every erasure verb, because both call it inside the write transaction. **No mocked test can catch this** — a fake deserializes nothing, and the four fake tx clients answering `$queryRaw` are exactly what made the suite green over a broken statement. `SELECT id ... FOR UPDATE` (match-session, quiz-matching) is fine: `id` is a real column.

9. **Component tests must call `afterEach(cleanup)` themselves.** `vitest.config.ts` has no `globals: true`, so RTL never registers its auto-cleanup and one test's DOM bleeds into the next — a second `render` makes `getByRole` throw on multiple matches. Also: each `*.test.tsx` needs `// @vitest-environment jsdom` as its literal first line.

---

## Baselines (branch `spec3b-tunable-scoring`, 2026-08-21, after item 8)

- **Tests:** 140 files / **1655 passing** (excluding `cursor-agents`)
- **`tsc --noEmit`:** clean (excluding `cursor-agents`)
- **`next build`:** clean
- **`npm run lint`:** **175 problems** (131 errors, 44 warnings) — unchanged from the item 6e baseline; all pre-existing. Compare against this; do not fix unrelated ones. (187 on 2026-08-09 → 186 after the deletion work → 185 after 2b, unchanged by Spec 3B and 3C → 178 after item 5 removed 7 dead imports → 176 after item 6 removed four `as any` casts, unchanged by items 6b, 6d, 6f and 8 → 175 after item 6e.)
- Branch is **not merged**. `origin` carries item 6e's work as of 2026-08-20 (through `f5c4615`), pushed manually; item 8 (through `fb8a851` plus this doc commit) has **not yet been pushed** — `git status -sb` showed `ahead 24` of `origin/spec3b-tunable-scoring` at the time this was written. Check `git status -sb` before believing the remote is current.
- **There is NO auto-push hook**, despite what this file assumed for several items — `.git/hooks/` contains nothing but samples. Every earlier entry that says "a commit hook pushes automatically, so `origin` tracks HEAD" was wrong.
