# Empty quiz attempts — design

**Date:** 2026-08-12
**Queue item:** 2b
**Status:** **BUILT AND LIVE-VERIFIED 2026-08-12** (commits `31b1a09`, `3811797`) — see the queue entry for what the gate covered and the one check it could not reach
**Plan:** `docs/superpowers/plans/2026-08-12-empty-quiz-attempts.md`
**Branch:** `spec3b-tunable-scoring`

> **Six claims in this document were wrong about the code** and were corrected
> before implementation; each is fixed inline below and catalogued in
> "Corrected during planning". A further six things were found *during*
> implementation — see "Found during implementation" at the end. Both sections
> are load-bearing: they are the difference between what was designed and what
> exists.

---

## Problem

A `QuizAttempt` with no `QuizAnswer` rows is not a study record, but it is
counted as one. On `/profile` it inflates `totalAttempts` and the per-mode
counts, and it occupies a row in the five-item recent list.

The user's ruling, given 2026-08-11 during Spec 2's live verification:

> un-answered quizzes should just not go in the history - it would be
> considered like a typo/error

Refined 2026-08-12: a quiz submitted with nothing answered should end on a
plain "Quiz Skipped" screen and leave no trace.

### Four populations, not one

| Population | Cause | Prevented by deferred creation? |
| --- | --- | --- |
| **Skipped** — submitted with nothing answered | user opened a quiz and gave up | yes |
| **Abandoned** — never submitted | tab closed; no handler ever fires | yes |
| **Cascaded** — had answers, lost them | a card was deleted; `QuizAnswer.cardId` cascaded | **no** |
| **Printable** — zero answers *by design* | `setup.printable`; `/sets/[id]/print` reads the attempt | **must not be prevented** |

The printable row is why "defer `QuizAttempt` creation until the first
answer" was rejected outright: it would break print. The cascaded row is why
the rule must be *zero answers ⇒ not history, **scored or not*** — 5 of the 16
found in the live database carried a real score (100, 99, 50…) for evidence
that no longer existed.

All 16 were swept by the 2026-08-12 account reset (`attempts: 0` verified).
There is nothing to clean up; this design is entirely about preventing
recurrence.

---

## What is already true (verified, not assumed)

**Nothing is graded until submit.** `src/components/quiz/section.tsx:9-11`:
*"Nothing is graded while the user navigates — the container's single 'Submit
Overall Quiz' button calls `commitAll` on each section, which persists/grades
every answered question exactly once."* Answers live in React state until
`handleSubmitQuiz` fires.

This kills the largest worry. An abandoned quiz writes **no** `QuizAnswer`, no
`StudyEvent`, no confidence change, no `KlpState` step. The learner profile is
already untouched, so no scrubbing of contaminated learning data is required.

What an abandoned quiz *does* leave is scaffolding, all of it cascading from
the attempt:

- the `QuizAttempt` row and its `StudySession` (created together in one
  transaction, `src/actions/quiz.ts:414-441`),
- `QuizQuestion` rows — generated multiple-choice options and true/false
  statements, written per question as the learner navigates
  (`src/actions/quiz.ts:192`, `:1526`), `onDelete: Cascade` on `attemptId`
  (`prisma/schema.prisma:542`).

**Empty `StudySession` rows are already invisible.** Nothing enumerates
sessions — `studySession.findMany` appears only in `erase-execute.ts`. The
activity permalink is reachable solely from `/profile`'s recent-attempt links.

---

## Decisions

### D1 — Filter history reads; do not sweep

Hiding, not deleting, is the default response to a zero-answer attempt. No
data is destroyed if the rule turns out wrong, and one predicate covers all
four populations including printable, which must keep its row.

**This also settles the question the build queue left open** when 2b was
deferred: whether a card deletion that empties an attempt should *delete* it,
matching `planErasure`'s stance at `erase.ts:384`, or merely null the score
and let the filter hide it. It nulls the score. Erasing memory is a request to
destroy data; **editing a set is not**, and the cascaded population is reached
by another user's edit — deleting their row would spend a destructiveness
budget the editor was never granted. D2's discard is the exception precisely
because there the actor is deleting *their own* attempt, deliberately.

