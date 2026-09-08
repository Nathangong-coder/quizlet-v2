import type { PrismaClient, Prisma } from '@prisma/client'

/**
 * Reusing key points across cards that teach EXACTLY the same thing.
 *
 * The motivating case is real and already in the corpus: `Accounting -
 * "Talking"` has a copy set whose 68 cards share 67 byte-identical
 * term+definition pairs with the original, and authoring those 67 again would
 * cost ~670 AI calls to reproduce propositions that already exist.
 *
 * EXACT MATCH ONLY, on `klpSourceHash`. This is deliberately not a similarity
 * search, and the reason is the same one that governed the diagnostic backfill
 * decision: a KLP copied onto a card it does not actually describe is a false
 * proposition that a learner is then graded against, and it is
 * indistinguishable from an authored one afterwards. A hash collision cannot
 * happen; a semantic "close enough" judgment is wrong some fraction of the
 * time and there is no way to tell which rows were the wrong fraction.
 *
 * The hash already exists and is already maintained — `Card.klpSourceHash` is
 * written on every extraction and authoring, and drives staleness detection in
 * `src/lib/cards/stale.ts`. Nothing here adds a column or a second notion of
 * card identity; it looks ACROSS cards at a value that was only ever looked at
 * per-card.
 */

/** A donor card whose authored key points can be copied. */
export interface ReuseDonor {
  cardId: string
  setId: string
  klpCount: number
  /** Highest `promptVersion` among its live KLPs — the provenance being copied. */
  promptVersion: number
}

/**
 * The best donor for a card, or null when nothing matches.
 *
 * Prefers the HIGHEST prompt version, then the most key points. A legacy
 * single-pass extraction and a discrimination-tested authoring run can both
 * match the same hash, and copying the legacy one would spend the reuse
 * opportunity on the weaker artifact — the thing the authoring pipeline exists
 * to replace.
 */
export function pickDonor(candidates: ReuseDonor[]): ReuseDonor | null {
  if (candidates.length === 0) return null
  return [...candidates].sort(
    (a, b) => b.promptVersion - a.promptVersion || b.klpCount - a.klpCount,
  )[0]
}

/**
 * Finds cards whose key points could be copied onto `cardId`.
 *
 * Excludes the card itself and any card with no live KLPs. `supersededAt:
 * null` matters: a superseded KLP is history, and copying one would resurrect
 * a proposition its own card has already retired.
 */
export async function findDonors(
  prisma: PrismaClient,
  cardId: string,
  sourceHash: string,
): Promise<ReuseDonor[]> {
  const cards = await prisma.card.findMany({
    where: {
      klpSourceHash: sourceHash,
      id: { not: cardId },
      klps: { some: { supersededAt: null } },
    },
    select: {
      id: true,
      setId: true,
      klps: { where: { supersededAt: null }, select: { promptVersion: true } },
    },
  })

  return cards.map((card) => ({
    cardId: card.id,
    setId: card.setId,
    klpCount: card.klps.length,
    promptVersion: Math.max(...card.klps.map((k) => k.promptVersion)),
  }))
}

export interface ReuseResult {
  donorCardId: string
  copied: number
  promptVersion: number
}

/**
 * Copies a donor's live key points onto a card, in one transaction.
 *
 * WHAT IS COPIED: the propositions and their weights. WHAT IS NOT: the
 * donor's `CardAuthoring` run, its separation score, its candidate answers, or
 * its `KlpRelation` edges.
 *
 * The authoring run is not copied because it is a record of work that happened
 * to a different card — duplicating it would double-count every card in
 * `npm run klp-histogram`, and the histogram is the acceptance criterion for
 * the weight formula. Relations are not copied because their `fromKlpId` /
 * `toKlpId` point at the donor's rows; remapping them onto the copies is
 * possible and worth doing later, but a half-remapped graph is worse than no
 * graph, and weight is already carried on the copied rows.
 *
 * The card is marked with the donor's `promptVersion`, not a new one. It did
 * not get a better artifact than the donor has, and recording otherwise would
 * make the corpus look more thoroughly authored than it is.
 */
export async function copyKlps(
  prisma: PrismaClient,
  cardId: string,
  donor: ReuseDonor,
  sourceHash: string,
): Promise<ReuseResult> {
  const source = await prisma.cardKlp.findMany({
    where: { cardId: donor.cardId, supersededAt: null },
    orderBy: { index: 'asc' },
  })

  const copied = await prisma.$transaction(async (tx) => {
    // The recipient's next version. `@@unique([cardId, version, index])` means
    // reusing the donor's version number would collide with the recipient's
    // own history the moment it has any — version is per CARD, not global.
    const latest = await tx.cardKlp.aggregate({
      where: { cardId },
      _max: { version: true },
    })
    const version = (latest._max.version ?? 0) + 1

    // Supersede rather than delete. A learner may already have KlpState and
    // AnswerKlpResult rows against this card's existing key points, and
    // deleting the propositions silently resets that evidence — the failure
    // mode recorded in `klp-mastery-is-a-cache-evidence-is-not`.
    await tx.cardKlp.updateMany({
      where: { cardId, supersededAt: null },
      data: { supersededAt: new Date() },
    })

    const rows: Prisma.CardKlpCreateManyInput[] = source.map((klp) => ({
      cardId,
      version,
      index: klp.index,
      text: klp.text,
      weight: klp.weight,
      kind: klp.kind,
      // The RECIPIENT's hash, not the donor's. They are equal — that equality
      // is why this copy is allowed at all — but writing the value we actually
      // verified keeps the invariant local rather than assumed.
      sourceHash,
      promptVersion: klp.promptVersion,
      source: klp.source,
      label: klp.label,
      // Provenance is preserved verbatim: these propositions were written by
      // the donor's model, and relabelling them as this card's own work would
      // make `/staff/ai-history` and the histogram's authored/legacy split
      // both wrong.
      model: klp.model,
    }))
    if (rows.length > 0) await tx.cardKlp.createMany({ data: rows })

    await tx.card.update({
      where: { id: cardId },
      data: { klpStatus: 'ready', klpSourceHash: sourceHash, klpError: null },
    })
    return rows.length
  })

  return { donorCardId: donor.cardId, copied, promptVersion: donor.promptVersion }
}
