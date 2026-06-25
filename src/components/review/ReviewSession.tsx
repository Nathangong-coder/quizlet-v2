'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  initReviewSession,
  currentCard,
  answerCard,
  isReviewComplete,
  progressStats,
} from '@/lib/review/session'
import type { ReviewCard, ReviewSession as RS } from '@/lib/review/session'
import { recordReview } from '@/actions/confidence'
import { cn } from '@/lib/utils'

interface ReviewSessionProps {
  cards: ReviewCard[]
  setId: string
}

export default function ReviewSession({ cards, setId }: ReviewSessionProps) {
  const [session, setSession] = useState<RS>(() => initReviewSession(cards))
  const [flipped, setFlipped] = useState(false)
  const [isPending, startTransition] = useTransition()

  const card = currentCard(session)
  const done = isReviewComplete(session)
  const stats = progressStats(session)

  function handleAnswer(knew: boolean) {
    if (!card) return
    startTransition(async () => {
      await recordReview(card.id, knew)
      setSession((prev) => answerCard(prev, card.id, knew))
      setFlipped(false)
    })
  }

  if (done) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-5xl">✓</p>
        <h2 className="text-2xl font-bold">Review complete!</h2>
        <p className="text-muted-foreground">{stats.total} cards reviewed.</p>
        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => {
              setSession(initReviewSession(cards))
              setFlipped(false)
            }}
          >
            Review again
          </Button>
          <Link
            href={`/sets/${setId}`}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            Back to set
          </Link>
        </div>
      </div>
    )
  }

  if (!card) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {stats.completed} / {stats.total} done
        </span>
        <span>Confidence: {card.confidence}/10</span>
      </div>

      <div
        className="relative h-56 cursor-pointer select-none"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div
          className="absolute inset-0 w-full h-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          <div
            className="absolute inset-0 rounded-xl border-2 bg-card flex flex-col items-center justify-center p-6 text-center gap-3"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Term</p>
            <p className="text-xl font-semibold">{card.term}</p>
            <p className="text-xs text-muted-foreground mt-2">Click to reveal definition</p>
          </div>
          <div
            className="absolute inset-0 rounded-xl border-2 border-primary/30 bg-muted flex flex-col items-center justify-center p-6 text-center gap-3"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Definition</p>
            <p className="text-base">{card.definition}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Button
          variant="outline"
          className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
          onClick={() => handleAnswer(false)}
          disabled={isPending || !flipped}
        >
          Don't Know
        </Button>
        <Button
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={() => handleAnswer(true)}
          disabled={isPending || !flipped}
        >
          Know It
        </Button>
      </div>

      {!flipped && (
        <p className="text-center text-xs text-muted-foreground">
          Flip the card before answering
        </p>
      )}
    </div>
  )
}
