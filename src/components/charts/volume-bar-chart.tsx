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
import { useTranslations } from 'next-intl'
import type { MuscleGroupVolume } from '@/db/muscle-volume'

/**
 * Weekly sets per muscle group: horizontal paired bars — this week in volt,
 * last week in the muted ink — one row per group so ten groups fit a phone
 * without label rotation. Multiple series → the legend is mandatory (identity
 * is never color-alone); exact values live in the tooltip, not painted on
 * bars. When rows carry `plannedSets` (active program), a third thin bar
 * marks the weekly target; without it the render is identical to before.
 * Client island: recharts renders client-side; the page passes plain rows.
 */

/** Vertical rhythm per group row — the thin bars plus breathing room. */
const ROW_HEIGHT = 44

interface VolumeBarChartProps {
  groups: (MuscleGroupVolume & { plannedSets?: number })[]
}

export function VolumeBarChart({ groups }: VolumeBarChartProps) {
  const t = useTranslations('VolumeBarChart')
  const hasPlanned = groups.some((g) => g.plannedSets !== undefined)
  // Built at render, not module load: a label frozen at import time is
  // evaluated before any request and can never be translated.
  const chartConfig = {
    currentSets: { label: t('series.current'), color: 'var(--primary)' },
    previousSets: { label: t('series.previous'), color: 'var(--muted-foreground)' },
    plannedSets: { label: t('series.planned'), color: 'var(--foreground)' },
  } satisfies ChartConfig
  return (
    <ChartContainer
      config={chartConfig}
      style={{ height: groups.length * ROW_HEIGHT + 60 }}
      className="w-full"
      role="img"
      aria-label={t('ariaLabel', { count: groups.length })}
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
        {hasPlanned && (
          <Bar
            dataKey="plannedSets"
            fill="var(--color-plannedSets)"
            fillOpacity={0.3}
            radius={4}
            barSize={4}
          />
        )}
      </BarChart>
    </ChartContainer>
  )
}
