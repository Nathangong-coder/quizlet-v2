import { ACCURACY_TYPES, type AccuracyType } from '@/lib/errors/taxonomy'

/**
 * THE NEGATIVE CHECK — docking key-point credit for what an answer ADDS.
 *
 * ## The gap this closes
 *
 * A key-point set is a **conjunction of positive requirements**: an answer is
 * credited when it states each proposition. Nothing in that structure can
 * express "and nothing false is asserted", and no key point can be added to
 * make it — you would have to enumerate every possible falsehood. It is an
 * expressiveness limit, not a tuning problem.
 *
 * The consequence was measured on the live database on 2026-09-07 and it is
 * worse than an evasion. `klpResults` and `errorTags` are written
 * independently (`src/lib/analysis/write-answer.ts`) and `klpCredit` read only
 * `status x mode`, so an answer that satisfied every key point AND asserted
 * something false was recorded as **full positive evidence on every point**.
 * The error tag landed beside it and fed severity, while `KlpState` and the
 * BKT posterior went UP. **The learner was marked as knowing the card better
 * for having said something wrong.**
 *
 * C1, the exploit test, found this independently: of the confirmed coverage
 * holes on a 20-card sample, every survivor was a `contamination` exploit —
 * an answer satisfying the whole specification while asserting a falsehood.
 *
 * ## Why it is a grading term and not an authoring check
 *
 * C1's `omission` strategy asks what the specification fails to REQUIRE, and
 * its fix is to add a key point. This asks what the answer ADDS, and there is
 * nothing to add. So it lives at grading time, where a real learner's answer
 * is scored, rather than in the authoring loop.
 *
 * ## What counts
 *
 * A tag counts only when it is BOTH:
 *
 *  - **accuracy-dimension** — a clarity or conciseness problem is a delivery
 *    issue, not a truth issue, and docking knowledge credit for verbosity
 *    would fold two different axes into one number. This project already has a
 *    standing note about not conflating communication with knowledge.
 *  - **whole-answer scope** (`klpId === null`) — a tag already attached to a
 *    specific key point has done its work through that point's own `status`.
 *    Counting it again here would penalise the same mistake twice.
 *
 * And its TYPE must be one that means "asserted something untrue", not one
 * that means "left something out" — see `CONTAMINATION_TYPES`.
 */

/**
 * The accuracy types that mean the answer ASSERTED something wrong, as opposed
 * to failing to say something.
 *
 * `omission` and `incomplete` are deliberately EXCLUDED. They describe absence,
 * they are already fully expressed by a key point's own `failed`/`partial`
 * status, and docking for them would double-count the exact thing the positive
 * requirements already measure. Only additions are contamination.
 *
 * `conflation` is excluded for a different reason: it carries a
 * `secondaryKlpId` and is therefore inherently about two specific key points,
 * so it is never a whole-answer tag in the first place.
 *
 * A strict subset of `ACCURACY_TYPES`, asserted by a test — these strings are
 * persisted in `AnswerErrorTag.type`, so a rename strands existing rows.
 */
export const CONTAMINATION_TYPES = [
  'inversion',
  'misapplication',
  'factual_error',
  'overgeneralization',
  'unsupported_leap',
  'fabrication',
] as const satisfies readonly AccuracyType[]

export type ContaminationType = (typeof CONTAMINATION_TYPES)[number]

export function isContaminationType(type: string): type is ContaminationType {
  return (CONTAMINATION_TYPES as readonly string[]).includes(type)
}

/** Sanity: the vocabulary above must stay inside the persisted one. */
export const CONTAMINATION_TYPES_ARE_ACCURACY_TYPES = CONTAMINATION_TYPES.every((t) =>
  (ACCURACY_TYPES as readonly string[]).includes(t),
)

/**
 * The most credit a contaminated answer can lose, as a fraction.
 *
 * 0.5 IS AN ANCHOR, NOT A ROUND NUMBER. It is chosen so that the worst possible
 * contamination reduces a fully-correct answer to exactly the credit of a
 * `partial` one — `STATUS_CREDIT.partial` is also 0.5, so the two multiply out
 * the same. That gives the constant a meaning a reader can check rather than a
 * value they have to trust: *an answer that states every key point and asserts
 * a maximally serious falsehood is worth the same as an answer that only half
 * stated them.* A test pins the equality so the anchor cannot drift silently
 * away from the status scale it is anchored to.
 *
 * Deliberately not 1.0. The learner DID state the points; erasing that would
 * make the negative check destroy more signal than the bug it fixes, and the
 * falsehood is separately recorded as its own error tag with its own
 * significance. The requirement here is that a contaminated answer stop being
 * worth as much as a clean one, not that it be worth nothing.
 *
 * Still a convention at the margins, and tunable: measured against 15 real
 * contaminated answers (`npm run probe-negative-check`), typical severity came
 * back 2, i.e. a factor of 0.8. Revisit once enough have accumulated to look at
 * the distribution, the way the severity bands were tuned.
 */
export const CONTAMINATION_MAX_DOCK = 0.5

/** Severity is 1-5 (`resolveSeverity`), so this is its top. */
const MAX_SEVERITY = 5

export interface ContaminationInput {
  dimension: string
  type: string
  klpId: string | null
  /** 1-5, already resolved from the type's band and the instance magnitude. */
  severity: number
}

/**
 * The multiplier applied to every key point's credit on this answer, in (0, 1].
 *
 * Scaled by the WORST contaminating tag, not the sum: two false asides are not
 * twice as disqualifying as one, and summing would drive credit to zero on a
 * verbose answer that happened to collect several small tags. `max` matches
 * what `bestWrongScore` does in the separation test, for the same reason —
 * the most serious instance sets the bar.
 *
 * Returns exactly 1 when nothing contaminates, so a clean answer's credit is
 * byte-identical to what it was before this existed.
 *
 * UNIFORM across the answer's key points, because a whole-answer falsehood is
 * by definition not attributable to one of them — that is what `klpId === null`
 * means. Docking only some would require deciding which, which is the inference
 * this engine refuses.
 */
export function contaminationFactor(tags: ContaminationInput[]): number {
  const relevant = tags.filter(
    (t) => t.dimension === 'accuracy' && t.klpId === null && isContaminationType(t.type),
  )
  if (relevant.length === 0) return 1

  const worst = Math.max(...relevant.map((t) => t.severity))
  const scaled = Math.min(Math.max(worst, 1), MAX_SEVERITY) / MAX_SEVERITY
  return 1 - CONTAMINATION_MAX_DOCK * scaled
}

/**
 * Was this answer contaminated at all? Cheaper than comparing floats, and it
 * is the question a UI or a report actually asks.
 */
export function isContaminated(tags: ContaminationInput[]): boolean {
  return contaminationFactor(tags) < 1
}
