'use client'

import React from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

interface CardRowProps {
  index: number
  term: string
  definition: string
  onChange: (index: number, field: 'term' | 'definition', value: string) => void
  onRemove: (index: number) => void
  canRemove: boolean
}

export function CardRow({ index, term, definition, onChange, onRemove, canRemove }: CardRowProps) {
  return (
    <div className="flex gap-4 items-start mb-4">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          placeholder="Term"
          value={term}
          onChange={(e) => onChange(index, 'term', e.target.value)}
          className="w-full"
        />
        <Input
          placeholder="Definition"
          value={definition}
          onChange={(e) => onChange(index, 'definition', e.target.value)}
          className="w-full"
        />
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
