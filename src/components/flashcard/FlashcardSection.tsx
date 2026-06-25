'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import FlashcardCarousel from './FlashcardCarousel'

interface FlashcardSectionProps {
  cards: { id: string; term: string; definition: string }[]
}

export default function FlashcardSection({ cards }: FlashcardSectionProps) {
  const [visible, setVisible] = useState(true)

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
      {visible && <FlashcardCarousel cards={cards} />}
    </div>
  )
}
