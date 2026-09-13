import { describe, it, expect } from 'vitest'
import {
  CONTAMINATION_TYPES,
  CONTAMINATION_MAX_DOCK,
  contaminationFactor,
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

describe('contaminationFactor', () => {
  it('is exactly 1 for a clean answer — credit is byte-identical to before', () => {
    expect(contaminationFactor([])).toBe(1)
    expect(isContaminated([])).toBe(false)
  })

  it('docks by CONTAMINATION_MAX_DOCK at the top of the severity scale', () => {
    expect(contaminationFactor([tag({ severity: 5 })])).toBeCloseTo(1 - CONTAMINATION_MAX_DOCK)
  })

  it('docks proportionally below it', () => {
    expect(contaminationFactor([tag({ severity: 1 })])).toBeCloseTo(1 - CONTAMINATION_MAX_DOCK / 5)
  })

  it('IGNORES a tag already attached to a key point — that point is scored already', () => {
    expect(contaminationFactor([tag({ klpId: 'k1' })])).toBe(1)
  })

  it('IGNORES clarity and conciseness — delivery is not truth', () => {
    // Docking knowledge credit for verbosity folds two axes into one number.
    expect(contaminationFactor([tag({ dimension: 'clarity', type: 'rambling' })])).toBe(1)
    expect(contaminationFactor([tag({ dimension: 'conciseness', type: 'padding' })])).toBe(1)
  })

  it('IGNORES a whole-answer omission tag', () => {
    expect(contaminationFactor([tag({ type: 'omission' })])).toBe(1)
  })

  it('takes the WORST tag, not the sum — two asides are not twice disqualifying', () => {
    const two = [tag({ severity: 2 }), tag({ severity: 4, type: 'fabrication' })]
    expect(contaminationFactor(two)).toBeCloseTo(contaminationFactor([tag({ severity: 4 })]))
  })

  it('never reaches zero — a contaminated answer is worse evidence, not no evidence', () => {
    expect(contaminationFactor([tag({ severity: 5 })])).toBeGreaterThan(0)
  })

  it('THE ANCHOR: worst contamination equals the credit of a `partial` answer', () => {
    // This is what makes CONTAMINATION_MAX_DOCK checkable rather than a number
    // to be trusted. An answer that states every key point and asserts a
    // maximally serious falsehood is worth exactly as much as one that only
    // half stated them. If STATUS_CREDIT.partial ever moves, this fails rather
    // than the anchor silently drifting away from the scale it is anchored to.
    const worstContaminated = klpCredit('passed', 'quiz-sa', contaminationFactor([tag({ severity: 5 })]))
    expect(worstContaminated).toBeCloseTo(klpCredit('partial', 'quiz-sa'))
    expect(CONTAMINATION_MAX_DOCK).toBeCloseTo(STATUS_CREDIT.partial)
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
    const contaminated = klpCredit('passed', 'quiz-sa', contaminationFactor([tag()]))
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
    const c = klpCredit('passed', 'quiz-sa', contaminationFactor([tag()]))
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
