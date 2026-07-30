# Learning Memory Redesign — Phase 1 (Data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every study activity as a timed, insight-bearing `StudySession` so the three-view history hub in Phase 2 has real data to render.

**Architecture:** A new `StudySession` row is the envelope for all three study modes (quiz, matching, confidence/review). Quiz, Review, and the standalone Matching game each open a session, thread `sessionId` + per-item latency through the existing single memory write path (`recordStudyEvent`), and close it at finish. At close, a pure `summarizeSession()` computes a deterministic breakdown; for quizzes only, one AI call ranks focus areas on top of it. The whole thing persists as a versioned JSON blob on the session, replacing today's regenerate-on-every-render AI call.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (Postgres/Neon), Vercel AI SDK v7, Zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-30-learning-memory-redesign-design.md`

## Scope

This plan covers **Phase 1 (data) only**. Phase 2 (the three-view hub, `ScopePanel`, breakdown drill-downs, cards ledger) gets its own plan written after Phase 1 lands — its tasks consume the exact shapes produced here, and writing them now means guessing at them.

Phase 1 is independently shippable: sessions are recorded, insights persist, the permalink works, and the per-render AI cost bug is fixed. The existing `/profile` and `/profile/memory` pages keep working untouched.

## Global Constraints

- Test runner is **Vitest**: `npm test` (single run), `npm run test:watch`. Config: `vitest.config.ts`, `environment: 'node'`, alias `@` → `./src`.
- Tests live in `tests/<area>/<name>.test.ts`, mirroring `src/`. Import source under test via the `@` alias or a relative path — both patterns exist in the repo.
- Server actions are tested by mocking `@/auth`, `@/lib/db`, and `next/cache` with `vi.hoisted()` + `vi.mock()`. See `tests/actions/ai-credentials.test.ts` for the canonical pattern.
- **Pure logic goes in `src/lib/`, never in an action.** Scoring, parsing, and summarization must be unit-testable without a database. This is a standing repo convention.
- **AI never computes a number.** The AI reads the computed block and writes prose only.
- Every `generateJson` call passes a Zod `schema`. Validate before persisting.
- Prompts live as modules under `src/lib/ai/prompts/` with the shape `{ id, version, schema, build }` and are registered in `src/lib/ai/prompts/registry.ts`.
- `AI_TASKS` are exactly `'grade' | 'plan' | 'distractors' | 'autocomplete'` (`src/lib/ai/model-routing.ts`). Session insight routes via **`'grade'`**. Do not invent a new task.
- Commit after every task. Never commit `.env`.

---

## File Structure

**Created:**
- `prisma/migrations/<timestamp>_study_sessions/migration.sql` — schema + envelope backfill
- `src/lib/memory/latency.ts` — latency normalization (pure)
- `src/lib/memory/summarize.ts` — `summarizeSession()` + types (pure)
- `src/lib/ai/prompts/session-insight.ts` — AI half of the insight
- `src/lib/memory/insight.ts` — `SessionInsight` Zod schema + version constant
- `src/lib/memory/activity-labels.ts` — activity display names + duration formatting (shared with Phase 2)
- `src/actions/study-session.ts` — session lifecycle + insight generation actions
- `src/actions/match-session.ts` — records a completed standalone matching game
- `src/components/memory/SessionInsightView.tsx` — renders one insight; shared by the live results screen and the permalink
- `src/lib/quiz/question-timer.ts` — per-question wall-clock timing (pure factory)
- `src/app/profile/activity/[id]/page.tsx` — activity detail permalink
- `tests/memory/latency.test.ts`, `tests/memory/summarize.test.ts`, `tests/memory/insight.test.ts`, `tests/memory/record.test.ts`, `tests/actions/study-session.test.ts`, `tests/quiz/question-timer.test.ts`

**Modified:**
- `prisma/schema.prisma` — `StudySession` model; `QuizAttempt.sessionId`; `StudyEvent.sessionId` + `confidenceBefore`; `QuizAnswer.latencyMs`
- `src/lib/memory/scoring.ts` — add `masteryBucket()`
- `src/lib/memory/record.ts` — accept + persist `sessionId`, `confidenceBefore`, normalized latency
- `src/lib/game/match.ts` — `misses` tracking + `matchResults()`
- `src/components/game/MatchGame.tsx` — session start/finish wiring
- `src/actions/confidence.ts` — thread `sessionId` + latency through `recordReview`
- `src/actions/quiz.ts` — open session with attempt; accept `latencyMs`; summary reads persisted insight
- `src/actions/user.ts`, `src/actions/memory.ts` — use shared `masteryBucket`
- `src/components/quiz/QuizContainer.tsx` — per-question timing, finish session
- `src/components/quiz/QuizSummary.tsx` — accept insight as a prop (extraction for reuse)
- `src/lib/ai/prompts/registry.ts` — register session-insight, drop quiz-summary
- `tests/game/match.test.ts`, `tests/memory/scoring.test.ts`, `tests/ai/prompts.test.ts` — extend

**Deleted:**
- `src/lib/ai/prompts/quiz-summary.ts` (superseded — Task 13)

---

### Task 1: Schema and envelope migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_study_sessions/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: Prisma models `StudySession` (fields `id`, `userId`, `setId`, `kind`, `startedAt`, `endedAt`, `durationMs`, `itemCount`, `categoryIds`, `insight`, `insightAt`); `QuizAttempt.sessionId: string | null`; `StudyEvent.sessionId: string | null`; `StudyEvent.confidenceBefore: number | null`; `QuizAnswer.latencyMs: number | null`

**Why `confidenceBefore`:** the spec's `confidence.avgDelta` needs a before-value. `StudyEvent` stores only `confidenceAfter`, but `recordStudyEvent` already reads `oldConfidence` (`src/lib/memory/record.ts:61`) — persisting it makes deltas exact instead of reconstructed.

- [ ] **Step 1: Add the `StudySession` model to `prisma/schema.prisma`**

Add after the `StudyEvent` model (around line 229):

```prisma
/// Stage 6 follow-on: the envelope for one study activity. Every mode (quiz,
/// standalone matching game, review/confidence ranking) opens one of these so
/// the history feed can present them as comparable, timed activities.
model StudySession {
  id          String       @id @default(cuid())
  userId      String
  setId       String
  kind        String       // "quiz" | "matching" | "confidence"
  startedAt   DateTime     @default(now())
  endedAt     DateTime?
  // Denormalized rather than derived from endedAt - startedAt: the activity
  // feed sorts and aggregates on duration, and computing it per row blocks
  // index use and is undefined for a session that was never closed.
  durationMs  Int?
  itemCount   Int          @default(0)
  categoryIds Json?        // what the session was scoped to at launch
  insight     Json?        // persisted SessionInsight (src/lib/memory/insight.ts)
  insightAt   DateTime?
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  set         Set          @relation(fields: [setId], references: [id], onDelete: Cascade)
  attempt     QuizAttempt?
  events      StudyEvent[]

  @@index([userId, startedAt])
  @@index([userId, kind, startedAt])
}
```

- [ ] **Step 2: Add the relation fields to the four existing models**

In `model StudyEvent` (line 212), add before the `@@index` lines:

```prisma
  sessionId       String?
  confidenceBefore Int?
  session         StudySession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)
```

and add this index alongside the existing ones:

```prisma
  @@index([sessionId])
```

In `model QuizAttempt` (line 282), add before `@@index`:

```prisma
  sessionId       String?      @unique
  session         StudySession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)
```

In `model QuizAnswer` (line 306), add after `score`:

```prisma
  latencyMs     Int?
```

In `model User`, add to the relation list:

```prisma
  studySessions StudySession[]
```

In `model Set`, add to the relation list:

```prisma
  studySessions StudySession[]
```

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name study_sessions --create-only`
Expected: a new `prisma/migrations/<timestamp>_study_sessions/migration.sql` containing `CREATE TABLE "StudySession"` and four `ALTER TABLE` statements. Do **not** apply it yet.

- [ ] **Step 4: Append the envelope backfill to the generated migration.sql**

Append verbatim to the bottom of the generated `migration.sql`:

```sql
-- Envelope backfill: give every pre-existing QuizAttempt a StudySession so the
-- activity feed reads from one table instead of UNIONing sessions with
-- session-less attempts. The session reuses the attempt's own id, which is
-- already unique and makes the link deterministic and trivially reversible.
-- Only the envelope is backfilled: durationMs, endedAt and insight stay NULL
-- because that data was never recorded and must not be invented.
INSERT INTO "StudySession" ("id", "userId", "setId", "kind", "startedAt", "itemCount", "categoryIds")
SELECT
  a."id",
  a."userId",
  a."setId",
  'quiz',
  a."createdAt",
  (SELECT COUNT(*) FROM "QuizAnswer" ans WHERE ans."attemptId" = a."id"),
  a."categoryIds"
FROM "QuizAttempt" a;

UPDATE "QuizAttempt" SET "sessionId" = "id";
```

- [ ] **Step 5: Apply the migration and regenerate the client**

Run: `npx prisma migrate dev`
Expected: migration applies cleanly, `prisma generate` runs.

- [ ] **Step 6: Verify the backfill linked every attempt**

Run:
```bash
npx prisma db execute --stdin <<'SQL'
SELECT
  (SELECT COUNT(*) FROM "QuizAttempt") AS attempts,
  (SELECT COUNT(*) FROM "QuizAttempt" WHERE "sessionId" IS NOT NULL) AS linked,
  (SELECT COUNT(*) FROM "StudySession" WHERE kind = 'quiz') AS sessions;
SQL
```
Expected: `attempts`, `linked`, and `sessions` are all equal.

- [ ] **Step 7: Confirm the existing suite still passes**

Run: `npm test`
Expected: PASS (no test touches these columns yet).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add StudySession envelope, per-item latency, confidenceBefore"
```

---

### Task 2: `masteryBucket` pure function

**Files:**
- Modify: `src/lib/memory/scoring.ts`
- Modify: `src/actions/user.ts:64`, `src/actions/memory.ts:230-233`
- Test: `tests/memory/scoring.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type MasteryBucket = 'mastered' | 'solid' | 'shaky' | 'struggling'`; `masteryBucket(input: { confidence: number; mastery?: number | null }): MasteryBucket`; `MASTERED_MIN_MASTERY = 80`, `MASTERED_MIN_CONFIDENCE = 8`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory/scoring.test.ts`:

```ts
import { masteryBucket } from '../../src/lib/memory/scoring'

