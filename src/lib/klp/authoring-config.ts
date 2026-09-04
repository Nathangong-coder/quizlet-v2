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
 * The upper end of the grain target FOR THE AUTHORING PIPELINE ONLY.
 *
 * This is deliberately separate from `MAX_KLPS_PER_CARD` in
 * `src/lib/ai/schemas.ts`, which bounds the LEGACY demand-driven extraction
 * path (`src/lib/ai/prompts/extract-klps.ts`) and stays at 5 until a later
 * spec retires that path. Two pipelines, two grain targets — conflating them
 * by widening the shared constant silently changed live extraction-prompt
 * copy and schema behaviour for cards that never go through authoring at all.
 * That happened once already on this branch; this constant exists so it
 * cannot happen again.
 */
export const MAX_KLPS_AUTHORED = 9

/**
 * One grading call per candidate answer.
 *
 * TRUE is not merely the careful setting. A grader shown all four candidates
 * at once can RANK them against each other instead of judging each against the
 * KLPs — handing the reference high marks and the wrong answers low ones by
 * comparison. That manufactures separation the KLPs never earned, and the
 * score would report success exactly when it was measuring nothing.
 *
 * FALSE is NOT a cheaper batched mode — this spec does not build one, and
 * flipping this constant does not change spend. `GRADE_CANDIDATE_PROMPT`
 * (`src/lib/ai/prompts/grade-candidate.ts`) is deliberately single-candidate
 * only: a prompt that accepted several answers at once would reintroduce the
 * exact ranking risk described above, which is the whole reason isolation
 * exists. `src/lib/klp/authoring.ts`'s `gradeAllCandidates` still issues one
 * `grade` call per candidate when this is false — the only difference is
 * that the calls fire concurrently (`Promise.all`) instead of being run as
 * an ordered isolation boundary. This constant is kept only as the visible,
 * named toggle the design calls for; it is not exercised by any test, and a
 * future batched-cost mode would need a new prompt and schema, not a flip of
 * this flag.
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
