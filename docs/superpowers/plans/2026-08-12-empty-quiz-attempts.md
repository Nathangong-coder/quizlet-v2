# Empty Quiz Attempts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `QuizAttempt` with no `QuizAnswer` rows stops counting as study history — hidden on the two read paths that surface it, discarded outright on the one path where the learner's intent is knowable, and prevented from being *created* by a card deletion that strands a stored score.

**Architecture:** Three small, separable pieces. A read predicate (`ANSWERED_ATTEMPT_WHERE`) applied at exactly two call sites. A client-intent signal (`QuizSectionHandle.answeredCount`) that lets one new server action, `discardSkippedQuizAttempt`, route a blank submission into the *existing* `executeErasure({ kind: 'attempt' })` machinery. And a re-score on card deletion (`rescoreSetAttempts`) sharing one extracted `storedScore` helper with `planErasure`, so the round-because-`Int` rule has one home.

**Tech Stack:** Next.js App Router server actions, Prisma/Postgres, React 19 imperative handles, Vitest, TypeScript.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-empty-quiz-attempts-design.md`. Its D1–D4 are settled — do not re-litigate. **Six corrections to that spec were found during this plan's review and are folded in below; Task 8 writes them back into the spec.**
- **The direction of risk is INVERTED from `readableSetWhere`.** With visibility, a forgotten guard leaked data, so spreading it everywhere was safe. Here, *over*-applying is the dangerous direction: an in-flight attempt has zero answers until the first submit. Forgetting the filter shows a husk; over-applying takes quizzing down. Two call sites, no more.
- **The client may never order a deletion on its own.** `clientAnsweredCount === 0` is an *intent* signal; the server's own zero-answer check is the authority. Both must hold.
- Tests are pure/mocked — this repo has **no live-DB test harness**. Actions are tested with `vi.mock('@/lib/db')` (see `tests/actions/quiz-submit-ownership.test.ts`).
- Component tests need `// @vitest-environment jsdom` as the literal first line and must call `afterEach(cleanup)` themselves (`vitest.config.ts` has no `globals: true`). A client component that gains a server-action import breaks every jsdom test that renders it — mock the action module (see `tests/components/QuizSummary.test.tsx`).
- **Run the suite excluding the foreign repo in the project root:**
  `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"`
- Baseline to compare against (branch `spec3b-tunable-scoring`, 2026-08-12): **88 files / 1021 passing**, `tsc --noEmit` clean (excluding `cursor-agents`), `npm run lint` **186 problems (133 errors, 53 warnings), all pre-existing** — do not fix unrelated ones.
- `.env` holds only `DATABASE_URL`. For anything that runs the app: `NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev`. No signed-in page is reachable from an agent session (GitHub OAuth only, no `GITHUB_ID`) — Task 9 is a human gate, not agent work.
- No schema change in this plan, therefore no migration.

---

## Corrections to the spec, established by code review before writing this plan

| # | Spec said | Code says | Effect on the plan |
| --- | --- | --- | --- |
| 1 | C6 is `rescoreSetAttempts(tx, setId)` "called from `updateSet`" | `updateSet`'s card delete sits in an **array-form** `prisma.$transaction([...])` (`sets.ts:291-305`), which takes pre-built promises and cannot express "read after the delete lands" | Task 3 converts that block to the interactive form first. Budgeted as its own step. |
| 2 | C6 updates "only where the stored value actually differs" | `quiz-matching.ts:120-125` writes `round(correct/matches.length×100)` **unconditionally**, over its own section — not the mean of `QuizAnswer.score`. Sections commit in parallel (`Promise.all`, `QuizContainer.tsx:83`), so a *mixed* attempt's stored score is whichever write landed last and already diverges from `storedScore` | **User decision 2026-08-12: recompute all; treat the convergence as a fix.** Mean-of-answers is more defensible than last-writer-wins. Task 3 must state this in a comment so it is not read as an accident. |
| 3 | Apply the filter at `metrics/read.ts:113` | That query carries a comment declaring it "Deliberately NOT scoped" (`read.ts:108-112`) — a different sense of *scope* (`HistoryScope`), but the next reader will read the new filter as violating it | Task 2 amends that comment in the same edit. |
| 4 | C3 condition 3 exists because "a printed test must keep its row" | Print is **not** gated on `printable`: `print/page.tsx:46` reads any attempt of the caller's by id, and QuizContainer's own print button (`:178`) passes a **non-printable** attempt's id | Keep the guard, fix the stated reason. A learner who prints then submits blank still loses the row; accepted, noted in Task 5. |
| 5 | The round-because-`Int` rule "exists in three places" | **Four** in `quiz.ts` — `:570`, `:749`, `:1169`, `:1284` (the two short-answer paths were missed) — plus `erase.ts:395` | Task 1 records all five. Rewiring the four live writers is **out of scope** (see below). |
| 6 | `quiz.ts:574`, `:756`, `:750` | Actual: `:573`, `:757`, `:753` | Line refs below are the verified ones. |

