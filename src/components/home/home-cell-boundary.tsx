'use client'

import { catchError, type ErrorInfo } from 'next/error'
import { useTranslations } from 'next-intl'

/**
 * ONE home cell's error state.
 *
 * Home's widgets are a dozen independent async RSCs, each reaching the
 * database on its own. Without a boundary between them the grid is a chain:
 * one failing read unwinds past every sibling to the route's error.tsx, and a
 * trophy query that times out costs you the whole home screen — hero, status,
 * everything. Per-cell, the same failure costs one tile.
 *
 * `catchError` rather than a hand-rolled class boundary, and the difference is
 * not style: `redirect()` and `notFound()` are implemented by THROWING special
 * errors, so a naive boundary here would catch a widget's redirect and render
 * this fallback instead of navigating. `catchError` passes those through.
 *
 * This is the failure state, and it is deliberately not the EMPTY state. A
 * widget with nothing to say is never packed a cell at all (see
 * renderHomeSections) — silence is a designed outcome, and rendering "didn't
 * load" over an account that simply has no trophies yet would invent a problem
 * that does not exist.
 */
/** The production error id, when there is one. Absent in dev, and absent on
 *  anything thrown that is not a Next-tagged error — so it is read defensively
 *  rather than asserted. */
function errorDigest(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return null
  const digest: unknown = error.digest
  return typeof digest === 'string' ? digest : null
}

function HomeCellFallback(_props: Record<never, never>, { error, retry }: ErrorInfo) {
  const t = useTranslations('HomeCellError')
  const digest = errorDigest(error)
  return (
    <div className="flex h-full flex-col">
      {/* The tile label voice, verbatim from the widgets — a failed cell
          should read as one of the grid's compartments, not as an alarm
          dropped into it. Muted, never the accent: DESIGN.md spends the one
          volt on what you can act on, and this is a tile that is missing. */}
      <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>
      <span className="mt-auto flex flex-col justify-end">
        {/* `retry()` re-fetches and re-renders the boundary's children, which
            is what a failed SERVER read needs — `reset()` only clears the
            error state and would render the same failure straight back. */}
        <button
          type="button"
          onClick={() => retry()}
          className="w-fit text-[0.7rem] font-medium text-foreground underline underline-offset-4 outline-none transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground"
        >
          {t('retry')}
        </button>
      </span>
      {/* The digest is the only thing that makes a support report actionable,
          and it is absent in dev — so it is rendered only when it exists
          rather than as an empty label. */}
      {digest !== null && (
        <span className="mt-1 text-[0.6rem] text-muted-foreground tnum">
          {t('errorRef', { digest })}
        </span>
      )}
    </div>
  )
}

export const HomeCellBoundary = catchError(HomeCellFallback)
