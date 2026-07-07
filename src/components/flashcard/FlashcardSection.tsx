'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import FlashcardCarousel from './FlashcardCarousel'
import { CategoryFilterBar } from '@/components/sets/CategoryFilterBar'
import { normalizeCategoryName, filterCardsByCategories } from '@/lib/cards/categories'
import { ContentBlock } from '@/lib/cards/content'

interface FlashcardSectionCard {
  id: string
  term: string
  definition: string
  categories?: { name: string; color?: string | null }[]
  contentBlocks?: ContentBlock[]
}

export default function FlashcardSection({ cards }: { cards: FlashcardSectionCard[] }) {
  const [visible, setVisible] = useState(true)
  const [selected, setSelected] = useState<string[]>([])

  // Build filter chips from the distinct category names present on these cards.
  // The carousel filters by name (there are no ids in this client-only view),
  // so we use the normalized name as the chip id.
  const filterCategories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string | null }>()
    for (const c of cards) {
      for (const cat of c.categories ?? []) {
        const id = normalizeCategoryName(cat.name)
        if (!map.has(id)) map.set(id, { id, name: cat.name, color: cat.color })
      }
    }
    return Array.from(map.values())
  }, [cards])

  // This view only has category names (not DB ids), so map each card to a
  // shape with `categoryIds` populated from normalized names before handing
  // off to the shared predicate.
  const filtered = useMemo(() => {
    if (selected.length === 0) return cards
    const withIds = cards.map((c) => ({
      ...c,
      categoryIds: (c.categories ?? []).map((x) => normalizeCategoryName(x.name)),
    }))
    return filterCardsByCategories(withIds, selected)
  }, [cards, selected])

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Flashcards
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisible((v) => !v)}
          className="text-xs h-7"
        >
          {visible ? 'Hide' : 'Show'}
        </Button>
      </div>
      {visible && (
        <>
          {filterCategories.length > 0 && (
            <CategoryFilterBar
              categories={filterCategories}
              value={selected}
              onChange={setSelected}
            />
          )}
          {filtered.length > 0 ? (
            <FlashcardCarousel key={selected.join(',') || 'all'} cards={filtered} />
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              No cards match the selected categories.
            </p>
          )}
        </>
      )}
    </div>
  )
}
