'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ContentBlock } from '@/lib/cards/content'
import { ContentBlockView } from '@/components/cards/ContentBlockView'
import { CategoryChip } from '@/components/cards/CategoryChip'

interface FlashcardCarouselCard {
  id: string
  term: string
  definition: string
  categories?: { name: string; color?: string | null }[]
  contentBlocks?: ContentBlock[]
}

export default function FlashcardCarousel({ cards }: { cards: FlashcardCarouselCard[] }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = cards[index]
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
      <div
        className="relative h-64 cursor-pointer select-none"
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
      </div>

      {card.categories && card.categories.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {card.categories.map((c) => (
            <CategoryChip key={c.name} name={c.name} color={c.color} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="sm" onClick={prev} disabled={cards.length <= 1}>
          ←
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {index + 1} / {cards.length}
        </span>
        <Button variant="outline" size="sm" onClick={next} disabled={cards.length <= 1}>
          →
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">Click card to flip</p>
    </div>
  )
}
