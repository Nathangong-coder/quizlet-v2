# Deletion & Forgetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the learner granular deletion (one question, one quiz) and make every existing "forget" verb erase the quiz evidence and knowledge posterior it currently leaves standing.

**Architecture:** One module, `src/lib/memory/erase.ts`, holds a *pure* `planErasure(snapshot, scope)` that returns what to delete and which `cardId`s/`klpId`s need replaying, plus an `executeErasure` that runs read → plan → delete → replay in a single transaction. Six verbs become scope selectors over it. A new `StudyEvent.quizAnswerId` FK (`onDelete: Cascade`) makes the database, not application code, responsible for keeping a graded answer and its memory-feed row together.

**Tech Stack:** Next.js App Router server actions, Prisma/Postgres, Vitest, TypeScript.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-deletion-and-forgetting-design.md`. Every decision in its §2 is settled — do not re-litigate.
- **The invariant:** no derived number may claim knowledge from evidence that no longer exists. `CardProgress` and `KlpState` are not invertible; the only correct response to a deletion is a replay from surviving rows.
- **Ownership is on the memory rows, not the content.** `card`/`set` scopes filter by `userId` and must NOT require set ownership — a learner studying a link-shared set owns their own memory of it. `answer`/`event`/`attempt` check `row.userId === session.user.id` and return `'Not found'` for both absent and not-yours.
- **Stars do not survive.** A `CardProgress` row with no surviving evidence is deleted outright, star included.
- Tests are pure/mocked — this repo has **no live-DB test harness**. Actions are tested with `vi.mock('@/lib/db')` (see `tests/actions/quiz-submit-ownership.test.ts`). Schema guarantees are pinned by asserting against `prisma/schema.prisma` text, not by hitting a database.
- **Run the suite excluding the foreign repo in the project root:**
  `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"`
- Baseline to compare against: **874 passing**, `tsc --noEmit` clean (excluding `cursor-agents`), `npm run lint` **187 problems (130 errors, 57 warnings), all pre-existing** — do not fix unrelated ones.
- `.env` holds only `DATABASE_URL`. For anything that runs the app: `NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev`.
- `tsx` scripts must live in `scripts/` and need a `main()` wrapper — top-level `await` breaks under the CJS output format.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | Add `StudyEvent.quizAnswerId` + relation (Task 1) |
| `src/lib/memory/record.ts` | Accept and persist `quizAnswerId` (Task 1) |
| `src/actions/quiz.ts` | Pass `quizAnswerId` at 4 sites (Task 1); replay `CardProgress` on resubmit (Task 2) |
| `scripts/backfill-study-event-answer-link.ts` | One-time link of legacy rows (Task 3) |
| `src/lib/memory/erase.ts` | **NEW** — scopes, snapshot types, pure `planErasure` (Task 4) |
| `src/lib/memory/erase-execute.ts` | **NEW** — `executeErasure`, snapshot loaders, replay (Task 5) |
| `src/lib/memory/reset.ts` | Add `studySession` to `RESET_MEMORY_MODELS` (Task 7) |
| `src/actions/memory.ts` | Rewire 3 verbs, add 2 (Task 6) |
| `src/actions/user.ts` | `resetUserMemory` via the account scope; `getUserStats` returns `sessionId` (Tasks 7, 8) |
| `src/app/profile/page.tsx` | Link Recent Attempts to the activity page (Task 8) |
| `src/app/profile/activity/[id]/page.tsx` | "Reset this quiz" (Task 9) |
| `src/components/quiz/QuizSummary.tsx` | `canReset` prop + per-question control (Task 9) |
| `src/app/profile/memory/page.tsx` | Rewrite 3 confirm strings (Task 10) |

Two files rather than one because `erase.ts` must stay importable by a test **without** dragging in Prisma or `auth` — the same reason `src/lib/memory/reset.ts` exists apart from `src/actions/user.ts`. `erase.ts` is pure; `erase-execute.ts` owns every query.

---

### Task 1: Link a StudyEvent to the QuizAnswer that produced it

**Files:**
- Modify: `prisma/schema.prisma` (model `StudyEvent`, ~line 283)
- Modify: `src/lib/memory/record.ts:8-20` (input type), `:129-141` (the create)
- Modify: `src/actions/quiz.ts` — 4 `recordStudyEvent` call sites (~:555, :732, :1098, :1212)
- Test: `tests/memory/record.test.ts`, `tests/schema/study-event-link.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `RecordStudyEventInput.quizAnswerId?: string`. `StudyEvent.quizAnswerId: string | null`, unique, `onDelete: Cascade` from `QuizAnswer`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/schema/study-event-link.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')

/**
 * The cascade is the mechanism that keeps a graded answer and its memory-feed
 * row together — application code never deletes the event explicitly. There is
 * no live-DB harness here, so the guarantee is pinned against the schema text.
 */
describe('StudyEvent -> QuizAnswer link', () => {
  it('declares quizAnswerId as a unique nullable column', () => {
    expect(schema).toMatch(/quizAnswerId\s+String\?\s+@unique/)
  })

  it('cascades the event away when its answer is deleted', () => {
    expect(schema).toMatch(
      /quizAnswer\s+QuizAnswer\?\s+@relation\(fields:\s*\[quizAnswerId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/schema/study-event-link.test.ts`
Expected: FAIL — both assertions, no such column.

- [ ] **Step 3: Add the column and relation**

In `prisma/schema.prisma`, model `StudyEvent`, below the existing `session` relation:

```prisma
  // One graded answer produces at most one memory event, hence @unique. The FK
  // lives here so deleting a QuizAnswer cascades the event away in the
  // database — every erasure scope gets that for free and cannot forget it.
  // The cascade runs answer -> event only; deleting an event leaves the answer,
  // which is why the `event` erasure scope routes quiz-sourced events to the
  // `answer` scope instead (see src/lib/memory/erase.ts).
  quizAnswerId String?     @unique
  quizAnswer   QuizAnswer? @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
```

And in model `QuizAnswer`, add the back-relation beside `klpResults`:

```prisma
  studyEvent    StudyEvent?
```

- [ ] **Step 4: Generate the migration**

```bash
npx prisma migrate dev --name add_study_event_quiz_answer_link
```

Expected: a new folder under `prisma/migrations/`, and `prisma generate` runs.

- [ ] **Step 5: Run the schema test to verify it passes**

Run: `npx vitest run tests/schema/study-event-link.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing record test**

Append to `tests/memory/record.test.ts` (follow the mocking already at the top of that file):

```ts
it('stamps quizAnswerId onto the StudyEvent when the caller supplies one', async () => {
  // Without this link nothing can delete the memory row when its graded answer
  // goes, and confidence keeps a contribution from evidence that is gone.
  await recordStudyEvent({
    userId: 'u1',
    cardId: 'c1',
    source: 'quiz-mc',
    quizAnswerId: 'a1',
    outcome: { correct: true },
  })

  expect(h.eventCreate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ quizAnswerId: 'a1' }) }),
  )
})

it('omits quizAnswerId for a non-quiz source', async () => {
  await recordStudyEvent({
    userId: 'u1',
    cardId: 'c1',
    source: 'review',
    outcome: { correct: true },
  })

  const data = h.eventCreate.mock.calls.at(-1)![0].data
  expect(data.quizAnswerId).toBeUndefined()
})
```

If `tests/memory/record.test.ts` does not already expose the `studyEvent.create` mock as `h.eventCreate`, add it to the existing `vi.hoisted` block and the `vi.mock('@/lib/db')` factory in that file, matching the pattern in `tests/actions/quiz-submit-ownership.test.ts`.

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/memory/record.test.ts`
Expected: FAIL — `quizAnswerId` is not in the created data.

- [ ] **Step 8: Thread it through `recordStudyEvent`**

In `src/lib/memory/record.ts`, extend the input interface:

```ts
export interface RecordStudyEventInput {
  userId: string
  cardId: string
  source: StudySource
  /** Groups this event under a StudySession. Absent for write paths with no
   *  session envelope (e.g. a one-off action outside any activity). */
  sessionId?: string
  /**
   * The graded answer this event describes, for quiz sources. Set it and the
   * database keeps the two rows' lifetimes tied: deleting the answer cascades
   * the event. Absent for `review`/`matching`/`lesson`, which have no answer.
   */
  quizAnswerId?: string
  outcome: StudyOutcome
  meta?: {
    latencyMs?: number
  }
}
```

Destructure it at `:60`:

```ts
const { userId, cardId, source, sessionId, quizAnswerId, outcome, meta } = input
```

And add it to the create at `:129`:

```ts
    await tx.studyEvent.create({
      data: {
        userId,
        cardId,
        sessionId,
        quizAnswerId,
        source,
        correct,
        score,
        confidenceBefore: oldConfidence,
        confidenceAfter: confidence,
        latencyMs: normalizeLatency(meta?.latencyMs),
      },
    })
```

- [ ] **Step 9: Run the record test to verify it passes**

Run: `npx vitest run tests/memory/record.test.ts`
Expected: PASS.

- [ ] **Step 10: Pass the id from all four quiz call sites**

In `src/actions/quiz.ts`, each of the four `recordStudyEvent(...)` calls sits just after the answer row is created. Add `quizAnswerId` to each:

- **MC (~:555)** — the answer is in scope as `answer` (returned by `createAnswerWithAnalysis`):
```ts
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-mc',
        sessionId: attempt?.sessionId ?? undefined,
        quizAnswerId: answer.id,
        outcome: { correct: isCorrect },
        meta: { latencyMs: input.latencyMs },
      });
```

- **TF (~:732)**, **SA text (~:1098)**, **SA multimodal (~:1212)** — same addition, `quizAnswerId: <the answer variable in that scope>.id`, keeping each call's existing `source` and `outcome` untouched.

If a call site currently discards the `createAnswerWithAnalysis` return value (the SA path at `:932` does — it calls it without assigning), capture it: `const answer = await createAnswerWithAnalysis(...)`.

