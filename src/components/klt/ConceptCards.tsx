'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { listConceptCards, type ConceptCards as ConceptCardsData, type LinkedCard } from '@/actions/klt-tree'

interface ConceptCardsProps {
  setId: string
  kltId: string
}

/**
 * What is tagged to the selected concept.
 *
 * Fetched here rather than with the tree: a set can have hundreds of key
 * points, and loading every concept's card list to render one panel would
 * make opening the tree pay for a question nobody asked. The parent mounts
 * this with the inspector's `key={node.kltId}`, so selecting a different node
 * remounts it and the fetch re-runs — there is no stale-data path to guard.
 */
export function ConceptCards({ setId, kltId }: ConceptCardsProps) {
  const [data, setData] = useState<ConceptCardsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDescendants, setShowDescendants] = useState(false)

  // `.then`, not `async`/`await` — `react-hooks/set-state-in-effect` flags a
  // setState reachable from an async function called directly in an effect.
  const load = useCallback(() => {
    return listConceptCards(setId, kltId).then((res) => {
      if (!res.success) {
        setError(res.error || 'Failed to load the cards for this concept')
        return
      }
      setData(res.data)
    })
  }, [setId, kltId])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (!data) return <p className="text-xs text-muted-foreground">Loading cards…</p>

  const empty = data.direct.length === 0 && data.descendants.length === 0

  return (
    <section className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        Cards tagged here{data.direct.length > 0 ? ` — ${data.direct.length}` : ''}
      </p>

      {empty && (
        <p className="text-[11px] text-muted-foreground">
          Nothing is filed under this concept yet. Cards land here when their key points cite it.
        </p>
      )}

      {data.direct.length === 0 && data.descendants.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          No card cites this concept directly — everything sits on the concepts beneath it.
        </p>
      )}

      <ul className="space-y-1">
        {data.direct.map((card) => (
          <CardRow key={card.cardId} card={card} setId={setId} />
        ))}
      </ul>

      {data.descendants.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showDescendants}
            onClick={() => setShowDescendants((v) => !v)}
            className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showDescendants ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3" aria-hidden="true" />
            )}
            {data.descendants.length} more under child concept
            {data.descendants.length === 1 ? '' : 's'}
          </button>
          {showDescendants && (
            <ul className="space-y-1">
              {data.descendants.map((card) => (
                <CardRow key={card.cardId} card={card} setId={setId} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function CardRow({ card, setId }: { card: LinkedCard; setId: string }) {
  return (
    <li>
      <Link
        href={`/sets/${setId}#card-${card.cardId}`}
        className="block rounded-md border px-2 py-1.5 hover:bg-accent"
      >
        <span className="line-clamp-2 text-xs font-medium">{card.term}</span>
        {card.viaConcepts.length > 0 && (
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            via {card.viaConcepts.join(', ')}
          </span>
        )}
        <ul className="mt-1 space-y-0.5">
          {card.klps.map((klp) => (
            // The short label when the summarizer produced one, the full
            // proposition when it did not — never a blank line, which is what
            // rendering `label` alone would give for an unlabelled key point.
            <li key={klp.id} className="line-clamp-2 text-[10px] text-muted-foreground">
              {klp.label ?? klp.text}
            </li>
          ))}
        </ul>
      </Link>
    </li>
  )
}
