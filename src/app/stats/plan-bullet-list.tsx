import type { MuscleGroupVolume } from '@/db/muscle-volume'
import { cn } from '@/lib/utils'
import { bulletWidthPct } from './volume-view'

/**
 * The plan-mode re-encoding of "sets per muscle group": one bullet row per
 * group — the performed bar inside a track whose full width IS the planned
 * target, last week as a faint tick. Replaces the paired-bar recharts chart
 * ONLY when a plan exists (no-plan mode keeps the chart: without a target
 * there is no track to fill). Server-rendered divs — no chart lib, no island.
 *
 * Color discipline: volt only at/over plan (achievement), muted under it.
 * Numbers stay real text on every row — the bars are emphasis, never the
 * only encoding (accessibility rule from the chart this replaces).
 */

interface PlanBulletListProps {
  /** Pre-sorted (shortfall-first) groups with their planned targets. */
  rows: readonly (MuscleGroupVolume & { plannedSets: number })[]
}

export function PlanBulletList({ rows }: PlanBulletListProps) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const hasTarget = row.plannedSets > 0
        const met = hasTarget && row.currentSets >= row.plannedSets
        return (
          <li key={row.group}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{row.group}</span>
              <span className="text-muted-foreground tnum">
                {hasTarget
                  ? `${row.currentSets} / ${row.plannedSets} sets`
                  : // Trained off-plan: real work, no target to track against.
                    `${row.currentSets} sets · no target`}
              </span>
            </div>
            {hasTarget && (
              <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    met ? 'bg-primary' : 'bg-muted-foreground/60',
                  )}
                  style={{ width: `${bulletWidthPct(row.currentSets, row.plannedSets)}%` }}
                />
                {/* Last week's mark — context, not a second series. */}
                {row.previousSets > 0 && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-foreground/50"
                    style={{ left: `${bulletWidthPct(row.previousSets, row.plannedSets)}%` }}
                  />
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
