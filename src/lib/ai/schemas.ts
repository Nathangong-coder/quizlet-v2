import { z } from 'zod';

export const MultipleChoiceOptionsSchema = z.object({
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.string().min(1),
});

export type MultipleChoiceOptions = z.infer<typeof MultipleChoiceOptionsSchema>;

export const ShortAnswerGradeSchema = z.object({
  clarity: z.object({
    score: z.number().int().min(1).max(10),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
  }),
  conciseness: z.object({
    score: z.number().int().min(1).max(10),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
  }),
  correctness: z.object({
    score: z.number().int().min(1).max(10),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
  }),
  overall: z.number().int().min(1).max(10),
  summary: z.string().min(1),
  suggestedImprovement: z.string().min(1),
});

export type ShortAnswerGrade = z.infer<typeof ShortAnswerGradeSchema>;

export const AnnotationSchema = z.object({
  annotations: z.array(z.object({
    type: z.enum(['bold', 'underline', 'highlight']),
    text: z.string(),
    startIndex: z.number(),
    endIndex: z.number(),
    comment: z.string().optional(),
  })),
});

export type Annotation = z.infer<typeof AnnotationSchema>;

export const MultipleChoiceFeedbackSchema = z.object({
  feedback: z.string().min(1),
});

export type MultipleChoiceFeedback = z.infer<typeof MultipleChoiceFeedbackSchema>;

export const CardAutocompleteSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1).max(5),
});

export type CardAutocomplete = z.infer<typeof CardAutocompleteSchema>;

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
