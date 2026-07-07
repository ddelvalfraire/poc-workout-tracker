import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getWorkoutDetail, type WorkoutDetail } from '@/db/workouts'
import { getWeightUnit, getEquipment } from '@/db/preferences'
import { getProgramDayDetail, deriveDayPrescription } from '@/db/programs'
import type { PlanSetTarget } from '@/lib/format'
import { detailToDraft } from '@/app/workout/new/workout-draft'
import { WorkoutLogger } from '@/app/workout/new/workout-logger'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Per-exercise plan targets (keyed by wgerExerciseId) for a program-instantiated
 * workout — the ghost-placeholder fallback when an exercise has no prior
 * history. Derives the same week-N prescription instantiation seeded from, so
 * the ghosts match what the program page promised. Returns undefined for
 * ad-hoc workouts and when provenance is gone (day deleted/replaced — the
 * SET NULL caveat), so the logger falls back to history-only ghosts.
 * First slot wins if a day repeats an exercise.
 */
async function loadPlanTargets(
  userId: string,
  workout: WorkoutDetail,
): Promise<Record<number, PlanSetTarget[]> | undefined> {
  if (!workout.programDayId || !workout.programWeek) return undefined
  const day = await getProgramDayDetail(userId, workout.programDayId)
  if (!day) return undefined

  const derived = await deriveDayPrescription(userId, day, workout.programWeek)
  const targets: Record<number, PlanSetTarget[]> = {}
  day.exercises.forEach((exercise, i) => {
    if (exercise.wgerExerciseId in targets) return
    targets[exercise.wgerExerciseId] = derived[i].map((s) => ({
      repMin: s.repMin,
      repMax: s.repMax,
      loadKg: s.loadKg,
    }))
  })
  return targets
}

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

  const [planTargets, equipment] = await Promise.all([
    loadPlanTargets(userId, workout),
    getEquipment(userId, unit),
  ])
  const { draft, name } = detailToDraft(workout, unit)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Header action says "Close", not "Cancel": the autosaved draft
          survives and resumes from the home banner — nothing is cancelled. */}
      <AppHeader
        title="Edit Workout"
        trailing={
          <Link
            href={`/workout/${id}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Close
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <WorkoutLogger
          workoutId={id}
          initialDraft={draft}
          initialName={name}
          unit={unit}
          planTargets={planTargets}
          startedAt={workout.startedAt}
          equipment={equipment}
        />
      </main>
    </div>
  )
}
