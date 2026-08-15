import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Segmented control container: buttons rendered flush inside one hairline
 * border, with a hairline divider between segments (DESIGN.md control
 * clusters — the frame is a hairline on the page background, never a card
 * shell).
 *
 * Sets `data-slot="button-group"` so button.tsx's `in-data-[slot=
 * button-group]:` size hooks activate. Children keep their own variants;
 * the group squares them (rounded-none) and stretches them (flex-1) so
 * segments share the width evenly.
 *
 * Deliberately NOT overflow-hidden: the touch-target insets rely on a
 * ::before extending past the 36px control, and an overflow clip on the
 * frame would remove exactly the extra hit area it exists to add. The
 * first/last segments inherit the frame's radius on their outer corners
 * instead, so hover fills never poke past the border. Segments use
 * hit-44-y (vertical-only): full hit-44 insets would overlap across the
 * 1px divider with no arbitration — the later sibling wins hit-testing,
 * so a tap near the divider could fire the opposite segment.
 */
function ButtonGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        'flex w-full rounded-lg border border-border',
        '*:data-[slot=button]:flex-1 *:data-[slot=button]:rounded-none',
        '[&>[data-slot=button]:first-child]:rounded-l-[inherit]',
        '[&>[data-slot=button]:last-child]:rounded-r-[inherit]',
        '[&>[data-slot=button]:not(:first-child)]:border-l',
        '[&>[data-slot=button]:not(:first-child)]:border-l-border',
        className,
      )}
      {...props}
    />
  )
}

export { ButtonGroup }
