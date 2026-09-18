import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Spec 5 Phase A §6, the GRADER-VERSION regrade: the same answer, the same
 * key points, a NEW instrument. It writes a new generation of analysis rows
 * and marks the old one `supersededAt` — it never deletes. Not to be confused
 * with the KLP-EDIT regrade (`src/lib/klp/regrade-run.ts`), which moves
 * evidence after a card's points change and has its own planner.
 *
 * `regradeAnswer` is exercised against a mocked Prisma client: the generator
 * is a fake, the transaction client is observable, and every write is
 * asserted in order. No AI call and no database.
 */

const { tx, prisma, calls, answerCreatedAt } = vi.hoisted(() => {
  const tx = {
    quizAnswer: { update: vi.fn().mockResolvedValue({}) },
    answerKlpResult: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    answerErrorTag: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    answerRelationResult: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    answerFormResult: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    answerUnwarrantedClaim: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    klpState: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
  }

  /** The order every write on the fake transaction client happened in. */
  const calls: string[] = []
  for (const [delegate, methods] of Object.entries(tx)) {
    if (typeof methods !== 'object') continue
    for (const [method, fn] of Object.entries(methods)) {
      ;(fn as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        calls.push(`${delegate}.${method}`)
        if (method === 'findMany') return []
        return { count: 0 }
      })
    }
  }
  tx.$executeRaw.mockImplementation(async () => {
    calls.push('$executeRaw')
    return 0
  })

  const answerCreatedAt = new Date('2026-09-01T10:00:00Z')

  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      calls.push('$transaction:begin')
      const out = await fn(tx)
      calls.push('$transaction:end')
      return out
    }),
    quizAnswer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    card: { findUnique: vi.fn() },
    cardKlp: { findMany: vi.fn() },
    cardProgress: { findUnique: vi.fn().mockResolvedValue({ starred: true }) },
    klpRelation: { findMany: vi.fn().mockResolvedValue([]) },
    cardFormRequirement: { findMany: vi.fn().mockResolvedValue([]) },
    cardAuthoring: { findFirst: vi.fn().mockResolvedValue({ referenceAnswer: 'A reference answer.' }) },
  }
  return { tx, prisma, calls, answerCreatedAt }
})

vi.mock('@/lib/db', () => ({ prisma }))

import { planRegrade, regradeAnswer, type RegradeCandidate } from '@/lib/analysis/regrade'
import { writeAnalysisGeneration } from '@/lib/analysis/write-answer'
import { GRADER_VERSION } from '@/lib/analysis/version'
import { ANALYSIS_VERSION } from '@/lib/analysis/persist'
import { gradeMaxOutputTokens } from '@/lib/analysis/output-cap'
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas'

const candidate = (over: Partial<RegradeCandidate> = {}): RegradeCandidate => ({
  id: 'a1',
  mode: 'short-answer',
  graderVersion: null,
  answerText: 'FCF rises because D&A is non-cash.',
  liveKlpCount: 2,
  hasMediaPrompt: false,
  ...over,
})

describe('planRegrade (pure)', () => {
  it('grades an answer that is below the current grader version and has text and live key points', () => {
    const plan = planRegrade([candidate()], { graderVersion: 2 })
    expect(plan).toEqual({ toGrade: ['a1'], skipped: [] })
  })

  it('skips a row already at the current graderVersion — the tool is resumable', () => {
    // Re-running over a set must cost nothing for what the last run finished:
    // re-grading is not deterministic, so a second pass over current rows
    // would churn every posterior for no new information.
    const plan = planRegrade([candidate({ graderVersion: 2 })], { graderVersion: 2 })
    expect(plan.toGrade).toEqual([])
    expect(plan.skipped).toEqual([{ id: 'a1', reason: 'current_version' }])
  })

  it('skips a row with no answer text', () => {
    expect(planRegrade([candidate({ answerText: null })], { graderVersion: 2 }).skipped)
      .toEqual([{ id: 'a1', reason: 'no_answer_text' }])
    expect(planRegrade([candidate({ answerText: '   ' })], { graderVersion: 2 }).skipped)
      .toEqual([{ id: 'a1', reason: 'no_answer_text' }])
  })

  it('skips a row whose card has no live key points', () => {
    // Nothing to grade AGAINST: the content pass is per key point.
    expect(planRegrade([candidate({ liveKlpCount: 0 })], { graderVersion: 2 }).skipped)
      .toEqual([{ id: 'a1', reason: 'no_live_klps' }])
  })

  it('never re-grades multiple choice or true/false', () => {
    // Their diagnosis is distractor provenance, not text — the same rule the
    // KLP-edit regrade enforces (`src/lib/klp/regrade.ts`).
    expect(planRegrade([candidate({ mode: 'multiple-choice' })], { graderVersion: 2 }).skipped)
      .toEqual([{ id: 'a1', reason: 'not_short_answer' }])
  })

  it('skips a card whose prompt is media — the regrade builds the text prompt only', () => {
    expect(planRegrade([candidate({ hasMediaPrompt: true })], { graderVersion: 2 }).skipped)
      .toEqual([{ id: 'a1', reason: 'media_prompt' }])
  })

  it('a row graded under a NEWER version than the target is left alone too', () => {
    expect(planRegrade([candidate({ graderVersion: 3 })], { graderVersion: 2 }).skipped)
      .toEqual([{ id: 'a1', reason: 'current_version' }])
  })

  it('keeps input order and reports both lists', () => {
    const plan = planRegrade(
      [candidate({ id: 'x' }), candidate({ id: 'y', answerText: null }), candidate({ id: 'z' })],
      { graderVersion: 2 },
    )
    expect(plan.toGrade).toEqual(['x', 'z'])
    expect(plan.skipped).toEqual([{ id: 'y', reason: 'no_answer_text' }])
  })
})

