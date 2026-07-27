# Memory History View & Selective Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a `/profile/memory` page that shows their full `StudyEvent` activity history (flat, filterable feed) and lets them delete a single event, forget one card, forget one set, or fully reset — instead of today's all-or-nothing "Reset Memory" button being the only control.

**Architecture:** Purely additive on top of the existing Stage 6 memory system. No schema changes and no changes to the existing write path (`recordStudyEvent`, `src/lib/memory/record.ts`) or its pure scoring functions (`nextConfidence`/`masteryScore` in `src/lib/memory/scoring.ts`, `nextDueAt` in `src/lib/memory/schedule.ts`). This plan adds: one new pure function (`recomputeCardProgress`) that replays a card's *remaining* `StudyEvent` rows through those same trusted functions after a deletion; one new actions file (`src/actions/memory.ts`) for reading/paginating history and performing the three new deletions; and one new page (`src/app/profile/memory/page.tsx`) plus a small edit to `src/app/profile/page.tsx` to relocate the existing full-reset control there.

**Tech Stack:** Next.js App Router Server Actions (`'use server'`), Prisma, Vitest, existing shadcn-style UI primitives (`Card`, `Button`, `Badge`) — no new UI library.

## Global Constraints

- No Prisma schema changes — `StudyEvent`, `CardProgress`, `ConfidenceEvent` already have every field needed (per `prisma/schema.prisma:163-227`).
- Do not modify `nextConfidence`, `masteryScore` (`src/lib/memory/scoring.ts`), `nextDueAt` (`src/lib/memory/schedule.ts`), or `recordStudyEvent` (`src/lib/memory/record.ts`) — this plan only *reads* and *replays through* them.
- New server actions use the shared discriminated-union `ActionResult<T>` from `src/types/action.ts` (the pattern already used in `src/actions/sets.ts`/`training-plan.ts`), not the loose ad-hoc `ActionResult` redeclared in `user.ts`/`quiz.ts`.
- Every mutation is scoped by `userId` from `auth()` directly in the Prisma `where` clause (matching `resetUserMemory` in `src/actions/user.ts:65`) — this is this codebase's existing ownership-check convention, not a separate fetch-then-compare step, except where an action is keyed by a row id it doesn't already have the owner for (`deleteStudyEvent`), which must fetch that row first to check `userId` before deleting.
- Destructive UI actions are confirm-gated via the browser's native `confirm()`, matching `handleReset` in `src/app/profile/page.tsx:32` — no new dialog/modal library.
- New pure logic gets Vitest unit tests mirroring `tests/memory/schedule.test.ts` / `scoring.test.ts`. DB-touching action functions do **not** get automated tests — there is no DB-mocking precedent anywhere in this repo (confirmed: only `tests/{ai,cards,game,memory,parser,quiz,review}` exist, all pure-function tests); they're verified manually against the dev DB in Task 6, matching how `resetUserMemory`, `buildLearnerProfile`'s DB shell, and `getDueCards`'s DB shell are already unverified-by-automated-test today.

---

### Task 1: Pure `recomputeCardProgress` function

**Files:**
- Create: `src/lib/memory/recompute.ts`
- Test: `tests/memory/recompute.test.ts`

**Interfaces:**
- Consumes: `nextConfidence`, `StudyOutcome` from `src/lib/memory/scoring.ts` (existing, exported at `scoring.ts:48,27`); `masteryScore`, `MasteryEvent` from `scoring.ts` (`scoring.ts:104,67`); `nextDueAt`, `NextDueAtInput` from `src/lib/memory/schedule.ts` (`schedule.ts:92,28`).
- Produces: `RecomputeEvent` (input row shape), `RecomputedCardProgress` (output shape), `recomputeCardProgress(remainingEvents: RecomputeEvent[]): RecomputedCardProgress | null` — consumed by Task 3's `deleteStudyEvent`.

- [ ] **Step 1: Write the failing tests**

