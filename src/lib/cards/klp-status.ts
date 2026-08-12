/**
 * The closed vocabulary for `Card.klpStatus`.
 *
 * A single `as const` with the type DERIVED from it, following `AI_TASKS`
 * (`src/lib/ai/model-routing.ts`). Before this existed the four literals were
 * scattered across `src/actions/klp.ts`, `src/actions/sets.ts`,
 * `src/components/sets/KlpEditor.tsx` and a Prisma comment, with nothing tying
 * them together — the column is a `String`, so a typo compiled cleanly and then
 * silently never matched. `KlpEditor` in particular renders its retry and
 * skipped affordances off `status === 'pending' | 'skipped' | 'failed'`, so a
 * misspelling there fails by showing the user nothing at all.
 *
 * Named `CardKlpStatus`, NOT `KlpStatus`: `@/lib/errors/klp-credit` already
 * exports a `KlpStatus` (`passed | partial | failed`) for how a learner did on
 * one key point. These are unrelated vocabularies that share the member
 * `failed`, so a bare `KlpStatus` import would be ambiguous at a glance and
 * assignable in exactly one direction that means something entirely different.
 */
export const CARD_KLP_STATUSES = ['pending', 'ready', 'failed', 'skipped'] as const

export type CardKlpStatus = (typeof CARD_KLP_STATUSES)[number]

/** The two statuses a failed extraction may record. */
export type CardKlpFailureStatus = Extract<CardKlpStatus, 'failed' | 'skipped'>

/**
 * Narrow a value read from the database to the vocabulary.
 *
 * `Card.klpStatus` is a `String` column with a default of `'pending'`, so
 * Prisma hands back `string` and every consumer would otherwise widen. An
 * unrecognised value — a row written before the vocabulary settled, or by hand
 * — resolves to `'pending'` rather than throwing: `'pending'` is the column
 * default and the one status whose UI offers extraction, so an unknown value
 * degrades into "not extracted yet", which is both true and actionable. The
 * alternative, throwing, would take down the set builder over a bad row.
 */
export function toCardKlpStatus(raw: string): CardKlpStatus {
  return (CARD_KLP_STATUSES as readonly string[]).includes(raw)
    ? (raw as CardKlpStatus)
    : 'pending'
}
