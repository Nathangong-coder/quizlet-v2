'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createGroup, updateGroup } from '@/actions/groups'

export function GroupForm({
  groupId,
  initialName = '',
  initialDescription = '',
}: {
  groupId?: string
  initialName?: string
  initialDescription?: string
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = groupId ? await updateGroup(groupId, { name, description }) : await createGroup({ name, description })
      if (!res.success) {
        toast.error(res.error)
        return
      }
      if (groupId) {
        toast.success('Group updated')
        router.refresh()
      } else {
        router.push(`/groups/${(res.data as { id: string }).id}`)
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="group-name" className="text-sm font-medium">Name</label>
        <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Superday prep — October" maxLength={80} required />
      </div>
      <div className="space-y-2">
        <label htmlFor="group-description" className="text-sm font-medium">Description (optional)</label>
        <Textarea id="group-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the group is studying for" maxLength={500} className="resize-none" />
      </div>
      <Button type="submit" disabled={isPending || name.trim().length === 0}>
        {isPending ? 'Saving…' : groupId ? 'Save' : 'Create group'}
      </Button>
    </form>
  )
}
