/**
 * The CARD-grain learner snapshot. Spec 3 adds a topic-grain profile
 * (src/lib/memory/topic-profile.ts) and a composite `LearnerProfile` that
 * holds both — this one deliberately keeps its narrow, card-level meaning.
 *
 * This is consumed by `lib/ai/context.ts` (`profileToPromptBlock`) to inject
 * a bounded, human-readable summary into AI prompts — the model must never
 * see raw cuids, only card `term` text.
 *
 * Design note (per Stage 6 Task 3 brief): the DB-querying shell
 * (`buildLearnerProfile`) is intentionally thin. All real logic — bucketing,
 * trend classification, streaks, accuracy — lives in `shapeLearnerProfile`,
 * a pure function over already-fetched rows, so it can be unit-tested with
 * in-memory fixtures without a database. See tests/memory/profile.test.ts.
 */

import { eventCorrectness } from './scoring'
import type { StudySource } from './scoring'

// ---------------------------------------------------------------------------
// Thresholds. Bucket sizes are intentionally uncapped — every qualifying
// card is surfaced, not just the top few.
// ---------------------------------------------------------------------------

/** Confidence threshold at/below which a card is "weak". */
const WEAK_THRESHOLD = 4
/** Confidence threshold at/above which a card is "strong". */
const STRONG_THRESHOLD = 8

/**
 * How many of a card's most recent StudyEvents are considered when
 * classifying its trend (improving/flat/declining). Small window so a
 * single recent swing is visible without needing long history.
 */
const TREND_WINDOW = 5

/**
 * Minimum swing (0-1 correctness scale) between the early half and the late
 * half of the trend window required to call it "improving"/"declining"
 * rather than "flat". 0.25 means roughly a 1-in-4 shift in average
 * correctness — small sample sizes (2-3 events) can cross this on a single
 * flip, which is intentional: with so little data a flip *is* the signal.
 */
const TREND_THRESHOLD = 0.25

/** How far back (in days) a "miss" counts toward a fading card's miss count. */
const MISS_WINDOW_DAYS = 7

/** How far back (in days) "recent" accuracy/streak stats look. */
const RECENT_WINDOW_DAYS = 30

/**
 * Bound on how many StudyEvent rows `buildLearnerProfile` fetches from the
 * DB per user (optionally per set). This is the query's only cap — deep
 * enough to cover per-card trend windows and 30-day recent stats even for a
 * very active user, while still keeping the query bounded rather than
 * scanning a user's entire lifetime history on every call.
 */
export const RECENT_EVENTS_FETCH_CAP = 5000

export type Trend = 'improving' | 'flat' | 'declining'

export interface WeakTerm {
  term: string
  confidence: number
  mastery: number | null
  trend: Trend
}

export interface FadingTerm {
  term: string
  /** Confidence recorded before the recent decline (start of trend window). */
  wasConfidence: number
  /** Misses within the last MISS_WINDOW_DAYS days. */
  missCount: number
}

export interface StrongTerm {
  term: string
  confidence: number
}

export interface StarredTerm {
  term: string
  confidence: number
}

export interface ModeAccuracy {
  mode: StudySource
  accuracyPct: number
  count: number
}

export interface GradedAccuracy {
  mode: StudySource
  avgScoreOutOfTen: number
  count: number
}

export interface LearnerCardProfile {
  setId: string | null
  setTitle: string | null
  weak: WeakTerm[]
  fading: FadingTerm[]
  strong: StrongTerm[]
  starred: StarredTerm[]
  recent: {
    byMode: ModeAccuracy[]
    graded: GradedAccuracy[]
    streakDays: number
  }
}

/** Minimal shape of a CardProgress row (joined with the card's term text). */
export interface ProgressRow {
  cardId: string
  term: string
  confidence: number
  mastery: number | null
  starred: boolean
  dueAt: Date | null
}

/** Minimal shape of a StudyEvent row. */
export interface EventRow {
  cardId: string
  source: StudySource
  correct: boolean | null
  score: number | null
  confidenceAfter: number
  createdAt: Date
}

