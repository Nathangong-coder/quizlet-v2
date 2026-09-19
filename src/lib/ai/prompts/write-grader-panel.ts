import { GraderPanelSchema } from '@/lib/ai/schemas';
import { GRADER_PANEL_KINDS, GRADER_PANEL_BANDS, type GraderPanelKind } from '@/lib/analysis/benchmark';
import { GRADER_SCORING } from '@/lib/analysis/scoring-rules';
import type { PromptKlp } from './multiple-choice';
import type { PromptRelation, PromptFormReq } from './grade-short-answer';

export interface WriteGraderPanelBuildInput {
  /** The card's term — what is being asked. */
  question: string;
  definition: string;
  /** `CardAuthoring.referenceAnswer` at the card's current klpVersion. */
  referenceAnswer: string;
  /** The live key points, by prompt ref, with kinds. Ignored — never rendered — for the blind kinds. `weight` is shown on `bands` so the adversary can aim. */
  klps: (PromptKlp & { weight?: number })[];
  relations: PromptRelation[];
  formReqs: PromptFormReq[];
  kind: GraderPanelKind;
}

const LEVELS_TASK = `Write four answers at four LEVELS of competence, each level exactly once:
- "expert": a complete, correct answer that states every key point and every relation and satisfies every form requirement. It must not copy the reference answer verbatim — same substance, a different candidate's words and order.
- "competent": a good answer with one real gap or one imprecise point. It states most key points correctly and contradicts none; it should read as a strong candidate on a normal day, not as a shorter expert answer.
- "weak": an answer that omits at least two key points but contradicts none — thin and partly right, never wrong. It may fudge a point it half-remembers.
- "wrong": an answer that is confidently wrong on at least one causal point — it asserts the opposite of, or a false version of, a key point of kind causal or mechanism, and reads as sure of itself. It may still get other points right.`;

/**
 * The BLIND variant of the levels task (2026-09-18, owner's ask). The
 * adversary sees the question and the reference answer ONLY — no key points,
 * no relations, no form requirements — so its four answers are shaped like a
 * real learner's prose, not around the grader's rubric. The levels mean the
 * same thing; the rationale is written in the adversary's own terms (which
 * parts of the reference's substance are stated, fudged, omitted or wrong)
 * because it has no [n] to cite.
 */
const BLIND_TASK = `Write four answers at four LEVELS of competence, each level exactly once. You have the question and a strong reference answer and nothing else; judge substance against the reference, in your own reading of what it teaches:
- "expert": a complete, correct answer covering everything the reference establishes — every claim, every cause-and-effect, every condition — in a different candidate's words and order. It must not copy the reference verbatim.
- "competent": a good answer with ONE real gap or ONE imprecise claim. It covers most of the substance correctly and contradicts nothing; it reads as a strong candidate on a normal day, not as a shorter expert answer. Name the gap in the rationale.
- "weak": an answer that leaves out at least two substantive things the reference establishes but contradicts none — thin and partly right, never wrong. It may fudge something it half-remembers.
- "wrong": an answer that is confidently wrong on at least one cause-and-effect or mechanism — it asserts the opposite of, or a false version of, something the reference teaches, and reads as sure of itself. It may still get other things right.`;

const BAND_LIST = GRADER_PANEL_BANDS.map((b) => `- "${b.id}" (rank ${b.rank}): content score ${b.low === b.high ? b.low : `${b.low}-${b.high}`}`).join('\n');

/**
 * SIX BANDS (2026-09-18). The adversary aims each answer at a target CONTENT
 * score and is told exactly how that score is computed, so the bands are a
 * calibration target rather than a vibe: weights per point, partial = half,
 * a contradicted point SUBTRACTS its weight, a contradicted relation
 * subtracts half the mean weight. Communication is deliberately held
 * constant (every answer fluent, interview voice) so the band measures
 * content alone.
 */
