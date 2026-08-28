'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { forkSet } from '@/actions/sets-fork'

/**
 * "Make my own copy".
 *
 * Shown only to a NON-owner. Duplicating your own set is a different verb and
 * does not belong on this row.
 *
 * The pending label is not decoration: a fork copies every blob in the set, so
 * this can genuinely take seconds. A button that looks idle while doing that
 * reads as broken, and gets clicked again.
 */
export function ForkButton({ setId }: { setId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await forkSet(setId)
          if (!res.success) {
            // The refusal text names which limit was hit and by how much
            // (`describeForkRefusal`), so it is shown verbatim rather than
            // replaced with a generic failure.
            toast.error(res.error)
            return
          }
          toast.success('Copied to your library')
          router.push(`/sets/${res.data.setId}`)
        })
      }
      className={cn(
        buttonVariants({ variant: 'outline', size: 'sm' }),
        'flex items-center gap-2',
      )}
    >
      <Copy className="w-4 h-4" aria-hidden="true" />
      {pending ? 'Copying…' : 'Make my own copy'}
    </button>
  )
}
