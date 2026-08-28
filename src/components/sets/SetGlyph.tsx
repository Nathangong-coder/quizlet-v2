import { cn } from '@/lib/utils'
import { buildGlyph } from '@/lib/sets/glyph'

/**
 * A set's mark — the one piece of the "Atlas" spatial language Phase 0 ships
 * (design §2, §6.3). A small node-and-edge cluster derived from the set's id
 * and its category count, standing in for a stock icon.
 *
 * Server-safe (no `'use client'`): it is pure geometry with no interaction.
 *
 * `aria-hidden`, and deliberately so. It carries no information a screen
 * reader could use that the title and card count next to it do not already
 * state; announcing it would be noise, not access.
 *
 * Colour is `currentColor` throughout, so the caller sets it once on the
 * wrapper (`text-primary/70`) and it follows the theme in both light and dark
 * without this file knowing anything about tokens.
 */
export function SetGlyph({
  setId,
  categoryCount,
  className,
}: {
  setId: string
  categoryCount: number
  className?: string
}) {
  const nodes = buildGlyph(setId, categoryCount)

  return (
    <svg
      // Padded viewBox, NOT `0 0 100 100`. `buildGlyph` clamps node CENTRES to
      // the unit box, so a node sitting at the edge would have half its radius
      // cropped by a tight viewBox. The padding is the node radius cap (~10)
      // with room to spare.
      viewBox="-14 -14 128 128"
      className={cn('block', className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* Edges first so the nodes sit on top of them. Consecutive only — an
          open path reads as a trail through a territory; connecting every
          pair turns a 7-node glyph into a scribble. */}
      {nodes.slice(1).map((n, i) => {
        const prev = nodes[i]
        return (
          <line
            key={`e${i}`}
            x1={prev.x * 100}
            y1={prev.y * 100}
            x2={n.x * 100}
            y2={n.y * 100}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )
      })}
      {nodes.map((n, i) => (
        <circle
          key={`n${i}`}
          cx={n.x * 100}
          cy={n.y * 100}
          r={n.r * 100}
          fill="currentColor"
          // Varied by position, not randomly: a fixed cycle keeps the mark
          // deterministic alongside the geometry, and gives the cluster depth
          // instead of reading as a flat row of identical dots.
          fillOpacity={[0.9, 0.6, 0.75][i % 3]}
        />
      ))}
    </svg>
  )
}
