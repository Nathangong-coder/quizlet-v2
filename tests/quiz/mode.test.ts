import { describe, it, expect } from 'vitest'
import { QUIZ_MODES, toStudySource, toQuizMode } from '@/lib/quiz/mode'

describe('toStudySource', () => {
  it('maps every quiz mode to a study source', () => {
    expect(toStudySource('multiple-choice')).toBe('quiz-mc')
    expect(toStudySource('short-answer')).toBe('quiz-sa')
    expect(toStudySource('true-false')).toBe('quiz-tf')
    expect(toStudySource('matching')).toBe('matching')
  })

  it('is TOTAL — no quiz mode maps to undefined', () => {
    // The mapping spans two persisted String vocabularies, so the type system
    // cannot catch a missing case. Adding a quiz mode without a study source
    // would produce EVIDENCE_STRENGTH[undefined] and a NaN credit, silently.
    for (const mode of QUIZ_MODES) {
      expect(toStudySource(mode)).toBeDefined()
    }
  })

  it('never returns a study source that is not quiz-originated', () => {
    // 'review' and 'lesson' are study sources with no quiz mode. If one ever
    // appeared here it would mean the mapping had been written backwards.
    const produced = QUIZ_MODES.map(toStudySource)
    expect(produced).not.toContain('review')
    expect(produced).not.toContain('lesson')
  })
})

describe('toQuizMode', () => {
  it('round-trips every quiz mode through its study source', () => {
    for (const mode of QUIZ_MODES) {
      expect(toQuizMode(toStudySource(mode))).toBe(mode)
    }
  })

  it('maps the study sources a QuizAnswer can actually store', () => {
    expect(toQuizMode('quiz-sa')).toBe('short-answer')
    expect(toQuizMode('quiz-mc')).toBe('multiple-choice')
    expect(toQuizMode('quiz-tf')).toBe('true-false')
  })

  it('returns null for a source with no quiz mode rather than guessing', () => {
    // A caller must turn this into a filter that matches nothing. Guessing a
    // mode here would attribute review answers to a quiz.
    expect(toQuizMode('review')).toBeNull()
    expect(toQuizMode('lesson')).toBeNull()
  })

  it('returns null for an unrecognized string', () => {
    // `HistoryScope.source` comes from a URL param, so it is arbitrary text.
    expect(toQuizMode('short-answer')).toBeNull()
    expect(toQuizMode('garbage')).toBeNull()
  })
})

describe('diagnostic', () => {
  it('round-trips, because a submitted diagnostic writes QuizAnswer rows', () => {
    expect(toStudySource('diagnostic')).toBe('diagnostic')
    expect(toQuizMode('diagnostic')).toBe('diagnostic')
  })

  it('is not null — null here silently empties every diagnostic-scoped query', () => {
    // buildQuizAnswerScopeWhere (src/lib/memory/scope.ts) translates a scope's
    // StudyEvent sources into QuizAnswer.mode values through toQuizMode, and
    // treats null as "match nothing". That was true of 'diagnostic' until the
    // diagnostic started writing answers; leaving it null would make
    // /profile/memory scoped to diagnostic read as "no activity" rather than
    // as an error.
    expect(toQuizMode('diagnostic')).not.toBeNull()
  })

  it('is the one mode whose two vocabularies share a spelling', () => {
    // Worth pinning: the bridge exists precisely because the two String
    // vocabularies are otherwise different, and a reader could reasonably
    // assume this entry was a copy-paste slip.
    expect(toStudySource('diagnostic')).toBe('diagnostic')
  })
})
