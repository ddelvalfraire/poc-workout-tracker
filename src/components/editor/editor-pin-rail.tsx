import { cn } from '@/lib/utils'

/**
 * The mark for a week the user PINNED by hand, as opposed to one the rule
 * derived. One encoding, used by every editor surface that has to tell the two
 * apart: the set rows in pane 2, and every cell of the exercise-wise pivot.
 *
 * THE CHANNEL IS POSITION, NOT INTENSITY. A rule at a fixed x inside the row
 * or cell, so a column of interventions reads as a vertical spine in one
 * glance. The alternative — dimming the derived side — was measured at 2.27:1
 * against the authored side, under the 3:1 a non-colour distinction needs, and
 * it could not be fixed by tuning: lightness alone is not a distinction under
 * WCAG 1.4.1. Position ranks first for categorical detection; luminance ranks
 * last. So derived is the UNMARKED default at FULL contrast, and authored
 * carries the rail.
 *
 * Colour is therefore redundant rather than load-bearing — the rail is legible
 * as geometry with the hue removed — which is what lets it wear the volt
 * without the accent becoming the distinction.
 *
 * The rail is `aria-hidden` on purpose: it is one half of a pairing whose other
 * half is the WORD on the row, which every call site renders. Announcing a
 * decorative span would put the same fact in the accessibility tree twice.
 *
 * The parent must establish a positioning context; every call site is already
 * `relative` for its own layout.
 */
function PinRail({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary', className)}
    />
  )
}

export { PinRail }
