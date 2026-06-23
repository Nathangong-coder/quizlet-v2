'use client'

import { useState } from 'react'
import { deleteSet } from '@/actions/sets'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

export function DeleteSetButton({ setId }: { setId: string }) {
  const [isLoading, setIsLoading] = useState(false)

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this set? All cards will be permanently removed.')) {
      return
    }

    setIsLoading(true)
    const result = await deleteSet(setId)
    setIsLoading(false)

    if (!result.success) {
      alert(result.error || 'Failed to delete set')
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDelete}
      disabled={isLoading}
      className="flex items-center gap-2"
    >
      <Trash2 className="w-4 h-4" />
      {isLoading ? 'Deleting...' : 'Delete Set'}
    </Button>
  )
}
