'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJsonWithGoogle } from '@/lib/ai/google';
import { buildMultipleChoicePrompt, buildShortAnswerGradePrompt, buildMultipleChoiceGradePrompt } from '@/lib/ai/prompts';
import { MultipleChoiceOptionsSchema, MultipleChoiceOptions, ShortAnswerGradeSchema, MultipleChoiceFeedbackSchema } from '@/lib/ai/schemas';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model-routing';
import { overallQuizScore } from '@/lib/quiz/scoring';
import { revalidatePath } from 'next/cache';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function getOrGenerateMultipleChoiceOptions(
  cardId: string
): Promise<ActionResult<{ cardId: string; options: string[]; correctAnswer: string; cacheHit: boolean; model: string }>> {
  if (!cardId) return { success: false, error: 'Card ID is required' };
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // 1. Check cache
    const cached = await prisma.quizOptionCache.findUnique({
      where: { cardId_model: { cardId, model: DEFAULT_AI_MODEL } },
    });

    if (cached) {
      const options = MultipleChoiceOptionsSchema.parse(cached.options);
      return {
        success: true,
        data: {
          cardId,
          options: options.options,
          correctAnswer: options.correctAnswer,
          cacheHit: true,
          model: DEFAULT_AI_MODEL,
        },
      };
    }

    // 2. Fetch data for generation
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return { success: false, error: 'Card not found' };

    const set = await prisma.set.findUnique({
      where: { id: card.setId },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };

    // 3. Get API key
    const credential = await prisma.aiCredential.findUnique({
      where: { userId: session.user.id },
    });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    // 4. Generate
    const prompt = buildMultipleChoicePrompt(card, set.cards);
    const options = await generateJsonWithGoogle({
      apiKey,
      prompt,
      schema: MultipleChoiceOptionsSchema,
      model: DEFAULT_AI_MODEL,
    });

    // 5. Cache
    await prisma.quizOptionCache.create({
      data: {
        cardId,
        model: DEFAULT_AI_MODEL,
        options: options as any,
      },
    });

    return {
      success: true,
      data: {
        cardId,
        options: options.options,
        correctAnswer: options.correctAnswer,
        cacheHit: false,
        model: DEFAULT_AI_MODEL,
      },
    };
  } catch (error: any) {
    console.error('Quiz generation error:', error);
    return { success: false, error: 'Failed to generate quiz options.' };
  }
}

export async function startQuizAttempt(
  setId: string,
  mode: 'multiple-choice' | 'short-answer',
  questionCount?: number,
  timerSeconds?: number
): Promise<ActionResult<{ attemptId: string; cardIds: string[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const set = await prisma.set.findUnique({
      where: { id: setId },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };

    const progress = await prisma.cardProgress.findMany({
      where: { userId: session.user.id, card: { setId } },
    });
    const progressMap = new Map(progress.map(p => [p.cardId, p]));

    // 1. Calculate weights
    const weightedCards = set.cards.map(card => {
      const p = progressMap.get(card.id);
      let weight = 1.0;
      if (p?.starred) weight += 2.0; // High priority for starred (approx 2/3 weight)
      if (p && p.confidence <= 5) weight += 1.0; // Extra weight for low confidence
      return { id: card.id, weight };
    });

    // 2. Weighted Random Sampling
    const selectedIds: string[] = [];
    const pool = [...weightedCards];
    const targetCount = Math.min(questionCount || set.cards.length, set.cards.length);

    while (selectedIds.length < targetCount && pool.length > 0) {
      const totalWeight = pool.reduce((sum, c) => sum + c.weight, 0);
      let r = Math.random() * totalWeight;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].weight;
        if (r <= 0) {
          selectedIds.push(pool[i].id);
          pool.splice(i, 1);
          break;
        }
      }
    }

    const attempt = await prisma.quizAttempt.create({
      data: {
        userId: session.user.id,
        setId,
        mode,
        selectedCardIds: selectedIds,
      },
    });
    return { success: true, data: { attemptId: attempt.id, cardIds: selectedIds } };
  } catch (error) {
    return { success: false, error: 'Failed to start quiz' };
  }
}

