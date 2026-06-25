'use client'

import { useTransition } from 'react'
import { starCard } from '@/actions/confidence'

interface StarButtonProps {
  cardId: string
  setId: string
  starred: boolean
}

export default function StarButton({ cardId, setId, starred }: StarButtonProps) {
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(() => starCard(cardId, setId, !starred))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className={[
        'text-xl leading-none transition-colors disabled:opacity-50',
        starred
          ? 'text-yellow-500'
          : 'text-muted-foreground hover:text-yellow-400',
      ].join(' ')}
      aria-label={starred ? 'Unstar card' : 'Star card'}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}
