'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';

/**
 * Imperative handle every quiz section exposes to the QuizContainer.
 * Nothing is graded while the user navigates — the container's single
 * "Submit Overall Quiz" button calls `commitAll` on each section, which
 * persists/grades every answered question exactly once.
 */
export interface QuizSectionHandle {
  commitAll: () => Promise<void>;
  /** How many questions the learner actually answered, in this section's own
   *  terms. The INTENT signal for a skipped quiz — never a deletion authority
   *  on its own; the server re-checks. See `discardSkippedQuizAttempt`. */
  answeredCount: () => number;
}

/**
 * Shared carousel navigation (Prev / progress / Next) used by every
 * one-question-at-a-time quiz section.
 */
export function SectionNav({
  index,
  total,
  answeredCount,
  onPrev,
  onNext,
  busy = false,
}: {
  index: number;
  total: number;
  answeredCount: number;
  onPrev: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={index === 0 || busy}
      >
        <ChevronLeft className="w-4 h-4 mr-1" /> Prev
      </Button>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        Question {index + 1} of {total}
        <span className="inline-flex items-center gap-1 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          {answeredCount}/{total}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={index >= total - 1 || busy}
      >
        Next <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
}
