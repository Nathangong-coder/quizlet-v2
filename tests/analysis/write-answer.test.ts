import { describe, it, expect, vi } from 'vitest'

// The module opens its own transaction when no client is passed, so it imports
// the real Prisma client at module load — which throws without DATABASE_URL.
// These assertions are about the exported contract, not a live write.
vi.mock('@/lib/db', () => ({ prisma: { $transaction: vi.fn() } }))

import {
  ANALYSIS_TX_OPTIONS,
  DIAGNOSTIC_TX_OPTIONS,
  createAnswerWithAnalysis,
} from '@/lib/analysis/write-answer'

describe('write-answer module', () => {
  it('exports the shared writer, so a second one cannot grow beside it', () => {
    // It holds the KlpState locking discipline, the supersede-and-replay rule
    // and the CardProgress recompute. Two copies is how two posteriors start
    // disagreeing — and a 'use server' module could not have exported it.
    expect(typeof createAnswerWithAnalysis).toBe('function')
  })

  it('accepts a caller-supplied transaction client', () => {
    // Arity: (answerData, writes, replace, tx). The diagnostic composes twelve
    // of these inside ONE transaction so a mid-loop failure rolls the whole
    // sitting back rather than leaving half a graded test behind.
    expect(createAnswerWithAnalysis.length).toBe(4)
  })

  it('keeps the per-answer transaction sizing unchanged', () => {
    expect(ANALYSIS_TX_OPTIONS).toEqual({ maxWait: 10_000, timeout: 30_000 })
  })

  it('sizes the diagnostic transaction for a whole sitting, not one answer', () => {
    // Quiz writes ONE answer per transaction; a diagnostic writes twelve, each
    // costing a serialized advisory lock + read + write per key point. A P2028
    // here does not degrade — it discards a test the learner just spent twenty
    // minutes on.
    expect(DIAGNOSTIC_TX_OPTIONS.timeout).toBeGreaterThan(ANALYSIS_TX_OPTIONS.timeout)
    expect(DIAGNOSTIC_TX_OPTIONS.maxWait).toBeGreaterThanOrEqual(ANALYSIS_TX_OPTIONS.maxWait)
  })
})
