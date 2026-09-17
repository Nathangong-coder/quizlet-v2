import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas';
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES, MAX_TAGS_PER_ANSWER } from '@/lib/errors/taxonomy';
import { RUNTIME_VERDICTS } from '@/lib/klp/verdicts';
import { PromptKlp } from './multiple-choice';
import { verdictInstructionBlock } from './verdict-block';

/** One `KlpRelation` edge of the card, by prompt ref. Never a cuid. */
export interface PromptRelation {
  ref: number;
  type: string;
  fromRef: number;
  toRef: number;
}

/** One `CardFormRequirement` of the card, by prompt ref. Never a cuid. */
export interface PromptFormReq {
  ref: number;
  text: string;
}

/**
 * Spec 5, "The boundary": the grader's inputs are the card, its key points,
 * relations and form requirements, and the learner's text — and NOTHING
 * about the learner. There is deliberately no learner-profile field here.
 */
export interface GradeShortAnswerBuildInput {
  card: Card;
  answer: string;
  /** Live KLPs. Absent or empty falls back to the rubric-only prompt. */
  klps?: PromptKlp[];
  relations?: PromptRelation[];
  formReqs?: PromptFormReq[];
  /** CardAuthoring.referenceAnswer when the card has one. */
  referenceAnswer?: string;
}

export interface GradeShortAnswerBuildPartsInput {
  card: Card;
  promptBlocks: ContentBlock[];
  answer: string;
  /** Live KLPs. Absent or empty falls back to the rubric-only prompt. */
  klps?: PromptKlp[];
  relations?: PromptRelation[];
  formReqs?: PromptFormReq[];
  /** CardAuthoring.referenceAnswer when the card has one. */
  referenceAnswer?: string;
}

const RUBRIC_BODY = `For each of the following categories, provide a score (1-10), a list of pros, and a list of cons:
1. Clarity: How easy is the answer to understand?
2. Conciseness: Does the answer avoid unnecessary filler?
3. Correctness: How accurate is the answer compared to the definition?

Additionally, provide:
- Overall Score: A final weighted grade (1-10).
- Summary: A concise synthesis of the performance.
- Suggested Improvement: A specific, actionable tip to make this answer "interview-ready".

Output the result as JSON.

JSON Schema:
{
  "clarity": { "score": number, "pros": string[], "cons": string[] },
  "conciseness": { "score": number, "pros": string[], "cons": string[] },
  "correctness": { "score": number, "pros": string[], "cons": string[] },
  "overall": number,
  "summary": string,
  "suggestedImprovement": string
}`;

/**
 * Appended when live KLPs are supplied. Asks for per-KLP verdicts and
 * closed-vocabulary error tags in the SAME call as the rubric — no second AI
 * call, no window where a grade exists without its analysis. `magnitude` is
 * the model's only numeric contribution; significance is computed in TS.
 *
 * v5: the verdict paragraph is the shared block (`./verdict-block`), so the
 * runtime grader, the authoring grader and the diagnostic grader are graded
 * by ONE measured wording. Relations and form requirements are listed with
 * their own refs; the reference answer (when the card has one) sits after
 * the key points and before the learner's answer, in the authoring grader's
 * prefix order, so a provider prefix cache hits across every answer on the
 * card.
 */
/**
 * Spec 5 §3: a relation verdict and a form result carry a quote on EVERY
 * verdict, `correct` and `met` included — the opposite of the key-point rule
 * in the shared block ("omit quote on correct"). A key point's `correct` needs
 * no span; a relation's `correct` is the ONLY record of WHERE the learner
 * asserted the link, and a form requirement's `met` of where the shape was
 * satisfied, so without the quote the span Task 5 resolves is null on every
 * met relation (fix round, 2026-09-17). Rendered only when the prompt lists a
 * relation or a form requirement, so the no-relation prompt is unchanged.
 */
const QUOTE_EVERY_RELATION_FORM = 'For relations and form requirements, include "quote" on EVERY verdict, including "correct" and "met".';

const ANALYSIS_BODY = (input: { klps: PromptKlp[]; relations?: PromptRelation[]; formReqs?: PromptFormReq[]; referenceAnswer?: string }) => {
  const rel = input.relations?.length
    ? `\nRelations between key points (a link the card teaches):\n${input.relations.map((r) => `[R${r.ref}] (${r.type}) [${r.fromRef}] → [${r.toRef}]`).join('\n')}\n`
    : '';
  const form = input.formReqs?.length
    ? `\nForm requirements (the SHAPE the answer must have):\n${input.formReqs.map((f) => `[F${f.ref}] ${f.text}`).join('\n')}\n`
    : '';
  const reference = input.referenceAnswer
    ? `\nA strong reference answer, for context on what a complete response looks like (do not compare the learner's WORDING against it — judge only whether the learner's OWN claims satisfy each point):\n${input.referenceAnswer}\n`
    : '';
  return `
Key Learning Points this card teaches:
${input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')}
${rel}${form}${reference}
${verdictInstructionBlock({ strict: true, showKinds: true, vocabulary: RUNTIME_VERDICTS })}

Return:

"klpResults": one entry per key point above — { "klpRef": number, "status": verdict, "quote"?: string }.
${input.relations?.length ? `"relationResults": one entry per relation above — { "relationRef": number, "status": verdict, "quote"?: string }. "correct" = the answer asserts the link itself; "omission" = both ends present, link never made; "inversion" = link asserted backwards; "contradicted" = the answer denies it.\n` : ''}${input.formReqs?.length ? `"formResults": one entry per form requirement — { "formRef": number, "status": "met" | "not_met", "quote"?: string }.\n` : ''}${input.relations?.length || input.formReqs?.length ? `${QUOTE_EVERY_RELATION_FORM}\n` : ''}
"unwarranted": every claim the answer makes that the key points above do NOT make and that is false, misleading or invented — { "text": one sentence naming the claim, "quote": verbatim excerpt, "magnitude": 1-10 how serious this instance is }. AN ANSWER THAT COVERS EVERY KEY POINT CAN STILL BE WRONG: the points above say what must be PRESENT and nothing about what must be ABSENT, and this list is exactly what they cannot see. A clean answer returns [].

"errorTags": at most ${MAX_TAGS_PER_ANSWER} tags, at most 2 per dimension. Tag only what is genuinely wrong; a clean answer returns an empty list.
  dimension "accuracy"     — types: ${ACCURACY_TYPES.join(', ')}
  dimension "clarity"      — types: ${CLARITY_TYPES.join(', ')}
  dimension "conciseness"  — types: ${CONCISENESS_TYPES.join(', ')}
  Each tag: "type" from that dimension's list and NO other word; "klpRef" when about one point (omit for the whole answer); "secondaryKlpRef" for "conflation" only; "magnitude" 1-10 within the type; "quote".
  Every "unwarranted" claim above is ALSO tagged here, with klpRef OMITTED — it is about the whole answer, not about any one point. Do not skip it because the listed points were covered.
Rank by what matters most. Do not pad to the cap.`;
};

