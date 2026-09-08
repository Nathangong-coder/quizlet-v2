import { describe, it, expect } from 'vitest'
import {
  normalizeKlpText,
  buildCarryMap,
  planAnswerRegrade,
  summarizeRegrade,
  isRegradableMode,
  REGRADABLE_MODES,
  CARRY_ONLY_MODES,
  type PriorResult,
  type LiveKlp,
} from '@/lib/klp/regrade'
import { GRADED_KLP_MODES } from '@/lib/errors/klp-credit'
import { QUIZ_MODES, toStudySource } from '@/lib/quiz/mode'

const live = (...pairs: [string, string][]): LiveKlp[] => pairs.map(([id, text]) => ({ id, text }))

function prior(over: Partial<PriorResult> & { klpId: string; klpText: string }): PriorResult {
  return {
    status: 'passed',
    mode: 'quiz-sa',
    credit: 0.95,
    evidence: null,
    isLive: false,
    ...over,
  }
}

describe('mode vocabularies', () => {
  it('partitions every graded mode — a new one cannot default into either side', () => {
    // A mode silently defaulting into REGRADABLE would send provenance-derived
    // MC/TF evidence through a text grader; one defaulting to carry-only would
    // quietly stop re-grading a mode that could be.
    const covered = [...REGRADABLE_MODES, ...CARRY_ONLY_MODES]
    for (const mode of GRADED_KLP_MODES) expect(covered).toContain(mode)
    expect(new Set(covered).size).toBe(covered.length)
  })

  /**
   * THE GUARD THAT WAS MISSING, and the defect it now pins.
   *
   * `QuizAnswer.mode` stores a `QuizMode` ('short-answer'); `AnswerKlpResult`
   * and the whole memory layer store a `StudySource` ('quiz-sa'). The planner
   * reasons in `StudySource`. The first version of the loader compared the raw
   * column against `REGRADABLE_MODES`, matched nothing, and sent every
   * short-answer answer down the carry-only branch — DROPPING evidence it
   * could have re-graded, which is precisely the damage this job repairs.
   *
   * Every unit test passed, because they were all written with 'quiz-sa'. Only
   * a live dry-run showed it. This asserts the vocabulary the planner is fed.
   */
  it('classifies every QUIZ_MODE once translated, and none of them raw', () => {
    for (const quizMode of QUIZ_MODES) {
      const source = toStudySource(quizMode)
      const known = [...REGRADABLE_MODES, ...CARRY_ONLY_MODES, 'matching'] as string[]
      expect(known).toContain(source)
    }
    // The raw column values must NOT be re-gradable — reading them directly is
    // the bug, and it has to fail loudly rather than look like a strict policy.
    expect(isRegradableMode('short-answer')).toBe(false)
    expect(isRegradableMode('quiz-sa')).toBe(true)
  })

  it('leaves an unrecognised mode on the carry-only side, never re-graded', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'matching' as never,
      answerText: 'text',
      priorResults: [prior({ klpId: 'o', klpText: 'A', mode: 'matching' as never })],
      live: live(['n1', 'A'], ['n2', 'new']),
    })
    expect(plan.action).not.toBe('regrade')
  })

  it('never treats multiple choice or true/false as re-gradable', () => {
    expect(isRegradableMode('quiz-mc')).toBe(false)
    expect(isRegradableMode('quiz-tf')).toBe(false)
    expect(isRegradableMode('quiz-sa')).toBe(true)
  })

  it('never re-grades a DIAGNOSTIC answer, however gradable its text looks', () => {
    // SCOPE, not format. A diagnostic question probes exactly one key point,
    // but GRADE_SHORT_ANSWER_PROMPT judges the whole card — so re-grading one
    // invents evidence about points the learner was never asked about, almost
    // all of it negative. Measured on live data before this was caught: an
    // answer that correctly said "Gross Profit" was recorded as failing four
    // untouched points on EBIT, EBITDA and net income.
    expect(isRegradableMode('diagnostic')).toBe(false)
  })
})

describe('normalizeKlpText', () => {
  it('ignores whitespace and case — a reformat is not a change to the claim', () => {
    expect(normalizeKlpText('  EBIT   falls\nby 10. ')).toBe(normalizeKlpText('ebit falls by 10.'))
  })

  it('does NOT ignore wording — a different claim is a different key point', () => {
    expect(normalizeKlpText('EBIT falls by 10')).not.toBe(normalizeKlpText('EBIT falls by 12'))
  })
})

