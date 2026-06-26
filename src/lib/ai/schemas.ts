import { z } from 'zod';

export const MultipleChoiceOptionsSchema = z.object({
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.string().min(1),
});

export type MultipleChoiceOptions = z.infer<typeof MultipleChoiceOptionsSchema>;

export const ShortAnswerGradeSchema = z.object({
  clarity: z.number().int().min(1).max(10),
  conciseness: z.number().int().min(1).max(10),
  correctness: z.number().int().min(1).max(10),
  overall: z.number().int().min(1).max(10),
  feedback: z.string().min(1),
  suggestedImprovement: z.string().min(1),
});

export type ShortAnswerGrade = z.infer<typeof ShortAnswerGradeSchema>;

export const TrainingPlanSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  focusAreas: z.array(z.object({
    label: z.string().min(1),
    reason: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high']),
  })),
  recommendedCardIds: z.array(z.string()),
  generatedQuestions: z.array(z.object({
    cardId: z.string().optional(),
    question: z.string().min(1),
    expectedAnswer: z.string().min(1),
  })),
});

export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;

export const MultipleChoiceFeedbackSchema = z.object({
  feedback: z.string().min(1),
});

export type MultipleChoiceFeedback = z.infer<typeof MultipleChoiceFeedbackSchema>;
