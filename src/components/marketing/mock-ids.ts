/**
 * The ids of every drawn panel in `mocks.tsx`, kept apart from the panels so
 * the feature registry (plain data) can name a mock without importing React
 * markup, and so a test can check every reference resolves.
 */
export const MOCK_IDS = [
  // shared, moved from the original showcase
  'short-answer',
  'key-points',
  'concept-tree',
  'insights',
  'memory',
  'diagnostic',
  // flashcards
  'carousel',
  'terms-list',
  'fork',
  // learn
  'lesson',
  'lesson-loop',
  // study guides
  'guide',
  'guide-print',
  // postmortems
  'postmortem',
  'postmortem-trail',
  'note',
  // test
  'quiz-setup',
  'distractors',
  // review
  'review-card',
  'review-queue',
  'memory-history',
  // games
  'games-hub',
  'gauntlet',
  'hot-seat',
  'blitz',
  'match',
] as const

export type MockId = (typeof MOCK_IDS)[number]
