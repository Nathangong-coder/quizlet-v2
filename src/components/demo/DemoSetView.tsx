'use client'

import { useMemo, useState } from 'react'
import FlashcardCarousel from '@/components/flashcard/FlashcardCarousel'
import { Badge } from '@/components/ui/badge'
import { filterCardsByCategories, UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { useGuestState } from '@/lib/demo/use-guest-state'
import { cn } from '@/lib/utils'

type DemoViewCard = {
  id: string
  term: string
  definition: string
  categories: { name: string; color: string | null }[]
  klps: { id: string; text: string }[]
}

export function DemoSetView({ cards }: { cards: DemoViewCard[] }) {
  const [state, , loaded] = useGuestState()
  const [selected, setSelected] = useState<string[]>([])

  const all = useMemo(() => {
    const guest = (state.set?.cards ?? []).map((c) => ({
      id: c.id,
      term: c.term,
      definition: c.definition,
      categories: [] as DemoViewCard['categories'],
      klps: [] as DemoViewCard['klps'],
      yours: true,
    }))
    const demo = cards.map((c) => ({ ...c, yours: false }))
    // Demo cards carry category NAMES, so names are the filter ids.
    return [...demo, ...guest].map((c) => ({ ...c, categoryIds: c.categories.map((x) => x.name) }))
  }, [cards, state.set])

  if (!loaded) return <div className="h-64 rounded-lg border border-border bg-muted/40" aria-hidden />

  const chips: { id: string; label: string }[] = []
  const seen = new Set<string>()
  for (const c of all) {
    for (const cat of c.categories) {
      if (!seen.has(cat.name)) {
        seen.add(cat.name)
        chips.push({ id: cat.name, label: cat.name })
      }
    }
  }
  if (chips.length > 0 && all.some((c) => c.categories.length === 0)) chips.push({ id: UNCATEGORIZED_ID, label: 'Uncategorized' })

  const shown = filterCardsByCategories(all, selected)
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="space-y-6">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={selected.includes(c.id)}
              onClick={() => toggle(c.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                selected.includes(c.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {shown.length > 0 ? (
        <FlashcardCarousel key={selected.join('|')} cards={shown} />
      ) : (
        <p className="text-sm text-muted-foreground">No cards in that category.</p>
      )}
      <ul className="space-y-3">
        {shown.map((c) => (
          <li key={c.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{c.term}</span>
              {c.yours && <Badge variant="secondary">Yours</Badge>}
            </div>
            {c.klps.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {c.klps.map((k) => (
                  <li key={k.id}>{k.text}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
