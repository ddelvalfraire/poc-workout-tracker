'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A display heading you can type into: the program title as it appears at the
 * top of the builder.
 *
 * WHY NOT A LABELLED TEXT FIELD. A field at the top of a form reads as a gate —
 * the first thing to fill in before the work starts — and naming a block is the
 * LAST thing anyone knows. So the title renders as the heading it will become,
 * muted while it is an unfilled slot, and turns into a field only when pressed.
 * It is deliberately NOT autofocused on mount: focus belongs on the work, and
 * focusing here would rebuild the very gate the deferral removes.
 *
 * The accessible name is the same string in both states, so the control does
 * not rename itself halfway through being used. The pencil is decoration — the
 * button already announces what it does.
 */

interface EditableTitleProps {
  value: string
  onValueChange: (value: string) => void
  /** Shown, muted, when the value is empty. */
  placeholder: string
  /** Accessible name for the button AND the field it becomes. */
  label: string
  className?: string
}

function EditableTitle({
  value,
  onValueChange,
  placeholder,
  label,
  className,
}: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false)

  if (isEditing) {
    return (
      <Input
        // Focus on the ref rather than `autoFocus`: this only ever runs
        // because the user just pressed the heading, never on page load.
        ref={(node) => {
          node?.focus()
        }}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => setIsEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') setIsEditing(false)
        }}
        className={cn('font-display text-xl uppercase tracking-tight', className)}
      />
    )
  }

  return (
    <h2 className={cn('min-w-0', className)}>
      <button
        type="button"
        aria-label={label}
        onClick={() => setIsEditing(true)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        <span
          className={cn(
            'min-w-0 truncate font-display text-2xl uppercase leading-tight tracking-tight',
            value.trim() === '' && 'text-muted-foreground',
          )}
        >
          {value.trim() === '' ? placeholder : value}
        </span>
        <Pencil aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </h2>
  )
}

export { EditableTitle }
