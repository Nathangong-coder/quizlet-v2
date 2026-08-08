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

import { buildLearnerProfile, type LearnerCardProfile, type Trend } from '@/lib/memory/profile'
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
function capBlock(text: string): string {
  if (text.length <= MAX_PROFILE_CHARS) return text
  const clipped = text.slice(0, MAX_PROFILE_CHARS)
  const lastNewline = clipped.lastIndexOf('\n')
  return lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped
}

export function profileToPromptBlock(profile: LearnerProfile): string {
  const cardSection = buildCardSection(profile.cards) // the existing logic, unchanged

  const lines = topicLines(profile.topics)
  const topicSection = lines.length === 0 ? '' : `\nBy topic:\n${lines.join('\n')}`

  return capBlock(`${cardSection}${topicSection}`)
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
    const cards = await buildLearnerProfile({
      userId,
      scope: { ...EMPTY_SCOPE, setIds: [setId] },
    })
    // Topic-grain data isn't wired into this call site yet (Spec 3 read API
    // lives in lib/metrics/read.ts, not here) — an empty topics array keeps
    // this producing the exact same block as before Task 17.
    return profileToPromptBlock({ cards, topics: [] })
  } catch (err) {
    console.error(`buildLearnerProfile failed for ${label}:`, err)
    return undefined
  }
}
