import { shadeForKnowledge, type MasteryShade } from '@/lib/klt/mastery-shade'

/**
 * Mastery, card by card — the data behind the set's Mastery view and its
 * Study guide (owner, 2026-09-14: "the KLP of each card & the progress").
 *
 * Everything here is derived from rows that already exist: the set's live
 * key points (`CardKlp`, `supersededAt: null`), the viewer's `KlpState`, the
 * viewer's `CardProgress` confidence, and the set's categories as the
 * grouping axis (the concept-layer decision in CLAUDE.md: user categories are
 * the concept nodes). Nothing is written.
 *
 * NULL IS NOT ZERO. A point the viewer has not been measured on — no
 * `KlpState`, or one below their own observation floor — shades `unknown`,
 * never `weak`. `shadeForKnowledge` and its test own that rule; this module
 * only decides what number to hand it.
 */

export interface MasteryPoint {
  id: string
  text: string
  /** The short rendering, when the topic pass wrote one. */
  label: string | null
  weight: number
  kind: string
  role: string | null
  /** Knowledge, when measured above the floor; null otherwise. */
  knowledge: number | null
  observations: number
  shade: MasteryShade
}

export interface MasteryCard {
  id: string
  term: string
  definition: string
  position: number
  categoryIds: string[]
  /** The viewer's 1–10 confidence on the card, if they have rated it. */
  confidence: number | null
  points: MasteryPoint[]
  /** Mean knowledge over the card's MEASURED points; null when none is. */
  knowledge: number | null
  shade: MasteryShade
}

export interface MasterySummary {
  cards: number
  cardsWithPoints: number
  measuredCards: number
  points: number
  measuredPoints: number
  byShade: Record<MasteryShade, number>
}

export interface MasteryGroup {
  key: string
  name: string
  color: string | null
  cards: MasteryCard[]
}

export interface SetMastery {
  set: { id: string; title: string; subject: string | null; isOwner: boolean; ownerHandle: string | null }
  viewerId: string | null
  /** The viewer's observation floor — points below it read as not measured. */
  floor: number
  cards: MasteryCard[]
  groups: MasteryGroup[]
  summary: MasterySummary
}

export const UNCATEGORIZED_GROUP = '__uncategorized__'

interface KlpRow {
  id: string
  cardId: string
  text: string
  label: string | null
  weight: number
  kind: string
  role: string | null
}

interface StateRow {
  klpId: string
  pKnown: number
  observations: number
}

/** Pure: shape cards from their rows. Exported for the tests. */
export function shapeMastery(input: {
  cards: { id: string; term: string; definition: string; position: number; categoryIds: string[]; confidence: number | null }[]
  klps: KlpRow[]
  states: StateRow[]
  floor: number
}): MasteryCard[] {
  const stateBy = new Map(input.states.map((s) => [s.klpId, s]))
  const klpsByCard = new Map<string, KlpRow[]>()
  for (const k of input.klps) {
    const list = klpsByCard.get(k.cardId) ?? []
    list.push(k)
    klpsByCard.set(k.cardId, list)
  }
  return input.cards.map((c) => {
    const points: MasteryPoint[] = (klpsByCard.get(c.id) ?? []).map((k) => {
      const st = stateBy.get(k.id)
      const measured = st !== undefined && st.observations >= input.floor
      const knowledge = measured ? st.pKnown : null
      return {
        id: k.id,
        text: k.text,
        label: k.label,
        weight: k.weight,
        kind: k.kind,
        role: k.role,
        knowledge,
        observations: st?.observations ?? 0,
        shade: shadeForKnowledge(knowledge),
      }
    })
    const measured = points.filter((p) => p.knowledge !== null)
    // Weighted by the point's weight: a heavy point known counts for more.
    const totalW = measured.reduce((n, p) => n + p.weight, 0)
    const knowledge = totalW > 0 ? measured.reduce((n, p) => n + (p.knowledge as number) * p.weight, 0) / totalW : null
    return { ...c, points, knowledge, shade: shadeForKnowledge(knowledge) }
  })
}

