'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { masteryBucket } from '@/lib/memory/scoring';
import { executeErasure } from '@/lib/memory/erase-execute';
import { ANSWERED_ATTEMPT_WHERE } from '@/lib/quiz/history';

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
    /** The activity permalink is keyed on the session, not the attempt.
     *  Null for pre-Stage-6 attempts, which have no session envelope. */
    sessionId: string | null;
  }[];
}

export async function getUserStats(): Promise<ActionResult<UserStats>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const userId = session.user.id;

  try {
    const [attempts, progress] = await Promise.all([
      prisma.quizAttempt.findMany({
        // One query feeds all four outputs below — totalAttempts, modeStats,
        // overallAverageScore, recentAttempts — so this single predicate fixes
        // all four at once. A filter that cleaned up the recent list but left
        // the count inflated is the obvious half-fix, and it would be invisible
        // on a page that shows both.
        where: { userId, ...ANSWERED_ATTEMPT_WHERE },
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
          sessionId: a.sessionId,
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
