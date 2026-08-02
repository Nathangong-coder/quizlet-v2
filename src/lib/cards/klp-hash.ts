import { createHash } from 'node:crypto'

/**
 * The parts of a content block that change a card's meaning. `id` and any
 * client-side React key are deliberately excluded — they churn on every render
 * and would make the hash change when nothing did.
 */
export interface HashableBlock {
  side: string
  type: string
  text?: string | null
  assetId?: string | null
  position: number
}

/**
 * Stable fingerprint of everything a card teaches.
 *
 * This is the ONLY trigger for KLP re-extraction, which makes both failure
 * directions expensive: a hash that changes spuriously burns a batch of AI
 * calls and supersedes good KLPs on every save, and one that misses a real
 * edit leaves the card being tested against stale propositions forever.
 *
 * Fields are length-prefixed rather than concatenated so a boundary shift
 * (term "AB" + definition "C" vs "A" + "BC") cannot collide.
 */
export function klpSourceHash(input: {
  term: string
  definition: string
  blocks?: HashableBlock[]
}): string {
  const parts: string[] = [field(input.term), field(input.definition)]

  const blocks = [...(input.blocks ?? [])].sort(
    (a, b) => a.side.localeCompare(b.side) || a.position - b.position,
  )
  for (const b of blocks) {
    parts.push(field(b.side), field(b.type), field(b.text ?? ''), field(b.assetId ?? ''))
  }

  return createHash('sha256').update(parts.join('')).digest('hex')
}

function field(value: string): string {
  return `${value.length}:${value}`
}
