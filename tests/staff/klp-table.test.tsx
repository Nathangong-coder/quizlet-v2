// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { KlpTable } from '@/components/staff/KlpTable'
import type { StaffKlpRow } from '@/lib/staff/queries'

afterEach(cleanup)

function row(over: Partial<StaffKlpRow> = {}): StaffKlpRow {
  return {
    id: 'k1',
    text: 'Depreciation reduces EBIT by the full 10.',
    label: 'EBIT falls 10',
    cardId: 'c1',
    cardTerm: 'Depreciation walkthrough',
    setId: 's1',
    kind: 'mechanism',
    weight: 5,
    version: 1,
    supersededAt: null,
    topics: [{ name: 'income statement', rank: 1 }],
    learnerCount: 3,
    meanPKnown: 0.62,
    verdicts: { passed: 4, failed: 2 },
    ...over,
  }
}

describe('KlpTable', () => {
  it('prefers the short label and still exposes the full text', () => {
    render(<KlpTable rows={[row()]} />)
    expect(screen.getByText('EBIT falls 10')).toBeInTheDocument()
    expect(screen.getByTitle('Depreciation reduces EBIT by the full 10.')).toBeInTheDocument()
  })

  it('falls back to the text when the topic pass has not run', () => {
    render(<KlpTable rows={[row({ label: null })]} />)
    expect(screen.getByText('Depreciation reduces EBIT by the full 10.')).toBeInTheDocument()
  })

  // The G1 finding: no evidence is not zero knowledge, and rendering 0% would
  // make an unasked key point indistinguishable from a failed one.
  //
  // FINDING 6 (review, 2026-09-03): the original assertion checked for ANY
  // em dash anywhere in the document, which cannot fail — the Relations
  // column always renders one regardless of meanPKnown. Scope it to the
  // mean-known cell specifically (columns: key point, card, kind, weight,
  // topics, learners, mean known, verdicts, relations — mean known is
  // index 6), so this actually exercises the null-meanPKnown rendering.
  it('renders an em dash, never 0%, in the mean-known cell when no learner has evidence', () => {
    const { container } = render(<KlpTable rows={[row({ learnerCount: 0, meanPKnown: null })]} />)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    const cells = container.querySelectorAll('tbody td')
    const meanKnownCell = cells[6]
    expect(meanKnownCell.textContent?.trim()).toBe('—')
  })

  it('renders the verdict mix from whatever statuses are present, not a fixed three', () => {
    render(<KlpTable rows={[row({ verdicts: { passed: 1, inversion: 2, omission: 5 } })]} />)
    expect(screen.getByText(/inversion/)).toBeInTheDocument()
    expect(screen.getByText(/omission/)).toBeInTheDocument()
  })

  it('renders the Relations column as pending, so Spec 3 fills a column that exists', () => {
    render(<KlpTable rows={[row()]} />)
    expect(screen.getByRole('columnheader', { name: /relations/i })).toBeInTheDocument()
  })

  it('marks a superseded row as superseded', () => {
    render(<KlpTable rows={[row({ supersededAt: new Date('2026-08-01') })]} />)
    expect(screen.getByText(/superseded/i)).toBeInTheDocument()
  })
})
