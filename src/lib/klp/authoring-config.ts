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
 * The smallest number of KLPs the sizing layer will ever target — the owner's
 * "base of 4+ KLPs" (increment A §5), and the lower end of the grain target
 * `validateKlpSet` and the prompts state.
 *
 * A SMELL TEST, NOT A QUOTA — the discrimination test is authoritative over
 * this range, and padding to reach the floor is precisely what that test
 * catches, because a padded KLP fires identically on every answer.
 *
 * It dropped from 5 to 4 when sizing became adaptive (`src/lib/klp/sizing.ts`).
 * The cost of that, stated plainly: a fixed 5-9 range made the COUNT itself a
 * weak quality signal — a card returning 3 was visibly under-authored — and an
 * adaptive target removes it, so 4 KLPs may now be correctly small or quietly
 * thin. Read the separation score beside a low count, never the count alone.
 */
export const MIN_KLPS_FLOOR = 4

/** The name the prompts and `validateKlpSet` use for {@link MIN_KLPS_FLOOR}. */
export const MIN_KLPS_PER_CARD = MIN_KLPS_FLOOR

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

/**
 * How the two weight signals are blended (increment A §1).
 *
 * `weightFromSignals` (`src/lib/klp/relations.ts`) is
 * `w_graph · blastRadiusTerm + w_evidence · discriminationBreadthTerm`.
 *
 * BOTH terms exist because neither works on every card shape. Blast radius
 * measures dependency DEPTH: on a derivation chain ($10 depreciation: EBIT
 * -10 -> NI -6 -> CFO +4) each step consumes the previous one's output and the
 * graph term spans its whole range. On an ENUMERATION ("why do LBOs use
 * leverage" — several parallel value drivers) there is no dependency to
 * measure, the relate call correctly returns almost no edges, and the graph
 * term collapses to a flat 1 for every KLP. The first real pilot card produced
 * weights 2,1,2,1,1 for exactly that reason, and the wrong fix — pushing the
 * relate prompt to find more edges — would fabricate `causes` links that Spec
 * 3 then serves grading probes for, marking a learner wrong for not making a
 * connection nobody should make.
 *
 * The evidence term is call B's verdict matrix, already computed for the
 * discrimination test and previously discarded: a KLP all three adversaries
 * fail is load-bearing, one only the vague answer misses is peripheral. It
 * costs no extra AI call, and it carries the enumeration cards the graph term
 * cannot.
 *
 * Equal weighting is a STARTING POINT, to be revisited against the first real
 * histogram (`npm run klp-histogram`) — that histogram, not this constant, is
 * the acceptance criterion for the fix.
 */
export const WEIGHT_GRAPH_TERM = 0.5
export const WEIGHT_EVIDENCE_TERM = 0.5

/**
 * The blast radius at which the graph term saturates.
 *
 * 4 keeps `weightFromSignals(radius, breadth)` with `WEIGHT_EVIDENCE_TERM = 0`
 * numerically identical to the old `weightFromBlastRadius` (0 dependents -> 1,
 * 4 or more -> 5), so the change is a strict generalisation rather than a
 * silent re-scaling of every weight already written.
 */
export const BLAST_RADIUS_FULL = 4

/**
 * A definition longer than this reads as multi-part even when it is punctuated
 * as one clause, and earns one extra KLP in the mechanical prior.
 * `src/lib/klp/sizing.ts` owns the arithmetic.
 */
export const LONG_DEFINITION_CHARS = 320

/** A question this many words or longer is asking more than one thing. */
export const LONG_QUESTION_WORDS = 12

/**
 * Histogram failure thresholds (`src/lib/klp/histogram.ts`).
 *
 * `CLUSTER_SHARE` fires `clustered_high` / `clustered_low` when three quarters
 * of all live weights sit in one two-value tail. The G1 baseline — 92.3% of
 * AI-assigned weights at 4 or 5 — is far past it, which is the point: the
 * threshold must reject the condition this whole increment exists to fix,
 * with room to spare rather than sitting on the boundary.
 *
 * `UNIFORM_SHARE` is lower because it is a weaker claim: one weight value
 * accounting for 60% of the corpus is flat even when it is not in a tail.
 */
export const HISTOGRAM_CLUSTER_SHARE = 0.75
export const HISTOGRAM_UNIFORM_SHARE = 0.6
