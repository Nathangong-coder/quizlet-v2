// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MasteryList } from '@/components/sets/knowledge/MasteryList'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'

// MasteryList renders ConceptKlps (collapsed by default), which imports the
// 'use server' module @/actions/klt-tree. None of the tests below open a
// key-points panel, but the static import still runs at module load time —
// importing the real module drags in src/lib/db.ts, which throws when
// DATABASE_URL isn't set in this test environment. Same idiom as
// tests/components/concept-tree.test.tsx.
vi.mock('@/actions/klt-tree', () => ({ listTopicKlps: vi.fn() }))

afterEach(cleanup)

function row(key: string, parentKey: string | null, hasChildren: boolean): TopicMasteryRow {
  return {
    key,
    name: key,
    depth: parentKey === null ? 0 : 1,
    parentKey,
    hasChildren,
    knowledge: 0.5,
    klpCount: 2,
    measuredKlpCount: 2,
    // MasteryShade is 'unknown' | 'weak' | 'developing' | 'solid' | 'strong'.
    shade: 'developing',
  }
}

describe('MasteryList', () => {
  it('shows roots expanded and hides deeper rungs until asked', () => {
    render(<MasteryList setId="s1" rows={[row('dcf', null, true), row('wacc', 'dcf', false)]} />)
    expect(screen.getByText('dcf')).toBeInTheDocument()
    expect(screen.queryByText('wacc')).not.toBeInTheDocument()
  })

  it('reveals children on expand — the dropdown the roots never had', () => {
    render(<MasteryList setId="s1" rows={[row('dcf', null, true), row('wacc', 'dcf', false)]} />)
    fireEvent.click(screen.getByRole('button', { name: /expand dcf/i }))
    expect(screen.getByText('wacc')).toBeInTheDocument()
  })

  it('gives a leaf no expander for children but still one for key points', () => {
    render(<MasteryList setId="s1" rows={[row('solo', null, false)]} />)
    expect(screen.queryByRole('button', { name: /expand solo/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /key points for solo/i })).toBeInTheDocument()
  })

  it('renders the empty state unchanged', () => {
    render(<MasteryList setId="s1" rows={[]} />)
    expect(screen.getByText(/no concept structure/i)).toBeInTheDocument()
  })
})
