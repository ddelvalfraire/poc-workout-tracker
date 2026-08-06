'use client'

import type { ReactElement } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

/**
 * The app's one time-series chart: a single-series area trend with a
 * crosshair tooltip. Replaces the raw sparkline everywhere a trend is the
 * point of the page (exercise est-1RM, bodyweight) — the sparkline showed
 * shape but couldn't answer "when was that?" or "what was the value?".
 *
 * Client island by necessity (Recharts renders client-side); pages stay
 * server components and pass pre-formatted points, so Recharts loads only on
 * routes that chart. Single series → no legend (the section heading names
 * it); values live in the tooltip, never painted on every point.
 *
 * ComposedChart (not AreaChart) so the optional `raw` companion series can
 * render as faint dots under the smoothed line — trend-over-noise surfaces
 * (bodyweight EMA) keep the honest raw readings visible without letting
 * them shout.
 */

export interface TrendPoint {
  /** Pre-formatted date label ("Jun 14, 2026") — the x tick and tooltip title. */
  label: string
  /** Display-unit numeric value (already converted from canonical kg). */
  value: number
  /** Optional companion reading (e.g. the raw weigh-in behind an EMA value)
   *  painted as a faint dot — set rawLabel to name it in the tooltip. */
  raw?: number
  /** Epoch ms. When EVERY point carries it, the x-axis goes numeric/time so
   *  layoffs read as gaps instead of adjacent ticks; `label` keeps naming the
   *  tooltip. Omit (all points) for the categorical axis. */
  t?: number
  /** Record-setting point — painted as a volt dot on the line. */
  pr?: boolean
}

interface TrendChartProps {
  points: TrendPoint[]
  /** Unit suffix for the tooltip value ("kg", "lb"). */
  unit: string
  /** What the number IS — the tooltip's series name ("Est. 1RM", "Bodyweight"). */
  valueLabel: string
  ariaLabel: string
  /** Optional horizontal reference (display unit) — e.g. a strength goal's
   *  target e1RM. Extends the y-domain when above the data, so a far-off
   *  target stays visible instead of clipping. */
  targetValue?: number
  /** Short label painted at the reference line ("Target"). */
  targetLabel?: string
  /** Tooltip name for the `raw` companion series ("Weigh-in"). */
  rawLabel?: string
  /** Height/spacing override for compact placements (default h-40). */
  className?: string
}

/** Numeric-axis tick dates ("Jun 14") — module-level so it's built once. */
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** The dot props recharts hands a custom dot renderer (typed locally — the
 *  library's DotProps omits the bound datum). */
interface PrDotProps {
  cx?: number
  cy?: number
  index?: number
  payload?: TrendPoint
}

/** Volt dot on record-setting points only; every other point renders an
 *  empty group (recharts requires an element back, not false). */
function renderPrDot(props: PrDotProps): ReactElement<SVGElement> {
  const { cx, cy, index, payload } = props
  if (payload?.pr !== true || cx === undefined || cy === undefined) {
    return <g key={`dot-${index}`} />
  }
  return (
    <circle
      key={`dot-${index}`}
      cx={cx}
      cy={cy}
      r={3.5}
      fill="var(--color-value)"
      stroke="var(--background)"
      strokeWidth={1.5}
    />
  )
}

export function TrendChart({
  points,
  unit,
  valueLabel,
  ariaLabel,
  targetValue,
  targetLabel,
  rawLabel,
  className,
}: TrendChartProps) {
  const hasRaw = points.some((p) => p.raw !== undefined)
  const hasPr = points.some((p) => p.pr === true)
  // Time-true axis only when every point is stamped — a mixed series would
  // silently drop the unstamped points off a numeric axis.
  const isTimeAxis = points.length > 0 && points.every((p) => p.t !== undefined)
  const config: ChartConfig = {
    value: { label: valueLabel, color: 'var(--primary)' },
    ...(hasRaw ? { raw: { label: rawLabel ?? 'Raw', color: 'var(--muted-foreground)' } } : {}),
  }
  return (
    <ChartContainer
      config={config}
      className={cn('h-40 w-full', className)}
      aria-label={ariaLabel}
      role="img"
    >
      <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.25} />
        {isTimeAxis ? (
          // Numeric epoch x: a three-month layoff is three months of blank
          // axis, not one tick-width. Ticks land on round intervals recharts
          // picks, so they format from the epoch, not the point labels.
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={48}
            tickFormatter={(t: number) => SHORT_DAY.format(new Date(t))}
          />
        ) : (
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={48}
            // "Jun 14, 2026" → "Jun 14": ticks stay short, the tooltip keeps the year.
            tickFormatter={(label: string) => label.replace(/, \d{4}$/, '')}
          />
        )}
        <YAxis
          width={36}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          domain={['auto', 'auto']}
          tickFormatter={(v: number) => `${Math.round(v)}`}
        />
        <ChartTooltip
          cursor={{ strokeOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              // On the numeric axis the hover label is an epoch number — the
              // point's pre-formatted label is the human title.
              {...(isTimeAxis
                ? {
                    labelFormatter: (_value, payload) => {
                      const point = payload?.[0]?.payload as TrendPoint | undefined
                      return point?.label ?? ''
                    },
                  }
                : {})}
              formatter={(value, name) => (
                <span className={cn('font-semibold', name === 'raw' && 'text-muted-foreground')}>
                  {hasRaw && (
                    <span className="mr-1 font-normal text-muted-foreground">
                      {String(config[name as string]?.label ?? name)}
                    </span>
                  )}
                  {typeof value === 'number'
                    ? `${Math.round(value * 10) / 10} ${unit}`
                    : String(value)}
                </span>
              )}
            />
          }
        />
        {targetValue !== undefined && (
          <ReferenceLine
            y={targetValue}
            ifOverflow="extendDomain"
            stroke="var(--color-value)"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{
              value: targetLabel ?? 'Target',
              position: 'insideTopRight',
              fill: 'var(--muted-foreground)',
              fontSize: 10,
            }}
          />
        )}
        {hasRaw && (
          // Faint dots only — the honest readings under the smoothed truth.
          <Line
            dataKey="raw"
            stroke="none"
            dot={{ r: 1.5, fill: 'var(--color-raw)', strokeWidth: 0, fillOpacity: 0.45 }}
            activeDot={{ r: 3, fill: 'var(--color-raw)' }}
            isAnimationActive={false}
          />
        )}
        <Area
          dataKey="value"
          type="monotone"
          fill="var(--color-value)"
          fillOpacity={0.12}
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={hasPr ? renderPrDot : false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ChartContainer>
  )
}
