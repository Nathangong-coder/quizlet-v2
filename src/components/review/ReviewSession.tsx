'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Star } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  initReviewSession,
  currentCard,
  answerCard,
  isReviewComplete,
  progressStats,
  summarizeReview,
} from '@/lib/review/session'
import type { ReviewSession as RS } from '@/lib/review/session'
import { sideFor, type ReviewCardInput, type ReviewSetup, DEFAULT_REVIEW_SETUP } from '@/lib/review/setup'
import { recordReview, starCard } from '@/actions/confidence'
import { startStudySession, finishStudySession } from '@/actions/study-session'
import { cn } from '@/lib/utils'
import { ContentBlockView } from '@/components/cards/ContentBlockView'
import { getNumberedListIndex } from '@/lib/cards/content'

interface ReviewSessionProps {
  cards: ReviewCardInput[]
  setId: string
  setup?: ReviewSetup
  /** Start again — with only these card ids, or the whole deck when absent. */
  onRestart?: (ids: string[] | null) => void
  onChangeSetup?: () => void
}

/**
 * The deck. FLAT card (no 3D flip — the owner asked for flat flashcards),
 * the side the setup chose shown first, keyboard: Space flips, 1 = don't
 * know, 2 = know it, S stars. Progress on top, confidence and a star on the
 * card, and a summary at the end that offers the missed cards again.
 *
 * Persistence is unchanged from the original: a `StudySession` opened lazily
 * on the first answer, one `recordReview` per answer, closed when the deck
 * empties. Every guard around that (ref-guarded open, awaited close) is kept
 * verbatim — it was written against real races.
 */
export default function ReviewSession({ cards, setId, setup = DEFAULT_REVIEW_SETUP, onRestart, onChangeSetup }: ReviewSessionProps) {
  const [session, setSession] = useState<RS>(() => initReviewSession(cards))
  const [flipped, setFlipped] = useState(false)
  const [stars, setStars] = useState<Record<string, boolean>>(() => Object.fromEntries(cards.map((c) => [c.id, Boolean(c.starred)])))
  const [shownCount, setShownCount] = useState(0)
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
  const shownAtRef = useRef<number>(0)
  useEffect(() => {
    // Stamped on mount, not in render (the purity rule); the first card's
    // latency counts from when the deck appeared.
    shownAtRef.current = Date.now()
  }, [])

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
    if (!card || !flipped) return
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
      setShownCount((n) => n + 1)
      // Reset for the next card presented (including a re-queued card), so
      // its latency is measured from this appearance onward.
      shownAtRef.current = Date.now()
    })
  }

  function toggleStar() {
    if (!card) return
    const next = !stars[card.id]
    setStars((s) => ({ ...s, [card.id]: next }))
    startTransition(() => starCard(card.id, setId, next))
  }

  // Keyboard: Space flips, 1 / 2 answer, S stars. Only while a card is up.
  // The handler closes over the latest state; the ref is assigned in an
  // effect (never during render) and the listener reads through it.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (done || !card) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f) }
      else if (e.key === '1') handleAnswer(false)
      else if (e.key === '2') handleAnswer(true)
      else if (e.key === 's' || e.key === 'S') toggleStar()
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (done) {
    const sum = summarizeReview(session)
    return (
      <div className="space-y-6 py-6">
        <div className="text-center">
          <p className="text-5xl">✓</p>
          <h2 className="mt-2 font-heading text-2xl font-bold">Review complete</h2>
          <p className="mt-1 text-sm text-muted-foreground">{sum.total} {sum.total === 1 ? 'card' : 'cards'} · every answer is in your study history.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={sum.knownFirstTime} label="Knew first time" />
          <Stat value={sum.missed} label="Needed another look" />
          <Stat value={sum.up} label="Confidence up" tone="up" />
          <Stat value={sum.down} label="Confidence down" tone="down" />
        </div>
        {sum.missedIds.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="label mb-2">The ones you missed</div>
            <ul className="space-y-1 text-sm">
              {sum.missedIds.map((id) => {
                const c = cards.find((x) => x.id === id)
                const o = session.outcomes?.[id]
                return c ? (
                  <li key={id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{c.term}</span>
                    {o && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{o.startConfidence} → {o.endConfidence}</span>}
                  </li>
                ) : null
              })}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {sum.missedIds.length > 0 && onRestart && (
            <Button onClick={() => onRestart(sum.missedIds)}>Review the {sum.missedIds.length} you missed</Button>
          )}
          <Button variant={sum.missedIds.length > 0 ? 'outline' : 'default'} onClick={() => (onRestart ? onRestart(null) : setSession(initReviewSession(cards)))}>
            Review again
          </Button>
          {onChangeSetup && <Button variant="ghost" onClick={onChangeSetup}>Change the setup</Button>}
          <Link href={`/sets/${setId}`} className={cn(buttonVariants({ variant: 'ghost' }))}>Back to set</Link>
        </div>
      </div>
    )
  }

  if (!card) return null

  const first = sideFor(setup, shownCount)
  const showing: 'term' | 'definition' = flipped ? (first === 'term' ? 'definition' : 'term') : first
  const blocks = card.contentBlocks?.filter((b) => b.side === showing) ?? []
  const starred = stars[card.id] ?? false
  const pct = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{stats.completed} of {stats.total} done</span>
        <span>confidence <span className="metric">{card.confidence}</span>/10</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label={flipped ? `Show ${first}` : `Show ${first === 'term' ? 'definition' : 'term'}`}
          aria-pressed={flipped}
          onClick={() => setFlipped((f) => !f)}
          className={cn(
            'flex min-h-64 w-full select-none flex-col items-center justify-center gap-3 rounded-xl border-2 p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            flipped ? 'border-primary/30 bg-muted' : 'border-border bg-card',
          )}
        >
          <p className="label">{showing}</p>
          {blocks.length > 0 ? (
            <div className="space-y-2">
              {blocks.map((block, i) => (
                <ContentBlockView key={i} block={block} index={getNumberedListIndex(blocks, i)} compact assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined} />
              ))}
            </div>
          ) : (
            <p className={cn('mx-auto max-w-prose', showing === 'term' ? 'text-xl font-semibold' : 'text-base')}>{showing === 'term' ? card.term : card.definition}</p>
          )}
          {!flipped && <p className="text-xs text-muted-foreground">tap or press space to reveal</p>}
        </button>
        <button
          type="button"
          onClick={toggleStar}
          aria-pressed={starred}
          aria-label={starred ? 'Unstar this card' : 'Star this card'}
          className={cn('absolute right-3 top-3 rounded-full p-1.5', starred ? 'text-warning' : 'text-muted-foreground hover:text-warning/80')}
        >
          <Star className={cn('h-5 w-5', starred && 'fill-current')} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:border-destructive hover:bg-destructive-subtle"
          onClick={() => handleAnswer(false)}
          disabled={isPending || !flipped}
        >
          Don&rsquo;t know <kbd className="ml-2 rounded border border-current/30 px-1 text-[10px]">1</kbd>
        </Button>
        <Button className="bg-success text-success-foreground hover:bg-success/90" onClick={() => handleAnswer(true)} disabled={isPending || !flipped}>
          Know it <kbd className="ml-2 rounded border border-current/30 px-1 text-[10px]">2</kbd>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">{flipped ? 'Was it there before you flipped?' : 'Flip the card before answering'}</p>
    </div>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-center">
      <div className={cn('metric text-2xl font-semibold', tone === 'up' && value > 0 && 'text-success', tone === 'down' && value > 0 && 'text-destructive')}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