**Deliberately still out of scope:** the `if (newScore !== null)` guard at all four live `quiz.ts` writers. It is the mechanism by which an attempt keeps a score after losing its evidence, but on those paths an answer was *just created*, so `allAnswers` is never empty and the guard cannot fire wrongly. Changing it there is unrelated live-scoring behaviour. C6 is the path that must clear the column, and it does.

**Also resolved, and the spec should say so:** the BUILD-QUEUE left open whether a card deletion that empties an attempt should *delete* it (matching `planErasure:384`) or merely null the score. This design chooses **null-and-filter**, because erasing memory is a request to destroy data and editing a set is not — deleting another learner's row spends a destructiveness budget the editor was never granted. Task 8 writes that argument into D1.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/quiz/scoring.ts` | **+** `storedScore(answers)` — the one home for round-because-`Int` (Task 1) |
| `src/lib/memory/erase.ts` | `:395-404` calls `storedScore` instead of inlining it (Task 1) |
| `src/lib/quiz/history.ts` | **NEW** — `ANSWERED_ATTEMPT_WHERE` + the inverted-risk doc comment (Task 2) |
| `src/actions/user.ts` | `getUserStats:42` filters (Task 2) |
| `src/lib/metrics/read.ts` | `repeatBonus` attempt window `:113` filters; comment amended (Task 2) |
| `src/lib/quiz/rescore.ts` | **NEW** — pure `attemptsNeedingRescore()` (Task 3) |
| `src/actions/sets.ts` | `updateSet` transaction → interactive; re-score after card delete (Task 3) |
| `src/components/quiz/section.tsx` | `QuizSectionHandle.answeredCount` (Task 4) |
| `src/components/quiz/{MultipleChoice,ShortAnswer,TrueFalse,Matching}Quiz.tsx` | implement it (Task 4) |
| `src/actions/quiz.ts` | **+** `discardSkippedQuizAttempt` (Task 5) |
| `src/components/quiz/QuizSkippedNotice.tsx` | **NEW** (Task 6) |
| `src/components/quiz/QuizContainer.tsx` | submit flow + the misleading footer copy (Task 6) |
| `docs/superpowers/specs/2026-08-12-empty-quiz-attempts-design.md` | corrections 1–6 + the resolved open question (Task 8) |
| `docs/superpowers/BUILD-QUEUE.md` | close item 2b (Task 8) |

`rescore.ts` is separate from `scoring.ts` so the "which rows changed" decision is testable without importing anything Prisma-shaped, the same split `erase.ts`/`erase-execute.ts` uses.

---

### Task 1: Extract `storedScore`

**Files:**
- Modify: `src/lib/quiz/scoring.ts` (append), `src/lib/memory/erase.ts:389-404`
- Test: `tests/quiz/scoring.test.ts` (extend or create)

**Interfaces:**
- Consumes: nothing.
- Produces: `storedScore(answers: { score: number | null }[]): number | null` — the *stored* form of `overallQuizScore`, i.e. the mean rounded to an `Int`, null when no answer carries a score.

- [ ] **Step 1: Failing tests** — mean of `[100, 0]` → `50`; rounding (`[100, 99, 50]` → `83`, i.e. `Math.round(83)`; assert a case where the float mean is `x.5` so the rounding rule is pinned, not incidental); `[]` → `null`; `[{score: null}]` → `null`; nulls excluded from the denominator (`[100, null]` → `100`, **not** `50`).
- [ ] **Step 2: Implement** as a thin wrapper over `overallQuizScore` — do not duplicate the null/denominator logic:

```ts
/** The stored form of an attempt's score: the mean of its answers' scores,
 *  rounded because `QuizAttempt.score` is an Int column. Null when no answer
 *  carries a score — and null is a value that must be WRITTEN, not skipped:
 *  an attempt that keeps a score after losing every scored answer is the
 *  exact defect `rescoreSetAttempts` exists to prevent. */
export function storedScore(answers: { score: number | null }[]): number | null {
  const mean = overallQuizScore(answers)
  return mean === null ? null : Math.round(mean)
}
```

