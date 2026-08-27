'use client'

import { useEffect, useRef, useState } from 'react'
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
 *
 * FOCUS IS HANDED BACK, BOTH WAYS. Enter commits and Escape reverts to the
 * value the field opened with, and either way the input UNMOUNTS while it
 * still holds focus — which drops focus on `<body>` and strands a keyboard
 * user at the top of the document. So the swap is bracketed: the field focuses
 * itself on mount, and the button that replaces it focuses itself on the way
 * back. The `<h2>` wraps both states so the document outline does not lose a
 * heading mid-interaction.
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
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The value the field opened with, so Escape has something to revert TO.
  // A ref, not state: it is read only by the two handlers that close the
  // field, and re-rendering on every keystroke to track it would be waste.
  const valueOnOpenRef = useRef(value)
  // Only steal focus back when the field is what the user was just using —
  // never on first paint, where focusing the title would rebuild the naming
  // gate the whole deferral exists to remove.
  const wasEditingRef = useRef(false)

  // A MOUNT effect, not `ref={(node) => node?.focus()}`: an inline ref
  // callback has a new identity every render, so React detaches and reattaches
  // it on every keystroke — which re-fired `.focus()` mid-typing.
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      wasEditingRef.current = true
      return
    }
    if (wasEditingRef.current) {
      wasEditingRef.current = false
      buttonRef.current?.focus()
    }
  }, [isEditing])

  function commit() {
    setIsEditing(false)
  }

  function cancel() {
    onValueChange(valueOnOpenRef.current)
    setIsEditing(false)
  }

  return (
    <h2 className={cn('min-w-0', className)}>
      {isEditing ? (
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => onValueChange(event.target.value)}
          // Blur commits: clicking away is not a cancel gesture, and the
          // reverting kind of blur would silently discard typing.
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          className="font-display text-xl uppercase tracking-tight"
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          onClick={() => {
            valueOnOpenRef.current = value
            setIsEditing(true)
          }}
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
      )}
    </h2>
  )
}

export { EditableTitle }
