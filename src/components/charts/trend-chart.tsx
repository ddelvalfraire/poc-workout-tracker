'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

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
 */

export interface TrendPoint {
  /** Pre-formatted date label ("Jun 14, 2026") — the x tick and tooltip title. */
  label: string
  /** Display-unit numeric value (already converted from canonical kg). */
  value: number
}

interface TrendChartProps {
  points: TrendPoint[]
  /** Unit suffix for the tooltip value ("kg", "lb"). */
  unit: string
  /** What the number IS — the tooltip's series name ("Est. 1RM", "Bodyweight"). */
  valueLabel: string
  ariaLabel: string
}

export function TrendChart({ points, unit, valueLabel, ariaLabel }: TrendChartProps) {
  const config: ChartConfig = {
    value: { label: valueLabel, color: 'var(--primary)' },
  }
  return (
    <ChartContainer config={config} className="h-40 w-full" aria-label={ariaLabel} role="img">
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.25} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          // "Jun 14, 2026" → "Jun 14": ticks stay short, the tooltip keeps the year.
          tickFormatter={(label: string) => label.replace(/, \d{4}$/, '')}
        />
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
              formatter={(value) => (
                <span className="font-semibold">
                  {typeof value === 'number'
                    ? `${Math.round(value * 10) / 10} ${unit}`
                    : String(value)}
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          fill="var(--color-value)"
          fillOpacity={0.12}
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
