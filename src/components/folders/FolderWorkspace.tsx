'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { BookOpen, Check, FileText, Loader2, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { addFolderItem, removeFolderItem, updateFolder, type FolderDetail, type FolderItemType, type FolderOptions } from '@/actions/folders'
import { FolderDeleteButton } from './FolderDeleteButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const SECTION_META: Record<FolderItemType, { label: string; empty: string; icon: typeof BookOpen }> = {
  set: { label: 'Study sets', empty: 'Sets you are gathering for this goal will live here.', icon: BookOpen },
  postmortem: { label: 'Postmortems', empty: 'Offline tests and interview debriefs will live here.', icon: NotebookPen },
  note: { label: 'Study notes', empty: 'Raw notes and their AI summaries will live here.', icon: FileText },
}

export function FolderWorkspace({ folder, options }: { folder: FolderDetail; options: FolderOptions }) {
  const [name, setName] = useState(folder.name)
  const [description, setDescription] = useState(folder.description ?? '')
  const [selected, setSelected] = useState<Record<FolderItemType, string>>({ set: '', postmortem: '', note: '' })
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await updateFolder(folder.id, { name, description })
      setMessage(result.success ? 'Folder details saved' : result.error)
    })
  }

  function add(type: FolderItemType) {
    const itemId = selected[type]
    if (!itemId) return
    setMessage(null)
    startTransition(async () => {
      const result = await addFolderItem(folder.id, type, itemId)
      if (result.success) {
        setSelected((current) => ({ ...current, [type]: '' }))
        setMessage('Added to folder')
        window.location.reload()
      } else setMessage(result.error)
    })
  }

  function remove(type: FolderItemType, itemId: string) {
    setMessage(null)
    startTransition(async () => {
      const result = await removeFolderItem(folder.id, type, itemId)
      if (result.success) window.location.reload()
      else setMessage(result.error)
    })
  }

  return (
    <div className="space-y-7">
      <form onSubmit={saveDetails} className="grid gap-6 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <div>
          <label htmlFor="folder-workspace-name" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Folder name</label>
          <Input id="folder-workspace-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
        </div>
        <div>
          <label htmlFor="folder-workspace-description" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">What is this for?</label>
          <Textarea id="folder-workspace-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={1} maxLength={1000} className="min-h-10" />
        </div>
        <Button type="submit" variant="outline" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          Save details
        </Button>
        {message && <p role="status" className="text-sm text-muted-foreground lg:col-span-3">{message}</p>}
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <MemberSection type="set" members={folder.sets} options={options.sets} selected={selected.set} busy={isPending} onSelect={(value) => setSelected({ ...selected, set: value })} onAdd={() => add('set')} onRemove={(id) => remove('set', id)} />
        <MemberSection type="postmortem" members={folder.postmortems} options={options.postmortems} selected={selected.postmortem} busy={isPending} onSelect={(value) => setSelected({ ...selected, postmortem: value })} onAdd={() => add('postmortem')} onRemove={(id) => remove('postmortem', id)} />
        <MemberSection type="note" members={folder.notes} options={options.notes} selected={selected.note} busy={isPending} onSelect={(value) => setSelected({ ...selected, note: value })} onAdd={() => add('note')} onRemove={(id) => remove('note', id)} />
      </div>

      <div className="flex justify-end border-t border-border pt-5"><FolderDeleteButton id={folder.id} /></div>
    </div>
  )
}

function MemberSection({ type, members, options, selected, busy, onSelect, onAdd, onRemove }: {
  type: FolderItemType
  members: FolderDetail['sets']
  options: FolderOptions['sets']
  selected: string
  busy: boolean
  onSelect: (value: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  const meta = SECTION_META[type]
  const Icon = meta.icon
  const memberIds = new Set(members.map((member) => member.id))
  const available = options.filter((option) => !memberIds.has(option.id))

  return (
    <section className="flex min-h-72 flex-col rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></div>
        <div><h2 className="text-sm font-semibold">{meta.label}</h2><p className="text-xs text-muted-foreground">{members.length} saved</p></div>
      </div>

      <div className="mt-5 flex-1 space-y-2">
        {members.length === 0 ? <p className="text-sm leading-relaxed text-muted-foreground">{meta.empty}</p> : members.map((member) => (
          <div key={member.id} className="group flex items-center gap-2 rounded-lg border border-border/70 bg-muted/15 px-3 py-2">
            <Link href={member.href} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">{member.title}</Link>
            <button type="button" aria-label={`Remove ${member.title}`} onClick={() => onRemove(member.id)} disabled={busy} className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <select aria-label={`Add ${meta.label.toLowerCase()}`} value={selected} onChange={(event) => onSelect(event.target.value)} disabled={available.length === 0 || busy} className="h-9 min-w-0 flex-1 rounded-[4px] border border-input bg-card px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <option value="">{available.length > 0 ? `Add ${meta.label.toLowerCase().replace(/s$/, '')}…` : 'Everything is here'}</option>
          {available.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
        </select>
        <Button type="button" size="icon-sm" variant="outline" aria-label={`Add to ${meta.label}`} onClick={onAdd} disabled={!selected || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    </section>
  )
}