Create `tests/memory/recompute.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { recomputeCardProgress } from '@/lib/memory/recompute'
import { masteryScore } from '@/lib/memory/scoring'
import type { RecomputeEvent } from '@/lib/memory/recompute'

const t1 = new Date('2026-07-20T00:00:00.000Z')
const t2 = new Date('2026-07-22T00:00:00.000Z')
const t3 = new Date('2026-07-24T00:00:00.000Z')

describe('recomputeCardProgress', () => {
  it('returns null when no events remain (card should revert to unseen)', () => {
    expect(recomputeCardProgress([])).toBeNull()
  })

  it('replays a single correct binary event from the default baseline (confidence 5, reps 0)', () => {
    const events: RecomputeEvent[] = [
      { correct: true, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(6) // 5 + 1 (correct binary delta)
    expect(result!.reps).toBe(1)
    expect(result!.lastSeenAt.getTime()).toBe(t1.getTime())
    expect(result!.mastery).toBe(masteryScore(events))
  })

  it('replays a single incorrect binary event', () => {
    const events: RecomputeEvent[] = [
      { correct: false, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result!.confidence).toBe(4) // 5 - 1
    expect(result!.reps).toBe(0)
  })

  it('reconstructs the graded (short-answer) outcome from score, not just the correct flag', () => {
    // score=40 -> overall=4.0 -> gradedDelta(<=4) = -2, so confidence should be
    // 5 - 2 = 3. record.ts also stores correct=false for this row (overall < 8).
    // If recompute wrongly replayed this as a plain {correct:false} binary
    // event, confidence would come out as 4 instead of 3 - this discriminates.
    const events: RecomputeEvent[] = [
      { correct: false, score: 40, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result!.confidence).toBe(3)
    expect(result!.reps).toBe(0) // reps/dueAt use the stored `correct` flag directly
  })

  it('replays multiple events in chronological order regardless of input array order', () => {
    // Chronological: correct(t1) -> wrong(t2) -> correct(t3)
    // t1: confidence 5->6, reps 0->1
    // t2: confidence 6->5, reps ->0
    // t3: confidence 5->6, reps 0->1
    const chronological: RecomputeEvent[] = [
      { correct: true, score: null, createdAt: t1 },
      { correct: false, score: null, createdAt: t2 },
      { correct: true, score: null, createdAt: t3 },
    ]
    const shuffled = [chronological[2], chronological[0], chronological[1]]

    const expected = recomputeCardProgress(chronological)
    const actual = recomputeCardProgress(shuffled)

    expect(actual!.confidence).toBe(6)
    expect(actual!.reps).toBe(1)
    expect(actual!.lastSeenAt.getTime()).toBe(t3.getTime())
    expect(actual).toEqual(expected)
  })

  it('mastery matches calling masteryScore directly over the same remaining events', () => {
    const events: RecomputeEvent[] = [
      { correct: true, score: null, createdAt: t1 },
      { correct: false, score: null, createdAt: t2 },
    ]
    const result = recomputeCardProgress(events)
    expect(result!.mastery).toBe(masteryScore(events))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/memory/recompute.test.ts`
Expected: FAIL — `Cannot find module '@/lib/memory/recompute'`.

- [ ] **Step 3: Implement `recomputeCardProgress`**

Create `src/lib/memory/recompute.ts`:

```ts
/**
 * Pure replay logic for recomputing a card's CardProgress after one or more
 * of its StudyEvent rows have been deleted (src/actions/memory.ts's
 * `deleteStudyEvent`). Reuses the exact same pure functions the live write
 * path (`recordStudyEvent`, src/lib/memory/record.ts) already trusts —
 * `nextConfidence`/`masteryScore` (scoring.ts) and `nextDueAt` (schedule.ts)
 * — so a recompute produces the same state as if the remaining events had
 * been the only ones ever applied, incrementally, in order.
 */
import { nextConfidence, masteryScore } from './scoring'
import type { StudyOutcome, MasteryEvent } from './scoring'
import { nextDueAt } from './schedule'

const DEFAULT_CONFIDENCE = 5

/** The minimal StudyEvent shape this replay needs. */
export interface RecomputeEvent {
  correct: boolean | null
  score: number | null
  createdAt: Date
}

export interface RecomputedCardProgress {
  confidence: number
  mastery: number | null
  reps: number
  dueAt: Date
  lastSeenAt: Date
}

/**
 * `score` is on the 0-100 scale record.ts writes (`Math.round(overall * 10)`
 * for graded short-answer outcomes); `nextConfidence` expects `overall` back
 * on the original 1-10 rubric scale, so this divides by 10 to invert that.
 */
function toOutcome(event: RecomputeEvent): StudyOutcome {
  if (event.score !== null) return { overall: event.score / 10 }
  return { correct: !!event.correct }
}

/**
 * Replays `remainingEvents` (any order) in chronological order from the same
 * defaults `recordStudyEvent` uses for a fresh card (confidence 5, reps 0),
 * returning the resulting CardProgress state. Returns `null` when the list is
 * empty, signaling the caller to delete the CardProgress row entirely rather
 * than upsert a stale one (the card reverts to "never studied").
 */
export function recomputeCardProgress(
  remainingEvents: RecomputeEvent[],
): RecomputedCardProgress | null {
  if (remainingEvents.length === 0) return null

  const chronological = [...remainingEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let confidence = DEFAULT_CONFIDENCE
  let reps = 0
  let dueAt = chronological[0].createdAt
  let lastSeenAt = chronological[0].createdAt

  for (const event of chronological) {
    confidence = nextConfidence(confidence, toOutcome(event))
    const correct = !!event.correct
    reps = correct ? reps + 1 : 0
    lastSeenAt = event.createdAt
    dueAt = nextDueAt({ correct, confidence, reps, now: lastSeenAt })
  }

  const masteryEvents: MasteryEvent[] = remainingEvents.map((e) => ({
    correct: e.correct,
    score: e.score,
    createdAt: e.createdAt,
  }))

  return { confidence, mastery: masteryScore(masteryEvents), reps, dueAt, lastSeenAt }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/recompute.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/recompute.ts tests/memory/recompute.test.ts
git commit -m "feat: pure CardProgress recompute for memory-history deletion"
```

