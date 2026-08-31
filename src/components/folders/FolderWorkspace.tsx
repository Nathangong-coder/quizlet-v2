'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import {
  BookOpen,
  ChevronDown,
  FileText,
  Folder,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { addFolderItem, removeFolderItem, updateFolder, type FolderDetail, type FolderItemType, type FolderMember, type FolderOptions } from '@/actions/folders'
import { FolderDeleteButton } from '@/components/folders/FolderDeleteButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type SortMode = 'recent' | 'created' | 'studied'
type FolderRow = FolderMember & { type: FolderItemType }

const SECTION_META: Record<FolderItemType, { label: string; singular: string; icon: typeof BookOpen; iconClass: string; tileClass: string }> = {
  set: { label: 'Flashcard sets', singular: 'Flashcard set', icon: BookOpen, iconClass: 'text-sky-600 dark:text-sky-300', tileClass: 'bg-sky-50 dark:bg-sky-950/35' },
  note: { label: 'Study guides', singular: 'Study guide', icon: FileText, iconClass: 'text-fuchsia-600 dark:text-fuchsia-300', tileClass: 'bg-fuchsia-50 dark:bg-fuchsia-950/35' },
  postmortem: { label: 'Postmortems', singular: 'Postmortem', icon: NotebookPen, iconClass: 'text-amber-600 dark:text-amber-300', tileClass: 'bg-amber-50 dark:bg-amber-950/35' },
  folder: { label: 'Folders', singular: 'Folder', icon: Folder, iconClass: 'text-slate-600 dark:text-slate-300', tileClass: 'bg-slate-100 dark:bg-slate-900/70' },
}

const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recently added',
  created: 'Date created',
  studied: 'Recently studied',
}

function timestamp(row: FolderRow, sort: SortMode) {
  if (sort === 'created') return row.createdAt?.getTime() ?? row.addedAt?.getTime() ?? 0
  if (sort === 'studied') return row.studiedAt?.getTime() ?? 0
  return row.addedAt?.getTime() ?? row.updatedAt?.getTime() ?? row.createdAt?.getTime() ?? 0
}

function formatMeta(row: FolderRow) {
  const type = SECTION_META[row.type].singular
  return `${type}${row.meta ? ` · ${row.meta}` : ''}`
}

