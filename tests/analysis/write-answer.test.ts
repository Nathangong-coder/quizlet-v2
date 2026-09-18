import { describe, it, expect, vi } from 'vitest'

// The module opens its own transaction when no client is passed, so it imports
// the real Prisma client at module load — which throws without DATABASE_URL.
// These assertions are about the exported contract, not a live write.
vi.mock('@/lib/db', () => ({ prisma: { $transaction: vi.fn() } }))

import {
  ANALYSIS_TX_OPTIONS,
  DIAGNOSTIC_TX_OPTIONS,
  createAnswerWithAnalysis,
} from '@/lib/analysis/write-answer'
import { ANALYSIS_VERSION, type AnalysisWrites } from '@/lib/analysis/persist'
import { GRADER_VERSION } from '@/lib/analysis/version'

/**
 * A fake transaction client exposing exactly the delegates the writer touches.
 * Passed through the caller-supplied `tx` parameter, so no `$transaction`
 * plumbing is needed and every write is observable.
 */
function fakeTx() {
  const tx = {
    quizAnswer: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'ans-1', createdAt: new Date('2026-09-17T00:00:00Z') }),
    },
    answerKlpResult: { createMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]) },
    answerErrorTag: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // Spec 5 Phase A: the three new answer-child tables.
    answerRelationResult: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    answerFormResult: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    answerUnwarrantedClaim: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    klpState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
  }
  return tx
}

const answerData = {
  attemptId: 'att-1',
  userId: 'user-1',
  cardId: 'card-1',
  mode: 'short-answer',
  prompt: 'q',
  answer: 'FCF rises because D&A is non-cash.',
  correctAnswer: 'x',
  isCorrect: true,
  score: 9,
}

const emptyWrites: AnalysisWrites = {
  status: 'analyzed',
  klpResults: [],
  errorTags: [],
  relationResults: [],
  formResults: [],
  unwarranted: [],
  warnings: [],
}

describe('write-answer module', () => {
  it('exports the shared writer, so a second one cannot grow beside it', () => {
    // It holds the KlpState locking discipline, the supersede-and-replay rule
    // and the CardProgress recompute. Two copies is how two posteriors start
    // disagreeing — and a 'use server' module could not have exported it.
    expect(typeof createAnswerWithAnalysis).toBe('function')
  })

  it('accepts a caller-supplied transaction client', () => {
    // Arity: (answerData, writes, replace, tx). The diagnostic composes twelve
    // of these inside ONE transaction so a mid-loop failure rolls the whole
    // sitting back rather than leaving half a graded test behind.
    expect(createAnswerWithAnalysis.length).toBe(4)
  })

  it('keeps the per-answer transaction sizing unchanged', () => {
    expect(ANALYSIS_TX_OPTIONS).toEqual({ maxWait: 10_000, timeout: 30_000 })
  })

  it('sizes the diagnostic transaction for a whole sitting, not one answer', () => {
    // Quiz writes ONE answer per transaction; a diagnostic writes twelve, each
    // costing a serialized advisory lock + read + write per key point. A P2028
    // here does not degrade — it discards a test the learner just spent twenty
    // minutes on.
    expect(DIAGNOSTIC_TX_OPTIONS.timeout).toBeGreaterThan(ANALYSIS_TX_OPTIONS.timeout)
    expect(DIAGNOSTIC_TX_OPTIONS.maxWait).toBeGreaterThanOrEqual(ANALYSIS_TX_OPTIONS.maxWait)
  })
})

describe('createAnswerWithAnalysis — Spec 5 Phase A rows', () => {
  it('stamps graderVersion and ANALYSIS_VERSION on the answer row', async () => {
    const tx = fakeTx()
    await createAnswerWithAnalysis(answerData, emptyWrites, undefined, tx as never)
    expect(tx.quizAnswer.create).toHaveBeenCalledTimes(1)
    const data = tx.quizAnswer.create.mock.calls[0][0].data
    expect(data.graderVersion).toBe(GRADER_VERSION)
    expect(data.analysisVersion).toBe(ANALYSIS_VERSION)
    expect(ANALYSIS_VERSION).toBe(4)
  })

  it('skips the three new createManys when the writes carry no rows', async () => {
    // A createMany with an empty array is a wasted round-trip inside a
    // transaction that already serialises a lock per key point.
    const tx = fakeTx()
    await createAnswerWithAnalysis(answerData, emptyWrites, undefined, tx as never)
    expect(tx.answerRelationResult.createMany).not.toHaveBeenCalled()
    expect(tx.answerFormResult.createMany).not.toHaveBeenCalled()
    expect(tx.answerUnwarrantedClaim.createMany).not.toHaveBeenCalled()
  })

  it('writes relation results, form results and unwarranted claims against the new answer id', async () => {
    const tx = fakeTx()
    const writes: AnalysisWrites = {
      ...emptyWrites,
      klpResults: [
        { klpId: 'k1', status: 'inversion', credit: 0, mode: 'quiz-sa', evidence: 'FCF rises', spanStart: 0, spanEnd: 9 },
      ],
      relationResults: [
        {
          relationId: 'r1', status: 'omission', credit: 0, provenance: 'passive',
          evidence: 'D&A is non-cash', spanStart: 18, spanEnd: 33,
        },
      ],
      formResults: [{ formRequirementId: 'f1', status: 'not_met', evidence: undefined, spanStart: null, spanEnd: null }],
      unwarranted: [{ text: 'claims D&A is cash', magnitude: 10, evidence: 'D&A is non-cash', spanStart: 18, spanEnd: 33 }],
    }
    await createAnswerWithAnalysis(answerData, writes, undefined, tx as never)

    expect(tx.answerKlpResult.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quizAnswerId: 'ans-1', klpId: 'k1', spanStart: 0, spanEnd: 9 })],
    })
    expect(tx.answerRelationResult.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        quizAnswerId: 'ans-1', relationId: 'r1', status: 'omission', provenance: 'passive', spanStart: 18,
      })],
    })
    expect(tx.answerFormResult.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quizAnswerId: 'ans-1', formRequirementId: 'f1', status: 'not_met' })],
    })
    expect(tx.answerUnwarrantedClaim.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quizAnswerId: 'ans-1', text: 'claims D&A is cash', magnitude: 10, spanStart: 18 })],
    })
  })
})
