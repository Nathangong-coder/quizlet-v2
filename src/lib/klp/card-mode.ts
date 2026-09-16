/**
 * CARD MODE (2026-09-15) — what kind of thing a card asks for, derived from
 * the writer's question type and the shape of its points. The owner's
 * distinction: a scenario card ("how would you position this soap company
 * for sale?") is a SKILL exercised on a case, not knowledge to memorise, and
 * its specifics (US manufacturing base, DTC business) must not become topic
 * nodes. Four modes, each with a minting consequence:
 *
 *   knowledge    define / why / compare / enumerate — the points ARE concepts;
 *                they mint leaves.
 *   calculation  calculate, or a scenario whose points are mostly quantitative
 *                — the anchor is the test, the points are its inputs and steps.
 *   procedure    walkthrough — an ordered chain; a step is a node only when
 *                another card also names it.
 *   applied      scenario on a case — ONE skill node (the anchor); the points
 *                link to it and to the general concepts they exercise, and
 *                never mint nodes of their own.
 *
 * `questionType` is the writer's label (`QUESTION_TYPES`); a card authored
 * before it was persisted has none and is read from its points alone.
 */
export const CARD_MODES = ['knowledge', 'calculation', 'procedure', 'applied'] as const
export type CardMode = (typeof CARD_MODES)[number]

/** What a node minted by a card of this mode is, for `Klt.nature`. */
export const NATURE_FOR_MODE: Record<CardMode, 'concept' | 'skill' | 'calculation'> = {
  knowledge: 'concept',
  calculation: 'calculation',
  procedure: 'concept',
  applied: 'skill',
}

export interface ModeInput {
  questionType?: string | null
  /** `CardKlp.kind` of each point. */
  kinds: string[]
}

export function cardMode(input: ModeInput): CardMode {
  const kinds = input.kinds
  const share = (k: string) => (kinds.length ? kinds.filter((x) => x === k).length / kinds.length : 0)
  switch (input.questionType) {
    case 'calculate':
      return 'calculation'
    case 'walkthrough':
      return 'procedure'
    case 'scenario':
      // "here are numbers — what happens" is a calculation with a story on it
      return share('quantitative') >= 0.5 ? 'calculation' : 'applied'
    case 'define':
    case 'why':
    case 'compare':
    case 'enumerate':
      return 'knowledge'
    default:
      break
  }
  // No label: read the points. Mostly quantitative → calculation; mostly
  // examples about one case → applied; otherwise knowledge.
  if (share('quantitative') >= 0.5) return 'calculation'
  if (share('example') >= 0.5) return 'applied'
  return 'knowledge'
}

/** One line for the minter, so the prompt knows what kind of card it is reading. */
export function modeInstruction(mode: CardMode): string {
  switch (mode) {
    case 'applied':
      return 'THIS CARD IS A WORKED EXAMPLE (a skill applied to one case). The anchor is the SKILL it exercises (e.g. "positioning a company for sale"). Each leaf is the GENERAL concept a point illustrates (e.g. "strategic buyer", "vertical integration", "pricing power", "supply chain resilience") — never the case\'s own fact (the company\'s channels, its factory, its brand tier). File each point under the general concept it illustrates: every leaf still carries the klpRefs of the points it files (a leaf with no points is not allowed), and the usual limit of 10 leaves holds — prefer one general leaf per point over sub-leaves.'
    case 'calculation':
      return 'THIS CARD IS A CALCULATION. The anchor is the test or formula; the leaves are its inputs and outputs; the steps are `precedes` edges in order.'
    case 'procedure':
      return 'THIS CARD IS A WALKTHROUGH. The anchor is the procedure; each step is a leaf under it in order, joined by `precedes` edges; a step that is itself a known concept keeps that concept\'s name.'
    case 'knowledge':
      return 'THIS CARD IS KNOWLEDGE. Its points are concepts; mint them as leaves under the anchor as usual.'
  }
}
