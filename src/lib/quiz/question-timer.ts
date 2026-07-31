export interface QuestionTimer {
  start(cardId: string): void;
  elapsed(cardId: string): number | undefined;
}

/**
 * Per-question wall-clock timing, keyed by cardId.
 *
 * Keyed rather than a single "current question started at" value because
 * quiz sections are a one-question-at-a-time carousel (see section.tsx) but
 * answers accumulate client-side across questions and are only flushed in
 * one batched `commitAll()` call at final submit — a single timestamp would
 * get overwritten as the user navigates, and by submit time would only
 * reflect whichever question was visited last, billing the whole section's
 * elapsed time to it.
 *
 * `start` is first-write-wins so revisiting a question does not reset its
 * clock, and `elapsed` is non-destructive so a re-submit reports the same
 * figure rather than zero.
 *
 * A plain factory rather than a hook: the logic is what needs testing, and
 * this keeps it out of the repo's node-only test environment's way. The hook
 * below is a two-line ref wrapper with nothing to test.
 */
export function createQuestionTimer(now: () => number = Date.now): QuestionTimer {
  const startedAt: Record<string, number> = {};

  return {
    start(cardId: string) {
      if (startedAt[cardId] === undefined) startedAt[cardId] = now();
    },
    elapsed(cardId: string): number | undefined {
      const started = startedAt[cardId];
      return started === undefined ? undefined : now() - started;
    },
  };
}
