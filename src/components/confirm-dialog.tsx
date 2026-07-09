'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Centered destructive-confirm modal — a TRUE modal, unlike the inline
 * role=group cards it replaced ("The modal does not show up in the right
 * place for delete it shows up near the bottom of the phone … It's not an an
 * actual modal"). Native <dialog> + showModal(): the browser owns the focus
 * trap AND makes the page behind genuinely inert — a screen reader's virtual
 * cursor can't walk behind it, which a hand-rolled Tab trap never guarantees.
 * Lifecycle mechanics are copied from plate-sheet.tsx / session-conflict-
 * dialog.tsx (the app's one dialog vocabulary); only the placement differs:
 * `m-auto` centers it in the top layer on both axes instead of the sheets'
 * `mt-auto mb-0` bottom pin.
 *
 * Contract: the dialog stays OPEN while onConfirm runs (isPending), so a
 * failure can surface `error` in-dialog and the user retries in place. On a
 * SUCCESS path that ends in navigation, the parent MUST call
 * `closeRef.current?.()` before router.push — relying on unmount cleanup to
 * close() races React's flush and can strand the ::backdrop over the
 * destination page, eating every tap (the #25 failure mode; see
 * session-conflict-dialog's handleContinue). closeRef (a plain ref the
 * dialog populates) was chosen over useImperativeHandle as the smallest
 * mechanism that lets a handler close imperatively mid-flow.
 */
interface ConfirmDialogProps {
  title: string
  body: string
  /** Idle label for the destructive button (e.g. "Delete"). */
  confirmLabel: string
  /** In-flight label (e.g. "Deleting…") shown while isPending. */
  pendingLabel: string
  error?: string | null
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
  /** Populated with an imperative close; call it before navigating on success. */
  closeRef?: RefObject<(() => void) | null>
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  pendingLabel,
  error,
  isPending,
  onConfirm,
  onClose,
  closeRef,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const keepButtonRef = useRef<HTMLButtonElement>(null)

  // Hand the parent an imperative close for navigation success paths (see
  // the contract above). An effect (not a render-time write — lint forbids
  // ref writes during render) is early enough: the parent only calls it from
  // its confirm handler, which can't fire before mount effects have run. The
  // closure reads dialogRef lazily, so one assignment stays current.
  useEffect(() => {
    if (!closeRef) return
    closeRef.current = () => {
      dialogRef.current?.close()
    }
    return () => {
      closeRef.current = null
    }
  }, [closeRef])

  // Same mount mechanics as plate-sheet.tsx: StrictMode-guarded showModal,
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
    // Safe default focus: "Keep it" — Enter on a just-opened destructive
    // dialog must never destroy anything.
    keepButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer: unmounting a modal dialog without
      // close() can strand its ::backdrop over the incoming page when the
      // unmount happens mid-navigation. Idempotent with closeRef's close().
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return (
    // Centered in the top layer: m-auto centers a <dialog> on BOTH axes (no
    // mt-auto/mb-0 bottom pin — that's the sheets' geometry, and exactly what
    // the user reported as "shows up near the bottom of the phone").
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        // Mid-confirm, Esc must not dismiss: the action is already fired and
        // closing would hide the pending/error state it resolves into.
        if (!isPending) onClose()
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
        if (!inside && !isPending) onClose()
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-sm rounded-2xl border border-border bg-card p-5 text-foreground backdrop:bg-black/60"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {/* Two-button row, both size-default: ≥44px targets. "Keep it" is the
          outline safe exit; the destructive confirm never wears volt. */}
      <div className="mt-4 flex gap-2">
        <Button
          ref={keepButtonRef}
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={onClose}
          autoFocus
        >
          Keep it
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          disabled={isPending}
          onClick={onConfirm}
        >
          {isPending ? pendingLabel : confirmLabel}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </dialog>
  )
}
