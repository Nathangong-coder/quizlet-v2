/**
 * The staff surface's reads.
 *
 * A PLAIN module with no 'use server' directive, deliberately. Everything here
 * is ungated by construction; the gate lives in src/actions/staff.ts, and if
 * these functions were exported from that module they would each be a callable
 * RPC endpoint handing the whole install to anyone with the action id.
 */
import { prisma } from '@/lib/db'
import { CARD_KLP_STATUSES } from '@/lib/cards/klp-status'

export interface StaffKlpRow {
  id: string
  text: string
  label: string | null
  cardId: string
  cardTerm: string
  setId: string
  kind: string
  weight: number
  version: number
  supersededAt: Date | null
  topics: { name: string; rank: number }[]
  learnerCount: number
  /** NULL when no learner has evidence. Never 0 — see shadeForKnowledge. */
  meanPKnown: number | null
  /** AnswerKlpResult.status -> count. Three keys today, thirteen after Spec 5. */
  verdicts: Record<string, number>
}

export interface StaffKlpQuery {
  setId?: string
  search?: string
  includeSuperseded?: boolean
}

export async function loadStaffKlps(q: StaffKlpQuery): Promise<StaffKlpRow[]> {
  const klps = await prisma.cardKlp.findMany({
    where: {
      ...(q.includeSuperseded ? {} : { supersededAt: null }),
      ...(q.setId ? { card: { setId: q.setId } } : {}),
      ...(q.search
        ? {
            OR: [
              { text: { contains: q.search, mode: 'insensitive' as const } },
              { label: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      text: true,
      label: true,
      cardId: true,
      kind: true,
      weight: true,
      version: true,
      supersededAt: true,
      card: { select: { term: true, setId: true } },
      topics: { select: { rank: true, klt: { select: { name: true } } } },
    },
    orderBy: [{ card: { position: 'asc' } }, { index: 'asc' }],
    take: 500,
  })

  if (klps.length === 0) return []
  const ids = klps.map((k) => k.id)

  // Two grouped aggregates rather than nested includes: a per-KLP include of
  // every KlpState and AnswerKlpResult row would load the whole evidence table
  // to render a count.
  const [states, verdicts] = await Promise.all([
    prisma.klpState.groupBy({
      by: ['klpId'],
      where: { klpId: { in: ids } },
      _count: { _all: true },
      _avg: { pKnown: true },
    }),
    prisma.answerKlpResult.groupBy({
      by: ['klpId', 'status'],
      where: { klpId: { in: ids } },
      _count: { _all: true },
    }),
  ])

  const stateBy = new Map(states.map((s) => [s.klpId, s]))
  const verdictBy = new Map<string, Record<string, number>>()
  for (const v of verdicts) {
    const bucket = verdictBy.get(v.klpId) ?? {}
    bucket[v.status] = v._count._all
    verdictBy.set(v.klpId, bucket)
  }

  return klps.map((k) => {
    const state = stateBy.get(k.id)
    const learnerCount = state?._count._all ?? 0
    return {
      id: k.id,
      text: k.text,
      label: k.label,
      cardId: k.cardId,
      cardTerm: k.card.term,
      setId: k.card.setId,
      kind: k.kind,
      weight: k.weight,
      version: k.version,
      supersededAt: k.supersededAt,
      topics: k.topics.map((t) => ({ name: t.klt.name, rank: t.rank })),
      learnerCount,
      // Zero learners means NO EVIDENCE, which is not zero knowledge.
      meanPKnown: learnerCount === 0 ? null : (state?._avg.pKnown ?? null),
      verdicts: verdictBy.get(k.id) ?? {},
    }
  })
}

export interface StaffCoverageRow {
  setId: string
  setTitle: string
  ownerLabel: string
  total: number
  byKlpStatus: Record<string, number>
  byKltStatus: Record<string, number>
  failures: { cardId: string; term: string; klpError: string | null }[]
}

export async function loadStaffCoverage(): Promise<StaffCoverageRow[]> {
  const sets = await prisma.set.findMany({
    select: {
      id: true,
      title: true,
      user: { select: { handle: true, name: true, email: true } },
      cards: {
        select: { id: true, term: true, klpStatus: true, kltStatus: true, klpError: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return sets.map((s) => {
    const byKlpStatus: Record<string, number> = {}
    const byKltStatus: Record<string, number> = {}
    for (const status of CARD_KLP_STATUSES) {
      byKlpStatus[status] = 0
      byKltStatus[status] = 0
    }
    for (const c of s.cards) {
      byKlpStatus[c.klpStatus] = (byKlpStatus[c.klpStatus] ?? 0) + 1
      byKltStatus[c.kltStatus] = (byKltStatus[c.kltStatus] ?? 0) + 1
    }
    return {
      setId: s.id,
      setTitle: s.title,
      ownerLabel: s.user.handle ?? s.user.name ?? s.user.email,
      total: s.cards.length,
      byKlpStatus,
      byKltStatus,
      failures: s.cards
        .filter((c) => c.klpStatus === 'failed')
        .map((c) => ({ cardId: c.id, term: c.term, klpError: c.klpError })),
    }
  })
}

export interface StaffOverview {
  liveKlps: number
  supersededKlps: number
  cardsByKlpStatus: Record<string, number>
  learnersWithEvidence: number
  sets: number
}

export async function loadStaffOverview(): Promise<StaffOverview> {
  const [live, superseded, byStatus, learners, sets] = await Promise.all([
    prisma.cardKlp.count({ where: { supersededAt: null } }),
    prisma.cardKlp.count({ where: { supersededAt: { not: null } } }),
    prisma.card.groupBy({ by: ['klpStatus'], _count: { _all: true } }),
    prisma.klpState.findMany({ distinct: ['userId'], select: { userId: true } }),
    prisma.set.count(),
  ])

  const cardsByKlpStatus: Record<string, number> = {}
  for (const status of CARD_KLP_STATUSES) cardsByKlpStatus[status] = 0
  for (const row of byStatus) cardsByKlpStatus[row.klpStatus] = row._count._all

  return {
    liveKlps: live,
    supersededKlps: superseded,
    cardsByKlpStatus,
    learnersWithEvidence: learners.length,
    sets,
  }
}
