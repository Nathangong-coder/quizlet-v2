# Build queue & carried-over findings

**Last updated:** 2026-08-12
**Read this first** before starting any Stage 8 work. The order below is not derivable from spec filenames or dates.

This file is the canonical queue. A Claude-Code memory (`build-queue.md`) mirrors it, but **this file wins** — it is in the repo and readable by any tool.

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

### 3. ⬜ Spec 3B — tunable scoring — **PLAN READY TO EXECUTE**

Spec: `specs/2026-08-05-spec3b-tunable-scoring-and-targeting-design.md`
Plan: `plans/2026-08-06-stage8-spec3b-tunable-scoring.md` — **rebuilt 2026-08-08** against post-hardening code (commit `269714b`). 10 tasks.

Knob set (user-approved): severity bands + targeting strategy + `MIN_OBSERVATIONS` + `ARTICULATION_MIN_PKNOWN` + `READINESS_WEIGHT_PER_ANSWER`.

**Known limit, accepted deliberately:** `getLearnerMetrics` has **zero production callers**. Task 6 makes it tuning-aware for 3C to consume; the ranked output renders nowhere until then. 3B's visible surface is the settings panels + the quiz results screen.

### 4. ⬜ Spec 3C — learner dashboard (the UI spec) — **SPEC EXISTS, NO PLAN, NO CODE**

Spec: `specs/2026-08-05-spec3c-learner-dashboard-design.md`

Must also close **both** Spec 3 §14 follow-ups, which are still open and verified so on 2026-08-08:
- `profileToPromptBlock`'s callers hardcode `topics: []` (`src/lib/ai/context.ts:155`, `src/actions/training-plan.ts:34`), so topic-grain data reaches **no prompt**.
- `capBlock` truncates the topic section **first**, because the uncapped card section is concatenated ahead of it.

**Fix both together or neither** — closing the first alone silently drops the topic signal the moment an active learner's card section fills `MAX_PROFILE_CHARS`.

---

## Where deferred issues are recorded

Never in memory — always in a spec's own section.

| Spec | Section | Status |
| --- | --- | --- |
| `2026-08-03-answer-analysis-capture-design.md` (2a) | "Known drift risks, deliberately out of scope" | **All 3 resolved.** Two fixed 2026-08-08; the third (reset ↔ quiz history) was already true in code. |
| `2026-08-04-answer-analysis-display-design.md` (2b) | "Explicitly NOT fixed" | **Resolved** — `startQuizAttempt` ownership, closed by the visibility work. |
| `2026-08-05-metrics-substrate-learner-profile-design.md` (Spec 3) | **§14 follow-ups** | **BOTH STILL OPEN** — see queue item 4. |
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

- **`getLearnerMetrics` has zero production callers** (tests only). An earlier memory claimed the hardening pass changed this; it had not. Re-verified 2026-08-08.
- **Spec 3 §14's two prompt-block defects** — see queue item 4.
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

6. **No signed-in page is reachable from an agent session.** Auth is GitHub OAuth only (`src/auth.config.ts`) and `.env` has no `GITHUB_ID`/`GITHUB_SECRET`, so `NEXTAUTH_SECRET=dev-only` gets the server up but not past the login wall. Any plan step of the form "take a quiz and check X" must be handed to the human — write it as an explicit gate rather than discovering it mid-task.

7. **A client component that gains a server-action import breaks every jsdom test that renders it.** A `'use server'` module pulls `next-auth` into the browser environment and the test file dies at load with `Cannot find module next/server` — before any test runs, so the failure looks unrelated to the change. Mock the action module (see `tests/components/QuizSummary.test.tsx`).

8. **A raw statement whose result you never read must use `$executeRaw`, never `$queryRaw`.** `$queryRaw` deserializes result columns, and the Neon driver adapter throws `P2010 / UnsupportedNativeDataType — Failed to deserialize column of type 'void'` on a `void`-returning function. This broke `pg_advisory_xact_lock` in `lockKlpStates` for three days (shipped `81e2d1f`, fixed `1bcbc74`), taking down **quiz answer submission** as well as every erasure verb, because both call it inside the write transaction. **No mocked test can catch this** — a fake deserializes nothing, and the four fake tx clients answering `$queryRaw` are exactly what made the suite green over a broken statement. `SELECT id ... FOR UPDATE` (match-session, quiz-matching) is fine: `id` is a real column.

9. **Component tests must call `afterEach(cleanup)` themselves.** `vitest.config.ts` has no `globals: true`, so RTL never registers its auto-cleanup and one test's DOM bleeds into the next — a second `render` makes `getByRole` throw on multiple matches. Also: each `*.test.tsx` needs `// @vitest-environment jsdom` as its literal first line.

---

## Baselines (branch `spec3b-tunable-scoring`, 2026-08-12, after item 2b)

- **Tests:** 96 files / **1083 passing** (excluding `cursor-agents`)
- **`tsc --noEmit`:** clean (excluding `cursor-agents`)
- **`npm run lint`:** **185 problems** (133 errors, 52 warnings) — all pre-existing. Compare against this; do not fix unrelated ones. (187 on 2026-08-09 → 186 after the deletion work → 185 after 2b.)
- Branch is **not merged**, but IS pushed to `origin` (as of 2026-08-11). A Vercel preview deployment tracks it.
