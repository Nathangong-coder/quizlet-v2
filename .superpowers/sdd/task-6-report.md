# Task 6 report — fix `resetUserMemory` missing `StudyEvent` delete

## Finding

`src/actions/user.ts`'s `resetUserMemory` (lines 65-85) deleted rows from
`quizAttempt`, `quizAnswer`, `confidenceEvent`, and `cardProgress` inside a
single `prisma.$transaction([...])`, but never deleted `studyEvent` rows.
`StudyEvent` was introduced in this branch's Task 1 and made the primary
write target for every study mode (Review, Quiz MC/SA/TF, matching) in
Task 2, but `resetUserMemory` predates the branch and was never updated to
match. The result: clicking "reset my memory" left `StudyEvent` history
fully intact.

This is not just a retention nitpick because two downstream consumers read
`StudyEvent` directly:

- `buildLearnerProfile` (`src/lib/memory/profile.ts`) computes recent
  per-mode accuracy, graded averages, streak days, and trend classification
  from `StudyEvent` rows. Post-reset, the learner profile fed to Gemini would
  still reflect pre-reset activity even though the user believed they'd
  wiped their memory.
- `recordStudyEvent` (`src/lib/memory/record.ts`) computes `mastery` for a
  card by folding the newest interaction together with the 10 most recent
  `StudyEvent` rows for that card. A "fresh" `CardProgress` row (confidence
  reset to 5) would still get its `mastery` score computed from orphaned
  pre-reset history.

## Fix

Added one line to the existing `$transaction` array in
`src/actions/user.ts`, matching the exact `{ where: { userId } }` shape
already used by the other four deletes:

```ts
await prisma.$transaction([
  prisma.quizAttempt.deleteMany({ where: { userId } }),
  prisma.quizAnswer.deleteMany({ where: { userId } }),
  prisma.confidenceEvent.deleteMany({ where: { userId } }),
  prisma.cardProgress.deleteMany({ where: { userId } }),
  prisma.studyEvent.deleteMany({ where: { userId } }),
]);
```

No other part of the function was touched — the transaction stays atomic
across all five deletes, the `userId` variable is the same one already in
scope (from `session.user.id`), and the `StudyEvent.userId` field (confirmed
in `prisma/schema.prisma`, line 213: `userId String`) matches the shape used
by the other models in this same `where` clause.

## Why this is correct

- `StudyEvent` has a `userId` column (see `prisma/schema.prisma` model
  `StudyEvent`, line 211 onward) with `onDelete: Cascade` from `User`, and is
  indexed on `[userId, ...]` — a `deleteMany({ where: { userId } })` is the
  same pattern already used for `quizAttempt`, `quizAnswer`,
  `confidenceEvent`, and `cardProgress`, all of which key off `userId`
  directly (not a joined foreign key), so no restructuring was needed.
- Keeping the delete inside the same `$transaction` array (rather than a
  separate call) preserves atomicity — either all five tables get cleared or
  none do, matching the existing all-or-nothing guarantee.

## Test / verification results

**Existing test coverage:** searched `tests/` and the whole repo for
`resetUserMemory` — only two references exist: the function definition
itself (`src/actions/user.ts`) and its caller (`src/app/profile/page.tsx`).
No test file exercises this function, so there was no existing test to run
or extend. Per the task's guidance, no new test infrastructure was built for
this one-line fix (consistent with this branch's existing precedent for
untested DB-shell action code); verification relied on the type checks below
plus the code-level reasoning above (the `StudyEvent` model's `userId`
column and cascade behavior are declared directly in
`prisma/schema.prisma`, so the query shape is provably correct without a
live-DB trace).

**`npx tsc --noEmit`:**
Shows exactly the 4 pre-existing errors, all in `tests/quiz/setup.test.ts`
(readonly-tuple `questionMode` type mismatches unrelated to this change).
Zero new errors.

**`npx vitest run`:**
```
Test Files  2 failed | 15 passed (17)
     Tests  5 failed | 189 passed (194)
```
The 5 failures are all in `tests/parser/import.test.ts` (pre-existing,
unrelated `fieldDelimiter` parser behavior — nothing to do with
`resetUserMemory` or `StudyEvent`). 189 passed, matching the expected
baseline exactly. Zero new/regressed failures.

## Commit

`fix: reset user memory also clears StudyEvent history`
