'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TrendChart } from '@/components/charts/trend-chart'
import { logMeasurementAction } from '@/app/actions'
import type { LengthUnit } from '@/lib/units'
import {
  MEASUREMENT_SITES,
  measurementSiteLabel,
  type MeasurementSite,
} from '@/lib/measurement-sites'
import { cn } from '@/lib/utils'
import { MeasurementEntryRow } from './measurement-entry-row'

/** One measurement crossing the island boundary — dates and unit conversion
 *  already handled server-side, freshest first (list order preserved). */
export interface MeasurementEntry {
  id: string
  site: MeasurementSite
  dateLabel: string
  /** Display-unit value (cm verbatim, or inches at 1dp). */
  value: number
}

/**
 * The measurements half of /body: one site picker drives all three views —
 * the log form, the trend chart, and the history list. A single chart behind
 * the picker (not per-site small multiples) because eight stacked charts
 * don't survive a 320px viewport; the picker doubles as the form's site
 * input, so "look at your waist trend" and "log a waist reading" are the
 * same selection. Client island: the selection is view state, the data
 * arrives as props from the server page.
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
  const router = useRouter()

  const siteEntries = entries.filter((entry) => entry.site === site)
  // Chart reads chronologically, oldest → newest (entries arrive freshest first).
  const trendPoints = [...siteEntries]
    .reverse()
    .map((entry) => ({ label: entry.dateLabel, value: entry.value }))
  const siteLabel = measurementSiteLabel(site)

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

      <form onSubmit={submit} noValidate className="mt-4">
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

      {trendPoints.length >= 2 && (
        <div role="group" aria-label={`${siteLabel} trend`} className="mt-6">
          <TrendChart
            points={trendPoints}
            unit={unit}
            valueLabel={siteLabel}
            ariaLabel={`${siteLabel} trend, ${trendPoints[0].value} to ${trendPoints[trendPoints.length - 1].value} ${unit} over ${trendPoints.length} entries`}
          />
        </div>
      )}

      {siteEntries.length > 0 ? (
        <ul
          aria-label={`${siteLabel} history`}
          className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
        >
          {siteEntries.map((entry) => (
            <MeasurementEntryRow
              key={entry.id}
              id={entry.id}
              dateLabel={entry.dateLabel}
              valueLabel={`${entry.value} ${unit}`}
            />
          ))}
        </ul>
      ) : (
        // Honest empty state, per site — the tape teaches what the scale can't.
        <p className="mt-6 text-sm text-muted-foreground">
          No {site} entries yet. Tape measurements catch changes the scale misses.
        </p>
      )}
    </div>
  )
}
