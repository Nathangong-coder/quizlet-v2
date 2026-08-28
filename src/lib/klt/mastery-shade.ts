/**
 * Mastery as shading — the Atlas direction's one load-bearing idea.
 *
 * A concept map you authored is a picture of a subject. Shaded by what you
 * actually know, it becomes a picture of YOU, which is the whole reason to put
 * a map on a study page rather than a list.
 */

export type MasteryShade = 'unknown' | 'weak' | 'developing' | 'solid' | 'strong'

/** Weakest first. `unknown` is deliberately NOT on this scale — see below. */
export const MASTERY_SHADES = ['weak', 'developing', 'solid', 'strong'] as const

/**
 * Upper bounds, EXCLUSIVE. A knowledge of exactly 0.5 is `developing`, not
 * `weak`: bands that overlap at their edges make two adjacent concepts with
 * identical numbers render differently depending on which comparison ran first.
 */
const BANDS: { below: number; shade: MasteryShade }[] = [
  { below: 0.35, shade: 'weak' },
  { below: 0.6, shade: 'developing' },
  { below: 0.85, shade: 'solid' },
]

/**
 * NULL MAPS TO `unknown`, NEVER TO `weak`. This is the single most important
 * line in this module.
 *
 * Null means no KLP under that concept cleared the learner's own observation
 * floor — NO EVIDENCE, which is a different claim from BAD EVIDENCE. Reading it
 * as 0 (the obvious `knowledge ?? 0`) paints every untouched concept in the
 * alarm colour, so a freshly authored set renders as a wall of red before a
 * single question has been answered. The learner then learns to ignore the
 * shading, and the feature is worse than not shipping it.
 *
 * The same rule is already stated in four other places, which is why it now has
 * a test that fails loudly rather than a comment that does not:
 *   - `pickWeakCategories` DROPS null topics rather than ranking them worst
 *   - `SetStudySummary.averageConfidence` is null, never 0, for an unstudied set
 *   - `LearnerTopicProfile.knowledge` is nullable to express exactly this
 *   - `computeArticulation` pins readiness to null when analyzedAnswers === 0
 *
 * A knowledge of 0 IS `weak` — that is measured, and being measured at zero is
 * real information. Only the absence of measurement is `unknown`.
 */
export function shadeForKnowledge(knowledge: number | null): MasteryShade {
  if (knowledge === null || Number.isNaN(knowledge)) return 'unknown'
  for (const band of BANDS) {
    if (knowledge < band.below) return band.shade
  }
  return 'strong'
}

/**
 * Tailwind classes per shade.
 *
 * `unknown` is a HATCHED OUTLINE, not a grey fill. A grey fill sitting in a
 * scale that also contains colours reads as a low value ON that scale — it
 * looks like "nearly nothing" rather than "not measured", which is the same
 * misreading `knowledge ?? 0` produces, arrived at through the palette instead
 * of through the arithmetic.
 *
 * Colours come from the `--chart-*` tokens, which are already defined for both
 * themes. No raw hex: a stored or hardcoded colour ignores the theme and turns
 * unreadable in dark mode — the rule `node-style.ts` already follows.
 */
export const SHADE_CLASS: Record<MasteryShade, string> = {
  unknown: 'border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground',
  weak: 'border-chart-5/50 bg-chart-5/15 text-foreground',
  developing: 'border-chart-4/50 bg-chart-4/15 text-foreground',
  solid: 'border-chart-2/50 bg-chart-2/15 text-foreground',
  strong: 'border-chart-1/60 bg-chart-1/25 text-foreground',
}

export const SHADE_LABEL: Record<MasteryShade, string> = {
  unknown: 'Not measured yet',
  weak: 'Weak',
  developing: 'Developing',
  solid: 'Solid',
  strong: 'Strong',
}
