'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteWorkoutDraftAction, deleteWorkoutAction } from '@/app/workout/actions'
import { activeSessionHref } from '@/lib/active-session'
import { discardSession } from '@/lib/discard-session'

/**
 * Bottom sheet shown when starting a NEW workout would collide with a live
 * one ("Users if in an active workout should be shown a dialog to coninue or
 * delete their existing one"). One session at a time is the product rule —
 * two live drafts fight over the home banner and the lifter's attention.
 * Continue is the volt action (protecting logged work is the happy path);
 * discard wears destructive tokens and only then runs the caller's original
 * intent via `onProceed`.
 *
 * Judgment call: the guard lives on the START AFFORDANCES (home CTAs, Repeat,
 * program Start buttons), not on the /workout/new route itself. Typing that
 * URL while an edit-mode session is live slips past the dialog — a deep-link
 * edge we accept: the quick-log surface restores its own draft harmlessly,
 * and the home banner keeps surfacing the live session either way. Guarding
 * the route would need a server redirect or a client interstitial on every
 * logger mount, taxing the common path for a corner case.
 */

/** The slice of an active session the dialog needs — projected from ActiveSession. */
export interface SessionSummary {
  /** Draft surface: 'new' (/workout/new) or a workout uuid (edit mode). */
  key: string
  name: string | null
  setCount: number
  completedSetCount: number
}

interface SessionConflictDialogProps {
  session: SessionSummary
  onClose: () => void
  /** The caller's original "start" intent, run only after a successful discard. */
  onProceed: () => void | Promise<void>
}

export function SessionConflictDialog({ session, onClose, onProceed }: SessionConflictDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  // Native <dialog> + showModal(): the browser owns the focus trap AND makes
  // the page behind genuinely inert — a screen reader's virtual cursor can't
  // walk behind the sheet, which a hand-rolled Tab trap never guarantees.
  // We keep manual body scroll lock (dialog doesn't lock it), initial focus
  // on the visible ×, and focus restore on unmount. (Same mechanics as
  // plate-sheet.tsx — the app's one dialog vocabulary.)
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

  function handleContinue() {
    // Release the top layer IMPERATIVELY before navigating: onClose only
    // schedules the parent's state update, and relying on unmount cleanup to
    // run before router.push races React's flush — the stranded-::backdrop
    // failure mode #25 fixed. close() here is idempotent with the cleanup's.
    dialogRef.current?.close()
    onClose()
    router.push(activeSessionHref(session.key))
  }

  async function handleDiscardAndProceed() {
    setIsPending(true)
    try {
      setError(null)
      // Shared, unit-tested destructive ordering (lib/discard-session): ONE
      // delete per surface — the draft for a quick-log session, the workout
      // for an edit-mode session (its action clears the keyed draft in the
      // same server call, so there's a single user-visible failure point).
      await discardSession(session.key, {
        deleteDraft: deleteWorkoutDraftAction,
        deleteWorkout: deleteWorkoutAction,
      })
      // Only now the original intent (navigate / instantiate-then-navigate).
      // Not startTransition: navigating inside an async transition lets the
      // app-wide <ViewTransition> strand the old screen's snapshot over the
      // destination (see workout-actions.tsx). Await, then navigate.
      await onProceed()
      // Deliberately still pending: navigation unmounts us; re-enabling the
      // buttons here would flash an interactive dialog mid-transition.
    } catch {
      setIsPending(false)
      // No "nothing was changed" claim: the discard is one server call per
      // surface, but onProceed can also fail after a successful discard —
      // the copy must stay honest for both.
      setError('Could not finish discarding. Try again.')
    }
  }

  const meta =
    session.setCount > 0
      ? `${session.completedSetCount} of ${session.setCount} set${session.setCount === 1 ? '' : 's'} done`
      : null

  return (
    // Top-layer bottom sheet: margins pin it to the bottom edge, centered.
    // A click whose target is the <dialog> itself landed on ::backdrop
    // (children swallow their own clicks) — the standard light-dismiss trick.
    <dialog
      ref={dialogRef}
      aria-label="Workout in progress"
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        // Mid-discard, Esc must not dismiss: the actions are already fired
        // and closing would hide the error/pending state they resolve into.
        if (!isPending) onClose()
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
        if (!inside && !isPending) onClose()
      }}
      className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-x border-border bg-card px-5 pt-5 pb-safe text-foreground backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-3 pb-1">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
            {/* Pulsing dot, same as the home banner: this is the SAME live
                session the user saw there — one visual identity for it. */}
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Workout in progress
          </p>
          <h3 className="mt-2 truncate font-display text-2xl uppercase leading-none tracking-wide">
            {session.name ?? 'Unnamed session'}
          </h3>
          {meta && <p className="mt-1.5 text-sm text-muted-foreground tnum">{meta}</p>}
        </div>
        <Button
          ref={closeButtonRef}
          size="icon-sm"
          variant="ghost"
          className="-mr-1 shrink-0 text-muted-foreground"
          onClick={onClose}
          disabled={isPending}
          aria-label="Close"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* Stacked full-width actions, deliberate order: Continue (volt) on
          top because protecting an in-flight session is the safe default a
          rushed thumb should land on; the destructive path sits below it and
          Cancel — the do-nothing exit — is the quiet ghost at the bottom.
          All size-default/lg buttons: ≥44px targets, one-thumb reachable. */}
      <div className="mt-4 space-y-2 pb-4">
        <Button
          size="lg"
          className="w-full font-semibold uppercase tracking-wide"
          disabled={isPending}
          onClick={handleContinue}
        >
          Continue workout
        </Button>
        <Button
          variant="outline"
          className="w-full border-destructive/40 text-destructive"
          disabled={isPending}
          onClick={handleDiscardAndProceed}
        >
          {isPending ? 'Discarding…' : 'Discard & start new'}
        </Button>
        <Button variant="ghost" className="w-full" disabled={isPending} onClick={onClose}>
          Cancel
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </dialog>
  )
}