// Parsed, not typed: the parsed value is what the generator hands back.
const fakeGrade = ShortAnswerGradeSchema.parse({
  clarity: { score: 8, pros: [], cons: [] },
  conciseness: { score: 8, pros: [], cons: [] },
  correctness: { score: 6, pros: [], cons: [] },
  overall: 7,
  summary: 'ok',
  suggestedImprovement: 'more',
  klpResults: [
    { klpRef: 0, status: 'correct' },
    { klpRef: 1, status: 'omission', quote: 'D&A is non-cash' },
  ],
  relationResults: [],
  formResults: [],
  unwarranted: [{ text: 'claims D&A is cash', quote: 'D&A is non-cash', magnitude: 4 }],
  errorTags: [],
})

function primeLoads() {
  prisma.quizAnswer.findUnique.mockResolvedValue({
    id: 'a1',
    userId: 'u1',
    cardId: 'c1',
    mode: 'short-answer',
    answer: 'FCF rises because D&A is non-cash.',
    createdAt: answerCreatedAt,
    graderVersion: null,
    card: {
      id: 'c1',
      term: 'FCF and D&A',
      definition: 'D&A is added back because it is non-cash.',
      contentBlocks: [{ side: 'term', type: 'text' }],
    },
  })
  prisma.card.findUnique.mockResolvedValue({
    id: 'c1',
    term: 'FCF and D&A',
    definition: 'D&A is added back because it is non-cash.',
  })
  prisma.cardKlp.findMany.mockResolvedValue([
    { id: 'k1', text: 'D&A is non-cash', weight: 3, kind: 'definition', version: 2 },
    { id: 'k2', text: 'It is added back to net income', weight: 4, kind: 'mechanism', version: 2 },
  ])
  // The live generation this regrade supersedes: k1 and a stale k3. The
  // rebuild's read (by `klpId: { in }`) sees no live rows, so every replayed
  // state is deleted — the observable proof the replay ran over the union.
  tx.answerKlpResult.findMany.mockImplementation(async (args: { where?: { klpId?: { in?: string[] } } }) => {
    calls.push('answerKlpResult.findMany')
    if (args?.where?.klpId?.in) return []
    return [{ klpId: 'k1' }, { klpId: 'k3' }]
  })
}

