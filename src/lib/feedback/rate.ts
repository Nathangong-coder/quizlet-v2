/**
 * How often one account may send feedback.
 *
 * Counted from the user's own `Feedback` rows rather than from a token bucket
 * or a cache: the rows already exist, they are already indexed on
 * `[userId, createdAt]`, and a serverless deployment has nowhere to keep an
 * in-memory counter that every instance would agree on. The same argument the
 * AI key pool makes for LRU-over-a-counter applies here.
 */

/** Messages per account per hour. */
export const FEEDBACK_MAX_PER_HOUR = 5

export const FEEDBACK_WINDOW_MS = 60 * 60 * 1000

/**
 * `recentCount` is how many rows this user already has inside the window.
 *
 * STRICTLY LESS THAN, so the fifth message is allowed and the sixth is not.
 * `<=` here would silently make the limit six while every message in the UI
 * said five — the classic off-by-one that no one notices because both numbers
 * look reasonable.
 */
export function withinFeedbackRate(recentCount: number): boolean {
  return recentCount < FEEDBACK_MAX_PER_HOUR
}

/** The cutoff to count from. Injectable clock so the rule is testable. */
export function feedbackWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - FEEDBACK_WINDOW_MS)
}
