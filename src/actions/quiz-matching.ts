'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { recordStudyEvent } from '@/lib/memory/record';
import { normalizeLatency } from '@/lib/memory/latency';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function submitMatchingAnswers(input: {
  attemptId: string;
  matches: { cardId: string; matchedWithId: string; latencyMs?: number }[];
}): Promise<ActionResult<{ score: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // The id comes from the client, so the lookup must be scoped by userId —
    // otherwise a caller could submit against another user's attempt and,
    // since sessionId is read off it below, contaminate that user's session.
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: input.attemptId, userId: session.user.id },
    });

    if (!attempt) return { success: false, error: 'Attempt not found' };

    const cards = await prisma.card.findMany({
      where: { id: { in: (attempt.selectedCardIds as string[]) || [] } }
    });

    // Idempotent: clear any prior matching answers for this attempt so a
    // re-submit replaces rather than duplicates them.
    await prisma.quizAnswer.deleteMany({
      where: { attemptId: input.attemptId, mode: 'matching' },
    });

    let correctCount = 0;
    const matchOutcomes: { cardId: string; isCorrect: boolean }[] = [];
    const answers = input.matches.map(match => {
      const card = cards.find(c => c.id === match.cardId);
      const matchedCard = cards.find(c => c.id === match.matchedWithId);
      const isCorrect = match.matchedWithId === match.cardId;
      if (isCorrect) correctCount++;
      matchOutcomes.push({ cardId: match.cardId, isCorrect });

      return prisma.quizAnswer.create({
        data: {
          attemptId: input.attemptId,
          userId: session.user.id,
          cardId: match.cardId,
          mode: 'matching',
          prompt: card?.term || 'Matching',
          correctAnswer: card?.definition || '',
          selectedOption: matchedCard?.definition || 'No match',
          isCorrect,
          score: isCorrect ? 100 : 0,
          latencyMs: normalizeLatency(match.latencyMs),
          feedback: isCorrect ? 'Correct match!' : 'Incorrect match.',
        }
      });
    });

    await prisma.$transaction(answers);

    if (attempt.sessionId) {
      // Atomic for the same reasons as submitMatchSession: a bare count()-then-
      // insert lets two concurrent re-submits both observe zero and double-write
      // confidence, and a mid-loop failure would otherwise leave a nonzero count
      // that permanently blocks the retry. Scoped to source 'matching' because
      // this session legitimately carries MC/SA/TF events too.
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "StudySession" WHERE id = ${attempt.sessionId} FOR UPDATE`;

          const alreadyRecorded = await tx.studyEvent.count({
            where: { userId: session.user.id, sessionId: attempt.sessionId, source: 'matching' },
          });
          if (alreadyRecorded > 0) return;

          for (const outcome of matchOutcomes) {
            const latencyMs = input.matches.find((match) => match.cardId === outcome.cardId)?.latencyMs;
            await recordStudyEvent({
              userId: session.user.id,
              cardId: outcome.cardId,
              source: 'matching',
              outcome: { correct: outcome.isCorrect },
              sessionId: attempt.sessionId ?? undefined,
              ...(latencyMs === undefined ? {} : { meta: { latencyMs } }),
            }, tx);
          }
        });
      } catch (memErr) {
        // Memory writes are supplementary — the user still gets their score.
        // Rolled back as a unit, so a retry starts clean rather than half-written.
        console.error('Matching memory write failed, rolled back:', memErr);
      }
    } else {
      // Legacy attempts created before the StudySession envelope existed have
      // no sessionId to lock or scope a guard on. Record as this action always
      // did before this task — unguarded, per-card — rather than silently
      // dropping these writes.
      for (const outcome of matchOutcomes) {
        const latencyMs = input.matches.find((match) => match.cardId === outcome.cardId)?.latencyMs;
        try {
          await recordStudyEvent({
            userId: session.user.id,
            cardId: outcome.cardId,
            source: 'matching',
            outcome: { correct: outcome.isCorrect },
            ...(latencyMs === undefined ? {} : { meta: { latencyMs } }),
          });
        } catch (memErr) {
          console.error('recordStudyEvent failed for matching (legacy, no session):', memErr);
        }
      }
    }

    // Score over the matches actually presented in this section (matching may
    // get only a subset of the attempt's cards), not the whole card pool.
    const denom = input.matches.length || cards.length || 1;
    const finalScore = Math.round((correctCount / denom) * 100);
    await prisma.quizAttempt.update({
      where: { id: input.attemptId },
      data: { score: finalScore },
    });

    return { success: true, data: { score: finalScore } };
  } catch (error) {
    return { success: false, error: 'Failed to submit matching answers' };
  }
}