### D2 — But discard on the *skipped* path, because intent is knowable there

Pressing Submit having answered nothing is an explicit act. That is a real
signal rather than an inference, so the attempt is deleted outright — matching
`planErasure`'s existing stance (`src/lib/memory/erase.ts:384`) that an
attempt with no answers left "would otherwise linger in the activity feed as a
ghost quiz with nothing in it."

Abandonment stays a filter case: closing a tab fires no handler, so nothing
can distinguish "gave up" from "phone rang."

### D3 — Re-score on card deletion, across users

The cascaded population's cause is live: `updateSet` deletes cards with a
plain `prisma.card.deleteMany` (`src/actions/sets.ts:293` — the only
card-delete path) and nothing recomputes the affected `QuizAttempt.score`.

Sets are link-shareable and `startQuizAttempt` is readability-scoped
(`src/actions/quiz.ts:365`), so an owner's edit strands **other learners'**
scores. The re-score therefore has no `userId` filter — the only cross-user
memory write in the app. There is no privacy cost: each score is derived
solely from that user's own surviving answers.

This is also the only piece that fixes a *partially* emptied attempt, which
D1's filter structurally cannot catch because it still has answers.

### D4 — Reuse the deletion machinery; do not write a second copy

Both halves already exist:

- the discard is `executeErasure(userId, { kind: 'attempt', attemptId })`,
  the same call `resetQuizAttempt` makes. `planErasure` even carries a branch
  written for this exact case (`erase.ts:371-378`): *"An attempt the caller
  explicitly targeted but that the loader never enumerated — e.g. a
  zero-answer, never-completed quiz — must still be deleted."*
- the re-score rule is `erase.ts:380-410`. It gets extracted rather than
  reimplemented.

---

## Components

### C1 — `ANSWERED_ATTEMPT_WHERE` (new: `src/lib/quiz/history.ts`)

```ts
export const ANSWERED_ATTEMPT_WHERE = {
  answers: { some: {} },
} satisfies Prisma.QuizAttemptWhereInput
```

Applied at **exactly two** call sites:

| Site | Why |
| --- | --- |
| `src/actions/user.ts:42` (`getUserStats`) | the only surface listing attempts |
| `src/lib/metrics/read.ts:113` (`repeatBonus` window) | an empty attempt is not a sitting; including it dilutes "within the last N attempts" |

**The risk here is inverted from `readableSetWhere`, and the doc comment must
say so.** With visibility, forgetting the guard leaked data, so spreading it
everywhere was safe. Here, over-applying is the dangerous direction: an
in-flight attempt has zero answers until the first submit, so these four
readers must **never** filter —

- the in-flight lookups in `src/actions/quiz.ts` and `src/actions/quiz-matching.ts`
  (filtering breaks the first question of every quiz),
- `src/app/sets/[id]/print/page.tsx` (printable attempts are zero-answer by design),
- `src/lib/memory/erase-execute.ts` (erasure must see what it is erasing).

Applying it in `metrics/read.ts` is provably safe for the tag join: every
error tag reaches an attempt through `quizAnswer.attemptId`, so any attempt a
tag references has ≥1 answer by construction and cannot be filtered away.
(Were that not so, `deriveTagScores` appends an unlisted attempt to the **end**
of its order — `src/lib/errors/derive.ts:108-112` — which would silently
misplace it in the repeat window rather than erroring.)

**That query carries a comment reading "Deliberately NOT scoped."** It refers
to `HistoryScope`, a different axis, but a reader will take the new filter as
violating it. The comment was amended in the same edit rather than left to
create a contradiction.

`getUserStats` must apply it to **all four** outputs — `totalAttempts`,
`modeStats`, `overallAverageScore`, `recentAttempts` — since they derive from
one query. A filter that fixes the list but not the count is the obvious
half-fix.

### C2 — `QuizSectionHandle.answeredCount`

`src/components/quiz/section.tsx` gains a second method:

