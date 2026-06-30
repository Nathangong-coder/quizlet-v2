/**
 * Shuffles an array of options.
 * If a seed is provided, the shuffle is deterministic.
 */
export function shuffleOptions(options: string[], seed?: string): string[] {
  const shuffled = [...options];
  if (!seed) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Deterministic shuffle using a simple seed-based RNG
  let seedNum = 0;
  for (let i = 0; i < seed.length; i++) {
    seedNum = (seedNum << 5) - seedNum + seed.charCodeAt(i);
    seedNum |= 0;
  }

  const random = () => {
    seedNum = (seedNum * 16807) % 2147483647;
    return (seedNum - 1) / 2147483646;
  };

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Scores a multiple-choice answer.
 */
export function scoreMultipleChoice(selected: string | null | undefined, correct: string): boolean {
  if (!selected) return false;
  return selected.trim().toLowerCase() === correct.trim().toLowerCase();
}

/**
 * Scores a True/False answer.
 */
export function scoreTrueFalse(selected: string | null | undefined, correct: boolean): boolean {
  if (!selected) return false;
  const normalized = selected.trim().toLowerCase();
  return (normalized === 'true' && correct) || (normalized === 'false' && !correct);
}

/**
 * Calculates the overall quiz score as an average of individual scores.
 */
export function overallQuizScore(results: { score: number | null }[]): number | null {
  const scored = results.filter(r => r.score !== null);
  if (scored.length === 0) return null;

  const total = scored.reduce((sum, r) => sum + (r.score || 0), 0);
  return total / scored.length;
}
