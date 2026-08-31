'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export type LibrarySort = 'recent' | 'created' | 'studied'

export function LibraryToolbar({ query, sort, type }: { query: string; sort: LibrarySort; type: string }) {
  return (
    <form action="/sets" method="get" className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
      <input type="hidden" name="type" value={type} />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="sr-only">Sort your library</span>
        <select name="sort" defaultValue={sort} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <option value="recent">Recently updated</option>
          <option value="created">Date created</option>
          <option value="studied">Recently studied</option>
        </select>
      </label>
      <label className="relative block min-w-0 flex-1 sm:max-w-sm">
        <span className="sr-only">Search your library</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input name="q" defaultValue={query} placeholder="Search flashcards" className="pl-9" />
      </label>
      <button type="submit" className="h-10 rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Search</button>
    </form>
  )
}
