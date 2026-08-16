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
  'quiz-mc': 'Quiz (Multiple Choice)',
  'quiz-sa': 'Quiz (Short Answer)',
  'quiz-tf': 'Quiz (True/False)',
  matching: 'Matching Game',
  lesson: 'Lesson',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}
