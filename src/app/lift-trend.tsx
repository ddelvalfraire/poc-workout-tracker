import Link from 'next/link'
import { getLiftTrend } from '@/db/home-lift-trend'
import { getWeightUnit } from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'
import { liftTrendPolyline } from '@/lib/home/lift-trend'
import type { HomeSectionExerciseRef } from '@/lib/home/layout'
import type { HomeSectionShape } from '@/lib/home/registry'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** The curve's own coordinate space — a viewBox, not pixels, so one drawing
 *  stretches to whatever width the shape gives it. */
const VIEW_W = 100
const VIEW_H = 34

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections.
 *
 *  Keyed on the PINNED REF'S PARTS rather than the ref object: `cache` keys by
 *  argument identity, and two equal `{source, wgerExerciseId}` objects are two
 *  different keys — which would read the trend twice and, worse, let the grid
 *  and the component disagree.
 */
export const liftTrendContent = cache(
  async (
    userId: string,
    nowMs: number,
    source: HomeSectionExerciseRef['source'] | null,
    wgerExerciseId: number | null,
  ) => {
    const [trend, unit] = await Promise.all([
      getLiftTrend(userId, nowMs, source, wgerExerciseId),
      getWeightUnit(userId),
    ])
    return trend === null ? null : { trend, unit }
  },
)

/**
 * One lift's estimated-1RM curve, with a dot on every session that beat
 * everything before it.
 *
 * The lift comes from the section's own config when someone has pinned one,
 * and otherwise from what they actually train most — so the widget is useful
 * on a home nobody has customized. It is the one repeatable kind: two
 * instances charting two lifts is exactly why sections carry ids.
 *
 * Drawn as inline SVG on the server. The app's Recharts trend chart is a
 * client island, and home is the surface that must not pay for a charting
 * bundle to draw a line 34 units tall.
 *
 * Silent when there is no lift to chart or fewer than two scored sessions —
 * a curve through one point is a fabrication.
 */
export async function LiftTrend({
  userId,
  nowMs,
  shape,
  pinned,
}: {
  userId: string
  nowMs: number
  shape: HomeSectionShape
  pinned?: HomeSectionExerciseRef
}) {
  const t = await getTranslations('LiftTrend')
  const content = await liftTrendContent(
    userId,
    nowMs,
    pinned?.source ?? null,
    pinned?.wgerExerciseId ?? null,
  )
  if (content === null) return null
  const { trend, unit } = content

  const latest = kgToDisplay(trend.latestE1rmKg, unit)
  const delta = trend.deltaKg === null ? null : kgToDisplay(trend.deltaKg, unit)
  const line = liftTrendPolyline(trend.vertices, VIEW_W, VIEW_H)
  const prDots = trend.vertices.filter((v) => v.pr)

  return (
    <Link
      href={`/exercises/${trend.source}/${trend.wgerExerciseId}`}
      className="flex h-full flex-col transition-colors active:bg-muted/60"
    >
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>

      <span className="mt-2 flex flex-col">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[2.6rem] font-semibold leading-[0.82] tnum">
            {latest.toFixed(1)}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">{unit}</span>
        </span>
        <span className="mt-1.5 block text-[0.7rem] text-muted-foreground">
          {t('caption', { name: trend.exerciseName })}
        </span>
      </span>

      {/* The curve takes the leftover height, so it grows with the shape
          instead of needing a size per shape. The padding is what keeps a
          marker sitting on the very top or bottom of the range from being
          clipped in half — the geometry itself runs edge to edge. */}
      <span className="mt-auto block px-[3px] py-[4px] pt-2">
        <span
          role="img"
          aria-label={t('chartLabel', {
            name: trend.exerciseName,
            count: trend.vertices.length,
          })}
          className="relative block h-8 w-full"
        >
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-0 block size-full"
          >
            <polyline
              points={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              // The box is stretched non-uniformly to fill the cell; without
              // this the stroke would be stretched with it.
              vectorEffect="non-scaling-stroke"
              className="text-muted-foreground"
            />
          </svg>
          {/* The one volt moment this cell spends: the records themselves.
              Positioned in CSS off the same unit vertices the line is drawn
              from — an SVG circle would be squashed into an ellipse by the
              same non-uniform stretch the line needs. */}
          {prDots.map((vertex, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{ left: `${vertex.x * 100}%`, top: `${vertex.y * 100}%` }}
              className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            />
          ))}
        </span>
      </span>

      {/* Only the taller shapes have room for the verdict under the curve. */}
      {shape !== 'wide' && (
        <span className="mt-1.5 block text-[0.7rem] tnum">
          {trend.isNewBest ? (
            <span className="text-primary">{t('newBest')}</span>
          ) : delta === null ? (
            <span className="text-muted-foreground">{t('steady')}</span>
          ) : (
            <span className="text-muted-foreground">
              {t('since', {
                delta: `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`,
                unit,
              })}
            </span>
          )}
        </span>
      )}
    </Link>
  )
}
