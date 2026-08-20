'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useMounted } from '@/lib/use-mounted'
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
import { useLocale, useTranslations } from 'next-intl'
import { renderMessage } from '@/lib/message'

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
  const t = useTranslations('MeasurementsSection')
  // Site names are one shared vocabulary in the `Body` namespace: the
  // value is a db enum, so the picker and the history heading must never
  // be free to word it differently.
  const tBody = useTranslations('Body')
  const locale = useLocale()
  const [site, setSite] = useState<MeasurementSite>(entries[0]?.site ?? 'waist')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Mounted gate for anything derived from "now" — no SSR/client drift. Read
  // at render, not stamped into state by an effect: a clock read is not state
  // to own, and owning it cost a second render on every mount.
  const mounted = useMounted()
  // `new Date()` rather than `Date.now()`: NOT more pure — both read the wall
  // clock. The compiler's typed-globals table marks `Date.now` impure and has
  // no shape for the `Date` constructor, so only the former is flagged. What
  // actually makes this safe is the mounted gate above; `new Date()` is just
  // the unflagged spelling, and the one status-hero.tsx already uses.
  const nowMs = mounted ? new Date().getTime() : null
  const router = useRouter()

  const siteEntries = entries.filter((entry) => entry.site === site)
  // Chart reads chronologically, oldest → newest (entries arrive freshest first).
  const trendPoints = [...siteEntries]
    .reverse()
    .map((entry) => ({ label: entry.dateLabel, value: entry.value }))
  const siteLabel = renderMessage(tBody, measurementSiteLabel(site))
  // Mid-sentence, English wants the site lowercased. `toLocaleLowerCase`
  // at least casts the fold in the reader's locale; a language that
  // capitalises nouns will need its own inline key rather than this.
  const siteLabelInline = siteLabel.toLocaleLowerCase(locale)
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
      setError(t('validation', { unit }))
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
        setError(t('saveError'))
      }
    })
  }

  return (
    <div>
      {/* Site picker — horizontally scrollable pills; radiogroup semantics
          (one selection out of a fixed set), volt only on the active site. */}
      <div
        role="radiogroup"
        aria-label={t('siteGroupLabel')}
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
            {renderMessage(tBody, measurementSiteLabel(s))}
          </button>
        ))}
      </div>

      {/* Status: latest reading + the honest window delta, when it exists. */}
      {latest !== null && (
        <p className="mt-4 text-sm text-muted-foreground tnum">
          {/* One message: the reading, its emphasis tag and the optional
              delta clause all move together when the sentence is translated. */}
          {t.rich('latestSummary', {
            site: siteLabel,
            value: latest.value,
            unit,
            days: DELTA_DAYS,
            delta: delta === null ? 'none' : formatSignedDelta(delta),
            reading: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          })}
        </p>
      )}

      {trendPoints.length >= 2 && (
        <div role="group" aria-label={t('trendGroupLabel', { site: siteLabel })} className="mt-4">
          <TrendChart
            points={trendPoints}
            unit={unit}
            valueLabel={siteLabel}
            ariaLabel={t('chartLabel', {
              site: siteLabel,
              from: trendPoints[0].value,
              to: trendPoints[trendPoints.length - 1].value,
              unit,
              count: trendPoints.length,
            })}
          />
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6">
        <label htmlFor="measurement-input" className="text-sm font-medium">
          {t('inputLabel', { site: siteLabel, unit })}
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
            placeholder={t('placeholder', { example: unit === 'in' ? 33.5 : 85 })}
            className="tnum"
          />
          <Button type="submit" disabled={isPending} className="shrink-0">
            {isPending ? t('pendingAction') : t('action')}
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
            aria-label={t('historyGroupLabel', { site: siteLabel })}
            className="mt-6 divide-y divide-border/60 border-b border-b-border/60"
          >
            {siteEntries.slice(0, HISTORY_VISIBLE_ROWS).map((entry) => (
              <MeasurementEntryRow
                key={entry.id}
                id={entry.id}
                dateLabel={entry.dateLabel}
                valueLabel={t('value', { value: entry.value, unit })}
              />
            ))}
          </ul>
          {siteEntries.length > HISTORY_VISIBLE_ROWS && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground [&::-webkit-details-marker]:hidden">
                {t('showAll', { site: siteLabelInline, count: siteEntries.length })}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-open:rotate-90"
                />
              </summary>
              <ul
                aria-label={t('olderGroupLabel', { site: siteLabel })}
                className="mt-2 divide-y divide-border/60 border-b border-b-border/60"
              >
                {siteEntries.slice(HISTORY_VISIBLE_ROWS).map((entry) => (
                  <MeasurementEntryRow
                    key={entry.id}
                    id={entry.id}
                    dateLabel={entry.dateLabel}
                    valueLabel={t('value', { value: entry.value, unit })}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        // Honest empty state, per site — the tape teaches what the scale can't.
        <p className="mt-6 text-sm text-muted-foreground">
          {t('empty', { site })}
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
