'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SessionToast } from '@/app/workout/new/session-toast'
import {
  previewUncompleteAction,
  uncompleteWorkoutAction,
  recompleteWorkoutAction,
} from '@/app/workout/actions'
import { hasCascade, type UncompleteCascade } from '@/lib/workout/uncomplete-cascade'

/**
 * GUARD 1 — un-completing a session, and the cascade it drags with it.
 *
 * This is a DECISION, so it interrupts. The other correction guard (the
 * inline reach disclosure) is information, so it never does; getting those
 * two the same way round is how a warning becomes wallpaper.
 *
 * Three rules carry the shape:
 *
 * - **Gated on the cascade existing.** The press first asks the server what
 *   would move. If nothing does, the session is un-completed immediately with
 *   no dialog at all — a modal that fires every time is a modal nobody reads.
 * - **Itemised, never prose, never "Are you sure?".** The dialog names the
 *   CASCADE — the block rolling back, the targets being worked out again —
 *   never the un-complete itself, which is the thing the user just asked for.
 *   Buttons name outcomes: "Keep it completed" against "Un-complete".
 * - **Modal AND undo.** No type-to-confirm: that is for breaking
 *   infrastructure, and spending it here is exactly the overuse that trains
 *   people to click through. The dialog handles the moment; the undo handles
 *   the year, once the dialog has become furniture.
 *
 * The dialog's confirm wears volt, which does not compete with the summary's
 * one volt moment: an overlay is a band of its own (DESIGN.md) — summoned,
 * naming its own subject, and never mistakable for the surface underneath.
 */

/** The undo window. Long enough to read the toast and change your mind,
 *  short enough that it never becomes a second piece of standing furniture. */
const UNDO_WINDOW_MS = 8_000

interface UncompleteSessionProps {
  workoutId: string
  /** Pre-resolved cascade, for the catalog only. Production leaves this
   *  undefined so the press does the dry run: the answer has to be current at
   *  the moment of the decision, not at the moment the page rendered. */
  previewOverride?: UncompleteCascade
}

/** What the undo needs to put the record back exactly as it was: the instant
 *  that was cleared, and what the cascade did, so the toast can say it. */
interface UndoWindow {
  completedAt: string
  weekTo: number | null
  resetKey: number
}

export function UncompleteSession({ workoutId, previewOverride }: UncompleteSessionProps) {
  const t = useTranslations('UncompleteSession')
  const router = useRouter()
  const [cascade, setCascade] = useState<UncompleteCascade | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<UndoWindow | null>(null)
  // ConfirmDialog's imperative close — see its contract. Called on the success
  // path so the top layer is released before the refresh repaints beneath it.
  const closeDialogRef = useRef<(() => void) | null>(null)

  /** The cascade, as lines. Both derive from the ONE dry-run fact, so the
   *  dialog can never itemise a consequence the write will not produce. */
  function cascadeItems(next: UncompleteCascade): string[] {
    const items: string[] = []
    if (next.weekRollback !== null) {
      items.push(t('cascade.week', { ...next.weekRollback }))
      // Not a second fact — it is what a rolled-back week MEANS for the next
      // session, and the half the lifter actually feels. Listed because
      // "back to week 3" on its own does not say it.
      items.push(t('cascade.targets'))
    }
    if (next.blockReopens) items.push(t('cascade.blockReopens'))
    return items
  }

  async function runUncomplete(next: UncompleteCascade) {
    setIsPending(true)
    setError(null)
    try {
      const { completedAt } = await uncompleteWorkoutAction(workoutId)
      closeDialogRef.current?.()
      setCascade(null)
      setUndo((previous) => ({
        completedAt,
        weekTo: next.weekRollback?.to ?? null,
        // Bumped, never reused: SessionToast keys its drain off this, and a
        // fresh window must restart the clock rather than inherit a spent one.
        resetKey: (previous?.resetKey ?? 0) + 1,
      }))
      setIsPending(false)
      router.refresh()
    } catch {
      setIsPending(false)
      // An open dialog surfaces this and the user retries in place.
      setError(t('error'))
    }
  }

  async function handlePress() {
    setError(null)
    setIsPending(true)
    try {
      const next = previewOverride ?? (await previewUncompleteAction(workoutId))
      // Nothing moves: no dialog, straight through — and the undo is still
      // offered. The undo is not the dialog's consolation prize; it is the
      // standing safety net on both paths.
      if (!hasCascade(next)) {
        await runUncomplete(next)
        return
      }
      setCascade(next)
      setIsPending(false)
    } catch {
      setIsPending(false)
      setError(t('error'))
    }
  }

  async function handleUndo() {
    if (!undo) return
    // Close the window first: it is spent either way, and leaving it up
    // through the round-trip invites a second press against a gone record.
    const spent = undo
    setUndo(null)
    try {
      await recompleteWorkoutAction(workoutId, spent.completedAt)
      router.refresh()
    } catch {
      setError(t('error'))
    }
  }

  return (
    <>
      {/* The undo, after the dialog. The logger's strip vocabulary: the drain
          hairline IS the window's clock, so pausing the visual pauses the
          timer and the two can never disagree. */}
      <SessionToast
        open={undo !== null}
        countdown={
          undo === null
            ? undefined
            : {
                durationMs: UNDO_WINDOW_MS,
                resetKey: undo.resetKey,
                onExpire: () => setUndo(null),
              }
        }
      >
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            {undo?.weekTo != null
              ? t('undo.messageWithWeek', { week: undo.weekTo })
              : t('undo.message')}
          </span>
          <Button variant="reversal" size="sm" className="shrink-0" onClick={handleUndo}>
            {t('undo.action')}
          </Button>
        </div>
      </SessionToast>

      {/* Demoted like Delete beside it: reopening a finished session is a
          repair, not an everyday action, and must not carry the weight of
          Repeat above it. */}
      <Button variant="ghost" className="w-full" disabled={isPending} onClick={handlePress}>
        {isPending && cascade === null ? t('pending') : t('action')}
      </Button>
      {/* Outside the dialog too: the no-cascade path has no dialog to put an
          error in, and a silent failure there would read as success. */}
      {error !== null && cascade === null && <p className="text-sm text-destructive">{error}</p>}

      {cascade !== null && (
        <ConfirmDialog
          title={t('dialog.title')}
          items={cascadeItems(cascade)}
          confirmLabel={t('dialog.confirm')}
          pendingLabel={t('dialog.pending')}
          cancelLabel={t('dialog.cancel')}
          // Affirmative, not destructive: nothing is lost, the record keeps
          // every set, and an undo follows. Dressing it in destructive red
          // would overstate what happens and blunt the colour where it counts.
          confirmVariant="default"
          error={error}
          isPending={isPending}
          onConfirm={() => void runUncomplete(cascade)}
          onClose={() => {
            setCascade(null)
            setError(null)
          }}
          closeRef={closeDialogRef}
        />
      )}
    </>
  )
}