- [ ] **Step 11: Typecheck and run the full suite**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
```
Expected: no new type errors; 874 + 3 new tests passing.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/memory/record.ts src/actions/quiz.ts tests/memory/record.test.ts tests/schema/study-event-link.test.ts
git commit -m "feat(erase): link each StudyEvent to the QuizAnswer that produced it"
```

---

### Task 2: Replay CardProgress when a resubmit supersedes an answer

**Files:**
- Modify: `src/actions/quiz.ts:796-885` (`createAnswerWithAnalysis`)
- Test: `tests/actions/quiz-resubmit-state.test.ts`

**Interfaces:**
- Consumes: Task 1's cascade; `recomputeCardProgress` from `src/lib/memory/recompute.ts`.
- Produces: nothing new — a behaviour fix inside an existing private function.

**Why this task exists.** `createAnswerWithAnalysis` supports resubmitting an answer: it `deleteMany`s the prior `QuizAnswer` for that `(attempt, card, mode)` before writing the new one. Task 1's cascade now takes the prior `StudyEvent` with it. `CardProgress` is **incremental**, so its confidence step from that deleted event does not roll back on its own — leaving a derived number claiming knowledge from a row that no longer exists, on a hot path rather than a deletion path. Replaying also fixes a pre-existing bug in the same place: today the old event *survives* a resubmit, so confidence is stepped twice for one question. `rebuildKlpStates` is already called here for exactly this reason (`:882`); `CardProgress` was simply missed.

- [ ] **Step 1: Write the failing test**

Append to `tests/actions/quiz-resubmit-state.test.ts`:

```ts
it('replays CardProgress after a resubmit supersedes the prior answer', async () => {
  // The prior answer's StudyEvent is cascaded away by the FK, but CardProgress
  // is incremental — without a replay it keeps a confidence step from an event
  // that no longer exists. rebuildKlpStates already covers the posterior; this
  // is the same hole on the confidence side.
  h.answerFindMany.mockResolvedValue([{ klpResults: [] }])
  h.eventFindMany.mockResolvedValue([
    { correct: true, score: null, createdAt: new Date('2026-08-01T00:00:00Z') },
  ])

  await submitMultipleChoiceAnswer({
    attemptId: 'att1',
    cardId: 'c1',
    selectedOption: 'A',
    correctAnswer: 'A',
  })

  expect(h.progressUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId_cardId: { userId: 'u1', cardId: 'c1' } },
    }),
  )
})
```

Add `eventFindMany` and `progressUpsert` to that file's `vi.hoisted` block and its `vi.mock('@/lib/db')` factory (`studyEvent: { findMany: h.eventFindMany, ... }`, `cardProgress: { upsert: h.progressUpsert, deleteMany: h.progressDeleteMany, ... }`), matching how the file already declares its other delegates.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/actions/quiz-resubmit-state.test.ts`
Expected: FAIL — `progressUpsert` never called during the replace path.

- [ ] **Step 3: Replay inside the same transaction**

In `src/actions/quiz.ts`, import the pure replay at the top:

```ts
import { recomputeCardProgress } from '@/lib/memory/recompute';
```

Inside `createAnswerWithAnalysis`, immediately after `await rebuildKlpStates(tx, answerData.userId, supersededKlpIds);` (`:882`):

```ts
    // The replace above cascaded the prior answer's StudyEvent away (see the
    // quizAnswerId FK). CardProgress is incremental and cannot be stepped
    // backward, so it must be replayed from what survives — otherwise it keeps
    // a confidence step from a row that is gone. This also fixes the older bug
    // where a resubmit stepped confidence twice, because the prior event used
    // to survive the replace entirely.
    if (replace) {
      const remaining = await tx.studyEvent.findMany({
        where: { userId: answerData.userId, cardId: replace.cardId },
        select: { correct: true, score: true, createdAt: true },
      });
      const recomputed = recomputeCardProgress(remaining);
      if (recomputed === null) {
        await tx.cardProgress.deleteMany({
          where: { userId: answerData.userId, cardId: replace.cardId },
        });
      } else {
        await tx.cardProgress.upsert({
          where: { userId_cardId: { userId: answerData.userId, cardId: replace.cardId } },
          update: {
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
          },
          create: {
            userId: answerData.userId,
            cardId: replace.cardId,
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
            starred: false,
          },
        });
      }
    }
```

**Ordering note:** this runs *before* `recordStudyEvent` writes the new event (that call is outside this transaction, after `createAnswerWithAnalysis` returns), so the replay sees only surviving history and the new answer's step is applied on top exactly once.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/actions/quiz-resubmit-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/quiz.ts tests/actions/quiz-resubmit-state.test.ts
git commit -m "fix(quiz): replay CardProgress when a resubmit supersedes an answer"
```

---

### Task 3: Backfill the link for existing rows

**Files:**
- Create: `scripts/backfill-study-event-answer-link.ts`
- Modify: `package.json` (scripts)
- Test: `tests/memory/backfill-link.test.ts` (new)
- Create: `src/lib/memory/link-backfill.ts` (the pure matcher)

**Interfaces:**
- Consumes: Task 1's column.
- Produces: `pairStudyEventsToAnswers(events, answers): { eventId: string; quizAnswerId: string }[]` from `src/lib/memory/link-backfill.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/memory/backfill-link.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pairStudyEventsToAnswers } from '@/lib/memory/link-backfill'

const t = (mins: number) => new Date(new Date('2026-08-01T00:00:00Z').getTime() + mins * 60_000)

