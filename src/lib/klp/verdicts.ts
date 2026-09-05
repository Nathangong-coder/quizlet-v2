/**
 * How one KLP fared against one answer.
 *
 * THIRTEEN LABELS, and the spellings are inherited, not chosen. Five of them
 * (`inversion`, `conflation`, `misapplication`, `overgeneralization`,
 * `factual_error`) are members of CORRUPTIONS in src/lib/quiz/options.ts,
 * written onto every generated distractor as its provenance and PERSISTED.
 * Renaming one strands every existing distractor row's diagnosis. The nine
 * ACCURACY_TYPES are promoted here wholesale for the same reason.
 *
 * Only four members are new concepts: `correct`, `contradicted`, plus
 * `partial` and `failed`, which are the honest FALLBACKS a grader may use when
 * it cannot commit to a specific label — and which every historical
 * AnswerKlpResult row already holds. A migration cannot know which specific
 * failure a legacy `failed` was, and inventing one is exactly the fabrication
 * this engine refuses everywhere else.
 *
 * Spec 5 widens AnswerKlpResult.status to this vocabulary at runtime. This
 * module is introduced here and used ONLY by the authoring grader.
 */
import { ACCURACY_TYPES } from '@/lib/errors/taxonomy'

export const KLP_VERDICTS = [
  'correct',
  'partial',
  'failed',
  'contradicted',
  ...ACCURACY_TYPES,
] as const

export type KlpVerdict = (typeof KLP_VERDICTS)[number]

export function isKlpVerdict(value: unknown): value is KlpVerdict {
  return typeof value === 'string' && (KLP_VERDICTS as readonly string[]).includes(value)
}

/**
 * Credit stays SEPARATE from the label, and keeps the three values
 * STATUS_CREDIT already uses.
 *
 * The labels are not ordered — `inversion` is not "more wrong" than
 * `omission`, it is differently wrong — so mapping thirteen labels onto a
 * continuous scale would invent a ranking nobody chose. BKT is untouched.
 */
export const VERDICT_CREDIT: Record<KlpVerdict, number> = {
  correct: 1,
  partial: 0.5,
  incomplete: 0.5,
  failed: 0,
  contradicted: 0,
  omission: 0,
  conflation: 0,
  inversion: 0,
  misapplication: 0,
  factual_error: 0,
  overgeneralization: 0,
  unsupported_leap: 0,
  fabrication: 0,
}
