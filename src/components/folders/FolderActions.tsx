'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, Edit3, Loader2, MoreHorizontal, Pin, PinOff, Share2, Trash2 } from 'lucide-react'
import { deleteFolder, setFolderPinned, updateFolder } from '@/actions/folders'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function FolderActions({ id, name: initialName, description, tags: initialTags, pinned }: { id: string; name: string; description: string | null; tags: string[]; pinned: boolean }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [tags, setTags] = useState(initialTags.join(', '))
  const [status, setStatus] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  function edit() {
    setStatus(null)
    setEditing(true)
    setOpen(false)
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus(null)
    startTransition(async () => {
      const result = await updateFolder(id, { name, description: description ?? undefined, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) })
      if (!result.success) {
        setStatus(result.error)
        return
      }
      setEditing(false)
      setStatus('Saved')
      window.location.reload()
    })
  }

  function remove() {
    if (!window.confirm('Delete this folder? Its sets, notes, postmortems, and nested folders will stay safe.')) return
    startTransition(async () => {
      const result = await deleteFolder(id)
      if (result.success) window.location.assign('/folders')
      else setStatus(result.error)
    })
  }

  function togglePin() {
    startTransition(async () => {
      const result = await setFolderPinned(id, !pinned)
      if (!result.success) {
        setStatus(result.error)
        return
      }
      setStatus(result.data.pinned ? 'Pinned to your sidebar' : 'Unpinned from your sidebar')
      setOpen(false)
      window.location.reload()
    })
  }

  async function share() {
    const link = window.location.href
    try {
      await navigator.clipboard.writeText(link)
      setStatus('Link copied')
    } catch {
      setStatus('Copy failed — copy the link from your address bar')
    }
    setOpen(false)
  }

  const PinIcon = pinned ? PinOff : Pin

  return (
    <div className="relative shrink-0">
      <button type="button" aria-label="Folder options" aria-haspopup="menu" aria-expanded={open || editing} onClick={() => { setStatus(null); setOpen((value) => !value); setEditing(false) }} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && <div role="menu" className="absolute right-0 top-12 z-20 min-w-52 rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-[var(--shadow-md)]">
        <button type="button" role="menuitem" onClick={edit} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted"><Edit3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Edit folder</button>
        <button type="button" role="menuitem" onClick={togglePin} disabled={busy} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted"><PinIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}</button>
        <button type="button" role="menuitem" onClick={share} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted"><Share2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Share folder link</button>
        <div className="my-1 border-t border-border/70" />
        <button type="button" role="menuitem" onClick={remove} disabled={busy} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" aria-hidden="true" />Delete folder</button>
      </div>}

      {editing && <form onSubmit={save} className="absolute right-0 top-12 z-20 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-md)]">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Edit folder</h2><button type="button" onClick={() => setEditing(false)} aria-label="Close edit folder form" className="text-muted-foreground hover:text-foreground">×</button></div>
        <label className="block space-y-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required className="mt-1 normal-case tracking-normal" /></label>
        <label className="block space-y-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags<span className="block text-[0.7rem] font-normal normal-case tracking-normal">Separate tags with commas</span><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="IB, technicals, 2026" maxLength={400} className="mt-1 normal-case tracking-normal" /></label>
        {status && <p role="alert" className="text-xs text-destructive">{status}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}Save</Button></div>
      </form>}

      {status && !editing && <p role="status" className="absolute right-0 top-12 z-10 mt-1 flex w-max items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-[var(--shadow-sm)]"><Copy className="h-3 w-3" aria-hidden="true" />{status}</p>}
    </div>
  )
}
