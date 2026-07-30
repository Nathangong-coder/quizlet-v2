'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { masteryBucket } from '@/lib/memory/scoring';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export interface UserStats {
  totalAttempts: number;
  masteredCards: number;
  /** Mean score across every scored attempt. Null when nothing is scored yet. */
  overallAverageScore: number | null;
  modeStats: { mode: string; count: number; averageScore: number | null }[];
  recentAttempts: {
    id: string;
    setId: string;
    setTitle: string;
    mode: string;
    score: number | null;
    date: Date;
  }[];
}

export async function getUserStats(): Promise<ActionResult<UserStats>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const userId = session.user.id;

  try {
    const [attempts, progress] = await Promise.all([
      prisma.quizAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { set: { select: { id: true, title: true } } },
      }),
      prisma.cardProgress.findMany({ where: { userId } }),
    ]);

    // An attempt with a null score was never graded — counting it as 0 would
    // drag the average down, so scored and unscored attempts are tallied apart.
    const modeStats = attempts.reduce((acc, attempt) => {
      const bucket = (acc[attempt.mode] ??= { count: 0, scored: 0, totalScore: 0 });
      bucket.count++;
      if (attempt.score !== null) {
        bucket.scored++;
        bucket.totalScore += attempt.score;
      }
      return acc;
    }, {} as Record<string, { count: number; scored: number; totalScore: number }>);

    const scoredAttempts = attempts.filter((a) => a.score !== null);
    const scoredTotal = scoredAttempts.reduce((sum, a) => sum + (a.score ?? 0), 0);

    return {
      success: true,
      data: {
        totalAttempts: attempts.length,
        masteredCards: progress.filter((p) => masteryBucket(p) === 'mastered').length,
        // Averaged over attempts, not over per-mode averages: a mean of means
        // lets a single attempt in one mode outweigh fifty in another.
        overallAverageScore:
          scoredAttempts.length > 0 ? Math.round(scoredTotal / scoredAttempts.length) : null,
        modeStats: Object.entries(modeStats).map(([mode, stats]) => ({
          mode,
          count: stats.count,
          averageScore: stats.scored > 0 ? Math.round(stats.totalScore / stats.scored) : null,
        })),
        recentAttempts: attempts.slice(0, 5).map((a) => ({
          id: a.id,
          setId: a.set.id,
          setTitle: a.set.title,
          mode: a.mode,
          score: a.score,
          date: a.createdAt,
        })),
      },
    };
  } catch (error) {
    console.error('Stats error:', error);
    return { success: false, error: 'Failed to fetch stats' };
  }
}

export async function resetUserMemory(): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const userId = session.user.id;

  try {
    await prisma.$transaction([
      prisma.quizAttempt.deleteMany({ where: { userId } }),
      prisma.quizAnswer.deleteMany({ where: { userId } }),
      prisma.confidenceEvent.deleteMany({ where: { userId } }),
      prisma.cardProgress.deleteMany({ where: { userId } }),
      prisma.studyEvent.deleteMany({ where: { userId } }),
    ]);

    revalidatePath('/profile');
    return { success: true };
  } catch (error) {
    console.error('Reset error:', error);
    return { success: false, error: 'Failed to reset memory' };
  }
}
