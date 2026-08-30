'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { RichCardSideEditor } from './RichCardSideEditor'
import { CategoryPicker } from './CategoryPicker'
import { KlpEditor } from './KlpEditor'
import { ContentBlock, contentBlocksToPlainText } from '@/lib/cards/content'

interface CardRowProps {
  index: number
  cardId?: string
  termBlocks: ContentBlock[]
  definitionBlocks: ContentBlock[]
  categoryNames: string[]
  availableCategories: { name: string; color?: string | null }[]
  onChange: (index: number, side: 'term' | 'definition', blocks: ContentBlock[]) => void
  onCategoriesChange: (index: number, names: string[]) => void
  onCreateCategory: (name: string) => void
  onFillCard: (index: number, term: string, definition: string) => void
  onRemove: (index: number) => void
  onUploadStatusChange?: (isUploading: boolean) => void
  canRemove: boolean
  setId: string
}

export function CardRow({
  index,
  cardId,
  termBlocks,
  definitionBlocks,
  categoryNames,
  availableCategories,
  onChange,
  onCategoriesChange,
  onCreateCategory,
  onFillCard,
  onRemove,
  onUploadStatusChange,
  canRemove,
  setId,
}: CardRowProps) {
  const [, setIsUploading] = useState(false)

  const handleUploadChange = (uploading: boolean) => {
    setIsUploading(uploading)
    onUploadStatusChange?.(uploading)
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4 sm:gap-4 sm:p-5">
      <div className="min-w-0 flex-1 space-y-5">
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-7">
          <div className="min-w-0 space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Term</label>
            <RichCardSideEditor
              blocks={termBlocks}
              side="term"
              setId={setId}
              categories={categoryNames}
              onChange={(blocks) => onChange(index, 'term', blocks)}
              referenceText={contentBlocksToPlainText(definitionBlocks)}
              onFillCard={(term, definition) => onFillCard(index, term, definition)}
              onUploadStatusChange={handleUploadChange}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Definition</label>
            <RichCardSideEditor
              blocks={definitionBlocks}
              side="definition"
              setId={setId}
              categories={categoryNames}
              onChange={(blocks) => onChange(index, 'definition', blocks)}
              referenceText={contentBlocksToPlainText(termBlocks)}
              onFillCard={(term, definition) => onFillCard(index, term, definition)}
              onUploadStatusChange={handleUploadChange}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Categories</label>
          <CategoryPicker
            value={categoryNames}
            available={availableCategories}
            onChange={(names) => onCategoriesChange(index, names)}
            onCreateCategory={onCreateCategory}
          />
        </div>
        {cardId && <KlpEditor cardId={cardId} />}
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
