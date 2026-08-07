import type { StudySource } from '@/lib/memory/scoring'

/**
 * Quiz modes as persisted on `QuizAnswer.mode` and `QuizQuestion.mode`.
 *
 * These are a DIFFERENT vocabulary from the memory layer's `StudySource`
 * (`StudyEvent.source`), and both are already in the database. This module is
 * the single bridge between them — previously the translation was inlined at
 * every call site, which is exactly how two string vocabularies drift.
 */
export const QUIZ_MODES = [
  'multiple-choice', 'short-answer', 'true-false', 'matching',
] as const

export type QuizMode = (typeof QUIZ_MODES)[number]

const TO_STUDY_SOURCE: Record<QuizMode, StudySource> = {
  'multiple-choice': 'quiz-mc',
  'short-answer': 'quiz-sa',
  'true-false': 'quiz-tf',
  matching: 'matching',
}

/** The memory layer's name for a quiz mode. Total over QUIZ_MODES. */
export function toStudySource(mode: QuizMode): StudySource {
  return TO_STUDY_SOURCE[mode]
}

/**
 * INVERTED from `TO_STUDY_SOURCE` rather than written out a second time — a
 * hand-maintained second table is exactly how the two vocabularies drift, and
 * drift here is silent (a `where` clause that matches nothing, not an error).
 */
const FROM_STUDY_SOURCE = Object.fromEntries(
  (Object.entries(TO_STUDY_SOURCE) as [QuizMode, StudySource][]).map(
    ([mode, source]) => [source, mode],
  ),
) as Partial<Record<StudySource, QuizMode>>

/**
 * The quiz layer's name for a study source, or `null` when the source has no
 * quiz mode at all (`review`, `lesson`).
 *
 * PARTIAL by design: `StudySource` is the wider vocabulary. `null` is a real
 * answer meaning "no QuizAnswer row can ever carry this source", and callers
 * must translate it into a filter that matches nothing — NOT drop the filter,
 * which would silently widen the query back to every mode.
 */
export function toQuizMode(source: StudySource | string): QuizMode | null {
  return FROM_STUDY_SOURCE[source as StudySource] ?? null
}
