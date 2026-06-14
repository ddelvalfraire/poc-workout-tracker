import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getWorkoutDetail } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { detailToDraft } from '@/app/workout/new/workout-draft'
import { WorkoutLogger } from '@/app/workout/new/workout-logger'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  const [workout, unit] = await Promise.all([
    getWorkoutDetail(userId, id),
    getWeightUnit(userId),
  ])
  if (!workout) notFound()

  const { draft, name } = detailToDraft(workout, unit)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Edit Workout"
        trailing={
          <Link
            href={`/workout/${id}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Cancel
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <WorkoutLogger workoutId={id} initialDraft={draft} initialName={name} unit={unit} />
      </main>
    </div>
  )
}
