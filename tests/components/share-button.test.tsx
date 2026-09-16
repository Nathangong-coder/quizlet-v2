// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

afterEach(cleanup)

vi.mock('@/actions/sets', () => ({ setSetVisibility: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ShareButton, shareUrl } from '@/components/sets/ShareButton'

describe('ShareButton', () => {
  it('builds the shareable address from the page origin', () => {
    expect(shareUrl('s1', 'https://synapsehq.app')).toBe('https://synapsehq.app/sets/s1')
  })

  it('gives a reader on a shared set a copy button and nothing to change', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ShareButton setId="s1" visibility="link" isOwner={false} />)
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/sets\/s1$/)))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders nothing for a reader on a private set', () => {
    // Unreachable in practice (a reader cannot open a private set), guarded so
    // a future call site cannot offer a copy button for an address that 404s.
    const { container } = render(<ShareButton setId="s1" visibility="private" isOwner={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('gives the owner the visibility options with the current one selected', () => {
    render(<ShareButton setId="s1" visibility="public" isOwner />)
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options.find((o) => o.getAttribute('aria-selected') === 'true')).toHaveTextContent(/public/i)
  })
})
