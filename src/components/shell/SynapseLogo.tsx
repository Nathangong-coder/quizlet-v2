/**
 * The synapseHQ wordmark.
 *
 * INLINE SVG, not `<img src="/synapseHQ_logo.svg">`, and the reason is dark
 * mode. The source file (`public/synapseHQ_logo.svg`, kept verbatim for the
 * favicon and for anyone who needs the asset itself) paints "synapse" in
 * `#1E1B4B` — a near-black navy that is correct on a white page and effectively
 * invisible on this app's dark background. An `<img>` cannot be restyled from
 * outside, so the wordmark would have had to be either a permanent light-mode
 * artefact or a second exported file that drifts from the first.
 *
 * Inlining costs ~1KB and buys `currentColor` on the word, which follows the
 * theme token like every other piece of type in the shell. The MARK keeps its
 * literal gradient: violet-to-cyan reads on both grounds, and it is the part
 * that carries the brand.
 *
 * `gradient ids are suffixed per instance`: two copies of this component on one
 * page (the rail and the mobile drawer both render it) would otherwise define
 * `#nodeGrad` twice, and an SVG `url(#id)` reference resolves to the FIRST
 * match in the document — so unmounting the rail would silently strip the
 * drawer's fill.
 */
export function SynapseLogo({
  className,
  withWordmark = true,
  id = 'default',
}: {
  className?: string
  /**
   * The mark alone, for tight spaces. The wordmark half is what needs the
   * width; the constellation stays legible at any size.
   */
  withWordmark?: boolean
  /** Disambiguates the gradient ids when several instances share a page. */
  id?: string
}) {
  const nodeGrad = `synapse-node-${id}`
  const lineGrad = `synapse-line-${id}`

  return (
    <svg
      viewBox={withWordmark ? '0 0 640 200' : '0 0 160 200'}
      className={className}
      role="img"
      aria-label="synapseHQ"
    >
      <defs>
        <linearGradient id={nodeGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7C5CFC" />
          <stop offset="100%" stopColor="#33C6F4" />
        </linearGradient>
        <linearGradient id={lineGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9B7BFF" />
          <stop offset="100%" stopColor="#4FD3F0" />
        </linearGradient>
      </defs>

      {/* Icon: synapse / node network forming an abstract "S" */}
      <g transform="translate(30,30)">
        <line x1="30" y1="25" x2="90" y2="25" stroke={`url(#${lineGrad})`} strokeWidth="4" strokeLinecap="round" />
        <line x1="30" y1="25" x2="30" y2="70" stroke={`url(#${lineGrad})`} strokeWidth="4" strokeLinecap="round" />
        <line x1="30" y1="70" x2="90" y2="70" stroke={`url(#${lineGrad})`} strokeWidth="4" strokeLinecap="round" />
        <line x1="90" y1="70" x2="90" y2="115" stroke={`url(#${lineGrad})`} strokeWidth="4" strokeLinecap="round" />
        <line x1="30" y1="115" x2="90" y2="115" stroke={`url(#${lineGrad})`} strokeWidth="4" strokeLinecap="round" />
        <line x1="60" y1="47" x2="30" y2="70" stroke={`url(#${lineGrad})`} strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <line x1="60" y1="92" x2="90" y2="70" stroke={`url(#${lineGrad})`} strokeWidth="3" strokeLinecap="round" opacity="0.6" />

        <circle cx="30" cy="25" r="10" fill={`url(#${nodeGrad})`} />
        <circle cx="90" cy="25" r="7" fill={`url(#${nodeGrad})`} />
        <circle cx="30" cy="70" r="7" fill={`url(#${nodeGrad})`} />
        <circle cx="90" cy="70" r="10" fill={`url(#${nodeGrad})`} />
        <circle cx="30" cy="115" r="10" fill={`url(#${nodeGrad})`} />
        <circle cx="90" cy="115" r="7" fill={`url(#${nodeGrad})`} />
      </g>

      {withWordmark && (
        <>
          {/*
            `currentColor`, not the file's `#1E1B4B` — see this module's note.
            "HQ" keeps the brand violet, which is legible on both grounds and is
            the one accent the wordmark actually needs.
          */}
          <text
            x="175"
            y="120"
            fontFamily="var(--font-plex-sans), 'Segoe UI', Arial, sans-serif"
            fontSize="58"
            fontWeight="700"
            fill="currentColor"
          >
            synapse
            <tspan fill="#7C5CFC">HQ</tspan>
          </text>
          <text
            x="177"
            y="150"
            fontFamily="var(--font-plex-sans), 'Segoe UI', Arial, sans-serif"
            fontSize="17"
            fontWeight="500"
            letterSpacing="2"
            fill="currentColor"
            opacity="0.55"
          >
            STUDY SMARTER, TOGETHER
          </text>
        </>
      )}
    </svg>
  )
}
