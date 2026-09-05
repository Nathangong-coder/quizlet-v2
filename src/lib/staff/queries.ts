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
import { isRelationType, type RelationType } from '@/lib/klp/relations'

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

export interface LearnerIndexRow {
  userId: string
  /** Best available human identity: handle, else display name, else email. */
  label: string
  /** Shown under the label when it is not already the label, so a row is searchable by either. */
  email: string | null
  handle: string | null
  name: string | null
  role: string
  /** 'github', 'credentials', … — how this person gets in. */
  signIn: string
  klpStates: number
  answers: number
  lastObservedAt: Date | null
  createdAt: Date
  /**
   * The most recent thing this person actually DID — the later of their last
   * measured observation and their last submitted answer. Null means they have
   * never done either.
   *
   * Both are needed. `KlpState.lastObservedAt` misses anyone who answered on a
   * card with no key points yet (the whole legacy corpus), and the newest
   * `QuizAnswer` misses nothing but is not what the engine reads. Taking the
   * later of the two means adding a new kind of activity later can only make
   * this more accurate, never less.
   */
  lastActiveAt: Date | null
  active: boolean
}

/**
 * How long since their last activity before an account reads as inactive.
 *
 * A year, per the owner. Worth stating plainly because it makes the column look
 * broken at first glance: the app has not been live for a year, so NOBODY can
 * age out of activity yet, and every account showing `inactive` today is one
 * that has never done anything at all. That is the intended reading, not a bug.
 */
export const INACTIVE_AFTER_DAYS = 365

export function isActiveAt(lastActiveAt: Date | null, now: Date): boolean {
  if (!lastActiveAt) return false
  return now.getTime() - lastActiveAt.getTime() < INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000
}

/**
 * EVERY ACCOUNT, not every account with evidence.
 *
 * This used to start from `KlpState.groupBy` — so the page listed only people
 * who had answered enough to have measured knowledge, and silently omitted
 * everyone else. On the live database that was **2 rows out of 10 accounts**:
 * a real user who had signed up through GitHub and not yet answered anything
 * was invisible here while being perfectly findable on `/staff/roles`. The
 * page's own empty state ("Nobody has answered anything yet") is the giveaway
 * that it was built to answer a different question than the one staff actually
 * ask it, which is "who is on this thing?"
 *
 * So the query starts from `User` and LEFT-JOINS the evidence. A user with no
 * `KlpState` rows now appears with zeroes rather than not appearing, which is a
 * materially different claim: "this person has done nothing yet" instead of
 * "this person does not exist".
 *
 * Two queries, not N+1: one `findMany` over users and one `groupBy` over
 * `KlpState`, joined in memory. `_count` on the relation gives answer counts in
 * the same pass.
 */
export async function loadLearnerIndex(now: Date = new Date()): Promise<LearnerIndexRow[]> {
  const [users, grouped, answered] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        handle: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        accounts: { select: { provider: true } },
        _count: { select: { quizAnswers: true } },
      },
    }),
    prisma.klpState.groupBy({
      by: ['userId'],
      _count: { _all: true },
      _max: { lastObservedAt: true },
    }),
    prisma.quizAnswer.groupBy({
      by: ['userId'],
      _max: { createdAt: true },
    }),
  ])

  const evidenceBy = new Map(grouped.map((g) => [g.userId, g]))
  const answeredBy = new Map(answered.map((a) => [a.userId, a._max.createdAt]))

  return users
    .map((u) => {
      const evidence = evidenceBy.get(u.id)
      const observed = evidence?._max.lastObservedAt ?? null
      const lastAnswer = answeredBy.get(u.id) ?? null
      const lastActiveAt =
        observed && lastAnswer ? (observed > lastAnswer ? observed : lastAnswer) : (observed ?? lastAnswer)
      return {
        userId: u.id,
        // Falls back to the id only when a row has no handle, name AND no
        // email — which the schema permits and which would otherwise render a
        // blank, unclickable row.
        label: u.handle ?? u.name ?? u.email ?? u.id,
        email: u.email,
        handle: u.handle,
        name: u.name,
        role: u.role,
        // An OAuth user has an `Account` row naming the provider; a
        // credentials user has none, because the password lives on `User`.
        signIn: u.accounts[0]?.provider ?? 'credentials',
        klpStates: evidence?._count._all ?? 0,
        answers: u._count.quizAnswers,
        lastObservedAt: observed,
        createdAt: u.createdAt,
        lastActiveAt,
        active: isActiveAt(lastActiveAt, now),
      }
    })
    .sort((a, b) => {
      // Anyone with measured knowledge leads, most recently active first —
      // that is what staff came to look at. Everyone else follows by newest
      // signup, because the reason to scroll past the active learners is
      // usually "did that person I just invited actually get in?".
      const aSeen = a.lastActiveAt?.getTime() ?? 0
      const bSeen = b.lastActiveAt?.getTime() ?? 0
      if (aSeen !== bSeen) return bSeen - aSeen
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
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
