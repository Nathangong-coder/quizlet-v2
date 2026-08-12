'use client';

import React from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * The end screen for a quiz submitted with nothing answered, shown only after
 * `discardSkippedQuizAttempt` reported `discarded: true` — i.e. the server
 * agreed and the attempt, its StudySession and its QuizQuestion rows are gone.
 *
 * Deliberately vague: no score, no question list, no per-question detail.
 * There is nothing truthful to report. Every number the results screen shows
 * describes a row that no longer exists, and a "0%" here would read as a
 * result the learner earned rather than a sitting that never happened.
 */
export function QuizSkippedNotice({ setId }: { setId: string }) {
  return (
    <div className="max-w-md mx-auto py-20 text-center space-y-6">
      <div className="bg-muted/40 p-6 rounded-xl border">
        <h2 className="text-2xl font-bold mb-2">Quiz Skipped</h2>
        <p className="text-muted-foreground">
          No answers were recorded, so nothing was saved to your history.
        </p>
      </div>
      <Link href={`/sets/${setId}`} className={buttonVariants({ variant: 'outline' })}>
        Back to Set
      </Link>
    </div>
  );
}
