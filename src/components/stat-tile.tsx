import { cn } from '@/lib/utils'

/**
 * The app's stat-tile contract (one shape for every record/metric card):
 * label · value (+unit) · optional delta with a semantic tone · optional
 * caption. Distilled from the dataviz stat-tile spec:
 *
 * - The VALUE uses the font's proportional figures — `tnum` gives every digit
 *   a 0's width, which reads loose at display sizes; tabular figures are for
 *   COLUMNS of numbers (set tables, axis ticks), never big standalone values.
 * - The delta is signed text whose color carries meaning (volt = progress,
 *   muted = neutral context) — never decoration.
 * - Text wears ink tokens; nothing here is painted in series colors.
 *
 * Pure presentational and server-renderable: every field arrives
 * pre-formatted (numbers, units, dates) — the tile lays out, it never
 * computes or converts.
 */

export interface StatDelta {
  /** Signed, with its comparison period named by the caller ("+2.5 kg vs first session"). */
  text: string
  /** 'positive' = progress (volt); 'neutral' = plain context (bodyweight drift). */
  tone: 'positive' | 'neutral'
}

interface StatTileProps {
  label: string
  /** Pre-formatted display value — no trailing unit (that's `unit`). */
  value: string
  unit?: string
  delta?: StatDelta
  /** Muted last line — typically the record's date. */
  caption?: string
  className?: string
}

export function StatTile({ label, value, unit, delta, caption, className }: StatTileProps) {
  // dt/dd internals so a grid of tiles stays a real description list — wrap
  // the grid in <dl> (a div-wrapped dt/dd group is valid dl content), the
  // same semantics the workout summary and stats sheet grids already use.
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4', className)}>
      <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold leading-none">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </dd>
      {delta && (
        <dd
          className={cn(
            'mt-1.5 text-sm font-medium',
            delta.tone === 'positive' ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {delta.text}
        </dd>
      )}
      {caption && <dd className="mt-1 text-xs text-muted-foreground">{caption}</dd>}
    </div>
  )
}
