'use client'

import Link from 'next/link'
import { BookOpen, Gamepad2, ListChecks, PencilLine } from 'lucide-react'
import { useGuestState } from '@/lib/demo/use-guest-state'
import { allowanceRows } from './allowance'

const TILES = [
  { href: '/demo/set', label: 'Flashcards', blurb: 'Flip through the demo set.', Icon: BookOpen },
  { href: '/demo/create', label: 'Make a card', blurb: 'Build up to five of your own.', Icon: PencilLine },
  { href: '/demo/quiz', label: 'Take the quiz', blurb: 'One question, graded by AI.', Icon: ListChecks },
  { href: '/demo/games', label: 'Play a game', blurb: 'Gauntlet and Hot Seat.', Icon: Gamepad2 },
]

export function DemoHome({ title, cardCount }: { title: string; cardCount: number }) {
  const [state, , loaded] = useGuestState()
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{cardCount} cards</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {TILES.map(({ href, label, blurb, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted"
          >
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-sm text-muted-foreground">{blurb}</span>
            </span>
          </Link>
        ))}
      </div>
      <section aria-labelledby="allowance-h">
        <h2 id="allowance-h" className="mb-2 text-sm font-semibold">
          Your demo allowance
        </h2>
        {loaded ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {allowanceRows(state).map((r) => (
              <li key={r.label} className="flex justify-between px-3 py-2">
                <span>{r.label}</span>
                <span className="text-muted-foreground">{r.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="h-40 rounded-lg border border-border bg-muted/40" aria-hidden />
        )}
      </section>
    </div>
  )
}
