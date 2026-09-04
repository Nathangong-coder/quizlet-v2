import { ReviseKlpsSchema, KLP_KINDS } from '@/lib/ai/schemas';
import { MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config';

export interface ReviseKlpsBuildInput {
  question: string;
  klps: { text: string; kind: string }[];
  /** Call B's discrimination result, per KLP, in the KLPs' own order. */
  discrimination: {
    index: number;
    passesReference: boolean;
    failsSomeWrong: boolean;
    discriminates: boolean;
  }[];
  /**
   * The card's adaptive KLP target (`src/lib/klp/sizing.ts`), passed through
   * from call A so revision cannot silently undo the sizing decision. Without
   * it this prompt stated a fixed range, and a revision that cut two useless
   * KLPs would leave a card sized for four holding two, with nothing saying it
   * had shrunk below what the definition needed.
   */
  targetCount: number;
}

/**
 * Call C of the authoring pipeline. Runs when `computeSeparation` says the
 * current KLPs did not separate the reference from the best wrong answer —
 * see `src/lib/klp/separation.ts`.
 *
 * The failing matrix is handed back so the model can see EXACTLY which KLPs
 * carried no information, rather than being asked to critique its own work
 * from scratch. A KLP that fires identically on the strong and every weak
 * answer is not wrong, it is USELESS — it is true of everyone, so it
 * separates nobody. The usual fix is to split a vague point into the
 * specific claims it was hiding, not to throw it away.
 */
export const REVISE_KLPS_PROMPT = {
  id: 'revise-klps',
  version: 2,
  schema: ReviseKlpsSchema,

  build(input: ReviseKlpsBuildInput): string {
    const rows = input.klps
      .map((k, i) => {
        const d = input.discrimination.find((r) => r.index === i);
        const status = d?.discriminates
          ? 'DISCRIMINATES — keep as is'
          : !d?.passesReference
            ? 'FAILS ON THE REFERENCE — the reference answer itself does not support this claim; it may be hallucinated, or too specific to what the reference happens to say'
            : 'CARRIES NO INFORMATION — every wrong answer also satisfies it';
        return `[${i}] (${k.kind}) ${k.text}\n    ${status}`;
      })
      .join('\n');

    return `You wrote Key Learning Points (KLPs) for this question, and they were tested against a strong answer and three deliberately wrong answers. Some did not discriminate — a wrong answer scored as well on them as the strong one did.

Question: ${input.question}

Current KLPs, each with its test result:
${rows}

Fix ONLY the KLPs marked "CARRIES NO INFORMATION" or "FAILS ON THE REFERENCE". A KLP that passes on every answer, right or wrong, is not wrong — it is USELESS, because it separates nobody. The usual fix is to SPLIT a vague point into the specific claims it was hiding, so each half can independently pass or fail. A KLP that fails on the reference should be cut or rewritten to match what the reference answer actually says.

Leave the KLPs marked "DISCRIMINATES" alone — they already earned their place.

Aim for ${input.targetCount}-${MAX_KLPS_AUTHORED} KLPs total after revision — the same target this card was sized for, not a quota. If splitting a useless point into its specific claims takes you above it, that is the right outcome; if honestly cutting one takes you below it, say the fewer true things rather than padding.
kind: one of ${KLP_KINDS.join(', ')}.

Output JSON:
{ "klps": [ { "text": string, "kind": string } ] }
Return the FULL revised set, not only the changed entries.`;
  },
};
