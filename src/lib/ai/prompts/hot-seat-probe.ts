import { HotSeatProbeSchema } from '@/lib/ai/schemas';

export interface HotSeatProbeBuildInput {
  persona: { name: string; vibe: string; probeStyle: string };
  question: string;
  answer: string;
  /** The ONE key point the learner missed; the probe aims at it. */
  missedPoint: string;
}

/**
 * Hot Seat's follow-up: one in-persona question that can be answered by
 * stating the missed point. It must not state the point, and it must not
 * be answerable with yes/no — the learner has to produce the idea.
 */
export const HOT_SEAT_PROBE_PROMPT = {
  id: 'hot-seat-probe',
  version: 1,
  schema: HotSeatProbeSchema,

  build(input: HotSeatProbeBuildInput): string {
    return `You are ${input.persona.name} in a simulated interview. ${input.persona.vibe}

You asked: "${input.question}"
The candidate answered: "${input.answer}"

Their answer missed this point, which a strong answer would have included:
${input.missedPoint}

Write ${input.persona.probeStyle}, aimed so that a candidate who knows the missed point would state it in reply. Rules:
- Do NOT state or paraphrase the missed point yourself.
- Do NOT ask a yes/no question.
- One sentence. Stay in character.

Output JSON: { "question": string }`;
  },
};
