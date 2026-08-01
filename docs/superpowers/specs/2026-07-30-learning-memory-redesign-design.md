# Learning Memory Redesign — Sessions, Timing, Insights, and the Three-View Hub

**Date:** 2026-07-30
**Status:** Design — approved in brainstorming, pending spec review
**Stage:** Stage 6 follow-on (persistent learner memory). Precedes Stage 7.

## Problem

`/profile` and `/profile/memory` present study history badly, but most of the
gap is not cosmetic — **the data was never recorded.** Verified in code:

- **Only quizzes are sessions.** `QuizAttempt` is created in
  `src/actions/quiz.ts:196`. Review mode writes per-card `StudyEvent`s
  (`source: 'review'`) with no session envelope. The standalone matching game
  (`/sets/[id]/match`) records **nothing at all** — it is pure client state in
  `src/lib/game/match.ts` and never touches the database.
- **Nothing is timed.** `StudyEvent.latencyMs` exists in the schema and is
  wired through `recordStudyEvent`'s `meta.latencyMs`
  (`src/lib/memory/record.ts:120`) but **no caller ever passes it**.
  `QuizAnswer` has no time field. `QuizAttempt` has only `createdAt`.
- **Whole-test insight is never saved.** `getQuizAttemptSummary`
  (`src/actions/quiz.ts:587`) fires a **fresh AI call on every single render**
  to produce `overallAnalysis`, then throws it away. Only per-question
  `grade.suggestedImprovement` persists, inside `QuizAnswer.grade`.
- **No permalink to a finished quiz.** `QuizSummary` renders only inside the
  live `QuizContainer`.
- **The history UI leaks internals.** Recent Activity shows `attempt.mode`
  ("Multiple Choice") as if it were an activity name, plus a `%` score.
  `ScopeBar` presents scope as a horizontal field of selectable chips.

## Decisions locked in brainstorming

| Question | Decision |
|---|---|
| Which modes are "activities" | **All three** — Quiz, Matching Game, Confidence Ranking |
| Where the hub lives | **Fold into `/profile`**, three tabs; `/profile/memory` redirects in |
| Activity row metric | **Time + size + focus areas.** Never a percentage |
| Insight cost model | **Generate once at finish, AI for quizzes only**; matching/review get computed-only |
| Insight shape | Computed breakdown + ranked focus areas, all in the **Summary** section |
| Scope reach | **One shared scope** across all three views |
| Third view | **Cards** — mastery ledger |
| Scope default | **Collapsed, showing everything**; Edit expands into vertical columns |
| Legacy attempts | **Show with gaps + on-demand "Generate insights"** |

---

## 1. Data model

### New: `StudySession`

The envelope that every study activity gets, so all three modes are
first-class and comparable.

```prisma
model StudySession {
  id          String       @id @default(cuid())
  userId      String
  setId       String
  kind        String       // "quiz" | "matching" | "confidence"
  startedAt   DateTime     @default(now())
  endedAt     DateTime?
  durationMs  Int?         // denormalized: the feed sorts/aggregates without recomputing
  itemCount   Int          @default(0)
  categoryIds Json?        // what the session was scoped to at launch
  insight     Json?        // persisted SessionInsight, see §3
  insightAt   DateTime?
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  set         Set          @relation(fields: [setId], references: [id], onDelete: Cascade)
  attempt     QuizAttempt?
  events      StudyEvent[]

  @@index([userId, startedAt])
  @@index([userId, kind, startedAt])
}
```

`durationMs` is denormalized deliberately: the activities feed sorts and
aggregates on duration, and deriving it from `endedAt - startedAt` in every
query blocks index use and breaks for still-open sessions.

### Modified

- `QuizAttempt.sessionId String? @unique` plus
  `session StudySession? @relation(fields: [sessionId], references: [id])` —
  `QuizAttempt` holds the foreign key, so `StudySession.attempt` is the
  back-reference. Nullable at the DB level even though the migration fills it,
  so a failed session-open can never block a quiz from starting.
- `StudyEvent.sessionId String?` + `@@index([sessionId])` — groups loose
  per-card events under a session. Nullable forever: events written before
  this change, and any future write path without a session, stay valid.
