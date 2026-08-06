'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { TRAINING_PLAN_PROMPT } from '@/lib/ai/prompts/registry';
import { TrainingPlanSchema } from '@/lib/ai/schemas';
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
      const profile = await buildLearnerProfile({ userId, setIds: [setId] });
      profileBlock = profileToPromptBlock(profile);
    } catch (err) {
      console.error('buildLearnerProfile failed for training plan:', err);
    }

    // 2. Generate
    const prompt = TRAINING_PLAN_PROMPT.build({ profileBlock });
    const plan = await generateJson({
      userId,
      task: 'plan',
      prompt,
      schema: TrainingPlanSchema,
    });

    // 3. Persist
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
  } catch (err) {
    if (err instanceof AiGenerationError) {
      return { success: false, error: err.detail.title, detail: err.detail };
    }
    console.error('Training plan generation error:', err);
    return { success: false, error: 'Failed to generate training plan.' };
  }
}
