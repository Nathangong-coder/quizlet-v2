import { z } from 'zod';
import { STRICT_GRADING_CLAUSE } from './grade-candidate';

/**
 * The REBUILD TEST (design: docs/superpowers/specs/2026-09-12-rebuild-test-design.md).
 *
 * Three prompts, three roles, replacing the circular reference score — where
 * the key points were graded against the very answer they were extracted
 * from, and a set that omitted a concept scored 1.00 because its source did.
 *
 *   rebuild   — a model from a different family than the writer answers the
 *               question from the key points ALONE. Never the reference, never
 *               the card's definition ("not fair" — the owner). If the points
 *               are sufficient the rebuild is a strong answer; if they are
 *               steps rather than propositions, or missing a concept, it shows.
 *   coverage  — the rebuild graded against the CARD's own definition points,
 *               the only content a human vetted. This is the rubric.
 *   parity    — the rebuild graded against the writer's reference: what the
 *               writer knew that never made it into a key point.
 *
 * Every score is computed in TypeScript from these categorical verdicts
 * (`src/lib/klp/rebuild.ts`); the model never assigns a number.
 */

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

export const RebuildSchema = z.object({
  rebuiltAnswer: z.string().min(1),
});

export interface RebuildBuildInput {
  question: string;
  klps: { text: string }[];
}

export const WRITE_REBUILD_PROMPT = {
  id: 'write-rebuild',
  // v2 (2026-09-13): say each point once, no transitions or restated
  // conclusion — otherwise the rebuild adds words the points never carried,
  // and the compression review would be editing the wrong thing.
  version: 2,
  schema: RebuildSchema,

  build(input: RebuildBuildInput): string {
    const points = input.klps.map((k, i) => `[${i}] ${k.text}`).join('\n');
    return `Answer a finance interview question using ONLY the key points below. They are the complete list of claims you may make.

Question: ${input.question}

Key points:
${points}

Write the answer a strong candidate would give if these points were everything they knew: order them as the answer should flow and phrase them as spoken prose. Say each point ONCE, in the fewest words that keep its claim. No roadmap sentences, no transitions that carry no claim, no restated conclusion — if a point already lands the conclusion, do not land it again. The answer should be about the length of the points combined, not longer. You may reorder and reword. You may NOT add a claim, a number, a mechanism or an example that is not in the points, and you may not leave a point out. If the points do not answer the question fully, the answer should read as incomplete — do not fill the gap.

Output JSON: { "rebuiltAnswer": string }`;
  },
};

// ---------------------------------------------------------------------------
// coverage — against the card's own points, with the dispute channel
// ---------------------------------------------------------------------------

export const COVERAGE_VERDICTS = ['correct', 'partial', 'missing'] as const;
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export const CoverageSchema = z.object({
  points: z.array(
    z.object({
      index: z.number().int().min(0),
      verdict: z.enum(COVERAGE_VERDICTS),
      evidence: z.string().optional(),
    }),
  ),
  /**
   * The override channel. Recorded only when the grader judges the ANSWER
   * right and the CARD wrong on a specific point. Surfaced to the set owner
   * as a warning; never changes a score, never edits the card.
   */
  disputes: z
    .array(
      z.object({
        index: z.number().int().min(0),
        cardSays: z.string(),
        answerSays: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
});

export interface CoverageBuildInput {
  question: string;
  definitionPoints: { point: string }[];
  rebuiltAnswer: string;
  strict?: boolean;
}

export const GRADE_COVERAGE_PROMPT = {
  id: 'grade-coverage',
  version: 1,
  schema: CoverageSchema,

  build(input: CoverageBuildInput): string {
    const points = input.definitionPoints.map((p, i) => `[${i}] ${p.point}`).join('\n');
    return `A flashcard's owner wrote a definition for this question. It was split into the points below. A candidate's answer follows. Judge, point by point, whether the ANSWER establishes each point the card makes.

Question: ${input.question}

The card's points (the owner's own content — treat as the rubric):
${points}

The answer:
${input.rebuiltAnswer}

For each card point: "correct" if the answer states it or clearly entails it; "partial" if the answer gestures at it without the substance; "missing" if the answer does not cover it. Judge substance, not wording. An answer may say MORE than the card — extra content is not penalised here. "evidence" is ONE short clause (at most 15 words); omit it when the verdict is "correct".

DISPUTES — rarely, the answer will contradict a card point and the ANSWER will be right. Only then, add an entry to "disputes" naming the point, what the card says, what the answer says, and why the answer is correct. This is a warning to the card's owner, not a correction: do not soften the verdict on that point, and do not raise a dispute for a difference of emphasis or completeness. Leave "disputes" empty in the normal case.

Output JSON:
{
  "points": [ { "index": number, "verdict": "correct" | "partial" | "missing", "evidence": string } ],
  "disputes": [ { "index": number, "cardSays": string, "answerSays": string, "reason": string } ]
}${input.strict ? `\n\n${STRICT_GRADING_CLAUSE.replace('key point', 'card point')}` : ''}`;
  },
};

// ---------------------------------------------------------------------------
// parity — against the writer's reference
// ---------------------------------------------------------------------------

export const PARITY_VERDICTS = ['present', 'partial', 'absent'] as const;
export type ParityVerdict = (typeof PARITY_VERDICTS)[number];

export const ParitySchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string().min(1),
      verdict: z.enum(PARITY_VERDICTS),
    }),
  ),
});

export interface ParityBuildInput {
  question: string;
  referenceAnswer: string;
  rebuiltAnswer: string;
  strict?: boolean;
}

export const GRADE_PARITY_PROMPT = {
  id: 'grade-parity',
  version: 1,
  schema: ParitySchema,

  build(input: ParityBuildInput): string {
    return `Two answers to the same finance interview question. The FIRST is a full reference answer. The SECOND was rebuilt from a list of key points extracted from the first. Find what the rebuild lost.

Question: ${input.question}

Reference answer:
${input.referenceAnswer}

Rebuilt answer:
${input.rebuiltAnswer}

First list every distinct substantive claim the reference makes — each fact, mechanism, number or distinction a grader could mark right or wrong, one per entry, in the reference's own order. Then for each claim say whether the rebuild makes it: "present" (stated or clearly entailed), "partial" (mentioned without the substance), or "absent". Judge substance, not wording.

Output JSON: { "claims": [ { "claim": string, "verdict": "present" | "partial" | "absent" } ] }${input.strict ? `\n\n${STRICT_GRADING_CLAUSE.replace('key point', 'claim')}` : ''}`;
  },
};
