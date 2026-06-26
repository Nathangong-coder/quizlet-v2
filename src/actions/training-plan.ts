'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJsonWithGoogle } from '@/lib/ai/google';
import { buildTrainingPlanPrompt, TrainingPlanContext } from '@/lib/ai/prompts';
import { TrainingPlanSchema } from '@/lib/ai/schemas';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model-routing';
import { ActionResult } from '@/types/action';

export async function generateTrainingPlan(setId: string): Promise<ActionResult<{ plan: any }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const userId = session.user.id;

    // 1. Fetch data for generation
    const [weakCards, starredCards, confidenceEvents, quizAnswers] = await Promise.all([
      prisma.cardProgress.findMany({
        where: { userId, card: { setId }, confidence: { lte: 5 } },
        include: { card: true },
      }),
      prisma.cardProgress.findMany({
        where: { userId, card: { setId }, starred: true },
        include: { card: true },
      }),
      prisma.confidenceEvent.findMany({
        where: { userId, card: { setId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.quizAnswer.findMany({
        where: { userId, card: { setId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { card: true },
      }),
    ]);

    // 2. Format context
    const context: TrainingPlanContext = {
      weakCards: weakCards.map(w => w.card),
      starredCards: starredCards.map(s => s.card),
      confidenceEventsSummary: confidenceEvents.map(e => `Card ${e.cardId}: ${e.confidence} (${e.knew ? 'knew' : 'didn\'t know'})`).join('; '),
      recentQuizAnswers: quizAnswers.map(a => ({
        term: a.card.term,
        isCorrect: a.isCorrect,
        score: a.score,
        grade: a.grade,
      })),
    };

    // 3. Get API key
    const credential = await prisma.aiCredential.findUnique({ where: { userId } });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    // 4. Generate
    const prompt = buildTrainingPlanPrompt(context);
    const plan = await generateJsonWithGoogle({
      apiKey,
      prompt,
      schema: TrainingPlanSchema,
      model: DEFAULT_AI_MODEL,
    });

    // 5. Persist
    const savedPlan = await prisma.trainingPlan.create({
      data: {
        userId,
        sourceSetId: setId,
        title: plan.title,
        summary: plan.summary,
        focusAreas: plan.focusAreas as any,
        recommendedCardIds: plan.recommendedCardIds as any,
        generatedQuestions: plan.generatedQuestions as any,
      },
    });

    return { success: true, data: { plan: savedPlan } };
  } catch (error: any) {
    console.error('Training plan generation error:', error);
    return { success: false, error: 'Failed to generate training plan.' };
  }
}
