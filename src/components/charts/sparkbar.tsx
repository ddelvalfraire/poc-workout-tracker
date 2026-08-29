import { cn } from '@/lib/utils'

/**
 * Seven-block volume sparkbar (rolling 24h buckets from bucketDaySets, oldest
 * first) — extracted from the nav drawer so the home momentum panel renders
 * the SAME week shape instead of forking it. Presentational and aria-hidden:
 * the caller's status line carries the accessible fact. No hooks, so it works
 * in both server and client trees.
 */
export function Sparkbar({
  daySets,
  className,
  barClassName,
}: {
  daySets: number[]
  /** Container sizing override (drawer: default h-4; home panel goes taller). */
  className?: string
  /** Bar width override for larger renders. */
  barClassName?: string
}) {
  const max = Math.max(...daySets, 1)
  return (
    <span aria-hidden="true" className={cn('flex h-4 items-end gap-1', className)}>
      {daySets.map((sets, i) => (
        <span
          key={i}
          className={cn(
            'w-1.5 rounded-[2px]',
            sets > 0 ? 'bg-primary/70' : 'bg-muted',
            barClassName,
          )}
          // Zero-set blocks keep a 2px baseline so the week reads as 7 days.
          style={{ height: sets > 0 ? `${Math.max(20, (sets / max) * 100)}%` : '2px' }}
        />
      ))}
    </span>
  )
}
