/**
 * A card's key points and the relations between them, ready to draw.
 *
 * Lives here rather than in `src/lib/staff/queries.ts` because it is no longer
 * a staff-only read: the set page offers a public KLP view of any set the
 * viewer can already see. The CALLER supplies the set id it has already
 * authorised — this module does no gating of its own, exactly like the staff
 * reads it moved out of, so a page that forgets `readableSetWhere` fails its
 * own guard rather than quietly leaning on one here.
 */
import { prisma } from '@/lib/db'
import { isRelationType, type RelationType } from '@/lib/klp/relations'

export interface CardKlpGraph {
  cardId: string
  cardTerm: string
  cardDefinition: string
  setId: string
  separation: number | null
  status: string | null
  klps: { id: string; text: string; label: string | null; kind: string; weight: number }[]
  /** `from`/`to` are INDEXES into `klps`, which is what the layout and the K-numbers use. */
  relations: {
    id: string
    from: number
    to: number
    type: RelationType
    rationale: string
    probe: string
  }[]
}

/**
 * A set's cards, each with its live key points and the relations between them.
 *
 * Relation endpoints are stored as `CardKlp` IDs and converted here to INDEXES
 * into this card's own `klps` array. That conversion is the whole reason this
 * function exists rather than the component doing it: the graph, the K1..Kn
 * numbering and the layout all address points by position, and doing the
 * id-to-index mapping in one place means the three can never disagree about
 * which point K3 is.
 *
 * An edge whose endpoint is not in the live set — pointing at a superseded
 * version, say — is DROPPED rather than rendered against the wrong node. A
 * relation drawn to the wrong key point is worse than a missing one, because it
 * looks exactly like a real finding.
 *
 * `KlpRelation.type` is a plain string column, so it is VALIDATED here rather
 * than cast. An unrecognised type has no line style and no legend entry, so it
 * would render as an unlabelled solid line indistinguishable from `causes` —
 * a silent lie about the relationship. Dropped instead.
 */
export async function loadCardKlpGraphs(setId: string): Promise<CardKlpGraph[]> {
  const cards = await prisma.card.findMany({
    where: { setId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      term: true,
      definition: true,
      setId: true,
      klps: {
        where: { supersededAt: null },
        orderBy: { index: 'asc' },
        select: { id: true, text: true, label: true, kind: true, weight: true },
      },
    },
  })

  const withKlps = cards.filter((c) => c.klps.length > 0)
  if (withKlps.length === 0) return []

  const klpIds = withKlps.flatMap((c) => c.klps.map((k) => k.id))
  const [relations, authorings] = await Promise.all([
    prisma.klpRelation.findMany({
      where: { fromKlpId: { in: klpIds }, toKlpId: { in: klpIds } },
      select: { id: true, fromKlpId: true, toKlpId: true, type: true, rationale: true, probe: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.cardAuthoring.findMany({
      where: { cardId: { in: withKlps.map((c) => c.id) } },
      select: { cardId: true, separationScore: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const latestAuthoring = new Map<string, { separationScore: number; status: string }>()
  for (const a of authorings) {
    if (!latestAuthoring.has(a.cardId)) {
      latestAuthoring.set(a.cardId, { separationScore: a.separationScore, status: a.status })
    }
  }

  return withKlps.map((card) => {
    const indexById = new Map(card.klps.map((k, i) => [k.id, i]))
    const authoring = latestAuthoring.get(card.id)

    return {
      cardId: card.id,
      cardTerm: card.term,
      cardDefinition: card.definition,
      setId: card.setId,
      separation: authoring?.separationScore ?? null,
      status: authoring?.status ?? null,
      klps: card.klps,
      relations: relations
        .map((r) => {
          const from = indexById.get(r.fromKlpId)
          const to = indexById.get(r.toKlpId)
          if (from === undefined || to === undefined) return null
          if (!isRelationType(r.type)) return null
          return { id: r.id, from, to, type: r.type, rationale: r.rationale, probe: r.probe }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    }
  })
}
