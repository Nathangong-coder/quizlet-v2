import { describe, it, expect } from 'vitest'
import { STUDY_SOURCES, type StudySource } from '@/lib/memory/scoring'
import { SessionComputedSchema } from '@/lib/memory/insight'

/**
 * Spec 2a listed this under "Known drift risks, deliberately out of scope":
 * `insight.ts` re-listed the `StudySource` union as two literal `z.enum([...])`
 * arrays. Adding a study mode type-checked everywhere and then failed at
 * RUNTIME on `SessionInsight` parsing — on a shape the type system had already
 * accepted. These tests exist so that failure mode is a build failure instead.
 */

const computed = (mode: string) => ({
  itemCount: 1,
  byCategory: [],
  byMode: [{ mode, correct: 1, total: 1, avgScore: null, medianLatencyMs: null }],
  pacing: {
    medianLatencyMs: null,
    fastest: null,
    slowest: null,
    byMode: [{ mode, medianLatencyMs: null }],
  },
  confidence: { avgDelta: null, newlyMastered: [], dropped: [] },
  outliers: { rushed: [], laboured: [] },
})

describe('STUDY_SOURCES', () => {
  it('pins the modes that can write to study memory', () => {
    expect([...STUDY_SOURCES]).toEqual([
      'review', 'quiz-mc', 'quiz-sa', 'quiz-tf', 'matching', 'lesson', 'diagnostic',
    ])
  })

  it('is the source the StudySource type derives from', () => {
    // Compile-time: if the type stopped deriving from the const, one of these
    // assignments breaks.
    const fromConst: StudySource = STUDY_SOURCES[0]
    const toConst: (typeof STUDY_SOURCES)[number] = 'lesson' satisfies StudySource
    expect(fromConst).toBe('review')
    expect(toConst).toBe('lesson')
  })
})

describe('SessionComputedSchema accepts every StudySource', () => {
  it('parses each mode in BOTH byMode and pacing.byMode', () => {
    // Both, because the duplication was two separate literal arrays — fixing
    // one and missing the other is the exact half-fix this guards against.
    for (const mode of STUDY_SOURCES) {
      const parsed = SessionComputedSchema.safeParse(computed(mode))
      expect(parsed.success, `${mode} must parse`).toBe(true)
    }
  })

  it('still rejects a mode outside the vocabulary', () => {
    // The enum must stay closed — deriving it from the const must not have
    // widened it to `z.string()`.
    expect(SessionComputedSchema.safeParse(computed('quiz-essay')).success).toBe(false)
  })
})
