'use client'

import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

/**
 * A compact single-series daily bar chart for the product panel (workouts/day,
 * active users/day). Small on purpose — the panel stacks two of these — so no
 * grid or legend; the section heading names the series and values live in the
 * tooltip. Client island: recharts renders client-side.
 */

/** Chart geometry, not copy — hoisted so the JSX carries no bare literals. */
const MINI_DOMAIN = [0, 'auto'] as const

export interface MiniBarPoint {
  /** Pre-formatted day label ("Jul 19"). */
  label: string
  value: number
}

interface MiniBarChartProps {
  points: MiniBarPoint[]
  /** Series name for the tooltip ("Workouts"). */
  valueLabel: string
  ariaLabel: string
}

export function MiniBarChart({ points, valueLabel, ariaLabel }: MiniBarChartProps) {
  const config: ChartConfig = {
    value: { label: valueLabel, color: 'var(--primary)' },
  }
  return (
    <ChartContainer config={config} className="h-20 w-full" role="img" aria-label={ariaLabel}>
      <BarChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          minTickGap={48}
          fontSize={10}
        />
        <YAxis hide domain={MINI_DOMAIN} />
        <ChartTooltip cursor={{ fillOpacity: 0.06 }} content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={2} />
      </BarChart>
    </ChartContainer>
  )
}
