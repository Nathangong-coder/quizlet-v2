'use client';

import { useState } from 'react';
import { MatchGameState, MatchTile, initMatchGame, selectTile, isComplete } from '@/lib/game/match';
import { MatchTimer } from './MatchTimer';
import { MatchTileCard } from './MatchTileCard';

interface MatchGameProps {
  initialTiles: MatchTile[];
}

export function MatchGame({ initialTiles }: MatchGameProps) {
  const [gameState, setGameState] = useState<MatchGameState>({
    sessionId: crypto.randomUUID(),
    tiles: initialTiles,
    matched: [],
    selectedTileId: null,
    startedAt: null,
    finishedAt: null,
  });

  const handleTileClick = (tileId: string) => {
    setGameState((prev) => selectTile(prev, tileId));
  };

  const gameFinished = isComplete(gameState);


  return (
    <div className="flex flex-col items-center gap-6 p-4">
      <div className="flex justify-between w-full max-w-2xl">
        <h2 className="text-2xl font-bold">Matching Game</h2>
        <MatchTimer startedAt={gameState.startedAt} finishedAt={gameState.finishedAt} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl">
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
          <div className="bg-white p-8 rounded-lg shadow-xl text-center">
            <h3 className="text-3xl font-bold mb-4">Victory!</h3>
            <p className="mb-6 text-xl">Time: {
              gameState.finishedAt && gameState.startedAt
                ? `${Math.floor(((gameState.finishedAt - gameState.startedAt) / 1000) / 60)}:${Math.floor(((gameState.finishedAt - gameState.startedAt) / 1000) % 60).toString().padStart(2, '0')}`
                : 'Calculating...'
            }</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg"
            >
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
