'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { deleteWorkoutAction } from '@/app/workout/actions'

/**
 * Detail-page action island: an Edit link to the edit route and a Delete button
 * that confirms inline (two-step, in-brand — no window.confirm), deletes
 * (cascade), then navigates home. Kept small so the detail page itself stays a
 * Server Component.
 */
export function WorkoutActions({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleDelete() {
    startTransition(async () => {
      try {
        setError(null)
        await deleteWorkoutAction(id)
        router.push('/')
      } catch {
        setIsConfirming(false)
        setError('Could not delete workout. Please try again.')
      }
    })
  }

  return (
    <div className="mt-6 space-y-2">
      <Link href={`/workout/new?from=${id}`} className={cn(buttonVariants(), 'w-full gap-2')}>
        <RotateCcw aria-hidden="true" className="size-4" />
        Repeat workout
      </Link>
      {isConfirming ? (
        <div
          role="alertdialog"
          aria-label="Confirm workout deletion"
          className="rounded-2xl border border-destructive/40 bg-card p-4"
        >
          <p className="text-sm font-medium">Delete this workout?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every logged set goes with it. This cannot be undone.
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
            href={`/workout/${id}/edit`}
            className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
          >
            Edit
          </Link>
          <Button variant="destructive" className="flex-1" onClick={() => setIsConfirming(true)}>
            Delete
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
