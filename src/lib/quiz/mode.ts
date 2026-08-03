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