export function summarizeMastery(cards: readonly MasteryCard[]): MasterySummary {
  const byShade: Record<MasteryShade, number> = { unknown: 0, weak: 0, developing: 0, solid: 0, strong: 0 }
  let points = 0
  let measuredPoints = 0
  for (const c of cards) {
    for (const p of c.points) {
      points += 1
      if (p.knowledge !== null) measuredPoints += 1
      byShade[p.shade] += 1
    }
  }
  return {
    cards: cards.length,
    cardsWithPoints: cards.filter((c) => c.points.length > 0).length,
    measuredCards: cards.filter((c) => c.knowledge !== null).length,
    points,
    measuredPoints,
    byShade,
  }
}

/**
 * Group cards by category for the guide. A card with two categories appears
 * under both — the guide is a reading, and a reader under "Valuation" should
 * not have to know the card is also filed under "Accounting". Cards with no
 * category close the guide under one heading.
 */
export function groupMastery(cards: readonly MasteryCard[], categories: readonly { id: string; name: string; color: string | null }[]): MasteryGroup[] {
  const groups: MasteryGroup[] = categories.map((c) => ({ key: c.id, name: c.name, color: c.color, cards: cards.filter((card) => card.categoryIds.includes(c.id)) })).filter((g) => g.cards.length > 0)
  const loose = cards.filter((card) => card.categoryIds.length === 0 || !card.categoryIds.some((id) => categories.some((c) => c.id === id)))
  if (loose.length > 0) groups.push({ key: UNCATEGORIZED_GROUP, name: groups.length > 0 ? 'Everything else' : 'All cards', color: null, cards: loose })
  return groups
}

export async function loadSetMastery(viewerId: string | null, setId: string): Promise<SetMastery | null> {
  const { prisma } = await import('@/lib/db')
  const { readableSetWhere } = await import('@/lib/sets/visibility')

  const set = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(viewerId) },
    select: {
      id: true,
      title: true,
      subject: true,
      userId: true,
      user: { select: { handle: true } },
      categories: { orderBy: { name: 'asc' }, select: { id: true, name: true, color: true } },
      cards: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          term: true,
          definition: true,
          position: true,
          categoryAssignments: { select: { categoryId: true } },
          klps: { where: { supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, cardId: true, text: true, label: true, weight: true, kind: true, role: true } },
        },
      },
    },
  })
  if (!set) return null

  const klps = set.cards.flatMap((c) => c.klps)
  let floor = 1
  let states: StateRow[] = []
  let confidenceBy = new Map<string, number>()
  if (viewerId) {
    const { getUserTuning } = await import('@/lib/tuning/store')
    const [tuning, stateRows, progress] = await Promise.all([
      getUserTuning(viewerId),
      klps.length > 0
        ? prisma.klpState.findMany({ where: { userId: viewerId, klpId: { in: klps.map((k) => k.id) } }, select: { klpId: true, pKnown: true, observations: true } })
        : Promise.resolve([] as StateRow[]),
      prisma.cardProgress.findMany({ where: { userId: viewerId, cardId: { in: set.cards.map((c) => c.id) } }, select: { cardId: true, confidence: true } }),
    ])
    floor = tuning.thresholds.minObservations
    states = stateRows
    confidenceBy = new Map(progress.map((p) => [p.cardId, p.confidence]))
  }

  const cards = shapeMastery({
    cards: set.cards.map((c) => ({
      id: c.id,
      term: c.term,
      definition: c.definition,
      position: c.position,
      categoryIds: c.categoryAssignments.map((a) => a.categoryId),
      confidence: confidenceBy.get(c.id) ?? null,
    })),
    klps,
    states,
    floor,
  })

  return {
    set: { id: set.id, title: set.title, subject: set.subject, isOwner: viewerId !== null && viewerId === set.userId, ownerHandle: set.user?.handle ?? null },
    viewerId,
    floor,
    cards,
    groups: groupMastery(cards, set.categories),
    summary: summarizeMastery(cards),
  }
}
