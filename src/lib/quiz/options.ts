import { z } from 'zod';

/**
 * The accuracy-vocabulary corruptions a distractor may be built from. Must
 * stay in sync with docs/ai/error-taxonomy.md §2.1 — Spec 2 reads a picked
 * distractor's `corruption` directly as the error type, with no AI call.
 */
export const CORRUPTIONS = [
  'inversion',
  'conflation',
  'misapplication',
  'overgeneralization',
  'factual_error',
] as const;

export type Corruption = (typeof CORRUPTIONS)[number];

const OptionV2Schema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  sourceKlpId: z.string().optional(),
  corruption: z.enum([...CORRUPTIONS]).optional(),
});

export const OptionCacheV2Schema = z.object({
  v: z.literal(2),
  correctAnswer: z.string().min(1),
  options: z.array(OptionV2Schema),
});

const OptionCacheV1Schema = z.object({
  options: z.array(z.string().min(1)),
  correctAnswer: z.string().min(1),
});

export interface ParsedOption {
  text: string;
  correct: boolean;
  sourceKlpId?: string;
  corruption?: Corruption;
}

export interface ParsedOptions {
  version: 1 | 2;
  correctAnswer: string;
  options: ParsedOption[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Reads either cache generation. v1 blobs predate KLP provenance and are
 * returned provenance-less rather than discarded — every card already quizzed
 * has one, and wiping them would re-bill the user for generation they already
 * paid for.
 */
export function parseOptionCache(json: unknown): ParsedOptions | null {
  const v2 = OptionCacheV2Schema.safeParse(json);
  if (v2.success) {
    return { version: 2, correctAnswer: v2.data.correctAnswer, options: v2.data.options };
  }

  const v1 = OptionCacheV1Schema.safeParse(json);
  if (v1.success) {
    const correct = normalize(v1.data.correctAnswer);
    return {
      version: 1,
      correctAnswer: v1.data.correctAnswer,
      options: v1.data.options.map((text) => ({ text, correct: normalize(text) === correct })),
    };
  }

  return null;
}

/**
 * What a wrong pick reveals: which KLP the chosen distractor was built from,
 * and how it was corrupted. This is what lets multiple choice diagnose itself
 * with no grading call (docs/ai/error-taxonomy.md §4).
 *
 * Returns null for the correct answer, for v1 blobs, and for any option
 * lacking provenance — never a fabricated default, which would pollute the
 * aggregate profile with errors the learner never made.
 */
export function resolveDistractorProvenance(
  parsed: ParsedOptions,
  pickedText: string,
): { sourceKlpId: string; corruption: Corruption } | null {
  const picked = parsed.options.find((o) => normalize(o.text) === normalize(pickedText));
  if (!picked || picked.correct) return null;
  if (!picked.sourceKlpId || !picked.corruption) return null;
  return { sourceKlpId: picked.sourceKlpId, corruption: picked.corruption };
}
