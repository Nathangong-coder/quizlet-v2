'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { SetLeaderboard, GroupMemberRef } from '@/lib/groups/progress'

/**
 * Card × member grid: who has which card down. One cell per (card, member):
 * mastered, learning, or not started. The column with the gaps is the person
 * who needs help; the row with the gaps is the card to do next — which is
 * why the rows can be sorted "hardest first" and a member column can be
 * picked to highlight what THEY are missing.
 */
export function CoverageGrid({ board, cards, viewerId }: { board: SetLeaderboard; cards: { id: string; term: string }[]; viewerId: string }) {
  const members = board.standings
  const [pick, setPick] = useState<string | null>(null)
  const [hardest, setHardest] = useState(true)
  const [q, setQ] = useState('')
  const termBy = useMemo(() => new Map(cards.map((c) => [c.id, c.term])), [cards])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = board.cards
      .map((c) => ({ ...c, term: termBy.get(c.cardId) ?? '', mastered: new Set(c.masteredBy.map((m) => m.userId)), learning: new Set(c.learningBy.map((m) => m.userId)) }))
      .filter((c) => (needle ? c.term.toLowerCase().includes(needle) : true))
      .filter((c) => (pick ? !c.mastered.has(pick) : true))
    if (hardest) list.sort((a, b) => a.mastered.size - b.mastered.size || a.learning.size - b.learning.size)
    return list
  }, [board.cards, termBy, q, pick, hardest])

  const label = (m: GroupMemberRef | { userId: string; handle: string | null }) => (m.userId === viewerId ? 'you' : m.handle ? `@${m.handle}` : 'member')

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={hardest} onChange={(e) => setHardest(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Hardest first
        </label>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Pick a member to see only what they are missing:</span>
        {members.map((m) => (
          <button
            key={m.userId}
            type="button"
            aria-pressed={pick === m.userId}
            onClick={() => setPick((p) => (p === m.userId ? null : m.userId))}
            className={cn('rounded-full border px-2 py-0.5', pick === m.userId ? 'border-primary bg-accent' : 'border-border hover:border-primary/50')}
          >
            {label(m)}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a card" aria-label="Find a card" className="ml-auto rounded-full border border-border bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="w-full py-1 pr-3 font-medium">Card</th>
              {members.map((m) => (
                <th key={m.userId} scope="col" className={cn('px-1 py-1 text-center font-medium', pick === m.userId && 'text-primary')}>
                  <span className="inline-block max-w-16 truncate align-bottom" title={label(m)}>{label(m)}</span>
                </th>
              ))}
              <th scope="col" className="py-1 pl-3 text-right font-medium">Ask</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.cardId} className="rounded-md">
                <td className="max-w-0 truncate rounded-l-md bg-card py-1.5 pl-3 pr-3" title={c.term}>{c.term}</td>
                {members.map((m) => {
                  const state = c.mastered.has(m.userId) ? 'mastered' : c.learning.has(m.userId) ? 'learning' : 'none'
                  return (
                    <td key={m.userId} className="bg-card px-1 py-1.5 text-center">
                      <span
                        role="img"
                        aria-label={`${label(m)}: ${state === 'none' ? 'not started' : state}`}
                        className={cn('mx-auto block h-4 w-4 rounded', state === 'mastered' ? 'bg-success' : state === 'learning' ? 'bg-warning' : 'border border-dashed border-muted-foreground/50')}
                      />
                    </td>
                  )
                })}
                <td className="rounded-r-md bg-card py-1.5 pl-3 pr-3 text-right text-xs">
                  {c.masteredBy.length === 0 ? (
                    <span className="text-muted-foreground">nobody yet</span>
                  ) : c.masteredBy.length === members.length ? (
                    <span className="text-muted-foreground">everyone</span>
                  ) : (
                    c.masteredBy.slice(0, 2).map((m, i) => (
                      <span key={m.userId}>
                        {i > 0 && ', '}
                        {m.userId === viewerId ? 'you' : m.handle ? <Link href={`/u/${m.handle}`} className="underline-offset-4 hover:underline">@{m.handle}</Link> : 'a member'}
                      </span>
                    ))
                  )}
                  {c.masteredBy.length > 2 && c.masteredBy.length < members.length && <span className="text-muted-foreground"> +{c.masteredBy.length - 2}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{pick ? 'They have every matching card down.' : 'No cards match.'}</p>}
      </div>
    </div>
  )
}
