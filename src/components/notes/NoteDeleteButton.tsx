'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { deleteStudyNote } from '@/actions/study-notes'
import { Button } from '@/components/ui/button'

export function NoteDeleteButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!window.confirm('Delete this study note? Its folder memberships and analysis will also be removed.')) return
    setBusy(true)
    const result = await deleteStudyNote(id)
    if (result.success) router.push('/notes')
    else setBusy(false)
  }

  return <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy} className="text-muted-foreground hover:text-destructive">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}Delete</Button>
}
