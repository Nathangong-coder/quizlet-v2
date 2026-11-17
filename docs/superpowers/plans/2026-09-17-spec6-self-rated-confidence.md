# Spec 6 — Self-Rated Confidence Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every graded study mode captures a one-tap 1–4 self-rating before feedback, persisted on `StudyEvent` with its moment, default-on with a per-user toggle, gated server-side, and proven by a counts-only calibration readout.

**Architecture:** One Prisma-free vocabulary module; two nullable columns on `StudyEvent` written only by `recordStudyEvent` (the single memory write path), which reads `LearnerTuning.captureSelfRating` and nulls anything it should not keep; one client picker component reused by quiz, review and diagnostic; a pure bucketing function feeding a tile on `/profile/learner` and a chip on `/profile/memory`. No formula changes anywhere.

**Tech Stack:** Next.js App Router, Prisma/Postgres, React 19, vitest (+ the existing component test setup under `tests/components`).

**Spec:** `docs/superpowers/specs/2026-09-17-spec6-self-rated-confidence-design.md` — every decision D1–D6 is settled as recommended.

## Global Constraints

- **NULL means "not captured"; never 0, never defaulted.** `selfRatingMoment` is NULL iff `selfRating` is NULL — enforced in `recordStudyEvent`, not the DB.
- **The server is the gate.** A rating arriving with the toggle off is written as NULL; a malformed value is dropped, never coerced.
- **Games write nothing** — `tests/games/match-writes-nothing.test.ts` and `tests/games/actions.test.ts` stay untouched and green; no games file imports anything new.
- **The rating lives on `StudyEvent` and nowhere else** — a source-scan test pins it.
- **No calibration score anywhere.** The tile shows counts; copy says "counts, not a score".
- **Migrations:** additive only, created with `npx prisma migrate dev --create-only`, applied with `npx prisma migrate deploy` (never `migrate dev` without `--create-only` — another branch's migration may already be applied to the shared dev database, and `migrate dev` would offer a reset). Folder name `20260917120000_self_rating_capture`.
- **Never push.** Commit per task; the owner pushes.
- **Baselines:** `npm test` green, `npx tsc --noEmit` clean, lint ≤ ceiling at start; the same at the end of every task.
- This worktree shares the dev database with the Spec 5 Phase A worktree. Their migrations are disjoint (different tables/columns); do not touch `AnswerKlpResult`, `QuizAnswer`, `src/lib/analysis/*`, `src/lib/ai/prompts/grade-*`, or `src/lib/errors/klp-credit.ts`.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/memory/self-rating.ts` (create) | vocabulary, labels, moments, `isSelfRating` |
| `prisma/schema.prisma`, `prisma/migrations/20260917120000_self_rating_capture/` | two nullable columns + one boolean |
| `src/lib/memory/record.ts:22-25,62,145` (modify) | `meta` fields, tuning read, null rules |
| `src/components/study/SelfRatingPicker.tsx` (create) | the one-tap picker |
| `src/components/quiz/MultipleChoiceQuiz.tsx`, `ShortAnswerQuiz.tsx`, `TrueFalseQuiz.tsx`, `src/actions/quiz.ts:582,766,1004,1124` | quiz capture |
| `src/components/review/ReviewSession.tsx:119-130,285`, `src/actions/confidence.ts:25` | review capture (prospective) |
| `src/components/diagnostic/DiagnosticClient.tsx:95`, `src/actions/diagnostic.ts:693`, `DiagnosticSubmitSchema` | diagnostic capture |
| `src/actions/learner-tuning.ts:12,42`, `src/app/(app)/settings/study/page.tsx`, `src/components/settings/SelfRatingPanel.tsx` (create) | the toggle |
| `src/lib/metrics/calibration.ts` (create), `src/lib/metrics/read.ts:145`, `src/components/profile/CalibrationTile.tsx` (create), `src/actions/memory.ts:33`, `src/lib/memory/summarize.ts:25` | the readout |

---

### Task 1: Vocabulary, schema, migration, and the single-home guard

**Files:**
- Create: `src/lib/memory/self-rating.ts`, `prisma/migrations/20260917120000_self_rating_capture/migration.sql`
- Modify: `prisma/schema.prisma` (`StudyEvent` near line 889; `LearnerTuning` near line 1643)
- Test: `tests/memory/self-rating.test.ts` (create), `tests/memory/self-rating-home.test.ts` (create)

**Interfaces:**
- Produces: `SELF_RATINGS`, `SELF_RATING_LABELS`, `SELF_RATING_MOMENTS`, `type SelfRating = 1|2|3|4`, `type SelfRatingMoment = 'before_answer' | 'after_answer'`, `isSelfRating(v): v is SelfRating`, `isSelfRatingMoment(v)`. Schema: `StudyEvent.selfRating Int?`, `StudyEvent.selfRatingMoment String?`, `LearnerTuning.captureSelfRating Boolean @default(true)`.

- [ ] **Step 1: Write the failing tests**

`tests/memory/self-rating.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SELF_RATINGS, SELF_RATING_LABELS, isSelfRating, isSelfRatingMoment } from '@/lib/memory/self-rating'
describe('self-rating vocabulary', () => {
  it('is exactly 1..4 with a label each', () => {
    expect(SELF_RATINGS).toEqual([1, 2, 3, 4])
    for (const r of SELF_RATINGS) expect(SELF_RATING_LABELS[r].length).toBeGreaterThan(0)
  })
  it('isSelfRating rejects 0, 5, 2.5 and strings', () => {
    for (const bad of [0, 5, 2.5, '3', null, undefined]) expect(isSelfRating(bad)).toBe(false)
    expect(isSelfRating(3)).toBe(true)
  })
  it('isSelfRatingMoment', () => {
    expect(isSelfRatingMoment('before_answer')).toBe(true)
    expect(isSelfRatingMoment('after')).toBe(false)
  })
})
```
`tests/memory/self-rating-home.test.ts`:
```ts
import { readFileSync } from 'fs'
import { join } from 'path'
it('selfRating lives on StudyEvent and nowhere else in the schema', () => {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf-8')
  const models = [...schema.matchAll(/model (\w+) \{[\s\S]*?\n\}/g)].filter((m) => /\bselfRating\b/.test(m[0])).map((m) => m[1])
  expect(models).toEqual(['StudyEvent'])
})
it('the module is Prisma-free', () => {
  const src = readFileSync(join(__dirname, '../../src/lib/memory/self-rating.ts'), 'utf-8')
  expect(src).not.toMatch(/@prisma|@\/lib\/db/)
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/memory/self-rating.test.ts tests/memory/self-rating-home.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/memory/self-rating.ts
/**
 * The learner's own belief about an answer, captured BEFORE feedback (Spec 6).
 * Ordinal 1-4, never a probability — Spec 7 fits the mapping from data.
 * Prisma-free and client-importable: the picker, the write path and the
 * readout share this one vocabulary.
 */
export const SELF_RATINGS = [1, 2, 3, 4] as const
export type SelfRating = (typeof SELF_RATINGS)[number]
export const SELF_RATING_LABELS: Record<SelfRating, string> = { 1: 'No idea', 2: 'Unsure', 3: 'Fairly sure', 4: 'Certain' }
export const SELF_RATING_MOMENTS = ['before_answer', 'after_answer'] as const
export type SelfRatingMoment = (typeof SELF_RATING_MOMENTS)[number]
export function isSelfRating(v: unknown): v is SelfRating {
  return typeof v === 'number' && (SELF_RATINGS as readonly number[]).includes(v)
}
export function isSelfRatingMoment(v: unknown): v is SelfRatingMoment {
  return typeof v === 'string' && (SELF_RATING_MOMENTS as readonly string[]).includes(v)
}
```
Schema: on `StudyEvent`, after `latencyMs Int?`:
```prisma
  /// Spec 6: the learner's belief before feedback, 1-4. NULL = not captured
  /// (toggle off, skipped, or predates 2026-09-17). Never 0, never defaulted.
  selfRating       Int?
  /// `before_answer` (Review, pre-flip) | `after_answer` (quiz, diagnostic). NULL iff selfRating is NULL.
  selfRatingMoment String?
```
On `LearnerTuning`: `captureSelfRating Boolean @default(true)`. Then `npx prisma migrate dev --name self_rating_capture --create-only`, rename the folder to `20260917120000_self_rating_capture`, confirm the SQL is two `ADD COLUMN`s (nullable) and one `ADD COLUMN ... DEFAULT true`, then `npx prisma migrate deploy && npx prisma generate`.

- [ ] **Step 4: Run tests and tsc** → PASS, clean.

- [ ] **Step 5: Commit** — `git add src/lib/memory/self-rating.ts prisma tests/memory && git commit -m "spec6: self-rating vocabulary, StudyEvent columns, LearnerTuning toggle"`

---

### Task 2: `recordStudyEvent` is the gate

**Files:**
- Modify: `src/lib/memory/record.ts` (the `meta` type at 22–25, the tuning read near the existing `cardProgress` read inside the transaction, the `studyEvent.create` at ~145)
- Test: `tests/memory/record-self-rating.test.ts` (create — copy the mocked-Prisma harness from `tests/memory/record.test.ts`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `meta?: { latencyMs?: number; selfRating?: number; selfRatingMoment?: string }` (loosely typed on purpose — the gate validates); `studyEvent.create` data gains `selfRating`, `selfRatingMoment`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('recordStudyEvent self-rating gate', () => {
  it('toggle off ⇒ both NULL even when a rating was passed', async () => {
    tuning.captureSelfRating = false
    await recordStudyEvent({ ...base, meta: { selfRating: 3, selfRatingMoment: 'after_answer' } })
    expect(created().selfRating).toBeNull(); expect(created().selfRatingMoment).toBeNull()
  })
  it('MUTATION CHECK: the same input with the toggle on writes 3', async () => {
    tuning.captureSelfRating = true
    await recordStudyEvent({ ...base, meta: { selfRating: 3, selfRatingMoment: 'after_answer' } })
    expect(created().selfRating).toBe(3); expect(created().selfRatingMoment).toBe('after_answer')
  })
  it('rating without moment, moment without rating, bad rating ⇒ NULL, NULL', async () => {
    for (const meta of [{ selfRating: 3 }, { selfRatingMoment: 'after_answer' }, { selfRating: 7, selfRatingMoment: 'after_answer' }, { selfRating: 2, selfRatingMoment: 'later' }]) {
      await recordStudyEvent({ ...base, meta })
      expect(created().selfRating).toBeNull(); expect(created().selfRatingMoment).toBeNull()
    }
  })
  it('no LearnerTuning row ⇒ treated as on', async () => {
    tuningRow = null
    await recordStudyEvent({ ...base, meta: { selfRating: 1, selfRatingMoment: 'before_answer' } })
    expect(created().selfRating).toBe(1)
  })
  it('no meta ⇒ NULL, NULL and the event still writes', async () => {
    await recordStudyEvent({ ...base })
    expect(created().selfRating).toBeNull()
  })
})
```
where `tuningRow`/`created()` are helpers over the mocked `tx.learnerTuning.findUnique` and `tx.studyEvent.create`.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** — inside the transaction, `const tuning = await tx.learnerTuning.findUnique({ where: { userId }, select: { captureSelfRating: true } })`; `const capture = tuning?.captureSelfRating ?? true`; `const rating = capture && isSelfRating(meta?.selfRating) && isSelfRatingMoment(meta?.selfRatingMoment) ? meta.selfRating : null`; `const moment = rating === null ? null : meta.selfRatingMoment`; add both to the create data. Doc comment: *the server is the gate — a stale tab cannot write a rating against a setting the learner just turned off.*

- [ ] **Step 4: Run** `npx vitest run tests/memory && npx tsc --noEmit` → PASS (including the untouched `erase-coverage` test).

- [ ] **Step 5: Commit** — `git commit -m "spec6: recordStudyEvent gates the rating on the toggle and the vocabulary"`

---

### Task 3: The picker

**Files:**
- Create: `src/components/study/SelfRatingPicker.tsx`
- Test: `tests/components/self-rating-picker.test.tsx` (create; follow the render helpers used by the existing files in `tests/components`)

**Interfaces:**
- Produces: `SelfRatingPicker({ value, onChange, disabled?, keyboard?, prompt? })` per spec §5.

- [ ] **Step 1: Write the failing tests** — renders four `role="radio"` buttons with the fixed labels and `aria-checked` on the selected one; clicking calls `onChange(2)`; with `keyboard`, pressing `3` calls `onChange(3)` and pressing `5` does nothing; with `disabled`, clicks and keys do nothing; nothing is pre-selected when `value` is null.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** — `'use client'`; a `role="radiogroup"` with `aria-label={prompt ?? 'How sure are you?'}`; four `<button role="radio">` (`min-h-11`, `flex-1`, wrapping `grid-cols-2` under `sm:`), label + a small key hint (`1`…`4`) under each; `useEffect` binding `keydown` on `window` when `keyboard && !disabled`, ignoring events whose target is an input/textarea; design-system tokens only (`bg-primary/10 border-primary` selected, `bg-muted` otherwise).

- [ ] **Step 4: Run** the component test + tsc → PASS.

- [ ] **Step 5: Commit** — `git commit -m "spec6: SelfRatingPicker — one tap, keyboard-reachable, nothing pre-selected"`

---

### Task 4: Quiz and diagnostic capture (retrospective)

**Files:**
- Modify: `src/components/quiz/MultipleChoiceQuiz.tsx:38-90`, `ShortAnswerQuiz.tsx:30-60`, `TrueFalseQuiz.tsx:55-80` (state `ratings: Record<string, SelfRating>`, the picker under the answer control, `selfRating` in each submit call); `src/actions/quiz.ts` submit inputs (`selfRating?: number`) and the four `recordStudyEvent` calls at ~582, ~766, ~1004, ~1124 (`meta: { latencyMs, selfRating: input.selfRating, selfRatingMoment: 'after_answer' }`); `src/components/diagnostic/DiagnosticClient.tsx:95`, `DiagnosticSubmitSchema` (per-answer `selfRating: z.number().int().min(1).max(4).optional()`), `src/actions/diagnostic.ts:693`; the quiz and diagnostic pages pass `captureSelfRating` (Task 6 supplies the loader — until then read `loadTuning` directly or default `true`; Task 6 replaces it)
- Test: `tests/actions/quiz-self-rating.test.ts` (create — one assertion per call site that `meta.selfRating` and `selfRatingMoment: 'after_answer'` are forwarded; use the mocked-Prisma harness of the nearest existing `tests/actions/quiz-*.test.ts`), `tests/diagnostic/submit-self-rating.test.ts` (create)

- [ ] **Step 1: Write the failing tests** — four quiz + one diagnostic forwarding assertions; a TF answer with `isCorrect === null` still never calls `recordStudyEvent`.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** — per spec §3.1/§3.3. The picker is hidden when `captureSelfRating` is false; ratings are editable until submit; MC sends the rating alongside the option in the existing per-card submit.

- [ ] **Step 4: Run** `npx vitest run tests/actions tests/diagnostic tests/components && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "spec6: quiz MC/SA/TF and the diagnostic capture a retrospective rating before submit"`

---

### Task 5: Review capture (prospective, keys 1–4 pre-flip)

**Files:**
- Modify: `src/components/review/ReviewSession.tsx:100-135,280-300`, `src/actions/confidence.ts:25` (`recordReview` input gains `selfRating?: number`; passes `meta: { latencyMs, selfRating, selfRatingMoment: 'before_answer' }`)
- Test: `tests/review/review-self-rating.test.tsx` (create — pre-flip `2` selects rating 2 and does not answer; post-flip `2` answers *Don't know* and the rating is frozen at 2; the submitted call carries `selfRating: 2`), `tests/actions/confidence-self-rating.test.ts` (forwarding)

- [ ] **Step 1: Write the failing tests** → **Step 2:** FAIL.

- [ ] **Step 3: Implement** — the picker renders above the card while `!flipped` with `keyboard` on and `prompt="Do you know this one?"`; the key hints under the card switch by state so the two meanings of `2` are never on screen together; `handleAnswer` includes the rating; the rating resets per card.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "spec6: Review rates before the flip; keys 1-4 pre-flip, frozen after"`

---

### Task 6: The toggle

**Files:**
- Modify: `src/actions/learner-tuning.ts:12,42` (`captureSelfRating` in `loadTuning`/`saveTuning`; a user with no row loads `true`), `src/app/(app)/settings/study/page.tsx` (render `SelfRatingPanel` after `TargetingStrategyPanel`); the quiz, review and diagnostic pages read `captureSelfRating` server-side and pass it as a prop (replacing Task 4's interim read)
- Create: `src/components/settings/SelfRatingPanel.tsx`
- Test: `tests/settings/self-rating-toggle.test.ts` (create — `loadTuning` with no row returns `captureSelfRating: true`; `saveTuning({ captureSelfRating: false })` writes it; the panel renders one switch and the two sentences)

- [ ] Steps 1–5 as above; commit — `git commit -m "spec6: captureSelfRating toggle on /settings/study, default on"`

---

### Task 7: The readout — buckets, tile, chip

**Files:**
- Create: `src/lib/metrics/calibration.ts`, `src/components/profile/CalibrationTile.tsx`
- Modify: `src/lib/metrics/read.ts:145` (`calibration: CalibrationBucket[]` under the scope), `/profile/learner` page (render the tile), `src/actions/memory.ts:33` (`selfRating` on each event row), `src/lib/memory/summarize.ts:25` (`SessionItem.selfRating`), the memory event row component (a small chip "Certain" etc. when present)
- Test: `tests/metrics/calibration.test.ts` (create), `tests/components/calibration-tile.test.tsx` (create)

**Interfaces:**
- Produces: `CALIBRATION_MIN_SAMPLE = 20`, `bucketCalibration(rows)`, `calibrationSample(buckets)` per spec §6.

- [ ] **Step 1: Write the failing tests**

```ts
it('excludes NULL ratings, prefers score over correct, excludes rows with neither', () => {
  const b = bucketCalibration([
    { selfRating: null, correct: true, score: 100 },
    { selfRating: 4, correct: false, score: 90 },   // score wins → correct
    { selfRating: 4, correct: true, score: null },  // boolean
    { selfRating: 2, correct: null, score: null },  // excluded
  ])
  expect(b.find((x) => x.rating === 4)).toEqual({ rating: 4, n: 2, correct: 2 })
  expect(calibrationSample(b)).toBe(2)
})
it('always returns four buckets in order', () => expect(bucketCalibration([]).map((b) => b.rating)).toEqual([1, 2, 3, 4]))
```
Tile: below the floor renders "N of 20 rated answers so far" and no rows; at/above renders four rows "rated *Certain* — right 14 of 17" and the "counts, not a score" line.

- [ ] **Step 2: Run to verify they fail** → FAIL. **Step 3: Implement** per spec §6. **Step 4: Run** `npx vitest run tests/metrics tests/components tests/memory && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "spec6: calibration buckets, the counts-only tile, and the rating chip"`

---

### Task 8: Docs, queue, full suite

**Files:**
- Modify: `docs/superpowers/BUILD-QUEUE.md` (Spec 6 entry → BUILT, with the browser gate list from spec §10 marked owed), `CLAUDE.md` (one sentence under Stage 6's single write path: the self-rating rides `StudyEvent` and is gated server-side)

- [ ] **Step 1:** edits above. **Step 2:** `npm test && npx tsc --noEmit && npm run lint` → green. **Step 3:** commit — `git commit -m "spec6: built; queue and CLAUDE.md updated, browser gate owed"`

---

## Self-review

**Spec coverage:** §1 → T1; §2 → T2; §3.1/§3.3 → T4; §3.2 → T5; §3.4 → constraints (games untouched, a guard test exists); §4 → T6; §5 → T3; §6 → T7; §7 → T1's doc comment and migration name; §8 → T1's home guard + the untouched erase test; §9 → T2/T4/T5/T7; §10 → each task; §11 → T1.

**Type consistency:** `SelfRating`/`SelfRatingMoment` (T1) are the picker's `value` type (T3), the loosely-typed `meta` input validated in T2, and the readout's bucket key (T7). `captureSelfRating` (T1 schema, T6 loader) is the prop every capturing page passes (T4, T5).

**Placeholders:** none — where a task says "per spec §N" the spec section carries the exact copy and file lines.
