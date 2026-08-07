import { z } from 'zod';
import { CORRUPTIONS } from '@/lib/quiz/options';
import { DIMENSIONS, MAX_TAGS_PER_ANSWER } from '@/lib/errors/taxonomy';
import { KLP_STATUSES } from '@/lib/errors/klp-credit';

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
  overall: z.number().min(1).max(10),
  summary: z.string().min(1),
  suggestedImprovement: z.string().min(1),
  /**
   * Per-KLP outcomes. `klpRef` is an index into the prompt's KLP list, never a
   * cuid. Optional so the no-KLP path parses today's shape unchanged.
   */
  klpResults: z.array(z.object({
    klpRef: z.number().int().min(0),
    status: z.enum(KLP_STATUSES),
    evidence: z.string().optional(),
  })).optional(),
  /**
   * `type` is z.string(), not an enum: it is validated against its OWN
   * dimension in TS (buildAnalysisWrites), which a flat enum cannot express.
   * `magnitude` is the AI's ONLY numeric contribution — how bad THIS instance
   * is within its type. The type's band converts it to a 1-5 severity in TS
   * (src/lib/errors/bands.ts); the model never sees the band.
   */
  errorTags: z.array(z.object({
    dimension: z.enum(DIMENSIONS),
    type: z.string().min(1),
    klpRef: z.number().int().min(0).optional(),
    secondaryKlpRef: z.number().int().min(0).optional(),
    magnitude: z.number().int().min(1).max(10),
    quote: z.string().optional(),
  })).max(MAX_TAGS_PER_ANSWER).optional(),
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

/**
 * KLP kinds. `kind` is what makes "memorizes terms, fails on why" a groupBy
 * rather than an AI judgment — see docs/ai/error-taxonomy.md §6.
 */
export const KLP_KINDS = [
  'definition',
  'mechanism',
  'causal',
  'condition',
  'quantitative',
  'contrast',
  'example',
] as const;

export const MAX_KLPS_PER_CARD = 5;

export const KlpExtractionSchema = z.object({
  cards: z.array(
    z.object({
      // Index into the batch the prompt was built from. Cards are addressed by
      // position, never by cuid — the model must never see raw ids.
      ref: z.number().int().min(0),
      cardType: z.enum(['atomic', 'compound']),
      klps: z
        .array(
          z.object({
            text: z.string().min(1),
            weight: z.number().int().min(1).max(5),
            kind: z.enum(KLP_KINDS),
          }),
        )
        .min(1)
        .max(MAX_KLPS_PER_CARD),
    }),
  ),
});

export type KlpExtraction = z.infer<typeof KlpExtractionSchema>;

/**
 * KLP-aware MC generation. Distractors reference the KLP they corrupt by its
 * `ref` (index in the prompt), never by cuid; the action maps refs back to ids.
 */
export const MultipleChoiceKlpSchema = z.object({
  correctAnswer: z.string().min(1),
  distractors: z
    .array(
      z.object({
        text: z.string().min(1),
        klpRef: z.number().int().min(0),
        corruption: z.enum(CORRUPTIONS),
      }),
    )
    .length(3),
});

export type MultipleChoiceKlp = z.infer<typeof MultipleChoiceKlpSchema>;

export const TrueFalseStatementSchema = z.object({
  statement: z.string().min(1),
  klpRef: z.number().int().min(0),
  corruption: z.enum(CORRUPTIONS),
});

export type TrueFalseStatement = z.infer<typeof TrueFalseStatementSchema>;