- [ ] **Step 3: Rewire `erase.ts`.** Replace `const mean = overallQuizScore(survivors)` / `score: mean === null ? null : Math.round(mean)` with `score: storedScore(survivors)`. Keep the surrounding comment but retarget it at `storedScore`. Leave the four live `quiz.ts` writers alone (see "out of scope" above); instead add one line to `storedScore`'s comment naming them, so the next reader knows the duplication is known:
  `// Not yet used by the four live writers in src/actions/quiz.ts (:570, :749, :1169, :1284) — they round inline. Deliberate; see the 2026-08-12 plan.`
- [ ] **Step 4:** Full suite. Expect **1021 + new**, zero regressions. `planErasure`'s existing tests are the real guard here — they must pass untouched.

---

### Task 2: `ANSWERED_ATTEMPT_WHERE`, applied at exactly two sites

**Files:**
- Create: `src/lib/quiz/history.ts`
- Modify: `src/actions/user.ts:42-46`, `src/lib/metrics/read.ts:108-117`
- Test: `tests/actions/user-stats-empty-attempts.test.ts` (new), `tests/quiz/history.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `ANSWERED_ATTEMPT_WHERE satisfies Prisma.QuizAttemptWhereInput`.

- [ ] **Step 1: Write the module with its warning first.** The comment is the deliverable as much as the object is:

```ts
import type { Prisma } from '@prisma/client'

/**
 * An attempt with no answers is not a study record. Two of the four
 * populations that produce one (skipped, abandoned) are hidden by this
 * predicate rather than deleted, so nothing is destroyed if the rule is wrong.
 *
 * DO NOT SPREAD THIS EVERYWHERE. The risk here is INVERTED from
 * `readableSetWhere` (src/lib/sets/visibility.ts): there, a forgotten guard
 * leaked data, so over-applying was free. Here, over-applying is the dangerous
 * direction — an IN-FLIGHT attempt has zero answers until the first submit.
 *
 * Correct call sites (2, both read-only history surfaces):
 *   - src/actions/user.ts   getUserStats
 *   - src/lib/metrics/read.ts   the repeatBonus attempt window
 *
 * Call sites that must NEVER filter:
 *   - src/actions/quiz.ts, src/actions/quiz-matching.ts — in-flight lookups.
 *     Filtering breaks the FIRST QUESTION OF EVERY QUIZ.
 *   - src/app/sets/[id]/print/page.tsx — printable attempts are zero-answer
 *     by design.
 *   - src/lib/memory/erase-execute.ts — erasure must see what it is erasing.
 */
export const ANSWERED_ATTEMPT_WHERE = {
  answers: { some: {} },
} satisfies Prisma.QuizAttemptWhereInput
```

- [ ] **Step 2: `getUserStats`.** Spread into the existing `where: { userId }`. It is one query feeding **all four** outputs — `totalAttempts`, `modeStats`, `overallAverageScore`, `recentAttempts` — so one edit fixes all four. A filter that fixed the list but not the count would be the obvious half-fix; assert against all four.
- [ ] **Step 3: `metrics/read.ts:113`.** Spread into `where: { userId }`, and **amend the comment above it** (correction 3). It currently says only "Deliberately NOT scoped"; append:

```
    // Zero-answer attempts ARE excluded (ANSWERED_ATTEMPT_WHERE) — a different
    // axis from HistoryScope. An empty attempt is not a sitting, so counting it
    // dilutes "within the last N attempts". Provably safe for the tag join:
    // every tag reaches an attempt through quizAnswer.attemptId, so any attempt
    // a tag references has >= 1 answer by construction and cannot be filtered
    // away. (`deriveTagScores` would append an unlisted attempt at the END of
    // its order — see derive.ts:108-112 — which is why this matters.)
