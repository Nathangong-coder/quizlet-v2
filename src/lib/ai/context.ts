/**
 * Renders the composite `LearnerProfile` (src/lib/memory/topic-profile.ts —
 * card-grain `LearnerCardProfile` + topic-grain `LearnerTopicProfile[]`) into
 * an ID-free text block for injection into AI prompts.
 *
 * Bucket *selection* within the card section is uncapped — every qualifying
 * card is included, not capped to a fixed count — but the rendered block as
 * a whole is capped at `MAX_PROFILE_CHARS`, truncated at a line boundary
 * (Spec 3, Task 17), so an unusually large profile can't blow the token
 * budget this block exists to respect.
 *
 * Never includes cardIds/userId/setId/klpId cuids — only human-readable term
 * text and aggregate stats. See docs/superpowers/plans/2026-07-04-persistent-
 * memory-and-prompting.md's "Compact, ID-free AI context" global constraint.
 */

import type { LearnerCardProfile, Trend } from '@/lib/memory/profile'
import type { LearnerProfile, LearnerTopicProfile } from '@/lib/memory/topic-profile'
import { EMPTY_SCOPE } from '@/lib/memory/scope'

const MODE_LABELS: Partial<Record<string, string>> = {
  'quiz-mc': 'MC',
  'quiz-tf': 'True/False',
  review: 'Review',
  matching: 'Matching',
}

function trendSuffix(trend: Trend): string {
  if (trend === 'improving') return '↑'
  if (trend === 'declining') return '↓'
  return 'flat'
}

function missPhrase(count: number): string {
  if (count === 1) return 'once'
  if (count === 2) return 'twice'
  return `${count} times`
}

function buildCardSection(cards: LearnerCardProfile): string {
  const lines: string[] = []

  lines.push(
    cards.setTitle
      ? `Learner snapshot (set: "${cards.setTitle}")`
      : 'Learner snapshot (all sets)',
  )

  if (cards.weak.length > 0) {
    const parts = cards.weak.map(
      (w) => `"${w.term}" (${w.confidence}, ${trendSuffix(w.trend)})`,
    )
    lines.push(`Weak (conf<=4): ${parts.join(', ')}`)
  }

  if (cards.fading.length > 0) {
    const parts = cards.fading.map(
      (f) => `"${f.term}" (was ${f.wasConfidence}, missed ${missPhrase(f.missCount)} this week)`,
    )
    lines.push(`Fading (due, slipping): ${parts.join(', ')}`)
  }

  if (cards.strong.length > 0) {
    const parts = cards.strong.map((s) => `"${s.term}" (${s.confidence})`)
    lines.push(`Strong: ${parts.join(', ')}`)
  }

  if (cards.starred.length > 0) {
    const parts = cards.starred.map((s) => `"${s.term}" (${s.confidence})`)
    lines.push(`Starred: ${parts.join(', ')}`)
  }

  const recentParts: string[] = []
  for (const m of cards.recent.byMode) {
    recentParts.push(`${MODE_LABELS[m.mode] ?? m.mode} ${m.accuracyPct}%`)
  }
  for (const g of cards.recent.graded) {
    recentParts.push(`short-answer avg ${g.avgScoreOutOfTen.toFixed(1)}/10`)
  }
  recentParts.push(`${cards.recent.streakDays}-day streak`)
  lines.push(`Recent: ${recentParts.join(' · ')}`)

  return lines.join('\n')
}

/**
 * Hard cap on the injected block. KLPs run 1-5 per card, so an uncapped topic
 * section would blow the very token budget this profile exists to respect.
 */
export const MAX_PROFILE_CHARS = 2000
export const MAX_TOPICS_IN_BLOCK = 8
/** |verbosityIndex| must exceed this before the block says anything about it. */
const VERBOSITY_SPEAK_THRESHOLD = 4

