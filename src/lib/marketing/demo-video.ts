/**
 * The landing demo video's chapters. Timestamps are data, not markup:
 * re-cutting the video means editing this one array (and public/demo/chapters.vtt).
 */
export type DemoChapter = { start: number; title: string; caption: string; tryHref: string | null }

export const DEMO_CHAPTERS: readonly DemoChapter[] = [
  { start: 0, title: 'Built for finance interview prep', caption: 'Flashcards, written tests, games and study groups in one place', tryHref: '/demo' },
  { start: 9, title: '82 M&A questions, tagged', caption: 'Filter to must-know, technical or niche', tryHref: '/demo/set' },
  { start: 16, title: 'Build a written test', caption: 'Short answer, filtered by category', tryHref: '/demo/quiz' },
  { start: 21, title: 'Write the answer in your own words', caption: 'No multiple choice to lean on', tryHref: '/demo/quiz' },
  { start: 29, title: 'Graded point by point', caption: 'Each key idea marked covered, partial or missed', tryHref: '/demo/quiz' },
  { start: 37, title: 'Scored on clarity, concision and correctness', caption: 'Plus one targeted fix for next time', tryHref: '/demo/quiz' },
  { start: 46, title: 'Confidence from 1 to 10', caption: 'Cards you miss come back until you know them', tryHref: '/demo/review' },
  { start: 50, title: 'Games built from your set', caption: 'Gauntlet, Hot Seat, Blitz, Crossword and Match', tryHref: '/demo/games' },
]

/** Index of the chapter playing at `seconds`. */
export function chapterAt(seconds: number): number {
  let active = 0
  DEMO_CHAPTERS.forEach((c, i) => { if (seconds >= c.start) active = i })
  return active
}

/** "Try it" links are shown only when the guest demo is switched on. */
export function isDemoLinkEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_DEMO_ENABLED === 'true'
}
