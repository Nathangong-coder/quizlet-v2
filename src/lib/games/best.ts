/**
 * Best scores live in the browser only — `localStorage['games:<game>:<setId>']`.
 * Games write no history, and a best score is the one number worth keeping;
 * it stays on the device that earned it. Every access is try/catch: private
 * windows and cleared site data must degrade to "no best", never to a throw.
 */
export function bestKey(game: string, setId: string): string {
  return `games:${game}:${setId}`
}

export function readBest<T>(game: string, setId: string): T | null {
  try {
    const raw = window.localStorage.getItem(bestKey(game, setId))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeBest<T>(game: string, setId: string, value: T): void {
  try {
    window.localStorage.setItem(bestKey(game, setId), JSON.stringify(value))
  } catch {
    // Nothing to do: the game still plays.
  }
}

/** Keep the higher of two numeric bests (or the lower, for times). */
export function betterOf(current: number | null, candidate: number, higherIsBetter: boolean): number {
  if (current === null) return candidate
  return higherIsBetter ? Math.max(current, candidate) : Math.min(current, candidate)
}