describe('pairStudyEventsToAnswers', () => {
  it('links an event to the answer sharing its card, session and mode', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(0) }],
      [{ id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) }],
    )
    expect(pairs).toEqual([{ eventId: 'e1', quizAnswerId: 'a1' }])
  })

  it('links nothing when two candidates are indistinguishable', () => {
    // A wrong link deletes the wrong memory row later, which is worse than an
    // unlinked legacy row. Ambiguity must produce silence, not a guess.
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(0) }],
      [
        { id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) },
        { id: 'a2', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) },
      ],
    )
    expect(pairs).toEqual([])
  })

  it('does not link across sessions', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(0) }],
      [{ id: 'a1', cardId: 'c1', sessionId: 's2', mode: 'multiple-choice', createdAt: t(0) }],
    )
    expect(pairs).toEqual([])
  })

  it('ignores non-quiz sources, which have no answer', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'review', createdAt: t(0) }],
      [{ id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) }],
    )
    expect(pairs).toEqual([])
  })

  it('picks the nearest answer in time when several are distinguishable', () => {
    const pairs = pairStudyEventsToAnswers(
      [{ id: 'e1', cardId: 'c1', sessionId: 's1', source: 'quiz-mc', createdAt: t(10) }],
      [
        { id: 'a1', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(0) },
        { id: 'a2', cardId: 'c1', sessionId: 's1', mode: 'multiple-choice', createdAt: t(9) },
      ],
    )
    expect(pairs).toEqual([{ eventId: 'e1', quizAnswerId: 'a2' }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/memory/backfill-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure matcher**

Create `src/lib/memory/link-backfill.ts`:

```ts
import { toQuizMode } from '@/lib/quiz/mode'

/**
 * One-time matcher for StudyEvent rows written before `quizAnswerId` existed.
 *
 * Deliberately conservative. A wrong link means a later erasure deletes the
 * wrong memory row — silently, and with no way to notice. An unlinked legacy
 * row is merely incomplete. So an ambiguous group links NOTHING.
 */
export interface LegacyEvent {
  id: string
  cardId: string
  sessionId: string | null
  source: string
  createdAt: Date
}

export interface LegacyAnswer {
  id: string
  cardId: string
  sessionId: string | null
  mode: string
  createdAt: Date
}

/** Two candidates within this many ms of each other are indistinguishable. */
const AMBIGUITY_WINDOW_MS = 1000

export function pairStudyEventsToAnswers(
  events: LegacyEvent[],
  answers: LegacyAnswer[],
): { eventId: string; quizAnswerId: string }[] {
  const claimed = new Set<string>()
  const pairs: { eventId: string; quizAnswerId: string }[] = []

  for (const event of events) {
    // `review` and `lesson` have no quiz mode at all. `toQuizMode` returns null
    // for those, and null must match nothing rather than fall through to every
    // mode (see src/lib/quiz/mode.ts).
    const mode = toQuizMode(event.source)
    if (mode === null || event.sessionId === null) continue

    const candidates = answers.filter(
      (a) =>
        !claimed.has(a.id) &&
        a.cardId === event.cardId &&
        a.sessionId === event.sessionId &&
        a.mode === mode,
    )
    if (candidates.length === 0) continue

    const byDistance = [...candidates].sort(
      (a, b) =>
        Math.abs(a.createdAt.getTime() - event.createdAt.getTime()) -
        Math.abs(b.createdAt.getTime() - event.createdAt.getTime()),
    )

    if (byDistance.length > 1) {
      const first = Math.abs(byDistance[0].createdAt.getTime() - event.createdAt.getTime())
      const second = Math.abs(byDistance[1].createdAt.getTime() - event.createdAt.getTime())
      if (Math.abs(second - first) < AMBIGUITY_WINDOW_MS) continue
    }

    claimed.add(byDistance[0].id)
    pairs.push({ eventId: event.id, quizAnswerId: byDistance[0].id })
  }

  return pairs
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/memory/backfill-link.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the script**

Create `scripts/backfill-study-event-answer-link.ts`, following the shape of `scripts/backfill-klp-state.ts`:

```ts
import { PrismaClient } from '@prisma/client'
import { pairStudyEventsToAnswers } from '../src/lib/memory/link-backfill'

const prisma = new PrismaClient()

/**
 * Links pre-existing StudyEvent rows to the QuizAnswer that produced them.
 * Idempotent: only touches rows where quizAnswerId is still null. Ambiguous
 * groups are reported and left alone — see link-backfill.ts for why.
 */
async function main() {
  const events = await prisma.studyEvent.findMany({
    where: { quizAnswerId: null, sessionId: { not: null } },
    select: { id: true, userId: true, cardId: true, sessionId: true, source: true, createdAt: true },
  })
  const answers = await prisma.quizAnswer.findMany({
    select: {
      id: true, userId: true, cardId: true, mode: true, createdAt: true,
      attempt: { select: { sessionId: true } },
    },
  })

  // Per user: an event can only belong to its own user's answer.
  const userIds = [...new Set(events.map((e) => e.userId))]
  let linked = 0

  for (const userId of userIds) {
    const pairs = pairStudyEventsToAnswers(
      events.filter((e) => e.userId === userId),
      answers
        .filter((a) => a.userId === userId)
        .map((a) => ({
          id: a.id,
          cardId: a.cardId,
          sessionId: a.attempt.sessionId,
          mode: a.mode,
          createdAt: a.createdAt,
        })),
    )
    for (const p of pairs) {
      await prisma.studyEvent.update({
        where: { id: p.eventId },
        data: { quizAnswerId: p.quizAnswerId },
      })
      linked++
    }
  }

  console.log(`Linked ${linked} of ${events.length} unlinked events.`)
  console.log(`${events.length - linked} left unlinked (ambiguous, non-quiz, or no matching answer).`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
```

- [ ] **Step 6: Register and run it**

Add to `package.json` scripts, beside `backfill:klp-state`:

```json
    "backfill:study-event-link": "tsx --env-file=.env scripts/backfill-study-event-answer-link.ts"
```

Run: `npm run backfill:study-event-link`
Expected: a count printed, no error. The live DB has ~19 answers, so this is near-instant.

- [ ] **Step 7: Commit**

```bash
git add src/lib/memory/link-backfill.ts scripts/backfill-study-event-answer-link.ts package.json tests/memory/backfill-link.test.ts
git commit -m "feat(erase): backfill the StudyEvent -> QuizAnswer link for legacy rows"
```

---

### Task 4: The pure erasure planner

**Files:**
- Create: `src/lib/memory/erase.ts`
- Test: `tests/memory/erase.test.ts` (new)

**Interfaces:**
- Consumes: `overallQuizScore` from `src/lib/quiz/scoring.ts` — signature `(results: { score: number | null }[]) => number | null`.
- Produces: `ErasureScope`, `ErasureSnapshot`, `ErasurePlan`, `planErasure(snapshot, scope): ErasurePlan`, `ERASABLE_MEMORY_MODELS`.

This is the heart of the feature. It has no imports from Prisma or `auth`, so every rule in the spec's §3.1 is a unit test.

- [ ] **Step 1: Write the failing tests**

Create `tests/memory/erase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  planErasure,
  type ErasureSnapshot,
  type ErasureScope,
} from '@/lib/memory/erase'

/**
 * One fixture graph shared by every scope test.
 *
 *  attempt att1 (session s1) — answers a1 (card c1, klp k1), a2 (card c2, klp k2)
 *  attempt att2 (session s2) — answer  a3 (card c1, klp k1)
 *  events: e1->a1, e2->a2, e3->a3, e4 = a standalone review of c1
 */
const snapshot = (): ErasureSnapshot => ({
  answers: [
    { id: 'a1', attemptId: 'att1', cardId: 'c1', klpIds: ['k1'], score: 100 },
    { id: 'a2', attemptId: 'att1', cardId: 'c2', klpIds: ['k2'], score: 0 },
    { id: 'a3', attemptId: 'att2', cardId: 'c1', klpIds: ['k1'], score: 50 },
  ],
  events: [
    { id: 'e1', cardId: 'c1', quizAnswerId: 'a1', source: 'quiz-mc' },
    { id: 'e2', cardId: 'c2', quizAnswerId: 'a2', source: 'quiz-mc' },
    { id: 'e3', cardId: 'c1', quizAnswerId: 'a3', source: 'quiz-sa' },
    { id: 'e4', cardId: 'c1', quizAnswerId: null, source: 'review' },
  ],
  attempts: [
    { id: 'att1', sessionId: 's1', answers: [{ id: 'a1', score: 100 }, { id: 'a2', score: 0 }] },
    { id: 'att2', sessionId: 's2', answers: [{ id: 'a3', score: 50 }] },
  ],
})

const plan = (scope: ErasureScope) => planErasure(snapshot(), scope)

describe('planErasure — answer scope', () => {
  it('deletes the answer and replays its card and KLPs', () => {
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.deleteAnswerIds).toEqual(['a1'])
    expect(p.replayCardIds).toEqual(['c1'])
    expect(p.replayKlpIds).toEqual(['k1'])
  })

  it('does not list the cascaded event — the database removes it', () => {
    // Listing it would be harmless but misleading: it implies application code
    // is responsible for a deletion the FK already guarantees.
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.deleteEventIds).toEqual([])
  })

  it('recomputes the surviving attempt score and item count', () => {
    const p = plan({ kind: 'answer', answerId: 'a1' })
    expect(p.updateAttempts).toEqual([
      { attemptId: 'att1', sessionId: 's1', score: 0, itemCount: 1 },
    ])
    expect(p.deleteAttemptIds).toEqual([])
  })

  it('deletes the attempt and its session when its last answer goes', () => {
    // Otherwise the activity feed shows a ghost quiz with nothing in it.
    const p = plan({ kind: 'answer', answerId: 'a3' })
    expect(p.deleteAttemptIds).toEqual(['att2'])
    expect(p.deleteSessionIds).toEqual(['s2'])
    expect(p.updateAttempts).toEqual([])
  })

  it('rounds the recomputed score, because QuizAttempt.score is an Int column', () => {
    // overallQuizScore returns a float mean. Writing that straight into an Int
    // column throws at the database, which no pure test would catch.
    const snap = snapshot()
    snap.answers.push({ id: 'a4', attemptId: 'att1', cardId: 'c3', klpIds: [], score: 67 })
    snap.attempts[0].answers.push({ id: 'a4', score: 67 })

    const p = planErasure(snap, { kind: 'answer', answerId: 'a1' })
    // survivors are a2 (0) and a4 (67) -> mean 33.5 -> 34
    expect(p.updateAttempts[0].score).toBe(34)
    expect(Number.isInteger(p.updateAttempts[0].score)).toBe(true)
  })
})

describe('planErasure — event scope', () => {
  it('routes a quiz-sourced event to its answer', () => {
    // The FK cascade runs answer -> event only. Without this routing, deleting
    // a quiz entry from the memory feed would leave its graded answer and KLP
    // evidence standing.
    const p = plan({ kind: 'event', eventId: 'e1' })
    expect(p.deleteAnswerIds).toEqual(['a1'])
    expect(p.replayKlpIds).toEqual(['k1'])
  })

  it('deletes a standalone review event without touching any answer', () => {
    const p = plan({ kind: 'event', eventId: 'e4' })
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.deleteAnswerIds).toEqual([])
    expect(p.replayCardIds).toEqual(['c1'])
    expect(p.replayKlpIds).toEqual([])
  })
})

describe('planErasure — attempt scope', () => {
  it('deletes the attempt, its session, and replays every card and KLP', () => {
    const p = plan({ kind: 'attempt', attemptId: 'att1' })
    expect(p.deleteAttemptIds).toEqual(['att1'])
    expect(p.deleteSessionIds).toEqual(['s1'])
    expect(p.replayCardIds.sort()).toEqual(['c1', 'c2'])
    expect(p.replayKlpIds.sort()).toEqual(['k1', 'k2'])
    expect(p.updateAttempts).toEqual([])
  })
})

describe('planErasure — card scope', () => {
  it('deletes every answer and event for the card and replays its KLPs', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteAnswerIds.sort()).toEqual(['a1', 'a3'])
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.replayKlpIds).toEqual(['k1'])
  })

  it('clears the legacy ConfidenceEvent rows for that card', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteConfidenceEventCardIds).toEqual(['c1'])
  })

  it('leaves the sibling card untouched', () => {
    const p = plan({ kind: 'card', cardId: 'c1' })
    expect(p.deleteAnswerIds).not.toContain('a2')
    expect(p.replayKlpIds).not.toContain('k2')
  })
})

describe('planErasure — set scope', () => {
  it('deletes every answer, event, attempt and session in the snapshot', () => {
    // The snapshot loader has already narrowed to the set, so the set scope
    // erases everything it was handed.
    const p = plan({ kind: 'set', setId: 'set1' })
    expect(p.deleteAnswerIds.sort()).toEqual(['a1', 'a2', 'a3'])
    expect(p.deleteEventIds).toEqual(['e4'])
    expect(p.deleteAttemptIds.sort()).toEqual(['att1', 'att2'])
    expect(p.deleteSessionIds.sort()).toEqual(['s1', 's2'])
    expect(p.replayCardIds.sort()).toEqual(['c1', 'c2'])
    expect(p.deleteConfidenceEventCardIds.sort()).toEqual(['c1', 'c2'])
  })
})

