'use client'

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { useTranslations } from 'next-intl'

/**
 * The coach panel's 14-day usage/spend composite: traces per day as volt
 * bars, daily cost as a line on its own right axis (counts and dollars share
 * no scale). Two series → the legend is mandatory; exact values live in the
 * tooltip. Client island: recharts renders client-side; the panel passes
 * pre-formatted points.
 */

export interface CoachChartPoint {
  /** Pre-formatted day label ("Jul 19"). */
  label: string
  traces: number
  /** Cost in USD for the day. */
  cost: number
}

export function CoachChart({ points }: { points: CoachChartPoint[] }) {
  const t = useTranslations('CoachChart')
  // Built at render, not module load: a label frozen at import time is
  // evaluated before any request and can never be translated.
  const chartConfig = {
    traces: { label: t('series.traces'), color: 'var(--primary)' },
    cost: { label: t('series.cost'), color: 'var(--muted-foreground)' },
  } satisfies ChartConfig
  return (
    <ChartContainer
      config={chartConfig}
      className="h-48 w-full"
      role="img"
      aria-label={t('ariaLabel', { days: points.length })}
    >
      <ComposedChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.25} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis
          yAxisId="traces"
          width={28}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="cost"
          orientation="right"
          width={44}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <ChartTooltip
          cursor={{ fillOpacity: 0.06 }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="font-semibold tnum">
                  {name === 'cost' && typeof value === 'number'
                    ? `$${value.toFixed(4)}`
                    : String(value)}
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar yAxisId="traces" dataKey="traces" fill="var(--color-traces)" radius={4} barSize={12} />
        <Line
          yAxisId="cost"
          dataKey="cost"
          type="monotone"
          stroke="var(--color-cost)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartContainer>
  )
}
