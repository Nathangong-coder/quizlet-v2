'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { recordStudyEvent } from '@/lib/memory/record';
import type { ActionResult } from '@/types/action';

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
    // The id comes from the client, so the lookup must be scoped by userId
    // (and kind) — matches the standard set in src/actions/study-session.ts.
    const studySession = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId, kind: 'matching' },
    });
    if (!studySession) return { success: false, error: 'Session not found' };

    // Idempotent: a re-submit (double click, retry, remount) must not
    // double-count against confidence. Same guard as submitMatchingAnswers.
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
