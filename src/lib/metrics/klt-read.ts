import type { PrismaClient } from '@prisma/client'
import type { HistoryScope } from '@/lib/memory/scope'
import { buildCardScopeWhere } from '@/lib/memory/scope'
import { shapeMissedWork, type MissedTopic, type ShapeMissedWorkInput } from '@/lib/metrics/missed'
import type { MetricThresholds } from '@/lib/tuning/schema'

/**
 * The missed-work read for `/profile/learner` (spec §8).
 *
 * Lives here rather than in `src/actions/learner-dashboard.ts` because that
 * action is already the whole scope-resolution story, and rather than in
 * `read.ts` because it needs none of that module's tag-derivation pipeline —
 * it aggregates misses, not readiness. The KLT MASTERY axis does need those
 * shared inputs and therefore lives in `read.ts` as `kltTopics`.
 *
 * EVERY query filters by `userId`. Without that these read another user's card
 * content and another user's answer history — the exact class of hole the
 * visibility pass closed ten of.
 */

/** The statuses `shapeMissedWork` treats as a miss. Kept in sync with it. */
const MISS_STATUSES = ['failed', 'partial']

function cardWhere(userId: string, scope: HistoryScope, categoryIds: string[]) {
  const scopeWhere = scope.cardId ? { id: scope.cardId } : buildCardScopeWhere(scope, categoryIds)
  return { set: { userId }, ...scopeWhere }
}

/**
 * What the learner actually got wrong, grouped by topic.
 *
 * Reads only misses (`failed` / `partial`) — a passed result is not something
 * to show on a panel about being wrong. The aggregate `pKnown` still comes
 * from `KlpState`, which was built from ALL evidence, so a KLP the learner has
 * since mastered can appear here with a high knowledge figure. That is
 * correct and is the point of pairing the two: "you missed this twice, but you
 * have it now" is a different message from "you keep missing this".
 */
export async function loadMissedWork(
  prisma: PrismaClient,
  userId: string,
  scope: HistoryScope,
  categoryIds: string[],
  thresholds: MetricThresholds,
): Promise<MissedTopic[]> {
  const card = cardWhere(userId, scope, categoryIds)

  const results = await prisma.answerKlpResult.findMany({
    where: {
      quizAnswer: { userId },
      status: { in: MISS_STATUSES },
      klp: { card },
    },
    select: {
      klpId: true,
      status: true,
      mode: true,
      createdAt: true,
      quizAnswerId: true,
      klp: {
        select: {
          id: true,
          label: true,
          text: true,
          card: { select: { term: true } },
          topics: {
            where: { rank: { lte: thresholds.masteryTopicRanks } },
            orderBy: { rank: 'asc' },
            select: { klt: { select: { normalizedName: true, name: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (results.length === 0) return []

  const klpIds = [...new Set(results.map((r) => r.klpId))]
  const [states, tags] = await Promise.all([
    prisma.klpState.findMany({
      where: { userId, klpId: { in: klpIds } },
      select: { klpId: true, pKnown: true, observations: true },
    }),
    prisma.answerErrorTag.findMany({
      where: { quizAnswer: { userId }, klpId: { in: klpIds } },
      select: { quizAnswerId: true, klpId: true, type: true },
    }),
  ])

  // Error types are keyed by (answer, klp) so a drill-down row shows the tags
  // from THAT attempt, not every tag the KLP has ever collected.
  const typesByAttempt = new Map<string, string[]>()
  for (const t of tags) {
    if (t.klpId === null) continue
    const key = `${t.quizAnswerId}:${t.klpId}`
    const list = typesByAttempt.get(key)
    if (list) list.push(t.type)
    else typesByAttempt.set(key, [t.type])
  }

  const klps: ShapeMissedWorkInput['klps'] = []
  const topicNames: Record<string, string> = {}
  const seenKlp = new Set<string>()
  for (const r of results) {
    if (seenKlp.has(r.klpId)) continue
    seenKlp.add(r.klpId)
    for (const t of r.klp.topics) topicNames[t.klt.normalizedName] = t.klt.name
    klps.push({
      klpId: r.klpId,
      label: r.klp.label,
      text: r.klp.text,
      term: r.klp.card.term,
      topicKeys: r.klp.topics.map((t) => t.klt.normalizedName),
    })
  }

  return shapeMissedWork({
    klps,
    topicNames,
    knowledge: Object.fromEntries(
      states.map((s) => [s.klpId, { pKnown: s.pKnown, observations: s.observations }]),
    ),
    results: results.map((r) => ({
      klpId: r.klpId,
      status: r.status,
      mode: r.mode,
      createdAt: r.createdAt,
      errorTypes: typesByAttempt.get(`${r.quizAnswerId}:${r.klpId}`) ?? [],
    })),
    floor: thresholds.minObservations,
  })
}
