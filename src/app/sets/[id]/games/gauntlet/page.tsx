import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { GameFrame } from '@/components/games/GameFrame'
import { ScoreBoard } from '@/components/games/ScoreBoard'
import { loadLeaderboard } from '@/lib/games/load'
import { GAME_MODES } from '@/lib/games/scores'
import { GauntletGame } from '@/components/games/GauntletGame'

/**
 * `/sets/[id]/games/gauntlet` — anyone can play multiple choice on a set they
 * can read (owner, 2026-09-14). Signed in, the run is shaped by your memory,
 * the wrong options are AI-written on your keys, short answer opens, and
 * your score lands on the board.
 */
export default async function GauntletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const set = await prisma.set.findFirst({ where: { id, ...readableSetWhere(viewerId) }, select: { id: true, title: true } })
  if (!set) notFound()
  const boards = (await Promise.all(GAME_MODES['gauntlet'].map((m) => loadLeaderboard(viewerId, id, 'gauntlet', m)))).filter((b) => b !== null)
  const titles: Record<string, string> = { 'mc': 'Multiple choice', 'sa': 'Short answer' }

  return (
    <GameFrame setId={id} setTitle={set.title} game="Gauntlet" wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <GauntletGame setId={id} signedIn={viewerId !== null} />
        <div className="space-y-3">{boards.map((b) => <ScoreBoard key={b.mode} game="gauntlet" title={titles[b.mode] ?? b.mode} rows={b.rows} viewerId={viewerId} compact />)}</div>
      </div>
    </GameFrame>
  )
}
