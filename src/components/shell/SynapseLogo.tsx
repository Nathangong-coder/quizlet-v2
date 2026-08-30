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
 * theme token like every other piece of type in the shell. The mark uses the
 * same indigo accent as actions instead of a gradient, keeping the shell calm.
 *
 * The `id` prop remains part of the API so copies in the rail and drawer can
 * keep their own accessible instances without changing callers.
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
  /** Keeps multiple logo instances distinguishable in the rendered markup. */
  id?: string
}) {
  return (
    <svg
      viewBox={withWordmark ? '0 0 640 200' : '0 0 160 200'}
      className={className}
      data-logo-id={id}
      role="img"
      aria-label="synapseHQ"
    >
      {/* Icon: synapse / node network forming an abstract "S" */}
      <g transform="translate(30,30)">
        <line x1="30" y1="25" x2="90" y2="25" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        <line x1="30" y1="25" x2="30" y2="70" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        <line x1="30" y1="70" x2="90" y2="70" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        <line x1="90" y1="70" x2="90" y2="115" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        <line x1="30" y1="115" x2="90" y2="115" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        <line x1="60" y1="47" x2="30" y2="70" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <line x1="60" y1="92" x2="90" y2="70" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" opacity="0.6" />

        <circle cx="30" cy="25" r="10" fill="var(--primary)" />
        <circle cx="90" cy="25" r="7" fill="var(--primary)" />
        <circle cx="30" cy="70" r="7" fill="var(--primary)" />
        <circle cx="90" cy="70" r="10" fill="var(--primary)" />
        <circle cx="30" cy="115" r="10" fill="var(--primary)" />
        <circle cx="90" cy="115" r="7" fill="var(--primary)" />
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
            fontFamily="var(--font-nunito-sans), 'Segoe UI', Arial, sans-serif"
            fontSize="58"
            fontWeight="700"
            fill="currentColor"
          >
            synapse
            <tspan fill="var(--primary)">HQ</tspan>
          </text>
          <text
            x="177"
            y="150"
            fontFamily="var(--font-nunito-sans), 'Segoe UI', Arial, sans-serif"
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
