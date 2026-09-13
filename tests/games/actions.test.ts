import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The game actions: games WRITE NOTHING (asserted on the mock — the whole
 * "just for fun" guarantee as a test), access is read-scoped, prepare is
 * owner-only and reuses donors on the exact source hash.
 */
const h = vi.hoisted(() => {
  const writes = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const
  const models = ['quizAnswer', 'studyEvent', 'confidenceEvent', 'klpState', 'cardProgress', 'studySession', 'quizAttempt', 'answerKlpResult', 'answerErrorTag']
  const guarded: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {}
  for (const m of models) {
    guarded[m] = {}
    for (const w of writes) guarded[m][w] = vi.fn(async () => { throw new Error(`${m}.${w} must never be called by a game`) })
    guarded[m].findMany = vi.fn(async () => [])
    guarded[m].findUnique = vi.fn(async () => null)
    guarded[m].findFirst = vi.fn(async () => null)
  }
  return {
    auth: vi.fn(),
    guarded,
    setFindFirst: vi.fn(),
    setUpdate: vi.fn(),
    cardFindFirst: vi.fn(),
    cardFindMany: vi.fn(),
    klpFindMany: vi.fn(),
    klpFindFirst: vi.fn(),
    pieceFindMany: vi.fn(),
    pieceFindFirst: vi.fn(),
    pieceCreate: vi.fn(),
    pieceCreateMany: vi.fn(),
    pieceUpdate: vi.fn(),
    generateJson: vi.fn(),
    generateJsonWithMeta: vi.fn(),
  }
})

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  generateJsonWithMeta: h.generateJsonWithMeta,
  AiGenerationError: class AiGenerationError extends Error { constructor(public detail: { title: string }) { super(detail.title) } },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    ...h.guarded,
    set: { findFirst: h.setFindFirst, update: h.setUpdate },
    card: { findFirst: h.cardFindFirst, findMany: h.cardFindMany, count: vi.fn(async () => 0) },
    cardKlp: { findMany: h.klpFindMany, findFirst: h.klpFindFirst },
    gamePiece: { findMany: h.pieceFindMany, findFirst: h.pieceFindFirst, create: h.pieceCreate, createMany: h.pieceCreateMany, update: h.pieceUpdate },
  },
}))

import { gradeGameAnswer, probeHotSeat, buildGauntletRun, prepareGamePieces, setGamePieceEnabled } from '@/actions/games'

const ME = 'u1'
const CARD = { id: 'c1', term: 'Walk me through a DCF', definition: 'Project…', setId: 's1', position: 0, createdAt: new Date(), updatedAt: new Date() }
const KLPS = [
  { id: 'k1', text: 'Project unlevered free cash flow', weight: 5, kind: 'mechanism', role: 'substance' },
  { id: 'k2', text: 'Discount at WACC', weight: 4, kind: 'mechanism', role: 'substance' },
  { id: 'k3', text: 'DCF is an intrinsic method', weight: 5, kind: 'definition', role: 'framing' },
  { id: 'k4', text: 'Terminal value dominates', weight: 2, kind: 'quantitative', role: 'substance' },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: ME } })
  h.cardFindFirst.mockResolvedValue(CARD)
  h.klpFindMany.mockResolvedValue(KLPS)
})

