import type { Metadata } from 'next'
import Link from 'next/link'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo — Games' }
export const dynamic = 'force-dynamic'

export default async function DemoGamesPage() {
  const set = readDemoConfig().enabled ? await loadDemoSet() : null
  if (!set) return <DemoUnavailable />
  const games = [
    { name: 'Gauntlet', note: 'AI-written options · one run', href: '/demo/games/gauntlet' },
    { name: 'Hot Seat', note: 'AI interviewer · one run', href: '/demo/games/hot-seat' },
    { name: 'Blitz', note: 'Unlimited', href: `/sets/${set.id}/games/blitz` },
    { name: 'Crossword', note: 'Unlimited', href: `/sets/${set.id}/games/crossword` },
    { name: 'Match', note: 'Unlimited', href: `/sets/${set.id}/match` },
  ]
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Games</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => (
          <Link key={g.name} href={g.href} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary">
            <div className="font-semibold">{g.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">{g.note}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