function verbosityClause(index: number): string {
  if (index > VERBOSITY_SPEAK_THRESHOLD) return ', tends to over-explain'
  if (index < -VERBOSITY_SPEAK_THRESHOLD) return ', tends to under-explain'
  return ''
}

function topicLines(topics: LearnerTopicProfile[]): string[] {
  return [...topics]
    // Weakest first; unknown knowledge last, since it is not evidence of weakness.
    .sort((a, b) => {
      if (a.knowledge === null) return 1
      if (b.knowledge === null) return -1
      return a.knowledge - b.knowledge
    })
    .slice(0, MAX_TOPICS_IN_BLOCK)
    .map((t) => {
      // A null knowledge is omitted entirely rather than rendered as 0% —
      // "not enough data" is not "knows nothing".
      const known = t.knowledge === null ? '' : ` ${Math.round(t.knowledge * 100)}%`
      return `- ${t.name}:${known || ' not yet assessed'}${verbosityClause(t.verbosityIndex)}`
    })
}

/** Truncate at a line boundary so the block never ends mid-sentence. */
function capTo(text: string, limit: number): string {
  if (text.length <= limit) return text
  const clipped = text.slice(0, limit)
  const lastNewline = clipped.lastIndexOf('\n')
  return lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped
}

export function profileToPromptBlock(profile: LearnerProfile): string {
  const cardSection = buildCardSection(profile.cards) // the existing logic, unchanged

  const lines = topicLines(profile.topics)
  const topicSection = lines.length === 0 ? '' : `\nBy topic:\n${lines.join('\n')}`

  // Spec 3 §14, defect 2. The card section is capped BEFORE the two are joined,
  // so the topic section is no longer sitting in the tail that gets clipped.
  // Previously they were concatenated first and the whole thing truncated from
  // the end, which meant an active learner whose card section alone reached
  // MAX_PROFILE_CHARS silently lost every topic line — the exact signal this
  // block was extended to carry, and invisible to every fixture with a small
  // card section.
  //
  // The reserve is exactly what the topics need, not a tuned constant. An
  // earlier draft held back a fixed 600 characters; mutation testing showed
  // that number could be set to zero without a single test noticing, because
  // `capTo` cuts at LINE boundaries and the card section is a handful of very
  // long lines (the whole `weak` list is one). A magic number no test can
  // justify is one a future reader will tune in the belief that it matters.
  const cappedCards = capTo(cardSection, Math.max(0, MAX_PROFILE_CHARS - topicSection.length))

  // Still capped as a whole: `topicLines` bounds the COUNT of topics but not
  // the length of their names, so a learner with very long category names can
  // overrun on the topic section alone.
  return capTo(`${cappedCards}${topicSection}`, MAX_PROFILE_CHARS)
}

/**
 * Builds a rendered LearnerProfile block for prompt injection, isolated so a
 * failure never breaks the AI call it's meant to enrich. Shared by every
 * call site that injects learner context into a prompt (quiz generation,
 * grading, session insights) — moved here from a private per-file helper so
 * it has one definition instead of one per caller.
 */
export async function safeProfileBlock(
  userId: string,
  setId: string,
  label: string,
): Promise<string | undefined> {
  try {
    // Spec 3 §14, defect 1. This used to pass `topics: []`, so topic-grain data
    // reached NO prompt however well the substrate computed it.
    //
    // Sourced from `getLearnerMetrics` rather than reassembled here, and that
    // is the whole point: the dashboard reads the same function, so the page
    // and the AI cannot end up describing different learners. It is the
    // heavier call, and it is the one that stays honest.
    const { getLearnerMetrics } = await import('@/lib/metrics/read')
    const metrics = await getLearnerMetrics({
      userId,
      scope: { ...EMPTY_SCOPE, setIds: [setId] },
    })
    return profileToPromptBlock(metrics.profile)
  } catch (err) {
    console.error(`buildLearnerProfile failed for ${label}:`, err)
    return undefined
  }
}
