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
        carried: [{ fromKlpId: 'k-old', toKlpId: 'k-new', status: 'correct', credit: 0.95, mode: 'quiz-sa', evidence: null }],
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