export async function submitMultipleChoiceAnswer(input: {
  attemptId: string;
  cardId: string;
  selectedOption: string;
  correctAnswer: string;
}): Promise<ActionResult<{ isCorrect: boolean; score: number; feedback?: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const isCorrect = input.selectedOption.trim().toLowerCase() === input.correctAnswer.trim().toLowerCase();
  const score = isCorrect ? 100 : 0;

  try {
    // AI Feedback
    let feedback = isCorrect ? 'Correct!' : 'Incorrect.';
    const card = await prisma.card.findUnique({ where: { id: input.cardId } });
    if (card) {
      const credential = await prisma.aiCredential.findUnique({ where: { userId: session.user.id } });
      if (credential) {
        const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
        const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);
        const prompt = buildMultipleChoiceGradePrompt(card, input.selectedOption, input.correctAnswer);
        const aiResult = await generateJsonWithGoogle({
          apiKey,
          prompt,
          schema: MultipleChoiceFeedbackSchema,
          model: DEFAULT_AI_MODEL,
        });
        feedback = aiResult.feedback;
      }
    }

    const answer = await prisma.quizAnswer.create({
      data: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'multiple-choice',
        prompt: 'Multiple choice',
        correctAnswer: input.correctAnswer,
        selectedOption: input.selectedOption,
        isCorrect,
        score,
        feedback,
      },
    });

    // Update attempt score
    const allAnswers = await prisma.quizAnswer.findMany({ where: { attemptId: input.attemptId } });
    const newScore = overallQuizScore(allAnswers);
    if (newScore !== null) {
      await prisma.quizAttempt.update({
        where: { id: input.attemptId },
        data: { score: Math.round(newScore) },
      });
    }

    return { success: true, data: { isCorrect, score, feedback } };
  } catch (error) {
    return { success: false, error: 'Failed to submit answer' };
  }
}

export async function submitShortAnswer(input: {
  attemptId: string;
  cardId: string;
  answer: string;
}): Promise<ActionResult<{ grade: any; score: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const card = await prisma.card.findUnique({ where: { id: input.cardId } });
    if (!card) return { success: false, error: 'Card not found' };

    // Get API key
    const credential = await prisma.aiCredential.findUnique({
      where: { userId: session.user.id },
    });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    // Grade
    const prompt = buildShortAnswerGradePrompt(card, input.answer);
    const grade = await generateJsonWithGoogle({
      apiKey,
      prompt,
      schema: ShortAnswerGradeSchema,
      model: DEFAULT_AI_MODEL,
    });

    const score = grade.overall * 10;

    const answer = await prisma.quizAnswer.create({
      data: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'short-answer',
        prompt: input.answer,
        answer: input.answer,
        correctAnswer: card.definition,
        grade: grade as any,
        score,
        feedback: grade.feedback,
      },
    });

    // Update attempt score
    const allAnswers = await prisma.quizAnswer.findMany({ where: { attemptId: input.attemptId } });
    const newScore = overallQuizScore(allAnswers);
    if (newScore !== null) {
      await prisma.quizAttempt.update({
        where: { id: input.attemptId },
        data: { score: Math.round(newScore) },
      });
    }

    return { success: true, data: { grade, score } };
  } catch (error: any) {
    console.error('Grading error:', error);
    return { success: false, error: 'Failed to grade answer' };
  }
}

export async function getQuizAttemptCards(attemptId: string): Promise<ActionResult<{ cards: any[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || !attempt.selectedCardIds) return { success: false, error: 'Attempt not found' };

    const cardIds = attempt.selectedCardIds as string[];
    const cards = await prisma.card.findMany({
      where: { id: { in: cardIds } },
    });

    const sortedCards = cardIds.map(id => cards.find(c => c.id === id)).filter(Boolean);

    return { success: true, data: { cards: sortedCards } };
  } catch (error) {
    return { success: false, error: 'Failed to fetch quiz cards' };
  }
}
