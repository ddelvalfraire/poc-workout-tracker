import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listBodyweightLogs } from '@/db/bodyweight'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { bodyweightDeltaKg } from '@/lib/bodyweight-trend'
import { TrendChart } from '@/components/charts/trend-chart'
import { formatWorkoutDate } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BodyweightLogForm } from './log-form'
import { BodyweightEntryRow } from './entry-row'

// The delta window the hero reports against ("+1.2 lb / 30d").
const DELTA_DAYS = 30

/**
 * The bodyweight tracking surface: current weight (the value e1RM scoring
 * reads), a quick log, the trend chart, and the weigh-in history.
 * Reached from Settings → Bodyweight. Server component — the interactive
 * bits (log form, per-entry delete) are small client islands.
 */
export default async function BodyweightPage() {
  const userId = await requireUserId()
  const [unit, logs] = await Promise.all([getWeightUnit(userId), listBodyweightLogs(userId)])

  const current = logs[0] ?? null
  const deltaKg = bodyweightDeltaKg(logs, DELTA_DAYS)
  // Chart reads chronologically, oldest → newest (logs arrive freshest first);
  // dates pre-formatted and kg → display unit here, server-side.
  const trendPoints = [...logs].reverse().map((log) => ({
    label: formatWorkoutDate(log.weighedAt),
    value: kgToDisplay(log.weightKg, unit),
  }))

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Bodyweight"
        leading={
          <Link
            href="/settings"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Hero: the current weight, big-numeral pattern. */}
        <section aria-label="Current bodyweight" className="mt-6">
          {current ? (
            <>
              <p className="text-sm text-muted-foreground">Current</p>
              <p className="mt-1 font-display text-4xl leading-none tnum">
                {kgToDisplay(current.weightKg, unit)}
                <span className="ml-1.5 text-xl text-muted-foreground">{unit}</span>
              </p>
              {deltaKg !== null && (
                <p className="mt-1.5 text-sm text-muted-foreground tnum">
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
        </section>

        <div className="mt-4">
          <BodyweightLogForm unit={unit} />
        </div>

        {/* Trend — needs at least two points to be a line. Real axes and a
            crosshair tooltip replaced the range-label sparkline: "when was
            that?" is now answerable on the chart itself. */}
        {trendPoints.length >= 2 && (
          <section aria-label="Trend" className="mt-6">
            <TrendChart
              points={trendPoints}
              unit={unit}
              valueLabel="Bodyweight"
              ariaLabel={`Bodyweight trend, ${trendPoints[0].value} to ${trendPoints[trendPoints.length - 1].value} ${unit} over ${trendPoints.length} entries`}
            />
          </section>
        )}

        {/* History, freshest first. */}
        {logs.length > 0 && (
          <section aria-label="Weigh-in history" className="mt-6">
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {logs.map((log) => (
                <BodyweightEntryRow
                  key={log.id}
                  id={log.id}
                  dateLabel={formatWorkoutDate(log.weighedAt)}
                  weightLabel={`${kgToDisplay(log.weightKg, unit)} ${unit}`}
                />
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

/** "+1.2 lb" / "−0.8 kg" — signed, 1dp, in the display unit. */
function formatDelta(deltaKg: number, unit: WeightUnit): string {
  const display = Math.round(kgToDisplay(Math.abs(deltaKg), unit) * 10) / 10
  const sign = deltaKg < 0 ? '−' : '+'
  return `${sign}${display} ${unit}`
}
