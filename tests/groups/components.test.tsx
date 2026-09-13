// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

afterEach(cleanup)

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const joinGroup = vi.fn(async () => ({ success: true, data: { id: 'g1' } }))
vi.mock('@/actions/groups', () => ({ joinGroup: (...a: unknown[]) => joinGroup(...(a as [])) }))

import { Leaderboard } from '@/components/groups/Leaderboard'
import { JoinGroupCard } from '@/components/groups/JoinGroupCard'
import { shapeSetLeaderboard } from '@/lib/groups/progress'

describe('Leaderboard', () => {
  it('ranks, marks the viewer, links handles, and renders a null average as a dash', () => {
    const board = shapeSetLeaderboard({
      setId: 's1',
      cardIds: ['c1', 'c2'],
      members: [{ userId: 'a', handle: 'alice' }, { userId: 'b', handle: null }],
      progress: [{ userId: 'a', cardId: 'c1', confidence: 9, updatedAt: new Date('2026-09-01') }],
      sessions: [],
    })
    render(<Leaderboard board={board} viewerId="b" />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('@alice')
    expect(screen.getByRole('link', { name: '@alice' })).toHaveAttribute('href', '/u/alice')
    expect(rows[1]).toHaveTextContent('(you)')
    expect(rows[1]).toHaveTextContent('—')
    expect(screen.getByRole('img', { name: '1 mastered, 0 learning, 1 not started' })).toBeTruthy()
  })
})

describe('JoinGroupCard — the consent gate in the UI', () => {
  const group = { id: 'g1', name: 'Superday prep', description: null, memberCount: 3, setTitles: ['M&A'], alreadyMember: false }

  it('states the contract and keeps Join disabled until acknowledged', () => {
    render(<JoinGroupCard code="abcdefghjkmnpqrs" group={group} />)
    expect(screen.getByRole('note', { name: /what this group will see/i })).toHaveTextContent(/leaving stops it immediately/i)
    const join = screen.getByRole('button', { name: /join group/i })
    expect(join).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(join).toBeEnabled()
    fireEvent.click(join)
    expect(joinGroup).toHaveBeenCalledWith('abcdefghjkmnpqrs', true)
  })

  it('offers "open it" instead of the contract to an existing member', () => {
    render(<JoinGroupCard code="abcdefghjkmnpqrs" group={{ ...group, alreadyMember: true }} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('link', { name: /open it/i })).toHaveAttribute('href', '/groups/g1')
  })
})