describe('masteryBucket', () => {
  it('requires both high mastery and high confidence for mastered', () => {
    expect(masteryBucket({ confidence: 9, mastery: 85 })).toBe('mastered')
    expect(masteryBucket({ confidence: 7, mastery: 85 })).toBe('solid')
    expect(masteryBucket({ confidence: 9, mastery: 50 })).toBe('solid')
  })

  it('treats a null mastery as unknown, never as zero', () => {
    // Cards last touched before Stage 6 Task 4 have mastery === null. Reading
    // that as 0 would file a well-known card under Struggling.
    expect(masteryBucket({ confidence: 9, mastery: null })).toBe('solid')
    expect(masteryBucket({ confidence: 5, mastery: null })).toBe('shaky')
    expect(masteryBucket({ confidence: 2, mastery: null })).toBe('struggling')
  })

  it('falls through solid -> shaky -> struggling on confidence', () => {
    expect(masteryBucket({ confidence: 7, mastery: 10 })).toBe('solid')
    expect(masteryBucket({ confidence: 6, mastery: 10 })).toBe('shaky')
    expect(masteryBucket({ confidence: 4, mastery: 10 })).toBe('shaky')
    expect(masteryBucket({ confidence: 3, mastery: 10 })).toBe('struggling')
  })

  it('promotes on mastery alone at the solid threshold', () => {
    expect(masteryBucket({ confidence: 3, mastery: 65 })).toBe('solid')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/memory/scoring.test.ts -t masteryBucket`
Expected: FAIL — `masteryBucket is not a function`.

- [ ] **Step 3: Implement `masteryBucket`**

Append to `src/lib/memory/scoring.ts`:

```ts
/** The four buckets the Cards ledger and the Breakdown counts share. */
export type MasteryBucket = 'mastered' | 'solid' | 'shaky' | 'struggling'

export const MASTERED_MIN_MASTERY = 80
export const MASTERED_MIN_CONFIDENCE = 8
const SOLID_MIN_MASTERY = 60
const SOLID_MIN_CONFIDENCE = 7
const SHAKY_MIN_CONFIDENCE = 4

/**
 * Buckets a card's progress. One definition backs the distribution bar, the
 * bucket lists, and every "mastered" count in the app — previously each caller
 * inlined its own `confidence >= 8` rule.
 *
 * `mastery` is nullable (rows written before Stage 6 Task 4, or never scored)
 * and each rule must fall through on null rather than coercing it to 0: a card
 * with confidence 9 and no mastery score is Solid, not Struggling.
 */
export function masteryBucket({
  confidence,
  mastery,
}: {
  confidence: number
  mastery?: number | null
}): MasteryBucket {
  const scored = typeof mastery === 'number' ? mastery : null

  if (scored !== null && scored >= MASTERED_MIN_MASTERY && confidence >= MASTERED_MIN_CONFIDENCE) {
    return 'mastered'
  }
  if ((scored !== null && scored >= SOLID_MIN_MASTERY) || confidence >= SOLID_MIN_CONFIDENCE) {
    return 'solid'
  }
  if (confidence >= SHAKY_MIN_CONFIDENCE) return 'shaky'
  return 'struggling'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/scoring.test.ts -t masteryBucket`
Expected: PASS.

- [ ] **Step 5: Replace the inlined rule in `getUserStats`**

In `src/actions/user.ts`, add to the imports:

```ts
import { masteryBucket } from '@/lib/memory/scoring';
```

Replace line 64:

```ts
        masteredCards: progress.filter((p) => p.confidence >= 8).length,
```

with:

```ts
        masteredCards: progress.filter((p) => masteryBucket(p) === 'mastered').length,
```

- [ ] **Step 6: Replace the inlined rule in `getScopedMemoryStats`**

In `src/actions/memory.ts`, the mastered count is a Prisma `count` with `confidence: { gte: 8 }` (lines 230-233), which cannot express the two-field rule. Replace that `Promise.all` entry:

```ts
        scopedCardIds.length === 0
          ? Promise.resolve(0)
          : prisma.cardProgress.count({
              where: { userId, cardId: { in: scopedCardIds }, confidence: { gte: 8 } },
            }),
```

with a `findMany` that the shared function can bucket:

```ts
        // Bucketed in JS rather than counted in SQL: `masteryBucket` reads both
        // confidence AND mastery (with null-mastery fall-through), which a
        // single `count` predicate cannot express. Bounded by scopedCardIds.
        scopedCardIds.length === 0
          ? Promise.resolve([])
          : prisma.cardProgress.findMany({
              where: { userId, cardId: { in: scopedCardIds } },
              select: { confidence: true, mastery: true },
            }),
```

Then change the destructured name and the returned value:

```ts
    const [totals, correctness, scored, bySource, masteryRows] =
```

```ts
        masteredCards: masteryRows.filter((p) => masteryBucket(p) === 'mastered').length,
```

Add to the imports at the top of `src/actions/memory.ts`:

```ts
import { masteryBucket } from '@/lib/memory/scoring';
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

**Note for the reviewer:** mastered counts will *drop* for existing users — the old rule was `confidence >= 8` alone, the new one also requires `mastery >= 80`. This is the intended, more honest number.

- [ ] **Step 8: Commit**

```bash
git add src/lib/memory/scoring.ts src/actions/user.ts src/actions/memory.ts tests/memory/scoring.test.ts
git commit -m "feat(memory): add shared masteryBucket, replace inlined confidence>=8 rules"
```

---

### Task 3: Latency normalization

**Files:**
- Create: `src/lib/memory/latency.ts`
- Test: `tests/memory/latency.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `MAX_LATENCY_MS = 600000`; `normalizeLatency(ms: number | null | undefined): number | null`

- [ ] **Step 1: Write the failing test**

Create `tests/memory/latency.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeLatency, MAX_LATENCY_MS } from '../../src/lib/memory/latency'

describe('normalizeLatency', () => {
  it('passes through a plausible measurement, rounded', () => {
    expect(normalizeLatency(4200.7)).toBe(4201)
    expect(normalizeLatency(0)).toBe(0)
  })

  it('discards a measurement above the ceiling', () => {
    // The user walked away mid-question. One such value would wreck every
    // median and outlier calculation downstream, so it is recorded as
    // "unknown" rather than as a real 40-minute answer.
    expect(normalizeLatency(MAX_LATENCY_MS + 1)).toBeNull()
  })

  it('keeps a measurement exactly at the ceiling', () => {
    expect(normalizeLatency(MAX_LATENCY_MS)).toBe(MAX_LATENCY_MS)
  })

  it('discards missing, negative, and non-finite values', () => {
    expect(normalizeLatency(undefined)).toBeNull()
    expect(normalizeLatency(null)).toBeNull()
    expect(normalizeLatency(-1)).toBeNull()
    expect(normalizeLatency(NaN)).toBeNull()
    expect(normalizeLatency(Infinity)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/memory/latency.test.ts`
Expected: FAIL — cannot resolve `src/lib/memory/latency`.

- [ ] **Step 3: Implement**

Create `src/lib/memory/latency.ts`:

```ts
/**
 * Per-item timing is measured client-side (render -> submit), so it is
 * untrusted input: a user who walks away mid-question produces a 40-minute
 * "answer". Every latency is funnelled through here before it reaches the
 * database so one such value cannot distort medians, pacing, or outliers.
 */

/** Above this, the measurement is treated as "unknown" rather than real. */
export const MAX_LATENCY_MS = 10 * 60 * 1000

export function normalizeLatency(ms: number | null | undefined): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  if (ms < 0 || ms > MAX_LATENCY_MS) return null
  return Math.round(ms)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/memory/latency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/latency.ts tests/memory/latency.test.ts
git commit -m "feat(memory): add latency normalization with a walked-away ceiling"
```

---

### Task 4: Thread session, latency, and confidenceBefore through the write path

**Files:**
- Modify: `src/lib/memory/record.ts`
- Test: `tests/memory/record.test.ts` (create)

**Interfaces:**
- Consumes: `normalizeLatency` (Task 3)
- Produces: `RecordStudyEventInput` gains `sessionId?: string`; `meta.latencyMs` is now persisted through `normalizeLatency`; `StudyEvent.confidenceBefore` is written on every call

- [ ] **Step 1: Write the failing test**

Create `tests/memory/record.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        cardProgress: { findUnique: h.findUnique, upsert: h.upsert },
        studyEvent: { findMany: h.findMany, create: h.create },
      }),
  },
}))

import { recordStudyEvent } from '@/lib/memory/record'

beforeEach(() => {
  vi.clearAllMocks()
  h.findUnique.mockResolvedValue({ confidence: 5, reps: 0 })
  h.findMany.mockResolvedValue([])
  h.upsert.mockResolvedValue({})
  h.create.mockResolvedValue({})
})

describe('recordStudyEvent session/latency plumbing', () => {
  it('persists sessionId, confidenceBefore, and a normalized latency', async () => {
    await recordStudyEvent({
      userId: 'u1',
      cardId: 'c1',
      source: 'quiz-mc',
      outcome: { correct: true },
      sessionId: 's1',
      meta: { latencyMs: 4200.7 },
    })

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 's1',
          confidenceBefore: 5,
          confidenceAfter: 6,
          latencyMs: 4201,
        }),
      }),
    )
  })

  it('stores an implausible latency as null rather than as a real duration', async () => {
    await recordStudyEvent({
      userId: 'u1',
      cardId: 'c1',
      source: 'review',
      outcome: { correct: false },
      meta: { latencyMs: 45 * 60 * 1000 },
    })

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latencyMs: null, sessionId: undefined }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/memory/record.test.ts`
Expected: FAIL — `sessionId` and `confidenceBefore` are absent from the create payload.

- [ ] **Step 3: Implement**

In `src/lib/memory/record.ts`, add the import:

```ts
import { normalizeLatency } from './latency'
```

Add `sessionId` to `RecordStudyEventInput` (after `source`):

```ts
  /** Groups this event under a StudySession. Absent for write paths with no
   *  session envelope (e.g. a one-off action outside any activity). */
  sessionId?: string
```

Change the destructure on line 47:

```ts
  const { userId, cardId, source, outcome, sessionId, meta } = input
```

Replace the `tx.studyEvent.create` block (lines 112-122):

```ts
    await tx.studyEvent.create({
      data: {
        userId,
        cardId,
        sessionId,
        source,
        correct,
        score,
        confidenceBefore: oldConfidence,
        confidenceAfter: confidence,
        latencyMs: normalizeLatency(meta?.latencyMs),
      },
    })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/memory/record.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/record.ts tests/memory/record.test.ts
git commit -m "feat(memory): thread sessionId, confidenceBefore, and normalized latency into StudyEvent"
```

---

### Task 5: Matching game miss tracking

**Files:**
- Modify: `src/lib/game/match.ts`
- Test: `tests/game/match.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `MatchGameState.misses: Record<string, number>`; `matchResults(state: MatchGameState): { cardId: string; correct: boolean }[]`

**Why:** `selectTile` currently tracks only `matched[]`, so there is no way to say whether a card was matched *well*. Correctness for the `StudyEvent` becomes "matched on the first try."

- [ ] **Step 1: Write the failing tests**

Append to `tests/game/match.test.ts`:

```ts
import { matchResults } from '../../src/lib/game/match';

describe('miss tracking', () => {
  // Tile ids are random, so find them by content rather than by index.
  const tileFor = (state: MatchGameState, cardId: string, side: 'term' | 'definition') =>
    state.tiles.find(t => t.cardId === cardId && t.side === side)!.id;

  it('starts with no misses', () => {
    expect(initMatchGame(mockCards).misses).toEqual({});
  });

  it('records a miss against both cards in a wrong pairing', () => {
    let state = initMatchGame(mockCards);
    state = selectTile(state, tileFor(state, '1', 'term'));
    state = selectTile(state, tileFor(state, '2', 'definition'));

    expect(state.misses).toEqual({ '1': 1, '2': 1 });
  });

  it('does not record a miss on a correct pairing', () => {
    let state = initMatchGame(mockCards);
    state = selectTile(state, tileFor(state, '1', 'term'));
    state = selectTile(state, tileFor(state, '1', 'definition'));

    expect(state.misses).toEqual({});
  });
});

describe('matchResults', () => {
  const tileFor = (state: MatchGameState, cardId: string, side: 'term' | 'definition') =>
    state.tiles.find(t => t.cardId === cardId && t.side === side)!.id;

  it('marks a first-try match correct and a recovered one wrong', () => {
    let state = initMatchGame(mockCards);
    // Card 1 is matched only after a wrong guess against card 2.
    state = selectTile(state, tileFor(state, '1', 'term'));
    state = selectTile(state, tileFor(state, '2', 'definition'));
    state = selectTile(state, tileFor(state, '1', 'term'));
    state = selectTile(state, tileFor(state, '1', 'definition'));
    // Card 2 is then matched cleanly — but it already carries a miss.
    state = selectTile(state, tileFor(state, '2', 'term'));
    state = selectTile(state, tileFor(state, '2', 'definition'));

    expect(matchResults(state)).toEqual(
      expect.arrayContaining([
        { cardId: '1', correct: false },
        { cardId: '2', correct: false },
      ]),
    );
  });

  it('returns one row per distinct card, not one per tile', () => {
    const state = initMatchGame(mockCards);
    expect(matchResults(state)).toHaveLength(2);
  });

  it('marks every card correct in a flawless game', () => {
    let state = initMatchGame(mockCards);
    state = selectTile(state, tileFor(state, '1', 'term'));
    state = selectTile(state, tileFor(state, '1', 'definition'));
    state = selectTile(state, tileFor(state, '2', 'term'));
    state = selectTile(state, tileFor(state, '2', 'definition'));

    expect(matchResults(state).every(r => r.correct)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/game/match.test.ts`
Expected: FAIL — `misses` is undefined and `matchResults` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/game/match.ts`, add to `MatchGameState`:

```ts
  /** Wrong-pairing count per cardId. A card matched on the first try has none. */
  misses: Record<string, number>;
```

Add `misses: {},` to the object returned by `initMatchGame`.

In `selectTile`, in the branch where two tiles are selected and their `cardId`s do **not** match, return the new state with both cards' miss counts incremented — a wrong pairing implicates both tiles, and there is no basis for blaming one:

```ts
    const misses = {
      ...state.misses,
      [first.cardId]: (state.misses[first.cardId] ?? 0) + 1,
      [second.cardId]: (state.misses[second.cardId] ?? 0) + 1,
    };
```

Include `misses` in that branch's returned state. Every other `return` in `selectTile` must carry `misses: state.misses` through unchanged (the existing `...state` spreads already do this — verify each branch).

Append the pure reader:

```ts
/**
 * One result per distinct card. Correct means "matched on the first try":
 * recovering after a wrong guess still means the pairing wasn't known, which
 * is the signal study memory should record.
 */
export function matchResults(state: MatchGameState): { cardId: string; correct: boolean }[] {
  const cardIds = Array.from(new Set(state.tiles.map((t) => t.cardId)));
  return cardIds.map((cardId) => ({
    cardId,
    correct: (state.misses[cardId] ?? 0) === 0,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/game/match.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/game/match.ts tests/game/match.test.ts
git commit -m "feat(game): track wrong pairings so matching can report per-card correctness"
```

---

### Task 6: `summarizeSession` — accuracy and pacing

**Files:**
- Create: `src/lib/memory/summarize.ts`
- Test: `tests/memory/summarize.test.ts`

**Interfaces:**
- Consumes: `StudySource` from `src/lib/memory/scoring.ts`
- Produces: `SessionItem`, `SessionComputed`, `summarizeSession(items: SessionItem[]): SessionComputed`. Task 7 extends the same function; Tasks 11-12 consume `SessionComputed`.

- [ ] **Step 1: Write the failing tests**

Create `tests/memory/summarize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { summarizeSession, type SessionItem } from '../../src/lib/memory/summarize'

const item = (over: Partial<SessionItem> = {}): SessionItem => ({
  cardId: 'c1',
  term: 'WACC',
  source: 'quiz-mc',
  correct: true,
  score: null,
  confidenceBefore: 5,
  confidenceAfter: 6,
  latencyMs: 1000,
  categoryNames: ['Valuation'],
  ...over,
})

describe('summarizeSession', () => {
  it('returns an empty-but-valid shape for a session with no items', () => {
    const result = summarizeSession([])
    expect(result.itemCount).toBe(0)
    expect(result.byCategory).toEqual([])
    expect(result.byMode).toEqual([])
    expect(result.pacing.medianLatencyMs).toBeNull()
    expect(result.pacing.fastest).toBeNull()
  })

  it('counts accuracy per category', () => {
    const result = summarizeSession([
      item({ cardId: 'a', categoryNames: ['Valuation'], correct: true }),
      item({ cardId: 'b', categoryNames: ['Valuation'], correct: false }),
      item({ cardId: 'c', categoryNames: ['Accounting'], correct: true }),
    ])

    expect(result.byCategory).toEqual([
      { name: 'Accounting', correct: 1, total: 1, accuracyPct: 100 },
      { name: 'Valuation', correct: 1, total: 2, accuracyPct: 50 },
    ])
  })

  it('counts a multi-category card under each of its categories', () => {
    const result = summarizeSession([
      item({ categoryNames: ['Valuation', 'Vocabulary'], correct: true }),
    ])
    expect(result.byCategory.map((c) => c.name)).toEqual(['Valuation', 'Vocabulary'])
  })

  it('buckets uncategorized cards explicitly', () => {
    const result = summarizeSession([item({ categoryNames: [] })])
    expect(result.byCategory).toEqual([
      { name: 'Uncategorized', correct: 1, total: 1, accuracyPct: 100 },
    ])
  })

  it('reports per-mode accuracy, average score, and median latency', () => {
    const result = summarizeSession([
      item({ source: 'quiz-sa', correct: true, score: 90, latencyMs: 1000 }),
      item({ source: 'quiz-sa', correct: false, score: 40, latencyMs: 3000 }),
      item({ source: 'quiz-mc', correct: true, score: null, latencyMs: 500 }),
    ])

    const sa = result.byMode.find((m) => m.mode === 'quiz-sa')!
    expect(sa).toEqual({
      mode: 'quiz-sa',
      correct: 1,
      total: 2,
      avgScore: 65,
      medianLatencyMs: 2000,
    })

    const mc = result.byMode.find((m) => m.mode === 'quiz-mc')!
    expect(mc.avgScore).toBeNull()
  })

  it('takes the median of an odd-length series and the mean of the middle two on even', () => {
    const odd = summarizeSession([
      item({ latencyMs: 100 }),
      item({ latencyMs: 900 }),
      item({ latencyMs: 200 }),
    ])
    expect(odd.pacing.medianLatencyMs).toBe(200)

    const even = summarizeSession([item({ latencyMs: 100 }), item({ latencyMs: 400 })])
    expect(even.pacing.medianLatencyMs).toBe(250)
  })

  it('ignores unknown latencies entirely rather than treating them as zero', () => {
    const result = summarizeSession([
      item({ latencyMs: null }),
      item({ latencyMs: 400 }),
      item({ latencyMs: null }),
    ])
    expect(result.pacing.medianLatencyMs).toBe(400)
  })

  it('names the fastest and slowest timed items', () => {
    const result = summarizeSession([
      item({ cardId: 'slow', term: 'Deferred tax', latencyMs: 9000 }),
      item({ cardId: 'fast', term: 'EBITDA', latencyMs: 300 }),
      item({ cardId: 'untimed', term: 'Beta', latencyMs: null }),
    ])

    expect(result.pacing.fastest).toEqual({ cardId: 'fast', term: 'EBITDA', latencyMs: 300 })
    expect(result.pacing.slowest).toEqual({
      cardId: 'slow',
      term: 'Deferred tax',
      latencyMs: 9000,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/memory/summarize.test.ts`
Expected: FAIL — cannot resolve `src/lib/memory/summarize`.

- [ ] **Step 3: Implement**

Create `src/lib/memory/summarize.ts`:

```ts
import type { StudySource } from './scoring'

/** Bucket name for cards carrying no category, kept explicit in the output. */
export const UNCATEGORIZED_LABEL = 'Uncategorized'

/**
 * One recorded interaction, flattened for summarization. The caller joins the
 * StudyEvent rows to card terms and category names; this module stays pure so
 * every branch is testable without a database.
 */
export interface SessionItem {
  cardId: string
  term: string
  source: StudySource
  correct: boolean | null
  /** 0-100 for graded (short-answer) items, null otherwise. */
  score: number | null
  confidenceBefore: number | null
  confidenceAfter: number
  /** Already normalized; null means "not measured", never "instant". */
  latencyMs: number | null
  categoryNames: string[]
}

export interface CategoryStat {
  name: string
  correct: number
  total: number
  accuracyPct: number
}

export interface ModeStat {
  mode: StudySource
  correct: number
  total: number
  avgScore: number | null
  medianLatencyMs: number | null
}

export interface TimedItem {
  cardId: string
  term: string
  latencyMs: number
}

export interface SessionComputed {
  itemCount: number
  byCategory: CategoryStat[]
  byMode: ModeStat[]
  pacing: {
    medianLatencyMs: number | null
    fastest: TimedItem | null
    slowest: TimedItem | null
    byMode: { mode: StudySource; medianLatencyMs: number | null }[]
  }
}

/** Median of a numeric series. Returns null for an empty series. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function timed(items: SessionItem[]): TimedItem[] {
  return items
    .filter((i): i is SessionItem & { latencyMs: number } => i.latencyMs !== null)
    .map((i) => ({ cardId: i.cardId, term: i.term, latencyMs: i.latencyMs }))
}

/**
 * Deterministic breakdown of one study session. Zero cost, always present, and
 * the sole source of every number in a SessionInsight — the AI layer reads
 * this and writes prose, it never computes a figure of its own.
 */
export function summarizeSession(items: SessionItem[]): SessionComputed {
  const byCategory = new Map<string, { correct: number; total: number }>()
  for (const i of items) {
    const names = i.categoryNames.length > 0 ? i.categoryNames : [UNCATEGORIZED_LABEL]
    for (const name of names) {
      const bucket = byCategory.get(name) ?? { correct: 0, total: 0 }
      bucket.total += 1
      if (i.correct === true) bucket.correct += 1
      byCategory.set(name, bucket)
    }
  }

  const byMode = new Map<StudySource, SessionItem[]>()
  for (const i of items) {
    const bucket = byMode.get(i.source) ?? []
    bucket.push(i)
    byMode.set(i.source, bucket)
  }

  const allTimed = timed(items)
  const latencies = allTimed.map((t) => t.latencyMs)

  const modeStats: ModeStat[] = Array.from(byMode.entries())
    .map(([mode, group]) => {
      const scores = group
        .map((g) => g.score)
        .filter((s): s is number => typeof s === 'number')
      return {
        mode,
        correct: group.filter((g) => g.correct === true).length,
        total: group.length,
        avgScore:
          scores.length > 0
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : null,
        medianLatencyMs: median(timed(group).map((t) => t.latencyMs)),
      }
    })
    .sort((a, b) => a.mode.localeCompare(b.mode))

  return {
    itemCount: items.length,
    byCategory: Array.from(byCategory.entries())
      .map(([name, { correct, total }]) => ({
        name,
        correct,
        total,
        accuracyPct: Math.round((correct / total) * 100),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    byMode: modeStats,
    pacing: {
      medianLatencyMs: median(latencies),
      fastest:
        allTimed.length > 0
          ? allTimed.reduce((min, t) => (t.latencyMs < min.latencyMs ? t : min))
          : null,
      slowest:
        allTimed.length > 0
          ? allTimed.reduce((max, t) => (t.latencyMs > max.latencyMs ? t : max))
          : null,
      byMode: modeStats.map((m) => ({ mode: m.mode, medianLatencyMs: m.medianLatencyMs })),
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/summarize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/summarize.ts tests/memory/summarize.test.ts
git commit -m "feat(memory): add pure summarizeSession with category, mode, and pacing stats"
```

---

### Task 7: `summarizeSession` — confidence movement and outliers

**Files:**
- Modify: `src/lib/memory/summarize.ts`
- Test: `tests/memory/summarize.test.ts`

**Interfaces:**
- Consumes: `SessionItem`, `SessionComputed`, `median` (Task 6)
- Produces: `SessionComputed` gains `confidence: { avgDelta, newlyMastered, dropped }` and `outliers: { rushed, laboured }`

**Definitions** (chosen so they need only data that is actually recorded):
- `newlyMastered` — `confidenceBefore < 8 && confidenceAfter >= 8`
- `dropped` — `confidenceAfter < confidenceBefore`
- `rushed` — wrong **and** faster than half the session median
- `laboured` — wrong **and** slower than twice the session median

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory/summarize.test.ts`:

```ts
describe('summarizeSession confidence and outliers', () => {
  it('averages the confidence delta across items', () => {
    const result = summarizeSession([
      item({ confidenceBefore: 5, confidenceAfter: 6 }),
      item({ confidenceBefore: 5, confidenceAfter: 3 }),
    ])
    expect(result.confidence.avgDelta).toBe(-0.5)
  })

  it('ignores items with no recorded before-value', () => {
    // Events written before confidenceBefore existed carry null; averaging
    // them in as a zero delta would understate real movement.
    const result = summarizeSession([
      item({ confidenceBefore: null, confidenceAfter: 9 }),
      item({ confidenceBefore: 4, confidenceAfter: 6 }),
    ])
    expect(result.confidence.avgDelta).toBe(2)
  })

  it('returns a null delta when nothing is measurable', () => {
    const result = summarizeSession([item({ confidenceBefore: null, confidenceAfter: 5 })])
    expect(result.confidence.avgDelta).toBeNull()
  })

  it('names cards that crossed into mastery and cards that slipped', () => {
    const result = summarizeSession([
      item({ cardId: 'up', term: 'EBITDA', confidenceBefore: 7, confidenceAfter: 8 }),
      item({ cardId: 'down', term: 'WACC', confidenceBefore: 6, confidenceAfter: 5 }),
      item({ cardId: 'flat', term: 'Beta', confidenceBefore: 5, confidenceAfter: 5 }),
    ])

    expect(result.confidence.newlyMastered).toEqual([{ cardId: 'up', term: 'EBITDA' }])
    expect(result.confidence.dropped).toEqual([{ cardId: 'down', term: 'WACC' }])
  })

  it('does not re-report an already-mastered card as newly mastered', () => {
    const result = summarizeSession([
      item({ confidenceBefore: 9, confidenceAfter: 10 }),
    ])
    expect(result.confidence.newlyMastered).toEqual([])
  })

  it('flags wrong-and-fast as rushed and wrong-and-slow as laboured', () => {
    // Median latency across the five items is 1000ms.
    const result = summarizeSession([
      item({ cardId: 'a', latencyMs: 1000, correct: true }),
      item({ cardId: 'b', latencyMs: 1000, correct: true }),
      item({ cardId: 'c', latencyMs: 1000, correct: true }),
      item({ cardId: 'rush', term: 'WACC', latencyMs: 200, correct: false }),
      item({ cardId: 'slog', term: 'DCF', latencyMs: 5000, correct: false }),
    ])

    expect(result.outliers.rushed).toEqual([
      { cardId: 'rush', term: 'WACC', latencyMs: 200 },
    ])
    expect(result.outliers.laboured).toEqual([
      { cardId: 'slog', term: 'DCF', latencyMs: 5000 },
    ])
  })

  it('never flags a correct answer as an outlier however fast it was', () => {
    const result = summarizeSession([
      item({ latencyMs: 1000, correct: false }),
      item({ latencyMs: 1000, correct: false }),
      item({ cardId: 'quick', latencyMs: 10, correct: true }),
    ])
    expect(result.outliers.rushed).toEqual([])
  })

  it('reports no outliers when nothing was timed', () => {
    const result = summarizeSession([item({ latencyMs: null, correct: false })])
    expect(result.outliers.rushed).toEqual([])
    expect(result.outliers.laboured).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/memory/summarize.test.ts -t "confidence and outliers"`
Expected: FAIL — `result.confidence` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/memory/summarize.ts`, add the constants and types:

```ts
/** Confidence at or above this counts as mastered, matching masteryBucket. */
const MASTERY_CONFIDENCE = 8
/** Wrong answers faster than this fraction of the median are "rushed". */
const RUSHED_FRACTION = 0.5
/** Wrong answers slower than this multiple of the median are "laboured". */
const LABOURED_MULTIPLE = 2

export interface CardRef {
  cardId: string
  term: string
}
```

Extend `SessionComputed` with:

```ts
  confidence: {
    /** Mean of (after - before), one decimal. Null when nothing is measurable. */
    avgDelta: number | null
    newlyMastered: CardRef[]
    dropped: CardRef[]
  }
  outliers: {
    rushed: TimedItem[]
    laboured: TimedItem[]
  }
```

In `summarizeSession`, before the `return`:

```ts
  const deltas = items
    .filter((i) => i.confidenceBefore !== null)
    .map((i) => i.confidenceAfter - (i.confidenceBefore as number))

  const sessionMedian = median(latencies)
  const wrongTimed = allTimed.filter((t) =>
    items.some((i) => i.cardId === t.cardId && i.correct === false),
  )
```

and add to the returned object:

```ts
    confidence: {
      avgDelta:
        deltas.length > 0
          ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10
          : null,
      newlyMastered: items
        .filter(
          (i) =>
            i.confidenceBefore !== null &&
            i.confidenceBefore < MASTERY_CONFIDENCE &&
            i.confidenceAfter >= MASTERY_CONFIDENCE,
        )
        .map((i) => ({ cardId: i.cardId, term: i.term })),
      dropped: items
        .filter((i) => i.confidenceBefore !== null && i.confidenceAfter < i.confidenceBefore)
        .map((i) => ({ cardId: i.cardId, term: i.term })),
    },
    outliers: {
      // Outliers are only meaningful relative to a median, and only a WRONG
      // answer is diagnostic — a fast correct answer is just fluency.
      rushed:
        sessionMedian === null
          ? []
          : wrongTimed.filter((t) => t.latencyMs < sessionMedian * RUSHED_FRACTION),
      laboured:
        sessionMedian === null
          ? []
          : wrongTimed.filter((t) => t.latencyMs > sessionMedian * LABOURED_MULTIPLE),
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/summarize.test.ts`
Expected: PASS, including Task 6's tests. Update Task 6's "empty shape" assertion to also expect `confidence.avgDelta === null` and empty outlier arrays.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/summarize.ts tests/memory/summarize.test.ts
git commit -m "feat(memory): add confidence movement and pacing outliers to summarizeSession"
```

---

### Task 8: `SessionInsight` schema

**Files:**
- Create: `src/lib/memory/insight.ts`
- Test: `tests/memory/insight.test.ts`

**Interfaces:**
- Consumes: `SessionComputed` (Tasks 6-7)
- Produces: `SESSION_INSIGHT_VERSION = 1`; `SessionInsightAiSchema` (the AI contract); `SessionInsightSchema` (the persisted blob); `type SessionInsight`; `type SessionInsightAi`

- [ ] **Step 1: Write the failing test**

Create `tests/memory/insight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SessionInsightSchema, SessionInsightAiSchema } from '../../src/lib/memory/insight'
import { summarizeSession } from '../../src/lib/memory/summarize'

const computed = summarizeSession([])

describe('SessionInsightSchema', () => {
  it('accepts a computed-only insight (matching and review sessions)', () => {
    const parsed = SessionInsightSchema.parse({ version: 1, computed, ai: null })
    expect(parsed.ai).toBeNull()
  })

  it('rejects an unknown version so a stale blob cannot be misread', () => {
    expect(() => SessionInsightSchema.parse({ version: 2, computed, ai: null })).toThrow()
  })

  it('rejects a blob with no computed block', () => {
    expect(() => SessionInsightSchema.parse({ version: 1, ai: null })).toThrow()
  })
})

describe('SessionInsightAiSchema', () => {
  const focusArea = {
    title: 'DCF terminal value',
    severity: 'high' as const,
    evidence: 'Missed 3 of 3.',
    action: 'Re-read the 4 terminal-value cards, then focus-quiz them.',
    cardIds: ['c1'],
  }

  it('accepts a well-formed ranked list', () => {
    const parsed = SessionInsightAiSchema.parse({
      focusAreas: [focusArea],
      strengths: 'Accounting definitions were solid.',
    })
    expect(parsed.focusAreas).toHaveLength(1)
  })

  it('rejects an invented severity', () => {
    expect(() =>
      SessionInsightAiSchema.parse({
        focusAreas: [{ ...focusArea, severity: 'catastrophic' }],
        strengths: 'x',
      }),
    ).toThrow()
  })

  it('caps the list so one call cannot flood the summary', () => {
    expect(() =>
      SessionInsightAiSchema.parse({
        focusAreas: Array.from({ length: 6 }, () => focusArea),
        strengths: 'x',
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/memory/insight.test.ts`
Expected: FAIL — cannot resolve `src/lib/memory/insight`.

- [ ] **Step 3: Implement**

Create `src/lib/memory/insight.ts`:

```ts
import { z } from 'zod'

/**
 * Bump when the persisted shape changes incompatibly. Readers parse with the
 * schema and fall back to regenerating rather than rendering a stale blob.
 */
export const SESSION_INSIGHT_VERSION = 1

/** How many focus areas a single session may surface. */
export const MAX_FOCUS_AREAS = 5

const CardRefSchema = z.object({
  cardId: z.string(),
  term: z.string(),
})

const TimedItemSchema = CardRefSchema.extend({
  latencyMs: z.number(),
})

/** Mirrors SessionComputed in src/lib/memory/summarize.ts. */
export const SessionComputedSchema = z.object({
  itemCount: z.number(),
  byCategory: z.array(
    z.object({
      name: z.string(),
      correct: z.number(),
      total: z.number(),
      accuracyPct: z.number(),
    }),
  ),
  byMode: z.array(
    z.object({
      mode: z.string(),
      correct: z.number(),
      total: z.number(),
      avgScore: z.number().nullable(),
      medianLatencyMs: z.number().nullable(),
    }),
  ),
  pacing: z.object({
    medianLatencyMs: z.number().nullable(),
    fastest: TimedItemSchema.nullable(),
    slowest: TimedItemSchema.nullable(),
    byMode: z.array(
      z.object({ mode: z.string(), medianLatencyMs: z.number().nullable() }),
    ),
  }),
  confidence: z.object({
    avgDelta: z.number().nullable(),
    newlyMastered: z.array(CardRefSchema),
    dropped: z.array(CardRefSchema),
  }),
  outliers: z.object({
    rushed: z.array(TimedItemSchema),
    laboured: z.array(TimedItemSchema),
  }),
})

/**
 * The AI's half of the contract. It reads the computed block and writes prose;
 * every number stays in `computed`, so the model can never fabricate a stat.
 */
export const SessionInsightAiSchema = z.object({
  focusAreas: z
    .array(
      z.object({
        title: z.string(),
        severity: z.enum(['high', 'medium', 'low']),
        evidence: z.string(),
        action: z.string(),
        cardIds: z.array(z.string()),
      }),
    )
    .max(MAX_FOCUS_AREAS),
  strengths: z.string(),
})

/** The full blob persisted on StudySession.insight. */
export const SessionInsightSchema = z.object({
  version: z.literal(SESSION_INSIGHT_VERSION),
  computed: SessionComputedSchema,
  // Null for matching/confidence sessions (no AI by design), and for quizzes
  // whose generation failed or hasn't been requested yet.
  ai: SessionInsightAiSchema.nullable(),
})

export type SessionInsight = z.infer<typeof SessionInsightSchema>
export type SessionInsightAi = z.infer<typeof SessionInsightAiSchema>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/memory/insight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/insight.ts tests/memory/insight.test.ts
git commit -m "feat(memory): add versioned SessionInsight schema"
```

---

### Task 9: `SESSION_INSIGHT_PROMPT`

**Files:**
- Create: `src/lib/ai/prompts/session-insight.ts`
- Modify: `src/lib/ai/prompts/registry.ts`
- Test: `tests/ai/prompts.test.ts`

**Interfaces:**
- Consumes: `SessionInsightAiSchema` (Task 8), `SessionComputed` (Tasks 6-7), `learnerContextBlock` from `src/lib/ai/prompts/shared.ts`
- Produces: `SESSION_INSIGHT_PROMPT = { id: 'session-insight', version: 1, schema, build(input: SessionInsightBuildInput): string }`; `SessionInsightBuildInput = { setTitle: string; kind: string; computed: SessionComputed; profileBlock?: string }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/ai/prompts.test.ts`:

```ts
import { SESSION_INSIGHT_PROMPT } from '@/lib/ai/prompts/session-insight'
import { summarizeSession } from '@/lib/memory/summarize'

describe('SESSION_INSIGHT_PROMPT', () => {
  const computed = summarizeSession([
    {
      cardId: 'c1',
      term: 'WACC',
      source: 'quiz-mc',
      correct: false,
      score: null,
      confidenceBefore: 5,
      confidenceAfter: 4,
      latencyMs: 900,
      categoryNames: ['Valuation'],
    },
  ])
  const input = { setTitle: 'Finance 101', kind: 'quiz', computed }

  it('includes the computed figures the model must reason from', () => {
    const prompt = SESSION_INSIGHT_PROMPT.build(input)
    expect(prompt).toContain('Finance 101')
    expect(prompt).toContain('Valuation')
    expect(prompt).toContain('WACC')
  })

  it('instructs the model not to invent numbers', () => {
    expect(SESSION_INSIGHT_PROMPT.build(input).toLowerCase()).toContain('do not calculate')
  })

  it('includes the learner profile block only when one is supplied', () => {
    const without = SESSION_INSIGHT_PROMPT.build(input)
    const withBlock = SESSION_INSIGHT_PROMPT.build({ ...input, profileBlock: PROFILE_BLOCK })
    expect(withBlock.length).toBeGreaterThan(without.length)
    expect(withBlock).toContain(PROFILE_BLOCK)
  })
})
```

(`PROFILE_BLOCK` is already defined in this test file and used by the existing `QUIZ_SUMMARY_PROMPT` block.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ai/prompts.test.ts -t SESSION_INSIGHT`
Expected: FAIL — cannot resolve `@/lib/ai/prompts/session-insight`.

- [ ] **Step 3: Implement the prompt module**

Create `src/lib/ai/prompts/session-insight.ts`:

```ts
import { learnerContextBlock } from './shared';
import { SessionInsightAiSchema, MAX_FOCUS_AREAS } from '@/lib/memory/insight';
import type { SessionComputed } from '@/lib/memory/summarize';

export interface SessionInsightBuildInput {
  setTitle: string;
  /** "quiz" | "matching" | "confidence" */
  kind: string;
  computed: SessionComputed;
  profileBlock?: string;
}

function ms(value: number | null): string {
  return value === null ? 'not measured' : `${Math.round(value / 100) / 10}s`;
}

/**
 * Whole-session coaching. Replaces QUIZ_SUMMARY_PROMPT, which asked for one
 * free-text paragraph and was regenerated on every render.
 *
 * The model receives ONLY the deterministic `computed` block and returns ranked
 * focus areas plus a strengths narrative. It never computes a statistic — that
 * keeps the Stage 6 rule ("AI reads mastery, never calculates it") intact and
 * keeps every number in the UI traceable to `summarizeSession`.
 *
 * Routed via task 'grade' in generateJson.
 */
export const SESSION_INSIGHT_PROMPT = {
  id: 'session-insight',
  version: 1,
  schema: SessionInsightAiSchema,

  build(input: SessionInsightBuildInput): string {
    const { computed } = input;

    const categories = computed.byCategory
      .map((c) => `- ${c.name}: ${c.correct}/${c.total} correct (${c.accuracyPct}%)`)
      .join('\n') || '- none recorded';

    const modes = computed.byMode
      .map(
        (m) =>
          `- ${m.mode}: ${m.correct}/${m.total} correct` +
          (m.avgScore !== null ? `, avg score ${m.avgScore}/100` : '') +
          `, median time ${ms(m.medianLatencyMs)}`,
      )
      .join('\n') || '- none recorded';

    const rushed = computed.outliers.rushed
      .map((o) => `- ${o.term} (answered in ${ms(o.latencyMs)} and got it wrong)`)
      .join('\n') || '- none';

    const laboured = computed.outliers.laboured
      .map((o) => `- ${o.term} (took ${ms(o.latencyMs)} and still got it wrong)`)
      .join('\n') || '- none';

    const dropped = computed.confidence.dropped.map((c) => c.term).join(', ') || 'none';
    const mastered =
      computed.confidence.newlyMastered.map((c) => c.term).join(', ') || 'none';

    return `${learnerContextBlock(input.profileBlock)}You are a study coach reviewing one completed study session.

Set: ${input.setTitle}
Activity: ${input.kind}
Items: ${computed.itemCount}
Median time per item: ${ms(computed.pacing.medianLatencyMs)}
Average confidence change: ${computed.confidence.avgDelta ?? 'not measurable'}

Accuracy by category:
${categories}

Accuracy by question mode:
${modes}

Answered too fast and got wrong:
${rushed}

Laboured over and still got wrong:
${laboured}

Newly mastered: ${mastered}
Confidence dropped: ${dropped}

Every figure above is already computed. **Do not calculate, restate, or invent
any statistic** — cite the numbers given, and only those.

Return up to ${MAX_FOCUS_AREAS} focus areas, ranked most important first. Each must:
- name a specific concept or habit (not "study more")
- cite the evidence above that justifies it
- give one concrete action the learner can take next
- list the cardIds it relates to, drawn only from the session

Also write a short "strengths" note on what genuinely went well. If nothing did,
say so plainly rather than inventing praise.`;
  },
};
```

- [ ] **Step 4: Register the prompt**

In `src/lib/ai/prompts/registry.ts`, add alongside the existing exports and imports:

```ts
export { SESSION_INSIGHT_PROMPT } from './session-insight';
export type { SessionInsightBuildInput } from './session-insight';
```

```ts
import { SESSION_INSIGHT_PROMPT } from './session-insight';
```

and add to `PROMPT_REGISTRY`:

```ts
  [SESSION_INSIGHT_PROMPT.id]: SESSION_INSIGHT_PROMPT,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ai/prompts.test.ts`
Expected: PASS, including the existing `PROMPT_REGISTRY` consistency test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/prompts/session-insight.ts src/lib/ai/prompts/registry.ts tests/ai/prompts.test.ts
git commit -m "feat(ai): add session-insight prompt producing ranked focus areas"
```

---

### Task 10: Session lifecycle actions

**Files:**
- Create: `src/actions/study-session.ts`
- Test: `tests/actions/study-session.test.ts`

**Interfaces:**
- Consumes: `summarizeSession`, `SessionItem` (Tasks 6-7); `SessionInsightSchema`, `SESSION_INSIGHT_VERSION` (Task 8)
- Produces:
  - `startStudySession(input: { setId: string; kind: 'quiz' | 'matching' | 'confidence'; itemCount: number; categoryIds?: string[] }): Promise<ActionResult<{ sessionId: string }>>`
  - `finishStudySession(input: { sessionId: string }): Promise<ActionResult<{ durationMs: number | null }>>`
  - `STUDY_SESSION_KINDS` — the three literals

`finishStudySession` closes the session, builds `SessionItem[]` from its `StudyEvent`s, runs `summarizeSession`, and persists a computed-only insight. The AI half is Task 11.

- [ ] **Step 1: Write the failing tests**

Create `tests/actions/study-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionCreate: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionUpdate: vi.fn(),
  eventFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studySession: {
      create: h.sessionCreate,
      findFirst: h.sessionFindFirst,
      update: h.sessionUpdate,
    },
    studyEvent: { findMany: h.eventFindMany },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { startStudySession, finishStudySession } from '@/actions/study-session'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.eventFindMany.mockResolvedValue([])
})

describe('startStudySession', () => {
  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const result = await startStudySession({ setId: 's1', kind: 'quiz', itemCount: 5 })
    expect(result.success).toBe(false)
    expect(h.sessionCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown kind rather than writing a junk row', async () => {
    const result = await startStudySession({
      setId: 's1',
      // @ts-expect-error deliberately invalid
      kind: 'freestyle',
      itemCount: 5,
    })
    expect(result.success).toBe(false)
    expect(h.sessionCreate).not.toHaveBeenCalled()
  })

  it('creates the session owned by the session user', async () => {
    h.sessionCreate.mockResolvedValue({ id: 'sess1' })
    const result = await startStudySession({
      setId: 's1',
      kind: 'matching',
      itemCount: 12,
      categoryIds: ['cat1'],
    })

    expect(result.data).toEqual({ sessionId: 'sess1' })
    expect(h.sessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: OWNER,
        setId: 's1',
        kind: 'matching',
        itemCount: 12,
        categoryIds: ['cat1'],
      }),
    })
  })
})

describe('finishStudySession', () => {
  it('refuses a session belonging to someone else', async () => {
    // The id arrives from the client, so the lookup must be scoped by userId.
    h.sessionFindFirst.mockResolvedValue(null)
    const result = await finishStudySession({ sessionId: 'sess-other' })

    expect(result.success).toBe(false)
    expect(h.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-other', userId: OWNER } }),
    )
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent: a second finish does not rewrite the duration', async () => {
    const endedAt = new Date('2026-07-30T10:05:00Z')
    h.sessionFindFirst.mockResolvedValue({
      id: 'sess1',
      userId: OWNER,
      setId: 's1',
      kind: 'quiz',
      startedAt: new Date('2026-07-30T10:00:00Z'),
      endedAt,
      durationMs: 300000,
    })

    const result = await finishStudySession({ sessionId: 'sess1' })

    expect(result.data).toEqual({ durationMs: 300000 })
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('closes an open session and persists a computed-only insight', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 'sess1',
      userId: OWNER,
      setId: 's1',
      kind: 'matching',
      startedAt: new Date(Date.now() - 60000),
      endedAt: null,
      durationMs: null,
    })
    h.eventFindMany.mockResolvedValue([
      {
        cardId: 'c1',
        source: 'matching',
        correct: true,
        score: null,
        confidenceBefore: 5,
        confidenceAfter: 6,
        latencyMs: 1000,
        card: { term: 'WACC', categoryAssignments: [] },
      },
    ])
    h.sessionUpdate.mockResolvedValue({})

    const result = await finishStudySession({ sessionId: 'sess1' })

    expect(result.success).toBe(true)
    expect(result.data!.durationMs).toBeGreaterThan(0)

    const payload = h.sessionUpdate.mock.calls[0][0].data
    expect(payload.insight.version).toBe(1)
    expect(payload.insight.computed.itemCount).toBe(1)
    // Matching sessions get no AI narrative, by design.
    expect(payload.insight.ai).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/actions/study-session.test.ts`
Expected: FAIL — cannot resolve `@/actions/study-session`.

- [ ] **Step 3: Implement**

Create `src/actions/study-session.ts`:

```ts
'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { summarizeSession, type SessionItem } from '@/lib/memory/summarize';
import { SESSION_INSIGHT_VERSION, type SessionInsight } from '@/lib/memory/insight';
import type { StudySource } from '@/lib/memory/scoring';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export const STUDY_SESSION_KINDS = ['quiz', 'matching', 'confidence'] as const;
export type StudySessionKind = (typeof STUDY_SESSION_KINDS)[number];

export async function startStudySession(input: {
  setId: string;
  kind: StudySessionKind;
  itemCount: number;
  categoryIds?: string[];
}): Promise<ActionResult<{ sessionId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  // The kind reaches the DB as a plain string column, so it is validated here
  // rather than trusted from the client.
  if (!STUDY_SESSION_KINDS.includes(input.kind)) {
    return { success: false, error: 'Unknown study session kind' };
  }

  try {
    const created = await prisma.studySession.create({
      data: {
        userId: session.user.id,
        setId: input.setId,
        kind: input.kind,
        itemCount: input.itemCount,
        categoryIds: input.categoryIds ?? undefined,
      },
    });
    return { success: true, data: { sessionId: created.id } };
  } catch (error) {
    console.error('startStudySession error:', error);
    return { success: false, error: 'Failed to start study session' };
  }
}

/**
 * Closes a session, computes its deterministic insight, and persists it.
 *
 * Idempotent: a session that already carries an `endedAt` is returned as-is.
 * Quiz submit paths can fire this more than once (an overall submit plus a
 * navigation-away handler), and re-closing would otherwise inflate durations.
 */
export async function finishStudySession(input: {
  sessionId: string;
}): Promise<ActionResult<{ durationMs: number | null }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    // Scoped by userId: the id comes from the client and must never be
    // trusted on its own.
    const studySession = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId },
    });
    if (!studySession) return { success: false, error: 'Session not found' };

    if (studySession.endedAt) {
      return { success: true, data: { durationMs: studySession.durationMs } };
    }

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - studySession.startedAt.getTime();

    const events = await prisma.studyEvent.findMany({
      where: { userId, sessionId: studySession.id },
      include: {
        card: {
          select: {
            term: true,
            categoryAssignments: { select: { category: { select: { name: true } } } },
          },
        },
      },
    });

    const items: SessionItem[] = events.map((e) => ({
      cardId: e.cardId,
      term: e.card.term,
      source: e.source as StudySource,
      correct: e.correct,
      score: e.score,
      confidenceBefore: e.confidenceBefore,
      confidenceAfter: e.confidenceAfter,
      latencyMs: e.latencyMs,
      categoryNames: e.card.categoryAssignments.map((a) => a.category.name),
    }));

    // AI stays null here for every kind. Quizzes get their narrative from
    // generateSessionInsight, which the caller invokes after this resolves —
    // an AI failure must never leave a session unclosed.
    const insight: SessionInsight = {
      version: SESSION_INSIGHT_VERSION,
      computed: summarizeSession(items),
      ai: null,
    };

    await prisma.studySession.update({
      where: { id: studySession.id },
      data: { endedAt, durationMs, insight, insightAt: endedAt },
    });

    return { success: true, data: { durationMs } };
  } catch (error) {
    console.error('finishStudySession error:', error);
    return { success: false, error: 'Failed to finish study session' };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/actions/study-session.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/study-session.ts tests/actions/study-session.test.ts
git commit -m "feat(memory): add study session lifecycle actions with computed insight"
```

---

### Task 11: AI insight generation

**Files:**
- Modify: `src/actions/study-session.ts`
- Test: `tests/actions/study-session.test.ts`

**Interfaces:**
- Consumes: `SESSION_INSIGHT_PROMPT` (Task 9), `generateJson` from `src/lib/ai/generate.ts`, `safeProfileBlock` from `src/lib/ai/context.ts`
- Produces: `generateSessionInsight(input: { sessionId: string }): Promise<ActionResult<{ generated: boolean }>>`

Called by the quiz finish path (Task 14) and by the "Generate insights" button for legacy attempts (Task 15).

- [ ] **Step 1: Confirm the profile-block helper's import path**

Run: `grep -rn "safeProfileBlock" --include=*.ts src | head -3`
Expected: its defining module. Use that exact import path in Step 3.

- [ ] **Step 2: Write the failing tests**

Append to `tests/actions/study-session.test.ts` (and add these mocks next to the existing ones at the top of the file):

```ts
// Add to the `h` hoisted block: generateJson: vi.fn(), safeProfileBlock: vi.fn()
// Add alongside the existing vi.mock calls:
//   vi.mock('@/lib/ai/generate', () => ({ generateJson: h.generateJson }))
//   vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: h.safeProfileBlock }))

import { generateSessionInsight } from '@/actions/study-session'

describe('generateSessionInsight', () => {
  const openSession = {
    id: 'sess1',
    userId: OWNER,
    setId: 's1',
    kind: 'quiz',
    startedAt: new Date(),
    endedAt: new Date(),
    durationMs: 1000,
    insight: {
      version: 1,
      computed: { itemCount: 1, byCategory: [], byMode: [], pacing: {}, confidence: {}, outliers: {} },
      ai: null,
    },
    set: { title: 'Finance 101' },
  }

  it('writes the validated AI block onto the existing insight', async () => {
    h.sessionFindFirst.mockResolvedValue(openSession)
    h.safeProfileBlock.mockResolvedValue('')
    h.generateJson.mockResolvedValue({
      focusAreas: [
        {
          title: 'DCF terminal value',
          severity: 'high',
          evidence: 'Missed 3 of 3.',
          action: 'Re-read the terminal-value cards.',
          cardIds: ['c1'],
        },
      ],
      strengths: 'Accounting was solid.',
    })
    h.sessionUpdate.mockResolvedValue({})

    const result = await generateSessionInsight({ sessionId: 'sess1' })

    expect(result.data).toEqual({ generated: true })
    const payload = h.sessionUpdate.mock.calls[0][0].data
    expect(payload.insight.ai.focusAreas).toHaveLength(1)
    // The computed block must survive untouched — the AI never rewrites numbers.
    expect(payload.insight.computed.itemCount).toBe(1)
  })

  it('reports failure without throwing when generation fails', async () => {
    h.sessionFindFirst.mockResolvedValue(openSession)
    h.safeProfileBlock.mockResolvedValue('')
    h.generateJson.mockRejectedValue(new Error('no credentials'))

    const result = await generateSessionInsight({ sessionId: 'sess1' })

    expect(result.success).toBe(false)
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('refuses a session owned by someone else', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const result = await generateSessionInsight({ sessionId: 'sess-other' })
    expect(result.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('does nothing when the session has no computed insight to build on', async () => {
    h.sessionFindFirst.mockResolvedValue({ ...openSession, insight: null })
    const result = await generateSessionInsight({ sessionId: 'sess1' })
    expect(result.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Implement**

Append to `src/actions/study-session.ts`:

```ts
import { generateJson } from '@/lib/ai/generate';
import { safeProfileBlock } from '@/lib/ai/context'; // path confirmed in Step 1
import { SESSION_INSIGHT_PROMPT } from '@/lib/ai/prompts/registry';
import { SessionInsightSchema } from '@/lib/memory/insight';

/**
 * Adds the AI narrative to a session that already has a computed insight.
 *
 * Split from `finishStudySession` deliberately: closing a session must never
 * depend on an AI call succeeding. This is invoked after the finish resolves,
 * and by the "Generate insights" button on sessions that never got one.
 */
export async function generateSessionInsight(input: {
  sessionId: string;
}): Promise<ActionResult<{ generated: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const studySession = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId: session.user.id },
      include: { set: { select: { title: true } } },
    });
    if (!studySession) return { success: false, error: 'Session not found' };

    // Parsed rather than cast: a blob written by an older version must not be
    // half-read into a new-shaped prompt.
    const parsed = SessionInsightSchema.safeParse(studySession.insight);
    if (!parsed.success) {
      return { success: false, error: 'Session has no computed insight yet' };
    }

    const profileBlock = await safeProfileBlock(
      session.user.id,
      studySession.setId,
      'session-insight',
    );

    const ai = await generateJson({
      userId: session.user.id,
      task: 'grade',
      prompt: SESSION_INSIGHT_PROMPT.build({
        setTitle: studySession.set.title,
        kind: studySession.kind,
        computed: parsed.data.computed,
        profileBlock,
      }),
      schema: SESSION_INSIGHT_PROMPT.schema,
    });

    await prisma.studySession.update({
      where: { id: studySession.id },
      data: {
        insight: { ...parsed.data, ai },
        insightAt: new Date(),
      },
    });

    return { success: true, data: { generated: true } };
  } catch (error) {
    console.error('generateSessionInsight error:', error);
    return { success: false, error: 'Failed to generate insights' };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/actions/study-session.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/study-session.ts tests/actions/study-session.test.ts
git commit -m "feat(ai): generate and persist ranked focus areas per session"
```

---

### Task 12: Instrument the standalone matching game

**Files:**
- Modify: `src/actions/quiz-matching.ts` (add the standalone action) or create `src/actions/match-session.ts`
- Modify: `src/components/game/MatchGame.tsx`
- Modify: `src/app/sets/[id]/match/page.tsx`

**Interfaces:**
- Consumes: `startStudySession`, `finishStudySession` (Task 10); `matchResults` (Task 5); `recordStudyEvent` (Task 4)
- Produces: `submitMatchSession(input: { sessionId: string; results: { cardId: string; correct: boolean }[]; durationMs: number }): Promise<ActionResult<{ recorded: number }>>`

**⚠️ This is the behaviour change the spec calls out:** the standalone matching game starts moving confidence scores. It was previously consequence-free.

- [ ] **Step 1: Add the submit action**

Create `src/actions/match-session.ts`:

```ts
'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { recordStudyEvent } from '@/lib/memory/record';

type ActionResult<T> = { success: boolean; data?: T; error?: string };

/**
 * Records one completed standalone matching game into study memory.
 *
 * Behaviour change (Stage 6 follow-on): this game previously wrote nothing at
 * all — it was pure client state. It now feeds the single memory write path
 * like every other mode, so matching moves confidence scores.
 *
 * Correctness is "matched on the first try" (see `matchResults`), not "matched
 * eventually" — every pair is matched eventually.
 */
export async function submitMatchSession(input: {
  sessionId: string;
  results: { cardId: string; correct: boolean }[];
}): Promise<ActionResult<{ recorded: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    const studySession = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId, kind: 'matching' },
    });
    if (!studySession) return { success: false, error: 'Session not found' };

    // Idempotent: a re-submit (double click, retry) must not double-count
    // against confidence. Same guard as submitMatchingAnswers.
    const existing = await prisma.studyEvent.count({
      where: { userId, sessionId: studySession.id },
    });
    if (existing > 0) return { success: true, data: { recorded: 0 } };

    // Only cards actually belonging to this session's set are recorded — the
    // cardIds arrive from the client.
    const validIds = new Set(
      (
        await prisma.card.findMany({
          where: { setId: studySession.setId, id: { in: input.results.map((r) => r.cardId) } },
          select: { id: true },
        })
      ).map((c) => c.id),
    );

    let recorded = 0;
    for (const result of input.results) {
      if (!validIds.has(result.cardId)) continue;
      await recordStudyEvent({
        userId,
        cardId: result.cardId,
        source: 'matching',
        outcome: { correct: result.correct },
        sessionId: studySession.id,
      });
      recorded += 1;
    }

    return { success: true, data: { recorded } };
  } catch (error) {
    console.error('submitMatchSession error:', error);
    return { success: false, error: 'Failed to record matching game' };
  }
}
```

- [ ] **Step 2: Open a session when the game starts**

In `src/components/game/MatchGame.tsx`, the component holds `gameState` with `startedAt` set on the first tile selection. Add a `setId` prop, and a ref holding the server session id.

Open the session on the first selection (not on mount — a page opened and abandoned should not create a session):

```tsx
const sessionIdRef = useRef<string | null>(null);
const openingRef = useRef(false);

async function ensureSession() {
  if (sessionIdRef.current || openingRef.current) return;
  openingRef.current = true;
  const result = await startStudySession({
    setId,
    kind: 'matching',
    itemCount: gameState.tiles.length / 2,
  });
  if (result.success && result.data) sessionIdRef.current = result.data.sessionId;
  openingRef.current = false;
}
```

Call `ensureSession()` from the tile-click handler when `gameState.startedAt === null`.

- [ ] **Step 3: Submit and close when the game completes**

In the same component, when `isComplete(gameState)` first becomes true, fire:

```tsx
const sessionId = sessionIdRef.current;
if (!sessionId) return;
await submitMatchSession({ sessionId, results: matchResults(gameState) });
await finishStudySession({ sessionId });
```

Guard it with a `useRef` flag so a re-render cannot submit twice. Failures are logged and toasted but must not block the completion UI — the game result is the user's, whether or not memory recorded it.

- [ ] **Step 4: Pass `setId` from the page**

In `src/app/sets/[id]/match/page.tsx`, pass `setId={id}` to `<MatchGame />`.

- [ ] **Step 5: Verify manually**

Run: `npm run dev`, play a full matching game at `/sets/<id>/match`, then:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT kind, "itemCount", "durationMs", "endedAt" IS NOT NULL AS closed
FROM "StudySession" WHERE kind = 'matching' ORDER BY "startedAt" DESC LIMIT 1;
SELECT COUNT(*) AS events FROM "StudyEvent"
WHERE "sessionId" = (SELECT id FROM "StudySession" WHERE kind='matching' ORDER BY "startedAt" DESC LIMIT 1);
SQL
```
Expected: one closed matching session with a non-null `durationMs`, and one `StudyEvent` per card.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test && npx tsc --noEmit`

```bash
git add src/actions/match-session.ts src/components/game/MatchGame.tsx "src/app/sets/[id]/match/page.tsx"
git commit -m "feat(game): record the standalone matching game into study memory"
```

---

### Task 13: Instrument Review mode

**Files:**
- Modify: `src/actions/confidence.ts`
- Modify: `src/app/sets/[id]/review/page.tsx` and the review client component it renders

**Interfaces:**
- Consumes: `startStudySession`, `finishStudySession` (Task 10)
- Produces: `recordReview(cardId: string, knew: boolean, opts?: { sessionId?: string; latencyMs?: number })` — the third parameter is optional so existing callers keep compiling

- [ ] **Step 1: Widen `recordReview`**

In `src/actions/confidence.ts`, replace the signature and body of `recordReview` (line 26):

```ts
export async function recordReview(
  cardId: string,
  knew: boolean,
  opts?: { sessionId?: string; latencyMs?: number }
): Promise<{ newConfidence: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const result = await recordStudyEvent({
    userId: session.user.id,
    cardId,
    source: 'review',
    outcome: { correct: knew },
    sessionId: opts?.sessionId,
    meta: { latencyMs: opts?.latencyMs },
  })

  return { newConfidence: result.confidence }
}
```

- [ ] **Step 2: Locate the review client component**

Run: `grep -rn "recordReview" --include=*.tsx src`
Expected: the client component driving Review mode. Modify that file in the next step.

- [ ] **Step 3: Open a session on first answer, close it at the end of the deck**

In that component, add the refs and helpers:

```tsx
import { useRef } from 'react';
import { startStudySession, finishStudySession } from '@/actions/study-session';

const sessionIdRef = useRef<string | null>(null);
const openingRef = useRef(false);
const finishedRef = useRef(false);
// Set whenever a new card is presented, so latency measures thinking time
// on THIS card rather than time since the session began.
const shownAtRef = useRef<number>(Date.now());

// Opened on the first answer, not on mount: a review page that is opened and
// abandoned should not leave an empty session in the activity feed.
async function ensureSession(deckSize: number) {
  if (sessionIdRef.current || openingRef.current) return;
  openingRef.current = true;
  const result = await startStudySession({
    setId,
    kind: 'confidence',
    itemCount: deckSize,
  });
  if (result.success && result.data) sessionIdRef.current = result.data.sessionId;
  openingRef.current = false;
}
```

In the Know It / Don't Know handler, before calling `recordReview`:

```tsx
  await ensureSession(cards.length);
  const latencyMs = Date.now() - shownAtRef.current;
  await recordReview(card.id, knew, {
    sessionId: sessionIdRef.current ?? undefined,
    latencyMs,
  });
  shownAtRef.current = Date.now();
```

Where the component detects the deck is empty (the existing "session complete"
branch), close the session exactly once:

```tsx
  // Ref-guarded: this branch re-renders, and a second close would be a no-op
  // server-side but an avoidable round trip.
  if (!finishedRef.current && sessionIdRef.current) {
    finishedRef.current = true;
    finishStudySession({ sessionId: sessionIdRef.current }).catch(() => {});
  }
```

Reset `shownAtRef.current = Date.now()` wherever a card is re-queued or advanced, so a re-queued "Don't Know" card is timed from its next appearance.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`, complete a review session, then:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT kind, "durationMs" FROM "StudySession" WHERE kind='confidence' ORDER BY "startedAt" DESC LIMIT 1;
SELECT "latencyMs", "confidenceBefore", "confidenceAfter" FROM "StudyEvent"
WHERE source='review' ORDER BY "createdAt" DESC LIMIT 3;
SQL
```
Expected: a closed session; events carry non-null `latencyMs` and `confidenceBefore`.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test && npx tsc --noEmit`

```bash
git add src/actions/confidence.ts "src/app/sets/[id]/review"
git commit -m "feat(review): wrap review mode in a timed study session"
```

---

### Task 14: Instrument Quiz mode

**Files:**
- Modify: `src/actions/quiz.ts` (attempt creation ~line 196; the four answer-submit actions)
- Modify: `src/components/quiz/QuizContainer.tsx`
- Modify: `src/components/quiz/section.tsx` and the four quiz section components

**Interfaces:**
- Consumes: `startStudySession`, `finishStudySession`, `generateSessionInsight` (Tasks 10-11)
- Produces: `startQuizAttempt` returns `{ attemptId, cardIds, sessionId }`; each answer-submit action accepts an optional `latencyMs`

- [ ] **Step 1: Open a session alongside the attempt**

In `src/actions/quiz.ts`, replace the `prisma.quizAttempt.create` call (line 196) with a transaction that creates both rows, so an attempt can never exist without its envelope:

```ts
    const { attempt, sessionId } = await prisma.$transaction(async (tx) => {
      const created = await tx.studySession.create({
        data: {
          userId: session.user.id,
          setId,
          kind: 'quiz',
          itemCount: selectedIds.length,
          categoryIds: setup.categoryIds ?? undefined,
        },
      });
      const attempt = await tx.quizAttempt.create({
        data: {
          userId: session.user.id,
          setId,
          sessionId: created.id,
          mode: modes[0] || 'multiple-choice',
          selectedCardIds: selectedIds,
          questionMode: modes as any,
          questionCount: setup.questionCount ?? questionCount ?? selectedIds.length,
          promptSide: setup.promptSide,
          categoryIds: setup.categoryIds,
          starredOnly: setup.starredOnly,
          failedOnly: setup.failedOnly,
          printable: setup.printable,
        },
      });
      return { attempt, sessionId: created.id };
    });

    return { success: true, data: { attemptId: attempt.id, cardIds: selectedIds, sessionId } };
```

- [ ] **Step 2: Thread `latencyMs` through the four submit actions**

Each of the four answer paths in `src/actions/quiz.ts` calls `recordStudyEvent` (lines 279, 360, 458, 532). For each:
- add `latencyMs?: number` to the action's `input` type,
- persist it on the `QuizAnswer` row (`latencyMs: input.latencyMs`),
- pass it into `recordStudyEvent` as `meta: { latencyMs: input.latencyMs }`,
- pass `sessionId` by looking it up from the attempt (`attempt.sessionId ?? undefined`) — every submit path already loads the attempt.

`normalizeLatency` runs inside `recordStudyEvent`, so no clamping is needed here; apply it explicitly before writing `QuizAnswer.latencyMs`:

```ts
import { normalizeLatency } from '@/lib/memory/latency';
// ...
latencyMs: normalizeLatency(input.latencyMs),
```

- [ ] **Step 3: Time each question client-side**

Add a shared hook `src/components/quiz/useQuestionTimer.ts` so all four section
components measure the same way:

```ts
import { useRef } from 'react';

/**
 * Per-question wall-clock timing, keyed by cardId.
 *
 * Keyed rather than a single "current question started at" value because quiz
 * sections render every question at once and the user can move between them
 * freely — a single timestamp would bill the whole section's time to whichever
 * question happened to be submitted last.
 *
 * `start` is first-write-wins so revisiting a question does not reset its
 * clock, and `elapsed` is non-destructive so a re-submit reports the same
 * figure rather than zero.
 */
export function useQuestionTimer() {
  const startedAt = useRef<Record<string, number>>({});

  return {
    start(cardId: string) {
      if (startedAt.current[cardId] === undefined) {
        startedAt.current[cardId] = Date.now();
      }
    },
    elapsed(cardId: string): number | undefined {
      const started = startedAt.current[cardId];
      return started === undefined ? undefined : Date.now() - started;
    },
  };
}
```

In each of `MultipleChoiceQuiz`, `ShortAnswerQuiz`, `TrueFalseQuiz`, and
`MatchingQuiz`:

```tsx
const timer = useQuestionTimer();

// When a question's prompt is rendered (e.g. in a useEffect over the visible
// card, or on first interaction with its input):
timer.start(card.id);

// At submit, alongside the existing fields:
latencyMs: timer.elapsed(card.id),
```

- [ ] **Step 4: Verify the timer in isolation**

Create `tests/quiz/question-timer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useQuestionTimer } from '@/components/quiz/useQuestionTimer'

describe('useQuestionTimer', () => {
  it('does not reset a question clock when it is revisited', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useQuestionTimer())

    result.current.start('c1')
    vi.advanceTimersByTime(5000)
    result.current.start('c1') // revisit — must not restart
    expect(result.current.elapsed('c1')).toBe(5000)

    vi.useRealTimers()
  })

  it('times each question independently', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useQuestionTimer())

    result.current.start('c1')
    vi.advanceTimersByTime(3000)
    result.current.start('c2')
    vi.advanceTimersByTime(1000)

    expect(result.current.elapsed('c1')).toBe(4000)
    expect(result.current.elapsed('c2')).toBe(1000)

    vi.useRealTimers()
  })

  it('reports undefined for a question that was never started', () => {
    const { result } = renderHook(() => useQuestionTimer())
    expect(result.current.elapsed('never')).toBeUndefined()
  })
})
```

If `@testing-library/react` is not already a devDependency, install it
(`npm i -D @testing-library/react`) and add `environment: 'jsdom'` for this
file via a `// @vitest-environment jsdom` docblock at the top — the repo's
default environment is `node`. If that pulls in more setup than it is worth,
extract the same logic into a plain `createQuestionTimer()` factory in
`src/lib/quiz/question-timer.ts`, test that directly with no DOM, and have the
hook wrap it in a ref. Prefer the factory: it keeps the repo's node-only test
environment intact.

Run: `npx vitest run tests/quiz/question-timer.test.ts`
Expected: PASS.

- [ ] **Step 5: Close the session and generate insights at finish**

In `src/components/quiz/QuizContainer.tsx`, hold `sessionId` in state from `startQuizAttempt`'s result. In `handleSubmitQuiz`, after the `Promise.all` of `commitAll()` resolves, and before `setFinished(true)`:

```tsx
      if (sessionId) {
        await finishStudySession({ sessionId });
        // Fire-and-forget: the summary renders from the computed block
        // immediately, and the AI narrative appears on refresh if it lands.
        // A failed generation must never block the results screen.
        generateSessionInsight({ sessionId }).catch(() => {});
      }
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, take a short quiz, then:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT s.id, s."durationMs", s."insight" IS NOT NULL AS has_insight
FROM "StudySession" s WHERE s.kind='quiz' ORDER BY s."startedAt" DESC LIMIT 1;
SELECT "latencyMs" FROM "QuizAnswer" ORDER BY "createdAt" DESC LIMIT 5;
SQL
```
Expected: a closed quiz session with a non-null insight; answers carry `latencyMs`.

- [ ] **Step 7: Run the suite and commit**

Run: `npm test && npx tsc --noEmit`

```bash
git add src/actions/quiz.ts src/components/quiz tests/quiz/question-timer.test.ts
git commit -m "feat(quiz): open a timed session per attempt and persist its insight"
```

---

### Task 15: Read the persisted insight; retire the per-render AI call

**Files:**
- Modify: `src/actions/quiz.ts:587-689` (`getQuizAttemptSummary`)
- Create: `src/components/memory/SessionInsightView.tsx`
- Modify: `src/components/quiz/QuizSummary.tsx`
- Delete: `src/lib/ai/prompts/quiz-summary.ts`
- Modify: `src/lib/ai/prompts/registry.ts`, `tests/ai/prompts.test.ts`

**Interfaces:**
- Consumes: `SessionInsightSchema` (Task 8), `generateSessionInsight` (Task 11)
- Produces: `getQuizAttemptSummary` returns `{ attempt, insight: SessionInsight | null }` in place of `{ attempt, overallAnalysis }`; `SessionInsightView({ insight, sessionId, canGenerate })` — consumed by Task 16

**This is the cost fix:** the current implementation fires a fresh `generateJson` call on **every** render of a results page.

- [ ] **Step 1: Replace the AI block in `getQuizAttemptSummary`**

Delete the whole `let overallAnalysis = ...` block (lines 642-682) and its now-unused imports (`QUIZ_SUMMARY_PROMPT`, and `safeProfileBlock`/`generateJson` **only if** nothing else in the file uses them — check first with `grep -n "generateJson\|safeProfileBlock" src/actions/quiz.ts`).

Include the session on the attempt query:

```ts
      include: {
        user: true,
        set: { include: { cards: true } },
        session: true,
        answers: { /* unchanged */ },
      },
```

and return the parsed insight:

```ts
    // Read, never generate. Regenerating here is what made every render of a
    // results page cost an AI call. A blob that fails to parse (older version,
    // partial write) degrades to null and the UI offers to regenerate.
    const parsedInsight = SessionInsightSchema.safeParse(attempt.session?.insight);

    return {
      success: true,
      data: {
        attempt,
        insight: parsedInsight.success ? parsedInsight.data : null,
      },
    };
```

- [ ] **Step 2: Extract the insight renderer into its own component**

Create `src/components/memory/SessionInsightView.tsx`. Splitting it out of
`QuizSummary` is what lets the live results screen and the Task 16 permalink
render the identical thing without either importing the other:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { generateSessionInsight } from '@/actions/study-session';
import type { SessionInsight } from '@/lib/memory/insight';

export function SessionInsightView({
  insight,
  sessionId,
  canGenerate,
}: {
  insight: SessionInsight | null;
  sessionId: string | null;
  /** False for matching/confidence sessions, which get no AI narrative by design. */
  canGenerate: boolean;
}) {
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!sessionId) return;
    setGenerating(true);
    const result = await generateSessionInsight({ sessionId });
    setGenerating(false);
    if (result.success) window.location.reload();
    else toast.error(result.error || 'Could not generate insights');
  }

  if (!insight) {
    return <p className="text-sm text-muted-foreground">No breakdown saved for this activity.</p>;
  }

  const { computed, ai } = insight;

  return (
    <div className="space-y-6">
      {/* Focus areas first — they are the "where do I improve" answer. */}
      {ai ? (
        <section className="space-y-3">
          <h3 className="font-semibold">Focus areas</h3>
          {ai.focusAreas.map((area, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{area.title}</span>
                <span className="text-xs uppercase text-muted-foreground">{area.severity}</span>
              </div>
              <p className="text-sm text-muted-foreground">{area.evidence}</p>
              <p className="text-sm">{area.action}</p>
            </div>
          ))}
          {ai.strengths && <p className="text-sm text-muted-foreground">{ai.strengths}</p>}
        </section>
      ) : canGenerate && sessionId ? (
        <Button onClick={handleGenerate} disabled={generating} variant="outline">
          {generating ? 'Generating…' : 'Generate insights'}
        </Button>
      ) : null}

      <section className="grid gap-6 sm:grid-cols-3">
        <div>
          <h4 className="text-sm font-semibold mb-2">By category</h4>
          {computed.byCategory.map((c) => (
            <div key={c.name} className="flex justify-between text-sm">
              <span>{c.name}</span>
              <span className="text-muted-foreground">{c.accuracyPct}%</span>
            </div>
          ))}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">By mode</h4>
          {computed.byMode.map((m) => (
            <div key={m.mode} className="flex justify-between text-sm">
              <span>{m.mode}</span>
              <span className="text-muted-foreground">
                {m.correct}/{m.total}
              </span>
            </div>
          ))}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Pacing</h4>
          <p className="text-sm text-muted-foreground">
            {/* Null means "not measured" — legacy activities render an em dash
                rather than a fabricated zero. */}
            median{' '}
            {computed.pacing.medianLatencyMs === null
              ? '—'
              : `${Math.round(computed.pacing.medianLatencyMs / 100) / 10}s`}
          </p>
        </div>
      </section>
    </div>
  );
}
```

Phase 2 replaces this component's visual layer (`ui-ux-pro-max` + `dataviz`);
its props contract is what Phase 2 builds against, so keep the signature.

- [ ] **Step 3: Mount it in `QuizSummary`**

In `src/components/quiz/QuizSummary.tsx`, replace the `summary.overallAnalysis`
render (line 176) with:

```tsx
<SessionInsightView
  insight={summary.insight}
  sessionId={summary.attempt.sessionId ?? null}
  canGenerate
/>
```

Keep `QuizSummary` presentational — it must render identically whether mounted
by `QuizContainer` or by the permalink page in Task 16.

- [ ] **Step 4: Delete the superseded prompt**

```bash
git rm src/lib/ai/prompts/quiz-summary.ts
```

Remove from `src/lib/ai/prompts/registry.ts`: the two `export`/`export type` lines for quiz-summary, the `import`, and its `PROMPT_REGISTRY` entry. Remove the `QUIZ_SUMMARY_PROMPT` import and its `describe` block from `tests/ai/prompts.test.ts`.

- [ ] **Step 5: Confirm nothing still references it**

Run: `grep -rn "QUIZ_SUMMARY_PROMPT\|overallAnalysis" src tests`
Expected: no matches.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test && npx tsc --noEmit`

```bash
git add -A src/actions/quiz.ts src/components/quiz/QuizSummary.tsx src/components/memory/SessionInsightView.tsx src/lib/ai/prompts tests/ai/prompts.test.ts
git commit -m "perf(quiz): read persisted session insight instead of regenerating it per render"
```

---

### Task 16: Activity permalink

**Files:**
- Create: `src/app/profile/activity/[id]/page.tsx`
- Create: `src/lib/memory/activity-labels.ts`
- Modify: `src/actions/study-session.ts`

**Interfaces:**
- Consumes: `getQuizAttemptSummary` (Task 15), `SessionInsightSchema` (Task 8), `QuizSummary` (Task 15)
- Produces: `getStudySession(sessionId: string): Promise<ActionResult<{ session, attemptId: string | null, insight: SessionInsight | null }>>`

- [ ] **Step 1: Add the read action**

Append to `src/actions/study-session.ts`:

```ts
export async function getStudySession(sessionId: string): Promise<
  ActionResult<{
    id: string;
    kind: string;
    setId: string;
    setTitle: string;
    startedAt: Date;
    durationMs: number | null;
    itemCount: number;
    attemptId: string | null;
    insight: SessionInsight | null;
  }>
> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const found = await prisma.studySession.findFirst({
      where: { id: sessionId, userId: session.user.id },
      include: { set: { select: { title: true } }, attempt: { select: { id: true } } },
    });
    if (!found) return { success: false, error: 'Activity not found' };

    const parsed = SessionInsightSchema.safeParse(found.insight);

    return {
      success: true,
      data: {
        id: found.id,
        kind: found.kind,
        setId: found.setId,
        setTitle: found.set.title,
        startedAt: found.startedAt,
        durationMs: found.durationMs,
        itemCount: found.itemCount,
        attemptId: found.attempt?.id ?? null,
        insight: parsed.success ? parsed.data : null,
      },
    };
  } catch (error) {
    console.error('getStudySession error:', error);
    return { success: false, error: 'Failed to load activity' };
  }
}
```

- [ ] **Step 2: Add the shared activity labels**

Create `src/lib/memory/activity-labels.ts` — Phase 2's activity feed imports
the same map, so the user never sees a raw kind or a question-mode word where
an activity name belongs:

```ts
/** How each session kind is named in the UI. Never "Multiple Choice". */
export const ACTIVITY_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  matching: 'Matching Game',
  confidence: 'Confidence Ranking',
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABELS[kind] ?? 'Study session';
}

/** "8m 42s", or an em dash when the activity predates timing. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
```

- [ ] **Step 3: Build the permalink page**

Create `src/app/profile/activity/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { getStudySession } from '@/actions/study-session';
import { SessionInsightView } from '@/components/memory/SessionInsightView';
import { QuizSummary } from '@/components/quiz/QuizSummary';
import { activityLabel, formatDuration } from '@/lib/memory/activity-labels';

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStudySession(id);
  if (!result.success || !result.data) notFound();

  const activity = result.data;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{activityLabel(activity.kind)}</h1>
        <p className="text-sm text-muted-foreground">
          {activity.setTitle} · {format(activity.startedAt, 'MMM d, h:mma')} ·{' '}
          {activity.itemCount} items · {formatDuration(activity.durationMs)}
        </p>
      </header>

      {activity.kind === 'quiz' && activity.attemptId ? (
        // The identical component the live end-of-quiz screen renders, so the
        // permalink IS "the page I saw when I finished" rather than a copy of
        // it that can drift.
        <QuizSummary
          setId={activity.setId}
          attemptId={activity.attemptId}
          score={0}
        />
      ) : (
        <SessionInsightView
          insight={activity.insight}
          sessionId={activity.id}
          // Matching and Confidence Ranking get the computed block only.
          canGenerate={false}
        />
      )}
    </div>
  );
}
```

If `QuizSummary`'s `score` prop is only used for a header it now duplicates,
make it optional in Task 15 Step 3 rather than passing a meaningless `0` here.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`. Take a quiz, copy the session id from the database, open `/profile/activity/<id>`.
Expected: the results page renders identically to the end-of-quiz screen, with no AI call on load. Then open a **legacy** attempt's session id — expect the same page with `—` for duration and a "Generate insights" button.

- [ ] **Step 5: Confirm ownership is enforced**

Expected: opening another user's session id renders not-found, not their data.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/actions/study-session.ts src/lib/memory/activity-labels.ts "src/app/profile/activity"
git commit -m "feat(profile): add activity permalink rendering the saved quiz result"
```

---

## Phase 1 done — verification

- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] A quiz, a matching game, and a review session each produce one closed `StudySession` with a non-null `durationMs` and a persisted `insight`
- [ ] Opening a results page twice fires **zero** AI calls (check the server log)
- [ ] A legacy attempt renders with `—` for duration and offers "Generate insights"
- [ ] `/profile` and `/profile/memory` still work unchanged

Then write the Phase 2 plan against the shapes this produced.
