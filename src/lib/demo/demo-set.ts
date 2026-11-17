// The demo set: the one real set a guest may name cards from. Server-only — it
// reads the database, and its card ids are what the demo actions re-check
// every guest-supplied id against.
import 'server-only'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { readDemoConfig } from './config'

export type DemoKlp = { id: string; text: string; weight: number; kind: string; role: string | null }
export type DemoCard = {
  id: string
  term: string
  definition: string
  categories: { name: string; color: string | null }[]
  klps: DemoKlp[]
}
export type DemoSet = { id: string; title: string; subject: string | null; cards: DemoCard[] }

/**
 * The configured demo set (`DEMO_SET_ID`), only if it is readable signed out,
 * with its cards in position order and each card's LIVE key points in index
 * order. `null` when no id is configured or the set is not readable.
 */
export async function loadDemoSet(setId: string | null = readDemoConfig().setId): Promise<DemoSet | null> {
  if (!setId) return null
  const set = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(null) },
    select: {
      id: true,
      title: true,
      subject: true,
      cards: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          term: true,
          definition: true,
          categoryAssignments: { select: { category: { select: { name: true, color: true } } } },
          klps: {
            where: { supersededAt: null },
            orderBy: { index: 'asc' },
            select: { id: true, text: true, weight: true, kind: true, role: true },
          },
        },
      },
    },
  })
  if (!set) return null
  return {
    id: set.id,
    title: set.title,
    subject: set.subject,
    cards: set.cards.map((c) => ({
      id: c.id,
      term: c.term,
      definition: c.definition,
      categories: c.categoryAssignments.map((a) => ({ name: a.category.name, color: a.category.color })),
      klps: c.klps,
    })),
  }
}

/** True only for a card of the configured demo set, while that set is readable signed out. */
export async function isDemoCard(cardId: string, setId: string | null = readDemoConfig().setId): Promise<boolean> {
  if (!setId) return false
  const card = await prisma.card.findFirst({
    where: { id: cardId, setId, set: readableSetWhere(null) },
    select: { id: true },
  })
  return card !== null
}
