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
 * The QUALITY BAR that triggers a revision, distinct from `SEPARATION_FLOOR`.
 *
 * The floor (0.40) decides whether a card is FLAGGED `low_discrimination`; it
 * is deliberately low, and until 2026-09-12 it was also the only thing that
 * could make the pipeline revise. On the 15-card authoring bench that meant
 * cards with a reference that failed its own key points, seven `compound`
 * defects, or a weak answer scoring 0.60 were all accepted on the first
 * draft. The owner asked that a meaningful share of cards — at least a fifth —
 * be revised. This bar is the mechanism: a card is revised (up to
 * `MAX_REVISIONS`) when ANY of these TypeScript-computed checks fails:
 *   - separation at or below REVISION_BAR (a card must CLEAR it),
 *   - the reference answer fails any of its own key points,
 *   - any hygiene defect from `validateKlpSet` (compound, restatement, ...),
 *   - a smoke failure (a weak answer above half the set).
 * Not a quota: if every card on a run clears every check, none is revised,
 * and the run report prints the revised share and warns below a fifth.
 * `ordering` and `abstraction_spread` are NOT in the bar — they need the
 * relation edges and the abstraction classification, which are computed
 * after the loop — so they are reported on the card, not revised for.
 */
export const REVISION_BAR = 0.6

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
 * The adversary archetypes WRITTEN today. Each fails differently on purpose:
 * the vague one refuses to commit, the template one has structure with no
 * substance.
 *
 * `confident_wrong` was CUT on 2026-09-13 (owner): across every run recorded
 * in docs/ai/model-performance.md it scored 0.00-0.19 against the key points
 * and never once set the best-wrong bar — the separation test is decided by
 * the template and the vague answer, so the third trap was a grading call per
 * round that measured nothing. It survives in `LEGACY_PROBE_KINDS` because
 * every `AuthoringProbe` row written before that date carries it, and
 * `ProbeKind` must still type those rows when they are read back.
 *
 * `memorized_template` is not only an adversary — it is a ready-made near-miss
 * for the `template_anchoring` diagnosis, generated for free here.
 *
 * Weight consequence: `discriminationBreadth` is fails / adversaries, so with
 * two traps it takes the values 0, 0.5, 1 rather than thirds. The histogram
 * (`npm run klp-histogram`) is the check that this did not flatten weights.
 */
export const PROBE_KINDS = ['vague', 'memorized_template'] as const

/** Kinds no longer written but present on stored rows. */
export const LEGACY_PROBE_KINDS = ['confident_wrong'] as const

export type ProbeKind = (typeof PROBE_KINDS)[number] | (typeof LEGACY_PROBE_KINDS)[number]

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

/**
 * Below this many KLPs, the histogram reports its shape but fires NO failure
 * mode.
 *
 * Found by running the check on its first real single-card run: four KLPs came
 * back as 3,3,3,2 and `uniform` fired at 75%, which is arithmetically true and
 * evidentially worthless — with five buckets and four observations, clustering
 * cannot be told from noise. A FAIL that cries wolf on every single-card run is
 * worse than no check, because it trains the operator to skip the one place the
 * real finding will eventually appear.
 *
 * 20 is roughly four observations per weight bucket. The distribution is still
 * PRINTED below it — an operator reading one card's weights is doing something
 * legitimate — but it is printed without a verdict.
 */
export const HISTOGRAM_MIN_SAMPLE = 20

/**
 * Use the five-level competence panel instead of the three failure-kind
 * adversaries (build item 4).
 *
 * A TOGGLE, not a silent replacement, because the two produce numbers on
 * different scales — `min(passing) - max(failing)` against
 * `referenceScore - max(weak)` — and every stored `CardAuthoring.separationScore`
 * on the corpus was computed the old way. Being able to turn it off is what
 * makes the corpus comparable while the panel is being evaluated.
 *
 * Off by default until a measured run says the panel's separation floor is
 * calibrated; `PANEL_SEPARATION_FLOOR` currently has no measurement behind it.
 *
 * Read from `KLP_USE_PANEL` rather than being a hardcoded literal so a
 * CALIBRATION run can turn it on without a code change — the run whose whole
 * purpose is to produce the distribution the floor should be set from. Anything
 * other than the exact string "true" is off, so a typo fails closed.
 */
export const USE_COMPETENCE_PANEL = process.env.KLP_USE_PANEL === 'true'
