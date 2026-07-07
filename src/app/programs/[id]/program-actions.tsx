'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { deleteProgramAction, setProgramStatusAction } from '@/app/programs/actions'

/**
 * Detail-page action island: an Edit link to the builder in edit mode, a status
 * toggle (draft/archived → active, active → archived), and a Delete button that
 * confirms inline (two-step, in-brand — no window.confirm), deletes (cascade),
 * then navigates to the list. Kept small so the detail page itself stays a
 * Server Component.
 */
export function ProgramActions({
  id,
  status,
}: {
  id: string
  status: 'draft' | 'active' | 'archived'
}) {
  const [isPending, startTransition] = useTransition()
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const nextStatus = status === 'active' ? 'archived' : 'active'
  const statusLabel = status === 'active' ? 'Archive' : 'Activate'

  function handleStatusToggle() {
    startTransition(async () => {
      try {
        setError(null)
        await setProgramStatusAction(id, nextStatus)
        router.refresh()
      } catch {
        setError('Could not update program status. Please try again.')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        setError(null)
        await deleteProgramAction(id)
        router.push('/programs')
      } catch {
        setIsConfirming(false)
        setError('Could not delete program. Please try again.')
      }
    })
  }

  return (
    <div className="mt-6 space-y-2">
      {isConfirming ? (
        <div
          role="alertdialog"
          aria-label="Confirm program deletion"
          className="rounded-2xl border border-destructive/40 bg-card p-4"
        >
          <p className="text-sm font-medium">Delete this program?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Its days and targets go with it. This cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={isPending}
              onClick={() => setIsConfirming(false)}
              autoFocus
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={isPending}
              onClick={handleDelete}
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
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
          <Button
            variant="destructive"
            className="flex-1"
            disabled={isPending}
            onClick={() => setIsConfirming(true)}
          >
            Delete
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
