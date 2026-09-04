'use client'

import { useCallback, useEffect, useState } from 'react'
import { listTopicKlps } from '@/actions/klt-tree'

interface Klp {
  id: string
  text: string
  pKnown: number | null
  observations: number
}

/**
 * The key points behind one concept's mastery number.
 *
 * Fetched on expand rather than with the list, following `ConceptCards`: a set
 * can have hundreds of key points, and loading every concept's to render a
 * collapsed row would make opening the tab pay for a question nobody asked.
 */
export function ConceptKlps({ setId, topicKey }: { setId: string; topicKey: string }) {
  const [klps, setKlps] = useState<Klp[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `.then`, not async/await — `react-hooks/set-state-in-effect` flags a
  // setState reachable from an async function called directly in an effect.
  const load = useCallback(() => {
    return listTopicKlps(setId, topicKey).then((res) => {
      if (!res.success) {
        setError(res.error || 'Failed to load key points')
        return
      }
      setKlps(res.data)
    })
  }, [setId, topicKey])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (klps === null) return <p className="text-xs text-muted-foreground">Loading key points…</p>
  if (klps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No key points here yet. They appear once this set&rsquo;s cards have been extracted.
      </p>
    )
  }

  return (
    <ul className="space-y-1">
      {klps.map((k) => (
        <li key={k.id} className="flex items-baseline justify-between gap-4 text-xs">
          <span>{k.text}</span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {/* The percentage is its own text node, separate from the
                observation count, so a reader (and a test) can address the
                number itself without also matching the "· N obs" suffix. */}
            <span>{k.pKnown === null ? '—' : `${Math.round(k.pKnown * 100)}%`}</span>
            {k.observations > 0 && ` · ${k.observations} obs`}
          </span>
        </li>
      ))}
    </ul>
  )
}