describe('the B3 regression guard', () => {
  // resetUserMemory once cleared KLP evidence and left the posterior standing,
  // permanently and beyond the backfill's reach. Any scope that can delete an
  // AnswerKlpResult must replay the KLPs those rows credited. This makes a
  // repeat a build failure rather than silent corruption.
  const scopes: ErasureScope[] = [
    { kind: 'answer', answerId: 'a1' },
    { kind: 'event', eventId: 'e1' },
    { kind: 'attempt', attemptId: 'att1' },
    { kind: 'card', cardId: 'c1' },
    { kind: 'set', setId: 'set1' },
  ]

  it.each(scopes)('replays a KLP for every deleted answer (%o)', (scope) => {
    const snap = snapshot()
    const p = planErasure(snap, scope)
    const expectedKlps = new Set(
      snap.answers.filter((a) => p.deleteAnswerIds.includes(a.id)).flatMap((a) => a.klpIds),
    )
    for (const klpId of expectedKlps) {
      expect(p.replayKlpIds).toContain(klpId)
    }
  })

  it.each(scopes)('replays a card for every deleted answer or event (%o)', (scope) => {
    const snap = snapshot()
    const p = planErasure(snap, scope)
    const expectedCards = new Set([
      ...snap.answers.filter((a) => p.deleteAnswerIds.includes(a.id)).map((a) => a.cardId),
      ...snap.events.filter((e) => p.deleteEventIds.includes(e.id)).map((e) => e.cardId),
    ])
    for (const cardId of expectedCards) {
      expect(p.replayCardIds).toContain(cardId)
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/memory/erase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the planner**

Create `src/lib/memory/erase.ts`:

```ts
import { overallQuizScore } from '@/lib/quiz/scoring'
import { RESET_MEMORY_MODELS, type ResetMemoryModel } from './reset'

/**
 * The single place that decides what a deletion removes and what must be
 * replayed afterwards.
 *
 * PURE — no Prisma, no `auth`, no clock. The caller reads a snapshot inside its
 * transaction and passes it in as data. That is what makes every rule here a
 * unit test rather than a database integration test, and it is why the
 * invariant lives in one place instead of five hand-written copies:
 *
 *     no derived number may claim knowledge from evidence that no longer exists
 *
 * `CardProgress` and `KlpState` are incremental and NOT invertible — `stepBkt`
 * mixes two Bayes updates plus a learning term, so several priors map to one
 * posterior. Replaying from surviving rows is the only correct response to a
 * deletion.
 */

export type ErasureScope =
  | { kind: 'event'; eventId: string }
  | { kind: 'answer'; answerId: string }
  | { kind: 'attempt'; attemptId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'set'; setId: string }
  | { kind: 'account' }

export interface SnapshotAnswer {
  id: string
  attemptId: string
  cardId: string
  /** KLPs this answer credited, via its AnswerKlpResult rows. */
  klpIds: string[]
  score: number | null
}

export interface SnapshotEvent {
  id: string
  cardId: string
  /** Null for `review`/`matching`/`lesson`, which have no graded answer. */
  quizAnswerId: string | null
  source: string
}

export interface SnapshotAttempt {
  id: string
  sessionId: string | null
  /** EVERY answer on this attempt, deleted or not — the planner needs the
   *  full list to tell a partial deletion from a total one. */
  answers: { id: string; score: number | null }[]
}

export interface ErasureSnapshot {
  answers: SnapshotAnswer[]
  events: SnapshotEvent[]
  attempts: SnapshotAttempt[]
}

export interface ErasurePlan {
  deleteAnswerIds: string[]
  /**
   * Events deleted DIRECTLY. Events belonging to a deleted answer are absent:
   * the `quizAnswerId` FK cascade removes them, and listing them here would
   * imply application code owns a deletion the database guarantees.
   */
  deleteEventIds: string[]
  deleteAttemptIds: string[]
  deleteSessionIds: string[]
  /** Attempts that survive but lost answers — stored counters go stale. */
  updateAttempts: {
    attemptId: string
    sessionId: string | null
    score: number | null
    itemCount: number
  }[]
  /** The legacy Stage 2 history table, which has no replay. */
  deleteConfidenceEventCardIds: string[]
  replayCardIds: string[]
  replayKlpIds: string[]
}

/**
 * What the `account` scope truncates. `studySession` is NOT in
 * RESET_MEMORY_MODELS: both StudyEvent.sessionId and QuizAttempt.sessionId are
 * `onDelete: SetNull`, so a full reset used to leave every session standing as
 * an empty husk. Nothing renders sessions yet, which is why it never bit.
 */
export const ERASABLE_MEMORY_MODELS = [
  ...RESET_MEMORY_MODELS,
  'studySession',
] as const

export type ErasableMemoryModel = ResetMemoryModel | 'studySession'

const uniq = (xs: string[]): string[] => [...new Set(xs)]

export function planErasure(
  snapshot: ErasureSnapshot,
  scope: ErasureScope,
): ErasurePlan {
  const empty: ErasurePlan = {
    deleteAnswerIds: [],
    deleteEventIds: [],
    deleteAttemptIds: [],
    deleteSessionIds: [],
    updateAttempts: [],
    deleteConfidenceEventCardIds: [],
    replayCardIds: [],
    replayKlpIds: [],
  }

  // The account scope is a truncate, not a plan: loading every row in order to
  // decide to delete every row is absurd. `executeErasure` special-cases it
  // onto ERASABLE_MEMORY_MODELS. The variant stays in the union so the
  // vocabulary is complete and the coverage test has something to assert.
  if (scope.kind === 'account') return empty

  // 1. Which answers and which standalone events does this scope remove?
  let answerIds: string[] = []
  let eventIds: string[] = []
  let confidenceCardIds: string[] = []
  let wholeAttemptIds: string[] = []

  switch (scope.kind) {
    case 'answer': {
      answerIds = snapshot.answers.filter((a) => a.id === scope.answerId).map((a) => a.id)
      break
    }
    case 'event': {
      const event = snapshot.events.find((e) => e.id === scope.eventId)
      if (!event) break
      // Erasing an interaction erases every row describing it, from whichever
      // page you reached it. The cascade only runs answer -> event, so a
      // quiz-sourced event must be erased BY its answer.
      if (event.quizAnswerId !== null) {
        answerIds = [event.quizAnswerId]
      } else {
        eventIds = [event.id]
      }
      break
    }
    case 'attempt': {
      wholeAttemptIds = [scope.attemptId]
      answerIds = snapshot.answers.filter((a) => a.attemptId === scope.attemptId).map((a) => a.id)
      break
    }
    case 'card': {
      answerIds = snapshot.answers.filter((a) => a.cardId === scope.cardId).map((a) => a.id)
      eventIds = snapshot.events
        .filter((e) => e.cardId === scope.cardId && e.quizAnswerId === null)
        .map((e) => e.id)
      confidenceCardIds = [scope.cardId]
      break
    }
    case 'set': {
      // The snapshot loader has already narrowed to this set, so everything in
      // hand is in scope.
      answerIds = snapshot.answers.map((a) => a.id)
      eventIds = snapshot.events.filter((e) => e.quizAnswerId === null).map((e) => e.id)
      wholeAttemptIds = snapshot.attempts.map((a) => a.id)
      confidenceCardIds = uniq([
        ...snapshot.answers.map((a) => a.cardId),
        ...snapshot.events.map((e) => e.cardId),
      ])
      break
    }
  }

  const deletedAnswers = snapshot.answers.filter((a) => answerIds.includes(a.id))
  const deletedEvents = snapshot.events.filter((e) => eventIds.includes(e.id))

  // 2. Which attempts are emptied, and which merely lose answers?
  const touchedAttemptIds = uniq([
    ...deletedAnswers.map((a) => a.attemptId),
    ...wholeAttemptIds,
  ])

  const deleteAttemptIds: string[] = []
  const updateAttempts: ErasurePlan['updateAttempts'] = []

  for (const attemptId of touchedAttemptIds) {
    const attempt = snapshot.attempts.find((a) => a.id === attemptId)
    if (!attempt) continue

    const survivors = attempt.answers.filter((a) => !answerIds.includes(a.id))

    // An attempt whose last answer goes would otherwise linger in the activity
    // feed as a ghost quiz with nothing in it.
    if (wholeAttemptIds.includes(attemptId) || survivors.length === 0) {
      deleteAttemptIds.push(attemptId)
      continue
    }

    // Score and itemCount are STORED numbers derived from answers. Deleting one
    // makes both wrong, and nothing else recomputes them.
    //
    // Rounded because `overallQuizScore` returns a float mean and
    // `QuizAttempt.score` is an Int column — the live writer in
    // src/actions/quiz.ts rounds for the same reason.
    const mean = overallQuizScore(survivors)
    updateAttempts.push({
      attemptId,
      sessionId: attempt.sessionId,
      score: mean === null ? null : Math.round(mean),
      itemCount: survivors.length,
    })
  }

  const deleteSessionIds = deleteAttemptIds
    .map((id) => snapshot.attempts.find((a) => a.id === id)?.sessionId ?? null)
    .filter((id): id is string => id !== null)

  // 3. What must be replayed? Every card that lost an answer or an event, and
  //    every KLP a deleted answer credited.
  return {
    deleteAnswerIds: uniq(answerIds),
    deleteEventIds: uniq(eventIds),
    deleteAttemptIds: uniq(deleteAttemptIds),
    deleteSessionIds: uniq(deleteSessionIds),
    updateAttempts,
    deleteConfidenceEventCardIds: uniq(confidenceCardIds),
    replayCardIds: uniq([
      ...deletedAnswers.map((a) => a.cardId),
      ...deletedEvents.map((e) => e.cardId),
    ]),
    replayKlpIds: uniq(deletedAnswers.flatMap((a) => a.klpIds)),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/erase.test.ts`
Expected: PASS — all scope tests plus 10 parameterised guard cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/erase.ts tests/memory/erase.test.ts
git commit -m "feat(erase): add the pure erasure planner"
```

---

### Task 5: The executor — snapshot, delete, replay

**Files:**
- Create: `src/lib/memory/erase-execute.ts`
- Test: `tests/memory/erase-execute.test.ts` (new)

**Interfaces:**
- Consumes: `planErasure`, `ErasureScope`, `ERASABLE_MEMORY_MODELS` (Task 4); `recomputeCardProgress` (`src/lib/memory/recompute.ts`); `rebuildKlpStates`, `lockKlpStates` (`src/lib/metrics/state-writer.ts`).
- Produces: `executeErasure(userId: string, scope: ErasureScope): Promise<void>` — throws `new Error('Not found')` when the scope's root row is absent or belongs to another user.

- [ ] **Step 1: Write the failing tests**

Create `tests/memory/erase-execute.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  rebuildKlpStates: vi.fn(),
  lockKlpStates: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ prisma: { $transaction: h.transaction } }))
vi.mock('@/lib/metrics/state-writer', () => ({
  rebuildKlpStates: h.rebuildKlpStates,
  lockKlpStates: h.lockKlpStates,
}))

import { executeErasure } from '@/lib/memory/erase-execute'

/** A transaction client recording every call, with configurable reads. */
function fakeTx(overrides: Record<string, unknown> = {}) {
  const calls: { model: string; op: string; arg: unknown }[] = []
  const record = (model: string, op: string, result: unknown = []) =>
    vi.fn(async (arg: unknown) => {
      calls.push({ model, op, arg })
      return result
    })

  const tx = {
    calls,
    quizAnswer: {
      findMany: record('quizAnswer', 'findMany', overrides.answers ?? []),
      deleteMany: record('quizAnswer', 'deleteMany'),
    },
    studyEvent: {
      findMany: record('studyEvent', 'findMany', overrides.events ?? []),
      deleteMany: record('studyEvent', 'deleteMany'),
    },
    quizAttempt: {
      findUnique: record('quizAttempt', 'findUnique', overrides.attempt ?? null),
      findMany: record('quizAttempt', 'findMany', overrides.attempts ?? []),
      deleteMany: record('quizAttempt', 'deleteMany'),
      update: record('quizAttempt', 'update'),
    },
    studySession: {
      deleteMany: record('studySession', 'deleteMany'),
      update: record('studySession', 'update'),
    },
    confidenceEvent: { deleteMany: record('confidenceEvent', 'deleteMany') },
    cardProgress: {
      deleteMany: record('cardProgress', 'deleteMany'),
      upsert: record('cardProgress', 'upsert'),
    },
    klpState: { deleteMany: record('klpState', 'deleteMany') },
  }
  return tx
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeErasure', () => {
  it('takes the KLP row lock before reading any posterior', async () => {
    // Without the advisory lock, two writers read the same pre-state and the
    // second drops the first's observation — permanently, since the posterior
    // cannot be stepped backward.
    const tx = fakeTx({
      attempt: { id: 'att1', userId: 'u1', sessionId: 's1' },
      answers: [
        { id: 'a1', attemptId: 'att1', cardId: 'c1', score: 100, klpResults: [{ klpId: 'k1' }] },
      ],
      attempts: [{ id: 'att1', sessionId: 's1', answers: [{ id: 'a1', score: 100 }] }],
    })
    h.transaction.mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx))

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    expect(h.lockKlpStates).toHaveBeenCalledWith(tx, 'u1', ['k1'])
    const lockOrder = h.lockKlpStates.mock.invocationCallOrder[0]
    const deleteOrder = h.rebuildKlpStates.mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(deleteOrder)
  })

  it('rejects an attempt belonging to another user without deleting anything', async () => {
    const tx = fakeTx({ attempt: { id: 'att1', userId: 'someone-else', sessionId: 's1' } })
    h.transaction.mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx))

    await expect(
      executeErasure('u1', { kind: 'attempt', attemptId: 'att1' }),
    ).rejects.toThrow('Not found')

    expect(tx.calls.some((c) => c.op === 'deleteMany')).toBe(false)
  })

  it('replays the KLP posterior after the deletes, not before', async () => {
    // rebuildKlpStates reads SURVIVING AnswerKlpResult rows. Called first, it
    // would rebuild from evidence that is about to vanish.
    const tx = fakeTx({
      attempt: { id: 'att1', userId: 'u1', sessionId: 's1' },
      answers: [
        { id: 'a1', attemptId: 'att1', cardId: 'c1', score: 100, klpResults: [{ klpId: 'k1' }] },
      ],
      attempts: [{ id: 'att1', sessionId: 's1', answers: [{ id: 'a1', score: 100 }] }],
    })
    h.transaction.mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx))

    await executeErasure('u1', { kind: 'attempt', attemptId: 'att1' })

    const answerDelete = tx.calls.findIndex(
      (c) => c.model === 'quizAnswer' && c.op === 'deleteMany',
    )
    expect(answerDelete).toBeGreaterThanOrEqual(0)
    expect(h.rebuildKlpStates).toHaveBeenCalledWith(tx, 'u1', ['k1'])
  })

  it('truncates every erasable model for the account scope', async () => {
    const tx = fakeTx()
    h.transaction.mockImplementation(async (fn: (t: unknown) => Promise<void>) => fn(tx))

    await executeErasure('u1', { kind: 'account' })

    for (const model of ['quizAttempt', 'quizAnswer', 'confidenceEvent', 'cardProgress', 'studyEvent', 'klpState', 'studySession']) {
      expect(
        tx.calls.some((c) => c.model === model && c.op === 'deleteMany'),
        `${model} was not cleared`,
      ).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/memory/erase-execute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the executor**

Create `src/lib/memory/erase-execute.ts`:

```ts
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { lockKlpStates, rebuildKlpStates } from '@/lib/metrics/state-writer'
import { recomputeCardProgress } from './recompute'
import {
  ERASABLE_MEMORY_MODELS,
  planErasure,
  type ErasureScope,
  type ErasureSnapshot,
} from './erase'

type Tx = Prisma.TransactionClient

/**
 * Runs an erasure: read a snapshot, plan, delete, replay — all inside ONE
 * transaction, so a replay that throws rolls the deletes back rather than
 * leaving evidence gone and aggregates stale. That failure mode is the whole
 * reason this module exists.
 *
 * Ownership is checked on the MEMORY ROWS, not the content. Since set
 * visibility landed, a learner can study a link-shared set they do not own, and
 * their events and answers for someone else's card are legitimately theirs to
 * erase. So `card`/`set` filter by userId and deliberately do NOT require set
 * ownership; `answer`/`event`/`attempt` verify the root row's userId and throw
 * 'Not found' for both absent and not-yours.
 */
export async function executeErasure(
  userId: string,
  scope: ErasureScope,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (scope.kind === 'account') {
      await eraseAccount(tx, userId)
      return
    }

    const snapshot = await loadSnapshot(tx, userId, scope)
    const plan = planErasure(snapshot, scope)

    // BEFORE any posterior read or write. rebuildKlpStates is
    // read-modify-write with an absolute write, so two concurrent writers
    // would otherwise both read the same pre-state and the second would drop
    // the first's observation — a permanent loss.
    await lockKlpStates(tx, userId, plan.replayKlpIds)

    // --- deletes ---------------------------------------------------------
    // Answers first: the quizAnswerId FK cascades their StudyEvent rows, which
    // is why the plan never lists those events explicitly.
    if (plan.deleteAnswerIds.length > 0) {
      await tx.quizAnswer.deleteMany({
        where: { userId, id: { in: plan.deleteAnswerIds } },
      })
    }
    if (plan.deleteEventIds.length > 0) {
      await tx.studyEvent.deleteMany({
        where: { userId, id: { in: plan.deleteEventIds } },
      })
    }
    if (plan.deleteAttemptIds.length > 0) {
      await tx.quizAttempt.deleteMany({
        where: { userId, id: { in: plan.deleteAttemptIds } },
      })
    }
    if (plan.deleteSessionIds.length > 0) {
      await tx.studySession.deleteMany({
        where: { userId, id: { in: plan.deleteSessionIds } },
      })
    }
    if (plan.deleteConfidenceEventCardIds.length > 0) {
      await tx.confidenceEvent.deleteMany({
        where: { userId, cardId: { in: plan.deleteConfidenceEventCardIds } },
      })
    }

    // --- stored counters on survivors ------------------------------------
    for (const update of plan.updateAttempts) {
      await tx.quizAttempt.update({
        where: { id: update.attemptId },
        data: { score: update.score },
      })
      if (update.sessionId !== null) {
        await tx.studySession.update({
          where: { id: update.sessionId },
          data: { itemCount: update.itemCount },
        })
      }
    }

    // --- replays ---------------------------------------------------------
    await replayCardProgress(tx, userId, plan.replayCardIds)
    // Reads SURVIVING AnswerKlpResult rows, so it MUST run after the deletes.
    // It also deletes any KlpState with no evidence left, which is what stops a
    // stale posterior sitting above MIN_OBSERVATIONS forever.
    await rebuildKlpStates(tx, userId, plan.replayKlpIds)
  })
}

async function eraseAccount(tx: Tx, userId: string): Promise<void> {
  // A Record keyed on the model union rather than `prisma[model]`: Prisma's
  // delegates are generic over SelectSubset and do not unify structurally, so
  // indexing the client needs a cast through `unknown` that discards all
  // checking. This way adding a model to ERASABLE_MEMORY_MODELS is a type error
  // until a deleter exists for it, which is the property we actually want.
  const deleters: Record<(typeof ERASABLE_MEMORY_MODELS)[number], () => Promise<unknown>> = {
    quizAttempt: () => tx.quizAttempt.deleteMany({ where: { userId } }),
    quizAnswer: () => tx.quizAnswer.deleteMany({ where: { userId } }),
    confidenceEvent: () => tx.confidenceEvent.deleteMany({ where: { userId } }),
    cardProgress: () => tx.cardProgress.deleteMany({ where: { userId } }),
    studyEvent: () => tx.studyEvent.deleteMany({ where: { userId } }),
    klpState: () => tx.klpState.deleteMany({ where: { userId } }),
    studySession: () => tx.studySession.deleteMany({ where: { userId } }),
  }

  for (const model of ERASABLE_MEMORY_MODELS) {
    await deleters[model]()
  }
}

/** Replays CardProgress for each card from the events that survive. */
async function replayCardProgress(
  tx: Tx,
  userId: string,
  cardIds: string[],
): Promise<void> {
  for (const cardId of cardIds) {
    const remaining = await tx.studyEvent.findMany({
      where: { userId, cardId },
      select: { correct: true, score: true, createdAt: true },
    })
    const recomputed = recomputeCardProgress(remaining)

    if (recomputed === null) {
      // No evidence left: the card reverts to never-studied. The star goes with
      // it — a decided behaviour, not an oversight (see the spec's §2).
      await tx.cardProgress.deleteMany({ where: { userId, cardId } })
      continue
    }

    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: {
        confidence: recomputed.confidence,
        mastery: recomputed.mastery,
        reps: recomputed.reps,
        dueAt: recomputed.dueAt,
        lastSeenAt: recomputed.lastSeenAt,
      },
      create: {
        userId,
        cardId,
        confidence: recomputed.confidence,
        mastery: recomputed.mastery,
        reps: recomputed.reps,
        dueAt: recomputed.dueAt,
        lastSeenAt: recomputed.lastSeenAt,
        starred: false,
      },
    })
  }
}

/**
 * Reads exactly the rows the scope reaches, INSIDE the transaction and BEFORE
 * any delete — once the rows are gone there is no way to learn which cards and
 * KLPs they fed.
 */
async function loadSnapshot(
  tx: Tx,
  userId: string,
  scope: Exclude<ErasureScope, { kind: 'account' }>,
): Promise<ErasureSnapshot> {
  const answerWhere = await scopeToAnswerWhere(tx, userId, scope)
  const eventWhere = scopeToEventWhere(userId, scope)

  const answerRows = await tx.quizAnswer.findMany({
    where: answerWhere,
    select: {
      id: true,
      attemptId: true,
      cardId: true,
      score: true,
      klpResults: { select: { klpId: true } },
    },
  })

  const eventRows = await tx.studyEvent.findMany({
    where: eventWhere,
    select: { id: true, cardId: true, quizAnswerId: true, source: true },
  })

  // Every attempt touched, with its FULL answer list — the planner needs that
  // to tell a partial deletion from a total one.
  const attemptIds = [...new Set(answerRows.map((a) => a.attemptId))]
  const attemptRows =
    attemptIds.length === 0
      ? []
      : await tx.quizAttempt.findMany({
          where: { userId, id: { in: attemptIds } },
          select: {
            id: true,
            sessionId: true,
            answers: { select: { id: true, score: true } },
          },
        })

  return {
    answers: answerRows.map((a) => ({
      id: a.id,
      attemptId: a.attemptId,
      cardId: a.cardId,
      score: a.score,
      klpIds: a.klpResults.map((r) => r.klpId),
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      cardId: e.cardId,
      quizAnswerId: e.quizAnswerId,
      source: e.source,
    })),
    attempts: attemptRows.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      answers: t.answers.map((a) => ({ id: a.id, score: a.score })),
    })),
  }
}

async function scopeToAnswerWhere(
  tx: Tx,
  userId: string,
  scope: Exclude<ErasureScope, { kind: 'account' }>,
): Promise<Prisma.QuizAnswerWhereInput> {
  switch (scope.kind) {
    case 'answer':
      return { userId, id: scope.answerId }
    case 'event': {
      // The event may or may not have an answer; load its whole attempt so the
      // planner can recompute the survivor's counters.
      const event = await requireEvent(tx, userId, scope.eventId)
      return event.quizAnswerId === null
        ? { id: { in: [] } }
        : { userId, attempt: { answers: { some: { id: event.quizAnswerId } } } }
    }
    case 'attempt':
      await requireAttempt(tx, userId, scope.attemptId)
      return { userId, attemptId: scope.attemptId }
    case 'card':
      return { userId, cardId: scope.cardId }
    case 'set':
      return { userId, card: { setId: scope.setId } }
  }
}

function scopeToEventWhere(
  userId: string,
  scope: Exclude<ErasureScope, { kind: 'account' }>,
): Prisma.StudyEventWhereInput {
  switch (scope.kind) {
    case 'answer':
      return { userId, quizAnswerId: scope.answerId }
    case 'event':
      return { userId, id: scope.eventId }
    case 'attempt':
      return { userId, quizAnswer: { attemptId: scope.attemptId } }
    case 'card':
      return { userId, cardId: scope.cardId }
    case 'set':
      return { userId, card: { setId: scope.setId } }
  }
}

/** 'Not found' for both absent and not-yours — a distinguishable error
 *  confirms the row exists to someone probing ids. */
async function requireEvent(tx: Tx, userId: string, eventId: string) {
  const event = await tx.studyEvent.findUnique({
    where: { id: eventId },
    select: { userId: true, quizAnswerId: true },
  })
  if (!event || event.userId !== userId) throw new Error('Not found')
  return event
}

async function requireAttempt(tx: Tx, userId: string, attemptId: string) {
  const attempt = await tx.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { userId: true, sessionId: true },
  })
  if (!attempt || attempt.userId !== userId) throw new Error('Not found')
  return attempt
}
```

**Note for the implementer:** the `event` scope reads its event twice — once in `requireEvent` (for the ownership check and the `quizAnswerId`) and once via `scopeToEventWhere`. That is intentional: the ownership check must happen before anything else, and the second read keeps the snapshot's shape uniform across scopes. Both are inside the transaction.

Also add an `answer`-scope ownership check: `scopeToAnswerWhere`'s `answer` case filters on `userId`, so a foreign id yields an empty snapshot and an empty plan — a no-op rather than an error. Add an explicit guard so the action can report failure:

```ts
    case 'answer': {
      const answer = await tx.quizAnswer.findUnique({
        where: { id: scope.answerId },
        select: { userId: true },
      })
      if (!answer || answer.userId !== userId) throw new Error('Not found')
      return { userId, attempt: { answers: { some: { id: scope.answerId } } } }
    }
```

Note this widens the answer snapshot to the whole attempt, which the planner needs in order to recompute the survivor's score — the planner still deletes only `scope.answerId`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/erase-execute.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory/erase-execute.ts tests/memory/erase-execute.test.ts
git commit -m "feat(erase): add the transactional erasure executor"
```

---

### Task 6: Rewire the existing verbs and add the two new ones

**Files:**
- Modify: `src/actions/memory.ts:269-369`
- Test: `tests/actions/memory-erase.test.ts` (new)

**Interfaces:**
- Consumes: `executeErasure` (Task 5).
- Produces: `resetQuizAttempt(attemptId: string): Promise<ActionResult<void>>`, `resetQuizAnswer(answerId: string): Promise<ActionResult<void>>`. Existing signatures for `deleteStudyEvent`, `forgetCard`, `forgetSet` are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/actions/memory-erase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), executeErasure: vi.fn() }))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/memory/erase-execute', () => ({ executeErasure: h.executeErasure }))

import {
  deleteStudyEvent,
  forgetCard,
  forgetSet,
  resetQuizAttempt,
  resetQuizAnswer,
} from '@/actions/memory'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.executeErasure.mockResolvedValue(undefined)
})

describe('the memory erasure actions', () => {
  it.each([
    ['deleteStudyEvent', () => deleteStudyEvent('e1'), { kind: 'event', eventId: 'e1' }],
    ['forgetCard', () => forgetCard('c1'), { kind: 'card', cardId: 'c1' }],
    ['forgetSet', () => forgetSet('s1'), { kind: 'set', setId: 's1' }],
    ['resetQuizAttempt', () => resetQuizAttempt('att1'), { kind: 'attempt', attemptId: 'att1' }],
    ['resetQuizAnswer', () => resetQuizAnswer('a1'), { kind: 'answer', answerId: 'a1' }],
  ])('%s delegates to executeErasure with its scope', async (_name, call, scope) => {
    // Every verb goes through the one module. Five hand-written copies of
    // "delete then replay" is what let resetUserMemory forget KlpState once.
    const result = await call()
    expect(result.success).toBe(true)
    expect(h.executeErasure).toHaveBeenCalledWith('u1', scope)
  })

  it('rejects a signed-out caller without erasing anything', async () => {
    h.auth.mockResolvedValue(null)
    const result = await forgetCard('c1')
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
    expect(h.executeErasure).not.toHaveBeenCalled()
  })

  it('reports a failure rather than throwing', async () => {
    h.executeErasure.mockRejectedValue(new Error('Not found'))
    const result = await resetQuizAttempt('att1')
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/actions/memory-erase.test.ts`
Expected: FAIL — `resetQuizAttempt` / `resetQuizAnswer` do not exist.

- [ ] **Step 3: Replace the three verbs and add two**

In `src/actions/memory.ts`, delete the bodies of `deleteStudyEvent` (`:269-327`), `forgetCard` (`:329-348`) and `forgetSet` (`:350-369`), and replace all three plus the two new verbs with:

```ts
/**
 * Every erasure verb is a scope selector over one module. The rules for what
 * each scope removes and what it replays live in `src/lib/memory/erase.ts`,
 * where they are pure and unit-tested — NOT here, and not duplicated per verb.
 */
async function erase(scope: ErasureScope, failure: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    await executeErasure(session.user.id, scope);
    revalidatePath('/profile/memory');
    revalidatePath('/profile');
    return { success: true, data: undefined };
  } catch (error) {
    console.error(`${failure}:`, error);
    return { success: false, error: failure };
  }
}

export async function deleteStudyEvent(eventId: string): Promise<ActionResult<void>> {
  return erase({ kind: 'event', eventId }, 'Failed to delete entry');
}

export async function forgetCard(cardId: string): Promise<ActionResult<void>> {
  return erase({ kind: 'card', cardId }, 'Failed to forget card');
}

export async function forgetSet(setId: string): Promise<ActionResult<void>> {
  return erase({ kind: 'set', setId }, 'Failed to forget set');
}

/** Erases one quiz outright — attempt, answers, session, events. */
export async function resetQuizAttempt(attemptId: string): Promise<ActionResult<void>> {
  return erase({ kind: 'attempt', attemptId }, 'Failed to reset this quiz');
}

/** Erases one question from a quiz, recomputing the attempt's stored score. */
export async function resetQuizAnswer(answerId: string): Promise<ActionResult<void>> {
  return erase({ kind: 'answer', answerId }, 'Failed to reset this question');
}
```

Add the imports at the top of the file and remove the now-unused `recomputeCardProgress` import:

```ts
import { executeErasure } from '@/lib/memory/erase-execute';
import type { ErasureScope } from '@/lib/memory/erase';
```

**Note:** `erase` is a module-private helper in a `'use server'` file. Next.js permits only async exported functions there — `erase` is not exported, so it is fine, but it must stay `async`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/actions/memory-erase.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
```
Expected: clean; no pre-existing test broken.

- [ ] **Step 6: Commit**

```bash
git add src/actions/memory.ts tests/actions/memory-erase.test.ts
git commit -m "feat(erase): route every memory verb through the erasure module"
```

---

### Task 7: Account reset — add StudySession and route it through the module

**Files:**
- Modify: `src/lib/memory/reset.ts:25-32` (doc comment only)
- Modify: `src/actions/user.ts:93-130`
- Test: `tests/memory/erase-coverage.test.ts` (new)

**Interfaces:**
- Consumes: `ERASABLE_MEMORY_MODELS`, `executeErasure` (Tasks 4, 5).
- Produces: `resetUserMemory` unchanged in signature.

- [ ] **Step 1: Write the failing coverage test**

Create `tests/memory/erase-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RESET_MEMORY_MODELS } from '@/lib/memory/reset'
import { ERASABLE_MEMORY_MODELS } from '@/lib/memory/erase'

describe('ERASABLE_MEMORY_MODELS', () => {
  it('covers every model the legacy reset list names', () => {
    // Adding a memory model without teaching erasure about it must fail here
    // rather than leave rows standing after a reset.
    for (const model of RESET_MEMORY_MODELS) {
      expect(ERASABLE_MEMORY_MODELS).toContain(model)
    }
  })

  it('adds studySession, which RESET_MEMORY_MODELS omits', () => {
    // Both StudyEvent.sessionId and QuizAttempt.sessionId are onDelete: SetNull,
    // so a full reset used to leave every session row standing as an empty husk.
    expect(RESET_MEMORY_MODELS).not.toContain('studySession')
    expect(ERASABLE_MEMORY_MODELS).toContain('studySession')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/memory/erase-coverage.test.ts`
Expected: PASS on the first case, FAIL if Task 4's constant was not written as specified — in which case fix `erase.ts`, not this test.

- [ ] **Step 3: Point `resetUserMemory` at the module**

Replace the body of `resetUserMemory` in `src/actions/user.ts` with:

```ts
export async function resetUserMemory(): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // The delete set now lives in ERASABLE_MEMORY_MODELS (src/lib/memory/erase.ts)
    // alongside every other erasure verb, so there is one answer to "what counts
    // as memory" rather than two that can drift. It adds `studySession`, which
    // the old list omitted — both sessionId FKs are onDelete: SetNull, so a
    // reset left every session standing as an empty husk.
    await executeErasure(session.user.id, { kind: 'account' });

    revalidatePath('/profile');
    revalidatePath('/profile/memory');
    return { success: true };
  } catch (error) {
    console.error('Reset error:', error);
    return { success: false, error: 'Failed to reset memory' };
  }
}
```

Update the imports at the top: add `import { executeErasure } from '@/lib/memory/erase-execute';`, and drop `RESET_MEMORY_MODELS`, `ResetMemoryModel` and the `Prisma` type import if nothing else in the file uses them.

- [ ] **Step 4: Update the `reset.ts` doc comment**

`RESET_MEMORY_MODELS` is now consumed only by `erase.ts` and the coverage test. Amend its doc comment so the next reader is not misled:

```ts
/**
 * The legacy delete set for a full memory reset.
 *
 * NO LONGER read by `resetUserMemory` directly — it is spread into
 * `ERASABLE_MEMORY_MODELS` (src/lib/memory/erase.ts), which adds `studySession`
 * and is what the account erasure scope actually truncates. This list survives
 * as the historical record, and a test asserts the newer constant covers it.
 *
 * ... (keep the existing paragraphs about delete order and klpState) ...
 */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/erase-coverage.test.ts tests/memory/erase-execute.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/user.ts src/lib/memory/reset.ts tests/memory/erase-coverage.test.ts
git commit -m "fix(erase): clear StudySession on a full memory reset"
```

---

### Task 8: Make the activity permalink reachable

**Files:**
- Modify: `src/actions/user.ts` (`UserStats.recentAttempts`, ~:22-29 and :77-84)
- Modify: `src/app/profile/page.tsx:147`
- Test: `tests/actions/user-stats-session.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `UserStats.recentAttempts[].sessionId: string | null`.

`/profile/activity/[id]` renders a full quiz permalink but **nothing in the app links to it** — verified with a repo-wide grep for `activity/`. Task 9 puts the reset control there, so it must first be reachable.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/user-stats-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindMany: vi.fn(),
  progressFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findMany: h.attemptFindMany },
    cardProgress: { findMany: h.progressFindMany },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getUserStats } from '@/actions/user'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.progressFindMany.mockResolvedValue([])
})

