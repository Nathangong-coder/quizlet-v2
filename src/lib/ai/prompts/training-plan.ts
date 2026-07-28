import { TrainingPlanSchema } from '@/lib/ai/schemas';
import { learnerContextBlock } from './shared';

/**
 * Input for the training-plan prompt.
 *
 * Pre-Task-5, `TrainingPlanContext` carried raw `weakCards`/`starredCards`
 * (Card[]) plus a `confidenceEventsSummary` string built directly from
 * `prisma.confidenceEvent.findMany`. That summary went stale as of Stage 6
 * Task 2 — `recordReview` stopped writing `ConfidenceEvent` rows in favor of
 * the unified `StudyEvent` table, so `training-plan.ts` was silently reading
 * an append-only-but-no-longer-appended-to table.
 *
 * This task replaces all of that with a single `profileBlock`: the rendered
 * `LearnerProfile` (src/lib/memory/profile.ts + lib/ai/context.ts), built
 * fresh from `CardProgress`/`StudyEvent` on every call. It already carries
 * weak/fading/strong/starred terms and recent per-mode accuracy in
 * ID-free, capped form — a strict superset of what the old raw
 * weakCards/starredCards/recentQuizAnswers fields conveyed to the model, so
 * they were dropped rather than kept alongside (see task-5-report.md for
 * the full "what was kept/dropped" writeup).
 */
export interface TrainingPlanContext {
  profileBlock?: string;
}

/**
 * Personalized training-plan generation prompt. Registry entry per Stage 6
 * Task 5 — routed via task 'plan' in generateJson (strongest available flash).
 */
export const TRAINING_PLAN_PROMPT = {
  id: 'training-plan',
  version: 1,
  schema: TrainingPlanSchema,

  build(input: TrainingPlanContext): string {
    return `${learnerContextBlock(input.profileBlock)}You are an AI study coach. Create a personalized training plan based on the user's performance.

Requirements:
1. Identify key focus areas with priority (low, medium, high).
2. Recommend specific cards for review.
3. Generate 3-5 new challenging short-answer questions targeting their weaknesses.
4. Output as JSON.

JSON Schema:
{
  "title": string,
  "summary": string,
  "focusAreas": [
    { "label": string, "reason": string, "priority": "low" | "medium" | "high" }
  ],
  "recommendedCardIds": string[],
  "generatedQuestions": [
    { "cardId": string | null, "question": string, "expectedAnswer": string }
  ]
}`;
  },
};
