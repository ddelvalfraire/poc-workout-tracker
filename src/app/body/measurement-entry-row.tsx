'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { deleteMeasurementAction } from '@/app/actions'

interface MeasurementEntryRowProps {
  id: string
  /** Pre-formatted on the server (formatWorkoutDate) so this island stays dumb. */
  dateLabel: string
  /** Pre-formatted display-unit value, e.g. "33.5 in". */
  valueLabel: string
}

/**
 * One measurement history row with its delete affordance — the bodyweight
 * entry-row pattern minus the resync stakes (nothing scores off a girth, so
 * the confirm copy is plain). Client island per row; the list stays
 * server-fed. Same imperative dialog-close-before-refresh contract.
 */
export function MeasurementEntryRow({ id, dateLabel, valueLabel }: MeasurementEntryRowProps) {
  const [isPending, setIsPending] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeDialogRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  async function handleDelete() {
    setIsPending(true)
    try {
      setError(null)
      await deleteMeasurementAction(id)
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
      <span className="ml-auto font-medium tnum">{valueLabel}</span>
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
          body="It disappears from the history and the trend."
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
