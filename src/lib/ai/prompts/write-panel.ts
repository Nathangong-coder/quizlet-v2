import { PanelSchema } from '@/lib/ai/schemas';
import { PANEL_LEVELS, PANEL_LEVEL_LABELS } from '@/lib/klp/panel';

export interface WritePanelBuildInput {
  question: string;
  /** The strong answer the key points were derived from — the target for L4. */
  referenceAnswer: string;
}

/**
 * Writes the five-level competence panel (build item 4).
 *
 * ## It never sees the key points, and that is the whole design
 *
 * The panel is written from the QUESTION and the reference answer only. If the
 * model could see the key points, it would write answers that hit or miss them
 * on purpose — and the panel would then measure how well the model followed an
 * instruction, not whether the key points discriminate. Every number computed
 * from a panel written against the key points is circular.
 *
 * This is the same reason `grade-candidate.ts` withholds provenance from the
 * grader, applied at the other end of the pipeline.
 *
 * ## Why competence levels and not failure kinds
 *
 * The three archetypes this replaces (`confident_wrong`, `vague`,
 * `memorized_template`) name three ways of being WRONG, and leave the space
 * between right and wrong empty. Measured across 130 authoring runs, the
 * rank-based AUC is 1.000 on 129: the reference outscores every adversary every
 * time, so the discrimination test is saturated and cannot tell a sharp
 * key-point set from an adequate one.
 *
 * **L3 is the load-bearing member.** It is the near-miss that does not
 * currently exist — a genuinely good answer with one real gap. A key-point set
 * that cannot tell L3 from L4 is too coarse; one that fails L3 outright is too
 * strict. Neither is visible without it.
 *
 * L3 is therefore also the hardest to write, and the prompt spends most of its
 * words there. A model left to itself writes L3 as a slightly shorter L4, which
 * collapses the pair and wastes the call.
 */
export const WRITE_PANEL_PROMPT = {
  id: 'write-panel',
  version: 1,
  schema: PanelSchema,

  build(input: WritePanelBuildInput): string {
    const levels = PANEL_LEVELS.map((l) => `- ${l}: ${PANEL_LEVEL_LABELS[l]}`).join('\n');

    return `Write five answers to one interview question, at five different levels of competence. They will be used to test whether a grading rubric can tell those levels apart.

Question: ${input.question}

A strong answer, for reference:
${input.referenceAnswer}

Write one answer at each level:
${levels}

WHAT EACH LEVEL MEANS IN PRACTICE:

L4 — what a strong candidate actually says. Complete and precise. It may be phrased differently from the reference above; do not copy it.

L3 — THE HARDEST ONE AND THE MOST IMPORTANT. A genuinely good answer that a fair interviewer would still not call complete. It gets the main mechanism right and then has ONE real weakness: it omits a step, states a direction correctly but the magnitude vaguely, misses a condition, or stops one inference short. It must NOT be a shortened L4, and it must NOT contain an outright error — that is L1. Someone reading L3 alone should think "yes, mostly right, but they missed something."

L2 — has the shape of an answer without the substance. Names the right concepts, does not connect them. Nothing clearly false, nothing clearly demonstrated.

L1 — engages with the question and gets it wrong. A confident, specific, incorrect claim about this topic.

L0 — does not answer this question. Either answers a neighbouring question, or says essentially nothing.

RULES:
- Each answer must be plausible as something a real person would say, at that level. Do not write a caricature.
- Write them at comparable LENGTH. A grader that can tell the levels apart by word count alone has learned nothing about the content, and a long L4 beside a one-line L2 teaches it exactly that.
- The five must be genuinely ordered. If you cannot tell your L3 from your L4, rewrite L3 with a specific weakness.

Output JSON:
{ "members": [ { "level": "${PANEL_LEVELS.join('" | "')}", "text": string, "weakness": string } ] }

"weakness": one sentence naming what this answer lacks compared with the level above it. For L4, what a perfect answer would add.`;
  },
};
