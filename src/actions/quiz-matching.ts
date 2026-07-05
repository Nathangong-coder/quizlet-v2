'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function submitMatchingAnswers(input: {
  attemptId: string;
  matches: { cardId: string; matchedWithId: string }[];
}): Promise<ActionResult<{ score: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: input.attemptId },
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
    const answers = input.matches.map(match => {
      const card = cards.find(c => c.id === match.cardId);
      const matchedCard = cards.find(c => c.id === match.matchedWithId);
      const isCorrect = match.matchedWithId === match.cardId;
      if (isCorrect) correctCount++;

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
          feedback: isCorrect ? 'Correct match!' : 'Incorrect match.',
        }
      });
    });

    await prisma.$transaction(answers);

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
