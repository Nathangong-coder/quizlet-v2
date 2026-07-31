import { learnerContextBlock } from './shared';
import { SessionInsightAiSchema, MAX_FOCUS_AREAS } from '@/lib/memory/insight';
import type { SessionComputed } from '@/lib/memory/summarize';

export interface SessionInsightBuildInput {
  setTitle: string;
  /** "quiz" | "matching" | "confidence" */
  kind: string;
  computed: SessionComputed;
  profileBlock?: string;
}

function ms(value: number | null): string {
  return value === null ? 'not measured' : `${Math.round(value / 100) / 10}s`;
}

/**
 * Whole-session coaching. Replaces QUIZ_SUMMARY_PROMPT, which asked for one
 * free-text paragraph and was regenerated on every render.
 *
 * The model receives ONLY the deterministic `computed` block and returns ranked
 * focus areas plus a strengths narrative. It never computes a statistic — that
 * keeps the Stage 6 rule ("AI reads mastery, never calculates it") intact and
 * keeps every number in the UI traceable to `summarizeSession`.
 *
 * Routed via task 'grade' in generateJson.
 */
export const SESSION_INSIGHT_PROMPT = {
  id: 'session-insight',
  version: 1,
  schema: SessionInsightAiSchema,

  build(input: SessionInsightBuildInput): string {
    const { computed } = input;

    const categories = computed.byCategory
      .map((c) => `- ${c.name}: ${c.correct}/${c.total} correct (${c.accuracyPct}%)`)
      .join('\n') || '- none recorded';

    const modes = computed.byMode
      .map(
        (m) =>
          `- ${m.mode}: ${m.correct}/${m.total} correct` +
          (m.avgScore !== null ? `, avg score ${m.avgScore}/100` : '') +
          `, median time ${ms(m.medianLatencyMs)}`,
      )
      .join('\n') || '- none recorded';

    const rushed = computed.outliers.rushed
      .map((o) => `- ${o.term} (answered in ${ms(o.latencyMs)} and got it wrong)`)
      .join('\n') || '- none';

    const laboured = computed.outliers.laboured
      .map((o) => `- ${o.term} (took ${ms(o.latencyMs)} and still got it wrong)`)
      .join('\n') || '- none';

    const dropped = computed.confidence.dropped.map((c) => c.term).join(', ') || 'none';
    const mastered =
      computed.confidence.newlyMastered.map((c) => c.term).join(', ') || 'none';

    return `${learnerContextBlock(input.profileBlock)}You are a study coach reviewing one completed study session.

Set: ${input.setTitle}
Activity: ${input.kind}
Items: ${computed.itemCount}
Median time per item: ${ms(computed.pacing.medianLatencyMs)}
Average confidence change: ${computed.confidence.avgDelta ?? 'not measurable'}

Accuracy by category:
${categories}

Accuracy by question mode:
${modes}

Answered too fast and got wrong:
${rushed}

Laboured over and still got wrong:
${laboured}

Newly mastered: ${mastered}
Confidence dropped: ${dropped}

Every figure above is already computed. **Do not calculate, restate, or invent
any statistic** — cite the numbers given, and only those.

Return up to ${MAX_FOCUS_AREAS} focus areas, ranked most important first. Each must:
- name a specific concept or habit (not "study more")
- cite the evidence above that justifies it
- give one concrete action the learner can take next
- list the cardIds it relates to, drawn only from the session

Also write a short "strengths" note on what genuinely went well. If nothing did,
say so plainly rather than inventing praise.`;
  },
};
