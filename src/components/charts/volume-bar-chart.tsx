'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { MuscleGroupVolume } from '@/db/muscle-volume'

/**
 * Weekly sets per muscle group: horizontal paired bars — this week in volt,
 * last week in the muted ink — one row per group so ten groups fit a phone
 * without label rotation. Two series → the legend is mandatory (identity is
 * never color-alone); exact values live in the tooltip, not painted on bars.
 * Client island: recharts renders client-side; the page passes plain rows.
 */

const chartConfig = {
  currentSets: { label: 'This week', color: 'var(--primary)' },
  previousSets: { label: 'Last week', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

/** Vertical rhythm per group row — two thin bars plus breathing room. */
const ROW_HEIGHT = 44

interface VolumeBarChartProps {
  groups: MuscleGroupVolume[]
}

export function VolumeBarChart({ groups }: VolumeBarChartProps) {
  return (
    <ChartContainer
      config={chartConfig}
      style={{ height: groups.length * ROW_HEIGHT + 60 }}
      className="w-full"
      role="img"
      aria-label={`Sets per muscle group, this week vs last, ${groups.length} groups`}
    >
      <BarChart data={groups} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} strokeOpacity={0.25} />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="group"
          tickLine={false}
          axisLine={false}
          width={82}
          interval={0}
        />
        <ChartTooltip cursor={{ fillOpacity: 0.06 }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="currentSets" fill="var(--color-currentSets)" radius={4} barSize={10} />
        <Bar
          dataKey="previousSets"
          fill="var(--color-previousSets)"
          fillOpacity={0.45}
          radius={4}
          barSize={10}
        />
      </BarChart>
    </ChartContainer>
  )
}
