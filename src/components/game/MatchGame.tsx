'use client';

import { useState } from 'react';
import { MatchGameState, MatchTile, selectTile, isComplete } from '@/lib/game/match';
import { useBest } from '@/lib/games/use-best';
import { betterOf } from '@/lib/games/best';
import { MatchTimer } from './MatchTimer';
import { MatchTileCard } from './MatchTileCard';

interface MatchGameProps {
  setId: string;
  initialTiles: MatchTile[];
  /** Which pool the tiles came from — only the best-time key differs. */
  source?: 'cards' | 'pieces';
}

/**
 * Match. A GAME, not a study mode: it writes nothing — no StudySession, no
 * StudyEvent, no confidence. It used to (2026-06 to 2026-09-13), which was
 * the wrong call: a timed tile game produces noisy answers, and the owner's
 * decision for every game is "just for fun, nothing goes in the record".
 * tests/games/match-writes-nothing.test.ts scans this file and the page for
 * a server-action import so the write cannot come back quietly.
 *
 * The only thing kept is a best time, on this device (`useBest`).
 */
export function MatchGame({ setId, initialTiles, source = 'cards' }: MatchGameProps) {
  const [gameState, setGameState] = useState<MatchGameState>({
    // Client-local identity for the in-progress game. Never sent anywhere.
    sessionId: crypto.randomUUID(),
    tiles: initialTiles,
    matched: [],
    misses: {},
    selectedTileId: null,
    startedAt: null,
    finishedAt: null,
  });
  const [best, writeBest] = useBest<number>(`match-${source}`, setId);

  function handleTileClick(tileId: string) {
    const next = selectTile(gameState, tileId);
    if (isComplete(next) && !isComplete(gameState) && next.startedAt !== null && next.finishedAt !== null) {
      writeBest(betterOf(best, next.finishedAt - next.startedAt, false));
    }
    setGameState(next);
  }

  const gameFinished = isComplete(gameState);
  const elapsedMs = gameState.finishedAt && gameState.startedAt ? gameState.finishedAt - gameState.startedAt : null;
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${Math.floor((ms / 1000) % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center gap-6 p-4">
      <div className="flex justify-between w-full max-w-6xl">
        <div>
          <h2 className="text-2xl font-bold">Matching Game</h2>
          {best !== null && <p className="text-xs text-muted-foreground">Best on this device: {fmt(best)}</p>}
        </div>
        <MatchTimer startedAt={gameState.startedAt} finishedAt={gameState.finishedAt} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-6xl">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-card text-card-foreground p-8 rounded-lg shadow-xl text-center">
            <h3 className="text-3xl font-bold mb-2">Victory!</h3>
            <p className="mb-1 text-xl">Time: {elapsedMs === null ? 'Calculating...' : fmt(elapsedMs)}</p>
            <p className="mb-6 text-xs text-muted-foreground">Nothing here was saved to your memory.</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-6 py-2 rounded-lg"
            >
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
