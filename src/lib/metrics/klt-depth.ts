/**
 * How many topics at a level must clear the learner's observation floor before
 * that level is worth showing. Below this, the view is mostly "not measured",
 * which is the complaint that opened queue item 9.
 */
export const MIN_TOPICS_AT_DEPTH = 3

/**
 * Which level of the tree to display.
 *
 * DEEPEST wins: a specific topic is more actionable than a broad one, so we go
 * as fine-grained as the evidence supports and no further. A thin corpus lands
 * on broad topics; the view sharpens by itself as answers accumulate, with no
 * setting for the learner to notice and retune.
 *
 * Pure, so every combination is testable without a database.
 */
export function selectDisplayDepth(
  measuredByDepth: Map<number, number>,
  populatedDepths: number[],
): number | null {
  if (populatedDepths.length === 0) return null

  const populated = [...new Set(populatedDepths)].sort((a, b) => a - b)
  const qualifying = populated.filter(
    (d) => (measuredByDepth.get(d) ?? 0) >= MIN_TOPICS_AT_DEPTH,
  )
  if (qualifying.length > 0) return qualifying[qualifying.length - 1]

  // Nothing measured anywhere — show the broadest level that exists rather
  // than nothing. It is the most likely to accumulate evidence first.
  return populated[0]
}
