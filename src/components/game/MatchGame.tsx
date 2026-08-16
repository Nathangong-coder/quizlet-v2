'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MatchGameState, MatchTile, initMatchGame, selectTile, isComplete, matchResults } from '@/lib/game/match';
import { startStudySession, finishStudySession } from '@/actions/study-session';
import { submitMatchSession } from '@/actions/match-session';
import { MatchTimer } from './MatchTimer';
import { MatchTileCard } from './MatchTileCard';

interface MatchGameProps {
  setId: string;
  initialTiles: MatchTile[];
}

export function MatchGame({ setId, initialTiles }: MatchGameProps) {
  const [gameState, setGameState] = useState<MatchGameState>({
    // NOT the database StudySession id below — this is a client-local
    // identifier only, used as a React key/identity for the in-progress
    // game, and is never sent anywhere. See `persistedSessionIdRef`.
    sessionId: crypto.randomUUID(),
    tiles: initialTiles,
    matched: [],
    misses: {},
    selectedTileId: null,
    startedAt: null,
    finishedAt: null,
  });

  // The real, persisted `StudySession.id` from the database — distinct from
  // (and unrelated to) `gameState.sessionId` above.
  const persistedSessionIdRef = useRef<string | null>(null);
  // The in-flight (or settled) `ensureSession()` call, so the completion
  // handler can await a still-opening session instead of racing it: on a
  // small deck the game can finish before `startStudySession`'s round trip
  // resolves, and reading `persistedSessionIdRef.current` at that instant
  // would silently see null and drop the results.
  const openSessionPromiseRef = useRef<Promise<void> | null>(null);
  // Set when ensureSession already toasted a failure, so the completion
  // handler below doesn't repeat the same warning a second time.
  const openFailureToastedRef = useRef(false);
  const submittedRef = useRef(false);

  function ensureSession() {
    if (persistedSessionIdRef.current || openSessionPromiseRef.current) return;
    openSessionPromiseRef.current = (async () => {
      try {
        const result = await startStudySession({
          setId,
          kind: 'matching',
          itemCount: gameState.tiles.length / 2,
        });
        if (result.success) {
          persistedSessionIdRef.current = result.data.sessionId;
        } else {
          console.error('startStudySession failed:', result.error);
          openFailureToastedRef.current = true;
          toast.error('This game will not be saved to your study history.');
        }
      } catch (error) {
        console.error('startStudySession threw:', error);
        openFailureToastedRef.current = true;
        toast.error('This game will not be saved to your study history.');
      }
    })();
  }

  const handleTileClick = (tileId: string) => {
    if (gameState.startedAt === null) {
      ensureSession();
    }
    setGameState((prev) => selectTile(prev, tileId));
  };

  const gameFinished = isComplete(gameState);

  // Submit exactly once, on the render where the game first completes.
  // Ref-guarded so a re-render (or a StrictMode double-invoke) cannot
  // double-submit. A failure here must never block the completion UI — the
  // game result belongs to the user whether or not memory recorded it.
  useEffect(() => {
    if (!gameFinished || submittedRef.current) return;
    submittedRef.current = true;

    (async () => {
      // Wait out a still-opening session (see openSessionPromiseRef above)
      // rather than reading persistedSessionIdRef too early.
      if (openSessionPromiseRef.current) {
        await openSessionPromiseRef.current;
      }

      const sessionId = persistedSessionIdRef.current;
      if (!sessionId) {
        // Session was never opened. If ensureSession already toasted why
        // (auth/network failure), don't repeat it — otherwise this is the
        // only feedback the user gets, so it must not stay silent.
        if (!openFailureToastedRef.current) {
          toast.error('This game was not saved to your study history.');
        }
        return;
      }

      try {
        const result = await submitMatchSession({ sessionId, results: matchResults(gameState) });
        if (!result.success) {
          console.error('submitMatchSession failed:', result.error);
          toast.error('Could not save this game to your study history.');
        }
      } catch (error) {
        console.error('submitMatchSession threw:', error);
        toast.error('Could not save this game to your study history.');
      }

      try {
        const result = await finishStudySession({ sessionId });
        if (!result.success) {
          console.error('finishStudySession failed:', result.error);
        }
      } catch (error) {
        console.error('finishStudySession threw:', error);
      }
    })();
    // Deliberately only [gameFinished]: this must fire once, on the render
    // where completion first flips true, using that render's gameState
    // closure — not re-run every time gameState changes afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameFinished]);

  return (
    <div className="flex flex-col items-center gap-6 p-4">
      <div className="flex justify-between w-full max-w-6xl">
        <h2 className="text-2xl font-bold">Matching Game</h2>
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
            <h3 className="text-3xl font-bold mb-4">Victory!</h3>
            <p className="mb-6 text-xl">Time: {
              gameState.finishedAt && gameState.startedAt
                ? `${Math.floor(((gameState.finishedAt - gameState.startedAt) / 1000) / 60)}:${Math.floor(((gameState.finishedAt - gameState.startedAt) / 1000) % 60).toString().padStart(2, '0')}`
                : 'Calculating...'
            }</p>
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
