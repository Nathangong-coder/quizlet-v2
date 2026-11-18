'use client'

import { useState } from 'react'
import { demoAutocomplete } from '@/actions/demo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GUEST_LIMITS } from '@/lib/demo/config'
import { addGuestCard, createGuestSet, markUsed } from '@/lib/demo/store'
import { useGuestState } from '@/lib/demo/use-guest-state'
import { WaitlistPrompt, type WaitlistReason } from './WaitlistPrompt'

type Side = 'term' | 'definition'

export function GuestCardBuilder() {
  const [state, update, loaded] = useGuestState()
  const [title, setTitle] = useState('')
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ open: boolean; reason: WaitlistReason }>({ open: false, reason: 'cards' })
  const [pending, setPending] = useState(false)
  const [suggestions, setSuggestions] = useState<{ side: Side; items: string[] } | null>(null)

  if (!loaded) return <div className="h-64 rounded-lg border border-border bg-muted/40" aria-hidden />

  const cards = state.set?.cards ?? []
  const openPrompt = (reason: WaitlistReason) => setPrompt({ open: true, reason })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    let next = state
    if (!next.set) {
      const created = createGuestSet(next, title)
      if (!created.ok) return setError('Give your set a title.')
      next = created.state
    }
    if (!term.trim()) return setError('Add a term.')
    if (!definition.trim()) return setError('Add a definition.')
    const added = addGuestCard(next, { term, definition })
    if (!added.ok) {
      if ('limit' in added) return openPrompt('cards')
      return setError('Add a term and a definition.')
    }
    update(added.state)
    setTerm('')
    setDefinition('')
    setSuggestions(null)
  }

  async function suggest(side: Side) {
    if (state.used.autocomplete) return openPrompt('autocomplete')
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const res = await demoAutocomplete({
        currentText: (side === 'term' ? term : definition).slice(0, 500),
        side,
        referenceText: (side === 'term' ? definition : term).slice(0, 500) || undefined,
        cards: cards.map((c) => ({ term: c.term, definition: c.definition })),
      })
      if (res.ok) {
        update(markUsed(state, 'autocomplete'))
        setSuggestions({ side, items: res.data.suggestions })
      } else if (res.reason === 'quota_used') {
        // The server says it's spent: remember that, so the button stops calling.
        update(markUsed(state, 'autocomplete'))
        openPrompt('quota_used')
      } else if (res.reason === 'demo_cap') {
        openPrompt('demo_cap')
      } else {
        // demo_off, invalid, ai_failed: nothing an invite fixes.
        setError(res.message)
      }
    } finally {
      setPending(false)
    }
  }

  function suggestButton(side: Side) {
    const used = !!state.used.autocomplete
    return (
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => suggest(side)}>
        {used ? 'Used in the demo' : 'AI suggest'}
      </Button>
    )
  }

  function pick(side: Side, value: string) {
    if (side === 'term') setTerm(value)
    else setDefinition(value)
    setSuggestions(null)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {state.set ? (
          <h2 className="text-lg font-semibold">{state.set.title}</h2>
        ) : (
          <div className="space-y-1">
            <label htmlFor="demo-title" className="text-sm font-medium">
              Set title
            </label>
            <Input id="demo-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="demo-term" className="text-sm font-medium">
              Term
            </label>
            {suggestButton('term')}
          </div>
          <Input id="demo-term" value={term} maxLength={200} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="demo-definition" className="text-sm font-medium">
              Definition
            </label>
            {suggestButton('definition')}
          </div>
          <Textarea id="demo-definition" value={definition} maxLength={1000} onChange={(e) => setDefinition(e.target.value)} />
        </div>
        {suggestions && suggestions.items.length > 0 && (
          <ul className="space-y-2" aria-label="Suggestions">
            {suggestions.items.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-border bg-card p-2 text-left text-sm hover:bg-muted"
                  onClick={() => pick(suggestions.side, s)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit">Add card</Button>
        <p className="text-xs text-muted-foreground">
          {cards.length} of {GUEST_LIMITS.cards} cards
        </p>
      </form>
      {cards.length > 0 && (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-card p-3 text-sm">
              <span className="font-semibold">{c.term}</span>
              <span className="block text-muted-foreground">{c.definition}</span>
            </li>
          ))}
        </ul>
      )}
      <WaitlistPrompt open={prompt.open} onOpenChange={(o) => setPrompt((p) => ({ ...p, open: o }))} reason={prompt.reason} />
    </div>
  )
}
