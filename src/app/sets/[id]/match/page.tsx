import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadPlayablePieces, loadLeaderboard } from '@/lib/games/load'
import { MIN_PIECES } from '@/lib/games/pieces'
import { freshSeed } from '@/lib/games/rng'
import { GameFrame } from '@/components/games/GameFrame'
import { MatchBoard } from '@/components/game/MatchBoard'
import { ScoreBoard } from '@/components/games/ScoreBoard'

/**
 * `/sets/[id]/match` — Match on game PIECES: eight short prompt/answer pairs
 * per deal, sixteen tiles on one screen, a timer, and the fastest times on
 * the set's leaderboard. Whole cards are never dealt (a paragraph on a tile
 * is unplayable); a set with fewer than eight pieces says so and points at
 * the hub, where the owner prepares them.
 *
 * Anonymous-playable on a link/public set (2026-09-13): Match writes no
 * study memory, so there is nothing to gate behind sign-in — an anonymous
 * time simply is not saved. `readableSetWhere` (through the loaders) decides
 * which sets a visitor can see.
 */
export default async function MatchGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  // The predicate is applied inside `loadPlayablePieces`; this reference keeps the
  // visibility source-scan (`tests/sets/visibility-enforcement.test.ts`) honest
  // about this page, the same way the Blitz and Crossword pages do.
  void readableSetWhere
  const data = await loadPlayablePieces(viewerId, id)
  if (!data) notFound()
  const board = await loadLeaderboard(viewerId, id, 'match', 'default')
  const short = MIN_PIECES.match - data.pieces.length

  return (
    <GameFrame setId={id} setTitle={data.title} game="Match" wide>
      {short > 0 ? (
        <p className="text-sm text-muted-foreground">
          Match needs {MIN_PIECES.match} pieces and this set has {data.pieces.length}. The set owner can prepare pieces from the games hub.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <MatchBoard setId={id} pieces={data.pieces} signedIn={viewerId !== null} initialSeed={freshSeed()} />
          {board && <ScoreBoard game="match" title="Fastest times" rows={board.rows} viewerId={viewerId} />}
        </div>
      )}
    </GameFrame>
  )
}
