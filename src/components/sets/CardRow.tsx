'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { RichCardSideEditor } from './RichCardSideEditor'
import { CategoryPicker } from './CategoryPicker'
import { ContentBlock } from '@/lib/cards/content'

interface CardRowProps {
  index: number
  termBlocks: ContentBlock[]
  definitionBlocks: ContentBlock[]
  categoryNames: string[]
  availableCategories: { name: string; color?: string | null }[]
  onChange: (index: number, side: 'term' | 'definition', blocks: ContentBlock[]) => void
  onCategoriesChange: (index: number, names: string[]) => void
  onCreateCategory: (name: string) => void
  onRemove: (index: number) => void
  onUploadStatusChange?: (isUploading: boolean) => void
  canRemove: boolean
  setId: string
}

export function CardRow({
  index,
  termBlocks,
  definitionBlocks,
  categoryNames,
  availableCategories,
  onChange,
  onCategoriesChange,
  onCreateCategory,
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
    <div className="flex gap-4 items-start mb-6 p-4 border rounded-lg bg-card">
      <div className="flex-1 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Term</label>
            <RichCardSideEditor
              blocks={termBlocks}
              side="term"
              setId={setId}
              categories={categoryNames}
              onChange={(blocks) => onChange(index, 'term', blocks)}
              onUploadStatusChange={handleUploadChange}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Definition</label>
            <RichCardSideEditor
              blocks={definitionBlocks}
              side="definition"
              setId={setId}
              categories={categoryNames}
              onChange={(blocks) => onChange(index, 'definition', blocks)}
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
