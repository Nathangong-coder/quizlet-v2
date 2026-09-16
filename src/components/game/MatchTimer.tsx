'use client';

import { useState, useEffect } from 'react';

interface MatchTimerProps {
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * Elapsed time, derived: the only state is a clock that ticks while the game
 * runs. Before the first tap it reads 0:00; after the last it freezes on
 * `finishedAt`. (The old version copied props into state inside the effect,
 * which the react-compiler rule rejects as a cascading render.)
 */
export function MatchTimer({ startedAt, finishedAt }: MatchTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [startedAt, finishedAt]);

  const elapsed = startedAt ? Math.max(0, (finishedAt ?? now) - startedAt) : 0;
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="font-mono text-xl" aria-live="off">
      {minutes}:{seconds.toString().padStart(2, '0')}
    </div>
  );
}
