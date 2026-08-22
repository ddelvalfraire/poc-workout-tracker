'use client'

import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'

import { cn } from '@/lib/utils'

/**
 * A single-choice list in the de-card vocabulary: hairline-separated rows, each
 * a label with an optional sentence explaining it, and no boxed fieldset.
 *
 * WHY THIS AND NOT A SELECT. The program form's choices are modes — deload
 * policy, diet phase, stall response — where the set is small, closed, and each
 * option needs a sentence to be intelligible. Hiding three explained options
 * behind a collapsed control forces the user to open it, read, close and
 * remember; leaving them visible lets the choice be READ. `Select` is for the
 * long or self-evident list (a week number, a movement); this is for the short
 * list where the reasoning matters.
 *
 * WHY THE WHOLE ROW IS THE TARGET. Each option is a `<label>` wrapping the
 * control, so the label text, the hint and the padding all activate it — an
 * 18px dot is far under the 44px touch floor, and the row is what the eye reads
 * as the button anyway.
 *
 * The hint sits INSIDE the label deliberately. A description placed outside the
 * accessible name is not announced when the radio takes focus, so a screen
 * reader user would hear "Reactive" with no more idea what it means than the
 * bare word gives a sighted one.
 */

interface ChoiceListProps<T extends string>
  extends Omit<RadioGroup.Props, 'value' | 'defaultValue' | 'onValueChange'> {
  /** The group's accessible name, rendered as the caption above the rows. */
  label: React.ReactNode
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  children: React.ReactNode
}

function ChoiceList<T extends string>({
  label,
  className,
  children,
  onValueChange,
  ...props
}: ChoiceListProps<T>) {
  return (
    <RadioGroup
      className={cn('block', className)}
      onValueChange={(value) => onValueChange?.(value as T)}
      {...props}
    >
      {/* Section's caption recipe (DESIGN.md), so a choice list and a section
          heading in the same column speak the same grammar. */}
      <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 divide-y divide-border/60 border-b border-b-border/60">{children}</div>
    </RadioGroup>
  )
}

interface ChoiceProps {
  value: string
  /**
   * The sentence that makes the option intelligible. Inside the label, so it is
   * part of the announced name rather than orphaned beside it.
   */
  hint?: React.ReactNode
  /** Right-aligned current value or count. */
  trailing?: React.ReactNode
  disabled?: boolean
  children: React.ReactNode
}

function Choice({ value, hint, trailing, disabled, children }: ChoiceProps) {
  return (
    <label
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-sm py-3 text-base',
        disabled ? 'cursor-default' : 'cursor-pointer',
        // Focus lands on the inner control, so the ring is drawn on the ROW —
        // otherwise an 18px ring floats beside the thing actually selected.
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
        // Disabled dims the DOT, never the text. WCAG exempts text inside an
        // inactive control from contrast, so axe passes a blanket opacity here
        // — but the hint on a disabled option is the sentence saying why it is
        // disabled, and at 2.7:1 nobody can read it. Exempt is not legible.
        disabled && 'pointer-events-none',
      )}
    >
      <Radio.Root
        value={value}
        disabled={disabled}
        className={cn(
          // No fill: the dot sits ON the page, so the border defines the circle
          // and the indicator fills it when checked. A raised fill would borrow
          // Input's field vocabulary for something that is not a field.
          'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border border-input p-0 outline-none',
          'data-checked:border-primary data-checked:text-primary',
          disabled && 'opacity-50',
        )}
      >
        <Radio.Indicator className="flex items-center justify-center before:size-2.5 before:rounded-full before:bg-current data-unchecked:hidden" />
      </Radio.Root>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="leading-snug">{children}</span>
        {hint ? <span className="text-sm leading-snug text-muted-foreground">{hint}</span> : null}
      </span>

      {trailing ? (
        <span className="shrink-0 self-center text-sm tabular-nums text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </label>
  )
}

export { ChoiceList, Choice }
