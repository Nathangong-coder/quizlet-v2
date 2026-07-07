import React from 'react'

export function CategoryChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={color ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
    >
      {name}
    </span>
  )
}
