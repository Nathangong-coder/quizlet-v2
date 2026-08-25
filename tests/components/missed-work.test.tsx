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
