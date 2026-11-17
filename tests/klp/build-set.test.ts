import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  /** Rows in the shape `loadCards` selects. */
  dbCards: [] as Record<string, unknown>[],
  authorFormRequirements: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    set: { findUnique: vi.fn(async () => ({ title: 'S' })) },
    card: { findMany: vi.fn(async () => h.dbCards) },
  },
}))
vi.mock('@/lib/klp/form-requirements', () => ({ authorFormRequirements: h.authorFormRequirements }))
vi.mock('@/lib/klp/generators', () => ({
  authoringGenerator: vi.fn(),
  topicGenerator: vi.fn(),
  formReqsGenerator: vi.fn(() => 'pool-gen'),
}))
import { summarize, buildSetStep, FORM_REQS_PER_STEP } from '@/lib/klp/build-set'

const row = (o: Partial<Parameters<typeof summarize>[0][number]> = {}) => ({
  id: 'c', term: 't', definition: 'd', klpStatus: 'ready', kltStatus: 'ready', klpVersion: 3, topicKlpVersion: 3, kltError: null, klpError: null, authoredVersion: 3, klpCount: 5, hasFormReqs: true,
  ...o,
})

describe('set build status', () => {
  it('a card authored at its current version, minted from it, and placed is ready', () => {
    expect(summarize([row()])).toEqual({ cards: 1, needAuthoring: 0, needFormReqs: 0, needMinting: 0, needRebuild: 0, failed: 0, ready: true })
  })
  it('an edit (klpStatus pending) or a version the pipeline never authored needs authoring first', () => {
    expect(summarize([row({ klpStatus: 'pending' })]).needAuthoring).toBe(1)
    expect(summarize([row({ authoredVersion: 2 })]).needAuthoring).toBe(1)
    expect(summarize([row({ authoredVersion: null })]).needAuthoring).toBe(1)
    // legacy extraction leaves points but no authoring row: still authoring
    expect(summarize([row({ authoredVersion: null, klpCount: 2 })]).needAuthoring).toBe(1)
  })
  it('authored but the fragment is from older points → mint; minted but the tree not written → rebuild', () => {
    expect(summarize([row({ topicKlpVersion: 2 })])).toMatchObject({ needAuthoring: 0, needMinting: 1, needRebuild: 0 })
    expect(summarize([row({ topicKlpVersion: null })])).toMatchObject({ needMinting: 1 })
    expect(summarize([row({ kltStatus: 'pending' })])).toMatchObject({ needAuthoring: 0, needMinting: 0, needRebuild: 1, ready: false })
  })
  it('counts a recorded error only on the stage the card is stuck at', () => {
    expect(summarize([row({ klpStatus: 'pending', klpError: 'quota' })]).failed).toBe(1)
    expect(summarize([row({ klpError: 'old error from a past run' })]).failed).toBe(0)
    expect(summarize([row({ topicKlpVersion: null, kltError: 'schema' })]).failed).toBe(1)
  })
  it('authored at its version but with no form requirements there → form-reqs, and the set is not ready', () => {
    // Spec 5 §5: form requirements are versioned with the KLPs, so a re-authored
    // card (or one authored before the pass existed) needs the pass again.
    expect(summarize([row({ hasFormReqs: false })])).toMatchObject({ needAuthoring: 0, needFormReqs: 1, ready: false })
    // authoring comes first: a card that needs points does not also count as needing form rules
    expect(summarize([row({ klpStatus: 'pending', hasFormReqs: false })])).toMatchObject({ needAuthoring: 1, needFormReqs: 0 })
    // form rules and topics are independent needs; both are reported
    expect(summarize([row({ hasFormReqs: false, topicKlpVersion: 2 })])).toMatchObject({ needFormReqs: 1, needMinting: 1 })
  })
})

/** A card row as `prisma.card.findMany` returns it to `loadCards`: authored at v3, form rules by `formReqVersions`. */
const dbRow = (id: string, formReqVersions: number[]) => ({
  id, term: 't', definition: 'd', klpStatus: 'ready', kltStatus: 'ready', klpVersion: 3, topicKlpVersion: 3, kltError: null, klpError: null,
  authorings: [{ klpVersion: 3 }], _count: { klps: 5 }, formRequirements: formReqVersions.map((klpVersion) => ({ klpVersion })),
})

describe('buildSetStep: the form-reqs step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.authorFormRequirements.mockResolvedValue({ written: 3, weak: false, probeChecked: true, requirements: [] })
  })

  it('runs after authoring, on the cards with no rows at their version, up to the per-step cap, with the injected generator', async () => {
    h.dbCards = [dbRow('a', []), dbRow('b', [3]), dbRow('c', [2]), ...['d', 'e', 'f'].map((id) => dbRow(id, []))]
    const gen = vi.fn()
    const step = await buildSetStep('u', 's', { generators: { authoring: {} as never, topic: {} as never, formReqs: gen } })
    expect(step.did).toBe('form-reqs')
    // a, c, d, e — b has rows at v3; f is beyond the cap
    expect(step.cards).toEqual(['a', 'c', 'd', 'e'])
    expect(step.cards.length).toBe(FORM_REQS_PER_STEP)
    for (const id of step.cards) expect(h.authorFormRequirements).toHaveBeenCalledWith(id, gen, expect.anything())
    expect(step.errors).toEqual([])
  })

  it('uses the owner form-reqs pool generator when none is injected', async () => {
    h.dbCards = [dbRow('a', [])]
    const step = await buildSetStep('u', 's')
    expect(step.did).toBe('form-reqs')
    expect(h.authorFormRequirements).toHaveBeenCalledWith('a', 'pool-gen', expect.anything())
  })

  it('a provider failure is reported per card and a quota halt stops the step, nothing thrown', async () => {
    h.dbCards = [dbRow('a', []), dbRow('b', [])]
    // a 402 classifies as quota_exhausted — the halt kinds are the same three the author step stops on
    h.authorFormRequirements.mockRejectedValueOnce(Object.assign(new Error('Payment Required'), { statusCode: 402 }))
    const step = await buildSetStep('u', 's')
    expect(step.did).toBe('form-reqs')
    expect(step.cards).toEqual([])
    expect(step.errors).toHaveLength(1)
    expect(step.errors[0]).toEqual({ cardId: 'a', kind: 'quota_exhausted' })
    expect(h.authorFormRequirements).toHaveBeenCalledTimes(1)
  })

  it('a skip from the module is reported, not counted done, so a caller loop cannot spin on it', async () => {
    h.dbCards = [dbRow('a', [])]
    h.authorFormRequirements.mockResolvedValueOnce({ written: 0, weak: false, probeChecked: false, skipped: 'no_authoring', requirements: [] })
    const step = await buildSetStep('u', 's')
    expect(step.cards).toEqual([])
    expect(step.errors).toEqual([{ cardId: 'a', kind: 'skipped_no_authoring' }])
  })

  it('with every card carrying rules at its version the step moves on', async () => {
    h.dbCards = [dbRow('a', [3]), dbRow('b', [2, 3])]
    const step = await buildSetStep('u', 's')
    expect(step.did).toBe('nothing')
    expect(h.authorFormRequirements).not.toHaveBeenCalled()
    expect(step.status).toMatchObject({ needFormReqs: 0, ready: true })
  })
})
