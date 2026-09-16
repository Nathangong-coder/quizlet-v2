import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { task: string; prompt: string }[] = []
vi.mock('@/lib/ai/generate', () => ({
  generateJson: vi.fn(async (input: { task: string; prompt: string }) => { calls.push({ task: input.task, prompt: input.prompt }); return { ok: true } }),
  generateJsonWithMeta: vi.fn(async (input: { task: string; prompt: string }) => { calls.push({ task: input.task, prompt: input.prompt }); return { value: { ok: true }, meta: { model: 'm' } } }),
}))

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { authoringGenerator, topicGenerator } from '@/lib/klp/generators'

describe('in-app generators route by task, so the measured role split holds without naming a model', () => {
  beforeEach(() => { calls.length = 0 })
  it('writing goes out as `author`; every judging call as `klp-extract`', async () => {
    const g = authoringGenerator('u')
    await g.author({ setTitle: 's', question: 'q', definition: 'd', minKlps: 3 })
    await g.reviseReference!({ question: 'q', definition: 'd', referenceAnswer: 'r', klps: [], review: { accuracy: 'ok', conciseness: 'ok', clarity: 'ok', issues: [] } as never })
    const writers = calls.map((c) => c.task)
    expect(writers).toEqual(['author', 'author'])
    calls.length = 0
    await g.grade({ question: 'q', candidate: 'c', klps: [] } as never)
    await g.writeAdversaries!({ question: 'q', referenceAnswer: 'r' } as never)
    await g.classifyRoles!({ question: 'q', definition: 'd', klps: [] } as never)
    await g.rebuild!({ question: 'q', klps: [] } as never)
    await g.relate({ question: 'q', klps: [] } as never)
    expect(new Set(calls.map((c) => c.task))).toEqual(new Set(['klp-extract']))
  })
  it('minting goes out as `concept-tree`', async () => {
    const t = topicGenerator('u')
    await t.mint('p'); await t.assign('p'); await t.revise('p')
    expect(calls.map((c) => c.task)).toEqual(['concept-tree', 'concept-tree', 'concept-tree'])
  })
})
