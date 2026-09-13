'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prepareGamePieces, setGamePieceEnabled } from '@/actions/games'

export function PrepareButton({ setId, prepared }: { setId: string; prepared: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await prepareGamePieces(setId)
          if (!res.success) return void toast.error(res.error)
          const s = res.data
          toast.success(`${s.made + s.copied + s.generated} pieces ready${s.failed.length ? ` · ${s.failed.length} cards failed` : ''}`)
          router.refresh()
        })
      }
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      {isPending ? 'Preparing…' : prepared ? 'Prepare again' : 'Prepare games'}
    </Button>
  )
}

export function PieceToggle({ pieceId, enabled }: { pieceId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [isPending, startTransition] = useTransition()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={isPending}
      aria-label={on ? 'Disable this piece' : 'Enable this piece'}
      onClick={() => {
        const next = !on
        setOn(next)
        startTransition(async () => {
          const res = await setGamePieceEnabled(pieceId, next)
          if (!res.success) {
            setOn(!next)
            toast.error(res.error)
          }
        })
      }}
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4.5' : 'left-0.5'}`} />
    </button>
  )
}