```ts
export interface QuizSectionHandle {
  commitAll: () => Promise<void>
  /** How many questions the learner actually answered, in this section's own
   *  terms. The INTENT signal for a skipped quiz — never a deletion authority
   *  on its own; see `discardSkippedQuizAttempt`. */
  answeredCount: () => number
}
```

Per section: multiple-choice and true/false count keys in `selectedAnswers`;
short answer counts non-empty trimmed `answers`; matching counts
`Object.keys(matches).length`, which already gates its own early return
(`MatchingQuiz.tsx:95`).

### C3 — `discardSkippedQuizAttempt` (new action)

```ts
discardSkippedQuizAttempt(input: {
  attemptId: string
  clientAnsweredCount: number
}): Promise<ActionResult<{ discarded: boolean }>>
```

Discards only when **all** hold:

1. `clientAnsweredCount === 0` — the learner's intent,
2. the attempt has zero `QuizAnswer` rows server-side — the safety check,
3. `printable === false` — a printable attempt exists to be printed and is
   never submitted, so discarding one would be reaching outside this flow,
4. the attempt belongs to the caller.

**Condition 3 does not protect printing, and the original reason given here
("a printed test must keep its row") was wrong.** Print is not gated on
`printable`: `src/app/sets/[id]/print/page.tsx:46` reads *any* attempt of the
caller's by id, and `QuizContainer`'s own "Print this test" button passes the
current — non-printable — attempt id. So a learner who prints a normal quiz
and then submits it blank does lose that row. Accepted: the printed PDF
already exists in their other tab.

Then: `executeErasure(userId, { kind: 'attempt', attemptId })`, which removes
the attempt, its `StudySession`, and its cascading `QuizQuestion` rows.

**Condition 1 exists because of a bug found while designing this.** Individual
answer failures do not throw — they call `showError` and continue. So a
learner who answered three questions and hit an AI failure on all three also
reaches submit with zero stored answers and no exception. Without the client's
count, that learner would be shown "Quiz Skipped" and have their attempt
deleted, hiding a real failure behind a message saying they did nothing.

Condition 2 exists because the client must never be able to order a deletion
on its own — the same reasoning behind every owner-scoped write in the
erasure module.

### C4 — The "Quiz Skipped" screen

`handleSubmitQuiz` (`src/components/quiz/QuizContainer.tsx:78`) becomes:

1. `await Promise.all(... commitAll())` — unchanged.
2. If **no exception** was thrown, call `discardSkippedQuizAttempt` with the
   summed `answeredCount`.
3. If it reports `discarded: true` → render the Skipped notice. **Skip
   `finishStudySession` and `generateSessionInsight` entirely** — the session
   is being deleted, so closing it first is wasted work and generating an AI
   narrative about nothing is worse.
4. Otherwise → today's path: `finishStudySession`, fire-and-forget insight,
   `QuizSummary`.

If `commitAll` **threw**, skip the discard entirely. That is a grading crash,
not a skipped quiz, and labelling it "Skipped" would hide a defect. The
existing generic toast and results screen still apply.

New component `src/components/quiz/QuizSkippedNotice.tsx`: a heading, one line
of copy stating that no answers were recorded and nothing was saved to
history, and a link back to the set. Deliberately vague — no score, no
question list, no per-question detail.

### C5 — `storedScore` (extracted into `src/lib/quiz/scoring.ts`)

```ts
/** The stored form of an attempt's score: the mean of its answers' scores,
 *  rounded because `QuizAttempt.score` is an Int column. Null when no answer
 *  carries a score. */
export function storedScore(answers: { score: number | null }[]): number | null
```

`erase.ts` and C6 both call it. The round-because-`Int` decision exists in
**five** places, not the three originally claimed here: `erase.ts:395` plus
**four** live writers in `quiz.ts` — `:570`, `:749`, `:1169`, `:1284`. The two
short-answer paths (text and multimodal) were missed. This collapses the two
that matter for correctness here; the four live writers keep rounding inline,
deliberately (see below).

