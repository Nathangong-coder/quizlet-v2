import { z } from 'zod'

/**
 * Bump when the persisted shape changes incompatibly. Readers parse with the
 * schema and fall back to regenerating rather than rendering a stale blob.
 */
export const SESSION_INSIGHT_VERSION = 1

/** How many focus areas a single session may surface. */
export const MAX_FOCUS_AREAS = 5

const CardRefSchema = z.object({
  cardId: z.string(),
  term: z.string(),
})

const TimedItemSchema = CardRefSchema.extend({
  latencyMs: z.number(),
})

/** Mirrors SessionComputed in src/lib/memory/summarize.ts. */
export const SessionComputedSchema = z.object({
  itemCount: z.number(),
  byCategory: z.array(
    z.object({
      name: z.string(),
      correct: z.number(),
      total: z.number(),
      accuracyPct: z.number(),
    }),
  ),
  byMode: z.array(
    z.object({
      mode: z.string(),
      correct: z.number(),
      total: z.number(),
      avgScore: z.number().nullable(),
      medianLatencyMs: z.number().nullable(),
    }),
  ),
  pacing: z.object({
    medianLatencyMs: z.number().nullable(),
    fastest: TimedItemSchema.nullable(),
    slowest: TimedItemSchema.nullable(),
    byMode: z.array(
      z.object({ mode: z.string(), medianLatencyMs: z.number().nullable() }),
    ),
  }),
  confidence: z.object({
    avgDelta: z.number().nullable(),
    newlyMastered: z.array(CardRefSchema),
    dropped: z.array(CardRefSchema),
  }),
  outliers: z.object({
    rushed: z.array(TimedItemSchema),
    laboured: z.array(TimedItemSchema),
  }),
})

/**
 * The AI's half of the contract. It reads the computed block and writes prose;
 * every number stays in `computed`, so the model can never fabricate a stat.
 */
export const SessionInsightAiSchema = z.object({
  focusAreas: z
    .array(
      z.object({
        title: z.string(),
        severity: z.enum(['high', 'medium', 'low']),
        evidence: z.string(),
        action: z.string(),
        cardIds: z.array(z.string()),
      }),
    )
    .max(MAX_FOCUS_AREAS),
  strengths: z.string(),
})

/** The full blob persisted on StudySession.insight. */
export const SessionInsightSchema = z.object({
  version: z.literal(SESSION_INSIGHT_VERSION),
  computed: SessionComputedSchema,
  // Null for matching/confidence sessions (no AI by design), and for quizzes
  // whose generation failed or hasn't been requested yet.
  ai: SessionInsightAiSchema.nullable(),
})

export type SessionInsight = z.infer<typeof SessionInsightSchema>
export type SessionInsightAi = z.infer<typeof SessionInsightAiSchema>
