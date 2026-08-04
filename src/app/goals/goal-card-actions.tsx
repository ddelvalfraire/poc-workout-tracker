'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ellipsis } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { archiveGoalAction, deleteGoalAction } from './actions'

interface GoalCardActionsProps {
  id: string
  label: string
  archived: boolean
}

/**
 * The card's ⋯ overflow: Archive (soft hide, no confirm — the row survives
 * in the archived list) and Delete (hard, behind the app's one ConfirmDialog
 * vocabulary). Native <details> (the programs page's disclosure recipe — no
 * menu library exists and one card's two actions don't justify adding one);
 * the panel closes itself before any action runs so the dialog never stacks
 * on an open menu. Demoted to the header on purpose: a goals list where
 * every card shouts two actions stops being about the goals.
 */
export function GoalCardActions({ id, label, archived }: GoalCardActionsProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const router = useRouter()

  function closeMenu() {
    if (detailsRef.current !== null) detailsRef.current.open = false
  }

  function archive() {
    closeMenu()
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

  const item =
    'block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'

  return (
    <div className="relative shrink-0">
      <details ref={detailsRef} className="group">
        <summary
          aria-label={`Actions for ${label}`}
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-open:bg-muted [&::-webkit-details-marker]:hidden"
        >
          <Ellipsis aria-hidden="true" className="size-4" />
        </summary>
        <div className="absolute right-0 top-9 z-10 w-36 rounded-xl border border-border bg-card p-1 shadow-lg">
          {!archived && (
            <button type="button" onClick={archive} disabled={isPending} className={item}>
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              closeMenu()
              setConfirmingDelete(true)
            }}
            disabled={isPending}
            className={`${item} text-destructive`}
          >
            Delete
          </button>
        </div>
      </details>

      {error && !confirmingDelete && (
        <p role="alert" className="absolute right-0 top-9 z-10 w-max text-xs text-destructive">
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
