'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { createStudyNote, updateStudyNote } from '@/actions/study-notes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface NoteFormValues {
  title: string
  body: string
}

export function NoteForm({ mode, noteId, initial }: { mode: 'new' | 'edit'; noteId?: string; initial: NoteFormValues }) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = mode === 'edit' && noteId ? await updateStudyNote(noteId, values) : await createStudyNote(values)
      if (!result.success) {
        setError(result.error)
        return
      }
      window.location.assign(`/notes/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
      <div>
        <label htmlFor="note-title" className="mb-2 block text-sm font-semibold">Note title</label>
        <Input id="note-title" value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} placeholder="Interview notes — working capital" maxLength={160} required autoFocus />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="note-body" className="block text-sm font-semibold">Your notes</label><span className="text-xs text-muted-foreground">Keep one idea per line when you can</span></div>
        <Textarea id="note-body" value={values.body} onChange={(event) => setValues({ ...values, body: event.target.value })} placeholder={'Working capital is current assets minus current liabilities…\nWhy it matters in a DCF…\nQuestion to revisit…'} rows={16} maxLength={50000} required className="min-h-[24rem] resize-y font-[inherit] leading-7" />
      </div>
      <div className="flex items-center justify-between gap-3"><p className="text-xs leading-relaxed text-muted-foreground">Your original note stays intact when an AI summary is generated.</p><Button type="submit" size="lg" disabled={isPending}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{isPending ? 'Saving…' : mode === 'edit' ? 'Save note' : 'Save note'}</Button></div>
    </form>
  )
}
