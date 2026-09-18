// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import MissedWork from '@/components/learner/MissedWork'
import type { MissedTopic } from '@/lib/metrics/missed'

// vitest.config.ts has no `globals: true`, so RTL never registers its own
// auto-cleanup and one test's DOM would bleed into the next.
afterEach(cleanup)

const FULL_TEXT = 'Lease debt is added back when moving from Equity Value to Enterprise Value.'

const topics: MissedTopic[] = [
  {
    key: 'wacc',
    name: 'WACC',
    knowledge: 0.2,
    missCount: 2,
    klps: [
      {
        klpId: 'k1',
        label: 'Debt impact on WACC',
        text: FULL_TEXT,
        term: 'WACC',
        pKnown: 0.2,
        observations: 5,
        misses: [
          {
            klpId: 'k1',
            status: 'failed',
            mode: 'quiz-sa',
            createdAt: new Date('2026-08-22'),
            errorTypes: ['negated_relationship'],
          },
        ],
      },
    ],
  },
]

describe('MissedWork', () => {
  it('leads with the short label, not the full proposition', () => {
    render(<MissedWork topics={topics} floor={3} />)
    expect(screen.getByText('Debt impact on WACC')).toBeTruthy()
    expect(screen.queryByText(FULL_TEXT)).toBeNull()
  })

  it('falls back to the proposition when the topic pass has not run', () => {
    // The summarizer must never be a hard dependency of this panel.
    const noLabel = [{ ...topics[0], klps: [{ ...topics[0].klps[0], label: null }] }]
    render(<MissedWork topics={noLabel} floor={3} />)
    expect(screen.getByText(FULL_TEXT)).toBeTruthy()
  })

  it('reveals the full proposition and the misses on expand', () => {
    render(<MissedWork topics={topics} floor={3} />)
    fireEvent.click(screen.getByRole('button', { name: /Debt impact on WACC/i }))
    expect(screen.getByText(FULL_TEXT)).toBeTruthy()
    expect(screen.getByText('Short answer')).toBeTruthy()
    expect(screen.getByText('negated relationship')).toBeTruthy()
    // The status badge renders the LABEL, never the raw token.
    expect(screen.getByText('Missed')).toBeTruthy()
    expect(screen.queryByText('failed')).toBeNull()
  })

  it('colours a status badge by credit and reads it by label — an `omission` is a full miss', () => {
    // FINAL REVIEW finding (3): the badge compared `status === 'failed'` and
    // printed the raw token, so a Spec 5 `omission` (credit 0) rendered grey
    // as if it were a half-miss and read "omission" to the learner.
    const withOmission: MissedTopic[] = [
      {
        ...topics[0],
        klps: [
          {
            ...topics[0].klps[0],
            misses: [
              { klpId: 'k1', status: 'omission', mode: 'quiz-sa', createdAt: new Date('2026-09-17'), errorTypes: [] },
              { klpId: 'k1', status: 'partial', mode: 'quiz-sa', createdAt: new Date('2026-09-16'), errorTypes: [] },
            ],
          },
        ],
      },
    ]
    render(<MissedWork topics={withOmission} floor={3} />)
    fireEvent.click(screen.getByRole('button', { name: /Debt impact on WACC/i }))
    const missing = screen.getByText('Missing')
    const partial = screen.getByText('Partially covered')
    expect(screen.queryByText('omission')).toBeNull()
    // Credit 0 is destructive; credit 0.5 is not — the variant is the credit
    // bucket, so the two badges must not share a class list.
    expect(missing.className).not.toBe(partial.className)
    expect(missing.className).toMatch(/text-destructive/)
    expect(partial.className).not.toMatch(/text-destructive/)
  })

  it('renders an unmeasured topic as its own state, never as 0%', () => {
    render(<MissedWork topics={[{ ...topics[0], knowledge: null }]} floor={3} />)
    expect(screen.getByText(/not measured/i)).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('withholds pKnown inside the drill-down when it is null', () => {
    const unmeasured = [
      {
        ...topics[0],
        knowledge: null,
        klps: [{ ...topics[0].klps[0], pKnown: null, observations: 1 }],
      },
    ]
    render(<MissedWork topics={unmeasured} floor={3} />)
    fireEvent.click(screen.getByRole('button', { name: /Debt impact on WACC/i }))
    expect(screen.getByText(/1 answer/)).toBeTruthy()
    expect(screen.queryByText(/% known/)).toBeNull()
  })

  it('says nothing is wrong rather than rendering an empty box', () => {
    render(<MissedWork topics={[]} floor={3} />)
    expect(screen.getByText(/Nothing wrong to show yet/i)).toBeTruthy()
  })

  it('quotes the learner’s own floor rather than a hardcoded 3', () => {
    render(<MissedWork topics={topics} floor={1} />)
    expect(screen.getByText(/once 1 answer have/i)).toBeTruthy()
  })

  it('shows the miss count per topic and per point', () => {
    render(<MissedWork topics={topics} floor={3} />)
    expect(screen.getByText('2 misses')).toBeTruthy()
    expect(screen.getByText('1×')).toBeTruthy()
  })

  it('starts collapsed so the panel is a shortlist, not a wall', () => {
    render(<MissedWork topics={topics} floor={3} />)
    expect(screen.getByRole('button', { name: /Debt impact on WACC/i }).getAttribute(
      'aria-expanded',
    )).toBe('false')
  })
})
