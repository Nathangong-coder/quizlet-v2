/** How each session kind is named in the UI. Never "Multiple Choice". */
export const ACTIVITY_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  matching: 'Matching Game',
  confidence: 'Confidence Ranking',
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABELS[kind] ?? 'Study session';
}

/** "8m 42s", or an em dash when the activity predates timing. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