describe('gradeGameAnswer', () => {
  it('returns per-point verdicts and a TS-computed hit, and WRITES NOTHING', async () => {
    h.generateJson.mockResolvedValue({
      clarity: { score: 8, pros: [], cons: [] }, conciseness: { score: 8, pros: [], cons: [] }, correctness: { score: 8, pros: [], cons: [] },
      overall: 8, summary: 's', suggestedImprovement: 'x',
      klpResults: [{ klpRef: 0, status: 'passed' }, { klpRef: 1, status: 'passed' }, { klpRef: 2, status: 'failed' }, { klpRef: 3, status: 'failed' }],
    })
    const r = await gradeGameAnswer('c1', 'project FCF, discount at WACC')
    expect(r.success).toBe(true)
    if (!r.success) return
    // Framing point (k3) and a light point (k4) failed, but every heavy SUBSTANCE point passed → hit.
    expect(r.data.hit).toBe(true)
    expect(r.data.verdicts.map((v) => [v.klpId, v.status])).toEqual([['k1', 'passed'], ['k2', 'passed'], ['k3', 'failed'], ['k4', 'failed']])
    // The guarantee: not one write on any history model.
    for (const [model, fns] of Object.entries(h.guarded)) {
      for (const [op, fn] of Object.entries(fns)) {
        if (op.startsWith('find')) continue
        expect(fn, model + '.' + op).not.toHaveBeenCalled()
      }
    }
    expect(h.setUpdate).not.toHaveBeenCalled()
    expect(h.pieceCreate).not.toHaveBeenCalled()
  })

  it('a missed heavy substance point is a miss; a missing klpResult reads as failed', async () => {
    h.generateJson.mockResolvedValue({
      clarity: { score: 5, pros: [], cons: [] }, conciseness: { score: 5, pros: [], cons: [] }, correctness: { score: 5, pros: [], cons: [] },
      overall: 5, summary: 's', suggestedImprovement: 'x',
      klpResults: [{ klpRef: 0, status: 'passed' }],
    })
    const r = await gradeGameAnswer('c1', 'project FCF')
    expect(r.success && r.data.hit).toBe(false)
    expect(r.success && r.data.verdicts.find((v) => v.klpId === 'k2')!.status).toBe('failed')
  })

  it('restricts to the given klpIds (a probe reply is judged on one point)', async () => {
    h.generateJson.mockResolvedValue({
      clarity: { score: 5, pros: [], cons: [] }, conciseness: { score: 5, pros: [], cons: [] }, correctness: { score: 5, pros: [], cons: [] },
      overall: 5, summary: 's', suggestedImprovement: 'x', klpResults: [{ klpRef: 0, status: 'passed' }],
    })
    const r = await gradeGameAnswer('c1', 'discount at WACC', { klpIds: ['k2'] })
    expect(r.success && r.data.verdicts).toEqual([{ klpId: 'k2', text: 'Discount at WACC', weight: 4, status: 'passed' }])
    expect(h.generateJson.mock.calls[0][0].prompt).toContain('Discount at WACC')
    expect(h.generateJson.mock.calls[0][0].prompt).not.toContain('Terminal value dominates')
  })

  it('refuses an unreadable card, an empty answer, and a signed-out caller — with no AI call', async () => {
    h.cardFindFirst.mockResolvedValue(null)
    expect((await gradeGameAnswer('c1', 'x')).success).toBe(false)
    h.cardFindFirst.mockResolvedValue(CARD)
    expect((await gradeGameAnswer('c1', '   ')).success).toBe(false)
    h.auth.mockResolvedValue(null)
    expect((await gradeGameAnswer('c1', 'x')).success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})

describe('probeHotSeat', () => {
  it('writes one in-persona question from the missed point and persists nothing', async () => {
    h.klpFindFirst.mockResolvedValue({ text: 'Discount at WACC' })
    h.generateJson.mockResolvedValue({ question: 'And what rate would you discount at?' })
    const r = await probeHotSeat('c1', 'k2', 'project FCF', { id: 'superday', name: 'The superday panel', vibe: 'Brisk.', opening: '', probeStyle: 'a sharp follow-up' })
    expect(r).toEqual({ success: true, data: { question: 'And what rate would you discount at?' } })
    expect(h.generateJson.mock.calls[0][0].prompt).toContain('Discount at WACC')
    expect(h.setUpdate).not.toHaveBeenCalled()
  })
})

describe('buildGauntletRun — the one memory read', () => {
  it('reads CardProgress for the viewer only and never sends typed-room answers', async () => {
    h.setFindFirst.mockResolvedValue({ id: 's1', cards: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, term: `t${i}`, definition: `d${i}` })) })
    h.guarded.cardProgress.findMany.mockResolvedValue([{ cardId: 'c2', confidence: 2, dueAt: null }, { cardId: 'c0', confidence: 9, dueAt: new Date(Date.now() + 86400000) }])
    const r = await buildGauntletRun('s1', { mcOnly: false })
    expect(r.success).toBe(true)
    if (!r.success) return
    const where = h.guarded.cardProgress.findMany.mock.calls[0][0].where
    expect(where.userId).toBe(ME)
    // Typed rooms carry no options — the client never holds the answer.
    expect(r.data.rooms.filter((x) => x.format === 'typed').every((x) => x.options === undefined)).toBe(true)
    expect(r.data.rooms.some((x) => x.kind === 'boss')).toBe(true)
  })

  it('requires sign-in', async () => {
    h.auth.mockResolvedValue(null)
    expect((await buildGauntletRun('s1', { mcOnly: true })).success).toBe(false)
  })
})

