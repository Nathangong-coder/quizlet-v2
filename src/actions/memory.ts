'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { executeErasure } from '@/lib/memory/erase-execute';
import type { ErasureScope } from '@/lib/memory/erase';
import {
  buildStudyEventWhere,
  groupCategoriesByName,
  EMPTY_SCOPE,
  type CrossSetCategory,
  type HistoryScope,
} from '@/lib/memory/scope';
import { UNCATEGORIZED_ID } from '@/lib/cards/categories';
import { ActionResult } from '@/types/action';
import { masteryBucket } from '@/lib/memory/scoring';

export interface StudyEventHistoryFilters extends HistoryScope {
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
  latencyMs: number | null;
  confidenceAfter: number;
  createdAt: string;
  /**
   * The activity this answer belongs to, for the `/profile/activity/<id>`
   * permalink the feed rows link to.
   *
   * NULLABLE, and rows really do come back null: `StudyEvent.sessionId` is
   * `SetNull`, and events written before `StudySession` existed never had one.
   * Such a row is still perfectly good history — it just has no activity to
   * open, so the caller must render it as unlinked rather than as a link to
   * `/profile/activity/null`.
   */
  sessionId: string | null;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Resolve a scope's cross-set category keys (normalized names) to the concrete
 * per-set CardCategory ids they cover, restricted to sets this user owns.
 */
async function resolveCategoryIds(userId: string, categoryKeys: string[]): Promise<string[]> {
  const named = categoryKeys.filter((key) => key !== UNCATEGORIZED_ID);
  if (named.length === 0) return [];

  const rows = await prisma.cardCategory.findMany({
    where: { set: { userId }, normalizedName: { in: named } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function getStudyEventHistory(
  filters: StudyEventHistoryFilters = EMPTY_SCOPE,
): Promise<ActionResult<{ events: StudyEventHistoryRow[]; nextCursor: string | null }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;

  try {
    const categoryIds = await resolveCategoryIds(userId, filters.categoryKeys);

    const rows = await prisma.studyEvent.findMany({
      where: buildStudyEventWhere(userId, filters, categoryIds),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        cardId: true,
        source: true,
        correct: true,
        score: true,
        latencyMs: true,
        confidenceAfter: true,
        createdAt: true,
        sessionId: true,
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
      latencyMs: r.latencyMs,
      confidenceAfter: r.confidenceAfter,
      createdAt: r.createdAt.toISOString(),
      sessionId: r.sessionId,
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

export interface MemoryFilterOptions {
  sets: { id: string; title: string }[];
  categories: CrossSetCategory[];
  cards: { id: string; term: string }[];
}

/**
 * Options for the scope bar. Sets and categories are always listed across the
 * whole account so the chip list stays stable as you narrow — only the card
 * list depends on the scope, and only when exactly one set is selected (a card
 * dropdown spanning every set would be unusable).
 */
export async function listMemoryFilterOptions(
  setIds: string[] = [],
): Promise<ActionResult<MemoryFilterOptions>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;
  const soleSetId = setIds.length === 1 ? setIds[0] : undefined;

  try {
    const [sets, categoryRows, cards] = await Promise.all([
      prisma.set.findMany({
        where: { userId },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
      prisma.cardCategory.findMany({
        where: { set: { userId } },
        select: {
          id: true,
          setId: true,
          name: true,
          normalizedName: true,
          color: true,
          _count: { select: { assignments: true } },
        },
      }),
      soleSetId
        ? prisma.card.findMany({
            where: { setId: soleSetId, set: { userId } },
            select: { id: true, term: true },
            orderBy: { position: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const categories = groupCategoriesByName(
      categoryRows.map((row) => ({
        id: row.id,
        setId: row.setId,
        name: row.name,
        normalizedName: row.normalizedName,
        color: row.color,
        cardCount: row._count.assignments,
      })),
    );

    return { success: true, data: { sets, categories, cards } };
  } catch (error) {
    console.error('List memory filter options error:', error);
    return { success: false, error: 'Failed to load filters' };
  }
}

export interface ScopedMemoryStats {
  totalEvents: number;
  /** Share of pass/fail-graded events answered correctly, 0-100. Null if none. */
  accuracy: number | null;
  /** Mean of scored events (short answer), 0-100. Null if none. */
  averageScore: number | null;
  /** Mean confidence after each event, 1-10. Null if no events. */
  averageConfidence: number | null;
  cardsSeen: number;
  masteredCards: number;
  /**
   * Events per source, counted with the scope's OWN source filter removed.
   *
   * This is the option-count list for the activity picker, so it has to answer
   * "how many of each type are there to pick?" — not "how many of each type did
   * my current pick leave?". Counted under the full scope, selecting Multiple
   * Choice would drive every other option to 0, which reads as those activities
   * having been deleted rather than merely not selected. Set, category and card
   * scope DO still apply: narrowing to one set should change what the picker
   * says is available in it.
   */
  bySource: { source: string; count: number }[];
}

export async function getScopedMemoryStats(
  scope: HistoryScope = EMPTY_SCOPE,
): Promise<ActionResult<ScopedMemoryStats>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    const categoryIds = await resolveCategoryIds(userId, scope.categoryKeys);
    const where = buildStudyEventWhere(userId, scope, categoryIds);
    // See `bySource` on ScopedMemoryStats: the picker's own dimension is
    // dropped so its option counts describe what is available to pick.
    const whereAnySource = buildStudyEventWhere(
      userId,
      { ...scope, sources: [] },
      categoryIds,
    );

    // CardProgress carries no `source`, so mastery cannot be filtered by the
    // scope's `where` directly — copying only its card predicates would leave
    // a source-only scope (e.g. "Matching Game") counting mastery across the
    // whole account while every other tile was scoped. Instead the card set is
    // derived from the scoped events themselves, which honours EVERY scope
    // dimension: mastery is measured over exactly the cards the scope selects,
    // ignoring only which mode produced each event.
    const distinctCards = await prisma.studyEvent.findMany({
      where,
      select: { cardId: true },
      distinct: ['cardId'],
    });
    const scopedCardIds = distinctCards.map((row) => row.cardId);

    const [totals, correctness, scored, bySource, masteryRows] =
      await Promise.all([
        prisma.studyEvent.aggregate({
          where,
          _count: { _all: true },
          _avg: { confidenceAfter: true },
        }),
        prisma.studyEvent.groupBy({
          by: ['correct'],
          where: { ...where, correct: { not: null } },
          _count: { _all: true },
        }),
        prisma.studyEvent.aggregate({
          where: { ...where, score: { not: null } },
          _avg: { score: true },
        }),
        prisma.studyEvent.groupBy({
          by: ['source'],
          where: whereAnySource,
          _count: { _all: true },
        }),
        // Bucketed in JS rather than counted in SQL: `masteryBucket` reads both
        // confidence AND mastery (with null-mastery fall-through), which a
        // single `count` predicate cannot express. Bounded by scopedCardIds.
        scopedCardIds.length === 0
          ? Promise.resolve([])
          : prisma.cardProgress.findMany({
              where: { userId, cardId: { in: scopedCardIds } },
              select: { confidence: true, mastery: true },
            }),
      ]);

    const gradedTotal = correctness.reduce((sum, row) => sum + row._count._all, 0);
    const correctTotal =
      correctness.find((row) => row.correct === true)?._count._all ?? 0;

    return {
      success: true,
      data: {
        totalEvents: totals._count._all,
        accuracy: gradedTotal > 0 ? Math.round((correctTotal / gradedTotal) * 100) : null,
        averageScore: scored._avg.score !== null ? Math.round(scored._avg.score) : null,
        averageConfidence:
          totals._avg.confidenceAfter !== null
            ? Math.round(totals._avg.confidenceAfter * 10) / 10
            : null,
        cardsSeen: distinctCards.length,
        masteredCards: masteryRows.filter((p) => masteryBucket(p) === 'mastered').length,
        bySource: bySource
          .map((row) => ({ source: row.source, count: row._count._all }))
          .sort((a, b) => b.count - a.count),
      },
    };
  } catch (error) {
    console.error('Get scoped memory stats error:', error);
    return { success: false, error: 'Failed to load stats' };
  }
}

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
