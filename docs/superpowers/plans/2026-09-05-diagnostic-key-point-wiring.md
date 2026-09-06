# Diagnostic ↔ Key Point Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a completed diagnostic write `AnswerKlpResult` and `KlpState` through the same evidence path every quiz mode uses, by generating its questions from real `CardKlp` rows instead of free-text learning points.

**Architecture:** A pure selector picks one `CardKlp` per question from the set's live key points. The generator is handed those key points and produces one question per probe — it no longer invents a learning point. On submit, each graded answer becomes a `QuizAnswer` under a `QuizAttempt` (`mode: 'diagnostic'`) sharing the diagnostic's `StudySession`, written by the same `createAnswerWithAnalysis` the quiz uses, so `AnswerKlpResult`, `AnswerErrorTag` and `KlpState` all follow with no new plumbing.

**Tech Stack:** Next.js App Router server actions, Prisma + Postgres (Neon), Zod, Vercel AI SDK v7, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-diagnostic-key-point-wiring-design.md`

## Global Constraints

- **Never call `ensureKlpsReady` per card at diagnostic start.** It gap-fills by invoking AI extraction; across a 120-card set that is a burst of calls against a free tier capped at 20 requests/day/model. Read live `CardKlp` rows in one query instead.
- **Never fabricate a verdict.** Every degradation drops evidence and records why (`analysisStatus`, `analysisWarnings`); none invents an `AnswerKlpResult`.
- **Significance and credit are computed in TypeScript**, never by the AI. The model supplies `status` (`passed|partial|failed`) and a 1–10 `magnitude`; `buildAnalysisWrites` does the rest.
- **`MIN_DIAGNOSTIC_KLPS = 12`** — a set below this refuses to start. Twelve because `DiagnosticStartSchema` already floors `questionCount` at 12.
- **`FOLLOW_UP_COUNT = 2`** — matches the existing generator's follow-up floor.
- **`EVIDENCE_STRENGTH['diagnostic'] = 0.95`** — free text, guess rate identical to `quiz-sa`.
- **`ANALYSIS_VERSION` is not bumped.** No existing row's numbers change.
- Tests are Vitest (`npm test`), imports use the `@/` alias, test files live under `tests/<area>/`.
- Baselines to hold: suite 2770 passing, `tsc` clean, lint 164 warnings.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR
  ```

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/errors/klp-credit.ts` | **Modify** — add the `diagnostic` evidence strength (G8). |
| `tests/errors/klp-credit.test.ts` | **Modify** — assert total coverage of graded modes. |
| `src/lib/quiz/mode.ts` | **Modify** — `diagnostic` joins the quiz-mode ↔ study-source bridge. |
| `src/lib/memory/scope.ts` | **Modify** — expression evidence becomes a mode *list*. |
| `src/lib/memory/profile.ts` | **Modify** — graded-accuracy signal accepts diagnostic. |
| `src/lib/quiz/history.ts` | **Modify** — add `QUIZ_HISTORY_WHERE` (diagnostics hidden from quiz history). |
| `src/actions/user.ts`, `src/app/(app)/sets/page.tsx` | **Modify** — use `QUIZ_HISTORY_WHERE`. |
| `prisma/schema.prisma` + `prisma/migrations/20260905020000_diagnostic_klp_link/` | **Modify/Create** — `klpId`, `quizAnswerId`, `engineVersion`, `abandoned`. |
| `src/lib/diagnostic/select.ts` | **Create** — the pure probe selector. No I/O, no AI. |
| `src/lib/analysis/write-answer.ts` | **Create** — `createAnswerWithAnalysis`, moved out of `src/actions/quiz.ts`, now `tx`-aware. |
| `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/diagnostic.ts` | **Modify** — v2 prompts and their schemas. |
| `src/actions/diagnostic.ts` | **Modify** — start and submit rewritten around probes. |
| `src/app/(app)/diagnostic/page.tsx` | **Modify** — gate removed, past-attempt list added. |
| `src/app/(app)/diagnostic/[attemptId]/page.tsx` | **Create** — read-only view of a past attempt (the legacy banner's home). |
| `src/components/diagnostic/DiagnosticAttemptView.tsx` | **Create** — the results markup, shared by the live results screen and the past-attempt page. |

---

## Task 1: Close G8 — diagnostic evidence strength

`'diagnostic'` was added to `STUDY_SOURCES` but never to `EVIDENCE_STRENGTH`, so `klpCredit` silently used `DEFAULT_STRENGTH = 0.75` — a 0.25 guess rate, i.e. four-option multiple choice. Nothing failed, which is why the test in Step 1 matters more than the constant.

**Files:**
- Modify: `src/lib/errors/klp-credit.ts:25-38`
- Test: `tests/errors/klp-credit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EVIDENCE_STRENGTH['diagnostic'] === 0.95`; exported `GRADED_KLP_MODES: StudySource[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/errors/klp-credit.test.ts`:

```ts
import { EVIDENCE_STRENGTH, GRADED_KLP_MODES, klpCredit } from '@/lib/errors/klp-credit'

describe('EVIDENCE_STRENGTH coverage', () => {
  it('has an explicit entry for every mode that can reach klpCredit', () => {
    // G8: 'diagnostic' was added to STUDY_SOURCES and not here, so it took
    // DEFAULT_STRENGTH (0.75 — a four-option-MC guess rate) for a free-text
    // mode, silently. Nothing failed. This is the thing that should fail.
    for (const mode of GRADED_KLP_MODES) {
      expect(EVIDENCE_STRENGTH[mode]).toBeDefined()
    }
  })

  it('treats a diagnostic answer as free-text evidence, like short answer', () => {
    expect(EVIDENCE_STRENGTH.diagnostic).toBe(EVIDENCE_STRENGTH['quiz-sa'])
    expect(klpCredit('passed', 'diagnostic')).toBeCloseTo(0.95)
    expect(klpCredit('partial', 'diagnostic')).toBeCloseTo(0.475)
  })

  it('still scores a failed diagnostic answer at zero, like every other mode', () => {
    expect(klpCredit('failed', 'diagnostic')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors/klp-credit.test.ts`
Expected: FAIL — `GRADED_KLP_MODES` is not exported, and `EVIDENCE_STRENGTH.diagnostic` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/errors/klp-credit.ts`, add `'diagnostic': 0.95` to `EVIDENCE_STRENGTH`, update its doc comment, and export the mode list:

```ts
/**
 * `1 - guessRate`: how much a CORRECT answer in this mode actually proves.
 * Four-option MC can be guessed 1-in-4; true/false is a coin flip; free text
 * has nothing to guess from.
 *
 * Only the modes that are actually graded against a KLP. `klpCredit`'s `mode`
 * parameter is typed as the full `StudySource` because that is what
 * `AnswerKlpResult.mode` is typed as — but this map intentionally does NOT
 * carry review/matching/lesson: nothing calls `klpCredit` with them, and a
 * guessed number for a mode nobody has reasoned about would be worse than no
 * number at all. `DEFAULT_STRENGTH` covers them if that ever changes.
 *
 * `diagnostic` is 0.95, not the DEFAULT_STRENGTH it silently took before
 * (gap G8): a diagnostic answer is free text with no options to choose from,
 * so its guess rate is short answer's. Falling back meant every diagnostic
 * posterior was computed as though the learner had a 1-in-4 shot.
 */
export const EVIDENCE_STRENGTH: Record<string, number> = {
  'quiz-sa': 0.95,
  'quiz-mc': 0.75,
  'quiz-tf': 0.5,
  diagnostic: 0.95,
}

/**
 * The modes that can reach `klpCredit`, i.e. that write `AnswerKlpResult`.
 *
 * Exists so a test can assert `EVIDENCE_STRENGTH` is TOTAL over it. G8 was a
 * mode added to one vocabulary and not this one, with no failure anywhere.
 * Adding a graded mode without a strength must now break the build.
 */
export const GRADED_KLP_MODES: StudySource[] = [
  'quiz-sa', 'quiz-mc', 'quiz-tf', 'diagnostic',
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors/klp-credit.test.ts tests/metrics/bkt.test.ts`
Expected: PASS. (`bkt.test.ts` is included because `guessRate` derives from this map.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors/klp-credit.ts tests/errors/klp-credit.test.ts
git commit -m "fix(memory): give diagnostic answers their own evidence strength

Closes gap G8. 'diagnostic' was in STUDY_SOURCES but not in
EVIDENCE_STRENGTH, so klpCredit fell through to DEFAULT_STRENGTH (0.75 —
a four-option-MC guess rate) for a free-text mode. Every diagnostic BKT
posterior was computed as though the learner had a 1-in-4 shot.

GRADED_KLP_MODES exists so the omission is a test failure next time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 2: Bridge `diagnostic` across the quiz-mode / study-source vocabularies

Diagnostic answers are about to exist as `QuizAnswer` rows. Without this, `toQuizMode('diagnostic')` returns `null` and `buildQuizAnswerScopeWhere` turns a diagnostic-scoped request into a query matching **zero** rows — silently, reading as "no diagnostic activity" rather than as an error.

**Files:**
- Modify: `src/lib/quiz/mode.ts:11-27`
- Test: `tests/quiz/mode.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `QUIZ_MODES` includes `'diagnostic'`; `toStudySource('diagnostic') === 'diagnostic'`; `toQuizMode('diagnostic') === 'diagnostic'`.

- [ ] **Step 1: Write the failing test**

Add to `tests/quiz/mode.test.ts`:

```ts
describe('diagnostic', () => {
  it('round-trips, because diagnostic answers are QuizAnswer rows', () => {
    expect(toStudySource('diagnostic')).toBe('diagnostic')
    expect(toQuizMode('diagnostic')).toBe('diagnostic')
  })

  it('is not null — a null here silently empties every diagnostic-scoped query', () => {
    // buildQuizAnswerScopeWhere (src/lib/memory/scope.ts) translates a scope's
    // StudyEvent sources into QuizAnswer.mode values through toQuizMode. null
    // must mean "no QuizAnswer can carry this source", and after this change
    // that is false for diagnostic.
    expect(toQuizMode('diagnostic')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz/mode.test.ts`
Expected: FAIL — `toQuizMode('diagnostic')` is `null`, and `toStudySource('diagnostic')` is a type error / `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/quiz/mode.ts`:

```ts
export const QUIZ_MODES = [
  'multiple-choice', 'short-answer', 'true-false', 'matching', 'diagnostic',
] as const

const TO_STUDY_SOURCE: Record<QuizMode, StudySource> = {
  'multiple-choice': 'quiz-mc',
  'short-answer': 'quiz-sa',
  'true-false': 'quiz-tf',
  matching: 'matching',
  // The one mode whose two names are the same string. It is here because a
  // submitted diagnostic writes QuizAnswer rows (spec §3.1 D1); leaving it out
  // makes toQuizMode('diagnostic') null, which every caller is instructed to
  // treat as "match nothing".
  diagnostic: 'diagnostic',
}
```

Leave `toStudySource`, `FROM_STUDY_SOURCE` and `toQuizMode` unchanged — the inverse map is derived, so it picks this up for free.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz/ tests/memory/scope.test.ts`
Expected: PASS. `QUIZ_MODES` is referenced only by this module and its test, so nothing renders over it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quiz/mode.ts tests/quiz/mode.test.ts
git commit -m "feat(quiz): bridge 'diagnostic' between quiz mode and study source

Diagnostic answers are about to be QuizAnswer rows. Without the bridge,
toQuizMode('diagnostic') is null and buildQuizAnswerScopeWhere turns a
diagnostic-scoped memory query into one matching zero rows — silently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 3: Expression evidence is a set of modes, not one mode

Readiness's denominator is "answers that could carry clarity/conciseness tags". A diagnostic answer is free text and can, so excluding it undercounts the denominator against a numerator diagnostic tags *will* land in. MC/TF still must not be counted — they hardcode `dimension: 'accuracy'`, so counting them would invert the metric.

**Files:**
- Modify: `src/lib/memory/scope.ts:13`, `src/lib/memory/scope.ts:316-325`
- Modify: `src/lib/memory/profile.ts:301-308`
- Test: `tests/memory/scope.test.ts`, `tests/memory/profile.test.ts`

**Interfaces:**
- Consumes: `QuizMode` from Task 2.
- Produces: `buildExpressionAnswerWhere` returns `AND: [{ mode: { in: ['short-answer', 'diagnostic'] } }]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/memory/scope.test.ts`:

```ts
import { buildExpressionAnswerWhere } from '@/lib/memory/scope'

describe('buildExpressionAnswerWhere', () => {
  it('counts diagnostic answers as expression evidence', () => {
    // A diagnostic answer is free text and CAN carry a clarity or conciseness
    // tag. Leaving it out of the denominator while its tags land in the
    // numerator makes readiness drift upward with every diagnostic taken.
    const where = buildExpressionAnswerWhere({ userId: 'u1' })
    expect(where.AND).toEqual([{ mode: { in: ['short-answer', 'diagnostic'] } }])
  })

  it('still excludes MC and TF', () => {
    const where = buildExpressionAnswerWhere({ userId: 'u1' })
    const modes = (where.AND as Array<{ mode: { in: string[] } }>)[0].mode.in
    expect(modes).not.toContain('multiple-choice')
    expect(modes).not.toContain('true-false')
  })

  it('keeps the mode constraint in AND so a contradictory scope yields nothing', () => {
    const where = buildExpressionAnswerWhere({ userId: 'u1', mode: 'multiple-choice' })
    expect(where.mode).toBe('multiple-choice')
    expect(where.AND).toBeDefined()
  })
})
```

Add to `tests/memory/profile.test.ts`:

```ts
it('includes diagnostic answers in the graded-accuracy signal', () => {
  const events = [
    { source: 'diagnostic', score: 80, correct: true, createdAt: new Date(), cardId: 'c1' },
    { source: 'diagnostic', score: 60, correct: false, createdAt: new Date(), cardId: 'c2' },
  ]
  const profile = buildLearnerProfile({ events, progress: [] } as never)
  expect(profile.graded.length).toBe(1)
  expect(profile.graded[0].count).toBe(2)
})
```

> Adapt the `buildLearnerProfile` call shape to whatever the existing tests in that file already use — do not invent a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory/scope.test.ts tests/memory/profile.test.ts`
Expected: FAIL — `where.AND` is `[{ mode: 'short-answer' }]`, and `profile.graded` is empty for diagnostic events.

- [ ] **Step 3: Write minimal implementation**

`src/lib/memory/scope.ts` — replace the singular constant:

```ts
/**
 * The quiz modes that can produce EXPRESSION evidence.
 *
 * MC and TF answers are graded without an AI call and hardcode
 * `dimension: 'accuracy'` (`binaryModeDrafts`), so they can never contribute a
 * clarity or conciseness tag. Counting them in readiness's denominator while
 * only free-text modes contribute to its numerator inverts the metric: the
 * more multiple choice a learner does, the more "interview-ready" they look.
 *
 * `diagnostic` is here for the mirror-image reason — it IS free text, its
 * grader returns the same errorTags contract short answer does, so its tags
 * reach the numerator. Omitting it from the denominator would drift readiness
 * upward with every diagnostic taken.
 */
const EXPRESSION_QUIZ_MODES: QuizMode[] = ["short-answer", "diagnostic"];
```

and in `buildExpressionAnswerWhere`:

```ts
    AND: [{ mode: { in: EXPRESSION_QUIZ_MODES } }],
```

`src/lib/memory/profile.ts` — widen the graded filter:

```ts
  const graded: GradedAccuracy[] = []
  // Both free-text modes. A diagnostic answer is graded on the same 1-10
  // rubric by the same kind of call, so excluding it would hide a whole
  // sitting's worth of written-answer signal from the profile.
  const gradedEvents = recentEvents.filter(
    (e) => (e.source === 'quiz-sa' || e.source === 'diagnostic') && e.score !== null,
  )
```

Leave the emitted `mode: 'quiz-sa'` label on the `graded` entry as is — it is the prompt-facing name for "written answers", and splitting it would give the profile two near-identical rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/memory/ tests/metrics/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/scope.ts src/lib/memory/profile.ts tests/memory/
git commit -m "feat(memory): count diagnostic answers as expression evidence

A diagnostic answer is free text and its grader returns the same errorTags
contract short answer does, so its clarity/conciseness tags reach
readiness's numerator. Leaving it out of the denominator would drift the
metric upward with every diagnostic taken. MC/TF stay excluded for the
original reason — they can only ever produce accuracy tags.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 4: Hide diagnostics from quiz history, keep them in the repeat window

Two surfaces mean "quizzes you took" and must not show a diagnostic. One surface means "sittings in which you could have repeated a mistake" and must.

**Files:**
- Modify: `src/lib/quiz/history.ts:25-27`
- Modify: `src/actions/user.ts:49`
- Modify: `src/app/(app)/sets/page.tsx:87`
- Test: `tests/quiz/history.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `QUIZ_HISTORY_WHERE` exported from `src/lib/quiz/history.ts`.

- [ ] **Step 1: Write the failing test**

Create/append `tests/quiz/history.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ANSWERED_ATTEMPT_WHERE, QUIZ_HISTORY_WHERE } from '@/lib/quiz/history'

describe('QUIZ_HISTORY_WHERE', () => {
  it('excludes diagnostics from surfaces that mean "quizzes you took"', () => {
    expect(QUIZ_HISTORY_WHERE.mode).toEqual({ not: 'diagnostic' })
  })

  it('still requires an answered attempt', () => {
    expect(QUIZ_HISTORY_WHERE.answers).toEqual({ some: {} })
  })

  it('leaves ANSWERED_ATTEMPT_WHERE alone', () => {
    // It is also the repeatBonus window (loadAnsweredAttemptIds), where a
    // diagnostic sitting MUST count — a mistake made in a diagnostic is still
    // a repeat of a mistake. Its own doc warns that over-applying is the
    // dangerous direction here.
    expect(ANSWERED_ATTEMPT_WHERE).toEqual({ answers: { some: {} } })
    expect('mode' in ANSWERED_ATTEMPT_WHERE).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz/history.test.ts`
Expected: FAIL — `QUIZ_HISTORY_WHERE` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/quiz/history.ts`, after `ANSWERED_ATTEMPT_WHERE`:

```ts
/**
 * `ANSWERED_ATTEMPT_WHERE` plus "not a diagnostic" — for the two surfaces that
 * mean "quizzes you took".
 *
 * A submitted diagnostic creates a QuizAttempt (`mode: 'diagnostic'`) purely
 * as the anchor AnswerKlpResult's required FK needs (spec §3.1 D1). It is not
 * a quiz, and listing it under the quiz icon or folding it into per-mode quiz
 * averages would mislabel it.
 *
 * A SEPARATE constant rather than a change to ANSWERED_ATTEMPT_WHERE, because
 * that one is ALSO the repeatBonus window in `loadAnsweredAttemptIds`, and a
 * mistake made during a diagnostic is still a repeat of a mistake. Narrowing
 * it there would make the same tag score differently depending on which
 * activity the learner happened to make the error in.
 *
 * Correct call sites (2):
 *   - src/actions/user.ts            getUserStats
 *   - src/app/(app)/sets/page.tsx    the library's recent-attempt list
 */
export const QUIZ_HISTORY_WHERE = {
  ...ANSWERED_ATTEMPT_WHERE,
  mode: { not: 'diagnostic' },
} satisfies Prisma.QuizAttemptWhereInput
```

`src/actions/user.ts` — change the import to `QUIZ_HISTORY_WHERE` and line 49 to `where: { userId, ...QUIZ_HISTORY_WHERE },`.

`src/app/(app)/sets/page.tsx:87` — add the predicate to the existing `where`:

```ts
    prisma.quizAttempt.findMany({ where: { userId: session.user.id, ...QUIZ_HISTORY_WHERE, ...(q ? { OR: [{ mode: { contains: q, mode: 'insensitive' } }, { set: { title: { contains: q, mode: 'insensitive' } } }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, setId: true, mode: true, score: true, questionCount: true, sessionId: true, createdAt: true, set: { select: { title: true } } } }),
```

with `import { QUIZ_HISTORY_WHERE } from '@/lib/quiz/history'` added.

> Note the spread order: `QUIZ_HISTORY_WHERE` first, so the search `OR` cannot overwrite the exclusion. Verify by reading the final object — a later `mode:` key in the same literal would silently win.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz/ && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quiz/history.ts src/actions/user.ts "src/app/(app)/sets/page.tsx" tests/quiz/history.test.ts
git commit -m "feat(quiz): hide diagnostics from quiz history, keep them in the repeat window

QUIZ_HISTORY_WHERE is a new constant, not a change to
ANSWERED_ATTEMPT_WHERE: that one is also the repeatBonus window, where a
diagnostic sitting must count, or the same error tag scores differently
depending on which activity produced it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 5: Schema — link a diagnostic question to its key point and its answer

**Files:**
- Modify: `prisma/schema.prisma` (`DiagnosticAttempt` ~865-885, `DiagnosticQuestion` ~887-911, `CardKlp` and `QuizAnswer` back-relations)
- Create: `prisma/migrations/20260905020000_diagnostic_klp_link/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `DiagnosticQuestion.klpId`, `DiagnosticQuestion.quizAnswerId`, `DiagnosticAttempt.engineVersion`, status value `'abandoned'`.

- [ ] **Step 1: Edit the Prisma schema**

`DiagnosticAttempt` — add, with the doc comment:

```prisma
/// Which generation of the diagnostic produced this attempt.
///
/// 1 = pre-key-point: questions carried a free-text `learningPoint` with no
/// `CardKlp` behind it, so the run moved CardProgress/confidence but nothing
/// at key-point grain. 2 = every question is anchored to a live CardKlp and
/// wrote a QuizAnswer.
///
/// A COLUMN even though it is derivable from `questions.some(q => q.klpId)`:
/// the results view needs one field to decide whether to show the legacy
/// banner, and the derivation would mislabel a NEW attempt on a set whose
/// cards happen to have no key points.
engineVersion Int @default(1)
```

and widen the `status` comment to `// in_progress | completed | abandoned`.

`DiagnosticQuestion` — add:

```prisma
  /// The key point this question probes. NULL means a pre-key-point question
  /// (engineVersion 1) or one whose KLP row was removed afterwards.
  ///
  /// SetNull, NOT Cascade. The question text and the learner's answer are a
  /// record of what happened; they must not disappear because a proposition
  /// was edited away. An unattributed question is incomplete, a deleted one
  /// is a hole in someone's history.
  klpId        String?
  /// The QuizAnswer this question's grade was written to — the row that
  /// carries AnswerKlpResult/AnswerErrorTag and steps KlpState.
  ///
  /// SetNull for the same reason as klpId: erasing the answer must not erase
  /// the question that was asked.
  quizAnswerId String? @unique

  klp        CardKlp?    @relation(fields: [klpId], references: [id], onDelete: SetNull)
  quizAnswer QuizAnswer? @relation(fields: [quizAnswerId], references: [id], onDelete: SetNull)

  @@index([klpId])
```

Add the back-relations: `diagnosticQuestions DiagnosticQuestion[]` on `CardKlp`, and `diagnosticQuestion DiagnosticQuestion?` on `QuizAnswer`.

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260905020000_diagnostic_klp_link/migration.sql`:

```sql
-- prisma/migrations/20260905020000_diagnostic_klp_link/migration.sql
--
-- Anchors a diagnostic question to the CardKlp it probes and to the QuizAnswer
-- its grade was written to, so a completed diagnostic produces
-- AnswerKlpResult/KlpState like every other graded mode.

ALTER TABLE "DiagnosticAttempt" ADD COLUMN "engineVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "DiagnosticQuestion" ADD COLUMN "klpId" TEXT;
ALTER TABLE "DiagnosticQuestion" ADD COLUMN "quizAnswerId" TEXT;

-- SetNull on both: the question text and the learner's answer are a record of
-- what happened and must survive the removal of a key point or an answer row.
ALTER TABLE "DiagnosticQuestion"
  ADD CONSTRAINT "DiagnosticQuestion_klpId_fkey"
  FOREIGN KEY ("klpId") REFERENCES "CardKlp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiagnosticQuestion"
  ADD CONSTRAINT "DiagnosticQuestion_quizAnswerId_fkey"
  FOREIGN KEY ("quizAnswerId") REFERENCES "QuizAnswer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DiagnosticQuestion_quizAnswerId_key" ON "DiagnosticQuestion"("quizAnswerId");
CREATE INDEX "DiagnosticQuestion_klpId_idx" ON "DiagnosticQuestion"("klpId");

-- Every in-flight attempt at this moment predates the key-point link, so its
-- questions have no klpId and it can never be submitted under the new path.
-- Marked rather than deleted: nothing of a learner's is destroyed, and the
-- submit path keeps exactly ONE code branch instead of a permanent legacy one.
UPDATE "DiagnosticAttempt" SET "status" = 'abandoned' WHERE "status" = 'in_progress';
```

- [ ] **Step 3: Apply and verify against the live database**

```bash
npx prisma migrate deploy && npx prisma generate
```

Expected: migration applied, client regenerated. Then confirm the abandonment hit exactly the one known row:

```bash
npx tsx --env-file=.env -e "import('./src/lib/db').then(async ({prisma}) => { console.log(await prisma.diagnosticAttempt.groupBy({ by: ['status','engineVersion'], _count: true })); await prisma.\$disconnect() })"
```

Expected: `{ status: 'abandoned', engineVersion: 1, _count: 1 }` and `{ status: 'completed', engineVersion: 1, _count: 1 }`.

- [ ] **Step 4: Run the suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260905020000_diagnostic_klp_link/
git commit -m "feat(db): link diagnostic questions to key points and answers

Adds DiagnosticQuestion.klpId and .quizAnswerId (both SetNull — the
question asked and the answer given are a record of what happened and must
survive the removal of either), plus DiagnosticAttempt.engineVersion so a
pre-key-point attempt can be labelled rather than silently misread.

Marks the one in-flight pre-migration attempt abandoned, so the submit
path keeps a single branch instead of a permanent legacy one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 6: The pure probe selector

The one place that decides what a diagnostic asks. No I/O, no AI, deterministic — so it can be tested exhaustively and so a bad diagnostic is a unit-test failure, not a mystery.

**Files:**
- Create: `src/lib/diagnostic/select.ts`
- Test: `tests/diagnostic/select.test.ts`

**Interfaces:**
- Consumes: `BKT_PRIOR` from `@/lib/metrics/bkt`.
- Produces:
  ```ts
  export const FOLLOW_UP_COUNT = 2
  export const MIN_DIAGNOSTIC_KLPS = 12
  export interface DiagnosticKlpInput { id: string; cardId: string; index: number; weight: number }
  export interface DiagnosticKlpStateInput { klpId: string; pKnown: number }
  export interface DiagnosticProbe { klpId: string; cardId: string; kind: 'core' | 'follow-up' }
  export function selectDiagnosticProbes(input: {
    klps: DiagnosticKlpInput[]
    states: DiagnosticKlpStateInput[]
    count: number
  }): DiagnosticProbe[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/diagnostic/select.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  selectDiagnosticProbes, FOLLOW_UP_COUNT, MIN_DIAGNOSTIC_KLPS,
  type DiagnosticKlpInput,
} from '@/lib/diagnostic/select'

/** Three cards, three key points each, descending weight within a card. */
function corpus(): DiagnosticKlpInput[] {
  const out: DiagnosticKlpInput[] = []
  for (const card of ['a', 'b', 'c']) {
    for (let i = 0; i < 3; i++) {
      out.push({ id: `${card}${i}`, cardId: card, index: i, weight: 5 - i })
    }
  }
  return out
}

describe('selectDiagnosticProbes — baseline regime (no prior observations)', () => {
  it('spreads across cards before returning to any card', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const core = probes.filter((p) => p.kind === 'core')
    expect(core.map((p) => p.cardId)).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('takes the highest-weight key point on a card first', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const core = probes.filter((p) => p.kind === 'core')
    expect(core.slice(0, 3).map((p) => p.klpId)).toEqual(['a0', 'b0', 'c0'])
  })
})

describe('selectDiagnosticProbes — targeted regime (has observations)', () => {
  it('prefers a key point the learner has failed over one never seen', () => {
    // (1 - pKnown) x weight. A failed point sits below BKT_PRIOR, so it wins
    // with no special case for "never observed".
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 3 }, // unobserved -> 0.25
      { id: 'a1', cardId: 'a', index: 1, weight: 3 }, // failed -> 0.05
    ]
    const probes = selectDiagnosticProbes({
      klps, states: [{ klpId: 'a1', pKnown: 0.05 }], count: 1,
    })
    expect(probes[0].klpId).toBe('a1')
  })

  it('prefers a never-observed key point over a well-known one', () => {
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 3 }, // unobserved -> 0.25
      { id: 'a1', cardId: 'a', index: 1, weight: 3 }, // known -> 0.92
    ]
    const probes = selectDiagnosticProbes({
      klps, states: [{ klpId: 'a1', pKnown: 0.92 }], count: 1,
    })
    expect(probes[0].klpId).toBe('a0')
  })

  it('still spreads across cards — one weak card cannot eat the run', () => {
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 5 },
      { id: 'a1', cardId: 'a', index: 1, weight: 5 },
      { id: 'b0', cardId: 'b', index: 0, weight: 5 },
    ]
    const probes = selectDiagnosticProbes({
      klps,
      states: [{ klpId: 'a0', pKnown: 0.01 }, { klpId: 'a1', pKnown: 0.02 }, { klpId: 'b0', pKnown: 0.9 }],
      count: 2,
    })
    expect(probes.map((p) => p.cardId)).toEqual(['a', 'b'])
  })
})

describe('selectDiagnosticProbes — follow-ups', () => {
  it('re-asks key points already probed in this run, highest weight first', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const core = probes.filter((p) => p.kind === 'core')
    const follow = probes.filter((p) => p.kind === 'follow-up')
    expect(follow).toHaveLength(FOLLOW_UP_COUNT)
    for (const f of follow) {
      expect(core.some((c) => c.klpId === f.klpId)).toBe(true)
    }
  })

  it('places follow-ups last', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    expect(probes.slice(-FOLLOW_UP_COUNT).every((p) => p.kind === 'follow-up')).toBe(true)
  })
})

describe('selectDiagnosticProbes — bounds', () => {
  it('never returns more probes than requested', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 5 })
    expect(probes.length).toBeLessThanOrEqual(5)
  })

  it('caps at the number of key points that exist', () => {
    const klps = corpus().slice(0, 3)
    const probes = selectDiagnosticProbes({ klps, states: [], count: 12 })
    expect(probes.filter((p) => p.kind === 'core')).toHaveLength(3)
  })

  it('returns nothing when there are no key points', () => {
    expect(selectDiagnosticProbes({ klps: [], states: [], count: 12 })).toEqual([])
  })

  it('is deterministic', () => {
    const a = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const b = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    expect(a).toEqual(b)
  })

  it('exposes the floor a diagnostic needs to be worth running', () => {
    expect(MIN_DIAGNOSTIC_KLPS).toBe(12)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/diagnostic/select.test.ts`
Expected: FAIL — module `@/lib/diagnostic/select` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diagnostic/select.ts`:

```ts
import { BKT_PRIOR } from '@/lib/metrics/bkt'

/**
 * How many of a run's questions re-ask a key point already probed in the same
 * run. Matches the floor the old free-text generator was told to hit.
 *
 * Two observations of one key point in one sitting, phrased two ways, is the
 * recognition-versus-production signal at no extra AI cost.
 */
export const FOLLOW_UP_COUNT = 2

/**
 * The fewest live key points a set needs before a diagnostic is worth running.
 *
 * TWELVE, not the generator schema's `.min(8)`: `DiagnosticStartSchema` floors
 * `questionCount` at 12, so a set with 8 key points would cap the count at 8
 * and then fail its own input validation.
 */
export const MIN_DIAGNOSTIC_KLPS = 12

export interface DiagnosticKlpInput {
  id: string
  cardId: string
  /** `CardKlp.index` — the tie-break, so ordering is stable across runs. */
  index: number
  weight: number
}

export interface DiagnosticKlpStateInput {
  klpId: string
  pKnown: number
}

export interface DiagnosticProbe {
  klpId: string
  cardId: string
  kind: 'core' | 'follow-up'
}

/**
 * Choose what a diagnostic asks. Pure, deterministic, and the ONLY place the
 * decision is made.
 *
 * REGIME IS READ OFF THE DATA, NOT CONFIGURED. With no `KlpState` rows for
 * this set the learner has no history here, so the run is a BASELINE and
 * spread is what matters. With history it is TARGETED and priority takes over.
 * A setting would be one more thing to get wrong, and the database already
 * answers the question.
 *
 * Both regimes round-robin across cards: every eligible card contributes a
 * probe before any card contributes a second. In the targeted regime that is
 * the guard against one badly-known card consuming the entire run — a
 * diagnostic that only asks about the thing you already failed tells you
 * nothing you did not know.
 *
 * Never-observed key points need NO special case. `BKT_PRIOR` (0.25) sits
 * below most observed posteriors, so `(1 - pKnown) x weight` floats them
 * naturally — and a point observed once and FAILED outranks an unseen one,
 * which is the correct priority.
 */
export function selectDiagnosticProbes(input: {
  klps: DiagnosticKlpInput[]
  states: DiagnosticKlpStateInput[]
  count: number
}): DiagnosticProbe[] {
  if (input.klps.length === 0 || input.count <= 0) return []

  const pKnownById = new Map(input.states.map((s) => [s.klpId, s.pKnown]))
  const priority = (klp: DiagnosticKlpInput) =>
    (1 - (pKnownById.get(klp.id) ?? BKT_PRIOR)) * klp.weight

  const targeted = input.states.length > 0

  // Group by card, preserving the order cards first appear (callers pass KLPs
  // ordered by card position, then klp index).
  const groups = new Map<string, DiagnosticKlpInput[]>()
  for (const klp of input.klps) {
    const bucket = groups.get(klp.cardId)
    if (bucket) bucket.push(klp)
    else groups.set(klp.cardId, [klp])
  }

  const ordered = [...groups.values()].map((bucket) =>
    [...bucket].sort((a, b) =>
      targeted
        ? priority(b) - priority(a) || b.weight - a.weight || a.index - b.index
        : b.weight - a.weight || a.index - b.index,
    ),
  )

  // In the targeted regime the CARDS are ordered by their best key point too.
  // Without this, a short run visits cards in set order and the targeting is
  // invisible whenever `count` is smaller than the number of cards.
  if (targeted) ordered.sort((a, b) => priority(b[0]) - priority(a[0]))

  const coreCount = Math.max(1, input.count - FOLLOW_UP_COUNT)
  const core: DiagnosticProbe[] = []
  const depth = Math.max(...ordered.map((bucket) => bucket.length))
  outer: for (let round = 0; round < depth; round++) {
    for (const bucket of ordered) {
      const klp = bucket[round]
      if (!klp) continue
      core.push({ klpId: klp.id, cardId: klp.cardId, kind: 'core' })
      if (core.length === coreCount) break outer
    }
  }

  // Follow-ups re-ask what this run already asked — never a fresh key point.
  // Highest weight first, earliest core position as the tie-break.
  const weightById = new Map(input.klps.map((k) => [k.id, k.weight]))
  const followUps = [...core]
    .map((probe, position) => ({ probe, position }))
    .sort((a, b) =>
      (weightById.get(b.probe.klpId) ?? 0) - (weightById.get(a.probe.klpId) ?? 0) ||
      a.position - b.position,
    )
    .slice(0, Math.min(FOLLOW_UP_COUNT, Math.max(0, input.count - core.length)))
    .map(({ probe }) => ({ ...probe, kind: 'follow-up' as const }))

  return [...core, ...followUps]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/diagnostic/select.test.ts`
Expected: PASS, all 12 assertions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diagnostic/select.ts tests/diagnostic/select.test.ts
git commit -m "feat(diagnostic): pure selector for which key points a run probes

Regime is read off the data, not configured: no KlpState for the set means
a baseline run and spread wins; any history means targeted and
(1 - pKnown) x weight takes over. Both round-robin across cards, which is
the guard against one badly-known card consuming the whole run.

Never-observed key points need no special case — BKT_PRIOR sits below most
observed posteriors, so a failed point correctly outranks an unseen one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 7: Extract `createAnswerWithAnalysis` into a shared, transaction-aware writer

It holds the KLP-state locking discipline, the supersede-and-replay rule and the `CardProgress` recompute. A second copy for the diagnostic is how two posteriors start disagreeing. It also cannot be exported from `src/actions/quiz.ts` at all — a `'use server'` module may only export async functions, and moving it out shrinks a 1,773-line file.

**Files:**
- Create: `src/lib/analysis/write-answer.ts`
- Modify: `src/actions/quiz.ts:807-965` (delete the function and `ANALYSIS_TX_OPTIONS`, import them instead)
- Test: `tests/analysis/write-answer.test.ts`

**Interfaces:**
- Consumes: `AnalysisWrites`, `ANALYSIS_VERSION` from `@/lib/analysis/persist`; `persistKlpStates`, `rebuildKlpStates`, `lockKlpStates` from `@/lib/metrics/state-writer`; `recomputeCardProgress` from `@/lib/memory/recompute`.
- Produces:
  ```ts
  export const ANALYSIS_TX_OPTIONS: { maxWait: number; timeout: number }
  export const DIAGNOSTIC_TX_OPTIONS: { maxWait: number; timeout: number }
  export async function createAnswerWithAnalysis(
    answerData: Prisma.QuizAnswerUncheckedCreateInput,
    writes: AnalysisWrites,
    replace?: { attemptId: string; cardId: string; mode: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; createdAt: Date }>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/analysis/write-answer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ANALYSIS_TX_OPTIONS, DIAGNOSTIC_TX_OPTIONS, createAnswerWithAnalysis,
} from '@/lib/analysis/write-answer'

describe('write-answer module', () => {
  it('exports the shared writer so the diagnostic cannot grow a second one', () => {
    expect(typeof createAnswerWithAnalysis).toBe('function')
  })

  it('sizes the diagnostic transaction for a whole sitting, not one answer', () => {
    // Quiz writes ONE answer per transaction; a diagnostic writes twelve, each
    // costing a serialized advisory lock + read + write per key point. A P2028
    // here does not degrade — it discards a test the learner just spent twenty
    // minutes on.
    expect(DIAGNOSTIC_TX_OPTIONS.timeout).toBeGreaterThan(ANALYSIS_TX_OPTIONS.timeout)
    expect(ANALYSIS_TX_OPTIONS).toEqual({ maxWait: 10_000, timeout: 30_000 })
  })

  it('accepts a caller-supplied transaction client', () => {
    // Arity check: (answerData, writes, replace, tx). The diagnostic composes
    // twelve of these inside ONE transaction so a mid-loop failure rolls the
    // whole sitting back rather than leaving half a graded test behind.
    expect(createAnswerWithAnalysis.length).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analysis/write-answer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Move the function**

Create `src/lib/analysis/write-answer.ts`. Copy `createAnswerWithAnalysis` and `ANALYSIS_TX_OPTIONS` **verbatim** from `src/actions/quiz.ts:774-965`, including every doc comment — those comments record real bugs (the double-counted posterior, the silently-unstarred card) and must travel with the code. Then apply exactly three changes:

1. Add the imports at the top:

```ts
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { ANALYSIS_VERSION, type AnalysisWrites } from '@/lib/analysis/persist'
import { persistKlpStates, rebuildKlpStates, lockKlpStates } from '@/lib/metrics/state-writer'
import { recomputeCardProgress } from '@/lib/memory/recompute'
```

2. Export both, and add the `tx` parameter, following the `recordStudyEvent` pattern (`src/lib/memory/record.ts`) — the body already lives in a closure named `run`:

```ts
export const ANALYSIS_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/**
 * A whole diagnostic sitting, not one answer.
 *
 * `submitDiagnosticTest` composes ~12 `createAnswerWithAnalysis` calls inside
 * ONE transaction so a mid-loop failure rolls the sitting back rather than
 * leaving half a graded test behind. Each answer costs a serialized advisory
 * lock, a read and a write per key point, so the per-answer ceiling above is
 * an order of magnitude too small here — and a P2028 does not degrade, it
 * discards twenty minutes of the learner's work.
 */
export const DIAGNOSTIC_TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 };

export async function createAnswerWithAnalysis(
  answerData: Prisma.QuizAnswerUncheckedCreateInput,
  writes: AnalysisWrites,
  replace?: { attemptId: string; cardId: string; mode: string },
  tx?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    // ...the existing body, unchanged, with `tx` already in scope...
  }
  return tx ? run(tx) : prisma.$transaction(run, ANALYSIS_TX_OPTIONS)
}
```

3. In `src/actions/quiz.ts`, delete the moved code and add:

```ts
import { createAnswerWithAnalysis, ANALYSIS_TX_OPTIONS } from '@/lib/analysis/write-answer';
```

Remove any now-unused imports from `quiz.ts` (`persistKlpStates`, `rebuildKlpStates`, `lockKlpStates`, `recomputeCardProgress`) **only if nothing else in the file uses them** — check with `grep -n` before deleting; `ANALYSIS_TX_OPTIONS` is used elsewhere in `quiz.ts`.

- [ ] **Step 4: Verify nothing changed behaviourally**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: full suite passes (2770+), tsc clean, lint at 164 warnings. This is a pure move — **any** quiz test failing means the move was not verbatim.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/write-answer.ts src/actions/quiz.ts tests/analysis/write-answer.test.ts
git commit -m "refactor(analysis): extract createAnswerWithAnalysis into a shared writer

Pure move plus an optional tx parameter, matching recordStudyEvent. It
holds the KLP-state locking discipline, the supersede-and-replay rule and
the CardProgress recompute; the diagnostic is about to need all three, and
a second copy is how two posteriors start disagreeing. A 'use server'
module could not have exported it anyway.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 8: Prompts and schemas v2 — the model stops inventing learning points

**Files:**
- Modify: `src/lib/ai/schemas.ts:142-179`
- Modify: `src/lib/ai/prompts/diagnostic.ts`
- Test: `tests/ai/diagnostic-prompts.test.ts` (create)

**Interfaces:**
- Consumes: `KLP_STATUSES` (`@/lib/errors/klp-credit`), `DIMENSIONS` and `MAX_TAGS_PER_ANSWER` (`@/lib/errors/taxonomy`) — both already imported by `schemas.ts` for `ShortAnswerGradeSchema`.
- Produces: `DiagnosticQuestionSetSchema` keyed on `probeRef`; `DiagnosticGradeSetSchema` carrying `klpResults`/`errorTags`; all three prompt objects at `version: 2`.

- [ ] **Step 1: Write the failing test**

Create `tests/ai/diagnostic-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DIAGNOSTIC_QUESTIONS_PROMPT, DIAGNOSTIC_GRADING_PROMPT, DIAGNOSTIC_REPORT_PROMPT,
} from '@/lib/ai/prompts/diagnostic'
import { DiagnosticQuestionSetSchema, DiagnosticGradeSetSchema } from '@/lib/ai/schemas'

describe('DIAGNOSTIC_QUESTIONS_PROMPT v2', () => {
  it('is version 2', () => {
    expect(DIAGNOSTIC_QUESTIONS_PROMPT.version).toBe(2)
  })

  it('shows the key point and asks for one question per probe', () => {
    const prompt = DIAGNOSTIC_QUESTIONS_PROMPT.build({
      setTitle: 'LBO',
      probes: [{
        probeRef: 0, kind: 'core', term: 'IRR', definition: 'internal rate of return',
        keyPoint: 'IRR is the discount rate at which NPV equals zero.',
      }],
    })
    expect(prompt).toContain('IRR is the discount rate at which NPV equals zero.')
    expect(prompt).toContain('[0]')
  })

  it('no longer accepts a model-invented learning point', () => {
    const parsed = DiagnosticQuestionSetSchema.safeParse({
      questions: [{ probeRef: 0, question: 'q', expectedAnswer: 'a' }],
    })
    expect(parsed.success).toBe(true)
    // A response shaped like v1 must be rejected, not silently coerced.
    expect(DiagnosticQuestionSetSchema.safeParse({
      questions: [{ cardRef: 0, kind: 'core', learningPoint: 'lp', question: 'q', expectedAnswer: 'a' }],
    }).success).toBe(false)
  })
})

describe('DIAGNOSTIC_GRADING_PROMPT v2', () => {
  it('is version 2', () => {
    expect(DIAGNOSTIC_GRADING_PROMPT.version).toBe(2)
  })

  it('accepts per-key-point verdicts and error tags', () => {
    const parsed = DiagnosticGradeSetSchema.safeParse({
      grades: [{
        questionRef: 0, score: 6, status: 'partial', feedback: 'ok',
        klpResults: [{ klpRef: 0, status: 'partial', evidence: 'said half of it' }],
        errorTags: [{ dimension: 'accuracy', type: 'omission', klpRef: 0, magnitude: 5 }],
      }],
    })
    expect(parsed.success).toBe(true)
  })

  it('still parses a grade with no per-key-point verdicts, so the caller can force no_provenance', () => {
    const parsed = DiagnosticGradeSetSchema.safeParse({
      grades: [{ questionRef: 0, score: 6, status: 'partial', feedback: 'ok' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('never lets the model supply a score for a key point — only a category', () => {
    expect(DiagnosticGradeSetSchema.safeParse({
      grades: [{ questionRef: 0, score: 6, status: 'partial', feedback: 'ok',
        klpResults: [{ klpRef: 0, status: 0.5 }] }],
    }).success).toBe(false)
  })
})

describe('DIAGNOSTIC_REPORT_PROMPT v2', () => {
  it('is version 2', () => {
    expect(DIAGNOSTIC_REPORT_PROMPT.version).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/diagnostic-prompts.test.ts`
Expected: FAIL — versions are 1, `build` takes `cards` not `probes`, `probeRef` is unknown.

- [ ] **Step 3: Write the implementation**

In `src/lib/ai/schemas.ts`, replace the two diagnostic schemas (leave `DiagnosticReportSchema` unchanged):

```ts
/**
 * v2: the model no longer picks a card or invents a `learningPoint`. Both come
 * from the probe the pure selector chose (src/lib/diagnostic/select.ts), and
 * `probeRef` is the index into the prompt's probe list.
 */
export const DiagnosticQuestionSetSchema = z.object({
  questions: z.array(z.object({
    probeRef: z.number().int().min(0),
    question: z.string().trim().min(1).max(1200),
    expectedAnswer: z.string().trim().min(1).max(1600),
  })).min(1).max(40),
}).strict();

export type DiagnosticQuestionSet = z.infer<typeof DiagnosticQuestionSetSchema>;

/**
 * v2: the same per-answer analysis contract `ShortAnswerGradeSchema` defines,
 * so `buildAnalysisWrites` computes credit and significance in TypeScript from
 * a categorical status and a 1-10 magnitude. The model's ONLY numbers are the
 * 1-10 question score and the tag magnitude; it never scores a key point.
 *
 * `klpResults` is optional so a grader that returns none still PARSES — the
 * caller turns that into `analysisStatus: 'no_provenance'` rather than
 * pretending the answer was clean.
 */
export const DiagnosticGradeSetSchema = z.object({
  grades: z.array(z.object({
    questionRef: z.number().int().min(0),
    score: z.number().int().min(1).max(10),
    status: z.enum(['mastered', 'partial', 'missed']),
    feedback: z.string().trim().min(1).max(1200),
    mistake: z.string().trim().max(800).optional(),
    klpResults: z.array(z.object({
      klpRef: z.number().int().min(0),
      status: z.enum(KLP_STATUSES),
      evidence: z.string().optional(),
    })).optional(),
    errorTags: z.array(z.object({
      dimension: z.enum(DIMENSIONS),
      type: z.string().min(1),
      klpRef: z.number().int().min(0).optional(),
      secondaryKlpRef: z.number().int().min(0).optional(),
      magnitude: z.number().int().min(1).max(10),
      quote: z.string().optional(),
    })).max(MAX_TAGS_PER_ANSWER).optional(),
  })).min(1).max(40),
});

export type DiagnosticGradeSet = z.infer<typeof DiagnosticGradeSetSchema>;
```

> Confirm `KLP_STATUSES`, `DIMENSIONS` and `MAX_TAGS_PER_ANSWER` are already imported at the top of `schemas.ts` (they are, for `ShortAnswerGradeSchema`). Do not add duplicate imports.

Replace `src/lib/ai/prompts/diagnostic.ts` wholesale:

```ts
import {
  DiagnosticGradeSetSchema,
  DiagnosticQuestionSetSchema,
  DiagnosticReportSchema,
} from '@/lib/ai/schemas';

export interface DiagnosticProbePromptInput {
  probeRef: number;
  kind: 'core' | 'follow-up';
  term: string;
  definition: string;
  /** `CardKlp.text` — the proposition this question must test, and only this. */
  keyPoint: string;
}

export interface DiagnosticQuestionsBuildInput {
  setTitle: string;
  probes: DiagnosticProbePromptInput[];
}

export interface DiagnosticGradingBuildInput {
  questions: Array<{
    ref: number;
    question: string;
    expectedAnswer: string;
    keyPoint: string;
    answer: string;
  }>;
}

export interface DiagnosticReportBuildInput {
  setTitle: string;
  results: Array<{
    question: string;
    keyPoint: string;
    answer: string;
    score: number;
    status: string;
    mistake?: string;
  }>;
}

export const DIAGNOSTIC_QUESTIONS_PROMPT = {
  id: 'diagnostic-questions',
  version: 2,
  schema: DiagnosticQuestionSetSchema,
  build(input: DiagnosticQuestionsBuildInput): string {
    return `You are writing a rigorous diagnostic test for ${input.setTitle}.

Each numbered probe below names ONE key point the learner is supposed to hold. Write exactly one question per probe, in the same order, and return it with that probe's number.

Rules:
- The question must test THAT key point and nothing else. Do not widen it to the rest of the card.
- The expected answer must be answerable from the key point alone.
- Do not invent facts beyond the card text supplied.
- A probe marked follow-up asks the SAME key point from a different angle than a plain question would — apply it, or probe the misunderstanding a learner who half-knows it would have. Do not simply rephrase.
- Return one entry per probeRef. No extra entries, no missing entries.

Probes:
${input.probes.map((probe) => `[${probe.probeRef}] (${probe.kind})\nKey point: ${probe.keyPoint}\nFrom card — Term: ${probe.term}\nDefinition: ${probe.definition}`).join('\n\n')}`;
  },
};

export const DIAGNOSTIC_GRADING_PROMPT = {
  id: 'diagnostic-grading',
  version: 2,
  schema: DiagnosticGradeSetSchema,
  build(input: DiagnosticGradingBuildInput): string {
    return `Grade every diagnostic response against its key point and expected answer.

Score 1-10: mastered is 8-10, partial 5-7, missed 1-4. Name the specific misconception or omission when an answer is partial or missed. Do not reward an answer that merely repeats the question. Return exactly one grade per questionRef and never invent a response that was not given.

For EACH question also return:
- klpResults: exactly one entry, klpRef 0, judging the key point that question tested. passed = the learner holds it; partial = half-held or hedged; failed = absent or wrong. Judge ONLY that key point — you are not being asked about anything else the card teaches.
- errorTags: what went wrong, if anything. magnitude is 1-10 for how bad THIS instance is within its type. Omit the array entirely for a clean answer.

Questions and responses:
${input.questions.map((item) => `[${item.ref}] Key point [0]: ${item.keyPoint}\nQuestion: ${item.question}\nExpected answer: ${item.expectedAnswer}\nLearner answer: ${item.answer || '[no answer]'}`).join('\n\n')}`;
  },
};

export const DIAGNOSTIC_REPORT_PROMPT = {
  id: 'diagnostic-report',
  version: 2,
  schema: DiagnosticReportSchema,
  build(input: DiagnosticReportBuildInput): string {
    return `Turn the completed diagnostic test for ${input.setTitle} into an immediate learning plan.

Summarize what the learner knows, the highest-value gaps, and concrete next recommendations. Group repeated mistakes by key point. Recommendations must be actionable inside a study app (review, rewrite, practice, or revisit a concept). Do not claim a gap without evidence in the results. Return structured JSON with overview, strengths, gaps, recommendations, and learningPoints.

Results:
${input.results.map((item) => `Key point: ${item.keyPoint}\nQuestion: ${item.question}\nAnswer: ${item.answer || '[no answer]'}\nScore: ${item.score}/10 (${item.status})\nMistake: ${item.mistake || 'none noted'}`).join('\n\n')}`;
  },
};
```

Update the type re-exports in `src/lib/ai/prompts/registry.ts:42` to include `DiagnosticProbePromptInput`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai/ && npx tsc --noEmit`
Expected: the new prompt tests PASS. `tsc` will report errors in `src/actions/diagnostic.ts` — it still calls the v1 builders. That is expected and is Task 9's job.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/diagnostic.ts src/lib/ai/prompts/registry.ts tests/ai/diagnostic-prompts.test.ts
git commit -m "feat(ai): diagnostic prompts v2 — questions come from key points

The generator no longer picks a card or invents a learningPoint; it is
handed one CardKlp per probe and writes one question for it. The grader
returns the same klpResults/errorTags contract short answer uses, so
credit and significance are computed in TypeScript from a categorical
status and a 1-10 magnitude.

src/actions/diagnostic.ts does not compile against these yet — Task 9.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 9: `startDiagnosticTest` — probes in, `QuizAttempt` out

**Files:**
- Modify: `src/actions/diagnostic.ts` (`startDiagnosticTest`, ~lines 133-243)
- Test: `tests/actions/diagnostic-start.test.ts` (create)

**Interfaces:**
- Consumes: `selectDiagnosticProbes`, `MIN_DIAGNOSTIC_KLPS` (Task 6); `DIAGNOSTIC_QUESTIONS_PROMPT` v2 (Task 8); the schema from Task 5.
- Produces: an attempt with `engineVersion: 2`, one `DiagnosticQuestion` per probe carrying `klpId` and `learningPoint = klp.text`, and a sibling `QuizAttempt` on the same `StudySession`.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/diagnostic-start.test.ts`. Follow the mocking style already used by the other files in `tests/actions/` (mock `@/auth` and `@/lib/db`; read a neighbouring file first and copy its harness rather than inventing one). Assert:

```ts
it('refuses a set with fewer than MIN_DIAGNOSTIC_KLPS live key points', async () => {
  // 11 key points. Below the floor, Start must refuse and write NOTHING —
  // a thin diagnostic is worse than none, and it would fail questionCount
  // validation anyway.
  const result = await startDiagnosticTest({ setId: 's1', questionCount: 12 })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/key point/i)
  expect(prisma.diagnosticAttempt.create).not.toHaveBeenCalled()
})

it('never calls ensureKlpsReady — that would fire extraction per card', async () => {
  await startDiagnosticTest({ setId: 's1', questionCount: 12 })
  expect(ensureKlpsReady).not.toHaveBeenCalled()
})

it('caps the question count at the number of live key points', async () => { /* 15 KLPs, count 30 -> 15 probes */ })

it('rejects a generator response naming an unknown probeRef', async () => { /* nothing persisted */ })

it('rejects a generator response missing a probeRef it was given', async () => { /* nothing persisted */ })

it('stores the key point text on the question as it was at ask time', async () => {
  // learningPoint is now a denormalised copy of CardKlp.text. Editing a card
  // supersedes its KLPs; the question must still render what was asked.
})

it('creates a QuizAttempt on the SAME StudySession as the DiagnosticAttempt', async () => {
  // Load-bearing for erasure: "forget this set" reaches sessions by setId and
  // both attempts must cascade together.
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/diagnostic-start.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `startDiagnosticTest`**

Replace the body between the set lookup and the `prisma.$transaction`:

```ts
    const set = await prisma.set.findFirst({
      where: { id: parsed.data.setId, ...readableSetWhere(session.user.id) },
      select: { id: true, title: true },
    })
    if (!set) return { success: false, error: 'That study set is not available' }

    // ONE query for the whole set's live key points. Deliberately NOT
    // `ensureKlpsReady` per card: that gap-fills by invoking AI extraction, so
    // across a 120-card set pressing Start would fire a burst of calls against
    // a free tier capped at 20 requests per day per model.
    const klps = await prisma.cardKlp.findMany({
      where: { card: { setId: set.id }, supersededAt: null },
      orderBy: [{ card: { position: 'asc' } }, { index: 'asc' }],
      select: {
        id: true, cardId: true, index: true, text: true, weight: true,
        card: { select: { term: true, definition: true } },
      },
    })
    if (klps.length < MIN_DIAGNOSTIC_KLPS) {
      return {
        success: false,
        error: `This set has ${klps.length} key point${klps.length === 1 ? '' : 's'}. A diagnostic needs at least ${MIN_DIAGNOSTIC_KLPS}. Open the set and let its key points finish extracting, then try again.`,
      }
    }

    const states = await prisma.klpState.findMany({
      where: { userId: session.user.id, klpId: { in: klps.map((k) => k.id) } },
      select: { klpId: true, pKnown: true },
    })

    const questionCount = Math.min(parsed.data.questionCount, klps.length)
    const probes = selectDiagnosticProbes({
      klps: klps.map((k) => ({ id: k.id, cardId: k.cardId, index: k.index, weight: k.weight })),
      states,
      count: questionCount,
    })
    const klpById = new Map(klps.map((k) => [k.id, k]))

    const generated = await generateJson({
      userId: session.user.id,
      task: 'diagnostic',
      prompt: DIAGNOSTIC_QUESTIONS_PROMPT.build({
        setTitle: set.title,
        probes: probes.map((probe, probeRef) => {
          const klp = klpById.get(probe.klpId)!
          return {
            probeRef,
            kind: probe.kind,
            term: klp.card.term,
            definition: klp.card.definition,
            keyPoint: klp.text,
          }
        }),
      }),
      schema: DIAGNOSTIC_QUESTIONS_PROMPT.schema,
    })
    const questionSet = DiagnosticQuestionSetSchema.parse(generated)

    // Same shape of check the v1 `cardRef` validation used. An unknown or
    // duplicated ref means the generator did not answer the probes it was
    // given, and a partial run would silently drop key points from the test.
    const byRef = new Map(questionSet.questions.map((q) => [q.probeRef, q]))
    const complete =
      byRef.size === questionSet.questions.length &&
      probes.every((_, ref) => byRef.has(ref)) &&
      questionSet.questions.every((q) => q.probeRef < probes.length)
    if (!complete) {
      return { success: false, error: 'The diagnostic generator returned an incomplete question set. Please try again.' }
    }

    const questions = probes.map((probe, probeRef) => {
      const klp = klpById.get(probe.klpId)!
      const generatedQuestion = byRef.get(probeRef)!
      return {
        cardId: probe.cardId,
        klpId: probe.klpId,
        position: probeRef,
        kind: probe.kind,
        // Denormalised from CardKlp.text AT ASK TIME. Editing a card supersedes
        // its KLPs; the question must still render what was actually asked.
        learningPoint: klp.text,
        prompt: generatedQuestion.question,
        expectedAnswer: generatedQuestion.expectedAnswer,
      }
    })
```

Then extend the transaction to create the sibling `QuizAttempt` and stamp `engineVersion`:

```ts
    const created = await prisma.$transaction(async (tx) => {
      const studySession = await tx.studySession.create({
        data: { userId: session.user!.id, setId: set.id, kind: 'diagnostic', itemCount: questions.length },
      })
      // The anchor AnswerKlpResult's required FK needs (spec §3.1 D1), sharing
      // the diagnostic's session so "forget this set" — which reaches sessions
      // by setId — cascades both halves together (D2).
      await tx.quizAttempt.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          mode: 'diagnostic',
          sessionId: studySession.id,
          questionCount: questions.length,
        },
      })
      const attempt = await tx.diagnosticAttempt.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          sessionId: studySession.id,
          questionCount: questions.length,
          engineVersion: 2,
          questions: { create: questions },
        },
        include: { questions: { orderBy: { position: 'asc' }, select: { id: true } } },
      })
      return attempt
    })
```

The returned `questions` array maps unchanged. Add the imports:

```ts
import { selectDiagnosticProbes, MIN_DIAGNOSTIC_KLPS } from '@/lib/diagnostic/select'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actions/diagnostic-start.test.ts && npx tsc --noEmit`
Expected: start tests PASS. `tsc` may still flag `submitDiagnosticTest` (Task 10).

- [ ] **Step 5: Commit**

```bash
git add src/actions/diagnostic.ts tests/actions/diagnostic-start.test.ts
git commit -m "feat(diagnostic): build questions from real key points

A run now selects live CardKlp rows with the pure selector, hands them to
the v2 generator one probe at a time, and stores klpId on every question.
Reads the set's key points in ONE query rather than calling
ensureKlpsReady per card, which would fire AI extraction for every gap the
moment somebody pressed Start.

Creates the sibling QuizAttempt on the same StudySession, so erasure
reaches both halves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 10: `submitDiagnosticTest` — write the evidence

The task the whole plan exists for.

**Files:**
- Modify: `src/actions/diagnostic.ts` (`submitDiagnosticTest`, ~lines 245-400)
- Test: `tests/actions/diagnostic-submit.test.ts` (create)

**Interfaces:**
- Consumes: `createAnswerWithAnalysis`, `DIAGNOSTIC_TX_OPTIONS` (Task 7); `buildAnalysisWrites` (`@/lib/analysis/persist`); `DIAGNOSTIC_GRADING_PROMPT` v2 (Task 8).
- Produces: per question — a `QuizAnswer` (`mode: 'diagnostic'`), an `AnswerKlpResult`, a stepped `KlpState`, and a `StudyEvent` carrying `quizAnswerId`.

- [ ] **Step 1: Write the failing tests**

Create `tests/actions/diagnostic-submit.test.ts`, same harness as Task 9:

```ts
it('writes one QuizAnswer per question, in diagnostic mode', async () => { /* 12 in, 12 created, every mode === 'diagnostic' */ })

it('credits only the key point the question asked', async () => {
  // The card has 4 live key points; the question was anchored to one. Exactly
  // one AnswerKlpResult may be written. Crediting the other three would be a
  // fabricated observation, indistinguishable from a real one once stored.
  expect(writes.klpResults).toHaveLength(1)
})

it('records no_provenance when the grader returned no key-point verdict', async () => {
  // Not silence. A relational tag table cannot tell "analyzed and clean" from
  // "could not analyze" — both are zero rows — and Spec 3's error rates need a
  // denominator of ANALYZED answers.
  expect(created.analysisStatus).toBe('no_provenance')
})

it('links every StudyEvent to its QuizAnswer', async () => {
  // Today's diagnostic writes StudyEvent with no quizAnswerId, so erasing the
  // answer leaves the event behind.
  expect(recordStudyEvent).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'diagnostic', quizAnswerId: expect.any(String) }),
    expect.anything(),
  )
})

it('sets DiagnosticQuestion.quizAnswerId', async () => { /* every question linked */ })

it('rejects a grade set with an unknown or missing questionRef and persists nothing', async () => { /* existing guard, still enforced */ })

it('rolls the whole sitting back if one answer fails to write', async () => {
  // A half-graded diagnostic is worse than a failed one: the learner cannot
  // tell which half counted.
})

it('refuses to submit an abandoned attempt', async () => { /* status !== 'in_progress' */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/diagnostic-submit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the submit path**

Load the anchored key points' weights alongside the attempt:

```ts
    const attempt = await prisma.diagnosticAttempt.findFirst({
      where: { id: parsed.data.attemptId, userId: session.user.id },
      include: {
        set: { select: { title: true } },
        session: { select: { startedAt: true } },
        questions: { orderBy: { position: 'asc' } },
      },
    })
    if (!attempt) return { success: false, error: 'Diagnostic test not found' }
    if (attempt.status !== 'in_progress') return { success: false, error: 'This diagnostic has already been submitted' }

    const anchorIds = attempt.questions.map((q) => q.klpId).filter((id): id is string => id !== null)
    const anchors = new Map(
      (await prisma.cardKlp.findMany({
        where: { id: { in: anchorIds } },
        select: { id: true, weight: true },
      })).map((k) => [k.id, k]),
    )
    // `starred` is an input to significance and must be read AS OF THIS ANSWER.
    const progressRows = await prisma.cardProgress.findMany({
      where: { userId: session.user.id, cardId: { in: attempt.questions.map((q) => q.cardId) } },
      select: { cardId: true, starred: true },
    })
    const starredByCard = new Map(progressRows.map((p) => [p.cardId, p.starred]))
    // The sibling created at start. Absent only for a pre-migration attempt,
    // which cannot reach here — those were marked abandoned.
    const quizAttempt = await prisma.quizAttempt.findFirst({
      where: { sessionId: attempt.sessionId, mode: 'diagnostic' },
      select: { id: true },
    })
    if (!quizAttempt) return { success: false, error: 'This diagnostic cannot be scored. Please start a new one.' }
```

Build the grading prompt from `keyPoint: question.learningPoint` (the denormalised text, so a superseded KLP still grades against what was asked) and keep the existing completeness guard on `questionRef` verbatim.

Then replace the persistence transaction:

```ts
    await prisma.$transaction(async (tx) => {
      for (const item of graded) {
        const anchorId = item.question.klpId
        const anchor = anchorId ? anchors.get(anchorId) : undefined
        const klps = anchor ? [{ id: anchor.id, weight: anchor.weight }] : []
        // Empty klpResults on a question that HAD an anchor means the grader
        // did not do the per-key-point judgment it was asked for — never a
        // legitimately clean grade. Same rule short answer uses.
        const forcedStatus =
          klps.length > 0 && (item.grade.klpResults ?? []).length === 0
            ? ('no_provenance' as const)
            : undefined

        const writes = buildAnalysisWrites({
          mode: 'diagnostic',
          klps,
          starred: starredByCard.get(item.question.cardId) ?? false,
          klpResults: item.grade.klpResults ?? [],
          errorTags: (item.grade.errorTags ?? []) as ErrorTagDraft[],
          forcedStatus,
        })

        const answer = await createAnswerWithAnalysis(
          {
            attemptId: quizAttempt.id,
            userId: session.user!.id,
            cardId: item.question.cardId,
            mode: 'diagnostic',
            prompt: item.question.prompt,
            answer: item.answer,
            correctAnswer: item.question.expectedAnswer,
            score: item.score * 10,
            isCorrect: item.score >= 8,
            latencyMs: normalizeLatency(item.latencyMs),
            feedback: item.feedback,
            grade: { ...item.grade, promptVersion: DIAGNOSTIC_GRADING_PROMPT.version },
          },
          writes,
          // No `replace`: a diagnostic question is answered exactly once.
          undefined,
          tx,
        )

        await tx.diagnosticQuestion.update({
          where: { id: item.question.id },
          data: {
            answer: item.answer,
            score: item.score,
            status: item.status,
            feedback: item.feedback,
            mistake: item.mistake,
            latencyMs: item.latencyMs ?? null,
            answeredAt: completedAt,
            quizAnswerId: answer.id,
          },
        })

        await recordStudyEvent({
          userId: session.user!.id,
          cardId: item.question.cardId,
          source: 'diagnostic',
          sessionId: attempt.sessionId,
          // NEW. Without it, erasing the answer leaves the event behind and
          // the two records disagree about what happened.
          quizAnswerId: answer.id,
          outcome: { overall: item.score },
          meta: { latencyMs: item.latencyMs },
        }, tx)
      }

      await tx.quizAttempt.update({ where: { id: quizAttempt.id }, data: { score } })
      await tx.diagnosticAttempt.update({
        where: { id: attempt.id },
        data: { status: 'completed', score, report, reportAt: completedAt, completedAt },
      })
      await tx.studySession.update({ where: { id: attempt.sessionId }, data: { endedAt: completedAt, durationMs } })
    }, DIAGNOSTIC_TX_OPTIONS)
```

`graded` must now carry the full `grade` object (it currently destructures only `score`/`feedback`/`mistake`) — add `grade` to the mapped item. Add imports:

```ts
import { buildAnalysisWrites, type ErrorTagDraft } from '@/lib/analysis/persist'
import { createAnswerWithAnalysis, DIAGNOSTIC_TX_OPTIONS } from '@/lib/analysis/write-answer'
import { normalizeLatency } from '@/lib/memory/latency'
```

Also add `revalidatePath('/profile/learner')` alongside the existing revalidations, since key-point mastery now moves.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: full suite passes, tsc clean, lint at 164.

- [ ] **Step 5: Commit**

```bash
git add src/actions/diagnostic.ts tests/actions/diagnostic-submit.test.ts
git commit -m "feat(diagnostic): write key-point evidence on submit

Every graded answer now becomes a QuizAnswer written by the same
createAnswerWithAnalysis the quiz uses, so AnswerKlpResult, AnswerErrorTag
and KlpState all follow. StudyEvent finally carries quizAnswerId, so
erasing an answer takes its event with it.

Only the key point the question actually asked is credited. A grader that
returns no verdict records no_provenance rather than silence — zero rows
cannot otherwise be told apart from a clean answer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 11: A place to look back — past attempts, and the legacy label

There is currently **no** way to view a past diagnostic: no `/diagnostic/[id]` route and no history list, so the completed attempt's stored report renders nowhere. The approved "label it honestly" decision has no surface without this.

**Files:**
- Create: `src/components/diagnostic/DiagnosticAttemptView.tsx`
- Create: `src/app/(app)/diagnostic/[attemptId]/page.tsx`
- Modify: `src/components/diagnostic/DiagnosticClient.tsx` (results phase renders the shared view; setup phase lists past attempts)
- Modify: `src/actions/diagnostic.ts` (add `getDiagnosticHistory`, `getDiagnosticAttempt`)

**Interfaces:**
- Consumes: `DiagnosticResult` (existing), `engineVersion` (Task 5).
- Produces:
  ```ts
  export interface DiagnosticHistoryItem {
    id: string; setTitle: string; score: number | null;
    completedAt: Date; questionCount: number; engineVersion: number;
  }
  export async function getDiagnosticHistory(): Promise<ActionResult<DiagnosticHistoryItem[]>>
  export async function getDiagnosticAttempt(attemptId: string): Promise<ActionResult<DiagnosticResult & { engineVersion: number }>>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/actions/diagnostic-history.test.ts`:

```ts
it('lists only completed attempts, newest first', async () => {
  // Abandoned and in-flight attempts are not results and must not be listed.
  expect(prisma.diagnosticAttempt.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ status: 'completed' }) }),
  )
})

it('only ever returns the signed-in user\'s own attempts', async () => {
  // A diagnostic is personal study data — the same rule attempts already
  // follow, not the open-by-id rule sets follow.
  expect(prisma.diagnosticAttempt.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
  )
})

it('refuses another user\'s attempt by id', async () => {
  const result = await getDiagnosticAttempt('someone-elses')
  expect(result.success).toBe(false)
})

it('carries engineVersion through, so the caller can label a pre-key-point run', async () => {
  const result = await getDiagnosticAttempt('a1')
  expect(result.success && result.data.engineVersion).toBe(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/diagnostic-history.test.ts`
Expected: FAIL — the actions do not exist.

- [ ] **Step 3: Implement**

Add both actions to `src/actions/diagnostic.ts`, scoped `where: { userId: session.user.id }` on every read (a diagnostic is personal study data — the rule attempts follow, not the open-by-id rule sets follow), and `status: 'completed'` on the list.

Extract the results markup currently inline in `DiagnosticClient.tsx` (the score header, the report sections, and the question review list) into `src/components/diagnostic/DiagnosticAttemptView.tsx`:

```tsx
export function DiagnosticAttemptView({ result, engineVersion }: {
  result: DiagnosticResult
  engineVersion: number
}) {
  return (
    <div className="space-y-8">
      {engineVersion < 2 && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 text-sm leading-6 dark:border-amber-200/20 dark:bg-amber-200/5">
          <p className="font-semibold">This diagnostic ran before key-point tracking.</p>
          <p className="mt-1 text-muted-foreground">
            It moved your confidence on the cards it tested, but not your key-point mastery —
            its questions were not tied to the specific points behind each card. Nothing has been
            guessed after the fact.{' '}
            <Link href="/diagnostic" className="underline underline-offset-2">Run a fresh one</Link>{' '}
            to have it count.
          </p>
        </div>
      )}
      {/* ...the existing results markup, moved verbatim... */}
    </div>
  )
}
```

`DiagnosticClient` renders `<DiagnosticAttemptView result={result} engineVersion={2} />` in its results phase, and lists past attempts on the setup screen — each linking to `/diagnostic/[attemptId]`, with a muted "not linked to key points" note on `engineVersion < 2` rows.

`src/app/(app)/diagnostic/[attemptId]/page.tsx` is a server component: `auth()`, `getDiagnosticAttempt`, `notFound()` on failure, then `<DiagnosticAttemptView />`.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS, tsc clean, lint at 164.

- [ ] **Step 5: Commit**

```bash
git add src/components/diagnostic/ "src/app/(app)/diagnostic/" src/actions/diagnostic.ts tests/actions/diagnostic-history.test.ts
git commit -m "feat(diagnostic): past attempts, and an honest label on pre-key-point runs

There was no way to view a finished diagnostic at all — the stored report
rendered nowhere. Adds a history list and a read-only attempt view, which
is also where the engineVersion 1 banner lives: that run moved card
confidence but not key-point mastery, and nothing was guessed after the
fact to make it look otherwise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Task 12: Live verification, then open the gate

The gate comes off **last**, and only after a real run. A green suite has gone over a statement Postgres rejects in this repo before.

**Files:**
- Create: `scripts/verify-diagnostic.ts` + `package.json` script `verify:diagnostic`
- Modify: `src/app/(app)/diagnostic/page.tsx` (remove the `isAdmin` gate)
- Modify: `docs/superpowers/BUILD-QUEUE.md`

- [ ] **Step 1: Write the read-only verification script**

Create `scripts/verify-diagnostic.ts` — read-only, safe against production, following `scripts/klp-histogram.ts`'s style. Given an attempt id it prints and checks:

```
questions                    N
QuizAnswer (mode diagnostic) N          must equal questions
AnswerKlpResult              N          exactly one per anchored question
KlpState touched             distinct anchors
StudyEvent (diagnostic)      N          all with quizAnswerId set
analysisStatus breakdown     analyzed / no_provenance / no_klps / failed
questions with klpId null    0
questions with quizAnswerId  N
```

Exit non-zero if any equality fails.

- [ ] **Step 2: Predict the numbers in writing, then run a real diagnostic**

Write the expected numbers into the run's notes **before** looking. For a 12-question run on `Accounting - "Talking"`: `12 questions, 12 QuizAnswer, 12 AnswerKlpResult, ≤12 distinct KlpState (follow-ups re-ask a point, so expect 10–11), 12 StudyEvent all linked, 0 null klpId`.

Then, signed in as an admin, run a 12-question diagnostic end to end at `/diagnostic` and:

```bash
npx tsx --env-file=.env scripts/verify-diagnostic.ts <attemptId>
```

Expected: every check passes and the measured numbers match the prediction. **A mismatch is a finding, not a rounding error** — stop and diagnose before continuing. Time the submit and confirm it is well inside `DIAGNOSTIC_TX_OPTIONS.timeout`.

- [ ] **Step 3: Remove the gate**

In `src/app/(app)/diagnostic/page.tsx`, delete the `isAdmin` branch, the "coming soon" markup, the `isAdmin` import and the whole doc comment above the component. Replace the comment with a short one recording what changed:

```tsx
/**
 * Open to everyone as of 2026-09-05. Every question is anchored to a live
 * `CardKlp` and a submitted run writes `QuizAnswer` -> `AnswerKlpResult` ->
 * `KlpState` through the same path the quiz uses, so a diagnostic moves the
 * learner model like any other graded mode.
 *
 * See docs/superpowers/specs/2026-09-05-diagnostic-key-point-wiring-design.md.
 */
```

- [ ] **Step 4: Update the build queue**

In `docs/superpowers/BUILD-QUEUE.md`, move NEXT UP item 1 to a completed entry recording: the correction that `StudyEvent` was already written (only key-point grain was missing); the live measurement that made backfill not worth doing; G8 closed; and the verified counts from Step 2.

- [ ] **Step 5: Final verification and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: suite green, tsc clean, lint at 164.

```bash
git add "src/app/(app)/diagnostic/page.tsx" scripts/verify-diagnostic.ts package.json docs/superpowers/BUILD-QUEUE.md
git commit -m "feat(diagnostic): open it to everyone

Verified against the live database first: a real 12-question run wrote 12
QuizAnswer, 12 AnswerKlpResult, a KlpState per distinct key point and 12
linked StudyEvent rows, with the counts predicted before they were
measured. The gate comes off last, not first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR"
```

---

## Self-review notes

**Spec coverage:** D1→T9/T10, D2→T9, D3→T7, D4→T6, D5→T6/T9, D6→T8, D7→T1, D8→T2/T3/T4, D9→T5, D10→T5 (abandonment) + T11 (label), D11→T9 (no `ensureKlpsReady`) + T7 (`DIAGNOSTIC_TX_OPTIONS`) + T9 (preconditions), D12→T6/T1/T10/T12. Spec §5's degradation table is covered by T9 (start refusals, generator rejection) and T10 (`no_provenance`, rollback).

**Known scope addition beyond the spec:** Task 11's history list and attempt view. The spec assumed a results page existed to carry the legacy banner; none does. Flagged to the user before planning.

**Type consistency:** `selectDiagnosticProbes` returns `DiagnosticProbe[]` with `klpId`/`cardId`/`kind`, consumed as such in Task 9. `createAnswerWithAnalysis`'s fourth parameter is `tx` in both Task 7's definition and Task 10's call. `probeRef` is the generator's key throughout Tasks 8 and 9; `questionRef` remains the grader's key, unchanged from v1.
