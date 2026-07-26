'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { recomputeCardProgress } from '@/lib/memory/recompute';
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
