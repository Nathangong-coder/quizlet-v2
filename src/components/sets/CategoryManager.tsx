'use client'

import React, { useState } from 'react'
import { Trash2, Pencil, Check } from 'lucide-react'
import { CATEGORY_PALETTE, normalizeCategoryName } from '@/lib/cards/categories'

interface CategoryManagerProps {
  categories: { name: string; color: string }[]
  counts: Record<string, number>
  onRename: (oldName: string, newName: string) => void
  onRecolor: (name: string, color: string) => void
  onDelete: (name: string) => void
}

export function CategoryManager({
  categories,
  counts,
  onRename,
  onRecolor,
  onDelete,
}: CategoryManagerProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [paletteFor, setPaletteFor] = useState<string | null>(null)

  const startEdit = (name: string) => {
    setEditing(name)
    setDraft(name)
  }

  const commitEdit = (oldName: string) => {
    if (draft.trim() && draft.trim() !== oldName) onRename(oldName, draft)
    setEditing(null)
  }

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase">Manage categories</h4>
      <div className="flex flex-col gap-2">
        {categories.map((cat) => {
          const count = counts[normalizeCategoryName(cat.name)] ?? 0
          return (
            <div key={cat.name} className="flex items-center gap-2">
              <button
                type="button"
                className="h-5 w-5 rounded-full border shrink-0"
                style={{ backgroundColor: cat.color }}
                title="Change color"
                onClick={() => setPaletteFor(paletteFor === cat.name ? null : cat.name)}
              />
              {editing === cat.name ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(cat.name) }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={() => commitEdit(cat.name)}
                  className="flex-1 rounded border p-1 text-sm"
                />
              ) : (
                <span className="flex-1 text-sm">{cat.name}</span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">{count} card{count === 1 ? '' : 's'}</span>
              {editing === cat.name ? (
                <button type="button" onClick={() => commitEdit(cat.name)} title="Save">
                  <Check size={14} className="text-green-600" />
                </button>
              ) : (
                <button type="button" onClick={() => startEdit(cat.name)} title="Rename">
                  <Pencil size={14} className="text-muted-foreground" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (count === 0 || confirm(`Remove "${cat.name}" from ${count} card${count === 1 ? '' : 's'}?`)) {
                    onDelete(cat.name)
                  }
                }}
                title="Delete category"
              >
                <Trash2 size={14} className="text-destructive" />
              </button>
              {paletteFor === cat.name && (
                <div className="flex gap-1 flex-wrap ml-2">
                  {CATEGORY_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="h-4 w-4 rounded-full border"
                      style={{ backgroundColor: color }}
                      onClick={() => { onRecolor(cat.name, color); setPaletteFor(null) }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
