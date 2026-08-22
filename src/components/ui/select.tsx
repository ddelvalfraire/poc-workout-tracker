'use client'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronsUpDown, ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The app's select. Wraps Base UI's Select so the accessibility a native
 * `<select>` gives away for free — roving focus, typeahead, Home/End, Escape,
 * correct ARIA, focus return to the trigger — is not re-implemented by hand,
 * and dresses it in the field grammar `Input` already speaks.
 *
 * WHY NOT THE NATIVE CONTROL. `<select>` is unstyleable where it matters: the
 * option list is drawn by the OS, so it ignores our palette, our type scale and
 * our dark theme, and on iOS it becomes a full-height wheel that hides the form
 * behind it. It also cannot render what our options actually need — a value
 * with a second line explaining it, tabular numerals that line up, a disabled
 * option that says why. The nine hand-rolled `<select>` sites this replaces all
 * work around the same wall.
 *
 * The trigger deliberately mirrors `Input`: `h-11` (44px, the touch-target
 * minimum) and `text-base` (16px, which is what stops iOS zooming on focus). A
 * select a pixel shorter than the input above it would announce itself as a
 * different kind of thing, which it is not.
 *
 * The popup is the one place a shell is right. DESIGN.md's de-card rule governs
 * surfaces that sit IN the page; a popup floats above it and needs an edge to
 * stay legible against whatever it covers — that is a surface, not a card.
 */

/**
 * PASS `items`. The trigger shows the selected value, and Base UI resolves a
 * value to its human label through the root's `items` — a list of
 * `{ label, value }`. Without it the trigger renders the RAW VALUE, so a user
 * picking "Percent of 1RM" sees `percent-1rm` sitting in the field. The label
 * is not decoration: these values are wire identifiers.
 *
 * Only omit it when the value and the label are the same string.
 */
function SelectRoot<T>(props: SelectPrimitive.Root.Props<T>) {
  return <SelectPrimitive.Root {...props} />
}

interface SelectTriggerProps extends SelectPrimitive.Trigger.Props {
  /** Shown when nothing is selected yet. */
  placeholder?: string
  /**
   * NAME THE TRIGGER. Pair it with a `SelectLabel`, or pass `aria-label` when
   * the surrounding layout makes a visible label redundant (the dense
   * inspector rows). A trigger with neither is an unnamed button to a screen
   * reader — the selected value is content, not a name.
   */
  'aria-label'?: string
  /**
   * Drops the trigger to 32px. ONLY for pointer-dense contexts — the editor's
   * inspector at >=840px, where DESIGN.md permits rows to leave the 44px floor
   * "where the input is a pointer". Never on a phone-reachable surface.
   */
  dense?: boolean
}

function SelectTrigger({ className, placeholder, dense, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        // Deliberately Input's class list, so a select and a text field in the
        // same form read as one object with different innards.
        'flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-base outline-none transition-[color,box-shadow]',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
        dense ? 'h-8 text-sm' : 'h-11',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Value
        className="truncate text-left data-placeholder:text-muted-foreground"
        placeholder={placeholder}
      />
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        {/* Up-and-down, not a lone chevron: a single caret reads as "expands
            downward", but the popup may open in either direction. */}
        <ChevronsUpDown className="size-4" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/** A scroll affordance for lists taller than the available space. */
function SelectScrollArrow({ direction }: { direction: 'up' | 'down' }) {
  const Arrow = direction === 'up' ? SelectPrimitive.ScrollUpArrow : SelectPrimitive.ScrollDownArrow
  const Icon = direction === 'up' ? ChevronUp : ChevronDown
  return (
    <Arrow
      className={cn(
        'z-1 flex h-5 w-full cursor-default items-center justify-center bg-popover text-muted-foreground',
        direction === 'up' ? 'top-0' : 'bottom-0',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </Arrow>
  )
}

interface SelectContentProps extends SelectPrimitive.Popup.Props {
  /** Distance from the trigger. */
  sideOffset?: number
}

function SelectContent({ className, children, sideOffset = 6, ...props }: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="z-50 outline-hidden select-none"
        sideOffset={sideOffset}
        alignItemWithTrigger={false}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            // min-w matches the trigger so the list never looks detached from
            // the control that opened it; max-h is the space actually available.
            // rounded-lg, matching the trigger: the popup is the trigger's
            // list, so a wider radius would read as a different object.
            'min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
            'transition-[transform,opacity] duration-150 ease-out',
            'data-starting-style:scale-[0.98] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.98] data-ending-style:opacity-0',
            // DESIGN.md: full reduced-motion fallback.
            'motion-reduce:transition-none motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100',
            className,
          )}
          {...props}
        >
          <SelectScrollArrow direction="up" />
          <SelectPrimitive.List className="max-h-[var(--available-height)] scroll-py-5 overflow-y-auto p-1">
            {children}
          </SelectPrimitive.List>
          <SelectScrollArrow direction="down" />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

interface SelectItemProps extends SelectPrimitive.Item.Props {
  /**
   * A second line under the label. This is the reason the native control had
   * to go: "AMRAP cycle" means nothing without "last set to failure, then the
   * training max moves", and an `<option>` has nowhere to put that.
   */
  hint?: React.ReactNode
  /** Right-aligned value — a current setting, a count. Tabular. */
  trailing?: React.ReactNode
}

function SelectItem({ className, children, hint, trailing, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // The indicator column is reserved on EVERY row, selected or not, so
        // labels do not shift sideways as the selection moves.
        'grid min-h-11 cursor-default grid-cols-[1rem_1fr_auto] items-center gap-x-2.5 rounded-lg px-2.5 py-2 text-base outline-hidden select-none',
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="col-start-1 row-start-1 text-primary">
        <Check className="size-4" aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="col-start-2 row-start-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      {trailing ? (
        <span className="col-start-3 row-start-1 text-sm tabular-nums text-muted-foreground">
          {trailing}
        </span>
      ) : null}
      {hint ? (
        <span className="col-start-2 row-start-2 text-sm leading-snug text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </SelectPrimitive.Item>
  )
}

/** A labelled group, for lists long enough that flat scanning fails. */
function SelectGroup({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Group>
      <SelectPrimitive.GroupLabel className="px-2.5 pt-3 pb-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {label}
      </SelectPrimitive.GroupLabel>
      {children}
    </SelectPrimitive.Group>
  )
}

function SelectSeparator({ className }: { className?: string }) {
  return <SelectPrimitive.Separator className={cn('my-1 h-px bg-border', className)} />
}

/** The field label, wired to the trigger by the primitive. */
function SelectLabel({ className, ...props }: SelectPrimitive.Label.Props) {
  return (
    <SelectPrimitive.Label
      className={cn('cursor-default text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}

export {
  SelectRoot as Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectSeparator,
  SelectLabel,
}
