import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ prisma: {} }))
import { summarize } from '@/lib/klp/build-set'

const row = (o: Partial<Parameters<typeof summarize>[0][number]> = {}) => ({
  id: 'c', term: 't', definition: 'd', klpStatus: 'ready', kltStatus: 'ready', klpVersion: 3, topicKlpVersion: 3, kltError: null, klpError: null, authoredVersion: 3, klpCount: 5,
  ...o,
})

describe('set build status', () => {
  it('a card authored at its current version, minted from it, and placed is ready', () => {
    expect(summarize([row()])).toEqual({ cards: 1, needAuthoring: 0, needMinting: 0, needRebuild: 0, failed: 0, ready: true })
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
})
