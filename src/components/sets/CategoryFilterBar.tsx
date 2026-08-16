'use client'

import React from 'react'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { SelectableChip } from '@/components/ui/selectable-chip'

interface CategoryFilterBarProps {
  categories: { id: string; name: string; color?: string | null }[]
  value: string[]
  onChange: (ids: string[]) => void
  showUncategorized?: boolean
}

/**
 * The set-scoped category filter.
 *
 * Previously carried its own chip implementation, which tinted the active chip
 * with the category's own colour (`${color}20` background, that colour as the
 * text) — a third active-state treatment, and one that is unreadable in dark
 * mode. It now renders `SelectableChip` like every other category control in
 * the app; the category's colour survives as the dot.
 */
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
      {chips.map((cat) => (
        <SelectableChip
          key={cat.id}
          label={cat.name}
          selected={value.includes(cat.id)}
          color={cat.color}
          onToggle={() => toggle(cat.id)}
        />
      ))}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-xs text-muted-foreground underline ml-1 hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  )
}
