import { describe, it, expect } from 'vitest'
import { ANSWERED_ATTEMPT_WHERE, QUIZ_HISTORY_WHERE } from '@/lib/quiz/history'

describe('QUIZ_HISTORY_WHERE', () => {
  it('excludes diagnostics from the surfaces that mean "quizzes you took"', () => {
    // A submitted diagnostic creates a QuizAttempt (mode 'diagnostic') purely
    // as the anchor AnswerKlpResult's required FK needs. It is not a quiz, and
    // listing it under the quiz icon or folding it into per-mode quiz averages
    // would mislabel it.
    expect(QUIZ_HISTORY_WHERE.mode).toEqual({ not: 'diagnostic' })
  })

  it('still requires an answered attempt', () => {
    expect(QUIZ_HISTORY_WHERE.answers).toEqual({ some: {} })
  })

  it('leaves ANSWERED_ATTEMPT_WHERE alone', () => {
    // That one is ALSO the repeatBonus window (loadAnsweredAttemptIds), where
    // a diagnostic sitting MUST count — a mistake made in a diagnostic is
    // still a repeat of a mistake, and narrowing it there would make the same
    // tag score differently depending on which activity produced the error.
    // Its own doc warns that over-applying is the dangerous direction here.
    expect(ANSWERED_ATTEMPT_WHERE).toEqual({ answers: { some: {} } })
    expect('mode' in ANSWERED_ATTEMPT_WHERE).toBe(false)
  })
})
