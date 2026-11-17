# Spec 6 — self-rated confidence capture

**Date:** 2026-09-17 · **Status:** design, awaiting owner decisions
**Closes:** G3 (engine audit, `BUILD-QUEUE.md` §"Engine audit" — "calibration is not computable")
**Feeds:** Spec 7 (mastery rework: the calibration axis) · Spec 9 (insight: `brittleness`, `expression`)

## Summary

One tap per answered item, captured before the learner sees any feedback, stored as a
nullable integer on the `StudyEvent` row the single memory write path already creates.
Nothing in scoring, BKT, mastery, or scheduling reads it. A read-only tile on
`/profile/learner` shows the rating-vs-outcome counts once twenty rated answers exist, so
the owner can watch the capture land. The calibration formula is Spec 7's. There is no
backfill: a row without a rating is NULL and stays NULL.

## Open decisions for the owner

**D1 — The scale.** Options: (a) four labelled steps *No idea / Unsure / Fairly sure /
Certain*; (b) 1–10 matching `CardProgress.confidence`; (c) binary *know / don't know*.
**Recommend (a).** Calibration (Brier, ECE) needs each rating mapped to a believed
probability of being right; four labelled steps are what a learner can actually
discriminate, and Spec 7 can *fit* the mapping from data instead of assuming that a "7"
means 0.7. Ten steps produce response noise and would be mistaken for the outcome-derived
`confidence` counter G3 is about; binary throws away the middle band, which is where
miscalibration lives. The stored value is the ordinal 1–4, never a probability.
*If (b):* same columns, `@db.SmallInt` range check widens; the readout shows ten
buckets and the floor rises to ~50. *If (c):* the readout collapses to a 2×2 and
`brittleness` in Spec 9 loses its "fairly sure and wrong" signal.

**D2 — The moment, in quizzes.** Options: (a) *retrospective* — rate after answering,
before submitting ("how sure are you that's right?"); (b) *prospective* — rate on seeing
the prompt, before options/typing ("do you know this?"). **Recommend (a)** for MC/SA/TF
and the diagnostic. It is the construct calibration literature uses (a retrospective
confidence judgment), it is the same moment in every graded mode, and it adds no gate in
front of answering. Review mode is the exception and is prospective by necessity (§3.2).
The moment is persisted per row (D3), so this is a default, not a lock-in.

**D3 — Persist the moment or infer it from `source`?** Options: (a) a second nullable
column `selfRatingMoment` (`before_answer | after_answer`); (b) infer: `review` ⇒ before,
everything else ⇒ after. **Recommend (a).** A prospective 3 and a retrospective 3 are
different measurements; Spec 2a persists significance *inputs* for exactly this reason,
and one string column is cheaper than a rule that silently rewrites history the day a
mode changes its moment. *If (b):* one column fewer, and the rule goes in
`src/lib/memory/scoring.ts` beside `STUDY_SOURCES` with a test.

**D4 — What a skip records.** Options: (a) NULL, indistinguishable from "widget hidden";
(b) a third state or a `selfRatingShown` boolean. **Recommend (a).** The readout and Spec
7 only ever consume rows *with* a rating; skip-rate is a behavioural signal nobody has
asked for, and a boolean that is true on every row from day one is a column that means
"after 2026-09-17". *If (b):* add `selfRatingShown Boolean?` written by the same path.

**D5 — Where the toggle lives.** Options: (a) `LearnerTuning.captureSelfRating Boolean
@default(true)` with a panel on `/settings/study`; (b) inside the `thresholds` JSON.
**Recommend (a).** It is not a threshold and the settings page's own lede says every
number there feeds a TypeScript computation — this one feeds nothing yet. Default ON:
the value of the capture is the history, and an opt-in that nobody finds records nothing.

**D6 — Review-mode keys.** Pre-flip, `1`–`4` rate (the answer keys `1`/`2` are inert
before the flip: `ReviewSession.tsx:120` returns unless `flipped`). Post-flip, `1`/`2`
keep their meaning and the rating is frozen. **Recommend this**, with the key hints
rendered per state so the two meanings of `2` are never on screen together. *Alternative:*
`a s d f` for the rating, no overlap, one more thing to learn.

## 1. What is captured