describe('buildCarryMap', () => {
  it('maps normalized text onto the live id', () => {
    const m = buildCarryMap(live(['k1', 'EBIT falls by 10'], ['k2', 'Net income falls by 6']))
    expect(m.get(normalizeKlpText('ebit falls by 10'))).toBe('k1')
  })

  it('REFUSES an ambiguous key rather than picking one', () => {
    // Two live points normalizing to the same string are a duplicate-point
    // hygiene defect. Carrying evidence onto whichever was written second is a
    // coin flip recorded as a fact.
    const m = buildCarryMap(live(['k1', 'EBIT falls by 10'], ['k2', 'ebit  falls  by 10']))
    expect(m.size).toBe(0)
  })
})

describe('planAnswerRegrade — the idempotency gate', () => {
  it('skips an answer whose evidence is already entirely on live key points', () => {
    // Re-grading is NOT deterministic, so a second run must not churn every
    // posterior for no new information.
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: 'some answer',
      priorResults: [prior({ klpId: 'k1', klpText: 'A', isLive: true })],
      live: live(['k1', 'A']),
    })
    expect(plan.action).toBe('skip')
    expect(plan.carried).toEqual([])
  })

  it('skips a card with no live key points rather than destroying its history', () => {
    // Reached whenever a card is mid-authoring or its extraction failed.
    // Dropping evidence on a transient state is not recoverable.
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: 'x',
      priorResults: [prior({ klpId: 'old', klpText: 'A' })],
      live: [],
    })
    expect(plan.action).toBe('skip')
    expect(plan.status).toBe('no_klps')
  })
})

describe('planAnswerRegrade — carry forward', () => {
  it('REMAPS a whole set whose text is unchanged, with no AI call', () => {
    // THE CASE THIS JOB EXISTS FOR. A typo fix on a card definition supersedes
    // every key point, giving them new ids; the propositions are identical.
    // Today that silently resets the learner's mastery to nothing.
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: 'some answer',
      priorResults: [
        prior({ klpId: 'old1', klpText: 'EBIT falls by 10' }),
        prior({ klpId: 'old2', klpText: 'Net income falls by 6', status: 'partial', credit: 0.475 }),
      ],
      live: live(['new1', 'EBIT falls by 10'], ['new2', 'Net income falls by 6']),
    })
    expect(plan.action).toBe('remap')
    expect(plan.carried).toEqual([
      expect.objectContaining({ fromKlpId: 'old1', toKlpId: 'new1', status: 'passed', credit: 0.95 }),
      expect.objectContaining({ fromKlpId: 'old2', toKlpId: 'new2', status: 'partial', credit: 0.475 }),
    ])
    expect(plan.droppedKlpIds).toEqual([])
    expect(plan.uncoveredKlpIds).toEqual([])
    expect(plan.status).toBe('analyzed')
  })

  it('preserves status, mode and credit exactly — neither input to credit moved', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-mc',
      answerText: null,
      priorResults: [prior({ klpId: 'old1', klpText: 'A', status: 'failed', mode: 'quiz-mc', credit: 0 })],
      live: live(['new1', 'A']),
    })
    expect(plan.carried[0]).toMatchObject({ status: 'failed', mode: 'quiz-mc', credit: 0 })
  })

  it('drops evidence whose proposition is gone, and never reassigns it', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-mc',
      answerText: null,
      priorResults: [
        prior({ klpId: 'old1', klpText: 'A', mode: 'quiz-mc' }),
        prior({ klpId: 'old2', klpText: 'B (deleted)', mode: 'quiz-mc' }),
      ],
      live: live(['new1', 'A'], ['new2', 'C (brand new)']),
    })
    expect(plan.action).toBe('carry_partial')
    expect(plan.carried).toHaveLength(1)
    expect(plan.droppedKlpIds).toEqual(['old2'])
    // The brand-new point gets NOTHING. Inferring that the learner's old wrong
    // pick diagnosed it would be a fabricated observation.
    expect(plan.uncoveredKlpIds).toEqual(['new2'])
  })

  it('drops a second prior competing for one live point rather than merging verdicts', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-mc',
      answerText: null,
      priorResults: [
        prior({ klpId: 'old1', klpText: 'A', status: 'passed', mode: 'quiz-mc' }),
        prior({ klpId: 'old2', klpText: 'a', status: 'failed', mode: 'quiz-mc' }),
      ],
      live: live(['new1', 'A']),
    })
    expect(plan.carried).toHaveLength(1)
    expect(plan.droppedKlpIds).toEqual(['old2'])
    expect(plan.warnings.map((w) => w.reason)).toContain('duplicate_carry_target')
  })
})

