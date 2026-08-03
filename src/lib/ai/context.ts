/**
 * Renders a `LearnerProfile` (src/lib/memory/profile.ts) into an ID-free
 * text block for injection into AI prompts. Uncapped — every qualifying
 * card is included, not truncated to a fixed length.
 *
 * Never includes cardIds/userId/setId cuids — only human-readable term text
 * and aggregate stats. See docs/superpowers/plans/2026-07-04-persistent-
 * memory-and-prompting.md's "Compact, ID-free AI context" global constraint.
 */

import { buildLearnerProfile, type LearnerProfile, type Trend } from '@/lib/memory/profile'

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

export function profileToPromptBlock(profile: LearnerProfile): string {
  const lines: string[] = []

  lines.push(
    profile.setTitle
      ? `Learner snapshot (set: "${profile.setTitle}")`
      : 'Learner snapshot (all sets)',
  )

  if (profile.weak.length > 0) {
    const parts = profile.weak.map(
      (w) => `"${w.term}" (${w.confidence}, ${trendSuffix(w.trend)})`,
    )
    lines.push(`Weak (conf<=4): ${parts.join(', ')}`)
  }

  if (profile.fading.length > 0) {
    const parts = profile.fading.map(
      (f) => `"${f.term}" (was ${f.wasConfidence}, missed ${missPhrase(f.missCount)} this week)`,
    )
    lines.push(`Fading (due, slipping): ${parts.join(', ')}`)
  }

  if (profile.strong.length > 0) {
    const parts = profile.strong.map((s) => `"${s.term}" (${s.confidence})`)
    lines.push(`Strong: ${parts.join(', ')}`)
  }

  if (profile.starred.length > 0) {
    const parts = profile.starred.map((s) => `"${s.term}" (${s.confidence})`)
    lines.push(`Starred: ${parts.join(', ')}`)
  }

  const recentParts: string[] = []
  for (const m of profile.recent.byMode) {
    recentParts.push(`${MODE_LABELS[m.mode] ?? m.mode} ${m.accuracyPct}%`)
  }
  for (const g of profile.recent.graded) {
    recentParts.push(`short-answer avg ${g.avgScoreOutOfTen.toFixed(1)}/10`)
  }
  recentParts.push(`${profile.recent.streakDays}-day streak`)
  lines.push(`Recent: ${recentParts.join(' · ')}`)

  return lines.join('\n')
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
    const profile = await buildLearnerProfile({ userId, setId })
    return profileToPromptBlock(profile)
  } catch (err) {
    console.error(`buildLearnerProfile failed for ${label}:`, err)
    return undefined
  }
}
