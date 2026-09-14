'use client';

import { useState, useTransition } from 'react';
import { MatchGameState, MatchTile, selectTile, isComplete } from '@/lib/game/match';
import { useBest } from '@/lib/games/use-best';
import { betterOf } from '@/lib/games/best';
import { timeToScore } from '@/lib/games/scores';
import { submitGameScore } from '@/actions/games';
import { Button } from '@/components/ui/button';
import { MatchTimer } from './MatchTimer';
import { MatchTileCard } from './MatchTileCard';

interface MatchGameProps {
  setId: string;
  initialTiles: MatchTile[];
  signedIn?: boolean;
  /** Deal a fresh board (new sample of pieces). */
  onAgain?: () => void;
}

/**
 * Match. A GAME, not a study mode: it writes no study memory — no
 * StudySession, no StudyEvent, no confidence. It used to (2026-06 to
 * 2026-09-13), which was the wrong call. What it writes is a finished TIME
 * to the set's leaderboard, if the player is signed in with a handle.
 *
 * Tiles are game PIECES (short prompt/answer pairs from key points), never
 * whole cards: eight pairs, sixteen tiles, one screen. See the match page.
 * tests/games/match-writes-nothing.test.ts scans this file for any study
 * write path.
 */
export function MatchGame({ setId, initialTiles, signedIn = false, onAgain }: MatchGameProps) {
  const [gameState, setGameState] = useState<MatchGameState>({
    sessionId: crypto.randomUUID(),
    tiles: initialTiles,
    matched: [],
    misses: {},
    selectedTileId: null,
    startedAt: null,
    finishedAt: null,
  });
  const [best, writeBest] = useBest<number>('match', setId);
  const [saved, setSaved] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleTileClick(tileId: string) {
    const next = selectTile(gameState, tileId);
    if (isComplete(next) && !isComplete(gameState) && next.startedAt !== null && next.finishedAt !== null) {
      const ms = next.finishedAt - next.startedAt;
      writeBest(betterOf(best, ms, false));
      if (signedIn) {
        startTransition(async () => {
          const res = await submitGameScore({ game: 'match', mode: 'default', setId, score: timeToScore(ms), meta: { pairs: initialTiles.length / 2, misses: Object.values(next.misses).reduce((a, b) => a + b, 0) } });
          if (res.success) setSaved(res.data.saved ? 'Saved to the leaderboard.' : res.data.reason === 'no_handle' ? 'Choose a handle in Account to appear on the leaderboard.' : null);
        });
      }
    }
    setGameState(next);
  }

  const gameFinished = isComplete(gameState);
  const elapsedMs = gameState.finishedAt && gameState.startedAt ? gameState.finishedAt - gameState.startedAt : null;
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${Math.floor((ms / 1000) % 60).toString().padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold">Match</h2>
          <p className="text-xs text-muted-foreground">{initialTiles.length / 2} pairs · tap a prompt, then its answer{best !== null && <> · best on this device {fmt(best)}</>}</p>
        </div>
        <MatchTimer startedAt={gameState.startedAt} finishedAt={gameState.finishedAt} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {gameState.tiles.map((tile) => (
          <MatchTileCard
            key={tile.id}
            content={tile.content}
            isSelected={gameState.selectedTileId === tile.id}
            isMatched={gameState.matched.includes(tile.id)}
            onClick={() => handleTileClick(tile.id)}
          />
        ))}
      </div>

      {gameFinished && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="rounded-xl bg-card p-8 text-center text-card-foreground shadow-xl">
            <h3 className="mb-2 font-heading text-3xl font-bold">Matched!</h3>
            <p className="mb-1 text-xl">Time: {elapsedMs === null ? '…' : fmt(elapsedMs)}</p>
            {saved && <p className="mb-1 text-xs text-primary">{saved}</p>}
            <p className="mb-6 text-xs text-muted-foreground">Nothing here was saved to your memory.</p>
            <Button onClick={() => (onAgain ? onAgain() : window.location.reload())}>Play again</Button>
          </div>
        </div>
      )}
    </div>
  );
}
