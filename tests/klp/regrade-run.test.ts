import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The KLP-EDIT regrade's writer, against a mocked transaction client.
 *
 * One property is pinned here: `applyRegradePlan` deletes the LIVE generation
 * of an answer's rows and never a grader-version regrade's superseded
 * history. The two tools coexist on the same tables (Spec 5 Phase A §6): the
 * grader-version regrade (`src/lib/analysis/regrade.ts`) supersedes rather
 * than deleting, so an answer can carry a superseded generation beside its
 * live one — and a later KLP edit on the card must not take that history with
 * the rows it rewrites. Supersede adoption for this tool is deferred (queue).
 */
const { tx, prisma } = vi.hoisted(() => {
  const tx = {
    answerKlpResult: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    answerErrorTag: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    quizAnswer: { update: vi.fn().mockResolvedValue({}) },
    klpState: { upsert: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { tx, prisma }
})

vi.mock('@/lib/db', () => ({ prisma }))

import { applyRegradePlan } from '@/lib/klp/regrade-run'
import type { RegradePlan } from '@/lib/klp/regrade'

const regradePlan: RegradePlan = {
  answerId: 'a1',
  mode: 'quiz-sa',
  action: 'regrade',
  status: 'analyzed',
  carried: [],
  droppedKlpIds: ['k-old'],
  uncoveredKlpIds: ['k-new'],
  warnings: [],
}

describe('applyRegradePlan spares a grader-regrade\'s superseded history', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes only the LIVE generation of key-point results and error tags', async () => {
    await applyRegradePlan(regradePlan, 'u1', {
      status: 'analyzed',
      klpResults: [{ klpId: 'k-new', status: 'correct', credit: 0.95, mode: 'quiz-sa', spanStart: null, spanEnd: null }],
      errorTags: [],
      relationResults: [],
      formResults: [],
      unwarranted: [],
      warnings: [],
    })
    expect(tx.answerKlpResult.deleteMany).toHaveBeenCalledWith({
      where: { quizAnswerId: 'a1', supersededAt: null },
    })
    expect(tx.answerErrorTag.deleteMany).toHaveBeenCalledWith({
      where: { quizAnswerId: 'a1', supersededAt: null },
    })
  })

  it('a carry-forward plan deletes only the live generation too', async () => {
    await applyRegradePlan(
      {
        answerId: 'a1',
        mode: 'quiz-sa',
        action: 'remap',
        status: 'analyzed',
        carried: [{ fromKlpId: 'k-old', toKlpId: 'k-new', status: 'correct', credit: 0.95, mode: 'quiz-sa', evidence: null, spanStart: null, spanEnd: null }],
        droppedKlpIds: [],
        uncoveredKlpIds: [],
        warnings: [],
      },
      'u1',
      null,
    )
    expect(tx.answerKlpResult.deleteMany).toHaveBeenCalledWith({
      where: { quizAnswerId: 'a1', supersededAt: null },
    })
    // The tag remap reads live tags only as well.
    expect(tx.answerErrorTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quizAnswerId: 'a1', supersededAt: null } }),
    )
  })
})

describe('applyRegradePlan carry path is a writer, and obeys the v4 write rules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-creates a carried `passed` prior as a `correct` row, with its spans', async () => {
    // FINAL REVIEW finding (2): the carry path re-created rows with
    // `prior.status` verbatim, so a legacy `passed` row was WRITTEN again under
    // ANALYSIS_VERSION 4 (reachable from the cron regradeSweep, no AI call),
    // and the resolved quote offsets were dropped although the answer text —
    // the thing they index — had not changed.
    await applyRegradePlan(
      {
        answerId: 'a1',
        mode: 'quiz-sa',
        action: 'remap',
        status: 'analyzed',
        carried: [
          { fromKlpId: 'k-old', toKlpId: 'k-new', status: 'passed', credit: 0.95, mode: 'quiz-sa', evidence: 'the quote', spanStart: 4, spanEnd: 13 },
        ],
        droppedKlpIds: [],
        uncoveredKlpIds: [],
        warnings: [],
      },
      'u1',
      null,
    )
    expect(tx.answerKlpResult.createMany).toHaveBeenCalledTimes(1)
    const rows = tx.answerKlpResult.createMany.mock.calls[0][0].data
    expect(rows).toEqual([
      expect.objectContaining({
        quizAnswerId: 'a1',
        klpId: 'k-new',
        status: 'correct',
        credit: 0.95,
        evidence: 'the quote',
        spanStart: 4,
        spanEnd: 13,
      }),
    ])
    expect(rows.some((r: { status: string }) => r.status === 'passed')).toBe(false)
  })

  it('source scan: no write in regrade-run.ts carries the literal status `passed`', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/klp/regrade-run.ts'), 'utf8')
    // A `status: 'passed'` object property is what a writer would look like;
    // the comparison `=== 'passed'` in the normaliser is the guard, not a write.
    expect(src).not.toMatch(/status:\s*['"]passed['"]/)
  })
})