describe('regradeAnswer', () => {
  beforeEach(() => {
    calls.length = 0
    vi.clearAllMocks()
    primeLoads()
  })

  it('builds the v5 content-pass prompt from the live context and calls the generator with the fluid ceiling', async () => {
    const gen = vi.fn().mockResolvedValue({ value: fakeGrade, model: 'deepseek-v4-flash' })
    await regradeAnswer('a1', gen)

    expect(gen).toHaveBeenCalledTimes(1)
    const input = gen.mock.calls[0][0]
    expect(input.prompt).toContain('FCF rises because D&A is non-cash.')
    expect(input.prompt).toContain('D&A is non-cash')
    expect(input.prompt).toContain('A reference answer.')
    // Two key points, no relations, no form requirements.
    expect(input.maxOutputTokens).toBe(gradeMaxOutputTokens(2))
    // The grader is a stateless instrument: nothing about the learner rides in.
    expect(input.prompt).not.toMatch(/learner profile|Learner context/i)
  })

  it('reads the live key points and grading context with the same queries the quiz uses', async () => {
    const gen = vi.fn().mockResolvedValue({ value: fakeGrade, model: 'm' })
    await regradeAnswer('a1', gen)
    expect(prisma.cardKlp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cardId: 'c1', supersededAt: null } }),
    )
    expect(prisma.klpRelation.findMany).toHaveBeenCalled()
    expect(prisma.cardFormRequirement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cardId: 'c1', klpVersion: 2 } }),
    )
  })

  it('calls the generator OUTSIDE the transaction, then supersedes, writes, stamps and replays inside ONE', async () => {
    const gen = vi.fn(async () => {
      calls.push('gen')
      return { value: fakeGrade, model: 'm' }
    })
    await regradeAnswer('a1', gen, { now: () => new Date('2026-09-17T12:00:00Z') })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(calls.indexOf('gen')).toBeLessThan(calls.indexOf('$transaction:begin'))

    const begin = calls.indexOf('$transaction:begin')
    const end = calls.indexOf('$transaction:end')
    const inside = calls.slice(begin + 1, end)
    // Supersede every table BEFORE the new generation is written.
    const firstWrite = inside.findIndex((c) => c.endsWith('.createMany'))
    for (const table of [
      'answerKlpResult', 'answerErrorTag', 'answerRelationResult', 'answerFormResult', 'answerUnwarrantedClaim',
    ]) {
      const i = inside.indexOf(`${table}.updateMany`)
      expect(i, `${table} superseded inside the tx`).toBeGreaterThan(-1)
      expect(i, `${table} superseded before the new rows`).toBeLessThan(firstWrite)
    }
    // Then the stamp, then the replay LAST.
    expect(inside.indexOf('quizAnswer.update')).toBeGreaterThan(firstWrite)
    const replay = inside.lastIndexOf('klpState.upsert') >= 0
      ? inside.lastIndexOf('klpState.upsert')
      : inside.lastIndexOf('klpState.deleteMany')
    expect(replay).toBeGreaterThan(inside.indexOf('quizAnswer.update'))
  })

  it('supersedes only the LIVE rows of this answer, stamped with one clock', async () => {
    const now = new Date('2026-09-17T12:00:00Z')
    await regradeAnswer('a1', vi.fn().mockResolvedValue({ value: fakeGrade, model: 'm' }), { now: () => now })
    for (const table of [
      tx.answerKlpResult, tx.answerErrorTag, tx.answerRelationResult, tx.answerFormResult, tx.answerUnwarrantedClaim,
    ]) {
      expect(table.updateMany).toHaveBeenCalledWith({
        where: { quizAnswerId: 'a1', supersededAt: null },
        data: { supersededAt: now },
      })
    }
  })

  it('writes the new generation at the ANSWER\'s createdAt so the posterior replays it at observation time', async () => {
    // The regrade re-measures the same observation; it does not create a new
    // one. `rebuildKlpStates` replays by `AnswerKlpResult.createdAt`, so a
    // regraded row dated today would move a months-old observation to today.
    await regradeAnswer('a1', vi.fn().mockResolvedValue({ value: fakeGrade, model: 'm' }))
    expect(tx.answerKlpResult.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ quizAnswerId: 'a1', klpId: 'k1', status: 'correct', createdAt: answerCreatedAt }),
        expect.objectContaining({
          quizAnswerId: 'a1', klpId: 'k2', status: 'omission', createdAt: answerCreatedAt, spanStart: 18, spanEnd: 33,
        }),
      ]),
    })
    expect(tx.answerUnwarrantedClaim.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quizAnswerId: 'a1', text: 'claims D&A is cash', magnitude: 4, createdAt: answerCreatedAt })],
    })
  })

  it('stamps graderVersion, analysisVersion, analysisStatus and regradedAt on the answer', async () => {
    const now = new Date('2026-09-17T12:00:00Z')
    await regradeAnswer('a1', vi.fn().mockResolvedValue({ value: fakeGrade, model: 'm' }), { now: () => now })
    expect(tx.quizAnswer.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        graderVersion: GRADER_VERSION,
        analysisVersion: ANALYSIS_VERSION,
        analysisStatus: 'analyzed',
        regradedAt: now,
      }),
    })
  })

  it('replays KlpState for the union of the superseded and the new key points', async () => {
    // k3 was in the old generation only: its posterior must be rebuilt from
    // what remains live (nothing) or it keeps asserting knowledge from a row
    // that is no longer live. k2 is new. k1 is in both.
    await regradeAnswer('a1', vi.fn().mockResolvedValue({ value: fakeGrade, model: 'm' }))
    // The lock covers every id the replay will write.
    expect(tx.$executeRaw).toHaveBeenCalled()
    // The rebuild reads live rows only.
    const rebuildRead = tx.answerKlpResult.findMany.mock.calls.find(
      (c) => c[0]?.where?.klpId?.in !== undefined,
    )
    expect(rebuildRead).toBeDefined()
    expect(new Set(rebuildRead![0].where.klpId.in)).toEqual(new Set(['k1', 'k2', 'k3']))
    expect(rebuildRead![0].where.supersededAt).toBeNull()
    // With the fake returning no live rows, each state is deleted.
    expect(tx.klpState.deleteMany).toHaveBeenCalledTimes(3)
  })

  it('marks no_provenance when the grader returned no per-key-point verdicts on a card that has them', async () => {
    const gen = vi.fn().mockResolvedValue({ value: { ...fakeGrade, klpResults: [] }, model: 'm' })
    const out = await regradeAnswer('a1', gen)
    expect(out.outcome).toBe('regraded')
    expect(tx.quizAnswer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ analysisStatus: 'no_provenance' }) }),
    )
  })

  it('returns skipped (and writes nothing) for an answer the planner would skip', async () => {
    prisma.quizAnswer.findUnique.mockResolvedValue({
      id: 'a1', userId: 'u1', cardId: 'c1', mode: 'short-answer', answer: null,
      createdAt: answerCreatedAt, graderVersion: null,
      card: { id: 'c1', term: 't', definition: 'd', contentBlocks: [] },
    })
    const gen = vi.fn()
    const out = await regradeAnswer('a1', gen)
    expect(out).toEqual({ answerId: 'a1', outcome: 'skipped', reason: 'no_answer_text' })
    expect(gen).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('does not touch the answer when the generator throws', async () => {
    const gen = vi.fn().mockRejectedValue(new Error('provider down'))
    await expect(regradeAnswer('a1', gen)).rejects.toThrow('provider down')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('reports the model that graded and the row counts', async () => {
    const out = await regradeAnswer('a1', vi.fn().mockResolvedValue({ value: fakeGrade, model: 'deepseek-v4-flash' }))
    expect(out).toMatchObject({
      answerId: 'a1', outcome: 'regraded', model: 'deepseek-v4-flash', status: 'analyzed',
      written: { klpResults: 2, errorTags: 0, relationResults: 0, formResults: 0, unwarranted: 1 },
    })
  })
})

describe('writeAnalysisGeneration — the one row writer', () => {
  beforeEach(() => {
    calls.length = 0
    vi.clearAllMocks()
  })

  it('is exported from write-answer, shared by the live path and the regrade', () => {
    expect(typeof writeAnalysisGeneration).toBe('function')
  })

  it('stamps every row with the supplied createdAt when one is given, and leaves it to the default otherwise', async () => {
    const writes = {
      status: 'analyzed' as const,
      klpResults: [{ klpId: 'k1', status: 'correct' as const, credit: 0.95, mode: 'quiz-sa' as const, spanStart: null, spanEnd: null }],
      errorTags: [{
        dimension: 'accuracy' as const, type: 'omission', klpId: 'k1', secondaryKlpId: null,
        relevance: 3, severity: 2, magnitude: 4, mode: 'quiz-sa' as const, starred: false, significance: 4,
      }],
      relationResults: [],
      formResults: [],
      unwarranted: [],
      warnings: [],
    }
    const at = new Date('2026-09-01T10:00:00Z')
    await writeAnalysisGeneration(tx as never, 'ans-9', writes, { createdAt: at })
    expect(tx.answerKlpResult.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quizAnswerId: 'ans-9', klpId: 'k1', createdAt: at })],
    })
    expect(tx.answerErrorTag.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quizAnswerId: 'ans-9', type: 'omission', createdAt: at })],
    })

    vi.clearAllMocks()
    await writeAnalysisGeneration(tx as never, 'ans-9', writes)
    const row = tx.answerKlpResult.createMany.mock.calls[0][0].data[0]
    expect('createdAt' in row).toBe(false)
  })

  it('skips an empty createMany for every table', async () => {
    await writeAnalysisGeneration(tx as never, 'ans-9', {
      status: 'analyzed', klpResults: [], errorTags: [], relationResults: [], formResults: [], unwarranted: [], warnings: [],
    })
    for (const t of [
      tx.answerKlpResult, tx.answerErrorTag, tx.answerRelationResult, tx.answerFormResult, tx.answerUnwarrantedClaim,
    ]) {
      expect(t.createMany).not.toHaveBeenCalled()
    }
  })
})
