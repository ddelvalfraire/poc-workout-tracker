import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getWorkoutDetail } from '@/db/workouts'
import { detailToDraft } from '@/app/workout/new/workout-draft'
import { WorkoutLogger } from '@/app/workout/new/workout-logger'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  const workout = await getWorkoutDetail(userId, id)
  if (!workout) notFound()

  const { draft, name } = detailToDraft(workout)

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit Workout</h1>
        <Link
          href={`/workout/${id}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          Cancel
        </Link>
      </header>
      <WorkoutLogger workoutId={id} initialDraft={draft} initialName={name} />
    </main>
  )
}