describe('planAnswerRegrade — never inferring MC/TF', () => {
  it.each(CARRY_ONLY_MODES)('never re-grades %s, even with uncovered key points', (mode) => {
    // Their diagnosis is distractor provenance pinned to a dead klpVersion.
    // `selectedOption` survives, but asking a model which NEW point it meant is
    // inference presented as provenance.
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode,
      answerText: 'B) something',
      priorResults: [prior({ klpId: 'old1', klpText: 'A', mode })],
      live: live(['new1', 'A'], ['new2', 'brand new point']),
    })
    expect(plan.action).not.toBe('regrade')
    expect(plan.warnings.map((w) => w.reason)).toContain('mode_cannot_be_regraded')
  })

  it('records no_provenance when a carry-only answer keeps nothing', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-tf',
      answerText: 'true',
      priorResults: [prior({ klpId: 'old1', klpText: 'gone', mode: 'quiz-tf' })],
      live: live(['new1', 'different']),
    })
    expect(plan.action).toBe('drop_all')
    // NOT 'analyzed': zero rows must not be readable as "analysed and clean",
    // or a legacy-heavy corpus reads as a better learner.
    expect(plan.status).toBe('no_provenance')
  })
})

describe('planAnswerRegrade — re-grading free text', () => {
  it('re-grades when the live set has points the carried evidence does not cover', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: 'the learner wrote this',
      priorResults: [prior({ klpId: 'old1', klpText: 'A' })],
      live: live(['new1', 'A'], ['new2', 'a genuinely new point']),
    })
    expect(plan.action).toBe('regrade')
    expect(plan.uncoveredKlpIds).toEqual(['new2'])
  })

  it('does NOT re-grade when carry-forward already covers every live point', () => {
    // The renumbering case: no new information is available from a second
    // grading, and a grader is not deterministic, so calling one is pure churn.
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: 'the learner wrote this',
      priorResults: [prior({ klpId: 'old1', klpText: 'A' }), prior({ klpId: 'old2', klpText: 'B' })],
      live: live(['new1', 'A'], ['new2', 'B']),
    })
    expect(plan.action).toBe('remap')
  })

  it('cannot re-grade an answer with no stored text, and says so', () => {
    const plan = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: '   ',
      priorResults: [prior({ klpId: 'old1', klpText: 'A' })],
      live: live(['new1', 'A'], ['new2', 'new']),
    })
    // `remap` describes what happened to the PRIOR EVIDENCE — all of it carried,
    // none dropped. The new point simply has no evidence, which is reported
    // separately and is the honest state rather than a guess.
    expect(plan.action).toBe('remap')
    expect(plan.uncoveredKlpIds).toEqual(['new2'])
    expect(plan.warnings.map((w) => w.reason)).toContain('no_answer_text_to_regrade')
  })
})

describe('summarizeRegrade', () => {
  it('counts AI calls as re-grades only — everything else is free', () => {
    const mk = (mode: 'quiz-sa' | 'quiz-mc', priorText: string, liveText: string) =>
      planAnswerRegrade({
        answerId: `${mode}-${priorText}`,
        mode,
        answerText: 'text',
        priorResults: [prior({ klpId: 'o', klpText: priorText, mode })],
        live: live(['n1', liveText], ['n2', 'extra point']),
      })

    const totals = summarizeRegrade([
      mk('quiz-sa', 'A', 'A'), // regrade — 'extra point' is uncovered
      mk('quiz-mc', 'gone', 'A'), // drop_all — never re-graded whatever is uncovered
      mk('quiz-mc', 'A', 'A'), // remap — evidence all carried, extra point uncovered
    ])
    expect(totals.regraded).toBe(1)
    expect(totals.aiCalls).toBe(1)
    expect(totals.droppedAll).toBe(1)
    expect(totals.remapped).toBe(1)
  })

  it('does not count a skipped answer as having dropped anything', () => {
    const skipped = planAnswerRegrade({
      answerId: 'a1',
      mode: 'quiz-sa',
      answerText: 'x',
      priorResults: [prior({ klpId: 'k1', klpText: 'A', isLive: true })],
      live: live(['k1', 'A']),
    })
    expect(summarizeRegrade([skipped])).toMatchObject({ skipped: 1, resultsDropped: 0, aiCalls: 0 })
  })
})