**The four live `quiz.ts` writers keep their `if (newScore !== null)` guard.**
That guard is the mechanism by which an attempt keeps a score after losing its
evidence — but on those paths an answer was *just* created, so `allAnswers` is
never empty and it cannot fire wrongly. C6 is the path that must clear the
column, and it does. Changing the live writers would be unrelated scoring
behaviour.

`storedScore`'s tests pin **half-up** rounding (`2.5 → 3`), distinguishing
`Math.round` from banker's rounding. Two different rules across the erasure
and re-score paths would make an attempt flip by a point depending on which
code last touched it.

### C6 — `rescoreSetAttempts(tx, setId)`

Called from `updateSet` only when `plan.toDeleteIds.length > 0`. One query in
(the set's attempts with `answers: { select: { score: true } }`), `storedScore`
per attempt, and an update **only** where the stored value actually differs.

**`updateSet`'s card block had to be converted to an interactive transaction
first.** It was an *array-form* `prisma.$transaction([...])`, which takes
pre-built promises and therefore cannot express "read after the delete lands".
It is now `$transaction(async (tx) => …)` with the original order preserved
exactly: deleteMany → updates → creates → `set.update`.

**Matching-mode attempts converge, and that is intended** (ruled 2026-08-12).
`quiz-matching.ts:120` writes `round(correct / matches.length × 100)`
**unconditionally**, scoped to its own section, while MC/SA/TF write the mean
of the attempt's answers — and sections commit in **parallel** (`Promise.all`
in `QuizContainer`). So a *mixed* quiz containing matching already stores
whichever write landed last, and it already diverges from `storedScore`. A
re-score therefore changes such an attempt even when the deleted card was
unrelated to it. Mean-of-answers is the more defensible number; the
convergence is a fix, not a side effect. Matching-*only* attempts are
unaffected — the two formulas agree there.

**Recomputes every attempt on the set rather than snapshotting affected ones.**
The snapshot version must capture attempt ids *before* the cascade destroys
the `QuizAnswer.cardId` link, which makes ordering load-bearing and still
loses an answer committed between snapshot and delete. Recomputing from ground
truth needs no snapshot and is race-*tolerant*: a concurrent submit derives the
same score itself. Bounded by attempts-per-set, and only on the rare edit that
deletes a card.

**Must write `null`.** `quiz.ts:571` and `:750` both guard
`if (newScore !== null)` — which is precisely how an attempt keeps a score
after losing all its evidence. This path must clear it.

---

## Out of scope, decided

- **No cleanup sweep.** All 16 offenders are already gone.
- **No deferred `QuizAttempt` creation.** Breaks print, and the attempt id is
  needed immediately by `getQuizAttemptCards` and by `QuizQuestion` writes.
- **No unload/`sendBeacon` handler for abandonment.** Unreliable, and the read
  filter covers it without new failure modes.
- **No change to empty `StudySession` rows.** Nothing enumerates them.
- **Card deletion does not become an erasure scope.** `KlpState` already
  cascades correctly via `CardKlp → Card`, so the replay would be a no-op.
  Only the stored score needs fixing.
- **Matching-mode per-answer erase controls.** Already recorded as a known gap
  in the deletion spec; unchanged here.

---

## Testing

**Pure.** `storedScore` — mean, rounding, and the null case. The changed-rows
filter in C6.

**Behavioural.** `getUserStats` excludes zero-answer attempts from all four
outputs. `discardSkippedQuizAttempt` refuses when `clientAnsweredCount > 0`,
when the server sees answers, when `printable`, and when the attempt is
another user's — four separate refusals, since a single "happy path" test
would pass with any one guard missing. Deleting a card re-scores a **second
user's** attempt, which is the entire point of D3.

**Component.** `QuizContainer` renders the Skipped notice on
`discarded: true`, renders `QuizSummary` otherwise, and does **not** call
`finishStudySession` on the discard path.

**Regression guard.** Submitting the first answer of a fresh attempt still
works — the failure mode if `ANSWERED_ATTEMPT_WHERE` is applied too widely.