export interface ShapeLearnerProfileInput {
  setId?: string | null
  setTitle?: string | null
  /** Injectable clock for deterministic tests; defaults to `new Date()`. */
  now?: Date
  progress: ProgressRow[]
  events: EventRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function groupByCard(events: EventRow[]): Map<string, EventRow[]> {
  const map = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = map.get(e.cardId)
    if (list) list.push(e)
    else map.set(e.cardId, [e])
  }
  return map
}

function isMiss(event: EventRow): boolean {
  const c = eventCorrectness(event)
  return c !== null && c < 0.5
}

/**
 * Classifies a card's recent trend from its StudyEvents. Looks at the most
 * recent TREND_WINDOW scorable events, splits them into an early half and a
 * late half (chronologically), and compares average correctness. See
 * TREND_THRESHOLD for the swing required to call it improving/declining
 * rather than flat.
 *
 * Fewer than 2 scorable events -> 'flat' (insufficient data to call a trend).
 */
export function classifyTrend(cardEvents: EventRow[]): Trend {
  const recentDesc = [...cardEvents]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, TREND_WINDOW)

  const chronoScores = recentDesc
    .slice()
    .reverse()
    .map(eventCorrectness)
    .filter((v): v is number => v !== null)

  if (chronoScores.length < 2) return 'flat'

  const mid = Math.ceil(chronoScores.length / 2)
  const early = chronoScores.slice(0, mid)
  const late = chronoScores.slice(mid)

  const diff = average(late) - average(early)
  if (diff >= TREND_THRESHOLD) return 'improving'
  if (diff <= -TREND_THRESHOLD) return 'declining'
  return 'flat'
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000)
}

/**
 * Consecutive-day activity streak, counting backward from today. If there's
 * no activity yet today, the streak still counts through yesterday (a
 * streak isn't broken until a full day passes with zero activity).
 */
