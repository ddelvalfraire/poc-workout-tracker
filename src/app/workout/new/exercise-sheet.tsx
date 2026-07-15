'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExercisePicker } from './exercise-picker'

/**
 * Bottom sheet wrapping the exercise search — the picker moved out of the
 * logger's main flow so the workout body is only the workout, and adding an
 * exercise is a deliberate act from the sticky bar. Wraps ExercisePicker
 * UNCHANGED (the program builder shares it); this file owns only the dialog
 * chrome. Mechanics copied from PlateSheet — one sheet vocabulary app-wide.
 */

interface ExerciseSheetProps {
  /** Same shape the inline picker dispatched — the caller builds the draft exercise. */
  onAdd: (exercise: { wgerExerciseId: number; name: string; category: string }) => void
  onClose: () => void
  /** Sheet title — replace mode retitles the same sheet ("Replace Bench
   *  Press"); chrome only, the picker is untouched. */
  heading?: string
}

export function ExerciseSheet({ onAdd, onClose, heading = 'Add exercise' }: ExerciseSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Native <dialog> + showModal(): the browser owns the focus trap AND makes
  // the page behind genuinely inert — a screen reader's virtual cursor can't
  // walk behind the sheet, which a hand-rolled Tab trap never guarantees.
  // We keep manual body scroll lock (dialog doesn't lock it), initial focus
  // on the visible ×, and focus restore on unmount.
  useEffect(() => {
    const dialog = dialogRef.current
    // Restore target: only an element OUTSIDE the dialog (on a StrictMode
    // re-run the active element is our own close button).
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    // StrictMode re-runs effects against the SAME node; showModal() on an
    // already-open dialog throws InvalidStateError.
    if (dialog && !dialog.open) dialog.showModal()
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer: unmounting a modal dialog without
      // close() can strand its ::backdrop over the incoming page when the
      // unmount happens mid-navigation, eating every tap afterwards. The
      // manual focus restore stays as the fallback for targets close()'s
      // native restore doesn't cover.
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return (
    // Top-layer bottom sheet: margins pin it to the bottom edge, centered.
    // A click whose target is the <dialog> itself landed on ::backdrop
    // (children swallow their own clicks) — the standard light-dismiss trick.
    // max-h + scroll: the search results list can exceed a phone viewport.
    <dialog
      ref={dialogRef}
      aria-label={heading}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        onClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog`: taps in the
        // sheet's own padding and inter-section margin gaps also target the
        // dialog element and must not dismiss it.
        const rect = dialogRef.current?.getBoundingClientRect()
        if (!rect) return
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        if (!inside) onClose()
      }}
      // Full-height search takeover (the Hevy/Strong pattern), NOT a
      // content-sized sheet: a FIXED height means the sheet never lurches as
      // results appear/disappear per keystroke, and pinning the header +
      // search input at the TOP keeps typing usable when the iOS keyboard
      // overlays the bottom half (Safari never resizes the viewport; Android
      // does via interactiveWidget + dvh, see layout.tsx). Only the result
      // list scrolls — the input can't be scrolled out of view. The 8dvh
      // sliver of backdrop keeps it reading as a dismissible sheet.
      className="mx-auto mt-auto mb-0 flex h-[92dvh] w-full max-w-md flex-col rounded-t-2xl border-t border-x border-border bg-card px-5 pt-5 text-foreground backdrop:bg-black/60"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 pb-3">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-primary">
          {heading}
        </p>
        <Button
          ref={closeButtonRef}
          size="icon-sm"
          variant="ghost"
          className="-mr-1 text-muted-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* Single-add flow: the sheet closes on add so the freshly appended
          card is immediately visible where it landed — adding two in a row
          is two taps of the same always-there bar button. min-h-0 lets the
          picker's result list own the scroll instead of the dialog. */}
      <div className="flex min-h-0 flex-1 flex-col pb-safe">
        <ExercisePicker
          fill
          onAdd={(exercise) => {
            onAdd(exercise)
            onClose()
          }}
        />
      </div>
    </dialog>
  )
}
