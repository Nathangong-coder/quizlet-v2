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
  /**
   * Named findings from the quality bar (2026-09-12), each with the fix the
   * model is asked to make. Absent on the legacy separation-only trigger.
   */
  findings?: { index: number | null; issue: string; fix: string }[];
  /** Card-level line explaining why this revision was triggered. */
  reason?: string;
  /**
   * Per-point roles from `src/lib/klp/framing.ts`. A `framing` point is a
   * definition/contrast the template answer recites; it is rendered as such
   * and the model is told to leave it — without this it would read as
   * CARRIES NO INFORMATION and be "tightened" into something that is no
   * longer a definition. Absent means every point is substance.
   */
  roles?: ('framing' | 'substance')[];
  /**
   * The parity grader's decomposition of the reference — every claim it
   * found, present in the points or not. Passed when a round carries a
   * compression finding, so the grader objects BEFORE a cut: each of these
   * must still be stated by some point after the edit (2026-09-13).
   */
  mustKeep?: string[];
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
  // v4 (2026-09-13): the compression precedence rule.
  version: 4,
  schema: ReviseKlpsSchema,

  build(input: ReviseKlpsBuildInput): string {
    const findingsFor = (i: number) => (input.findings ?? []).filter((f) => f.index === i);
    const rows = input.klps
      .map((k, i) => {
        const d = input.discrimination.find((r) => r.index === i);
        const lines: string[] = [];
        if (input.roles?.[i] === 'framing')
          lines.push('FRAMING — a definition or contrast any prepared candidate states; it is not expected to separate answers. Keep it as a clean, correct statement; do not tighten, split or cut it');
        else if (d?.discriminates) lines.push('DISCRIMINATES — keep as is unless a finding below says otherwise');
        else if (!d?.passesReference)
          lines.push('FAILS ON THE REFERENCE — the reference answer itself does not support this claim; it may be hallucinated, or too specific to what the reference happens to say');
        else lines.push('CARRIES NO INFORMATION — every wrong answer also satisfies it');
        for (const f of findingsFor(i)) lines.push(`${f.issue.toUpperCase()} — ${f.fix}`);
        return `[${i}] (${k.kind}) ${k.text}\n    ${lines.join('\n    ')}`;
      })
      .join('\n');
    const setLevel = (input.findings ?? []).filter((f) => f.index === null);
    const setLines = setLevel.length
      ? `\nWhole-set findings:\n${setLevel.map((f) => `  ${f.issue.toUpperCase()} — ${f.fix}`).join('\n')}\n`
      : '';
    const reason = input.reason ? `\nWhy this revision: ${input.reason}\n` : '';
    const keep = input.mustKeep && input.mustKeep.length
      ? `\nClaims the reference makes — EVERY one must still be stated by some key point after your edit (merge and shorten freely, but none of these may disappear):\n${input.mustKeep.map((c) => `  - ${c}`).join('\n')}\n`
      : '';

    return `You wrote Key Learning Points (KLPs) for this question, and they were tested against a strong answer and three deliberately wrong answers, then checked by rule. Each KLP below carries its test result and any named finding.

Question: ${input.question}
${reason}
Current KLPs, each with its findings:
${rows}
${setLines}${keep}
Fix ONLY the KLPs that carry a finding — "CARRIES NO INFORMATION", "FAILS ON THE REFERENCE", or a named rule such as COMPOUND or RESTATEMENT — and do exactly what the finding asks. A KLP that passes on every answer, right or wrong, is not wrong — it is USELESS, because it separates nobody. The usual fix is to SPLIT a vague point into the specific claims it was hiding, so each half can independently pass or fail. A KLP that fails on the reference should be cut or rewritten to match what the reference answer actually says.

Leave a KLP with no finding alone — it already earned its place. Do not reword it, reorder it, or fold it into another. A KLP marked FRAMING is kept for the same reason: it is judged on being a correct definition or contrast, not on separating answers.

CUT WORDS, NEVER DISTINCT CLAIMS. A RESTATEMENT, CLAUSE BLOAT or VERBOSE finding asks you to merge or shorten — do that — but every claim a parity or coverage finding names must survive as a point, and a point you shorten must still state its claim in full. When a compression finding and a coverage finding touch the same point, the claim wins and the words go.

Aim for ${input.targetCount}-${MAX_KLPS_AUTHORED} KLPs total after revision — the same target this card was sized for, not a quota. If splitting a useless point into its specific claims takes you above it, that is the right outcome; if honestly cutting one takes you below it, say the fewer true things rather than padding.
kind: one of ${KLP_KINDS.join(', ')}.

Output JSON:
{ "klps": [ { "text": string, "kind": string } ] }
Return the FULL revised set, not only the changed entries.`;
  },
};
