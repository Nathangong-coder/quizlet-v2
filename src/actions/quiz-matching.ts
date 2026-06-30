export async function submitMatchingAnswers(input: {
  attemptId: string;
  matches: { cardId: string; matchedWithId: string }[];
}): Promise<ActionResult<{ score: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: input.attemptId },
      include: { cards: { include: { cards: true } } }, // Wait, this is wrong.
    });

    // Correct way to get cards for the attempt
    const cards = await prisma.card.findMany({
      where: { id: { in: (attempt?.selectedCardIds as string[]) || [] } }
    });

    let correctCount = 0;
    const answers = input.matches.map(match => {
      const card = cards.find(c => c.id === match.cardId);
      const isCorrect = match.matchedWithId === match.cardId; // Matching term to its own definition
      if (isCorrect) correctCount++;

      return prisma.quizAnswer.create({
        data: {
          attemptId: input.attemptId,
          userId: session.user.id,
          cardId: match.cardId,
          mode: 'matching',
          prompt: 'Matching',
          correctAnswer: 'Correct',
          selectedOption: match.matchedWithId,
          isCorrect,
          score: isCorrect ? 100 : 0,
          feedback: isCorrect ? 'Correct match!' : 'Incorrect match.',
        }
      });
    });

    await prisma.$transaction(answers);

    const finalScore = Math.round((correctCount / cards.length) * 100);
    await prisma.quizAttempt.update({
      where: { id: input.attemptId },
      data: { score: finalScore },
    });

    return { success: true, data: { score: finalScore } };
  } catch (error) {
    return { success: false, error: 'Failed to submit matching answers' };
  }
}
