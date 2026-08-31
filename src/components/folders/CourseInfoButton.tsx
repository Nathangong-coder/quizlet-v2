'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

export function CourseInfoButton({ description, tags }: { description: string | null; tags: string[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Plus className="h-4 w-4" aria-hidden="true" />course info
      </button>
      {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{tag}</span>)}</div>}
      {open && <div className="mt-3 max-w-2xl rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm leading-relaxed text-muted-foreground">{description || 'No course info yet. Use the folder menu to add a description.'}</div>}
    </div>
  )
}
