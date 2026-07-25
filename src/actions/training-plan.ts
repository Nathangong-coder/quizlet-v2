'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJsonWithGoogle } from '@/lib/ai/google';
import { TRAINING_PLAN_PROMPT } from '@/lib/ai/prompts/registry';
import { TrainingPlanSchema } from '@/lib/ai/schemas';
import { modelFor } from '@/lib/ai/model-routing';
import { buildLearnerProfile } from '@/lib/memory/profile';
import { profileToPromptBlock } from '@/lib/ai/context';
import { ActionResult } from '@/types/action';

export async function generateTrainingPlan(setId: string): Promise<ActionResult<{ plan: any }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const userId = session.user.id;

    // 1. Build learner-memory context. Replaces the pre-Task-5 raw queries
    // (weakCards/starredCards/confidenceEvents/quizAnswers) — see
    // src/lib/ai/prompts/training-plan.ts for why. Isolated in try/catch so
    // a profile-build failure degrades to no context rather than failing
    // plan generation outright (same pattern as recordStudyEvent).
    let profileBlock: string | undefined;
    try {
      const profile = await buildLearnerProfile({ userId, setId });
      profileBlock = profileToPromptBlock(profile);
    } catch (err) {
      console.error('buildLearnerProfile failed for training plan:', err);
    }

    // 2. Get API key
    const credential = await prisma.aiCredential.findUnique({ where: { userId } });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    // 3. Generate
    const prompt = TRAINING_PLAN_PROMPT.build({ profileBlock });
    const plan = await generateJsonWithGoogle({
      apiKey,
      prompt,
      schema: TrainingPlanSchema,
      model: modelFor('plan'),
    });

    // 4. Persist
    const savedPlan = await prisma.trainingPlan.create({
      data: {
        userId,
        sourceSetId: setId,
        title: plan.title,
        summary: plan.summary,
        focusAreas: plan.focusAreas as any,
        recommendedCardIds: plan.recommendedCardIds as any,
        generatedQuestions: plan.generatedQuestions as any,
        promptVersion: TRAINING_PLAN_PROMPT.version,
      },
    });

    return { success: true, data: { plan: savedPlan } };
  } catch (error: any) {
    console.error('Training plan generation error:', error);
    return { success: false, error: 'Failed to generate training plan.' };
  }
}
