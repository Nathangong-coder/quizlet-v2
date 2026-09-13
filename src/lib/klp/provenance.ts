/**
 * Where a live `CardKlp` row came from, as one pure rule.
 *
 * THREE provenances, and every report over the corpus has to separate them or
 * it answers nothing. `npm run klp-histogram` established the split and its
 * reasoning; this module exists so the exploit report (`npm run klp-exploit`)
 * uses the SAME rule rather than a second copy of it. Two definitions of
 * "authored" that drift apart would make two reports over one corpus disagree
 * about which slice they were measuring — a defect that reads as a real
 * finding.
 *
 * The rule, unchanged from the histogram:
 *
 *  - **authored** — a `CardAuthoring` run exists for this card AT THIS KLP
 *    VERSION. Version equality is load-bearing: a card authored once and then
 *    re-extracted by the legacy path has an authoring row AND legacy KLPs, and
 *    matching on `cardId` alone would credit the pipeline with weights and
 *    key points it never computed.
 *  - **reused** — no authoring run at this version, but `promptVersion >= 2`.
 *    `npm run reuse-klps` copies discrimination-tested key points onto a card
 *    byte-identical to one already authored, and deliberately writes NO
 *    authoring row (duplicating it would count one run once per duplicate).
 *    Those rows carry the donor's `promptVersion`, which is how they are told
 *    apart from legacy without a schema change.
 *  - **legacy** — the single-pass extractor (`promptVersion` 1), where the
 *    model assigned the weight itself. This is the audit-finding-G1 baseline.
 */

export const KLP_PROVENANCES = ['authored', 'reused', 'legacy'] as const

export type KlpProvenance = (typeof KLP_PROVENANCES)[number]

/** Just enough of a `CardKlp` row to place it. */
export interface ProvenanceInput {
  cardId: string
  version: number
  promptVersion: number
}

/**
 * Builds the `cardId@version` key set from `CardAuthoring` rows.
 *
 * Callers pass whatever they already selected; only the two fields are read.
 */
export function authoredVersionKeys(
  authorings: { cardId: string; klpVersion: number }[],
): Set<string> {
  return new Set(authorings.map((a) => `${a.cardId}@${a.klpVersion}`))
}

export function classifyProvenance(klp: ProvenanceInput, authoredKeys: Set<string>): KlpProvenance {
  if (authoredKeys.has(`${klp.cardId}@${klp.version}`)) return 'authored'
  return klp.promptVersion >= 2 ? 'reused' : 'legacy'
}

/**
 * A CARD's provenance, from the provenances of its live KLPs.
 *
 * The exploit test is scoped to a card's whole key-point set, not to one point,
 * so it needs a per-card label. A card's live KLPs are written as one version
 * by one path, so in practice they agree; when they do not — a hand-edited
 * point beside authored ones — the WEAKEST provenance wins. Reporting a mixed
 * card as authored would credit the pipeline for a set it did not fully write,
 * and the direction of that error is the one that flatters the pipeline.
 */
export function cardProvenance(perKlp: KlpProvenance[]): KlpProvenance {
  if (perKlp.length === 0) return 'legacy'
  if (perKlp.includes('legacy')) return 'legacy'
  if (perKlp.includes('reused')) return 'reused'
  return 'authored'
}
