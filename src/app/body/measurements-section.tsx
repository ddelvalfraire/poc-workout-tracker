'use client'

import { useEffect, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TrendChart } from '@/components/charts/trend-chart'
import { logMeasurementAction } from '@/app/actions'
import { seriesDeltaAt } from '@/lib/bodyweight-trend'
import type { LengthUnit } from '@/lib/units'
import {
  MEASUREMENT_SITES,
  measurementSiteLabel,
  type MeasurementSite,
} from '@/lib/measurement-sites'
import { cn } from '@/lib/utils'
import { MeasurementEntryRow } from './measurement-entry-row'

// The site delta's window — tape moves slowly; 90 days is a real change.
const DELTA_DAYS = 90
// Visible history rows before the rest collapses behind a disclosure.
const HISTORY_VISIBLE_ROWS = 5

/** One measurement crossing the island boundary — dates and unit conversion
 *  already handled server-side, freshest first (list order preserved).
 *  `measuredAtMs` is the raw instant for the delta window. */
export interface MeasurementEntry {
  id: string
  site: MeasurementSite
  dateLabel: string
  measuredAtMs: number
  /** Display-unit value (cm verbatim, or inches at 1dp). */
  value: number
}

/**
 * The measurements half of /body: one site picker drives all views — the
 * status delta line, the trend chart, the log form, and the capped history
 * (status → visualization → input → history, the page's zone order). A
 * single chart behind the picker (not per-site small multiples) because
 * eight stacked charts don't survive a 320px viewport; the picker doubles
 * as the form's site input. Client island: the selection is view state, the
 * data arrives as props from the server page.
 */
export function MeasurementsSection({
  unit,
  entries,
}: {
  unit: LengthUnit
  entries: MeasurementEntry[]
}) {
  const [site, setSite] = useState<MeasurementSite>(entries[0]?.site ?? 'waist')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Mounted gate for anything derived from "now" — no SSR/client drift.
  const [nowMs, setNowMs] = useState<number | null>(null)
  const router = useRouter()

  useEffect(() => {
    setNowMs(Date.now())
  }, [entries])

  const siteEntries = entries.filter((entry) => entry.site === site)
  // Chart reads chronologically, oldest → newest (entries arrive freshest first).
  const trendPoints = [...siteEntries]
    .reverse()
    .map((entry) => ({ label: entry.dateLabel, value: entry.value }))
  const siteLabel = measurementSiteLabel(site)
  const latest = siteEntries[0] ?? null
  const delta =
    nowMs === null
      ? null
      : seriesDeltaAt(
          siteEntries.map((entry) => ({ atMs: entry.measuredAtMs, value: entry.value })),
          DELTA_DAYS,
          nowMs,
        )

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseFloat(value.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(`Enter a measurement above 0 ${unit}.`)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await logMeasurementAction(site, parsed)
        setValue('')
        router.refresh()
      } catch {
        // Keep the typed value: recovery is one more tap, not a re-type.
        setError('Didn’t save. Check the value and try again.')
      }
    })
  }

  return (
    <div>
      {/* Site picker — horizontally scrollable pills; radiogroup semantics
          (one selection out of a fixed set), volt only on the active site. */}
      <div
        role="radiogroup"
        aria-label="Measurement site"
        className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1"
      >
        {MEASUREMENT_SITES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={site === s}
            onClick={() => {
              setSite(s)
              setError(null)
            }}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              site === s
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {measurementSiteLabel(s)}
          </button>
        ))}
      </div>

      {/* Status: latest reading + the honest window delta, when it exists. */}
      {latest !== null && (
        <p className="mt-4 text-sm text-muted-foreground tnum">
          {siteLabel}:{' '}
          <span className="font-medium text-foreground">
            {latest.value} {unit}
          </span>
          {delta !== null && ` · ${formatSignedDelta(delta)} ${unit} / ${DELTA_DAYS}d`}
        </p>
      )}

      {trendPoints.length >= 2 && (
        <div role="group" aria-label={`${siteLabel} trend`} className="mt-4">
          <TrendChart
            points={trendPoints}
            unit={unit}
            valueLabel={siteLabel}
            ariaLabel={`${siteLabel} trend, ${trendPoints[0].value} to ${trendPoints[trendPoints.length - 1].value} ${unit} over ${trendPoints.length} entries`}
          />
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6">
        <label htmlFor="measurement-input" className="text-sm font-medium">
          {siteLabel} ({unit})
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="measurement-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error !== null || undefined}
            placeholder={unit === 'in' ? 'e.g. 33.5' : 'e.g. 85'}
            className="tnum"
          />
          <Button type="submit" disabled={isPending} className="shrink-0">
            {isPending ? 'Logging…' : 'Log measurement'}
          </Button>
        </div>
        {error && (
          // Visible words, not a bare glyph — same rationale as the weight form.
          <p role="alert" className="mt-1.5 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>

      {siteEntries.length > 0 ? (
        <>
          <ul
            aria-label={`${siteLabel} history`}
            className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
          >
            {siteEntries.slice(0, HISTORY_VISIBLE_ROWS).map((entry) => (
              <MeasurementEntryRow
                key={entry.id}
                id={entry.id}
                dateLabel={entry.dateLabel}
                valueLabel={`${entry.value} ${unit}`}
              />
            ))}
          </ul>
          {siteEntries.length > HISTORY_VISIBLE_ROWS && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground [&::-webkit-details-marker]:hidden">
                All {siteLabel.toLowerCase()} entries · {siteEntries.length}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-open:rotate-90"
                />
              </summary>
              <ul
                aria-label={`Older ${siteLabel} entries`}
                className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
              >
                {siteEntries.slice(HISTORY_VISIBLE_ROWS).map((entry) => (
                  <MeasurementEntryRow
                    key={entry.id}
                    id={entry.id}
                    dateLabel={entry.dateLabel}
                    valueLabel={`${entry.value} ${unit}`}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        // Honest empty state, per site — the tape teaches what the scale can't.
        <p className="mt-6 text-sm text-muted-foreground">
          No {site} entries yet. Tape measurements catch changes the scale misses.
        </p>
      )}
    </div>
  )
}

/** "+0.5" / "−1.2" at 1dp — display-unit values, sign always shown. */
function formatSignedDelta(delta: number): string {
  const rounded = Math.round(Math.abs(delta) * 10) / 10
  return `${delta < 0 ? '−' : '+'}${rounded}`
}