function FolderRowItem({ row, onRemove, removing }: { row: FolderRow; onRemove: (row: FolderRow) => void; removing: string | null }) {
  const meta = SECTION_META[row.type]
  const Icon = meta.icon

  return (
    <li className="group flex min-w-0 items-center gap-3 border-b border-border/70 px-1 py-3 sm:gap-5 sm:py-4">
      <Link href={row.href} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-5">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${meta.tileClass} ${meta.iconClass}`}>
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold tracking-tight transition-colors group-hover:text-primary sm:text-lg">{row.title}</span>
          <span className="mt-1 block truncate text-sm text-muted-foreground">{formatMeta(row)}</span>
        </span>
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${row.title} from this folder`}
        onClick={() => onRemove(row)}
        disabled={removing === `${row.type}:${row.id}`}
        className="text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100 sm:opacity-0 focus-visible:opacity-100"
      >
        {removing === `${row.type}:${row.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </li>
  )
}

export function FolderWorkspace({ folder, options }: { folder: FolderDetail; options: FolderOptions }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [name, setName] = useState(folder.name)
  const [description, setDescription] = useState(folder.description ?? '')
  const [selected, setSelected] = useState<Record<FolderItemType, string>>({ set: '', note: '', postmortem: '', folder: '' })
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const [adding, startAdding] = useTransition()

  const rows = useMemo<FolderRow[]>(() => [
    ...folder.sets.map((item) => ({ ...item, type: 'set' as const })),
    ...folder.notes.map((item) => ({ ...item, type: 'note' as const })),
    ...folder.postmortems.map((item) => ({ ...item, type: 'postmortem' as const })),
    ...folder.folders.map((item) => ({ ...item, type: 'folder' as const })),
  ], [folder])

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return rows
      .filter((row) => !normalizedQuery || `${row.title} ${formatMeta(row)}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => timestamp(b, sort) - timestamp(a, sort) || a.title.localeCompare(b.title))
  }, [query, rows, sort])

  function saveFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startSaving(async () => {
      const result = await updateFolder(folder.id, { name, description })
      if (!result.success) setError(result.error)
    })
  }

  function addItem(type: FolderItemType) {
    const itemId = selected[type]
    if (!itemId) return
    setError(null)
    startAdding(async () => {
      const result = await addFolderItem(folder.id, type, itemId)
      if (!result.success) {
        setError(result.error)
        return
      }
      window.location.reload()
    })
  }

  async function removeItem(row: FolderRow) {
    setError(null)
    setRemoving(`${row.type}:${row.id}`)
    const result = await removeFolderItem(folder.id, row.type, row.id)
    if (!result.success) {
      setError(result.error)
      setRemoving(null)
      return
    }
    window.location.reload()
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border bg-card/70 p-4 shadow-[var(--shadow-sm)] sm:p-6" aria-labelledby="folder-materials-heading">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="folder-materials-heading" className="text-xl font-semibold tracking-tight">Materials in this folder</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sets, study guides, and postmortems for this thread.</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">Sort folder materials</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                {(Object.keys(SORT_LABELS) as SortMode[]).map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="relative block min-w-0 sm:w-64">
              <span className="sr-only">Search this folder</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder" className="pl-9" />
            </label>
          </div>
        </div>

        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {filteredRows.length > 0 ? (
          <ul className="mt-2">
            {filteredRows.map((row) => <FolderRowItem key={`${row.type}:${row.id}`} row={row} onRemove={removeItem} removing={removing} />)}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground"><Folder className="h-6 w-6" aria-hidden="true" /></div>
            <h3 className="mt-4 text-lg font-semibold">{query ? 'Nothing matches that search' : 'This folder is empty'}</h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{query ? 'Try a different title or material type.' : 'Add a set, study guide, or postmortem below to make this folder useful.'}</p>
          </div>
        )}
      </section>

      <details className="group rounded-2xl border border-border bg-card/50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 font-semibold marker:hidden sm:px-6">
          <span className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" aria-hidden="true" />Add material</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-4 border-t border-border/70 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {(['set', 'note', 'postmortem', 'folder'] as FolderItemType[]).map((type) => {
            const meta = SECTION_META[type]
            const Icon = meta.icon
            const optionKey = type === 'set' ? 'sets' : type === 'note' ? 'notes' : type === 'postmortem' ? 'postmortems' : 'folders'
            const available = options[optionKey]
            return <div key={type} className="space-y-2">
              <label htmlFor={`add-${type}`} className="flex items-center gap-2 text-sm font-semibold"><Icon className={`h-4 w-4 ${meta.iconClass}`} aria-hidden="true" />{meta.singular}</label>
              <div className="flex gap-2">
                <select id={`add-${type}`} value={selected[type]} onChange={(event) => setSelected((current) => ({ ...current, [type]: event.target.value }))} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <option value="">Choose one…</option>
                  {available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
                <Button type="button" size="icon" variant="outline" aria-label={`Add ${meta.singular.toLowerCase()}`} onClick={() => addItem(type)} disabled={!selected[type] || adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </div>
            </div>
          })}
        </div>
      </details>

      <details className="group rounded-2xl border border-border bg-card/50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 font-semibold marker:hidden sm:px-6">
          <span className="flex items-center gap-2"><MoreHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Folder details</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <form onSubmit={saveFolder} className="space-y-4 border-t border-border/70 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
            <label className="space-y-2 text-sm font-semibold">Description<span className="font-normal text-muted-foreground"> (optional)</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={1000} /></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FolderDeleteButton id={folder.id} />
            <Button type="submit" variant="outline" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{saving ? 'Saving…' : 'Save details'}</Button>
          </div>
        </form>
      </details>
    </div>
  )
}
