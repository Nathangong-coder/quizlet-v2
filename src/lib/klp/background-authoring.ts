import type { PrismaClient } from '@prisma/client'
import { klpSourceHash } from '@/lib/cards/klp-hash'
import { findDonors, pickDonor, copyKlps } from '@/lib/klp/reuse'

/**
 * Choosing what the background authoring job works on next, and how much.
 *
 * Split from the route so the POLICY — which cards, in what order, how many —
 * is pure and testable, and the route is left holding only authentication and
 * the AI calls. The interesting failure here is not an HTTP failure; it is
 * spending a day's free quota on the wrong cards.
 */

/**
 * Cards authored per cron invocation.
 *
 * Deliberately small. One card costs 6-16 AI calls at a few seconds each, so
 * three cards is roughly 2-3 minutes against a 300s function ceiling — and a
 * run that is killed mid-card leaves the pipeline's own resumability to sort
 * out rather than finishing cleanly. More frequent short runs also spread
 * naturally across the day, which matters because the Google free-tier cap is
 * per day per model: a single greedy run at 03:00 would exhaust every model
 * and leave 23 hours idle.
 */
export const CARDS_PER_RUN = 3

/**
 * Wall-clock budget. Under the platform ceiling with room for one card to
 * finish, because an aborted card is the one case that wastes calls without
 * producing anything.
 */
export const RUN_BUDGET_MS = 240_000

/** The minimum prompt version that counts as "properly authored". */
export const AUTHORED_PROMPT_VERSION = 2

export interface CandidateCard {
  id: string
  term: string
  definition: string
  setId: string
  setTitle: string
  blocks: { side: string; type: string; text: string | null; assetId: string | null; position: number }[]
}

/**
 * Cards that still need authoring, oldest first.
 *
 * "Needs authoring" is defined by the absence of a live KLP at
 * `AUTHORED_PROMPT_VERSION` or above — NOT by `klpStatus`, which says whether
 * the legacy extractor ran and is `ready` on cards carrying two weak
 * propositions. Using it here would declare the whole legacy corpus done and
 * the job would find nothing to do on a corpus that is mostly unauthored.
 */
export async function findUnauthoredCards(
  prisma: PrismaClient,
  limit: number,
): Promise<CandidateCard[]> {
  const cards = await prisma.card.findMany({
    where: {
      klps: { none: { supersededAt: null, promptVersion: { gte: AUTHORED_PROMPT_VERSION } } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      term: true,
      definition: true,
      setId: true,
      set: { select: { title: true } },
      contentBlocks: {
        select: { side: true, type: true, text: true, assetId: true, position: true },
      },
    },
  })

  return cards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    setId: card.setId,
    setTitle: card.set.title,
    blocks: card.contentBlocks,
  }))
}

export interface ReuseSweepResult {
  cardId: string
  copied: number
  donorCardId: string
}

/**
 * Copies key points onto any candidate that is byte-identical to a card which
 * already has them, BEFORE any AI call is made.
 *
 * Order matters and is the whole point: a card served from an existing
 * authored twin costs zero requests against a cap of twenty per model per day.
 * Authoring first and deduplicating later would spend the scarce resource to
 * produce something already in the database.
 *
 * Returns the cards that were served this way; the caller drops them from the
 * authoring list.
 */
export async function sweepReusable(
  prisma: PrismaClient,
  cards: CandidateCard[],
): Promise<ReuseSweepResult[]> {
  const served: ReuseSweepResult[] = []

  for (const card of cards) {
    const hash = klpSourceHash({
      term: card.term,
      definition: card.definition,
      blocks: card.blocks,
    })
    const donor = pickDonor(await findDonors(prisma, card.id, hash))
    // Only a donor that is itself properly authored is worth copying. A legacy
    // twin would mark the card done at a version the job does not consider
    // done, so the next run would pick it up again — an infinite, pointless
    // rotation through the same cards.
    if (!donor || donor.promptVersion < AUTHORED_PROMPT_VERSION) continue

    const result = await copyKlps(prisma, card.id, donor, hash)
    served.push({ cardId: card.id, copied: result.copied, donorCardId: donor.cardId })
  }

  return served
}

/** Has this run used its wall-clock budget? */
export function outOfTime(startedAt: number, now: number, budgetMs = RUN_BUDGET_MS): boolean {
  return now - startedAt >= budgetMs
}
