import { describe, it, expect } from 'vitest'
import {
  CONTAMINATION_TYPES,
  CONTAMINATION_MAX_DOCK,
  contaminationFactor,
  contaminationFactorFromTags,
  isContaminated,
  isContaminationType,
  type ContaminationInput,
} from '@/lib/errors/contamination'
import { ACCURACY_TYPES } from '@/lib/errors/taxonomy'
import { klpCredit, STATUS_CREDIT } from '@/lib/errors/klp-credit'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'

const tag = (over: Partial<ContaminationInput> = {}): ContaminationInput => ({
  dimension: 'accuracy',
  type: 'factual_error',
  klpId: null,
  severity: 5,
  ...over,
})

describe('CONTAMINATION_TYPES', () => {
  it('is a strict subset of the PERSISTED accuracy vocabulary', () => {
    // These strings live in AnswerErrorTag.type. A rename strands existing rows,
    // so drift has to be a build failure rather than silent corruption — the
    // same guard CORRUPTIONS carries against ACCURACY_TYPES.
    for (const t of CONTAMINATION_TYPES) expect(ACCURACY_TYPES).toContain(t)
    expect(CONTAMINATION_TYPES.length).toBeLessThan(ACCURACY_TYPES.length)
  })

  it('EXCLUDES the absence types — they are what the key points already measure', () => {
    // omission and incomplete describe what is missing, and a key point's own
    // failed/partial status already expresses exactly that. Docking for them
    // would penalise one mistake twice.
    expect(isContaminationType('omission')).toBe(false)
    expect(isContaminationType('incomplete')).toBe(false)
  })

  it('excludes conflation, which is never a whole-answer tag', () => {
    // It carries a secondaryKlpId, so it is inherently about two named points.
    expect(isContaminationType('conflation')).toBe(false)
  })

  it('includes the assertion types', () => {
    for (const t of ['factual_error', 'fabrication', 'inversion', 'overgeneralization']) {
      expect(isContaminationType(t)).toBe(true)
    }
  })
})

describe('contaminationFactorFromTags — the tag path', () => {
  it('is exactly 1 for a clean answer — credit is byte-identical to before', () => {
    expect(contaminationFactorFromTags([])).toBe(1)
    expect(isContaminated({ tags: [], unwarranted: [] })).toBe(false)
  })

  it('docks by CONTAMINATION_MAX_DOCK at the top of the severity scale', () => {
    expect(contaminationFactorFromTags([tag({ severity: 5 })])).toBeCloseTo(1 - CONTAMINATION_MAX_DOCK)
  })

  it('docks proportionally below it', () => {
    expect(contaminationFactorFromTags([tag({ severity: 1 })])).toBeCloseTo(1 - CONTAMINATION_MAX_DOCK / 5)
  })

  it('IGNORES a tag already attached to a key point — that point is scored already', () => {
    expect(contaminationFactorFromTags([tag({ klpId: 'k1' })])).toBe(1)
  })

  it('IGNORES clarity and conciseness — delivery is not truth', () => {
    // Docking knowledge credit for verbosity folds two axes into one number.
    expect(contaminationFactorFromTags([tag({ dimension: 'clarity', type: 'rambling' })])).toBe(1)
    expect(contaminationFactorFromTags([tag({ dimension: 'conciseness', type: 'padding' })])).toBe(1)
  })

  it('IGNORES a whole-answer omission tag', () => {
    expect(contaminationFactorFromTags([tag({ type: 'omission' })])).toBe(1)
  })

  it('takes the WORST tag, not the sum — two asides are not twice disqualifying', () => {
    const two = [tag({ severity: 2 }), tag({ severity: 4, type: 'fabrication' })]
    expect(contaminationFactorFromTags(two)).toBeCloseTo(contaminationFactorFromTags([tag({ severity: 4 })]))
  })

  it('never reaches zero — a contaminated answer is worse evidence, not no evidence', () => {
    expect(contaminationFactorFromTags([tag({ severity: 5 })])).toBeGreaterThan(0)
  })

  it('THE ANCHOR: worst contamination equals the credit of a `partial` answer', () => {
    // This is what makes CONTAMINATION_MAX_DOCK checkable rather than a number
    // to be trusted. An answer that states every key point and asserts a
    // maximally serious falsehood is worth exactly as much as one that only
    // half stated them. If STATUS_CREDIT.partial ever moves, this fails rather
    // than the anchor silently drifting away from the scale it is anchored to.
    const worstContaminated = klpCredit('passed', 'quiz-sa', contaminationFactorFromTags([tag({ severity: 5 })]))
    expect(worstContaminated).toBeCloseTo(klpCredit('partial', 'quiz-sa'))
    expect(CONTAMINATION_MAX_DOCK).toBeCloseTo(STATUS_CREDIT.partial)
  })
})