**Live gate.** Per the lesson from Spec 2 (a 1016-test suite went green over a
statement Postgres rejected): start a quiz and submit it blank, confirm the
Skipped screen and that `attempts` does not increase; then start one, close
the tab, and confirm `/profile` never shows it.

---

## Known limits

- **Abandoned attempts still accumulate rows**, hidden rather than removed.
  Acceptable: they are small, they cascade cleanly whenever the set or account
  is erased, and no reliable client signal exists to delete them on.
- **A partially-emptied attempt from a card deletion keeps a score derived
  from fewer answers than it was taken with.** That is correct — it reflects
  surviving evidence — but the displayed score will differ from what the
  learner remembers seeing.
- **C6 is the only cross-user write in the codebase.** It needs a doc comment
  saying so explicitly, or a future reader will "fix" it by adding the
  `userId` scope every neighbouring function has.

---

## Corrected during planning

Six claims in the original draft were wrong about the code. All are fixed
inline above; listed here so the *pattern* is visible rather than buried.

| # | The claim | What the code actually does |
| --- | --- | --- |
| 1 | C6 takes a `tx` from `updateSet` | That block was an array-form `$transaction`; conversion was required first |
| 2 | C6 updates only where the value differs | Matching writes a different formula unconditionally, so mixed attempts already diverge |
| 3 | Filter `metrics/read.ts:113` | That query is annotated "Deliberately NOT scoped" on a different axis |
| 4 | Condition 3 protects printing | Print is not gated on `printable` at all |
| 5 | Rounding lives in three places | Five — the two short-answer paths were missed |
| 6 | Assorted line references | Off by 1–3 in several places |

## Found during implementation

Six more, each of which changed the work or the tests:

1. **The regression guards named for the transaction conversion could not
   detect a transaction regression.** The plan said to verify the array-form →
   interactive conversion against `tests/cards/{reconcile,stale,categories}`.
   Those are pure unit tests of helpers `updateSet` *calls*; they passed
   identically before and after and would have passed had the ordering been
   broken outright. The conversion-order assertion in
   `tests/actions/update-set-rescore.test.ts` is the first thing that pins it.
   **This is the recurring failure mode in this repo** — a green suite over a
   thing that does not work (cf. the `$queryRaw` outage, BUILD-QUEUE trap 8).

2. **Gating the session close on `discarded` alone would have added a
   `finishStudySession` call on the grading-crash path.** The old code wrapped
   `commitAll` and `finishStudySession` in one shared `try`, so a throw already
   bypassed the close. The restructure needed a `!gradingFailed` term to
   *preserve* that — otherwise a behaviour change would have been smuggled
   inside a refactor, in the exact case where the system is already failing.

3. **The over-application guard matched raw source text, so a *comment* in
   `QuizContainer` naming `ANSWERED_ATTEMPT_WHERE` tripped it.** It now strips
   comments and detects use, not mention. The comment is worth keeping — it
   explains why a failed discard is survivable — and a guard that forced
   comments to avoid naming what they describe would buy precision with worse
   documentation. Re-verified by mutation that a real reference still fails.

4. **`prisma.card.findMany` is called twice in `updateSet` with different
   shapes** — a `select` for reconciliation, an `include` for staleness. Any
   mocked-Prisma test of that action must branch on the args; a single
   `mockResolvedValue` silently feeds the wrong rows to
   `selectRefreshableStaleCardIds`.

5. **A `QuizContainer` jsdom test needs four mocks, not two.** It statically
   imports all four sections, so `MatchingQuiz` drags in
   `@/actions/quiz-matching`; `QuizSummary` fetches its own summary via
   `getQuizAttemptSummary`. Without both, the file dies at load with
   `Cannot find module next/server` before any test runs — a failure that
   looks unrelated to the change.

6. **This repo's `Button` is base-ui and has no `asChild`.** Link-styled
   buttons go through `buttonVariants()` on the `Link` directly.

Three tests in this work were confirmed to discriminate **by mutation**, not
assumed to: the cross-user re-score (adding a `userId` scope reddens it), the
`!gradingFailed` guard, and the over-application scan. A guard with no failing
test behind it is decoration.