- `StudyEvent.confidenceBefore Int?` — the value confidence held *before* the
  interaction. §3's `confidence.avgDelta` needs a before-value, and the table
  stores only `confidenceAfter`; `recordStudyEvent` already reads
  `oldConfidence` (`src/lib/memory/record.ts:61`), so persisting it makes
  deltas exact rather than reconstructed from adjacent rows. Nullable, because
  events written before this change never captured it — and a null must be
  skipped when averaging, not read as a zero delta.
- `QuizAnswer.latencyMs Int?` — per-question time. The **same number** is
  passed into `recordStudyEvent`'s existing `meta.latencyMs`, so cross-mode
  pacing analytics read `StudyEvent` while the result page reads `QuizAnswer`.
  One source of truth per consumer, no divergence.

### Migration — envelope only, never metrics

**This deviates from what was presented in brainstorming ("nothing is
backfilled") and needs explicit sign-off.**

A one-time data migration creates one `StudySession` per existing
`QuizAttempt`: `kind: 'quiz'`, `startedAt: attempt.createdAt`,
`endedAt: null`, `durationMs: null`, `itemCount: <answer count>`,
`insight: null`.

Rationale: without it, the activities feed must UNION `StudySession` rows with
session-less `QuizAttempt` rows — two sources, two cursors, one merged
pagination, forever. Backfilling the *envelope* keeps the feed a single
indexed table scan.

What is **not** backfilled: durations, per-question latency, and insights stay
`null` and render as `—`. No number is invented. Pre-existing Review and
Matching history has no envelope to reconstruct (matching wrote nothing at
all), so it does not appear in Activities — those loose `StudyEvent`s remain
fully visible in the **Cards** view timeline.

---

## 2. Instrumentation

| Mode | Today | Change |
|---|---|---|
| Quiz | `QuizAttempt` created at `src/actions/quiz.ts:196` | Open a `StudySession` in the same transaction; client times each question; `finishSession` at submit |
| Matching (standalone) | **Records nothing** — client state only | New `startMatchSession` / `finishMatchSession` actions; one `StudyEvent(source:'matching')` per pair |
| Review | Per-card events via `recordReview` (`src/actions/confidence.ts:26`), no session | Open/close a session; thread `sessionId` + latency through `recordReview` |

### Timing capture

Timing is measured **client-side** as wall-clock between question render and
answer submit, then sent with the answer. Server-side timestamps can't
distinguish thinking time from network latency, and every mode already has the
render moment in client state.

Guard: a latency above a ceiling (e.g. 10 minutes) is stored as `null`, not a
huge number — the user walked away, and one such value would wreck every
median and outlier calculation downstream.

### Matching game needs per-card correctness

`selectTile` (`src/lib/game/match.ts:68`) tracks only `matched[]` — it does not
record failed pair attempts, so there is currently no way to say whether a card
was matched *well*.

Change: `MatchGameState` gains `misses: Record<cardId, number>`, incremented in
`selectTile` when two selected tiles don't pair. Correctness for the
`StudyEvent` is then **"matched on the first try"** (`misses[cardId] === 0`).
This is a pure-function change to existing pure code and is unit-tested
alongside the current `selectTile` tests.

Note: `MatchGameState.sessionId` already exists but is a **client-only
`crypto.randomUUID()`**, unrelated to the database. It gets replaced by the
real `StudySession.id` rather than sitting beside it.

### ⚠️ Behaviour change worth naming

**The standalone matching game will start moving confidence scores.** Today it
is consequence-free practice. Stage 6's "single memory write path" says every
mode must feed memory, and matching cannot be an activity at all without it —
but this is a real change to how the game feels, and it is intentional.

---

## 3. Insights — computed first, AI second

One Zod-validated, versioned JSON blob stored on `StudySession.insight`.

```
SessionInsight v1
├─ computed        ← pure summarizeSession(), zero cost, ALWAYS present
│   byCategory[]     name, correct, total, accuracyPct
│   byMode[]         mode, correct, total, avgScore, medianLatencyMs
│   pacing           median / fastest / slowest, split by mode
│   confidence       avgDelta, newlyMastered[], dropped[]
│   outliers         rushed[]  (fast + wrong)
│                    laboured[] (slow + wrong)
└─ ai?             ← one call, quizzes only, optional
    focusAreas[]     title, severity, evidence, action, cardIds
    strengths        narrative
```

**The AI reads `computed` and writes prose. It never calculates a number.**
That preserves the Stage 6 rule that AI reads mastery but never computes it,
and it makes `summarizeSession` a pure, fully unit-testable function.

- `summarizeSession(events, answers, cards)` lives in
  `src/lib/memory/summarize.ts` — pure, no Prisma, no I/O.
- The AI half is a new registry entry `SESSION_INSIGHT_PROMPT`
  (`src/lib/ai/prompts/session-insight.ts`, `id: 'session-insight'`,
  `version: 1`), following the existing prompt-module shape
  (`id` / `version` / `schema` / `build`) and registered in
  `src/lib/ai/prompts/registry.ts`. Routed via task `grade`.
- Generation failure is caught and degrades to `computed`-only, matching the
  existing `safeProfileBlock` pattern — an insight is supplementary and must
  never fail a session submit.

**This kills a live cost bug.** `getQuizAttemptSummary` stops calling the AI
and reads the persisted insight instead. Re-opening a result becomes free.
`QUIZ_SUMMARY_PROMPT` is superseded by `SESSION_INSIGHT_PROMPT` and removed
once nothing references it.

Matching and Confidence Ranking sessions store the `computed` block only — no
AI call, per the cost decision. Legacy attempts (and any session whose AI call
failed) show a **"Generate insights"** button that runs the call once and
persists the result.

All of this renders in the **Summary** section of the activity detail,
replacing today's single "Overall Analysis" paragraph.

---

## 4. Routes and the three views

```
/profile?view=activities|breakdown|cards   ← the hub (scope params shared)
/profile/activity/[id]                     ← activity detail permalink
/profile/memory                            ← redirect into the hub, scope preserved
```

`/profile/activity/[id]` resolves `id` as a `StudySession.id`. Because the
migration gives every legacy attempt a session, there is no second lookup path.

`QuizSummary` is extracted from `QuizContainer` so the live end-of-quiz screen
and the permalink render the **identical component** — that is the "the page I
originally saw when I finished" requirement, satisfied by construction rather
than by keeping two views in sync.

### Activities

Grouped by day (`Today` / `Yesterday` / `Jul 27`). Each row: mode icon,
activity name (**`Quiz` / `Matching Game` / `Confidence Ranking`** — never
"Multiple Choice"), set + composition, then `10 questions · 8m 42s · 3 to
improve`. Missing timing renders `—`.

The `N to improve` count reads `insight.ai.focusAreas.length`, which exists
only for quizzes. Matching and Confidence Ranking rows therefore end at
size + duration (`12 pairs · 1m 55s`) — as do quizzes whose insight hasn't been
generated yet. The segment is omitted, not shown as zero: "0 to improve" reads
as a perfect score, which is exactly the evaluative signal this list is meant
to keep out.

**No percentage appears anywhere in the list.**

### Breakdown

A segmented switch (By set / By category / By activity) over one comparison
table: name, cards seen, accuracy, avg confidence, time spent, bar.

**Every row drills into the underlying questions** — clicking "Multiple Choice
72%" lists every MC question answered, right/wrong, with prompt and answer.
This is the direct fix for "it's possible now, but the UI is unintuitive."

### Cards — mastery ledger

Distribution bar over **Mastered / Solid / Shaky / Struggling** buckets, from a
new pure `masteryBucket(progress)` in `src/lib/memory/scoring.ts` so one
definition backs the bar, the bucket lists, and the Breakdown counts:

| Bucket | Rule |
|---|---|
| Mastered | `mastery >= 80` and `confidence >= 8` |
| Solid | `mastery >= 60` or `confidence >= 7` |
| Shaky | `confidence >= 4` |
| Struggling | otherwise |

`mastery` is nullable for cards last touched before Stage 6 Task 4, so the
rules must fall through on `null` rather than treating it as `0` — a card with
`confidence 9` and `mastery null` is Solid, not Struggling. This replaces the
ad-hoc `confidence >= 8` count currently inlined in `getUserStats`
(`src/actions/user.ts:64`), which becomes a call to the shared function.

Sortable by confidence,
mastery, last seen, or times wrong. Each card opens a timeline of every
`StudyEvent` across every mode, and hosts the per-card destructive controls
(`forgetCard`, delete event).

Question-mode words (Multiple Choice, Short Answer, True/False) appear **only
inside** an activity detail or a breakdown row — never as an activity's name.

---

## 5. Scope panel

`ScopeBar.tsx` is replaced by `ScopePanel`:

- **Collapsed by default**, one line: `Everything · all sets · all time [Edit]`,
  with results rendered immediately below. The page is never blank on landing.
- **Edit** expands into vertical **Set / Category / Activity** columns of large
  cells, results dimmed, with `[Cancel] [Apply]`.
- **Apply** collapses it again and updates the URL.

### `HistoryScope` changes (`src/lib/memory/scope.ts`)

```ts
interface HistoryScope {
  setIds: string[];
  categoryKeys: string[];
  cardId?: string;
  kinds: string[];        // replaces `source?: string`
  since?: 'all' | '7d' | '30d';
}
```

`source?: string` is replaced by `kinds: string[]` at **session-kind**
granularity, mapped to `StudyEvent.source` values inside
`buildStudyEventWhere`:

| kind | sources |
|---|---|
| `quiz` | `quiz-mc`, `quiz-sa`, `quiz-tf` |
| `matching` | `matching` |
| `confidence` | `review` |

This is what removes raw source strings from the UI entirely while keeping the
existing pure `where`-builder intact (`where.source = { in: [...] }`).

`parseScope` accepts the legacy `?source=` param and maps it forward, so
existing bookmarks and links don't break. `serializeScope` only ever emits the
new form. `since` is stored as a preset token and resolved to a `Date` in the
action, keeping `scope.ts` pure and time-independent for tests.

The scope is **shared by all three views** and stays URL-synced.

Destructive controls (delete event, forget card, forget set, reset memory) move
out of the main flow into a collapsed **"Manage data"** section, plus the
per-card drawer in Cards.

---

## Testing

Pure functions carry the logic, per the repo convention that scoring and
parsing stay unit-testable:

| Target | Test |
|---|---|
| `summarizeSession` | New `tests/memory/summarize.test.ts` — empty sessions, single answer, all-wrong, mixed modes, missing latency, outlier classification, confidence deltas |
| `selectTile` miss tracking | Extend existing match-game tests — first-try match, match after misses, miss on already-matched tile |
| `HistoryScope` | Extend `tests/memory/scope.test.ts` — `kinds` → sources mapping, `since` presets, legacy `?source=` parsing, round-trip serialize/parse |
| `SessionInsight` schema | Zod validation rejects malformed AI output before persist |
| Latency ceiling | Above-ceiling latency stored as `null` |

Server actions get integration coverage for session open/close and the
idempotency of `finishSession` (double-submit must not duplicate events —
`submitMatchingAnswers` already establishes this pattern).

---

## Build order

**Phase 1 — data.** Schema + migration, instrumentation for all three modes,
`summarizeSession`, `SESSION_INSIGHT_PROMPT`, persisted insight, the
`/profile/activity/[id]` permalink, and `QuizSummary` extraction.

**Phase 2 — UI.** The three-view hub, `ScopePanel`, breakdown drill-downs, the
cards ledger, and the `/profile/memory` redirect.

Phase 1 must land first: Phase 2 renders data that does not exist yet.
Implementation pulls in `ui-ux-pro-max` for the visual layer and `dataviz` for
the breakdown charts.

## Explicitly out of scope

- Backfilling durations, per-question latency, or insights for old data.
- Reconstructing pre-change Review/Matching sessions (matching wrote nothing).
- Cross-session trend charts over insights — the data becomes diffable here,
  but charting it is Stage 7 territory.
- Email/push nudges, plan items, lessons — Stage 7.

## Risks

1. **Matching game gains consequences.** Called out above; intentional, but it
   changes how a previously pressure-free mode feels.
2. **Migration touches every existing `QuizAttempt`.** Insert-only, no
   destructive edit, reversible by dropping the created rows.
3. **`QUIZ_SUMMARY_PROMPT` removal** must land only after every reference is
   gone, or quiz summaries break.
4. **Client-measured timing is trusted input.** The ceiling guard bounds the
   damage; timing is analytics, never a grade.
