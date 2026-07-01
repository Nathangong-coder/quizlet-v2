'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { RichCardSideEditor } from './RichCardSideEditor'
import { ContentBlock } from '@/lib/cards/content'

interface CardRowProps {
  index: number
  termBlocks: ContentBlock[]
  definitionBlocks: ContentBlock[]
  onChange: (index: number, side: 'term' | 'definition', blocks: ContentBlock[]) => void
  onRemove: (index: number) => void
  canRemove: boolean
  setId: string
  categories: string[]
}

export function CardRow({ index, termBlocks, definitionBlocks, onChange, onRemove, canRemove, setId, categories }: CardRowProps) {
  return (
    <div className="flex gap-4 items-start mb-6 p-4 border rounded-lg bg-card">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Term</label>
          <RichCardSideEditor
            blocks={termBlocks}
            side="term"
            setId={setId}
            categories={categories}
            onChange={(blocks) => onChange(index, 'term', blocks)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Definition</label>
          <RichCardSideEditor
            blocks={definitionBlocks}
            side="definition"
            setId={setId}
            categories={categories}
            onChange={(blocks) => onChange(index, 'definition', blocks)}
          />
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(index)}
        disabled={!canRemove}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        title="Remove card"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
