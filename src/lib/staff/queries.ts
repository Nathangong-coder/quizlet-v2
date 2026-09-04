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
  /**
   * The discrimination-test score from the CardAuthoring run that produced
   * this KLP's version. NULL for a legacy KLP with no matching authoring
   * run — never 0, for the same reason meanPKnown is null rather than 0.
   */
  separation: number | null
  /** CardAuthoring.status ('separated' | 'low_discrimination' | 'failed'). NULL alongside separation. */
  authoringStatus: string | null
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
  const cardIds = Array.from(new Set(klps.map((k) => k.cardId)))

  // Two grouped aggregates rather than nested includes: a per-KLP include of
  // every KlpState and AnswerKlpResult row would load the whole evidence table
  // to render a count.
  const [states, verdicts, authorings] = await Promise.all([
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
    // Fetched per-card (not per-KLP-version) and matched in memory below: a
    // card is re-authored as a whole, so its CardAuthoring rows are keyed by
    // cardId + klpVersion, not by individual KLP id.
    prisma.cardAuthoring.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, klpVersion: true, separationScore: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const stateBy = new Map(states.map((s) => [s.klpId, s]))
  const verdictBy = new Map<string, Record<string, number>>()
  for (const v of verdicts) {
    const bucket = verdictBy.get(v.klpId) ?? {}
    bucket[v.status] = v._count._all
    verdictBy.set(v.klpId, bucket)
  }
  // Most recent CardAuthoring row per (cardId, klpVersion): the query above
  // is already ordered createdAt desc, so the first match wins and later
  // ones are skipped.
  const authoringBy = new Map<string, { separationScore: number; status: string }>()
  for (const a of authorings) {
    const key = `${a.cardId}:${a.klpVersion}`
    if (!authoringBy.has(key)) {
      authoringBy.set(key, { separationScore: a.separationScore, status: a.status })
    }
  }

  return klps.map((k) => {
    const state = stateBy.get(k.id)
    const learnerCount = state?._count._all ?? 0
    const authoring = authoringBy.get(`${k.cardId}:${k.version}`)
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
      // No matching CardAuthoring run means no score — a legacy KLP predates
      // this pipeline. Never 0, for the same reason meanPKnown is null.
      separation: authoring?.separationScore ?? null,
      authoringStatus: authoring?.status ?? null,
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

export interface LearnerRecord {
  label: string
  weakest: { klpId: string; text: string; pKnown: number; observations: number }[]
  recentAnswers: {
    id: string
    createdAt: Date
    mode: string
    /** 'legacy' stands in for a NULL column — see analysisStatusCounts. */
    analysisStatus: string
    cardTerm: string
    verdicts: { status: string; klpText: string }[]
    tags: { dimension: string; type: string; significance: number }[]
  }[]
  /**
   * WHY THIS IS HERE: a relational tag table cannot distinguish "analyzed and
   * clean" from "could not analyze" — both are zero rows. Error rates need a
   * denominator of ANALYZED answers, or a legacy-heavy corpus silently reads
   * as a better learner.
   *
   * `QuizAnswer.analysisStatus` is NULLABLE, and null means one specific
   * thing: a row written before Spec 2a shipped. It is bucketed as 'legacy'
   * rather than left as a null key — `Object.fromEntries` would stringify it
   * to "null", which reads as a status the vocabulary does not contain.
   */
  analysisStatusCounts: Record<string, number>
}

export async function loadLearnerIndex() {
  const grouped = await prisma.klpState.groupBy({
    by: ['userId'],
    _count: { _all: true },
    _max: { lastObservedAt: true },
  })
  if (grouped.length === 0) return []

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, handle: true, name: true, email: true },
  })
  const labelBy = new Map(users.map((u) => [u.id, u.handle ?? u.name ?? u.email]))

  return grouped
    .map((g) => ({
      userId: g.userId,
      label: labelBy.get(g.userId) ?? g.userId,
      klpStates: g._count._all,
      lastObservedAt: g._max.lastObservedAt,
    }))
    .sort((a, b) => (b.lastObservedAt?.getTime() ?? 0) - (a.lastObservedAt?.getTime() ?? 0))
}

export async function loadLearnerRecord(userId: string): Promise<LearnerRecord | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true, name: true, email: true },
  })
  if (!user) return null

  const [states, answers, statuses] = await Promise.all([
    prisma.klpState.findMany({
      where: { userId },
      select: { klpId: true, pKnown: true, observations: true, klp: { select: { text: true, label: true } } },
      orderBy: { pKnown: 'asc' },
      take: 25,
    }),
    // `QuizAnswer.userId` exists directly and is indexed (@@index([userId,
    // createdAt])). Filtering through `attempt: { userId }` would be a join
    // that skips that index for the exact ordering asked for.
    prisma.quizAnswer.findMany({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        mode: true,
        analysisStatus: true,
        card: { select: { term: true } },
        klpResults: { select: { status: true, klp: { select: { text: true, label: true } } } },
        errorTags: { select: { dimension: true, type: true, significance: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.quizAnswer.groupBy({
      by: ['analysisStatus'],
      where: { userId },
      _count: { _all: true },
    }),
  ])

  return {
    label: user.handle ?? user.name ?? user.email,
    weakest: states.map((s) => ({
      klpId: s.klpId,
      text: s.klp.label ?? s.klp.text,
      pKnown: s.pKnown,
      observations: s.observations,
    })),
    recentAnswers: answers.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      mode: a.mode,
      // Null means "written before Spec 2a", which is a real category and not
      // an absence. Naming it keeps it out of the analysed denominator.
      analysisStatus: a.analysisStatus ?? 'legacy',
      cardTerm: a.card.term,
      verdicts: a.klpResults.map((r) => ({ status: r.status, klpText: r.klp.label ?? r.klp.text })),
      tags: a.errorTags.map((t) => ({
        dimension: t.dimension,
        type: t.type,
        significance: t.significance,
      })),
    })),
    analysisStatusCounts: Object.fromEntries(
      statuses.map((s) => [s.analysisStatus ?? 'legacy', s._count._all]),
    ),
  }
}
