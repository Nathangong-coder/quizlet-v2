'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
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
import { startStudySession, finishStudySession } from '@/actions/study-session'
import { cn } from '@/lib/utils'
import { ContentBlockView } from '@/components/cards/ContentBlockView'

interface ReviewSessionProps {
  cards: ReviewCard[]
  setId: string
}

export default function ReviewSession({ cards, setId }: ReviewSessionProps) {
  const [session, setSession] = useState<RS>(() => initReviewSession(cards))
  const [flipped, setFlipped] = useState(false)
  const [isPending, startTransition] = useTransition()

  // The real, persisted `StudySession.id`. Opened lazily on the first answer
  // (not on mount) so a review page that's opened and abandoned doesn't leave
  // an empty session in the activity feed.
  const sessionIdRef = useRef<string | null>(null)
  // The in-flight (or settled) ensureSession() call, so the finish path can
  // await a still-opening session instead of racing it.
  const openingRef = useRef<Promise<void> | null>(null)
  const finishedRef = useRef(false)
  // Reset whenever a new card is presented (including on re-queue), so
  // latency measures thinking time on THIS card rather than time since the
  // session began.
  const shownAtRef = useRef<number>(Date.now())

  function resetSessionState() {
    sessionIdRef.current = null
    openingRef.current = null
    finishedRef.current = false
    shownAtRef.current = Date.now()
  }

  // Guarded synchronously (before the first await) so two fast clicks can't
  // both pass the "not yet opened" check and open two sessions.
  function ensureSession(deckSize: number) {
    if (sessionIdRef.current || openingRef.current) return
    openingRef.current = (async () => {
      try {
        const result = await startStudySession({ setId, kind: 'confidence', itemCount: deckSize })
        if (result.success) {
          sessionIdRef.current = result.data.sessionId
        } else {
          console.error('startStudySession failed:', result.error)
          toast.error('This review session will not be saved to your study history.')
        }
      } catch (error) {
        console.error('startStudySession threw:', error)
        toast.error('This review session will not be saved to your study history.')
      }
    })()
  }

  const card = currentCard(session)
  const done = isReviewComplete(session)
  const stats = progressStats(session)

  // Close the session on the render where the deck first empties.
  // Ref-guarded (set before the first await) so a re-render cannot close
  // twice. Awaits a still-opening session so a short deck that completes
  // before startStudySession resolves doesn't orphan it.
  useEffect(() => {
    if (!done || finishedRef.current) return
    finishedRef.current = true
    ;(async () => {
      if (openingRef.current) await openingRef.current
      const sessionId = sessionIdRef.current
      // No session to close: either nothing was ever answered, or opening it
      // failed — in which case ensureSession already toasted why.
      if (!sessionId) return
      try {
        const result = await finishStudySession({ sessionId })
        if (!result.success) {
          console.error('finishStudySession failed:', result.error)
          toast.error('This review session was not fully saved to your study history.')
        }
      } catch (error) {
        console.error('finishStudySession threw:', error)
        toast.error('This review session was not fully saved to your study history.')
      }
    })()
  }, [done])

  function handleAnswer(knew: boolean) {
    if (!card) return
    const cardId = card.id
    const deckSize = cards.length
    startTransition(async () => {
      ensureSession(deckSize)
      if (openingRef.current) await openingRef.current
      const latencyMs = Date.now() - shownAtRef.current
      try {
        await recordReview(cardId, knew, {
          sessionId: sessionIdRef.current ?? undefined,
          latencyMs,
        })
      } catch (error) {
        console.error('recordReview threw:', error)
        toast.error('This answer was not saved to your study history.')
      }
      setSession((prev) => answerCard(prev, cardId, knew))
      setFlipped(false)
      // Reset for the next card presented (including a re-queued card), so
      // its latency is measured from this appearance onward.
      shownAtRef.current = Date.now()
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
              resetSessionState()
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

  const termBlocks = card.contentBlocks?.filter(b => b.side === 'term') ?? []
  const defBlocks = card.contentBlocks?.filter(b => b.side === 'definition') ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {stats.completed} / {stats.total} done
        </span>
      </div>

      <div
        className="relative h-64 cursor-pointer select-none"
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
            className="absolute inset-0 rounded-xl border-2 bg-card flex flex-col items-center justify-center p-6 text-center gap-3 overflow-auto"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Term</p>
            {termBlocks.length > 0 ? (
              <div className="space-y-2">
                {termBlocks.map((block, i) => (
                  <ContentBlockView
                    key={i}
                    block={block}
                    compact
                    assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
                  />
                ))}
              </div>
            ) : (
              <>
                <p className="text-xl font-semibold">{card.term}</p>
                <p className="text-xs text-muted-foreground mt-2">Click to reveal definition</p>
              </>
            )}
          </div>
          <div
            className="absolute inset-0 rounded-xl border-2 border-primary/30 bg-muted flex flex-col items-center justify-center p-6 text-center gap-3 overflow-auto"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Definition</p>
            {defBlocks.length > 0 ? (
              <div className="space-y-2">
                {defBlocks.map((block, i) => (
                  <ContentBlockView
                    key={i}
                    block={block}
                    compact
                    assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="text-base">{card.definition}</p>
            )}
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
