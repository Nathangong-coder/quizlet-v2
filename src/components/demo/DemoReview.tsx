'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

type ReviewCard = { id: string; term: string; definition: string }

const START = 5
const clamp = (n: number) => Math.min(10, Math.max(1, n))

// In memory only: no server call, nothing persisted.
export function DemoReview({
  cards,
  initialConfidence = {},
}: {
  cards: ReviewCard[]
  /** Starting confidence per card id (default 5). */
  initialConfidence?: Record<string, number>
}) {
  const [queue, setQueue] = useState<string[]>(() => cards.map((c) => c.id))
  const [confidence, setConfidence] = useState<Record<string, number>>(() =>
    Object.fromEntries(cards.map((c) => [c.id, clamp(initialConfidence[c.id] ?? START)])),
  )
  const [flipped, setFlipped] = useState(false)
  const byId = new Map(cards.map((c) => [c.id, c]))

  function answer(known: boolean) {
    const id = queue[0]
    setConfidence((c) => ({ ...c, [id]: clamp(c[id] + (known ? 1 : -1)) }))
    setQueue((q) => (known ? q.slice(1) : [...q.slice(1), id]))
    setFlipped(false)
  }

  function restart() {
    setQueue(cards.map((c) => c.id))
    setConfidence(Object.fromEntries(cards.map((c) => [c.id, clamp(initialConfidence[c.id] ?? START)])))
    setFlipped(false)
  }

  const done = cards.filter((c) => !queue.includes(c.id))
  const reviewedList = done.length > 0 && (
    <ol aria-label="Reviewed" className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
      {done.map((c) => (
        <li key={c.id} className="flex justify-between gap-2 px-3 py-2">
          <span>{c.term}</span>
          <span className="text-muted-foreground">{confidence[c.id]}</span>
        </li>
      ))}
    </ol>
  )

  if (queue.length === 0) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-lg font-semibold">All cards reviewed.</p>
        <Button onClick={restart}>Start over</Button>
        {reviewedList}
      </div>
    )
  }

  const current = byId.get(queue[0])!
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{queue.length} left in the queue</p>
      <div className="space-y-3 rounded-lg border border-border bg-card p-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{flipped ? 'Definition' : 'Term'}</p>
        <p className="text-lg">{flipped ? current.definition : current.term}</p>
        <p className="text-sm text-muted-foreground">Confidence: {confidence[current.id]}</p>
      </div>
      {flipped ? (
        <div className="flex gap-2">
          <Button onClick={() => answer(true)}>Know it</Button>
          <Button variant="outline" onClick={() => answer(false)}>
            Don&apos;t know
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setFlipped(true)}>
          Flip
        </Button>
      )}
      <ol aria-label="Queue" className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
        {queue.map((id, i) => (
          <li key={`${id}-${i}`} className="flex justify-between gap-2 px-3 py-2">
            <span>{byId.get(id)!.term}</span>
            <span className="text-muted-foreground">{confidence[id]}</span>
          </li>
        ))}
      </ol>
      {reviewedList}
    </div>
  )
}
