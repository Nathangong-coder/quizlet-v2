import { klpSourceHash, HashableBlock } from './klp-hash'

export interface StaleCandidate {
  id: string
  term: string
  definition: string
  klpSourceHash: string | null
  contentBlocks?: HashableBlock[]
}

/**
 * Ids whose current content no longer matches the hash their KLPs were
 * extracted from. A `null` stored hash (a brand-new card, never extracted)
 * always counts as stale.
 *
 * This is the highest-risk piece of the extraction-on-save wiring: a false
 * negative here leaves a card being graded against pre-edit KLPs forever
 * (see the doc comment on `klpSourceHash` in `./klp-hash`), and a false
 * positive re-versions and re-extracts a card that didn't change, burning an
 * AI call for nothing. Kept as a pure function so it is testable without a
 * database.
 */
export function selectStaleCardIds(cards: StaleCandidate[]): string[] {
  return cards
    .filter(
      (c) =>
        c.klpSourceHash !==
        klpSourceHash({ term: c.term, definition: c.definition, blocks: c.contentBlocks }),
    )
    .map((c) => c.id)
}
