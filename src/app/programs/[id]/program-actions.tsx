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
 * confirms, deletes (cascade), then navigates to the list. Kept small so the
 * detail page itself stays a Server Component.
 */
export function ProgramActions({
  id,
  status,
}: {
  id: string
  status: 'draft' | 'active' | 'archived'
}) {
  const [isPending, startTransition] = useTransition()
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
    if (!window.confirm('Delete this program? This cannot be undone.')) return
    startTransition(async () => {
      try {
        setError(null)
        await deleteProgramAction(id)
        router.push('/programs')
      } catch {
        setError('Could not delete program. Please try again.')
      }
    })
  }

  return (
    <div className="mt-6 space-y-2">
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
          onClick={handleDelete}
        >
          {isPending ? 'Working…' : 'Delete'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
