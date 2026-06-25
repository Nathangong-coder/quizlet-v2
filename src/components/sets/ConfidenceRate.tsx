'use client'

import { useTransition } from 'react'
import { updateConfidence } from '@/actions/confidence'
import { cn } from '@/lib/utils'

interface ConfidenceRateProps {
  cardId: string
  setId: string
  initialConfidence: number
}

export default function ConfidenceRate({ cardId, setId, initialConfidence }: ConfidenceRateProps) {
  const [isPending, startTransition] = useTransition()

  function handleChange(val: string) {
    const confidence = Math.max(1, Math.min(10, parseInt(val) || 5))
    startTransition(() => updateConfidence(cardId, setId, confidence))
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-tighter font-medium">
        Confidence
      </label>
      <input
        type="number"
        min="1"
        max="10"
        value={initialConfidence}
        onChange={(e) => handleChange(e.target.value)}
        className={cn(
          "w-10 h-6 text-center text-xs font-mono border rounded bg-background",
          isPending && "opacity-50"
        )}
      />
    </div>
  )
}
