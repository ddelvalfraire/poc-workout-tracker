'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * A labelled on/off row: the boolean sibling of `Choice`, shaped to match it
 * exactly so a settings column reads as one list whether a given setting is a
 * mode or a switch.
 *
 * THE TRACK IS THE APP'S EXISTING SWITCH, extracted rather than reinvented.
 * Eight files under `src/app/settings/` hand-roll the same `role="switch"`
 * button — a 28x48 track, a 22px thumb, and an invisible `before:-inset-2` that
 * lifts a compact control back over the 44px touch floor. Those copies own
 * their own persistence (optimistic flip, rollback, `router.refresh`), which is
 * why this is presentation only: it takes `checked` and reports changes, and
 * the caller decides what "on" costs. Any of them can adopt this for the track
 * without giving up their own write path.
 *
 * The hint sits INSIDE the label for the same reason it does in `Choice`: a
 * description outside the accessible name is not announced when the control
 * takes focus, and "Sync plan to performance" explains itself to nobody.
 */

interface SwitchRowProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** The sentence explaining what flipping this actually does. */
  hint?: React.ReactNode
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

function SwitchRow({
  checked,
  onCheckedChange,
  hint,
  disabled,
  className,
  children,
}: SwitchRowProps) {
  const labelId = useId()
  const hintId = useId()
  return (
    <div
      // Disabled dims the CONTROL, never the text. The hint on a disabled row
      // is the sentence explaining why it is disabled, and a blanket opacity
      // drops it to 2.7:1 — unreadable, which defeats the one job it has.
      className={cn('flex min-h-11 items-start gap-3 py-3 text-base', className)}
    >
      {/* Not a <label> wrapper: the control is a button, and a label wrapping a
          button does not forward clicks the way it does for a real form
          control. The text is tied to the switch by aria-labelledby instead. */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className="leading-snug">
          {children}
        </span>
        {hint ? (
          <span id={hintId} className="text-sm leading-snug text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        // The hint is the DESCRIPTION here, not part of the name — unlike
        // Choice, where options are told apart by their hints. A switch has one
        // name and two states, so folding a sentence into the name would make
        // every announcement read the explanation again on every flip.
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          // The settings toggles' geometry verbatim, including the invisible
          // inset that restores the 44px target on a 28px-tall track.
          'relative mt-0.5 h-7 w-12 shrink-0 self-center rounded-full border transition-colors before:absolute before:-inset-2',
          'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
          checked ? 'border-primary bg-primary' : 'border-border bg-muted',
          disabled && 'opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
          )}
        />
      </button>
    </div>
  )
}

export { SwitchRow }
