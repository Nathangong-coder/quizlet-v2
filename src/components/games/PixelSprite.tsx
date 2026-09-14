import { PALETTE, compose, type Sprite } from '@/lib/games/sprites'
import { cn } from '@/lib/utils'

/**
 * Renders a text sprite as crisp SVG rects. Runs of the same colour on a row
 * are merged into one rect, so a 18×18 sprite is ~60 elements, not 324.
 */
export function PixelSprite({
  sprite,
  overlays = [],
  size = 96,
  className,
  label,
  flip = false,
}: {
  sprite: Sprite
  overlays?: (Sprite | null | undefined)[]
  size?: number
  className?: string
  /** Accessible name; decorative when omitted. */
  label?: string
  flip?: boolean
}) {
  const rows = compose(sprite, ...overlays)
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const rects: { x: number; y: number; len: number; fill: string }[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.' || ch === ' ') { x++; continue }
      let len = 1
      while (x + len < row.length && row[x + len] === ch) len++
      rects.push({ x, y, len, fill: PALETTE[ch] ?? '#ff00ff' })
      x += len
    }
  })
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      shapeRendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('block', className)}
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.len} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}