---

### Task 2: Read actions — paginated history + filter options

**Files:**
- Create: `src/actions/memory.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth`; `prisma` from `@/lib/db`; `ActionResult` from `@/types/action`.
- Produces: `StudyEventHistoryRow`, `getStudyEventHistory(filters): Promise<ActionResult<{ events: StudyEventHistoryRow[]; nextCursor: string | null }>>`, `listMemoryFilterOptions(setId?): Promise<ActionResult<{ sets: {id,title}[]; cards: {id,term}[] }>>` — both consumed by Task 4's page component. Task 3 adds more exports to this same file.

- [ ] **Step 1: Implement the read actions**

Create `src/actions/memory.ts`:

```ts
'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { ActionResult } from '@/types/action';

export interface StudyEventHistoryFilters {
  setId?: string;
  cardId?: string;
  source?: string;
  cursor?: string;
  limit?: number;
}

export interface StudyEventHistoryRow {
  id: string;
  cardId: string;
  term: string;
  setId: string;
  setTitle: string;
  source: string;
  correct: boolean | null;
  score: number | null;
  confidenceAfter: number;
  createdAt: string;
}

const DEFAULT_PAGE_SIZE = 50;

export async function getStudyEventHistory(
  filters: StudyEventHistoryFilters = {},
): Promise<ActionResult<{ events: StudyEventHistoryRow[]; nextCursor: string | null }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;

  try {
    const cardFilter = filters.cardId
      ? { cardId: filters.cardId }
      : filters.setId
        ? { card: { setId: filters.setId } }
        : {};

    const rows = await prisma.studyEvent.findMany({
      where: {
        userId,
        ...cardFilter,
        ...(filters.source ? { source: filters.source } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        cardId: true,
        source: true,
        correct: true,
        score: true,
        confidenceAfter: true,
        createdAt: true,
        card: { select: { term: true, setId: true, set: { select: { title: true } } } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const events: StudyEventHistoryRow[] = page.map((r) => ({
      id: r.id,
      cardId: r.cardId,
      term: r.card.term,
      setId: r.card.setId,
      setTitle: r.card.set.title,
      source: r.source,
      correct: r.correct,
      score: r.score,
      confidenceAfter: r.confidenceAfter,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      success: true,
      data: { events, nextCursor: hasMore ? page[page.length - 1].id : null },
    };
  } catch (error) {
    console.error('Get study event history error:', error);
    return { success: false, error: 'Failed to load history' };
  }
}

export async function listMemoryFilterOptions(
  setId?: string,
): Promise<ActionResult<{ sets: { id: string; title: string }[]; cards: { id: string; term: string }[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    const [sets, cards] = await Promise.all([
      prisma.set.findMany({
        where: { userId },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
      setId
        ? prisma.card.findMany({
            where: { setId, set: { userId } },
            select: { id: true, term: true },
            orderBy: { position: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    return { success: true, data: { sets, cards } };
  } catch (error) {
    console.error('List memory filter options error:', error);
    return { success: false, error: 'Failed to load filters' };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `src/actions/memory.ts`. (Full manual/DB verification happens in Task 6 once the UI in Task 4 can exercise this.)

- [ ] **Step 3: Commit**

```bash
git add src/actions/memory.ts
git commit -m "feat: paginated study-event history + filter-options actions"
```

---

### Task 3: Write actions — delete event, forget card, forget set

**Files:**
- Modify: `src/actions/memory.ts` (adds to the file from Task 2)

**Interfaces:**
- Consumes: `recomputeCardProgress`, `RecomputeEvent` from `@/lib/memory/recompute` (Task 1); `revalidatePath` from `next/cache`.
- Produces: `deleteStudyEvent(eventId): Promise<ActionResult<void>>`, `forgetCard(cardId): Promise<ActionResult<void>>`, `forgetSet(setId): Promise<ActionResult<void>>` — consumed by Task 4's page component.

- [ ] **Step 1: Implement the write actions**

Add to `src/actions/memory.ts` (below the Task 2 code), and add `import { revalidatePath } from 'next/cache';` and `import { recomputeCardProgress } from '@/lib/memory/recompute';` to the top imports:

```ts
export async function deleteStudyEvent(eventId: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      const event = await tx.studyEvent.findUnique({
        where: { id: eventId },
        select: { userId: true, cardId: true },
      });

      if (!event || event.userId !== userId) {
        throw new Error('Not found');
      }

      await tx.studyEvent.delete({ where: { id: eventId } });

      const remaining = await tx.studyEvent.findMany({
        where: { userId, cardId: event.cardId },
        select: { correct: true, score: true, createdAt: true },
      });

      const recomputed = recomputeCardProgress(remaining);

      if (recomputed === null) {
        await tx.cardProgress.deleteMany({ where: { userId, cardId: event.cardId } });
      } else {
        await tx.cardProgress.upsert({
          where: { userId_cardId: { userId, cardId: event.cardId } },
          update: {
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
          },
          create: {
            userId,
            cardId: event.cardId,
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
            starred: false,
          },
        });
      }
    });

    revalidatePath('/profile/memory');
    revalidatePath('/profile');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Delete study event error:', error);
    return { success: false, error: 'Failed to delete entry' };
  }
}

