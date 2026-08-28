import { cn } from '@/lib/utils'
import { resolveAvatar } from '@/lib/users/avatar'

/**
 * A user's mark: their uploaded photo, their OAuth picture, or a generated
 * constellation.
 *
 * Server-safe — no `'use client'`. It is an `<img>` or pure geometry, with no
 * interaction of its own; the things that WRAP it (the topbar trigger, the
 * change-photo button) are the interactive parts.
 *
 * Deliberately a plain `<img>` rather than `next/image`. The source is a blob
 * URL on a host that is not in `next.config`'s remote patterns, and adding a
 * wildcard remote pattern to optimise a 32px circle would widen what the image
 * proxy will fetch on request — a worse trade than one unoptimised thumbnail.
 */
export function AvatarMark({
  avatarUrl,
  image,
  seed,
  name,
  size = 32,
  className,
}: {
  avatarUrl?: string | null
  image?: string | null
  seed: string
  /** For the alt text. Falls back to a generic label rather than an empty one. */
  name?: string | null
  size?: number
  className?: string
}) {
  const resolved = resolveAvatar({ avatarUrl, image, seed })
  const label = name ? `${name}'s picture` : 'Your picture'

  if (resolved.kind === 'url') {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Deliberate; see
      // the note above. `next/image` would need a wildcard remote pattern for
      // the blob host, which widens what the image proxy will fetch on request
      // — a worse trade than one unoptimised 32px thumbnail.
      <img
        src={resolved.url}
        alt={label}
        width={size}
        height={size}
        className={cn('rounded-full object-cover bg-muted', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  const { nodes, hue } = resolved.glyph
  // One hue, two lightnesses: the ink has to stay legible against its own
  // ground in both themes, so the pair is derived rather than themed.
  const ink = `oklch(0.55 0.15 ${hue})`
  const ground = `oklch(0.93 0.045 ${hue})`

  return (
    <svg
      viewBox="-14 -14 128 128"
      width={size}
      height={size}
      className={cn('rounded-full', className)}
      style={{ width: size, height: size, background: ground }}
      role="img"
      aria-label={label}
    >
      {/* Edges first so nodes sit on top. Consecutive only — connecting every
          pair turns a 5-node glyph into a scribble at 32px. */}
      {nodes.slice(1).map((n, i) => (
        <line
          key={`e${i}`}
          x1={nodes[i].x * 100}
          y1={nodes[i].y * 100}
          x2={n.x * 100}
          y2={n.y * 100}
          stroke={ink}
          strokeOpacity={0.35}
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={`n${i}`}
          cx={n.x * 100}
          cy={n.y * 100}
          r={n.r * 100}
          fill={ink}
          fillOpacity={[0.95, 0.65, 0.8][i % 3]}
        />
      ))}
    </svg>
  )
}