describe('prepareGamePieces', () => {
  it('is owner-only', async () => {
    h.setFindFirst.mockResolvedValue(null)
    expect((await prepareGamePieces('s1')).success).toBe(false)
    expect(h.pieceCreate).not.toHaveBeenCalled()
  })

  it('makes a term piece for a short card with no AI call, copies from an exact-hash donor, skips a card without key points', async () => {
    h.setFindFirst.mockResolvedValue({ id: 's1' })
    h.cardFindMany.mockResolvedValue([
      { id: 'short', term: 'WACC', definition: 'Weighted average cost of capital.', klpStatus: 'ready', klpVersion: 1, klpSourceHash: 'h-short' },
      { id: 'copy', term: 'Walk me through a DCF', definition: 'long…', klpStatus: 'ready', klpVersion: 2, klpSourceHash: 'h-dcf' },
      { id: 'pending', term: 'Something long enough to not be short', definition: 'long long long long long long long long long long long long long', klpStatus: 'pending', klpVersion: 0, klpSourceHash: null },
    ])
    h.pieceFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ('sourceHash' in args.where && args.where.sourceHash === 'h-dcf') {
        return [{ cardId: 'donor', klpVersion: 3, klpId: 'dk1', kind: 'cloze', prompt: 'Discount at ___', answer: 'WACC', aliases: [], model: 'm-donor', enabled: true, card: { klpVersion: 3 } }]
      }
      return []
    })
    h.klpFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.cardId === 'copy') return [{ id: 'mk1', index: 0 }]
      if ('id' in args.where) return [{ id: 'dk1', index: 0 }]
      return []
    })
    h.pieceCreate.mockResolvedValue({})
    h.pieceCreateMany.mockResolvedValue({ count: 1 })
    h.setUpdate.mockResolvedValue({})
    const r = await prepareGamePieces('s1')
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data).toMatchObject({ made: 1, copied: 1, generated: 0 })
    expect(r.data.skipped).toEqual([{ cardId: 'pending', reason: 'no_klps' }])
    expect(h.generateJsonWithMeta).not.toHaveBeenCalled()
    // The term piece: deterministic, no model.
    expect(h.pieceCreate.mock.calls[0][0].data).toMatchObject({ cardId: 'short', kind: 'term', answer: 'WACC', model: null })
    // The copy: remapped klpId, donor's model carried.
    expect(h.pieceCreateMany.mock.calls[0][0].data[0]).toMatchObject({ cardId: 'copy', klpId: 'mk1', model: 'm-donor', klpVersion: 2 })
    expect(h.setUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ gamesPreparedAt: expect.any(Date) }) }))
  })

  it('generates clozes for long ready cards, dropping bad ones, and marks a failed batch', async () => {
    h.setFindFirst.mockResolvedValue({ id: 's1' })
    h.cardFindMany.mockResolvedValue([
      { id: 'a', term: 'Walk me through a DCF', definition: 'long…', klpStatus: 'ready', klpVersion: 1, klpSourceHash: 'h-a' },
    ])
    h.pieceFindMany.mockResolvedValue([])
    h.klpFindMany.mockResolvedValue([{ id: 'ka1', index: 0, text: 'Discount at WACC' }, { id: 'ka2', index: 1, text: 'Terminal value dominates' }])
    h.generateJsonWithMeta.mockResolvedValue({
      value: { pieces: [
        { cardRef: 0, klpRef: 0, prompt: 'Discount cash flows at ___', answer: 'WACC', aliases: [] },
        { cardRef: 0, klpRef: 1, prompt: 'no blank here', answer: 'terminal', aliases: [] },
      ] },
      meta: { model: 'm-gen', credentialId: 'x' },
    })
    h.pieceCreate.mockResolvedValue({})
    h.setUpdate.mockResolvedValue({})
    const r = await prepareGamePieces('s1')
    expect(r.success && r.data.generated).toBe(1)
    expect(h.pieceCreate.mock.calls[0][0].data).toMatchObject({ cardId: 'a', klpId: 'ka1', answer: 'WACC', model: 'm-gen' })

    vi.clearAllMocks()
    h.auth.mockResolvedValue({ user: { id: ME } })
    h.setFindFirst.mockResolvedValue({ id: 's1' })
    h.cardFindMany.mockResolvedValue([{ id: 'a', term: 'Walk me through a DCF', definition: 'long…', klpStatus: 'ready', klpVersion: 1, klpSourceHash: 'h-a' }])
    h.pieceFindMany.mockResolvedValue([])
    h.klpFindMany.mockResolvedValue([{ id: 'ka1', index: 0, text: 'x' }])
    h.generateJsonWithMeta.mockRejectedValue(new Error('boom'))
    h.setUpdate.mockResolvedValue({})
    const r2 = await prepareGamePieces('s1')
    expect(r2.success && r2.data.failed).toEqual([{ cardId: 'a', kind: 'internal' }])
  })
})

describe('setGamePieceEnabled', () => {
  it('is owner-only through the piece’s set', async () => {
    h.pieceFindFirst.mockResolvedValue(null)
    expect((await setGamePieceEnabled('p1', false)).success).toBe(false)
    expect(h.pieceUpdate).not.toHaveBeenCalled()
    h.pieceFindFirst.mockResolvedValue({ id: 'p1', setId: 's1' })
    h.pieceUpdate.mockResolvedValue({})
    expect((await setGamePieceEnabled('p1', false)).success).toBe(true)
    expect(h.pieceFindFirst.mock.calls[1][0].where).toEqual({ id: 'p1', set: { userId: ME } })
  })
})
