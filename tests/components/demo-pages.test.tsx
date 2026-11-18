// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const demoAutocomplete = vi.fn()
vi.mock('@/actions/demo', () => ({ demoAutocomplete: (...a: unknown[]) => demoAutocomplete(...a) }))
const promptCalls: { open: boolean; reason: string }[] = []
vi.mock('@/components/demo/WaitlistPrompt', () => ({
  WaitlistPrompt: (p: { open: boolean; reason: string }) => {
    promptCalls.push({ open: p.open, reason: p.reason })
    return null
  },
}))

import { GuestCardBuilder } from '@/components/demo/GuestCardBuilder'
import { DemoReview } from '@/components/demo/DemoReview'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'

const lastOpen = () => [...promptCalls].reverse().find((c) => c.open)

beforeEach(() => {
  window.localStorage.clear()
  promptCalls.length = 0
  demoAutocomplete.mockReset()
})
afterEach(cleanup)

function fillAndAdd(term: string, definition: string) {
  fireEvent.change(screen.getByLabelText('Term'), { target: { value: term } })
  fireEvent.change(screen.getByLabelText('Definition'), { target: { value: definition } })
  fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
}

describe('GuestCardBuilder', () => {
  it('adds five cards and the sixth opens the prompt with reason cards', async () => {
    render(<GuestCardBuilder />)
    await screen.findByLabelText('Set title')
    fireEvent.change(screen.getByLabelText('Set title'), { target: { value: 'Mine' } })
    for (let i = 1; i <= 5; i++) fillAndAdd(`t${i}`, `d${i}`)
    await waitFor(() => expect(screen.getByText('5 of 5 cards')).toBeTruthy())
    expect(lastOpen()).toBeUndefined()
    fillAndAdd('t6', 'd6')
    expect(lastOpen()?.reason).toBe('cards')
    expect(screen.getByText('5 of 5 cards')).toBeTruthy()
  })

  it('shows an inline error for a blank definition', async () => {
    render(<GuestCardBuilder />)
    await screen.findByLabelText('Set title')
    fireEvent.change(screen.getByLabelText('Set title'), { target: { value: 'Mine' } })
    fillAndAdd('term', '   ')
    expect(screen.getByRole('alert').textContent).toMatch(/definition/i)
    expect(screen.getByText('0 of 5 cards')).toBeTruthy()
  })

  it('calls demoAutocomplete once; a second click opens the prompt without a second call', async () => {
    demoAutocomplete.mockResolvedValue({ ok: true, data: { suggestions: ['a suggestion'] } })
    render(<GuestCardBuilder />)
    await screen.findByLabelText('Set title')
    fireEvent.click(screen.getAllByRole('button', { name: 'AI suggest' })[0])
    await screen.findByText('a suggestion')
    expect(demoAutocomplete).toHaveBeenCalledTimes(1)
    const used = screen.getAllByRole('button', { name: 'Used in the demo' })
    expect(used.length).toBe(2)
    fireEvent.click(used[1])
    expect(demoAutocomplete).toHaveBeenCalledTimes(1)
    expect(lastOpen()?.reason).toBe('autocomplete')
  })

  it('opens the prompt when the demo is full (demo_cap)', async () => {
    demoAutocomplete.mockResolvedValue({ ok: false, reason: 'demo_cap', message: 'busy' })
    render(<GuestCardBuilder />)
    await screen.findByLabelText('Set title')
    fireEvent.click(screen.getAllByRole('button', { name: 'AI suggest' })[0])
    await waitFor(() => expect(lastOpen()?.reason).toBe('demo_cap'))
  })

  it('a server quota_used opens the prompt and marks autocomplete used, so it stops calling', async () => {
    demoAutocomplete.mockResolvedValue({ ok: false, reason: 'quota_used', message: "You've used this in the demo." })
    render(<GuestCardBuilder />)
    await screen.findByLabelText('Set title')
    fireEvent.click(screen.getAllByRole('button', { name: 'AI suggest' })[0])
    await waitFor(() => expect(lastOpen()?.reason).toBe('quota_used'))
    const used = await screen.findAllByRole('button', { name: 'Used in the demo' })
    expect(used.length).toBe(2)
    fireEvent.click(used[0])
    expect(demoAutocomplete).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ai_failed', 'The demo is having trouble. Try again.'],
    ['invalid', "The demo can't do that."],
    ['demo_off', 'The demo is switched off right now.'],
  ])('a %s refusal shows an inline message, not the prompt, and leaves the button usable', async (reason, message) => {
    demoAutocomplete.mockResolvedValue({ ok: false, reason, message })
    render(<GuestCardBuilder />)
    await screen.findByLabelText('Set title')
    fireEvent.click(screen.getAllByRole('button', { name: 'AI suggest' })[0])
    expect(await screen.findByText(message)).toBeTruthy()
    expect(lastOpen()).toBeUndefined()
    expect(screen.getAllByRole('button', { name: 'AI suggest' }).length).toBe(2)
  })
})

describe('DemoReview', () => {
  const cards = [
    { id: 'a', term: 'Alpha', definition: 'first' },
    { id: 'b', term: 'Beta', definition: 'second' },
  ]
  const rows = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem').map((li) => li.textContent)

  it("Don't know moves the card to the end and drops confidence 5 to 4", () => {
    render(<DemoReview cards={cards} />)
    expect(screen.getByText('Confidence: 5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }))
    fireEvent.click(screen.getByRole('button', { name: "Don't know" }))
    expect(rows('Queue')).toEqual(['Beta5', 'Alpha4'])
  })

  it('Know it on a card at 10 stays 10', () => {
    render(<DemoReview cards={cards} initialConfidence={{ a: 10 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Know it' }))
    expect(rows('Reviewed')).toEqual(['Alpha10'])
    expect(rows('Queue')).toEqual(['Beta5'])
  })

  it('never goes below 1 and finishes when every card is known', () => {
    render(<DemoReview cards={[cards[0]]} initialConfidence={{ a: 1 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }))
    fireEvent.click(screen.getByRole('button', { name: "Don't know" }))
    expect(screen.getByText('Confidence: 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Know it' }))
    expect(screen.getByText('All cards reviewed.')).toBeTruthy()
    expect(rows('Reviewed')).toEqual(['Alpha2'])
  })
})

describe('DemoUnavailable', () => {
  it('links to /browse', () => {
    render(<DemoUnavailable />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/browse')
  })
})
