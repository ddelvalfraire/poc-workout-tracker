import { ImageResponse } from 'next/og'

// Brand palette — kept consistent with manifest theme/background and viewport.themeColor.
const BRAND_BG = '#0a0a0a'
const GLYPH_COLOR = '#fafafa'
// Maskable icons must keep their glyph inside Android's ~80% safe area.
const MASKABLE_GLYPH_SCALE = 0.6
const DEFAULT_GLYPH_SCALE = 0.72

interface PwaIconOptions {
  maskable?: boolean
}

/**
 * Renders the app's branded icon (a bold "W" on the brand background) to a PNG
 * at request time. Used by the icon route handlers so no binary assets ship.
 */
export function renderPwaIcon(size: number, opts: PwaIconOptions = {}): ImageResponse {
  const glyphScale = opts.maskable ? MASKABLE_GLYPH_SCALE : DEFAULT_GLYPH_SCALE

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND_BG,
          color: GLYPH_COLOR,
          fontSize: size * glyphScale,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        W
      </div>
    ),
    { width: size, height: size },
  )
}
