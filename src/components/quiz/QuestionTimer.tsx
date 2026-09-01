'use client'

import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { QuestionTimer } from '@/lib/quiz/question-timer'

export function formatQuestionTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** A quiet live stopwatch for the question currently in view. */
export function QuestionTimerDisplay({ timer, cardId }: { timer: QuestionTimer; cardId: string }) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    timer.start(cardId)

    const update = () => setElapsedMs(timer.elapsed(cardId) ?? 0)
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [cardId, timer])

  const formatted = formatQuestionTime(elapsedMs)

  return (
    <span
      role="timer"
      aria-label={`Time on question: ${formatted}`}
      title="Time on this question"
      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums text-muted-foreground"
    >
      <Clock3 className="h-4 w-4" aria-hidden="true" />
      {formatted}
    </span>
  )
}