```

- [ ] **Step 4: Behavioural test** with `vi.mock('@/lib/db')`: `getUserStats` given a mixed fixture returns counts/averages/recent-list computed over answered attempts only. Assert the *`where` clause actually passed to Prisma* contains `answers: { some: {} }` — a fixture-only test passes even if the filter is never sent.
- [ ] **Step 5: Regression guard.** A test asserting that `startQuizAttempt` → `getQuizAttemptCards` on a zero-answer attempt still resolves. This is the failure mode if the predicate leaks into the in-flight readers.
- [ ] **Step 6:** Full suite + `tsc`.

---

### Task 3: Re-score a set's attempts when a card is deleted

**Files:**
- Create: `src/lib/quiz/rescore.ts`
- Modify: `src/actions/sets.ts:282-305`
- Test: `tests/quiz/rescore.test.ts` (new), `tests/actions/update-set-rescore.test.ts` (new)

**Interfaces:**
- Consumes: `storedScore` (Task 1).
- Produces: `attemptsNeedingRescore(attempts): { id, score }[]` (pure) and `rescoreSetAttempts(tx, setId): Promise<void>`.

- [ ] **Step 1: The pure part first.**

```ts
export function attemptsNeedingRescore(
  attempts: { id: string; score: number | null; answers: { score: number | null }[] }[],
): { id: string; score: number | null }[]
```

Returns only the rows whose recomputed `storedScore` differs from the stored one. Tests: unchanged rows are omitted; a `100 → null` transition **is** emitted (the whole point — an attempt that lost all its scored evidence); `null → null` is omitted; a partial loss `96 → 95` is emitted.

- [ ] **Step 2: Convert `updateSet`'s card transaction to the interactive form** (correction 1). `sets.ts:291-305` is currently `prisma.$transaction([...])` over pre-built promises; the re-score must read *after* the delete lands, which the array form cannot express. Convert to `await prisma.$transaction(async (tx) => { ... })`, preserving the existing order exactly: deleteMany → updates → creates → `set.update`. **This is a mechanical conversion — no ordering or semantic change** beyond appending the re-score. Run the existing `updateSet` tests before and after this step alone, so a regression here is attributable.
- [ ] **Step 3: `rescoreSetAttempts(tx, setId)`**, called at the end of that transaction **only when `plan.toDeleteIds.length > 0`**:

```ts
/** Recomputes every attempt on the set from its SURVIVING answers.
 *
 *  NO userId FILTER. This is the only cross-user memory write in the codebase,
 *  and it is deliberate: sets are link-shareable and `startQuizAttempt` is
 *  readability-scoped, so the OWNER's edit strands OTHER LEARNERS' scores.
 *  There is no privacy cost — each score is derived solely from that user's own
 *  surviving answers, and nothing is read across the boundary. Do not "fix"
 *  this by adding the userId scope every neighbouring function has.
 *
 *  Recomputes EVERY attempt on the set rather than snapshotting the affected
 *  ones: a snapshot must capture attempt ids BEFORE the cascade destroys the
 *  QuizAnswer.cardId link, which makes ordering load-bearing and still loses an
 *  answer committed between snapshot and delete. Recomputing from ground truth
 *  is race-TOLERANT — a concurrent submit derives the same score itself.
 *
 *  KNOWN AND ACCEPTED (decided 2026-08-12): for a MIXED quiz containing a
 *  matching section this can change a score even when the deleted card was
 *  unrelated. `quiz-matching.ts:120` writes a section-scoped formula
 *  unconditionally while MC/SA/TF write the mean, and sections commit in
 *  parallel — so today's stored value is whichever write landed last. The
 *  convergence to mean-of-answers is a fix, not a side effect.
 */
