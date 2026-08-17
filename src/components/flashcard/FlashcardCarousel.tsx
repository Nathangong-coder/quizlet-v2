'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ContentBlock } from '@/lib/cards/content'
import { ContentBlockView } from '@/components/cards/ContentBlockView'

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

export default function FlashcardCarousel({ cards }: { cards: FlashcardCarouselCard[] }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  // Defense-in-depth: clamp in case `cards` ever shrinks without this
  // component remounting (the parent is expected to pass a `key` that
  // changes with the filter so `index` normally resets to 0 instead).
  const safeIndex = Math.min(index, Math.max(cards.length - 1, 0))
  const card = cards[safeIndex]
  const termBlocks = card.contentBlocks?.filter(b => b.side === 'term') ?? []
  const defBlocks = card.contentBlocks?.filter(b => b.side === 'definition') ?? []

  function prev() {
    setFlipped(false)
    setIndex((i) => (i - 1 + cards.length) % cards.length)
  }

  function next() {
    setFlipped(false)
    setIndex((i) => (i + 1) % cards.length)
  }

  return (
    <div className="space-y-4">
      {/*
        A real <button>, not a clickable <div>. The visible "Click card to flip"
        hint below this used to be the only thing announcing the affordance, and
        it announced it to sighted mouse users only — the div took no focus and
        no key press. Now the hint is unnecessary rather than merely absent:
        the control names itself, and Enter/Space flip it.
      */}
      <button
        type="button"
        aria-label={flipped ? 'Show term' : 'Show definition'}
        aria-pressed={flipped}
        className="relative block h-64 w-full select-none text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div
          className="absolute inset-0 w-full h-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Term Side */}
          <div
            className="absolute inset-0 rounded-xl border-2 bg-card flex flex-col items-center justify-center p-6 text-center gap-2 overflow-auto"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Term</p>
            {termBlocks.length > 0 ? (
              <div className="w-full space-y-2">
                {termBlocks.map((block, i) => (
                  <ContentBlockView
                    key={i}
                    block={block}
                    compact
                    assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xl font-semibold">{card.term}</p>
            )}
          </div>

          {/* Definition Side */}
          <div
            className="absolute inset-0 rounded-xl border-2 border-primary/30 bg-muted flex flex-col items-center justify-center p-6 text-center gap-2 overflow-auto"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Definition</p>
            {defBlocks.length > 0 ? (
              <div className="w-full space-y-2">
                {defBlocks.map((block, i) => (
                  <ContentBlockView
                    key={i}
                    block={block}
                    compact
                    assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="text-base">{card.definition}</p>
            )}
          </div>
        </div>
      </button>

      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="sm" onClick={prev} disabled={cards.length <= 1}>
          ←
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {safeIndex + 1} / {cards.length}
        </span>
        <Button variant="outline" size="sm" onClick={next} disabled={cards.length <= 1}>
          →
        </Button>
      </div>
    </div>
  )
}
