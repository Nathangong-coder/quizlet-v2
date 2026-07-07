'use client'

import React from 'react'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'

interface CategoryFilterBarProps {
  categories: { id: string; name: string; color?: string | null }[]
  value: string[]
  onChange: (ids: string[]) => void
  showUncategorized?: boolean
}

export function CategoryFilterBar({
  categories,
  value,
  onChange,
  showUncategorized = true,
}: CategoryFilterBarProps) {
  if (categories.length === 0) return null

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  const chips = [
    ...categories,
    ...(showUncategorized ? [{ id: UNCATEGORIZED_ID, name: 'Uncategorized', color: null }] : []),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-xs font-semibold text-muted-foreground uppercase mr-1">Filter</span>
      {chips.map((cat) => {
        const active = value.includes(cat.id)
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => toggle(cat.id)}
            className="rounded-full border px-3 py-1 text-sm transition-colors"
            style={
              active && cat.color
                ? { backgroundColor: `${cat.color}20`, borderColor: cat.color, color: cat.color }
                : active
                  ? { backgroundColor: 'hsl(var(--muted))', borderColor: 'currentColor' }
                  : undefined
            }
            aria-pressed={active}
          >
            {cat.name}
          </button>
        )
      })}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-xs text-muted-foreground underline ml-1"
        >
          Clear
        </button>
      )}
    </div>
  )
}
