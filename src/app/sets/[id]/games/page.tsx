import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Skull, MessageSquareText, Zap, Grid3x3, Gamepad2, ListChecks } from 'lucide-react'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadGamesHub, loadAllLeaderboards } from '@/lib/games/load'
import { ScoreBoard } from '@/components/games/ScoreBoard'
import type { GameAvailability, GameId } from '@/lib/games/pieces'
import { buttonVariants } from '@/components/ui/button'
import { PrepareButton } from '@/components/games/HubControls'
import { cn } from '@/lib/utils'

/**
 * `/sets/[id]/games` — the hub. One card per game with its availability,
 * the credential note for the two AI-graded games, and for the owner the
 * Prepare button with the last summary. Bare (no shell), like the games.
 */
const GAMES: { id: GameId; name: string; pitch: string; icon: typeof Skull; ai: boolean; href: (setId: string) => string }[] = [
  { id: 'gauntlet', name: 'Gauntlet', pitch: 'Your knight against the cards you are weakest on. 100 HP, a magician, a boss. Answer to strike.', icon: Skull, ai: true, href: (s) => `/sets/${s}/games/gauntlet` },
  { id: 'hot-seat', name: 'Hot Seat', pitch: 'An interviewer whose face you can read. Miss a point and they probe it. Three difficulties.', icon: MessageSquareText, ai: true, href: (s) => `/sets/${s}/games/hot-seat` },
  { id: 'blitz', name: 'Blitz', pitch: 'Prompts fall in lanes; tap the answer before they land. Combos freeze the board.', icon: Zap, ai: false, href: (s) => `/sets/${s}/games/blitz` },
  { id: 'crossword', name: 'Crossword', pitch: 'The set’s short answers as a grid. Check, reveal, beat your time.', icon: Grid3x3, ai: false, href: (s) => `/sets/${s}/games/crossword` },
  { id: 'match', name: 'Match', pitch: 'Eight pairs of key points against the clock. Fastest time wins.', icon: Gamepad2, ai: false, href: (s) => `/sets/${s}/match` },
]

function describe(a: GameAvailability): string | null {
  switch (a.state) {
    case 'playable': return null
    case 'needs_pieces': return `Needs ${a.short} more ${a.short === 1 ? 'piece' : 'pieces'}`
    case 'no_klps': return `Needs ${a.short} more ${a.short === 1 ? 'card' : 'cards'} with key points`
    case 'sign_in': return 'Sign in to play'
  }
}

export default async function GamesHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const hub = await loadGamesHub(viewerId, id)
  if (!hub) notFound()
  const boards = (await loadAllLeaderboards(viewerId, id)) ?? []
  const boardTitle: Record<string, string> = { 'gauntlet:mc': 'Gauntlet · multiple choice', 'gauntlet:sa': 'Gauntlet · short answer', 'hot-seat:easy': 'Hot Seat · easy', 'hot-seat:normal': 'Hot Seat · normal', 'hot-seat:hard': 'Hot Seat · hard', 'blitz:default': 'Blitz', 'crossword:default': 'Crossword · fastest', 'match:default': 'Match · fastest' }

  const prepared = hub.set.gamesPreparedAt !== null
  const s = hub.set.summary

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <div className="mb-6">
        <Link href={`/sets/${id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 gap-2')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to set
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label">Games</div>
          <h1 className="display mt-1">{hub.set.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Just for fun — nothing a game sees goes into your record.
            {' '}<span className="metric">{hub.pieceCount}</span> pieces · <span className="metric">{hub.readyCards}</span> of <span className="metric">{hub.cardCount}</span> cards with key points.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {hub.set.isOwner && <PrepareButton setId={id} prepared={prepared} />}
          <Link href={`/sets/${id}/games/pieces`} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            Game pieces
          </Link>
        </div>
      </header>

      {hub.set.isOwner && (
        <p className="mt-3 text-xs text-muted-foreground">
          {prepared && s
            ? <>Prepared {hub.set.gamesPreparedAt!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {s.made + s.copied + s.generated} pieces ({s.copied} reused) · {s.skipped.length} cards skipped{s.failed.length > 0 && <> · <span className="text-warning">{s.failed.length} failed — prepare again</span></>}</>
            : 'Blitz and Crossword need short pieces made from the key points. Preparing uses your AI credentials once; pieces are reused by anyone who plays this set, and by identical cards anywhere.'}
        </p>
      )}

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {GAMES.map((g) => {
          const a: GameAvailability = hub.availability[g.id]
          const blocked = describe(a)
          const Icon = g.icon
          const body = (
            <>
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="font-heading text-lg font-bold">{g.name}</span>
                {g.ai && <span className="ml-auto rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning">uses your AI keys</span>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{g.pitch}</p>
              <p className={cn('mt-3 text-xs', blocked ? 'text-muted-foreground' : 'font-semibold text-primary')}>{blocked ?? 'Play →'}</p>
            </>
          )
          return (
            <li key={g.id} className="flex flex-col gap-1.5">
              {blocked ? (
                <div className="h-full rounded-xl border border-dashed border-border p-5 opacity-80" aria-disabled="true">{body}</div>
              ) : (
                <Link href={g.href(id)} className="block h-full rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-primary/60">{body}</Link>
              )}
            </li>
          )
        })}
      </ul>

      <section className="mt-10" aria-labelledby="boards">
        <h2 id="boards" className="label">Leaderboards</h2>
        <p className="mt-1 text-xs text-muted-foreground">Best run per player on this set. Sign in with a handle to appear; anonymous runs are not saved.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {boards.map((b) => (
            <ScoreBoard key={`${b.game}:${b.mode}`} game={b.game} title={boardTitle[`${b.game}:${b.mode}`] ?? `${b.game} · ${b.mode}`} rows={b.rows} viewerId={viewerId} compact />
          ))}
        </div>
      </section>
    </div>
  )
}