describe('getUserStats', () => {
  it('returns each attempt\'s sessionId so the activity permalink is reachable', () => {
    // The permalink is keyed on the SESSION, not the attempt.
    h.attemptFindMany.mockResolvedValue([
      { id: 'att1', mode: 'multiple-choice', score: 80, createdAt: new Date(), sessionId: 's1', set: { id: 'set1', title: 'S' } },
    ])
    return getUserStats().then((res) => {
      expect(res.data!.recentAttempts[0].sessionId).toBe('s1')
    })
  })

  it('surfaces a null sessionId for a pre-Stage-6 attempt', () => {
    // Those attempts have no session and must render unlinked, not crash.
    h.attemptFindMany.mockResolvedValue([
      { id: 'att1', mode: 'multiple-choice', score: 80, createdAt: new Date(), sessionId: null, set: { id: 'set1', title: 'S' } },
    ])
    return getUserStats().then((res) => {
      expect(res.data!.recentAttempts[0].sessionId).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/actions/user-stats-session.test.ts`
Expected: FAIL — `sessionId` undefined.

- [ ] **Step 3: Add `sessionId` to the stats shape**

In `src/actions/user.ts`, extend the interface:

```ts
  recentAttempts: {
    id: string;
    setId: string;
    setTitle: string;
    mode: string;
    score: number | null;
    date: Date;
    /** The activity permalink is keyed on the session, not the attempt.
     *  Null for pre-Stage-6 attempts, which have no session envelope. */
    sessionId: string | null;
  }[];
```

And in the mapping at `:77`:

```ts
        recentAttempts: attempts.slice(0, 5).map((a) => ({
          id: a.id,
          setId: a.set.id,
          setTitle: a.set.title,
          mode: a.mode,
          score: a.score,
          date: a.createdAt,
          sessionId: a.sessionId,
        })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/actions/user-stats-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Repoint the Recent Attempts link**

In `src/app/profile/page.tsx:147`, the attempt row currently links to `/profile/memory?sets=${attempt.setId}`. Replace that `Link` with a conditional: when `attempt.sessionId` exists, link to the permalink; otherwise render the same markup unwrapped.

```tsx
{attempt.sessionId ? (
  <Link href={`/profile/activity/${attempt.sessionId}`} className="...keep the existing classes...">
    {/* keep the existing row content unchanged */}
  </Link>
) : (
  <div className="...keep the existing classes, minus any hover/link affordance...">
    {/* the same row content */}
  </div>
)}
```

Extract the row content into a local `const row = (...)` first so it is written once rather than duplicated across the two branches.

- [ ] **Step 6: Verify in the browser**

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```
Visit `/profile`, click a recent attempt, confirm it lands on the activity permalink and renders the quiz.

- [ ] **Step 7: Commit**

```bash
git add src/actions/user.ts src/app/profile/page.tsx tests/actions/user-stats-session.test.ts
git commit -m "feat(erase): link recent attempts to the activity permalink"
```

---

### Task 9: The reset controls

**Files:**
- Modify: `src/components/quiz/QuizSummary.tsx:24-30` (props), `:392-400` (answer card header)
- Create: `src/components/memory/ResetQuizButton.tsx`
- Modify: `src/app/profile/activity/[id]/page.tsx`
- Test: `tests/components/reset-quiz-button.test.tsx` (new)

**Interfaces:**
- Consumes: `resetQuizAttempt`, `resetQuizAnswer` (Task 6).
- Produces: `QuizSummaryProps.canReset?: boolean` (default `false`); `<ResetQuizButton attemptId setId />`.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/reset-quiz-button.test.tsx`, whose **first line must be** the jsdom docblock (this repo opts in per-file — see `vitest.config.ts`):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ resetQuizAttempt: vi.fn(), push: vi.fn() }))

vi.mock('@/actions/memory', () => ({ resetQuizAttempt: h.resetQuizAttempt }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ResetQuizButton } from '@/components/memory/ResetQuizButton'

beforeEach(() => {
  vi.clearAllMocks()
  h.resetQuizAttempt.mockResolvedValue({ success: true })
})

describe('ResetQuizButton', () => {
  it('does not erase until the confirmation phrase is typed exactly', () => {
    // This deletes graded work permanently. A one-click confirm is too cheap.
    render(<ResetQuizButton attemptId="att1" setId="set1" />)
    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))

    const confirmButton = screen.getByRole('button', { name: /^delete$/i })
    expect(confirmButton).toBeDisabled()
    expect(h.resetQuizAttempt).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'delete' } })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'DELETE' } })
    expect(confirmButton).toBeEnabled()
  })

  it('erases and returns to the profile on confirmation', async () => {
    render(<ResetQuizButton attemptId="att1" setId="set1" />)
    fireEvent.click(screen.getByRole('button', { name: /reset this quiz/i }))
    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(h.resetQuizAttempt).toHaveBeenCalledWith('att1'))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/profile'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/reset-quiz-button.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the button**

Create `src/components/memory/ResetQuizButton.tsx`:

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { resetQuizAttempt } from '@/actions/memory'

const CONFIRM_PHRASE = 'DELETE'

/**
 * Erases one quiz outright — attempt, answers, session, and the memory events
 * they produced. Behind a typed confirmation rather than a `confirm()`: this
 * deletes graded work permanently and there is no undo.
 */
export function ResetQuizButton({ attemptId }: { attemptId: string; setId?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const result = await resetQuizAttempt(attemptId)
    setBusy(false)
    // Early return, not `if (result.success && ...)`: ActionResult is a
    // discriminated union, so `error` only narrows inside the failure arm.
    if (!result.success) {
      toast.error(result.error || 'Failed to reset this quiz')
      return
    }
    toast.success('Quiz erased')
    router.push('/profile')
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="w-4 h-4 mr-1" /> Reset this quiz
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
      <p className="text-sm text-muted-foreground">
        This permanently deletes this quiz, every answer in it, and the confidence
        and knowledge those answers contributed. Your other quizzes are unaffected.
        This cannot be undone.
      </p>
      <label htmlFor="reset-quiz-confirm" className="block text-sm font-medium">
        Type {CONFIRM_PHRASE} to confirm
      </label>
      <Input
        id="reset-quiz-confirm"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        autoComplete="off"
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={phrase !== CONFIRM_PHRASE || busy}
          onClick={run}
        >
          {busy ? 'Erasing…' : 'Delete'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setPhrase('') }}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/reset-quiz-button.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the `canReset` prop to QuizSummary**

In `src/components/quiz/QuizSummary.tsx`, extend the props interface:

```ts
interface QuizSummaryProps {
  /** Live score handed down by QuizContainer. Absent on the permalink, where
   *  the saved attempt is the source of truth. */
  score?: number;
  setId: string;
  attemptId: string;
  /**
   * Show per-question erase controls. Default false, so the LIVE end-of-quiz
   * screen — which renders this same component — is unaffected. Only the
   * activity permalink opts in.
   */
  canReset?: boolean;
}
```

Update the signature and add a handler:

```tsx
export function QuizSummary({ score, setId, attemptId, canReset = false }: QuizSummaryProps) {
```

```tsx
  async function handleResetAnswer(answerId: string) {
    const result = await resetQuizAnswer(answerId);
    if (!result.success) {
      toast.error(result.error || 'Failed to reset this question');
      return;
    }
    toast.success('Question erased');
    // Reload rather than filtering locally: erasing the last answer deletes the
    // whole attempt, and the recomputed score comes from the server.
    const refreshed = await getQuizAttemptSummary(attemptId);
    if (refreshed.success && refreshed.data) setSummary(refreshed.data);
    else router.push('/profile');
  }
```

Add the imports this needs: `resetQuizAnswer` from `@/actions/memory`, `toast` from `sonner`, `useRouter` from `next/navigation`, and `Trash2` from `lucide-react` if not already imported.

In the answer card header (~`:392`), inside the existing `<CardTitle className="flex items-center justify-between gap-2">`, append after the grade badge:

```tsx
                            {canReset && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0"
                                aria-label={`Erase question ${index + 1}`}
                                onClick={() => handleResetAnswer(answer.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
```

- [ ] **Step 6: Wire the activity page**

In `src/app/profile/activity/[id]/page.tsx`, pass `canReset` and render the button. The page is a server component and `ResetQuizButton` is a client component, so it can be rendered directly:

```tsx
      {activity.kind === 'quiz' && activity.attemptId ? (
        <>
          <QuizSummary setId={activity.setId} attemptId={activity.attemptId} canReset />
          <ResetQuizButton attemptId={activity.attemptId} setId={activity.setId} />
        </>
      ) : (
```

Add `import { ResetQuizButton } from '@/components/memory/ResetQuizButton';` at the top.

- [ ] **Step 7: Verify the live quiz screen is untouched**

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```
Take a quiz to the end. Confirm **no** trash icons appear on the results screen. Then open the same quiz via `/profile` → the attempt → confirm the icons and the "Reset this quiz" button DO appear.

- [ ] **Step 8: Run the suite and commit**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
git add src/components/memory/ResetQuizButton.tsx src/components/quiz/QuizSummary.tsx "src/app/profile/activity/[id]/page.tsx" tests/components/reset-quiz-button.test.tsx
git commit -m "feat(erase): add per-quiz and per-question reset controls"
```

---

### Task 10: Tell the truth in the confirmation copy, and update the docs

**Files:**
- Modify: `src/app/profile/memory/page.tsx:148`, `:161`, `:175`
- Modify: `CLAUDE.md` (Future Considerations)
- Modify: `docs/superpowers/BUILD-QUEUE.md`

**Interfaces:**
- Consumes: the behaviour changes from Tasks 6-7.
- Produces: nothing consumed by later tasks.

The three confirm strings now describe behaviour the app no longer has. That is a correctness bug in a destructive flow, not a copy nit.

- [ ] **Step 1: Rewrite the per-entry confirm (`:148`)**

```ts
    if (!confirm(
      "Delete this entry? If it came from a quiz, the graded answer is deleted too, and this card's confidence and mastery are recomputed from its remaining history.",
    )) return;
```

- [ ] **Step 2: Rewrite the forget-card confirm (`:161`)**

```ts
    if (!confirm(
      `Forget everything about "${term}"? This deletes its study history AND its graded quiz answers, resets it to unseen, and unstars it. This cannot be undone.`,
    )) return;
```

- [ ] **Step 3: Rewrite the forget-set confirm (`:175`)**

```ts
    if (!confirm(
      `Forget all memory for "${title}"? This deletes study history, graded quiz answers, and quiz results for every card in this set, and unstars them. This cannot be undone.`,
    )) return;
```

- [ ] **Step 4: Update the Danger Zone description**

The card at `:297-300` promises "all your quiz history, confidence scores, and progress". That is now accurate — leave the wording, but confirm it reads correctly against the new behaviour before moving on.

- [ ] **Step 5: Delete the stale CLAUDE.md paragraph**

In `CLAUDE.md` → Future Considerations, remove the entire **"DECIDED 2026-08-08, not yet built"** bullet and the "What 'forget' should do to the knowledge posterior was undecided" paragraph beneath it. Replace both with one line:

```markdown
- **RESOLVED 2026-08-10 — "forget" erases the evidence, not just the estimate.** `forgetCard`/`forgetSet` now delete the card's `QuizAnswer` rows (cascading `AnswerKlpResult`/`AnswerErrorTag`) and replay `KlpState`; granular per-quiz and per-question resets exist. Every verb routes through one pure planner, `src/lib/memory/erase.ts`. See `docs/superpowers/specs/2026-08-10-deletion-and-forgetting-design.md`.
```

- [ ] **Step 6: Update the build queue**

In `docs/superpowers/BUILD-QUEUE.md`, mark item 2 done in the same style as item 1, and add to the "Fixed" table:

| Finding | Where | Commit |
| --- | --- | --- |
| `StudySession` was missing from `RESET_MEMORY_MODELS`; both `sessionId` FKs are `SetNull`, so a full account reset left every session row standing as an empty husk. | `src/lib/memory/erase.ts` | (task 7's commit) |
| A quiz resubmit stepped confidence twice — the superseded answer's `StudyEvent` survived the replace, and `CardProgress` is incremental. | `src/actions/quiz.ts` | (task 2's commit) |

Also update the **Baselines** section with the new test count.

- [ ] **Step 7: Commit**

```bash
git add src/app/profile/memory/page.tsx CLAUDE.md docs/superpowers/BUILD-QUEUE.md
git commit -m "docs(erase): correct the destructive-action copy and close queue item 2"
```

---

### Task 11: Live verification

**Files:** none — this is a verification gate.

Tests here are pure and mocked, so **nothing so far has proven the FK cascade or a replay against a real database.** The visibility work in this repo shipped only after live verification for exactly this reason.

- [ ] **Step 1: Start the dev server**

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```

(To stop it later on Windows: `netstat -ano | grep :3001` then `taskkill /PID <pid> /F` — `pkill` does not work.)

- [ ] **Step 2: Record a before-state**

```bash
npx tsx --env-file=.env -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{console.log({answers:await p.quizAnswer.count(),events:await p.studyEvent.count(),klpResults:await p.answerKlpResult.count(),klpStates:await p.klpState.count(),progress:await p.cardProgress.count(),sessions:await p.studySession.count(),attempts:await p.quizAttempt.count()});await p.\$disconnect()})()"
```

Save the numbers.

- [ ] **Step 3: Take a short quiz, then erase one question**

Take a 3-question quiz. Open `/profile` → the new attempt → erase question 1. Then confirm, by re-running the count script:
- `answers` down by exactly 1
- `events` down by exactly 1 — **this proves the cascade**, since no application code deletes it
- `klpResults` down by that answer's KLP count
- `attempts` unchanged, and the attempt's `score` on screen has changed to reflect two questions

- [ ] **Step 4: Erase the remaining two questions**

After the last one goes, confirm the attempt AND its session are gone (`attempts` and `sessions` each down by 1) and you were returned to `/profile`.

- [ ] **Step 5: Forget a card that has quiz history**

Star a card, quiz on it, then `/profile/memory` → filter to that card → "Forget this card". Confirm:
- its `QuizAnswer` rows are gone (not just the events)
- its `KlpState` rows are gone, since no evidence survives
- the card shows as unstarred and unseen

- [ ] **Step 6: Confirm no orphaned sessions after a full reset**

Use the Danger Zone reset, then check `sessions` is **0**. Before this work it would have stayed non-zero.

- [ ] **Step 7: Final baselines**

```bash
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npm run lint
```
Expected: typecheck clean; all tests pass; lint still **187 problems** and no more — any increase is from this work and must be fixed.

- [ ] **Step 8: Commit any fixes and finish**

Use the `superpowers:finishing-a-development-branch` skill to decide how this integrates.

---

## Notes for the implementer

**Two findings this plan carries beyond the spec.** Both were discovered while reading the code to write it, and both are consequences of Task 1 rather than optional extras:

1. **Task 2 is not optional.** Adding the FK changes resubmit behaviour, because `createAnswerWithAnalysis` deletes the superseded answer. Without the replay, `CardProgress` keeps a confidence step from a cascaded-away event — the exact invariant violation this feature exists to prevent, on a hot path.
2. **Task 7's `studySession` addition** fixes a live defect that predates this work.

**What is deliberately NOT in scope** (spec §8): `TrainingPlan` staleness, undo, batching the per-KLP advisory locks, and a reset verb for non-quiz sessions.
