'use client';

import { useState, useEffect } from 'react';

interface MatchTimerProps {
  startedAt: number | null;
  finishedAt: number | null;
}

export function MatchTimer({ startedAt, finishedAt }: MatchTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (finishedAt) {
      setElapsed(finishedAt - (startedAt ?? finishedAt));
      return;
    }

    if (!startedAt) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);

    return () => clearInterval(interval);
  }, [startedAt, finishedAt]);

  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="text-xl font-mono">
      {minutes}:{seconds.toString().padStart(2, '0')}
    </div>
  );
}