```

One query in (`quizAttempt.findMany({ where: { setId }, select: { id, score, answers: { select: { score } } } })`), `attemptsNeedingRescore`, then one `update` per changed row. **Must write `null`** — no `if (score !== null)` guard.

- [ ] **Step 4: Behavioural test — deleting a card re-scores a SECOND user's attempt.** This is the entire point of D3; a single-user test passes with a `userId` filter accidentally present.
- [ ] **Step 5:** Full suite + `tsc`. The `updateSet` category/card-reconciliation tests are the regression surface for Step 2.

---

### Task 4: `QuizSectionHandle.answeredCount`

**Files:**
- Modify: `src/components/quiz/section.tsx:13-15`, and the four section components' `useImperativeHandle`
- Test: `tests/components/quiz-answered-count.test.tsx` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `answeredCount: () => number` on the handle.

- [ ] **Step 1: Widen the interface**, with the constraint written into the type:

```ts
export interface QuizSectionHandle {
  commitAll: () => Promise<void>;
  /** How many questions the learner actually answered, in this section's own
   *  terms. The INTENT signal for a skipped quiz — never a deletion authority
   *  on its own; the server re-checks. See `discardSkippedQuizAttempt`. */
  answeredCount: () => number;
}
```

- [ ] **Step 2: Implement per section**, reusing each component's *existing* count expression rather than writing a second one — `MultipleChoiceQuiz.tsx:102` and `TrueFalseQuiz.tsx:90` already compute `cards.filter(c => selectedAnswers[c.id]).length` for `SectionNav`. Short answer counts non-empty **trimmed** `answers` (mirroring `commitAll`'s own `.trim()` skip at `:43-44`). Matching counts `Object.keys(matches).length`, which already gates its early return (`MatchingQuiz.tsx:95`).
- [ ] **Step 3: Add `answeredCount` to each `useImperativeHandle` dependency array.** MC `[cards, selectedAnswers, optionsState, attemptId]`, SA `[cards, answers, attemptId]`, TF `[cards, selectedAnswers, attemptId]`, Matching `[matches, attemptId]` — all four already list the state the count reads, so no dep changes are needed, but **verify each** rather than assuming: a stale handle here reports a stale count and deletes a real attempt.
- [ ] **Step 4: Test** each section's handle returns 0 before any interaction and the right count after. jsdom header + `afterEach(cleanup)`; mock the action modules (these components import server actions).

---

### Task 5: `discardSkippedQuizAttempt`

**Files:**
- Modify: `src/actions/quiz.ts` (new export)
- Test: `tests/actions/discard-skipped-attempt.test.ts` (new)

**Interfaces:**
- Consumes: `executeErasure` (`@/lib/memory/erase-execute`), `auth`.
- Produces: `discardSkippedQuizAttempt({ attemptId, clientAnsweredCount }): Promise<ActionResult<{ discarded: boolean }>>`.

Discards only when **all four** hold:

1. `clientAnsweredCount === 0` — the learner's intent.
2. Zero `QuizAnswer` rows server-side — the safety check.
3. `printable === false`.
4. The attempt belongs to the caller.

Then `executeErasure(userId, { kind: 'attempt', attemptId })`, which removes the attempt, its `StudySession`, and its cascading `QuizQuestion` rows. `planErasure:371-378` already carries the branch written for exactly this case.

- [ ] **Step 1: Four separate refusal tests, written first.** A single happy-path test passes with any one guard missing:
  - `clientAnsweredCount > 0` → `discarded: false`, **no erasure call**;
  - server sees answers → `discarded: false`;
  - `printable: true` → `discarded: false`;
  - another user's attempt → `discarded: false` (`findFirst` scoped by `userId`; not-found and not-yours are indistinguishable, per the erasure module's convention).
- [ ] **Step 2: Implement.** Guard 1 first and cheapest, before any query.

Condition 1's comment must record *why* it exists, because it looks redundant next to condition 2:

```ts
// Condition 1 is NOT redundant with the server-side check. Individual answer
// failures do not throw — `commitAll` calls `showError` and continues
// (MultipleChoiceQuiz.tsx:83, ShortAnswerQuiz.tsx:51, TrueFalseQuiz.tsx:73).
// So a learner who answered three questions and hit an AI failure on all three
// also reaches submit with zero stored answers and NO exception. Without the
// client's count, that learner would be shown "Quiz Skipped" and have their
// attempt deleted — hiding a real failure behind a message saying they did
// nothing.
```

Condition 3's comment must use the **corrected** reason (correction 4): a `printable` attempt is created to be printed and never submitted, so a discard would be reaching outside this flow. It does **not** fully protect printing — `print/page.tsx:46` will print any attempt of the caller's, and QuizContainer's own print button passes a *non*-printable id, so a learner who prints and then submits blank does lose that row. Accepted: the printed PDF already exists.

- [ ] **Step 3: Happy path** — all four hold → `executeErasure` called once with `{ kind: 'attempt', attemptId }`, returns `discarded: true`.
- [ ] **Step 4:** Full suite + `tsc`.

---

### Task 6: The "Quiz Skipped" screen

**Files:**
- Create: `src/components/quiz/QuizSkippedNotice.tsx`
- Modify: `src/components/quiz/QuizContainer.tsx:78-103`, `:119-121`, `:244-246`
- Test: `tests/components/quiz-container-skipped.test.tsx` (new)

**Interfaces:**
- Consumes: `discardSkippedQuizAttempt` (Task 5), `answeredCount` (Task 4).
- Produces: rendered UI only.

- [ ] **Step 1: The notice component.** A heading, one line stating no answers were recorded and nothing was saved to history, and a link back to the set. Deliberately vague — no score, no question list, no per-question detail.
- [ ] **Step 2: Restructure `handleSubmitQuiz`.** The current `try` wraps `commitAll` *and* `finishStudySession`, and `catch` swallows both. The new order matters:

1. `await Promise.all(... commitAll())` — unchanged. **If this throws, skip the discard entirely** and fall through to today's toast + results screen. That is a grading crash, not a skipped quiz; labelling it "Skipped" would hide a defect.
2. No exception → call `discardSkippedQuizAttempt` with the summed `answeredCount` across `sectionRefs.current`.
3. `discarded: true` → set a `skipped` state and **skip `finishStudySession` and `generateSessionInsight` entirely.** The session is being deleted, so closing it first is wasted work and generating an AI narrative about nothing is worse.
4. Otherwise → today's path unchanged.

The discard must be its own `try` — a failure there is not a grading failure and must not surface as "Something went wrong grading your answers"; it should degrade to the normal results screen (the attempt lingers and the Task 2 filter hides it, which is the whole point of hiding rather than deleting).

- [ ] **Step 3: Render.** `if (finished && skipped) return <QuizSkippedNotice setId={setId} />` **before** the existing `if (finished)` branch.
- [ ] **Step 4: Fix the now-false footer copy at `:244-246`.** It reads "You can submit at any time. Unanswered questions simply score zero." A wholly unanswered quiz no longer scores zero — it is discarded. Reword to keep the first sentence and say that a quiz with nothing answered is not saved.
- [ ] **Step 5: Component tests** — Skipped notice on `discarded: true`; `QuizSummary` otherwise; **`finishStudySession` NOT called on the discard path**; a thrown `commitAll` renders `QuizSummary` and never calls `discardSkippedQuizAttempt`. Mock `@/actions/quiz` and `@/actions/study-session`.
- [ ] **Step 6:** Full suite + `tsc` + lint delta (expect 186, unchanged).

---

### Task 7: Full verification pass

- [ ] `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` — **1021 + the new tests**, zero regressions.
- [ ] `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"` — clean.
- [ ] `npm run lint` — **186 problems**, unchanged.
- [ ] `grep -rn "ANSWERED_ATTEMPT_WHERE" src/` — **exactly three** hits: the definition and the two call sites. Any fourth is the over-application failure.
- [ ] `grep -rn "quizAttempt.find" src/` — confirm the four must-not-filter readers (`quiz.ts`, `quiz-matching.ts`, `print/page.tsx`, `erase-execute.ts`) are untouched.

