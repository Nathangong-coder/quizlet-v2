/**
 * Every tunable in the authoring pipeline, in one place, so changing the
 * quality bar is one edit and one test rather than a hunt.
 */

/**
 * How far the reference answer must outscore the BEST wrong answer.
 *
 * The user's criterion, made numeric: "if your vague answer scores 6/7, your
 * KLPs are too loose". 6/7 is 0.857, so that card's separation is 0.143. A
 * floor of 0.4 rejects it with room to spare rather than sitting on the
 * boundary — while still letting a wrong answer earn up to 60%, because the
 * confident-but-wrong adversary SHOULD get the structural points right. That
 * is what makes it a good adversary rather than a straw man.
 */
export const SEPARATION_FLOOR = 0.4

/**
 * Revisions before giving up. Three grading rounds total.
 *
 * A card that still fails is written anyway and flagged
 * `low_discrimination`, never retried silently: retrying burns the user's key
 * pool, dropping loses the work, and shipping it unflagged is the exact
 * failure this pipeline exists to prevent.
 */
export const MAX_REVISIONS = 2

/**
 * The lower end of the grain target. A SMELL TEST, NOT A QUOTA — an atomic
 * card genuinely has one point, and the discrimination test is authoritative
 * over this range. Padding to reach five is precisely what the test catches,
 * because a padded KLP fires identically on every answer.
 */
export const MIN_KLPS_PER_CARD = 5

/**
 * One grading call per candidate answer.
 *
 * TRUE is not merely the careful setting. A grader shown all four candidates
 * at once can RANK them against each other instead of judging each against the
 * KLPs — handing the reference high marks and the wrong answers low ones by
 * comparison. That manufactures separation the KLPs never earned, and the
 * score would report success exactly when it was measuring nothing.
 *
 * Flipping this to false roughly halves authoring spend and costs that
 * guarantee. It exists as a constant so the trade is deliberate and visible.
 */
export const GRADE_CANDIDATES_SEPARATELY = true

/**
 * The three adversary archetypes, from the user's specification. Each fails
 * differently on purpose: the confident one is articulate and wrong, the vague
 * one refuses to commit, and the template one has structure with no substance.
 *
 * `memorized_template` is not only an adversary — it is a ready-made near-miss
 * for the `template_anchoring` diagnosis, generated for free here.
 */
export const PROBE_KINDS = ['confident_wrong', 'vague', 'memorized_template'] as const

export type ProbeKind = (typeof PROBE_KINDS)[number]
