import { ImageResponse } from 'next/og'

/**
 * The 180×180 touch icon, generated from the mark. `icon.svg` beside it is
 * the favicon for every modern browser; this covers iOS home screens and
 * the sizes that need a raster. No PNG asset to keep in sync.
 */
export const runtime = 'nodejs'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#4255ff', borderRadius: 40 }}>
        <svg width="120" height="150" viewBox="0 0 120 150">
          <line x1="30" y1="25" x2="90" y2="25" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
          <line x1="30" y1="25" x2="30" y2="70" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
          <line x1="30" y1="70" x2="90" y2="70" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
          <line x1="90" y1="70" x2="90" y2="115" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
          <line x1="30" y1="115" x2="90" y2="115" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
          <circle cx="30" cy="25" r="12" fill="#fff" />
          <circle cx="90" cy="25" r="8" fill="#fff" />
          <circle cx="30" cy="70" r="8" fill="#fff" />
          <circle cx="90" cy="70" r="12" fill="#fff" />
          <circle cx="30" cy="115" r="12" fill="#fff" />
          <circle cx="90" cy="115" r="8" fill="#fff" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
