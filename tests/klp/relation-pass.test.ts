import { describe, it, expect, vi } from 'vitest'
import { authorCard } from '@/lib/klp/authoring'

/**
 * THE RELATION PASS in the loop (2026-09-19): after the relate call the
 * reference and the traps are graded once more on points + links; edges the
 * reference fails are pruned; the bar reads points + links; a card whose
 * points a template recites but whose links it misses is separated, not
 * memorizable.
 */
const klps = [
  { text: 'X is defined as Y', kind: 'definition' },
  { text: '8% is below 10%', kind: 'quantitative' },
  { text: 'the funding cost is 10%', kind: 'condition' },
  { text: 'EPS falls because yield < cost', kind: 'causal' },
  { text: 'the deal is dilutive', kind: 'contrast' },
]
const mostlyFraming = { points: [{ index: 0, role: 'framing' }, { index: 1, role: 'framing' }, { index: 2, role: 'framing' }, { index: 3, role: 'substance' }, { index: 4, role: 'framing' }] }

function gen(opts: { relations: { from: number; to: number; type: string }[]; linkVerdict: (answer: string, i: number) => string }) {
  const grade = vi.fn().mockImplementation(({ candidateAnswer, klps: shown, relations }: { candidateAnswer: string; klps: { text: string }[]; relations?: unknown[] }) => ({
    // Points: the template ('w3') recites everything the reference states.
    verdicts: shown.map((_, i) => ({ klpIndex: i, verdict: candidateAnswer === 'ref' || candidateAnswer === 'w3' ? 'correct' : 'omission' })),
    ...(relations ? { relationVerdicts: relations.map((_, i) => ({ relationIndex: i, verdict: opts.linkVerdict(candidateAnswer, i) })) } : {}),
  }))
  const relate = vi.fn().mockResolvedValue({ relations: opts.relations.map((r) => ({ ...r, provenance: 'perturbation', rationale: 'r', probe: 'p' })) })
  return {
    grade,
    relate,
    author: vi.fn().mockResolvedValue({ referenceAnswer: 'ref', klps, wrongAnswers: [{ kind: 'vague', text: 'w2' }, { kind: 'memorized_template', text: 'w3' }] }),
    revise: vi.fn(),
    classifyRoles: vi.fn().mockResolvedValue(mostlyFraming),
  }
}

describe('the relation pass in authorCard', () => {
  it('links rescue a memorizable card: the template recites the points but omits every link', async () => {
    const g = gen({
      relations: [{ from: 1, to: 3, type: 'causes' }, { from: 2, to: 3, type: 'requires' }],
      linkVerdict: (answer) => (answer === 'ref' ? 'correct' : 'omission'),
    })
    const out = await authorCard({ question: 'Q', definition: 'D', setTitle: 'S' }, g as never)
    // Three extra grade calls carried relations: reference + two traps.
    const relCalls = g.grade.mock.calls.filter((c) => (c[0] as { relations?: unknown[] }).relations?.length)
    expect(relCalls).toHaveLength(3)
    expect(out.relations).toHaveLength(2)
    expect(out.relationStats.droppedForReference).toBe(0)
    expect(out.relationSeparation).toBe(1)
    // substance point [3]: ref 1, template 1; links: ref 1,1, template 0,0 → ref 3/3, template 1/3 → 0.667
    expect(out.combinedSeparation).toBeCloseTo(2 / 3)
    expect(out.substanceSeparation).toBe(0)
    expect(out.status).toBe('separated')
    expect(out.referenceRelationVerdicts).toEqual(['correct', 'correct'])
    expect(out.probes.find((p) => p.kind === 'memorized_template')?.relationVerdicts).toEqual({ '0': 'omission', '1': 'omission' })
  })

  it('an edge the reference does not assert is pruned, and its verdicts are re-indexed onto the kept list', async () => {
    const g = gen({
      relations: [{ from: 0, to: 1, type: 'precedes' }, { from: 1, to: 3, type: 'causes' }],
      // The reference fails link 0 (definitional); everyone fails link 1 except the reference.
      linkVerdict: (answer, i) => (i === 0 ? 'omission' : answer === 'ref' ? 'correct' : 'contradicted'),
    })
    const out = await authorCard({ question: 'Q', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.relations).toEqual([expect.objectContaining({ from: 1, to: 3, type: 'causes' })])
    expect(out.relationStats).toMatchObject({ candidates: 2, accepted: 1, droppedForReference: 1 })
    expect(out.referenceRelationVerdicts).toEqual(['correct'])
    expect(out.probes[0].relationVerdicts).toEqual({ '0': 'contradicted' })
    expect(out.relationSeparation).toBe(1)
  })

  it('when every link is recited too, the card stays memorizable and nothing is fabricated', async () => {
    const g = gen({ relations: [{ from: 1, to: 3, type: 'causes' }], linkVerdict: () => 'correct' })
    const out = await authorCard({ question: 'Q', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.status).toBe('memorizable')
    expect(out.combinedSeparation).toBe(0)
  })

  it('a card with no relations runs no pass and carries no relation numbers', async () => {
    const g = gen({ relations: [], linkVerdict: () => 'correct' })
    const out = await authorCard({ question: 'Q', definition: 'D', setTitle: 'S' }, g as never)
    expect(g.grade.mock.calls.every((c) => !(c[0] as { relations?: unknown[] }).relations)).toBe(true)
    expect(out.relationSeparation).toBeUndefined()
    expect(out.combinedSeparation).toBeUndefined()
    expect(out.relationStats.droppedForReference).toBeUndefined()
    expect(out.status).toBe('memorizable')
  })

  it('a grader that returns no link verdicts did not run the pass: relations kept, no numbers, no pruning', async () => {
    const g = gen({ relations: [{ from: 1, to: 3, type: 'causes' }], linkVerdict: () => 'correct' })
    const plain = g.grade.getMockImplementation()!
    g.grade.mockImplementation((input: { relations?: unknown[] }) => {
      const r = plain(input) as { verdicts: unknown[]; relationVerdicts?: unknown[] }
      delete r.relationVerdicts
      return r
    })
    const out = await authorCard({ question: 'Q', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.relations).toHaveLength(1)
    expect(out.relationStats.droppedForReference).toBeUndefined()
    expect(out.relationSeparation).toBeUndefined()
    expect(out.status).toBe('memorizable')
  })

  it('a pass that throws leaves the point-only verdict standing', async () => {
    const g = gen({ relations: [{ from: 1, to: 3, type: 'causes' }], linkVerdict: () => 'correct' })
    const plain = g.grade.getMockImplementation()!
    g.grade.mockImplementation((input: { relations?: unknown[] }) => {
      if (input.relations) throw new Error('provider down')
      return plain(input)
    })
    const out = await authorCard({ question: 'Q', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.status).toBe('memorizable')
    expect(out.relationSeparation).toBeUndefined()
    expect(out.relations).toHaveLength(1)
  })
})
