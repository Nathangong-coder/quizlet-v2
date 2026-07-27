'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { recomputeCardProgress } from '@/lib/memory/recompute';
import {
  buildStudyEventWhere,
  groupCategoriesByName,
  EMPTY_SCOPE,
  type CrossSetCategory,
  type HistoryScope,
} from '@/lib/memory/scope';
import { UNCATEGORIZED_ID } from '@/lib/cards/categories';
import { ActionResult } from '@/types/action';

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
  confidenceAfter: number;
  createdAt: string;
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

    // CardProgress carries no `source`, so mastery is measured over the same
    // cards the scope selects, ignoring which mode produced the events.
    const progressWhere: Record<string, unknown> = { userId };
    if (where.cardId) progressWhere.cardId = where.cardId;
    if (where.card) progressWhere.card = where.card;

    const [totals, correctness, scored, bySource, distinctCards, masteredCards] =
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
          where,
          _count: { _all: true },
        }),
        prisma.studyEvent.findMany({
          where,
          select: { cardId: true },
          distinct: ['cardId'],
        }),
        prisma.cardProgress.count({
          where: { ...progressWhere, confidence: { gte: 8 } },
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
        masteredCards,
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