const BANDS_TASK = `Write SIX answers, one per BAND, each band exactly once. Each answer must land in its band on the CONTENT SCORE, which is computed mechanically: every key point carries a weight; a point stated correctly earns its full weight, a point only half-stated or alluded to earns half, a point left out earns nothing, and a point CONTRADICTED (the opposite mechanism, direction or comparison asserted) SUBTRACTS ${GRADER_SCORING.contradictionPenalty}x its weight; a relation asserted backwards or denied subtracts ${GRADER_SCORING.relationContradictionPenalty}x the mean weight. Score = earned / total weight, floored at 0, x 100. Aim by choosing WHICH points to state, half-state, omit or contradict — the weights are listed. Keep every answer equally fluent and confident so only content moves the score.
${BAND_LIST}
Bands are about content, not prose: a "failing" answer can be beautifully written and still contradict the core mechanism. Never copy the reference verbatim; every answer is a different candidate's words and order.`;

const BLIND_BANDS_TASK = `Write SIX answers, one per BAND, each band exactly once. You have the question and a strong reference answer and nothing else; the content score you are aiming at is, roughly, the share of the reference's substance the answer states (a half-stated claim counts half) MINUS a penalty for anything asserted that contradicts the reference — a contradicted mechanism costs as much as a stated one earns, so a confidently wrong answer sinks fast. Aim by choosing what to state, half-state, omit or get wrong. Keep every answer equally fluent so only content moves the score.
${BAND_LIST}
What each band looks like: "full" states everything the reference establishes; "strong" leaves out one minor detail or figure; "good" has one substantive gap; "fair" has two gaps or one gap and one imprecision; "marginal" states about half the substance, contradicting nothing; "failing" is mostly missing, or confidently contradicts a central mechanism. Never copy the reference verbatim.`;

const MODES_TASK = `Write four answers, one per FAILURE SHAPE, each shape exactly once. Each is a plausible candidate's answer that fails in exactly the named way — the shapes must not bleed into each other:
- "gap": omits at least two key points and never contradicts one. Everything it says is right; it is what it does not say. No wrong direction, no false version, no invented claim.
- "misconception": contradicts at least one key point — asserts the opposite, a false version, or a reversed direction of causality — and states it as fact. The rest may be right.
- "connectivity": states every endpoint correctly but never the link between them — every key point on both sides of every relation is present and right, yet the reader could not tell from the answer that one causes, requires or precedes the other.
- "template": fluent and confident, hits most key points, and fails at least one form requirement — it answers a neighbouring question (a related one the candidate rehearsed), not the question asked, or breaks another listed form rule in the same way a memorised answer would.`;

/**
 * Spec 5 §8 — the grader benchmark's ADVERSARY. One call per card, writing
 * the fixed panel the runtime grader is then measured against.
 *
 * Two panel kinds. `levels` writes four answers at four intended levels of
 * competence — `expert`, `competent`, `weak`, `wrong` — with the rank the
 * adversary intends; TypeScript then checks the grader's coverage scores
 * reproduce that order (`rankAgreement`) and by how much (`adjacentGaps`).
 * `modes` writes one answer per FAILURE SHAPE — `gap`, `misconception`,
 * `connectivity`, `template` — so the grader's verdict labels can be
 * checked against the shape the answer was built to have
 * (`shapeAgreement`). Every answer carries a rationale naming which points
 * it nails, fudges, omits or inverts and which form rules it breaks — that
 * rationale is what a report prints beside the grader's quotes on an
 * inverted pair.
 *
 * THIS PROMPT'S OUTPUT IS NEVER SHOWN TO THE GRADER. The grader receives
 * each answer's `text` alone, one answer per call, with no level, mode,
 * rank or rationale — `GRADE_CANDIDATES_SEPARATELY`'s lesson: a grader that
 * can see the panel ranks the answers against each other and manufactures
 * separation the key points never earned, and a grader that can see the
 * intent is grading the label, not the answer. The adversary, unlike the
 * authoring panel writer (`write-panel.ts`), DOES see the key points,
 * relations and form requirements: here the key points are the fixed
 * instrument and the grader is the thing under test, so an answer built to
 * omit exactly point 2 is the point, not a circularity.
 *
 * Writer-family task (`grader-panel`), Z.ai first at `high` effort: four
 * calibrated answers per card, written once per (card, klpVersion) and
 * re-graded on every grader change. Version 1; the version is persisted on
 * `GraderPanel.promptVersion`.
 */