function computeStreakDays(events: EventRow[], now: Date): number {
  if (events.length === 0) return 0

  const activeDays = new Set(events.map((e) => dayKey(e.createdAt)))

  let cursor = now
  if (!activeDays.has(dayKey(cursor))) {
    cursor = addDays(cursor, -1)
    if (!activeDays.has(dayKey(cursor))) return 0
  }

  let streak = 0
  while (activeDays.has(dayKey(cursor))) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

const MODE_ORDER: StudySource[] = ['quiz-mc', 'quiz-tf', 'review', 'matching']

// ---------------------------------------------------------------------------
// The pure shaper — all real logic lives here.
// ---------------------------------------------------------------------------

export function shapeLearnerProfile(input: ShapeLearnerProfileInput): LearnerCardProfile {
  const now = input.now ?? new Date()
  const eventsByCard = groupByCard(input.events)

  const weak: WeakTerm[] = input.progress
    .filter((p) => p.confidence <= WEAK_THRESHOLD)
    .sort((a, b) => a.confidence - b.confidence)
    .map((p) => ({
      term: p.term,
      confidence: p.confidence,
      mastery: p.mastery,
      trend: classifyTrend(eventsByCard.get(p.cardId) ?? []),
    }))

  const strong: StrongTerm[] = input.progress
    .filter((p) => p.confidence >= STRONG_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .map((p) => ({ term: p.term, confidence: p.confidence }))

  const starred: StarredTerm[] = input.progress
    .filter((p) => p.starred)
    .sort((a, b) => a.confidence - b.confidence)
    .map((p) => ({ term: p.term, confidence: p.confidence }))

  const fading: FadingTerm[] = input.progress
    .filter((p) => p.dueAt !== null && p.dueAt.getTime() <= now.getTime())
    .map((p) => {
      const cardEvents = eventsByCard.get(p.cardId) ?? []
      return { p, cardEvents, trend: classifyTrend(cardEvents) }
    })
    .filter((x) => x.trend === 'declining')
    .map(({ p, cardEvents }) => {
      const chronological = [...cardEvents].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )
      const windowed = chronological.slice(-TREND_WINDOW)
      const wasConfidence = windowed.length > 0 ? windowed[0].confidenceAfter : p.confidence

      const missWindowStart = now.getTime() - MISS_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const missCount = cardEvents.filter(
        (e) => e.createdAt.getTime() >= missWindowStart && isMiss(e),
      ).length

      return { term: p.term, wasConfidence, missCount }
    })

  // --- Recent accuracy / volume stats (last RECENT_WINDOW_DAYS days) -------
  const recentWindowStart = now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const recentEvents = input.events.filter((e) => e.createdAt.getTime() >= recentWindowStart)

  const byMode: ModeAccuracy[] = []
  for (const mode of MODE_ORDER) {
    const modeEvents = recentEvents.filter((e) => e.source === mode && e.correct !== null)
    if (modeEvents.length === 0) continue
    const correctCount = modeEvents.filter((e) => e.correct === true).length
    byMode.push({
      mode,
      accuracyPct: Math.round((correctCount / modeEvents.length) * 100),
      count: modeEvents.length,
    })
  }

  const graded: GradedAccuracy[] = []
  const gradedEvents = recentEvents.filter((e) => e.source === 'quiz-sa' && e.score !== null)
  if (gradedEvents.length > 0) {
    const avg = average(gradedEvents.map((e) => e.score as number))
    graded.push({
      mode: 'quiz-sa',
      avgScoreOutOfTen: Math.round((avg / 10) * 10) / 10,
      count: gradedEvents.length,
    })
  }

  const streakDays = computeStreakDays(input.events, now)

  return {
    setId: input.setId ?? null,
    setTitle: input.setTitle ?? null,
    weak,
    fading,
    strong,
    starred,
    recent: { byMode, graded, streakDays },
  }
}

// ---------------------------------------------------------------------------
// Thin DB-querying shell. Deliberately untested here (no DB-mocking
// precedent exists in this suite) — all logic lives in shapeLearnerProfile
// above, which is fully covered by tests/memory/profile.test.ts.
//
// `prisma` is imported dynamically (rather than as a top-level import) so
// that importing this module for its pure exports (shapeLearnerProfile,
// classifyTrend, types) never touches `lib/db.ts`, which throws at import
// time if `DATABASE_URL` isn't set — vitest doesn't load `.env`, so a
// top-level import would break every test in this file, not just DB tests.
// ---------------------------------------------------------------------------

export async function buildLearnerProfile({
  userId,
  setId,
}: {
  userId: string
  setId?: string
}): Promise<LearnerCardProfile> {
  const { prisma } = await import('@/lib/db')
  const cardFilter = setId ? { card: { setId } } : {}

  const [progressRows, eventRows, set] = await Promise.all([
    prisma.cardProgress.findMany({
      where: { userId, ...cardFilter },
      select: {
        cardId: true,
        confidence: true,
        mastery: true,
        starred: true,
        dueAt: true,
        card: { select: { term: true } },
      },
    }),
    prisma.studyEvent.findMany({
      where: { userId, ...cardFilter },
      orderBy: { createdAt: 'desc' },
      take: RECENT_EVENTS_FETCH_CAP,
      select: {
        cardId: true,
        source: true,
        correct: true,
        score: true,
        confidenceAfter: true,
        createdAt: true,
      },
    }),
    setId ? prisma.set.findUnique({ where: { id: setId }, select: { title: true } }) : null,
  ])

  const progress: ProgressRow[] = progressRows.map((p) => ({
    cardId: p.cardId,
    term: p.card.term,
    confidence: p.confidence,
    mastery: p.mastery,
    starred: p.starred,
    dueAt: p.dueAt,
  }))

  const events: EventRow[] = eventRows.map((e) => ({
    cardId: e.cardId,
    source: e.source as StudySource,
    correct: e.correct,
    score: e.score,
    confidenceAfter: e.confidenceAfter,
    createdAt: e.createdAt,
  }))

  return shapeLearnerProfile({
    setId: setId ?? null,
    setTitle: set?.title ?? null,
    progress,
    events,
  })
}