export async function forgetCard(cardId: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    await prisma.$transaction([
      prisma.confidenceEvent.deleteMany({ where: { userId, cardId } }),
      prisma.studyEvent.deleteMany({ where: { userId, cardId } }),
      prisma.cardProgress.deleteMany({ where: { userId, cardId } }),
    ]);

    revalidatePath('/profile/memory');
    revalidatePath('/profile');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Forget card error:', error);
    return { success: false, error: 'Failed to forget card' };
  }
}

export async function forgetSet(setId: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    await prisma.$transaction([
      prisma.confidenceEvent.deleteMany({ where: { userId, card: { setId } } }),
      prisma.studyEvent.deleteMany({ where: { userId, card: { setId } } }),
      prisma.cardProgress.deleteMany({ where: { userId, card: { setId } } }),
    ]);

    revalidatePath('/profile/memory');
    revalidatePath('/profile');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('Forget set error:', error);
    return { success: false, error: 'Failed to forget set' };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/actions/memory.ts
git commit -m "feat: delete-event, forget-card, forget-set memory actions"
```

---

### Task 4: `/profile/memory` history page

**Files:**
- Create: `src/app/profile/memory/page.tsx`

**Interfaces:**
- Consumes: `getStudyEventHistory`, `listMemoryFilterOptions`, `deleteStudyEvent`, `forgetCard`, `forgetSet` (Tasks 2-3, `@/actions/memory`); `resetUserMemory` (existing, `@/actions/user`); UI primitives `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` (`@/components/ui/card`), `Button` (`@/components/ui/button`), `Badge` (`@/components/ui/badge`); `toast` (`sonner`); `format` (`date-fns`).
- Produces: default-exported `MemoryHistoryPage` component, routed at `/profile/memory`.

- [ ] **Step 1: Build the page**

Create `src/app/profile/memory/page.tsx`:

```tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  getStudyEventHistory,
  listMemoryFilterOptions,
  deleteStudyEvent,
  forgetCard,
  forgetSet,
  type StudyEventHistoryRow,
} from '@/actions/memory';
import { resetUserMemory } from '@/actions/user';

const SOURCE_LABELS: Record<string, string> = {
  review: 'Review',
  'quiz-mc': 'Quiz (Multiple Choice)',
  'quiz-sa': 'Quiz (Short Answer)',
  'quiz-tf': 'Quiz (True/False)',
  matching: 'Matching Game',
  lesson: 'Lesson',
};