| field | type | meaning |
|---|---|---|
| `StudyEvent.selfRating` | `Int?` (1–4) | The learner's belief at the moment defined by D2/D3. NULL = not captured (widget off, skipped, or the row predates this spec). Never 0, never defaulted. |
| `StudyEvent.selfRatingMoment` | `String?` | `before_answer` or `after_answer`. NULL iff `selfRating` is NULL — enforced in `recordStudyEvent`, not by a DB constraint, because a Prisma CHECK would need raw SQL in the migration. |
| `LearnerTuning.captureSelfRating` | `Boolean @default(true)` | Whether the widget is shown and the server accepts a rating. |

Labels are fixed in one place, `src/lib/memory/self-rating.ts`:

```ts
export const SELF_RATINGS = [1, 2, 3, 4] as const
export const SELF_RATING_LABELS = { 1: 'No idea', 2: 'Unsure', 3: 'Fairly sure', 4: 'Certain' } as const
export const SELF_RATING_MOMENTS = ['before_answer', 'after_answer'] as const
export function isSelfRating(v: unknown): v is SelfRating
```

The module is Prisma-free and client-importable (the same split `roles.ts` makes), so
the picker, the write path, and the readout share one vocabulary.

## 2. Where it is stored, and why `StudyEvent`

Every mode that moves memory already produces exactly one `StudyEvent` through
`recordStudyEvent` (`src/lib/memory/record.ts:62`). Review has no `QuizAnswer`, so
`StudyEvent` is the only row common to every mode; `latencyMs` set the precedent
(`meta.latencyMs`, `record.ts:22–25`, written at `record.ts:145`). The rating rides the
same `meta`:

```ts
meta?: { latencyMs?: number; selfRating?: SelfRating; selfRatingMoment?: SelfRatingMoment }
```

`recordStudyEvent` gains one read and one rule:

- it selects `learnerTuning.captureSelfRating` for the user (a PK lookup, inside the same
  transaction that already reads `cardProgress`);
- if the toggle is off, or the rating fails `isSelfRating`, or the moment is absent, it
  writes **NULL for both columns** and the event otherwise proceeds. The server is the
  gate, not the client — a stale tab cannot write a rating against a setting the learner
  just turned off, and a malformed value is dropped rather than coerced.

Rejected: a column on `QuizAnswer` (Review has none; two homes drift), and a `SelfRating`
table (a table for one nullable integer, plus a new entry in the erase planner and the
snapshot types, for no query it makes easier).

**Read side.** Card grain: `StudyEvent.selfRating` against `StudyEvent.correct`/`score`
on the same row — no join. KLP grain (Spec 7): `StudyEvent.quizAnswerId` →
`AnswerKlpResult` rows; the per-question rating **fans out on read** to every KLP that
answer graded. It is never written per KLP: the learner rated the answer, not the
propositions, and inventing a per-KLP rating would be the fabrication the analysis
capture refuses.

**Replay.** `recomputeCardProgress` and the BKT backfill read `correct`, `score`,
`status`, `mode` — never these columns. A rating survives every replay untouched.

## 3. The moment, per surface

### 3.1 Quiz — MC, SA, TF (retrospective, D2)

All three sections are one-question-at-a-time carousels graded in one `commitAll` at
overall submit (`MultipleChoiceQuiz.tsx:68`, `ShortAnswerQuiz.tsx:38`,
`TrueFalseQuiz.tsx:63`); there is no per-question reveal, so *anything before submit is
before feedback*. The picker sits under the answer control on each question card. State
is held beside `selectedAnswers`/`answers` (`ratings: Record<cardId, SelfRating>`), editable
until submit, and each section's submit call sends it:

```ts
submitMultipleChoiceAnswer({ …, latencyMs, selfRating })   // likewise TF and SA
```

The action passes `meta: { latencyMs, selfRating, selfRatingMoment: 'after_answer' }` to
`recordStudyEvent` (`quiz.ts:582`, `:766`, `:1004`, `:1124`). A TF answer with
`isCorrect === null` never reaches `recordStudyEvent` today (`quiz.ts:764`) and so records
no rating — correct: there is no outcome to calibrate against.

MC note: options are loaded on mount (`MultipleChoiceQuiz.tsx:38–55`), so the learner
rates having seen the options and chosen one — that *is* the retrospective judgment.

