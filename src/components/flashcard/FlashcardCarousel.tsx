'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ContentBlock, getNumberedListIndex } from '@/lib/cards/content'
import { ContentBlockView } from '@/components/cards/ContentBlockView'
import { cn } from '@/lib/utils'

interface FlashcardCarouselCard {
  id: string
  term: string
  definition: string
  /**
   * Read by the PARENT's filter bar, not rendered here.
   *
   * The chips used to repeat under every card, restating what the filter bar
   * above already shows and pushing the navigation below the fold. The filter
   * bar is the one place category is a control rather than decoration.
   */
  categories?: { name: string; color?: string | null }[]
  contentBlocks?: ContentBlock[]
}

/**
 * FLAT, on purpose (owner, 2026-09-14). The card used to rotate in 3D and sit
 * between two arrow buttons; the arrows read as gallery navigation and the
 * tilt made the card look like a widget. Now: one flat panel that swaps its
 * face on click, and "Previous" / "Next" as words under it.
 */
export default function FlashcardCarousel({ cards }: { cards: FlashcardCarouselCard[] }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  // Defense-in-depth: clamp in case `cards` ever shrinks without this
  // component remounting (the parent is expected to pass a `key` that
  // changes with the filter so `index` normally resets to 0 instead).
  const safeIndex = Math.min(index, Math.max(cards.length - 1, 0))
  const card = cards[safeIndex]
  const termBlocks = card.contentBlocks?.filter((b) => b.side === 'term') ?? []
  const defBlocks = card.contentBlocks?.filter((b) => b.side === 'definition') ?? []
  const blocks = flipped ? defBlocks : termBlocks

  function prev() {
    setFlipped(false)
    setIndex((i) => (i - 1 + cards.length) % cards.length)
  }

  function next() {
    setFlipped(false)
    setIndex((i) => (i + 1) % cards.length)
  }

  return (
    <div className="space-y-3">
      {/*
        A real <button>, not a clickable <div>: the control names itself, and
        Enter/Space flip it.
      */}
      <button
        type="button"
        aria-label={flipped ? 'Show term' : 'Show definition'}
        aria-pressed={flipped}
        onClick={() => setFlipped((f) => !f)}
        className={cn(
          'flex min-h-56 w-full select-none flex-col items-center justify-center gap-2 rounded-xl border-2 p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          flipped ? 'border-primary/30 bg-muted' : 'border-border bg-card',
        )}
      >
        <p className="label">{flipped ? 'Definition' : 'Term'}</p>
        {blocks.length > 0 ? (
          <div key={flipped ? 'd' : 't'} className="w-full space-y-2 text-center">
            {blocks.map((block, i) => (
              <ContentBlockView
                key={i}
                block={block}
                index={getNumberedListIndex(blocks, i)}
                compact
                assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
              />
            ))}
          </div>
        ) : flipped ? (
          <p className="mx-auto max-w-prose text-center text-base">{card.definition}</p>
        ) : (
          <p className="mx-auto text-center text-xl font-semibold">{card.term}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{flipped ? 'tap to see the term' : 'tap to see the definition'}</p>
      </button>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={prev} disabled={cards.length <= 1}>
          Previous
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {safeIndex + 1} of {cards.length}
        </span>
        <Button variant="ghost" size="sm" onClick={next} disabled={cards.length <= 1}>
          Next
        </Button>
      </div>
    </div>
  )
}