---

### Task 8: Documentation

- [ ] Fold corrections 1–6 into `docs/superpowers/specs/2026-08-12-empty-quiz-attempts-design.md` — most importantly C6's `tx` shape (correction 1), the matching-score ruling (correction 2, with the user's 2026-08-12 decision recorded), C3 condition 3's real justification (correction 4), and C5's four-site inventory (correction 5).
- [ ] Add to D1 the argument that resolves the queue's open question: null-and-filter over delete, because editing a set is not a request to destroy another learner's data.
- [ ] `docs/superpowers/BUILD-QUEUE.md`: move item 2b from ⏸️ DEFERRED to ✅, pointing at this plan. **Leave "What is actually still broken" as a record of what was broken, reworded in the past tense** — do not delete it; the next reader needs to know which populations existed.
- [ ] Update the baselines block with the new test count.

---

### Task 9: Live verification gate — HUMAN, NOT AGENT

No signed-in page is reachable from an agent session. Hand this to the user; do not mark the plan complete without it. The lesson from Spec 2 is exact: a 1016-test suite went green over a statement Postgres rejects.

- [ ] Start a quiz, submit with **nothing** answered → the Skipped screen renders, and `/profile` `totalAttempts` does **not** increase. Check the DB: the `QuizAttempt`, its `StudySession`, and its `QuizQuestion` rows are all gone.
- [ ] Start a quiz, **close the tab** → `/profile` never shows it, and the row is still present in the DB (hidden, not deleted — that is the design).
- [ ] Start a quiz, answer **one** question, submit → normal results screen, attempt appears in history, score correct. This is the regression that matters most: over-applying the filter breaks the first question of every quiz.
- [ ] Take a quiz on a set, then **edit the set and delete a card that was tested** → the attempt's score changes to reflect surviving answers. Delete *every* tested card → the score goes **null** and the attempt drops off `/profile`.
- [ ] Answer a question, force an AI failure (remove/disable the credential), submit → the results screen appears, **not** "Quiz Skipped", and the attempt survives.
- [ ] Run `scripts/check-memory-integrity.ts` after the above — clean.

**Record predictions before measuring, as Task 11 of the deletion work did.** A prediction written after the fact is not a test.
