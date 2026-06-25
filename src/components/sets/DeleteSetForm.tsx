'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { deleteSet } from '@/actions/sets'

interface DeleteSetFormProps {
  setId: string
}

export default function DeleteSetForm({ setId }: DeleteSetFormProps) {
  const [isPending, startTransition] = useTransition()

  function action(formData: FormData) {
    startTransition(async () => {
      await deleteSet(setId)
    })
  }

  return (
    <form action={action}>
      <Button
        variant="destructive"
        size="sm"
        type="submit"
        disabled={isPending}
      >
        {isPending ? 'Deleting...' : 'Delete'}
      </Button>
    </form>
  )
}
