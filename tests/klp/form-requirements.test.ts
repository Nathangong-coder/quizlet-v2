import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  card: null as Record<string, unknown> | null,
  existingCount: 0,
  klps: [] as { text: string; kind: string }[],
  authoring: null as { referenceAnswer: string; probes: { text: string }[] } | null,
  createMany: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    card: { findUnique: vi.fn(async () => h.card) },
    cardFormRequirement: {
      count: vi.fn(async () => h.existingCount),
      createMany: h.createMany,
    },
    cardKlp: { findMany: vi.fn(async () => h.klps) },
    cardAuthoring: { findFirst: vi.fn(async () => h.authoring) },
  },
}))

import { planFormReqs, authorFormRequirements, type FormReqGen } from '@/lib/klp/form-requirements'
import { WRITE_FORM_REQS_PROMPT } from '@/lib/ai/prompts/write-form-reqs'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { FormRequirementsSchema, ShortAnswerGradeSchema } from '@/lib/ai/schemas'
import { prisma } from '@/lib/db'

const REQS = [
  { text: 'Answers the ordering question, not the definition of the terms' },
  { text: 'States which direction the multiple moves and by roughly how much' },
  { text: 'Lands on the conclusion the question asked for' },
]

const GRADE = {
  clarity: { score: 7, pros: [], cons: [] },
  conciseness: { score: 7, pros: [], cons: [] },
  correctness: { score: 7, pros: [], cons: [] },
  overall: 7,
  summary: 's',
  suggestedImprovement: 'i',
  klpResults: [],
  errorTags: [],
}

/** A fake generator: writes REQS, then grades every form requirement as `status`. */
function fakeGen(status: 'met' | 'not_met', calls: { prompt: string; schema: unknown }[] = []): FormReqGen {
  return (async (prompt: string, schema: unknown) => {
    calls.push({ prompt, schema })
    if (schema === FormRequirementsSchema) return { value: { requirements: REQS }, model: 'deepseek-flash' }
    if (schema === ShortAnswerGradeSchema) {
      return {
        value: { ...GRADE, formResults: REQS.map((_, formRef) => ({ formRef, status, quote: 'q' })) },
        model: 'deepseek-flash',
      }
    }
    throw new Error('unexpected schema')
  }) as FormReqGen
}

beforeEach(() => {
  vi.clearAllMocks()
  h.card = { id: 'c1', term: 'Why does EV/EBITDA fall when leverage rises?', definition: 'D', klpVersion: 3 }
  h.existingCount = 0
  h.klps = [
    { text: 'EV is capital-structure neutral', kind: 'definition' },
    { text: 'Leverage raises equity risk, not EV', kind: 'causal' },
  ]
  h.authoring = { referenceAnswer: 'Reference answer text', probes: [{ text: 'A memorised template answer about leverage.' }] }
})

describe('planFormReqs', () => {
  it('returns the cards with no requirements at their CURRENT klpVersion and skips the rest', () => {
    const cards = [
      { id: 'none', klpVersion: 2, formReqVersions: [] },
      { id: 'stale', klpVersion: 3, formReqVersions: [2] },
      { id: 'current', klpVersion: 3, formReqVersions: [2, 3] },
    ]
    expect(planFormReqs(cards).map((c) => c.id)).toEqual(['none', 'stale'])
  })

  it('returns an empty plan for an empty set', () => {
    expect(planFormReqs([])).toEqual([])
  })
})

