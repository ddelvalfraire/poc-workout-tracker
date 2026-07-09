'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'
import { deleteProgramAction, setProgramStatusAction } from '@/app/programs/actions'

/**
 * Detail-page action island: an Edit link to the builder in edit mode, a status
 * toggle (draft/archived → active, active → archived), and a Delete button that
 * confirms in a centered modal (ConfirmDialog — a true <dialog>, replacing the
 * old inline card that sat low on the page), deletes (cascade), then navigates
 * to the list. Kept small so the detail page itself stays a Server Component.
 */
export function ProgramActions({
  id,
  status,
}: {
  id: string
  status: 'draft' | 'active' | 'archived'
}) {
  const [isPending, setIsPending] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Two error surfaces on purpose: a status-toggle failure renders on the
  // page (its control lives there), a delete failure renders INSIDE the
  // dialog (the user retries in place) — one shared string would show a
  // delete error twice, in the dialog and behind it.
  const [statusError, setStatusError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // ConfirmDialog populates this with an imperative close; the success path
  // calls it BEFORE router.push (see the dialog's contract — the #25
  // stranded-::backdrop race).
  const closeDialogRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  const nextStatus = status === 'active' ? 'archived' : 'active'
  const statusLabel = status === 'active' ? 'Archive' : 'Activate'

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot over the
  // destination (see workout-logger handleSave). Await, then navigate.
  async function handleStatusToggle() {
    setIsPending(true)
    try {
      setStatusError(null)
      await setProgramStatusAction(id, nextStatus)
      router.refresh()
    } catch {
      setStatusError('Could not update program status. Please try again.')
    } finally {
      // This handler stays mounted (refresh, not push) — always re-enable.
      setIsPending(false)
    }
  }

  async function handleDelete() {
    setIsPending(true)
    try {
      setDeleteError(null)
      await deleteProgramAction(id)
      // Release the top layer imperatively before navigating: relying on
      // unmount cleanup to close() races React's flush against router.push.
      closeDialogRef.current?.()
      setIsModalOpen(false)
      router.push('/programs')
      // isPending stays true on success: navigation unmounts this screen.
    } catch {
      setIsPending(false)
      // The dialog stays open: the error renders inside it, retry in place.
      setDeleteError('Could not delete program. Please try again.')
    }
  }

  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center gap-2">
        <Link
          href={`/programs/${id}/edit`}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
        >
          Edit
        </Link>
        <Button
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={handleStatusToggle}
        >
          {statusLabel}
        </Button>
        {/* Demoted on purpose: a destructive action should never carry the
            same visual weight as the everyday ones beside it. */}
        <Button
          variant="ghost"
          className="shrink-0 text-destructive"
          disabled={isPending}
          onClick={() => {
            setDeleteError(null) // a stale failure must not reopen with the dialog
            setIsModalOpen(true)
          }}
        >
          Delete
        </Button>
      </div>
      {statusError && <p className="text-sm text-destructive">{statusError}</p>}
      {isModalOpen && (
        <ConfirmDialog
          title="Delete this program?"
          body="Its days and targets go with it. This cannot be undone."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={deleteError}
          isPending={isPending}
          onConfirm={handleDelete}
          onClose={() => setIsModalOpen(false)}
          closeRef={closeDialogRef}
        />
      )}
    </div>
  )
}
