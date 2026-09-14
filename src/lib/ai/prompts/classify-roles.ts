import { z } from 'zod';

/**
 * FRAMING, JUDGED (2026-09-13, owner).
 *
 * The rule in `src/lib/klp/framing.ts` — a definition/contrast point the
 * template trap recited — was too narrow. On "WACC 6%, acquirer 10%, yield
 * 8%": "the 8% yield is below the 10% funding cost" is a quantitative point
 * and "the effective cost of funding is the acquirer's 10% WACC" is a
 * condition, so neither could be framing by kind, yet both are things a
 * template PLUGS IN from the question — a factual comparison of two given
 * numbers, a given restated. Any prepared candidate states them without
 * understanding anything, so they cannot tell a strong answer from a
 * rehearsed one, and counting them against separation punishes the points
 * for the question's shape.
 *
 * The owner's instruction: "the model should not just use it as a hard test
 * but really be more subjective and judgemental, overriding my general rule".
 * So a grader-family model reads the question, the owner's definition and the
 * numbered points and labels each one; its label WINS over the rule. The
 * rule remains the fallback when no classifier is wired.
 *
 * The labels also decide a card-level status: when at least
 * `MEMORIZABLE_FRAMING_SHARE` of the points are framing, the card is
 * `memorizable` — a question a template answers — and its separation is not
 * a defect to revise for (src/lib/klp/framing.ts).
 */

export const POINT_ROLES = ['framing', 'substance'] as const;

export const RoleClassificationSchema = z.object({
  points: z.array(
    z.object({
      index: z.number().int().min(0),
      role: z.enum(POINT_ROLES),
      /** One clause; shown to the owner, never computed on. */
      reason: z.string().optional(),
    }),
  ),
});

export type RoleClassification = z.infer<typeof RoleClassificationSchema>;

export interface ClassifyRolesBuildInput {
  question: string;
  definition: string;
  klps: { text: string; kind: string }[];
}

export const CLASSIFY_ROLES_PROMPT = {
  id: 'classify-roles',
  version: 1,
  schema: RoleClassificationSchema,

  build(input: ClassifyRolesBuildInput): string {
    const points = input.klps.map((k, i) => `[${i}] (${k.kind}) ${k.text}`).join('\n');
    return `You are judging, for each key point of a finance interview answer, whether a candidate who had merely MEMORIZED a template for this kind of question would state it correctly anyway. Use judgement, not a rule.

Question: ${input.question}

The card owner's definition:
${input.definition}

Key points:
${points}

Label each point:
- "framing": any prepared candidate says this regardless of understanding. Definitions of the term the question names; a given from the question restated ("the acquirer's WACC is 10%"); a direct comparison of two numbers the question supplies ("8% is below 10%") — plugging in numbers is not understanding; the label of the conclusion ("the deal is dilutive") when the numbers make it mechanical; the standard contrast every template opens or closes with ("accretion is not value creation").
- "substance": stating it correctly requires understanding — a mechanism (why the number moves), a condition and its consequence, which benchmark applies and why, a non-obvious comparison, an implication the question does not hand over, a common misconception avoided.

Be judgemental: if you can picture a rehearsed candidate producing the sentence without knowing why it is true, it is framing. A card whose points are mostly framing is a memorizable question, and that is a fair thing to find.

Output JSON: { "points": [ { "index": number, "role": "framing" | "substance", "reason": string } ] }
One entry per point, "reason" one short clause.`;
  },
};