describe('authorFormRequirements', () => {
  it('writes rows with index 0..n-1, promptVersion and model, at the card klpVersion', async () => {
    const out = await authorFormRequirements('c1', fakeGen('not_met'))
    expect(out.written).toBe(3)
    expect(h.createMany).toHaveBeenCalledTimes(1)
    const rows = h.createMany.mock.calls[0][0].data
    expect(rows.map((r: { index: number }) => r.index)).toEqual([0, 1, 2])
    for (const [i, r] of rows.entries()) {
      expect(r).toMatchObject({ cardId: 'c1', klpVersion: 3, text: REQS[i].text, promptVersion: WRITE_FORM_REQS_PROMPT.version, model: 'deepseek-flash' })
    }
  })

  it('builds the authoring prompt from the card, the reference answer and the live KLPs', async () => {
    const calls: { prompt: string; schema: unknown }[] = []
    await authorFormRequirements('c1', fakeGen('not_met', calls))
    const write = calls.find((c) => c.schema === FormRequirementsSchema)!
    expect(write.prompt).toBe(WRITE_FORM_REQS_PROMPT.build({ question: 'Why does EV/EBITDA fall when leverage rises?', definition: 'D', referenceAnswer: 'Reference answer text', klps: h.klps }))
  })

  it('the weak check grades the memorized_template probe against the new requirements and reports weak when every one is met', async () => {
    const calls: { prompt: string; schema: unknown }[] = []
    const out = await authorFormRequirements('c1', fakeGen('met', calls))
    expect(out.weak).toBe(true)
    expect(out.probeChecked).toBe(true)
    const grade = calls.find((c) => c.schema === ShortAnswerGradeSchema)!
    // the probe is the learner's answer; the requirements are listed as form requirements
    expect(grade.prompt).toContain('A memorised template answer about leverage.')
    for (const [i, r] of REQS.entries()) expect(grade.prompt).toContain(`[F${i}] ${r.text}`)
    // it is the runtime grader's prompt, so the trap is graded by the instrument that will grade learners
    expect(grade.prompt).toBe(
      GRADE_SHORT_ANSWER_PROMPT.build({
        card: h.card as never,
        answer: 'A memorised template answer about leverage.',
        klps: h.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
        formReqs: REQS.map((r, ref) => ({ ref, text: r.text })),
        referenceAnswer: 'Reference answer text',
      }),
    )
  })

  it('is not weak when the trap fails at least one requirement', async () => {
    const out = await authorFormRequirements('c1', fakeGen('not_met'))
    expect(out.weak).toBe(false)
    expect(out.probeChecked).toBe(true)
  })

  it('is not weak when the grader omits a requirement — only an explicit met on every rule counts', async () => {
    const gen = (async (prompt: string, schema: unknown) => {
      if (schema === FormRequirementsSchema) return { value: { requirements: REQS }, model: 'm' }
      return { value: { ...GRADE, formResults: [{ formRef: 0, status: 'met' }, { formRef: 1, status: 'met' }] }, model: 'm' }
    }) as FormReqGen
    expect((await authorFormRequirements('c1', gen)).weak).toBe(false)
  })

  it('skips the weak check, and the second call, when the authoring has no memorized_template probe', async () => {
    h.authoring = { referenceAnswer: 'Reference answer text', probes: [] }
    const calls: { prompt: string; schema: unknown }[] = []
    const out = await authorFormRequirements('c1', fakeGen('met', calls))
    expect(out.written).toBe(3)
    expect(out.weak).toBe(false)
    expect(out.probeChecked).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('is resumable: rows at the current klpVersion mean no call and no write', async () => {
    h.existingCount = 3
    const calls: { prompt: string; schema: unknown }[] = []
    const out = await authorFormRequirements('c1', fakeGen('met', calls))
    expect(out).toMatchObject({ written: 0, weak: false, skipped: 'exists' })
    expect(calls).toHaveLength(0)
    expect(h.createMany).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.cardFormRequirement.count)).toHaveBeenCalledWith({ where: { cardId: 'c1', klpVersion: 3 } })
  })

  it('never re-authors: a card with no CardAuthoring at its klpVersion is skipped, not drafted', async () => {
    h.authoring = null
    const calls: { prompt: string; schema: unknown }[] = []
    const out = await authorFormRequirements('c1', fakeGen('met', calls))
    expect(out).toMatchObject({ written: 0, skipped: 'no_authoring' })
    expect(calls).toHaveLength(0)
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('skips a card with no live key points', async () => {
    h.klps = []
    const out = await authorFormRequirements('c1', fakeGen('met'))
    expect(out).toMatchObject({ written: 0, skipped: 'no_klps' })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('throws on an unknown card', async () => {
    h.card = null
    await expect(authorFormRequirements('nope', fakeGen('met'))).rejects.toThrow(/nope/)
  })
})
