// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/actions/klt-tree', () => ({ listTopicKlps: h.list }))

import { ConceptKlps } from '@/components/sets/knowledge/ConceptKlps'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ConceptKlps', () => {
  it('lists the key points filed under the concept', async () => {
    h.list.mockResolvedValue({
      success: true,
      data: [{ id: 'k1', text: 'EBIT falls by the full depreciation', pKnown: 0.4, observations: 3 }],
    })
    render(<ConceptKlps setId="s1" topicKey="depreciation" />)
    await waitFor(() =>
      expect(screen.getByText('EBIT falls by the full depreciation')).toBeInTheDocument(),
    )
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('shows an em dash, never 0%, for a key point with no evidence', async () => {
    h.list.mockResolvedValue({
      success: true,
      data: [{ id: 'k1', text: 'Unasked point', pKnown: null, observations: 0 }],
    })
    render(<ConceptKlps setId="s1" topicKey="x" />)
    await waitFor(() => expect(screen.getByText('Unasked point')).toBeInTheDocument())
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('reports a failure instead of rendering an empty list', async () => {
    h.list.mockResolvedValue({ success: false, error: 'Not found' })
    render(<ConceptKlps setId="s1" topicKey="x" />)
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument())
  })

  it('says so plainly when a concept has no key points yet', async () => {
    h.list.mockResolvedValue({ success: true, data: [] })
    render(<ConceptKlps setId="s1" topicKey="x" />)
    await waitFor(() => expect(screen.getByText(/no key points/i)).toBeInTheDocument())
  })
})
