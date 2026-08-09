import { cn } from '@/lib/utils'

/**
 * Pending-state placeholder (DESIGN.md § Pending states): a rounded bg-muted bar
 * that holds the EXACT box its content will occupy, so arrival never shifts
 * layout. The animate-ghost-in utility owns the behavior: base opacity 0 +
 * 150ms animation-delay means a fetch that beats the delay is never seen at
 * all, then a gentle 1.8s opacity pulse — no shimmer sweep, no new colors.
 * Under reduced motion the utility is inert and the bar sits static.
 *
 * Decorative by contract (aria-hidden): the surrounding surface stays the
 * accessible truth; a ghost never carries copy or state.
 */
export function Ghost({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded bg-muted motion-safe:animate-ghost-in', className)}
    />
  )
}
