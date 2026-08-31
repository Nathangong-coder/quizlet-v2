/**
 * Display names for `StudyEvent.source`.
 *
 * Lived in `ScopeBar` until that component was replaced. It is data, not
 * presentation, and two components need it — the feed rows and the by-mode
 * control — so it sits here rather than being re-exported from whichever
 * component happens to survive.
 */
export const SOURCE_LABELS: Record<string, string> = {
  review: 'Review',
  'quiz-mc': 'Multiple Choice',
  'quiz-sa': 'Short Answer',
  'quiz-tf': 'True/False',
  matching: 'Matching',
  lesson: 'Lesson',
  diagnostic: 'Diagnostic test',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

/**
 * Order for the activity-type picker, and the split within it.
 *
 * `questions` are the modes that ask you something and grade the answer;
 * `other` is everything else. They are listed as one group with a rule between
 * them rather than as two controls — a learner filtering their history is
 * asking one question ("which activities?"), not two.
 *
 * Explicit and ordered, NOT derived from whatever sources happen to exist in
 * the data. The by-mode chips this replaced were data-driven, so the options
 * moved around as counts changed and a mode you had not tried yet was simply
 * absent — which reads as the filter being broken rather than the shelf being
 * empty.
 */
export const SOURCE_GROUPS: { questions: string[]; other: string[] } = {
  questions: ['quiz-mc', 'quiz-sa', 'quiz-tf', 'matching', 'diagnostic'],
  other: ['review', 'lesson'],
}

/** Every selectable source, in display order. */
export const ORDERED_SOURCES: string[] = [...SOURCE_GROUPS.questions, ...SOURCE_GROUPS.other]
