'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function getUserStats(): Promise<ActionResult<any>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const userId = session.user.id;

  try {
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const progress = await prisma.cardProgress.findMany({
      where: { userId },
    });

    const modeStats = attempts.reduce((acc, attempt) => {
      const mode = attempt.mode;
      if (!acc[mode]) {
        acc[mode] = { count: 0, totalScore: 0 };
      }
      acc[mode].count++;
      acc[mode].totalScore += attempt.score || 0;
      return acc;
    }, {} as Record<string, { count: number; totalScore: number }>);

    const masteredCards = progress.filter(p => p.confidence >= 8).length;

    return {
      success: true,
      data: {
        totalAttempts: attempts.length,
        masteredCards,
        modeStats: Object.entries(modeStats).map(([mode, stats]) => ({
          mode,
          count: stats.count,
          averageScore: Math.round(stats.totalScore / stats.count),
        })),
        recentAttempts: attempts.slice(0, 5).map(a => ({
          id: a.id,
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
