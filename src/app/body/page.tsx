import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listBodyweightLogs } from '@/db/bodyweight'
import { listMeasurements } from '@/db/body-measurements'
import { listProgressPhotos, type ProgressPhoto } from '@/db/progress-photos'
import { createSignedUrls } from '@/lib/supabase-storage'
import { kgToDisplay, cmToDisplay, lengthUnitFor, type WeightUnit } from '@/lib/units'
import { bodyweightDeltaKg } from '@/lib/bodyweight-trend'
import { TrendChart } from '@/components/charts/trend-chart'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { BodyweightLogForm } from './log-form'
import { BodyweightEntryRow } from './entry-row'
import { MeasurementsSection } from './measurements-section'
import { PhotosSection } from './photos-section'
import type { PhotoEntry } from './photo-cell'

// The delta window the bodyweight hero reports against ("+1.2 lb / 30d").
const DELTA_DAYS = 30

/**
 * The one body-tracking surface: bodyweight (current + delta, quick log,
 * trend, history — the former /bodyweight page, folded in) and tape
 * measurements (per-site log, trend, history). /bodyweight permanently
 * redirects here. Reached from Settings → Body. Server component — the
 * interactive bits are small client islands.
 */
export default async function BodyPage() {
  const userId = await requireUserId()
  const [unit, logs, measurements, photos] = await Promise.all([
    getWeightUnit(userId),
    listBodyweightLogs(userId),
    listMeasurements(userId),
    listProgressPhotos(userId),
  ])
  const photoEntries = await buildPhotoEntries(photos)
  const lengthUnit = lengthUnitFor(unit)

  const current = logs[0] ?? null
  const deltaKg = bodyweightDeltaKg(logs, DELTA_DAYS)
  // Chart reads chronologically, oldest → newest (logs arrive freshest first);
  // dates pre-formatted and kg → display unit here, server-side.
  const trendPoints = [...logs].reverse().map((log) => ({
    label: formatWorkoutDate(log.weighedAt),
    value: kgToDisplay(log.weightKg, unit),
  }))

  // Measurements cross the island boundary pre-formatted too (dates, display
  // unit); the island only picks a site and slices — no conversion client-side.
  const measurementEntries = measurements.map((m) => ({
    id: m.id,
    site: m.site,
    dateLabel: formatWorkoutDate(m.measuredAt),
    value: cmToDisplay(m.valueCm, lengthUnit),
  }))

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Body"
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* ── Bodyweight ─────────────────────────────────────────────── */}
        <section aria-label="Bodyweight" className="mt-6">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Bodyweight
          </h2>

          {/* Hero: the current weight, big-numeral pattern. */}
          <div className="mt-3">
            {current ? (
              <>
                <p className="text-sm text-muted-foreground">Current</p>
                {/* Proportional figures at display size — tabular is for columns
                    (set tables, ticks), where digits must align vertically. */}
                <p className="mt-1 font-display text-4xl leading-none">
                  {kgToDisplay(current.weightKg, unit)}
                  <span className="ml-1.5 text-xl text-muted-foreground">{unit}</span>
                </p>
                {deltaKg !== null && (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {formatDelta(deltaKg, unit)} / {DELTA_DAYS}d
                  </p>
                )}
              </>
            ) : (
              // Teach line, not a bare dash: the value exists to power est. 1RM.
              <p className="text-sm text-muted-foreground">
                Log your first weigh-in — bodyweight exercises use it for est. 1RM.
              </p>
            )}
          </div>

          <div className="mt-4">
            <BodyweightLogForm unit={unit} />
          </div>

          {/* Trend — needs at least two points to be a line. */}
          {trendPoints.length >= 2 && (
            <div role="group" aria-label="Bodyweight trend" className="mt-6">
              <TrendChart
                points={trendPoints}
                unit={unit}
                valueLabel="Bodyweight"
                ariaLabel={`Bodyweight trend, ${trendPoints[0].value} to ${trendPoints[trendPoints.length - 1].value} ${unit} over ${trendPoints.length} entries`}
              />
            </div>
          )}

          {/* History, freshest first. */}
          {logs.length > 0 && (
            <ul
              aria-label="Weigh-in history"
              className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
            >
              {logs.map((log) => (
                <BodyweightEntryRow
                  key={log.id}
                  id={log.id}
                  dateLabel={formatWorkoutDate(log.weighedAt)}
                  weightLabel={`${kgToDisplay(log.weightKg, unit)} ${unit}`}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ── Measurements ───────────────────────────────────────────── */}
        <section aria-label="Measurements" className="mt-10">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Measurements
          </h2>
          <div className="mt-3">
            <MeasurementsSection unit={lengthUnit} entries={measurementEntries} />
          </div>
        </section>

        {/* ── Photos ─────────────────────────────────────────────────── */}
        <section aria-label="Progress photos" className="mt-10">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Progress photos
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
 * Rows → island entries: dates pre-formatted, thumb AND display URLs signed
 * in ONE bulk storage call at render (the RSC is the signer — no list API).
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
    pose: p.pose,
    note: p.note,
    thumbHash: p.thumbHash,
    thumbUrl: signed.get(p.blobKeyThumb) ?? null,
    displayUrl: signed.get(p.blobKeyDisplay) ?? null,
  }))
}

/** "+1.2 lb" / "−0.8 kg" — signed, 1dp, in the display unit. */
function formatDelta(deltaKg: number, unit: WeightUnit): string {
  const display = Math.round(kgToDisplay(Math.abs(deltaKg), unit) * 10) / 10
  const sign = deltaKg < 0 ? '−' : '+'
  return `${sign}${display} ${unit}`
}
