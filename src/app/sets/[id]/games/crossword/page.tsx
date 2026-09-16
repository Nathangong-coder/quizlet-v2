import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadPlayablePieces, loadLeaderboard } from '@/lib/games/load'
import { MIN_PIECES, isCrosswordSafe } from '@/lib/games/pieces'
import { GameFrame } from '@/components/games/GameFrame'
import { freshSeed } from '@/lib/games/rng'
import { ScoreBoard } from '@/components/games/ScoreBoard'
import { CrosswordGame } from '@/components/games/CrosswordGame'

/** `/sets/[id]/games/crossword` — pieces only, no AI, anonymous-playable on a link/public set. */
export default async function CrosswordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const data = await loadPlayablePieces(viewerId, id)
  if (!data) notFound()
  const board = await loadLeaderboard(viewerId, id, 'crossword', 'default')
  const usable = data.pieces.filter(isCrosswordSafe)
  const short = MIN_PIECES.crossword - usable.length

  return (
    <GameFrame setId={id} setTitle={data.title} game="Crossword" wide>
      {short > 0 ? (
        <p className="text-sm text-muted-foreground">Needs {short} more {short === 1 ? 'piece' : 'pieces'}. The set owner can prepare them from the games hub.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <CrosswordGame setId={id} pieces={usable} signedIn={viewerId !== null} initialSeed={freshSeed()} />
          {board && <ScoreBoard game="crossword" title="Fastest solves" rows={board.rows} viewerId={viewerId} compact />}
        </div>
      )}
    </GameFrame>
  )
}
