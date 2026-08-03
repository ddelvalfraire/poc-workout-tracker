import { ImageResponse } from 'next/og'
import type { ReactElement, ReactNode } from 'react'

/**
 * Shared chrome for the /api/cards/* share images — canvas size, palette,
 * frame, and wordmark live here so the three cards read as one brand.
 *
 * Satori (ImageResponse's renderer) can't resolve CSS custom properties, so
 * the app's committed dark tokens (src/app/globals.css `:root`) are hardcoded
 * as resolved hex:
 *   --background        oklch(0.145 0 0)    → #0a0a0a
 *   --foreground        oklch(0.97 0 0)     → #f5f5f5
 *   --muted-foreground  oklch(0.72 0 0)     → #a4a4a4
 *   --primary (volt)    oklch(0.86 0.19 128) → #ade74e
 */

/** OG-standard card canvas (PRD: 1200×630 v1; square IG variant later). */
export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

export const CARD_COLORS = {
  background: '#0a0a0a',
  foreground: '#f5f5f5',
  muted: '#a4a4a4',
  volt: '#ade74e',
} as const

/** The display-type style shared by every card headline (font-display
 *  uppercase aesthetic — satori has no Oswald, so weight + tracking carry it). */
export const HEADLINE_STYLE = {
  fontWeight: 800,
  textTransform: 'uppercase' as const,
  letterSpacing: -1,
  lineHeight: 1.05,
  color: CARD_COLORS.foreground,
}

interface CardFrameProps {
  /** The card's category line ("Trophy", "Personal Record", "Progress"). */
  eyebrow: string
  children: ReactNode
}

/**
 * The shared card skeleton: volt top strip, eyebrow, a vertically-centered
 * content well, and the app wordmark pinned to the bottom.
 */
export function CardFrame({ eyebrow, children }: CardFrameProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: CARD_COLORS.background,
        color: CARD_COLORS.foreground,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', width: '100%', height: 14, background: CARD_COLORS.volt }} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          padding: '52px 72px 44px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: 7,
            textTransform: 'uppercase',
            color: CARD_COLORS.volt,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            justifyContent: 'center',
          }}
        >
          {children}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: CARD_COLORS.muted,
          }}
        >
          Workout Tracker
        </div>
      </div>
    </div>
  )
}

/**
 * Renders a card element to the 1200×630 PNG response. `private, no-store`:
 * these images are the CURRENT user's data behind auth — no shared cache may
 * ever hold one (the share flow ships the file, never this URL).
 */
export function cardImage(element: ReactElement): ImageResponse {
  return new ImageResponse(element, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    headers: { 'cache-control': 'private, no-store' },
  })
}
