import { z } from 'zod';

/**
 * ROUND-TRIP RECOVERY (2026-09-15) — the leaf analogue of the reference
 * score. A grader is shown ONLY the card's minted labels (leaf names and the
 * relations, as "from → to") and the KLPs, and assigns each point to the
 * label it belongs to. The share assigned back to the label that minted it
 * is how well the names describe their points; a point that wanders to a
 * sibling says the two names are not distinct, and a point assigned to
 * nothing says its label does not describe it.
 *
 * The grader never sees which label minted which point — that is the whole
 * test — and the labels are shuffled so position carries nothing.
 */
export const RoundTripSchema = z.object({
  assignments: z.array(
    z.object({
      klpRef: z.number().int().min(0),
      /** A label exactly as listed, or null when no label fits. */
      label: z.string().nullable(),
    }),
  ),
});
export type RoundTripResult = z.infer<typeof RoundTripSchema>;

export interface RoundTripBuildInput {
  question: string;
  klps: { text: string }[];
  /** Labels in the order shown; the caller shuffles. */
  labels: string[];
}

export const ROUNDTRIP_ASSIGN_PROMPT = {
  id: 'roundtrip-assign',
  version: 1,
  schema: RoundTripSchema,

  build(input: RoundTripBuildInput): string {
    const labels = input.labels.map((l) => `  - ${l}`).join('\n');
    const points = input.klps.map((k, i) => `[${i}] ${k.text}`).join('\n');
    return `A flashcard's key points were each filed under one topic label. You see the labels and the points, but not which point was filed where. File each point under the ONE label that names what it is about. A label written as "A → B" names a link between A and B; file a point there only when the point is about that link. If no label fits a point, give null — do not force it.

Output JSON: { "assignments": [ { "klpRef": number, "label": string | null } ] }
One entry per point, label copied exactly as listed.

Question: ${input.question}

Labels:
${labels}

Points:
${points}`;
  },
};

/** Deterministic shuffle so a run is reproducible from its seed. */
export function shuffleLabels(labels: string[], seed: number): string[] {
  const out = [...labels];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