describe('contaminationFactor — unwarranted claims (Spec 5 §3)', () => {
  // The claim list is the contamination check made first-class: a 1-10
  // magnitude per instance, mapped onto the same 1-5 band tags resolve to.
  it('is exactly 1 with no tags and no claims', () => {
    expect(contaminationFactor({ tags: [], unwarranted: [] })).toBe(1)
    expect(isContaminated({ tags: [], unwarranted: [] })).toBe(false)
  })

  it('the object form with only tags equals the tag-only function', () => {
    const tags = [tag({ severity: 3 })]
    expect(contaminationFactor({ tags, unwarranted: [] })).toBe(contaminationFactorFromTags(tags))
  })

  it('a magnitude-10 claim docks exactly as a severity-5 tag does', () => {
    expect(contaminationFactor({ tags: [], unwarranted: [{ magnitude: 10 }] }))
      .toBe(contaminationFactorFromTags([tag({ severity: 5 })]))
    expect(contaminationFactor({ tags: [], unwarranted: [{ magnitude: 10 }] }))
      .toBeCloseTo(1 - CONTAMINATION_MAX_DOCK)
  })

  it('maps the 1-10 magnitude onto the 1-5 band by halves, rounding up', () => {
    const at = (magnitude: number) => contaminationFactor({ tags: [], unwarranted: [{ magnitude }] })
    expect(at(1)).toBeCloseTo(1 - CONTAMINATION_MAX_DOCK / 5)
    expect(at(2)).toBeCloseTo(at(1))
    expect(at(3)).toBeCloseTo(1 - (CONTAMINATION_MAX_DOCK * 2) / 5)
    expect(at(9)).toBeCloseTo(at(10))
  })

  it('clamps an out-of-range magnitude into the scale rather than over-docking', () => {
    const at = (magnitude: number) => contaminationFactor({ tags: [], unwarranted: [{ magnitude }] })
    expect(at(0)).toBeCloseTo(at(1))
    expect(at(15)).toBeCloseTo(at(10))
  })

  it('takes the WORST source across tags and claims, never the sum', () => {
    const mild = [tag({ severity: 2 })]
    expect(contaminationFactor({ tags: mild, unwarranted: [{ magnitude: 10 }] }))
      .toBeCloseTo(contaminationFactor({ tags: [], unwarranted: [{ magnitude: 10 }] }))
    expect(contaminationFactor({ tags: [tag({ severity: 5 })], unwarranted: [{ magnitude: 1 }] }))
      .toBeCloseTo(contaminationFactorFromTags([tag({ severity: 5 })]))
    expect(contaminationFactor({ tags: [], unwarranted: [{ magnitude: 4 }, { magnitude: 8 }] }))
      .toBeCloseTo(contaminationFactor({ tags: [], unwarranted: [{ magnitude: 8 }] }))
  })

  it('a claim contaminates even when every tag is ignorable', () => {
    // A key-point-scoped tag or a clarity tag is not contamination; the claim
    // list is, on its own.
    const ignorable = [tag({ klpId: 'k1' }), tag({ dimension: 'clarity', type: 'rambling' })]
    expect(contaminationFactor({ tags: ignorable, unwarranted: [] })).toBe(1)
    expect(isContaminated({ tags: ignorable, unwarranted: [{ magnitude: 3 }] })).toBe(true)
  })
})

describe('klpCredit with the negative check', () => {
  it('defaults to 1, so every existing caller is unchanged', () => {
    expect(klpCredit('passed', 'quiz-sa')).toBe(klpCredit('passed', 'quiz-sa', 1))
  })

  it('THE BUG: a contaminated answer no longer scores full positive evidence', () => {
    // Measured on the live database before this existed: an answer satisfying
    // every key point AND asserting something false was recorded as full
    // positive evidence on every point, so the learner's mastery ROSE for
    // having said something wrong.
    const clean = klpCredit('passed', 'quiz-sa')
    const contaminated = klpCredit('passed', 'quiz-sa', contaminationFactorFromTags([tag()]))
    expect(contaminated).toBeLessThan(clean)
  })

  it('keeps `failed` at 0 in every mode and under every factor', () => {
    // A wrong answer cannot be made more or less wrong by what else it said.
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf', 'diagnostic'] as const) {
      expect(klpCredit('failed', mode, 0.5)).toBe(0)
      expect(klpCredit('failed', mode, 1)).toBe(0)
    }
  })

  it('stays inside [0, 1] with no clamp, because the factor multiplies', () => {
    const c = klpCredit('passed', 'quiz-sa', contaminationFactorFromTags([tag()]))
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThanOrEqual(1)
  })
})

describe('the grading prompt actually asks for it', () => {
  const built = GRADE_SHORT_ANSWER_PROMPT.build({
    // Only term and definition are read on this branch.
    card: { term: 'T', definition: 'D' } as never,
    answer: 'A',
    klps: [{ ref: 0, text: 'a point', kind: 'definition' }],
  })

  it('tells the grader that covering every point is not the same as being right', () => {
    // A dock for a tag the grader never emits is a dock that never happens. The
    // instruction was previously implicit: the prompt described the MECHANICS of
    // a whole-answer tag without ever telling the grader to look for one.
    expect(built).toContain('CAN STILL BE WRONG')
    expect(built).toContain('klpRef OMITTED')
  })

  it('does not ask for it when there are no key points to cover', () => {
    const rubricOnly = GRADE_SHORT_ANSWER_PROMPT.build({
      card: { term: 'T', definition: 'D' } as never,
      answer: 'A',
    })
    expect(rubricOnly).not.toContain('CAN STILL BE WRONG')
  })
})