/**
 * Short-answer grading prompt. Registry entry per Stage 6 Task 5 — routed
 * via task 'grade' in generateJson (strongest available flash). The rubric/schema is
 * unchanged from the pre-registry version: still 1-10
 * clarity/conciseness/correctness/overall. (A learner-profile field once
 * prepended learner context here; v5 removed it — see below.)
 *
 * v2 (Stage 8 Spec 2a): when live KLPs are supplied, the SAME call also
 * returns per-KLP outcomes and closed-vocabulary error tags (ANALYSIS_BODY).
 * Without KLPs the output is byte-identical to v1 — pre-existing tests and a
 * keyless user both depend on that.
 *
 * v3 (Stage 8 Spec 3): `severity` (absolute 1-5) is replaced by `magnitude`
 * (1-10, degree within the chosen type). The band table in TS converts it to
 * severity, which keeps the model out of cross-type ranking — a judgment it
 * has no stable anchor for.
 *
 * v4 (the negative check): ANALYSIS_BODY now says explicitly that an answer
 * covering every key point can still be wrong, and that an added falsehood must
 * be tagged with `klpRef` omitted. The instruction was previously implicit —
 * "omit it when the error is about the whole answer" described the MECHANICS of
 * a whole-answer tag without ever telling the grader to look for one — and a
 * grader working through a list of points it has just marked `passed` has no
 * prompt-level reason to go looking for what the answer added.
 *
 * That silence had teeth: `klpCredit` now DOCKS key-point credit when such a
 * tag exists (`src/lib/errors/contamination.ts`), so a tag the grader never
 * emits is a dock that never happens. Measured beforehand: an answer satisfying
 * every point AND asserting something false scored full positive evidence on
 * every point, and the learner's mastery ROSE for having said something wrong.
 *
 * v5 (Spec 5 Phase A): the per-KLP vocabulary is widened from three labels to
 * RUNTIME_VERDICTS via the shared block (`./verdict-block`), so the runtime
 * grader, the authoring grader and the diagnostic grader are graded by ONE
 * measured wording — strict, and kind-aware (mechanism/condition/quantitative
 * judged on substance). The learner profile is REMOVED: the grader is a
 * stateless instrument that answers "what does this answer contain?", never
 * "what does this person know?", so it never sees the learner. The analysis
 * body now also lists the card's relations (graded with the same vocabulary),
 * its form requirements (`met | not_met`), asks for `unwarranted[]` — claims
 * the key points cannot see, each with a 1-10 magnitude — and requires
 * VERBATIM quotes so TypeScript can resolve spans. With KLPs, the learner's
 * answer moves to the END of the prompt — shared material (card, rubric, key
 * points, relations, form requirements, reference, verdict block) first, the
 * answer last, in the authoring grader's prefix order, so a provider prefix
 * cache hits across every answer on the card. The rubric block and the no-KLP
 * path are byte-identical to v4.
 */
export const GRADE_SHORT_ANSWER_PROMPT = {
  id: 'grade-short-answer',
  version: 5,
  schema: ShortAnswerGradeSchema,

  build(input: GradeShortAnswerBuildInput): string {
    if (input.klps && input.klps.length > 0) {
      return `You are a finance interview grader. Grade the following short-answer response.

Term: ${input.card.term}
Expected Definition: ${input.card.definition}

${RUBRIC_BODY}${ANALYSIS_BODY({ ...input, klps: input.klps })}

User Answer: "${input.answer}"`;
    }

    return `You are a finance interview grader. Grade the following short-answer response.

Term: ${input.card.term}
Expected Definition: ${input.card.definition}
User Answer: "${input.answer}"

${RUBRIC_BODY}`;
  },

  buildParts(input: GradeShortAnswerBuildPartsInput): { parts: any[]; promptText: string } {
    const mediaNote = input.promptBlocks.some((b) => b.type !== 'text') ? '[The question material is shown above/below as images, audio, video, etc.]' : '';

    const promptText = input.klps && input.klps.length > 0
      ? `You are a finance interview grader. Grade the following short-answer response.

${mediaNote}

Expected Definition: ${input.card.definition}

${RUBRIC_BODY}${ANALYSIS_BODY({ ...input, klps: input.klps })}

User Answer: "${input.answer}"`
      : `You are a finance interview grader. Grade the following short-answer response.

${mediaNote}

Expected Definition: ${input.card.definition}
User Answer: "${input.answer}"

${RUBRIC_BODY}`;

    return { parts: [{ text: promptText }], promptText };
  },
};
