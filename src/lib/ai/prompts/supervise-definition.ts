import { DefinitionSupervisionSchema } from '@/lib/ai/schemas';

export interface SuperviseDefinitionBuildInput {
  question: string;
  /** The card's own definition — the owner's vetted content, however terse. */
  definition: string;
  referenceAnswer: string | null;
  klps: { ref: number; text: string; kind: string; weight: number; loadBearing?: boolean }[];
  /** The grader's verdict on the DEFINITION per key point, with the quote it cited. */
  graderVerdicts: { ref: number; status: string; quote?: string }[];
  /** The content score TypeScript computed, 0-100, for the supervisor's orientation only. */
  score: number;
}

/**
 * THE DEFINITION-PROBE SUPERVISOR (2026-09-18, owner's ask) — authoring-side,
 * never the runtime. When a card's own definition scores below the pass line
 * against its key points, a second reader decides, POINT BY POINT, whose
 * fault it is: the point (it grew past what the card says, or is not on the
 * card), the grader (the definition does make the point and the verdict was
 * harsh), or the card (the definition genuinely omits it — a fair point the
 * owner may want to know about).
 *
 * The vocabulary is closed and the decision is TypeScript's
 * (`supervisionDecision`): any `narrow`/`cut` starts a revision; all `keep`
 * across two supervising passes on different models escalates to the set
 * author. The supervisor is told the definition is the owner's vetted content
 * and that terseness is not a defect — the same rule the note-form grading
 * clause gives the grader — so "the card should have said more" is `keep`,
 * never `narrow`.
 */
export const SUPERVISE_DEFINITION_PROMPT = {
  id: 'supervise-definition',
  // v2 (2026-09-18): the worked example moved off an LBO card that the probe
  // itself grades — a prompt must not carry the answer to one of its cases.
  // v3 (2026-09-19): points that SEPARATE a wrong answer are marked; the
  // supervisor is told they are load-bearing and that TypeScript will read a
  // narrow/cut on one as keep — so its honest verdict there is keep or
  // grader_wrong, and the card, not the point, is what gets questioned.
  version: 3,
  schema: DefinitionSupervisionSchema,
  build(input: SuperviseDefinitionBuildInput): string {
    const klps = input.klps.map((k) => `[${k.ref}] (${k.kind}, weight ${k.weight}${k.loadBearing ? ', LOAD-BEARING' : ''}) ${k.text}`).join('\n');
    const anyLoadBearing = input.klps.some((k) => k.loadBearing);
    const verdicts = input.graderVerdicts.map((v) => `[${v.ref}] ${v.status}${v.quote ? ` — "${v.quote}"` : ''}`).join('\n');
    return `You supervise the key points written for a flashcard. The card's owner wrote a terse definition; a writer expanded it into a reference answer and a list of key points; a grader then graded THE OWNER'S OWN DEFINITION against those key points and it scored ${input.score}/100 — below the pass line. Decide, one key point at a time, whose fault that is.

The owner's definition is the vetted content. It is terse by nature — bullet points, keyword phrases, no full sentences — and terseness is NOT a defect: a point the definition makes in three words is made. A key point may legitimately be MORE than the definition only when a strong spoken answer to this question could not be given without it; otherwise the definition is the ceiling of what the key points may test.

Question: ${input.question}
Owner's definition: ${input.definition}
${input.referenceAnswer ? `Writer's reference answer: ${input.referenceAnswer}\n` : ''}
Key points:
${klps}

The grader's verdict on the OWNER'S DEFINITION, per key point:
${verdicts}

For EVERY key point, return { "klpRef": number, "verdict": one of the four below, "reason": one sentence quoting the definition's words where they bear on it, "wording": string or null }:
- "keep" — the definition genuinely does not make this point, and the point is fair for this question. "wording" null.
- "narrow" — the definition makes this claim but the point expanded it past what the card says (added detail, a mechanism, a list the card does not give). "wording" = the point rewritten to test exactly what the definition states, in one sentence.
- "cut" — the point is not on the card at all and a strong answer does not need it. "wording" null.
- "grader_wrong" — the definition DOES make this point, in its own compressed way, and the verdict was too harsh. "wording" null.

${anyLoadBearing ? `A point marked LOAD-BEARING is one that a deliberately wrong answer FAILS while the reference passes it — it is what separates a real answer from a recited one. Narrowing or cutting it would flatten the card, so it will be read as "keep" whatever you say; on such a point your honest choices are "keep" (the definition omits it — the card is thin there) or "grader_wrong" (the definition does make it).\n\n` : ''}Do not soften: a definition that says "depreciation is added back" does not make a point about "straight-line depreciation over the asset's useful life" (that is "narrow"); a definition that says "(non-cash)" DOES make the point that the charge involves no cash outflow (that is "grader_wrong" if the grader marked it partial). Then "summary": one sentence on whether the points outgrew the card, the grader misread it, or the card is thin.

Output JSON: { "points": [ { "klpRef": number, "verdict": string, "reason": string, "wording": string | null } ], "summary": string }`;
  },
};