export const WRITE_GRADER_PANEL_PROMPT = {
  id: 'write-grader-panel',
  version: 1,
  schema: GraderPanelSchema,
  build(input: WriteGraderPanelBuildInput): string {
    if (!(GRADER_PANEL_KINDS as readonly string[]).includes(input.kind)) {
      throw new Error(`unknown grader panel kind: ${input.kind}`);
    }
    const relations = input.relations.length
      ? `\nRelations between key points (a link the card teaches; [Rn] (type) [from] → [to]):\n${input.relations.map((r) => `[R${r.ref}] (${r.type}) [${r.fromRef}] → [${r.toRef}]`).join('\n')}\n`
      : '';
    const form = input.formReqs.length
      ? `\nForm requirements (the SHAPE a complete answer must have):\n${input.formReqs.map((f) => `[F${f.ref}] ${f.text}`).join('\n')}\n`
      : '';

    const task = input.kind === 'levels' ? LEVELS_TASK : input.kind === 'blind' ? BLIND_TASK : input.kind === 'bands' ? BANDS_TASK : input.kind === 'blind-bands' ? BLIND_BANDS_TASK : MODES_TASK;
    const labelKey = input.kind === 'modes' ? 'mode' : 'level';
    const levelsShaped = input.kind !== 'modes';
    const bands = input.kind === 'bands' || input.kind === 'blind-bands';
    const count = bands ? 'SIX' : 'four';
    const rankRule = bands
      ? 'the band\'s rank — "full" is 1, "strong" 2, "good" 3, "fair" 4, "marginal" 5, "failing" 6.'
      : 'the level\'s rank — "expert" is 1, "competent" 2, "weak" 3, "wrong" 4.';

    if (input.kind === 'blind' || input.kind === 'blind-bands') {
      return `You are writing a BENCHMARK PANEL for one interview question: ${count} candidate answers, each written to a stated intent, that will be used to test whether an automated grader reads answers the way a knowledgeable interviewer would. You are the adversary. The grader will see each answer's text ALONE — one at a time, never two together, and never your labels, ranks or rationale — so every answer must be self-contained: it must read as one candidate's complete reply to the question, with nothing that refers to another answer or to this task.

${task}

For EVERY answer:
- "text": 60-200 words, in the voice of a candidate answering in an interview. Self-contained.
- "intendedRank": ${rankRule}
- "rationale": ONE paragraph saying why the answer sits where it does — which parts of the reference's substance it states, fudges, leaves out or gets wrong, in your own words. Be specific: the rationale is what a reviewer reads when the grader disagrees with you.

Question: ${input.question}
Definition on the card: ${input.definition}
Reference answer: ${input.referenceAnswer}

Output JSON: { "answers": [ { "level": string, "intendedRank": number, "text": string, "rationale": string } ] } — exactly ${count.toLowerCase()} entries, one per ${bands ? 'band' : 'level'}.`;
    }

    return `You are writing a BENCHMARK PANEL for one interview question: ${count} candidate answers, each written to a stated intent, that will be used to test whether an automated grader reads answers the way a knowledgeable interviewer would. You are the adversary. The grader will see each answer's text ALONE — one at a time, never two together, and never your labels, ranks or rationale — so every answer must be self-contained: it must read as one candidate's complete reply to the question, with nothing that refers to another answer or to this task.

${task}

For EVERY answer:
- "text": 60-200 words, in the voice of a candidate answering in an interview. Self-contained.
- "intendedRank": ${levelsShaped ? rankRule : 'your rank of the four answers by how well they answer the question, 1 (best) to 4 (worst), each rank used once.'}
- "rationale": ONE paragraph saying why the answer sits where it does — which key points (by [n]) it nails, fudges, omits or inverts, which relations (by [Rn]) it states or leaves unmade, and which form requirements (by [Fn]) it breaks. Be specific: the rationale is what a reviewer reads when the grader disagrees with you.

Question: ${input.question}
Definition on the card: ${input.definition}
Reference answer: ${input.referenceAnswer}
Key points, with kinds${bands ? ' and weights' : ''}:
${input.klps.map((k) => `[${k.ref}] (${k.kind}${bands && k.weight !== undefined ? `, weight ${k.weight}` : ''}) ${k.text}`).join('\n')}
${relations}${form}
Output JSON: { "answers": [ { "${labelKey}": string, "intendedRank": number, "text": string, "rationale": string } ] } — exactly ${count.toLowerCase()} entries, one per ${bands ? 'band' : levelsShaped ? 'level' : 'failure shape'}.`;
  },
};