export default function MemoryHistoryPage() {
  const [setId, setSetId] = useState('');
  const [cardId, setCardId] = useState('');
  const [source, setSource] = useState('');

  const [events, setEvents] = useState<StudyEventHistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sets, setSets] = useState<{ id: string; title: string }[]>([]);
  const [cards, setCards] = useState<{ id: string; term: string }[]>([]);
  const [isResetting, setIsResetting] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    const result = await getStudyEventHistory({
      setId: setId || undefined,
      cardId: cardId || undefined,
      source: source || undefined,
    });
    if (result.success) {
      setEvents(result.data.events);
      setCursor(result.data.nextCursor);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }, [setId, cardId, source]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    listMemoryFilterOptions(setId || undefined).then((result) => {
      if (result.success) {
        setSets(result.data.sets);
        setCards(result.data.cards);
      }
    });
  }, [setId]);

  function handleSetChange(value: string) {
    setSetId(value);
    setCardId('');
  }

  async function handleLoadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const result = await getStudyEventHistory({
      setId: setId || undefined,
      cardId: cardId || undefined,
      source: source || undefined,
      cursor,
    });
    if (result.success) {
      setEvents((prev) => [...prev, ...result.data.events]);
      setCursor(result.data.nextCursor);
    } else {
      toast.error(result.error);
    }
    setLoadingMore(false);
  }

  async function handleDeleteEvent(eventId: string) {
    if (!confirm("Delete this entry? This will recompute this card's confidence and mastery from its remaining history.")) return;
    const result = await deleteStudyEvent(eventId);
    if (result.success) {
      toast.success('Entry deleted');
      loadFirstPage();
    } else {
      toast.error(result.error);
    }
  }

  async function handleForgetCard() {
    if (!cardId) return;
    const term = cards.find((c) => c.id === cardId)?.term ?? 'this card';
    if (!confirm(`Forget everything about "${term}"? This deletes all its history and resets it to unseen. This cannot be undone.`)) return;
    const result = await forgetCard(cardId);
    if (result.success) {
      toast.success('Card memory forgotten');
      setCardId('');
    } else {
      toast.error(result.error);
    }
  }

  async function handleForgetSet() {
    if (!setId) return;
    const title = sets.find((s) => s.id === setId)?.title ?? 'this set';
    if (!confirm(`Forget all memory for "${title}"? This deletes history for every card in this set. This cannot be undone.`)) return;
    const result = await forgetSet(setId);
    if (result.success) {
      toast.success('Set memory forgotten');
      setSetId('');
      setCardId('');
    } else {
      toast.error(result.error);
    }
  }

  async function handleFullReset() {
    if (!confirm('Are you sure you want to reset your entire learning memory? This will delete all quiz history, confidence scores, and progress. This action cannot be undone.')) return;
    setIsResetting(true);
    const result = await resetUserMemory();
    setIsResetting(false);
    if (result.success) {
      toast.success('Memory reset successfully');
      setSetId('');
      setCardId('');
      loadFirstPage();
    } else {
      toast.error(result.error || 'Failed to reset memory');
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div>
        <Link href="/profile" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to profile
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Memory History</h1>
        <p className="text-muted-foreground mt-2">Every review and quiz answer that shaped your confidence scores.</p>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Set</label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={setId}
              onChange={(e) => handleSetChange(e.target.value)}
            >
              <option value="">All sets</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Card</label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-50"
              value={cardId}
              disabled={!setId}
              onChange={(e) => setCardId(e.target.value)}
            >
              <option value="">All cards</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.term}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Source</label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All sources</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {cardId && (
            <Button variant="destructive" size="sm" onClick={handleForgetCard}>
              <Trash2 className="w-4 h-4 mr-1" /> Forget this card
            </Button>
          )}
          {setId && !cardId && (
            <Button variant="destructive" size="sm" onClick={handleForgetSet}>
              <Trash2 className="w-4 h-4 mr-1" /> Forget this set
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No history matches these filters.</p>
          ) : (
            <>
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{event.term}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {event.setTitle} &middot; {format(new Date(event.createdAt), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  <Badge variant="outline">{SOURCE_LABELS[event.source] ?? event.source}</Badge>
                  <span className="text-sm w-16 text-right">
                    {event.score !== null ? `${event.score}%` : event.correct ? 'Correct' : 'Wrong'}
                  </span>
                  <span className="text-sm w-20 text-right text-muted-foreground">conf {event.confidenceAfter}</span>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDeleteEvent(event.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {cursor && (
                <div className="pt-2 text-center">
                  <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Reset your learning memory to start fresh.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground max-w-md">
              This will permanently delete all your quiz history, confidence scores, and progress across all sets.
              This action cannot be undone.
            </p>
            <Button variant="destructive" onClick={handleFullReset} disabled={isResetting} className="whitespace-nowrap">
              {isResetting ? (
                'Resetting...'
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Reset Memory
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Export the row type from the actions file**

Confirm `StudyEventHistoryRow` (defined in Task 2) is exported (not just its containing function) — the page imports it as a type. It already is (`export interface StudyEventHistoryRow` in Task 2's code), so this step is just a check, not a change.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/memory/page.tsx
git commit -m "feat: add /profile/memory history view with filters and selective delete"
```

---

### Task 5: Link from `/profile`, remove the old Danger Zone

**Files:**
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this only removes the now-relocated reset UI and adds a link to `/profile/memory`.

- [ ] **Step 1: Remove the relocated reset logic and add the link**

In `src/app/profile/page.tsx`:

1. Remove `resetUserMemory` from the import on line 8 (keep `getUserStats`):
```ts
import { getUserStats } from '@/actions/user';
```

2. Remove `Trash2` from the lucide-react import on line 7 (no longer used on this page):
```ts
import { Trophy, History, Activity } from 'lucide-react';
```

3. Add `Link` from `next/link`, near the top with the other imports:
```ts
import Link from 'next/link';
```

4. Remove the `isResetting` state (line 15) and the entire `handleReset` function (lines 32-47).

5. Replace the header block (lines 66-76) to add a history link:
```tsx
<div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
  <div>
    <h1 className="text-4xl font-bold tracking-tight">Your Learning Memory</h1>
    <p className="text-muted-foreground mt-2">Track your progress and mastery across all sets.</p>
    <Link href="/profile/memory" className="text-sm text-primary hover:underline inline-block mt-2">
      View full memory history &rarr;
    </Link>
  </div>
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Activity className="w-4 h-4" />
    <span>Real-time Progress Tracking</span>
  </div>
</div>
```

6. Remove the entire Danger Zone `<Card className="border-destructive/50 bg-destructive/5">...</Card>` block (lines 175-206) — it now lives on `/profile/memory` (Task 4).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (confirms no leftover references to the removed `isResetting`/`handleReset`/`Trash2`/`resetUserMemory`).

- [ ] **Step 3: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "refactor: move full memory reset to /profile/memory, link to it from /profile"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the automated suite**

Run: `npm run test`
Expected: all suites pass, including the new `tests/memory/recompute.test.ts`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors (in particular, no unused-import warnings on `src/app/profile/page.tsx` from Task 5's removals).

- [ ] **Step 3: Manual browser walkthrough**

Run: `npm run dev`, then in the browser:

1. Log in, open a set, answer a couple of quiz questions (any of MC/SA/TF) and do one Review-mode card, so at least two different `source` values exist for at least two different cards.
2. Visit `/profile` — confirm the Danger Zone is gone and a "View full memory history →" link is present; click it.
3. On `/profile/memory`, confirm the events just generated appear in the feed with the right term, set title, source label, outcome, and confidence.
4. Select a Set in the filter — confirm the Card dropdown populates with that set's cards and the feed narrows.
5. Select a Card — confirm "Forget this card" appears and the feed narrows to just that card's events.
6. Click the trash icon on a single event row — confirm it disappears and, by re-opening the card's filtered view, that the remaining event(s) still show a sensible confidence (don't expect an exact number without recomputing by hand — just confirm it changed plausibly and no error toast appeared).
7. Click "Forget this card" — confirm all its events vanish from the feed and (via the set's flashcard carousel or `/profile` stats) that the card shows as unstarred/fresh.
8. Repeat with "Forget this set" on a set with a couple of studied cards — confirm all of that set's history disappears.
9. Click "Reset Memory" in the Danger Zone — confirm it still fully wipes everything, same as before this change.

- [ ] **Step 4: Fix any issues found, then commit if changes were needed**

If Step 3 surfaces a bug, fix it in the relevant task's file, re-run `npm run test` and `npm run lint`, and commit with a `fix:` message describing what broke.
