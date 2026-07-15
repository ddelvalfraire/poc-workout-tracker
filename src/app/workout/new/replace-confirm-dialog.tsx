'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

/**
 * The logged-work guard for a mid-session exercise swap: replacing an
 * exercise with completed sets discards those sets, so the pick pauses here
 * first. Three ways out — "Add instead" (safe default: appends the substitute
 * as a NEW exercise, the logged work stays), "Replace" (destructive, the swap
 * proceeds), or Esc/backdrop (cancel entirely, draft untouched).
 *
 * NOT a ConfirmDialog variant: its safe button ACTS rather than merely
 * closing, which ConfirmDialog's hardcoded "Keep it" cannot express. The
 * <dialog> lifecycle mechanics are copied verbatim from confirm-dialog.tsx —
 * the repo's one dialog vocabulary (StrictMode-guarded showModal, body scroll
 * lock, focus restore, geometric backdrop test). No isPending plumbing: both
 * actions are synchronous dispatches.
 */
interface ReplaceConfirmDialogProps {
  oldName: string
  newName: string
  /** Every set checked off (vs some) — only the title wording changes. */
  hasAllCompleted: boolean
  onReplace: () => void
  onAddInstead: () => void
  onClose: () => void
}

export function ReplaceConfirmDialog({
  oldName,
  newName,
  hasAllCompleted,
  onReplace,
  onAddInstead,
  onClose,
}: ReplaceConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addInsteadButtonRef = useRef<HTMLButtonElement>(null)

  // Same mount mechanics as confirm-dialog.tsx: StrictMode-guarded showModal,
  // manual body scroll lock (dialog doesn't lock it), initial focus on the
  // safe default, and close() + focus restore in cleanup.
  useEffect(() => {
    const dialog = dialogRef.current
    // Restore target: only an element OUTSIDE the dialog (on a StrictMode
    // re-run the active element is our own button).
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    // StrictMode re-runs effects against the SAME node; showModal() on an
    // already-open dialog throws InvalidStateError.
    if (dialog && !dialog.open) dialog.showModal()
    // Safe default focus: Enter on a just-opened destructive dialog must
    // never discard logged sets — it adds instead.
    addInsteadButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer: unmounting a modal dialog without
      // close() can strand its ::backdrop over the page, eating every tap.
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const title = `${oldName} is ${hasAllCompleted ? 'fully' : 'partially'} completed`

  return (
    // Centered in the top layer: m-auto centers a <dialog> on BOTH axes.
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        onClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog`: taps in the
        // dialog's own padding also target the dialog element and must not
        // dismiss it.
        const rect = dialogRef.current?.getBoundingClientRect()
        if (!rect) return
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        if (!inside) onClose()
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-sm rounded-2xl border border-border bg-card p-5 text-foreground backdrop:bg-black/60"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Replacing discards its logged sets. Add {newName} as a separate exercise to keep them.
      </p>
      {/* Two-button row, both size-default: ≥44px targets. Add-instead is the
          outline safe exit that ACTS; the destructive replace never wears volt. */}
      <div className="mt-4 flex gap-2">
        <Button
          ref={addInsteadButtonRef}
          variant="outline"
          className="flex-1"
          onClick={onAddInstead}
          autoFocus
        >
          Add instead
        </Button>
        <Button variant="destructive" className="flex-1" onClick={onReplace}>
          Replace
        </Button>
      </div>
    </dialog>
  )
}
