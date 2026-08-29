import { ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth/auth'
import { getWeightUnit } from '@/db/preferences'
import { listBodyweightLogs } from '@/db/bodyweight'
import { listActiveGoals } from '@/db/goals'
import { listMeasurements } from '@/db/body-measurements'
import { listProgressPhotos, type ProgressPhoto } from '@/db/progress-photos'
import { createSignedUrls } from '@/lib/supabase-storage'
import { kgToDisplay, cmToDisplay, lengthUnitFor, type WeightUnit } from '@/lib/units'
import { bodyweightDeltaKg, trendWeightSeries } from '@/lib/body/bodyweight-trend'
import { TrendChart, type TrendPoint } from '@/components/charts/trend-chart'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/nav/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { BodyweightLogForm } from './log-form'
import { BodyweightEntryRow } from './entry-row'
import { MeasurementsSection } from './measurements-section'
import { PhotosSection } from './photos-section'
import type { PhotoEntry } from './photo-cell'
import { getTranslations } from 'next-intl/server'

// The delta window the trend hero reports against ("Trending down — 1.2 lb / 30d").
const DELTA_DAYS = 30
// Visible history rows before the rest collapses behind a disclosure.
const HISTORY_VISIBLE_ROWS = 5

/**
 * The one body-tracking surface: bodyweight (trend hero + chart + quick log
 * + capped history — status → visualization → input → history, the page's
 * zone order), tape measurements, and progress photos. The hero number is
 * the 7-day-EMA TREND weight, not the last reading — the scale's daily noise
 * is demoted to a context line and to faint dots on the chart (the Happy
 * Scale principle: trend over noise). /bodyweight permanently redirects
 * here. Server component — the interactive bits are small client islands.
 */
export default async function BodyPage() {
  const t = await getTranslations('Body')
  const userId = await requireUserId()
  const [unit, logs, measurements, photos, activeGoals] = await Promise.all([
    getWeightUnit(userId),
    listBodyweightLogs(userId),
    listMeasurements(userId),
    listProgressPhotos(userId),
    // One cheap indexed read (<= 20 rows) so an existing bodyweight goal can
    // draw its target as the chart's reference line — the same honesty as
    // /goals showing this chart against the same target.
    listActiveGoals(userId),
  ])
  const photoEntries = await buildPhotoEntries(photos)
  const lengthUnit = lengthUnitFor(unit)

  const current = logs[0] ?? null
  // Trend = time-decayed EMA over the same rows; the delta line reads the
  // TREND series so "Trending down" can't be one salty dinner.
  const trend = trendWeightSeries(logs)
  const trendNow = trend[0] ?? null
  const trendDeltaKg = bodyweightDeltaKg(trend, DELTA_DAYS)

  const bodyweightGoal = activeGoals.find(
    (goal) => goal.kind === 'bodyweight' && goal.achievedAt === null,
  )
  const targetKg =
    bodyweightGoal !== undefined && 'weightKg' in bodyweightGoal.target
      ? bodyweightGoal.target.weightKg
      : null

  // Chart reads chronologically, oldest → newest (logs arrive freshest
  // first); value = trend, raw = the honest reading behind it. Dates
  // pre-formatted and kg → display unit here, server-side.
  const chronologicalTrend = [...trend].reverse()
  const trendPoints: TrendPoint[] = [...logs].reverse().map((log, i) => ({
    label: formatWorkoutDate(log.weighedAt),
    value: kgToDisplay(chronologicalTrend[i]?.weightKg ?? log.weightKg, unit),
    raw: kgToDisplay(log.weightKg, unit),
  }))

  // Measurements cross the island boundary pre-formatted (dates, display
  // unit) plus the raw instant (epoch ms) for the island's delta window.
  const measurementEntries = measurements.map((m) => ({
    id: m.id,
    site: m.site,
    dateLabel: formatWorkoutDate(m.measuredAt),
    measuredAtMs: m.measuredAt.getTime(),
    value: cmToDisplay(m.valueCm, lengthUnit),
  }))

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* ── Bodyweight ─────────────────────────────────────────────── */}
        <section aria-label={t('bodyweight.groupLabel')} className="mt-6">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('bodyweight.title')}
          </h2>

          {/* Status: the TREND weight leads; the raw reading is context. */}
          <div className="mt-3">
            {current && trendNow ? (
              <>
                <p className="text-sm text-muted-foreground">{t('bodyweight.trendLabel')}</p>
                {/* Proportional figures at display size — tabular is for columns
                    (set tables, ticks), where digits must align vertically. */}
                <p className="mt-1 font-display text-4xl leading-none">
                  {roundDisplay(kgToDisplay(trendNow.weightKg, unit))}
                  <span className="ml-1.5 text-xl text-muted-foreground">{unit}</span>
                </p>
                {trendDeltaKg !== null && (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {t('bodyweight.deltaSummary', {
                      direction: deltaDirection(trendDeltaKg, unit),
                      value: roundDisplay(kgToDisplay(Math.abs(trendDeltaKg), unit)),
                      unit,
                      days: DELTA_DAYS,
                    })}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground tnum">
                  {t('bodyweight.rawReading', {
                    value: kgToDisplay(current.weightKg, unit),
                    unit,
                    date: formatWorkoutDate(current.weighedAt),
                  })}
                </p>
              </>
            ) : (
              // Teach line, not a bare dash: the value exists to power est. 1RM.
              <p className="text-sm text-muted-foreground">
                {t('bodyweight.empty')}
              </p>
            )}
          </div>

          {/* Visualization — trend line over faint raw dots, goal as target. */}
          {trendPoints.length >= 2 && (
            <div role="group" aria-label={t('bodyweight.trendGroupLabel')} className="mt-6">
              <TrendChart
                points={trendPoints}
                unit={unit}
                valueLabel={t('bodyweight.seriesTrend')}
                rawLabel={t('bodyweight.seriesRaw')}
                ariaLabel={t('bodyweight.chartLabel', {
                  from: trendPoints[0].value,
                  to: trendPoints[trendPoints.length - 1].value,
                  unit,
                  count: trendPoints.length,
                })}
                targetValue={targetKg !== null ? kgToDisplay(targetKg, unit) : undefined}
                targetLabel={t('bodyweight.seriesTarget')}
              />
            </div>
          )}

          {/* Input. */}
          <div className="mt-6">
            <BodyweightLogForm unit={unit} />
          </div>

          {/* History, freshest first, capped — the rest one disclosure away. */}
          {logs.length > 0 && (
            <>
              <ul
                aria-label={t('bodyweight.historyGroupLabel')}
                className="mt-6 divide-y divide-border/60 border-b border-b-border/60"
              >
                {logs.slice(0, HISTORY_VISIBLE_ROWS).map((log) => (
                  <BodyweightEntryRow
                    key={log.id}
                    id={log.id}
                    dateLabel={formatWorkoutDate(log.weighedAt)}
                    weightLabel={t('bodyweight.weightValue', {
                      value: kgToDisplay(log.weightKg, unit),
                      unit,
                    })}
                  />
                ))}
              </ul>
              {logs.length > HISTORY_VISIBLE_ROWS && (
                <details className="group mt-2">
                  <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground [&::-webkit-details-marker]:hidden">
                    {t('bodyweight.showAll', { count: logs.length })}
                    <ChevronRight
                      aria-hidden="true"
                      className="size-3.5 transition-transform group-open:rotate-90"
                    />
                  </summary>
                  <ul
                    aria-label={t('bodyweight.olderGroupLabel')}
                    className="mt-2 divide-y divide-border/60 border-b border-b-border/60"
                  >
                    {logs.slice(HISTORY_VISIBLE_ROWS).map((log) => (
                      <BodyweightEntryRow
                        key={log.id}
                        id={log.id}
                        dateLabel={formatWorkoutDate(log.weighedAt)}
                        weightLabel={t('bodyweight.weightValue', {
                      value: kgToDisplay(log.weightKg, unit),
                      unit,
                    })}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>

        {/* ── Measurements ───────────────────────────────────────────── */}
        <section aria-label={t('measurements.groupLabel')} className="mt-10">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('measurements.title')}
          </h2>
          <div className="mt-3">
            <MeasurementsSection unit={lengthUnit} entries={measurementEntries} />
          </div>
        </section>

        {/* ── Photos ─────────────────────────────────────────────────── */}
        <section aria-label={t('photos.groupLabel')} className="mt-10">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('photos.title')}
          </h2>
          <div className="mt-3">
            <PhotosSection entries={photoEntries} />
          </div>
        </section>
      </main>
    </div>
  )
}

/**
 * Rows → island entries: dates pre-formatted (plus the raw instant for the
 * cadence nudge / default compare pair), thumb AND display URLs signed in
 * ONE bulk storage call at render (the RSC is the signer — no list API).
 * If signing fails, the timeline still renders from ThumbHashes alone
 * (urls null) instead of the whole page erroring.
 */
async function buildPhotoEntries(photos: ProgressPhoto[]): Promise<PhotoEntry[]> {
  let signed = new Map<string, string>()
  if (photos.length > 0) {
    try {
      signed = await createSignedUrls(
        photos.flatMap((p) => [p.blobKeyThumb, p.blobKeyDisplay]),
      )
    } catch (error: unknown) {
      console.error('progress-photo URL signing failed', error)
    }
  }
  return photos.map((p) => ({
    id: p.id,
    dateLabel: formatWorkoutDate(p.takenAt),
    takenAtMs: p.takenAt.getTime(),
    pose: p.pose,
    note: p.note,
    thumbHash: p.thumbHash,
    thumbUrl: signed.get(p.blobKeyThumb) ?? null,
    displayUrl: signed.get(p.blobKeyDisplay) ?? null,
  }))
}

/** 1dp for the hero — the trend is an average, 2dp would claim false precision. */
function roundDisplay(value: number): number {
  return Math.round(value * 10) / 10
}

/** Which branch of the delta message applies. The sentence itself lives in
 *  the catalog as one ICU select — a direction word built here could not be
 *  translated, and gluing it to the rest fixes an English word order. */
function deltaDirection(deltaKg: number, unit: WeightUnit): 'steady' | 'down' | 'up' {
  const display = Math.round(kgToDisplay(Math.abs(deltaKg), unit) * 10) / 10
  if (display === 0) return 'steady'
  return deltaKg < 0 ? 'down' : 'up'
}
