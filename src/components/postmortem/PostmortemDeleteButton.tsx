'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { deletePostmortem } from '@/actions/postmortem'
import { Button } from '@/components/ui/button'

export function PostmortemDeleteButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!window.confirm('Delete this postmortem? This cannot be undone.')) return
    setBusy(true)
    const result = await deletePostmortem(id)
    if (result.success) router.push('/postmortem')
    else setBusy(false)
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy} className="text-muted-foreground hover:text-destructive">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
      Delete
    </Button>
  )
}
