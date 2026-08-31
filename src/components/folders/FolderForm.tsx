'use client'

import { useState, useTransition } from 'react'
import { FolderPlus, Loader2 } from 'lucide-react'
import { createFolder } from '@/actions/folders'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function FolderForm() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createFolder({ name, description })
      if (!result.success) {
        setError(result.error)
        return
      }
      window.location.assign(`/folders/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
      <div>
        <label htmlFor="folder-name" className="mb-2 block text-sm font-semibold">Folder name</label>
        <Input id="folder-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Goldman Sachs 2026" maxLength={80} required autoFocus />
      </div>
      <div>
        <label htmlFor="folder-description" className="mb-2 block text-sm font-semibold">Description <span className="font-normal text-muted-foreground">(optional)</span></label>
        <Textarea id="folder-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Everything I want in one place before recruiting starts…" rows={4} maxLength={1000} />
      </div>
      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
        {isPending ? 'Creating…' : 'Create folder'}
      </Button>
    </form>
  )
}
