import { z } from 'zod';
import { PROBE_KINDS } from '@/lib/klp/authoring-config';

export interface WriteAdversariesBuildInput {
  question: string;
  referenceAnswer: string;
}

/**
 * The three wrong answers, written by a model that did NOT write the key
 * points and is not shown them. Rotation mode (2026-09-12) uses this instead
 * of the adversaries the author call produces.
 *
 * Why a separate model and a separate call: an adversary written alongside the
 * key points is written to fail THOSE points, and grades as if the points
 * discriminate whether or not they do. An adversary written from the question
 * and the reference alone fails whatever a wrong candidate would actually get
 * wrong — which is the thing the key points are supposed to catch. The three
 * archetypes are the same ones `AUTHOR_KLPS_PROMPT` defines, so `PROBE_KINDS`,
 * `separation.ts` and the stored `AuthoringProbe.kind` are unchanged.
 */
export const WriteAdversariesSchema = z.object({
  wrongAnswers: z
    .array(z.object({ kind: z.enum(PROBE_KINDS), text: z.string().min(1) }))
    .length(PROBE_KINDS.length)
    .refine((arr) => new Set(arr.map((w) => w.kind)).size === arr.length, {
      message: 'wrongAnswers must cover each archetype exactly once, with no duplicates',
    }),
});

export const WRITE_ADVERSARIES_PROMPT = {
  id: 'write-adversaries',
  version: 1,
  schema: WriteAdversariesSchema,

  build(input: WriteAdversariesBuildInput): string {
    return `You are writing WRONG answers to a finance interview question, to test whether a grading rubric can tell a strong answer from a plausible weak one. You are not shown the rubric. Write the answers a real candidate would give.

Question: ${input.question}

A strong answer, for context on what complete looks like (your wrong answers must NOT restate it — they must fall short of it in the specific ways below):
${input.referenceAnswer}

Write EXACTLY THREE wrong answers, one per archetype, each 3-6 sentences, each sounding like a genuine attempt:
- confident_wrong: articulate and structured, but wrong on the substance — a candidate who is sure of themselves and has a real misconception (state the misconception, do not merely omit things).
- vague: refuses to commit to specifics; gestures at the right area without stating the actual claims a strong answer makes.
- memorized_template: the shape and vocabulary of a strong answer — the structure a template gives you — with no real substance underneath.

Output JSON:
{ "wrongAnswers": [ { "kind": "confident_wrong" | "vague" | "memorized_template", "text": string } ] }
The three entries must cover exactly ${PROBE_KINDS.join(', ')}, one each.`;
  },
};
