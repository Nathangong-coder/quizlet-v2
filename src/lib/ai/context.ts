/**
 * Renders a `LearnerProfile` (src/lib/memory/profile.ts) into a compact,
 * ID-free, token-capped text block for injection into AI prompts.
 *
 * Never includes cardIds/userId/setId cuids — only human-readable term text
 * and aggregate stats. See docs/superpowers/plans/2026-07-04-persistent-
 * memory-and-prompting.md's "Compact, ID-free AI context" global constraint.
 */

import type { LearnerProfile, Trend } from '@/lib/memory/profile'

/**
 * Hard cap on the rendered block's length, enforced regardless of how the
 * `LearnerProfile` was constructed. `shapeLearnerProfile` already caps each
 * bucket (WEAK_CAP, STRONG_CAP, etc.) so in normal operation the block is
 * far smaller than this — this is a defensive backstop for any caller that
 * hands `profileToPromptBlock` a profile assembled by hand (e.g. tests, or
 * a future caller that skips the shaper), so the "fixed and enforced" token
 * budget holds even then. ~1200 chars is roughly 300 tokens, comfortably
 * bounded for a per-call context injection.
 */
export const MAX_PROMPT_BLOCK_CHARS = 1200

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

  const block = lines.join('\n')
  if (block.length <= MAX_PROMPT_BLOCK_CHARS) return block
  return `${block.slice(0, MAX_PROMPT_BLOCK_CHARS - 1)}…`
}
