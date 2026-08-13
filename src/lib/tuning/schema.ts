import { z } from 'zod'
import { DEFAULT_BANDS, type BandTable, type SeverityBand } from '@/lib/errors/bands'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'

/** Bump when either stored blob's shape changes incompatibly. */
export const TUNING_VERSION = 1

const KNOWN_TYPES = new Set<string>([
  ...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES,
])

/**
 * A band is two integers in 1-5 with floor <= ceiling. Violations are REJECTED,
 * never clamped: silently clamping lets a user believe they set something they
 * did not, and the panel would show their input while scoring used another.
 */
const BandSchema = z
  .tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)])
  .refine(([floor, ceiling]) => floor <= ceiling, {
    message: 'floor must not exceed ceiling',
  })

export const BandOverridesSchema = z
  .record(z.string(), BandSchema)
  .refine((rec) => Object.keys(rec).every((k) => KNOWN_TYPES.has(k)), {
    message: 'unknown error type',
  })

export type BandOverrides = Record<string, SeverityBand>

/**
 * Parse a STORED blob. A corrupt or partially invalid blob yields NO overrides
 * rather than throwing — a bad settings row must not make the app unusable,
 * matching how `SESSION_INSIGHT_VERSION` blobs are read. A corrupt SAVE is a
 * different case and is rejected loudly; see `saveTuning`.
 */
export function parseBandOverrides(raw: unknown): BandOverrides {
  if (raw === null || raw === undefined) return {}
  const parsed = BandOverridesSchema.safeParse(raw)
  return parsed.success ? (parsed.data as BandOverrides) : {}
}

/**
 * Merge sparse overrides over the shipped defaults.
 *
 * ALWAYS returns a full table. `resolveSeverity` does `bands ?? DEFAULT_BANDS`
 * — a replacement, not a merge — so handing it a partial table silently
 * downgrades every unlisted type to FALLBACK_BAND [1,3]. Every band value
 * crossing a module boundary in Spec 3B comes from here.
 *
 * Sparse on purpose at the STORAGE layer: a user who retunes one type keeps
 * tracking future default changes for every other type. Returns a fresh object
 * — never mutates DEFAULT_BANDS, which is module-level shared state.
 */
export function resolveBands(overrides: BandOverrides): BandTable {
  return { ...DEFAULT_BANDS, ...overrides }
}

/**
 * The numeric thresholds a learner may retune.
 *
 * These are not cosmetic. `minObservations` decides how much evidence counts as
 * "enough to have an opinion" — a judgement about the learner's situation (an
 * interview next week justifies acting on thinner evidence than one six months
 * out), not a universal constant. The other two carried in-code comments saying
 * they wanted tuning once real tag volume existed; this is that.
 */
export interface MetricThresholds {
  /** Below this many observations, no caller may call a KLP weak or strong. */
  minObservations: number
  /** pKnown at or above which a `too_terse` tag is an expression gap, not a knowledge gap. */
  articulationMinPKnown: number
  /** Average per-answer expression weight at which readiness reaches 0. */
  readinessWeightPerAnswer: number
}

/**
 * A `too_terse` tag only counts as an ARTICULATION problem at or above this
 * pKnown. Below it, brevity is far more likely to mean the learner does not
 * know the material — and booking that as an expression gap would route them
 * to short-answer drilling when they need the concept, misdiagnosing exactly
 * the case this metric exists to separate.
 *
 * Defined HERE rather than in `articulation.ts` (which re-exports it) only to
 * break an import cycle: `articulation.ts` imports `MetricThresholds` from this
 * module, so this module cannot import its constants back.
 */
export const ARTICULATION_MIN_PKNOWN = 0.6

/**
 * Average per-answer expression-error weight at which readiness reaches 0.
 * Roughly two significant expression tags on every answer. Same cycle-breaking
 * note as above.
 */
export const READINESS_WEIGHT_PER_ANSWER = 12

/**
 * DERIVED from the shipped constants, never a second copy of the numbers —
 * the same rule `guessRate` follows against `EVIDENCE_STRENGTH`. A test pins
 * the equality so a change to either side is a build failure rather than a
 * silent divergence between "the default" and "the constant".
 */
export const DEFAULT_THRESHOLDS: MetricThresholds = {
  minObservations: MIN_OBSERVATIONS,
  articulationMinPKnown: ARTICULATION_MIN_PKNOWN,
  readinessWeightPerAnswer: READINESS_WEIGHT_PER_ANSWER,
}

/**
 * Bounds are correctness, not taste:
 * - `minObservations` below 1 would let a KLP with zero evidence report a
 *   posterior indistinguishable from a measured one.
 * - `readinessWeightPerAnswer` is a DIVISOR in `computeArticulation`; zero or
 *   negative produces Infinity or an inverted metric.
 * `.strict()` rejects unknown keys so a typo is an error rather than a
 * silently-ignored setting the panel still displays.
 */
export const ThresholdOverridesSchema = z
  .object({
    minObservations: z.number().int().min(1).max(50).optional(),
    articulationMinPKnown: z.number().min(0).max(1).optional(),
    readinessWeightPerAnswer: z.number().positive().max(100).optional(),
  })
  .strict()

export type ThresholdOverrides = z.infer<typeof ThresholdOverridesSchema>

/** Parse a STORED blob; corrupt yields no overrides rather than throwing. */
export function parseThresholds(raw: unknown): ThresholdOverrides {
  if (raw === null || raw === undefined) return {}
  const parsed = ThresholdOverridesSchema.safeParse(raw)
  if (!parsed.success) return {}
  // Strip explicit undefineds so `{}` deep-equals `{}` and callers can count keys.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as ThresholdOverrides
}

/** Fill every unset key from the defaults. Always returns a complete set. */
export function resolveThresholds(overrides: ThresholdOverrides): MetricThresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides }
}

export const STRATEGY_KEYS = [
  'shore_up_weaknesses', 'polish_near_ready', 'follow_forgetting', 'balanced',
] as const
export type StrategyKey = (typeof STRATEGY_KEYS)[number]

/**
 * `balanced` is the default because a learner who has never opened settings
 * must not be silently enrolled in an aggressive strategy.
 */
export function parseStrategy(raw: unknown): StrategyKey {
  return STRATEGY_KEYS.includes(raw as StrategyKey) ? (raw as StrategyKey) : 'balanced'
}

export interface TuningRow {
  strategy: StrategyKey
  bandOverrides: BandOverrides
  thresholdOverrides: ThresholdOverrides
}

/**
 * Pure: every decision the load/save actions make happens here so it is tested
 * without a database. Each field degrades INDEPENDENTLY — one corrupt blob must
 * not discard a perfectly good strategy or the other blob.
 */
export function shapeTuning(
  row: { strategy: string; bands: unknown; thresholds: unknown } | null,
): TuningRow {
  if (!row) return { strategy: 'balanced', bandOverrides: {}, thresholdOverrides: {} }
  return {
    strategy: parseStrategy(row.strategy),
    bandOverrides: parseBandOverrides(row.bands),
    thresholdOverrides: parseThresholds(row.thresholds),
  }
}
