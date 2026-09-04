import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  write: vi.fn(), authoringCreate: vi.fn(), probeCreateMany: vi.fn(), relationCreateMany: vi.fn(),
}))
vi.mock('@/lib/cards/klp-write', () => ({ writeKlpVersion: h.write }))
vi.mock('@/lib/db', () => ({
  prisma: {
    cardAuthoring: { create: h.authoringCreate },
    authoringProbe: { createMany: h.probeCreateMany },
    klpRelation: { createMany: h.relationCreateMany },
  },
}))

import { persistAuthoring } from '@/lib/klp/authoring-persist'

beforeEach(() => {
  vi.clearAllMocks()
  h.write.mockResolvedValue({ version: 4, klpIds: ['k0', 'k1', 'k2'] })
  h.authoringCreate.mockResolvedValue({ id: 'a1' })
})

const outcome = {
  referenceAnswer: 'ref',
  klps: [
    { text: 'p0', kind: 'mechanism', weight: 3 },
    { text: 'p1', kind: 'causal', weight: 2 },
    { text: 'p2', kind: 'definition', weight: 1 },
  ],
  probes: [{ kind: 'vague' as const, text: 'w', score: 0.2, verdicts: { '0': 'omission' as const } }],
  relations: [{ from: 0, to: 1, type: 'causes' as const, provenance: 'perturbation' as const, rationale: 'r', probe: 'p' }],
  separationScore: 0.8,
  revisions: 1,
  status: 'separated' as const,
  defects: [],
}

describe('persistAuthoring', () => {
  it('writes the KLPs with their COMPUTED weights', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.write.mock.calls[0][1]).toEqual([
      { text: 'p0', kind: 'mechanism', weight: 3, source: 'ai', promptVersion: 1 },
      { text: 'p1', kind: 'causal', weight: 2, source: 'ai', promptVersion: 1 },
      { text: 'p2', kind: 'definition', weight: 1, source: 'ai', promptVersion: 1 },
    ])
  })

  /** Relation endpoints are INDEXES until the rows exist; they must be mapped. */
  it('maps relation indexes onto the real KLP ids', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.relationCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      fromKlpId: 'k0', toKlpId: 'k1', type: 'causes',
    })
  })

  it('records the run with its separation score and status', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.authoringCreate.mock.calls[0][0].data).toMatchObject({
      cardId: 'c1', klpVersion: 4, referenceAnswer: 'ref',
      separationScore: 0.8, revisions: 1, status: 'separated',
    })
  })

  it('writes no relations when there are none, rather than an empty call', async () => {
    await persistAuthoring('c1', { ...outcome, relations: [] }, 1)
    expect(h.relationCreateMany).not.toHaveBeenCalled()
  })

  it('writes KLPs before relations — a relation needs real rows to point at', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.write.mock.invocationCallOrder[0])
      .toBeLessThan(h.relationCreateMany.mock.invocationCallOrder[0])
  })
})
