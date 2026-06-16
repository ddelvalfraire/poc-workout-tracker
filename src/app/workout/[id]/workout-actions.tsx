'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { deleteWorkoutAction } from '@/app/workout/actions'

/**
 * Detail-page action island: an Edit link to the edit route and a Delete button
 * that confirms, deletes (cascade), then navigates home. Kept small so the
 * detail page itself stays a Server Component.
 */
export function WorkoutActions({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleDelete() {
    if (!window.confirm('Delete this workout? This cannot be undone.')) return
    startTransition(async () => {
      try {
        setError(null)
        await deleteWorkoutAction(id)
        router.push('/')
      } catch {
        setError('Could not delete workout. Please try again.')
      }
    })
  }

  return (
    <div className="mt-6 space-y-2">
      <Link href={`/workout/new?from=${id}`} className={cn(buttonVariants(), 'w-full')}>
        ↻ Repeat workout
      </Link>
      <div className="flex gap-2">
        <Link
          href={`/workout/${id}/edit`}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
        >
          Edit
        </Link>
        <Button variant="destructive" className="flex-1" disabled={isPending} onClick={handleDelete}>
          {isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
