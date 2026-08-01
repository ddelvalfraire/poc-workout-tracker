'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { archiveGoalAction, deleteGoalAction } from './actions'

interface GoalCardActionsProps {
  id: string
  label: string
  archived: boolean
}

/**
 * Quiet per-card controls: Archive (soft hide, no confirm — the row survives
 * in the archived list) and Delete (hard, behind the app's one ConfirmDialog
 * vocabulary). Text controls, not buttons — a goals list where every card
 * shouts two actions stops being about the goals.
 */
export function GoalCardActions({ id, label, archived }: GoalCardActionsProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function archive() {
    setError(null)
    startTransition(async () => {
      try {
        await archiveGoalAction(id)
        router.refresh()
      } catch {
        setError('Could not archive the goal.')
      }
    })
  }

  function confirmDelete() {
    setError(null)
    startTransition(async () => {
      try {
        await deleteGoalAction(id)
        setConfirmingDelete(false)
        router.refresh()
      } catch {
        setError('Could not delete the goal.')
      }
    })
  }

  const quietControl =
    'relative text-xs text-muted-foreground outline-none underline-offset-2 transition-colors before:absolute before:-inset-2 hover:underline focus-visible:underline'

  return (
    <div className="mt-3 flex items-center gap-5 border-t border-border pt-3">
      {!archived && (
        <button type="button" onClick={archive} disabled={isPending} className={quietControl}>
          Archive
        </button>
      )}
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        disabled={isPending}
        className={quietControl}
      >
        Delete
      </button>
      {error && !confirmingDelete && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete "${label}"?`}
          body="This removes the goal for good. Your training history is untouched."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={error}
          isPending={isPending}
          onConfirm={confirmDelete}
          onClose={() => {
            setConfirmingDelete(false)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