### 3.2 Review (prospective, by necessity)

Review's "answer" is itself a self-judgment made after the flip
(`ReviewSession.tsx:285`: "Was it there before you flipped?"). A rating taken after the
flip would be contaminated by the answer; the only clean moment is before it. So the
picker shows above the card while `!flipped`, keys `1`–`4` (D6), and freezes at the flip.
`handleAnswer` (`:119`) passes `{ latencyMs, selfRating, selfRatingMoment: 'before_answer' }`
through `recordReview` (`src/actions/confidence.ts:25`).

This gives Review a *prospective rating vs self-scored outcome* pair, which is weaker
than the quiz's graded pair and is why D3 persists the moment: Spec 7 must be able to
keep the two apart.

### 3.3 Diagnostic (retrospective)

Same shape as the quiz: a carousel, one submit (`DiagnosticClient.tsx:95`), graded at
submit. The picker sits under the answer box; `DiagnosticSubmitSchema` gains an optional
`selfRating` per answer; the write at `diagnostic.ts:693` passes it through. Ungraded
questions (`item.score === null`) already skip `recordStudyEvent` and so record nothing.

### 3.4 Not captured

| surface | why |
|---|---|
| Quiz matching section (`src/actions/quiz-matching.ts`) | eight pairs, no single-item answer moment |
| Games | write nothing to memory, guarded by `tests/games/*` — unchanged |
| Flashcard carousel | no outcome to calibrate against |
| Hot Seat / postmortem | no `StudyEvent` written |
| Lessons | not built |

A write path that does not pass a rating writes NULL. No path is required to.

## 4. The setting

Migration adds `captureSelfRating Boolean @default(true)` to `LearnerTuning`
(`prisma/schema.prisma:1643`). `saveTuning`/`loadTuning` (`src/actions/learner-tuning.ts:12,42`)
gain the field; `/settings/study` gains a `SelfRatingPanel` after `TargetingStrategyPanel`
with one switch and two sentences (what it is for; that turning it off records nothing
and cannot be backfilled). Each capturing page reads the value server-side and passes
`captureSelfRating` as a prop, so a learner who turned it off never sees the widget — and
the server nulls anything that arrives regardless (§2).

A user with no `LearnerTuning` row is treated as `true` — the default, not a fabricated
row.

## 5. The component

`src/components/study/SelfRatingPicker.tsx`, client, no modal:

```ts
interface SelfRatingPickerProps {
  value: SelfRating | null
  onChange: (v: SelfRating) => void
  disabled?: boolean          // frozen after the flip in Review
  keyboard?: boolean          // bind 1–4 while mounted (Review, and quiz sections)
  prompt?: string             // "How sure are you?" (quiz) / "Do you know this one?" (Review)
}
```

A `role="radiogroup"` of four segmented buttons with the fixed labels, `aria-checked`,
a visible key hint under each, ≥44 px targets, wrapping to 2×2 under 360 px. Unselected
is a real state (nothing pre-selected — D4). Design-system tokens only; no new colours.

## 6. The readout (this spec's proof of capture)

`src/lib/metrics/calibration.ts`, pure:

```ts
export const CALIBRATION_MIN_SAMPLE = 20
export interface CalibrationBucket { rating: SelfRating; n: number; correct: number }
export function bucketCalibration(rows: { selfRating: number | null; correct: boolean | null; score: number | null }[]): CalibrationBucket[]
export function calibrationSample(buckets: CalibrationBucket[]): number
```

`correct` prefers `score >= 80` when `score` is present (the `overall >= 8` convention),
else the boolean; a row with neither is excluded, never counted as wrong. Rows with a
NULL rating are excluded before anything else.

`getLearnerMetrics` (`src/lib/metrics/read.ts:145`) adds `calibration: CalibrationBucket[]`
under the same `HistoryScope` every other tile obeys, and `/profile/learner` renders a
`CalibrationTile`: four rows, "rated *Certain* — right 14 of 17", suppressed below
`CALIBRATION_MIN_SAMPLE` with "12 of 20 rated answers so far". The floor exists for the
histogram reason: a tile that fires on a first session's four ratings is a tile that gets
ignored. The event feed on `/profile/memory` shows the rating as a small chip on each row
(`src/actions/memory.ts:33` gains `selfRating`; `SessionItem` in `summarize.ts:25` too, so
the session view can show it), which is the per-row proof.

