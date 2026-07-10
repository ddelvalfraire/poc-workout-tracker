'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { deleteBodyweightLogAction } from '@/app/actions'

interface BodyweightEntryRowProps {
  id: string
  /** Pre-formatted on the server (formatWorkoutDate) so this island stays dumb. */
  dateLabel: string
  /** Pre-formatted display-unit weight, e.g. "181.5 lb". */
  weightLabel: string
}

/**
 * One weigh-in history row with its delete affordance. Client island per row
 * (the list itself stays server-rendered): delete confirms in the shared
 * ConfirmDialog — removing an entry can silently change the current weight
 * scoring uses, so it earns a real confirm — then refreshes the route so the
 * hero/sparkline/prefs-derived readouts resync. Mirrors WorkoutActions'
 * dialog lifecycle (imperative close before any state that unmounts it).
 */
export function BodyweightEntryRow({ id, dateLabel, weightLabel }: BodyweightEntryRowProps) {
  const [isPending, setIsPending] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeDialogRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  async function handleDelete() {
    setIsPending(true)
    try {
      setError(null)
      await deleteBodyweightLogAction(id)
      // Release the top layer before the refresh unmounts this row — the
      // stranded-::backdrop race from ConfirmDialog's contract.
      closeDialogRef.current?.()
      setIsModalOpen(false)
      router.refresh()
    } catch {
      setError('Could not delete this entry. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground">{dateLabel}</span>
      <span className="ml-auto font-medium tnum">{weightLabel}</span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null) // a stale failure must not reopen with the dialog
          setIsModalOpen(true)
        }}
        aria-label={`Delete entry from ${dateLabel}`}
        // before:-inset-1 grows the invisible hit target past the small
        // glyph (the app's compact-row tap-target idiom); destructive tokens
        // only — delete never wears volt.
        className="relative shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors before:absolute before:-inset-1 hover:text-destructive focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
      {isModalOpen && (
        <ConfirmDialog
          title="Delete this entry?"
          body="Your current weight resyncs to the latest remaining one."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={error}
          isPending={isPending}
          onConfirm={handleDelete}
          onClose={() => setIsModalOpen(false)}
          closeRef={closeDialogRef}
        />
      )}
    </li>
  )
}
