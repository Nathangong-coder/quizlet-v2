import { mulberry32, shuffle } from '@/lib/games/rng'
import type { ReviewCard } from './session'

/**
 * Review setup — which cards, which side first, in what order. Pure, so the
 * setup screen's count and the session's deck are the same function.
 *
 * Every filter reads memory the app already keeps on `CardProgress`: stars,
 * confidence, `dueAt`. "Due" follows `getDueCards`: a null `dueAt` is due now.
 */

export type ReviewSide = 'term' | 'definition' | 'mixed'
export type ReviewOrder = 'set' | 'shuffle' | 'weakest'

export interface ReviewSetup {
  starredOnly: boolean
  dueOnly: boolean
  /** Confidence 4 or under. */
  weakOnly: boolean
  categoryIds: string[]
  side: ReviewSide
  order: ReviewOrder
}

export const DEFAULT_REVIEW_SETUP: ReviewSetup = {
  starredOnly: false,
  dueOnly: false,
  weakOnly: false,
  categoryIds: [],
  side: 'term',
  order: 'set',
}

export const WEAK_CONFIDENCE = 4

export interface ReviewCardInput extends ReviewCard {
  starred?: boolean
  /** Epoch ms, or null for "due now" (never scheduled). */
  dueAt?: number | null
  categoryIds?: string[]
}

export function matchesSetup(card: ReviewCardInput, setup: ReviewSetup, now: number): boolean {
  if (setup.starredOnly && !card.starred) return false
  if (setup.weakOnly && card.confidence > WEAK_CONFIDENCE) return false
  if (setup.dueOnly && !(card.dueAt === null || card.dueAt === undefined || card.dueAt <= now)) return false
  if (setup.categoryIds.length > 0 && !(card.categoryIds ?? []).some((id) => setup.categoryIds.includes(id))) return false
  return true
}

/** The deck for a setup: filtered, then ordered. `seed` makes a shuffle reproducible. */
export function selectReviewCards(cards: readonly ReviewCardInput[], setup: ReviewSetup, now: number, seed = 1): ReviewCardInput[] {
  const kept = cards.filter((c) => matchesSetup(c, setup, now))
  if (setup.order === 'shuffle') return shuffle(kept, mulberry32(seed))
  if (setup.order === 'weakest') return [...kept].sort((a, b) => a.confidence - b.confidence)
  return kept
}

/** Counts for the setup screen's chips, each under the OTHER filters (a facet drops its own filter). */
export function setupCounts(cards: readonly ReviewCardInput[], setup: ReviewSetup, now: number): { all: number; starred: number; due: number; weak: number } {
  const under = (patch: Partial<ReviewSetup>) => cards.filter((c) => matchesSetup(c, { ...setup, ...patch }, now)).length
  return {
    all: under({}),
    starred: under({ starredOnly: true }),
    due: under({ dueOnly: true }),
    weak: under({ weakOnly: true }),
  }
}

/** Which side a card shows first under the setup; `mixed` alternates by position so a deck is half and half. */
export function sideFor(setup: ReviewSetup, index: number): 'term' | 'definition' {
  if (setup.side === 'mixed') return index % 2 === 0 ? 'term' : 'definition'
  return setup.side
}

/**
 * The clock, as a function: a server component takes "now" once per request
 * for the due filter without calling `Date.now` in its render body (the
 * react-compiler purity rule).
 */
export function nowMs(): number {
  return Date.now()
}