**No number on the tile is a calibration score.** ECE, Brier, the probability mapping,
and any use in mastery are Spec 7, and the tile's copy says "counts, not a score".

## 7. Backfill and history

None is possible: a belief that was never asked for cannot be reconstructed. Every row
before the deploy has NULL in both columns and is indistinguishable from a later skip or
a turned-off toggle (D4). Spec 7 must treat NULL as *absence of measurement*, never as a
rating of any value — the same rule as `mastery: null` and the em-dash convention in
`/staff/klps`. This spec records the deploy date in the migration name so a reader can
tell "before capture existed" from "after".

## 8. Erase

Both columns live on `StudyEvent`, which every erasure scope already deletes or cascades
(`src/lib/memory/erase.ts`; `StudyEvent.quizAnswerId` is `onDelete: Cascade`,
`schema.prisma:904`). `ERASABLE_MEMORY_MODELS` and the snapshot types are unchanged. The
guard is a source scan, `tests/memory/self-rating-home.test.ts`: `selfRating` appears in
`prisma/schema.prisma` on the `StudyEvent` model and nowhere else, so a second home added
later fails the suite instead of escaping the planner.

## 9. Data flow

```
picker (client state per card)
  └─ submit action (quiz / review / diagnostic) ── meta.selfRating + moment ──▶
       recordStudyEvent
         ├─ read learnerTuning.captureSelfRating      (off → NULL, NULL)
         ├─ isSelfRating + moment present             (else → NULL, NULL)
         └─ studyEvent.create({ …, selfRating, selfRatingMoment })
                                    │
   /profile/learner ◀── getLearnerMetrics ── bucketCalibration(StudyEvent rows in scope)
   /profile/memory  ◀── listMemoryEvents (chip per row)
```

## 10. Testing

Pure:
- `bucketCalibration`: NULL ratings excluded; `score` beats `correct`; a row with neither
  is excluded, not wrong; buckets sum to the sample; floor arithmetic.
- `isSelfRating` rejects 0, 5, 2.5, `'3'`.

Write path (`tests/memory/record-self-rating.test.ts`, mocked Prisma as the existing
`record.test.ts` does):
- toggle off ⇒ both columns NULL even when a rating was passed — and the mutation check:
  flip the mock to `true` and assert the same input writes `3`, so the guard is shown to
  be able to fail;
- rating without moment ⇒ NULL, NULL; moment without rating ⇒ NULL, NULL;
- no `LearnerTuning` row ⇒ treated as on.

Guards:
- `tests/memory/self-rating-home.test.ts` (§8);
- `tests/games/match-writes-nothing.test.ts` and `tests/games/actions.test.ts` untouched
  and green — the games files import nothing new;
- `tests/memory/erase-coverage.test.ts` untouched and green.

Actions: each submit action forwards `selfRating` into `meta` (one assertion per call
site — four in `quiz.ts`, one in `confidence.ts`, one in `diagnostic.ts`).

Browser (owed, signed in): one MC, one SA, one TF answer each rated and visible as a chip
on `/profile/memory`; a Review card rated pre-flip with `2` then answered *Know It* with
`2` post-flip, and the row shows rating 2 / moment `before_answer`; a diagnostic sitting;
the toggle off and a subsequent answer showing no chip; the tile appearing at the
twentieth rated answer.

## 11. Migration

One migration, `20260917HHMMSS_self_rating_capture`: two nullable columns on `StudyEvent`,
one boolean with default on `LearnerTuning`. Additive; no row rewritten; no index (the
readout scans the learner's events, which every tile already does).

## 12. Out of scope

The calibration formula and its probability mapping; any change to `confidence`,
`masteryScore`, `stepBkt`, `nextDueAt`, or `rankCandidates`; lessons; games; a rating on
the matching section; skip-rate (D4); using the rating to *order* study candidates (Spec
7 decides whether "certain and wrong" outranks "unsure and wrong" — it is the strongest
candidate for the `brittleness` diagnosis and the reason this capture should not wait).
