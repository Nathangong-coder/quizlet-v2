import { ImageResponse } from 'next/og'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'

/**
 * The social preview, generated at build from the mark — no PNG to keep in
 * sync with the SVG, nothing to compress. Same geometry as
 * `SynapseLogo`, drawn at poster scale.
 */
export const runtime = 'nodejs'
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INDIGO = '#4255ff'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px 88px',
          background: 'linear-gradient(135deg, #0f1020 0%, #1e1b4b 100%)',
          color: '#ffffff',
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <svg width="120" height="150" viewBox="0 0 120 150">
            <line x1="30" y1="25" x2="90" y2="25" stroke={INDIGO} strokeWidth="6" strokeLinecap="round" />
            <line x1="30" y1="25" x2="30" y2="70" stroke={INDIGO} strokeWidth="6" strokeLinecap="round" />
            <line x1="30" y1="70" x2="90" y2="70" stroke={INDIGO} strokeWidth="6" strokeLinecap="round" />
            <line x1="90" y1="70" x2="90" y2="115" stroke={INDIGO} strokeWidth="6" strokeLinecap="round" />
            <line x1="30" y1="115" x2="90" y2="115" stroke={INDIGO} strokeWidth="6" strokeLinecap="round" />
            <circle cx="30" cy="25" r="12" fill={INDIGO} />
            <circle cx="90" cy="25" r="8" fill={INDIGO} />
            <circle cx="30" cy="70" r="8" fill={INDIGO} />
            <circle cx="90" cy="70" r="12" fill={INDIGO} />
            <circle cx="30" cy="115" r="12" fill={INDIGO} />
            <circle cx="90" cy="115" r="8" fill={INDIGO} />
          </svg>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>
            synapse<span style={{ color: INDIGO }}>HQ</span>
          </div>
        </div>
        <div style={{ marginTop: 40, fontSize: 46, fontWeight: 700, lineHeight: 1.15, maxWidth: 980 }}>{SITE_TAGLINE}</div>
        <div style={{ marginTop: 22, fontSize: 28, color: '#c7cbe6', maxWidth: 980 }}>
          Flashcards, written tests read point by point, study groups and games — with a memory that only moves when you earn it.
        </div>
      </div>
    ),
    { ...size },
  )
}
