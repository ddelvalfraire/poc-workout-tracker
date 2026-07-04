'use client'

import { useEffect, useReducer, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  saveWorkoutAction,
  updateWorkoutAction,
  getLastPerformanceAction,
} from '@/app/workout/actions'
import { ExercisePicker } from './exercise-picker'
import {
  workoutDraftReducer,
  draftToInput,
  emptyDraft,
  newDraftExercise,
  newDraftSet,
  type WorkoutDraft,
} from './workout-draft'
import { type WeightUnit } from '@/lib/units'
import { placeholderForSet, planPlaceholderForSet, type PlanSetTarget } from '@/lib/format'
import type { LastPerformance } from '@/db/workouts'

interface WorkoutLoggerProps {
  /** When set, the logger is in edit mode: Save updates this workout and returns to its detail page. */
  workoutId?: string
  initialDraft?: WorkoutDraft
  initialName?: string
  /** Weight display/entry unit; weights are converted to kg at save time. */
  unit?: WeightUnit
  /** Per-exercise planned targets (by wgerExerciseId) for program workouts —
   *  the ghost fallback when an exercise has no prior history. */
  planTargets?: Record<number, PlanSetTarget[]>
}

export function WorkoutLogger({
  workoutId,
  initialDraft = emptyDraft,
  initialName = '',
  unit = 'kg',
  planTargets,
}: WorkoutLoggerProps) {
  const [draft, dispatch] = useReducer(workoutDraftReducer, initialDraft)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [lastByExercise, setLastByExercise] = useState<Record<number, LastPerformance | null>>({})
  // Tracks exercise ids already fetched/in-flight so the effect never refetches.
  // A ref (not state) avoids a synchronous setState in the effect body.
  const requestedRef = useRef<Set<number>>(new Set())
  // When the user opened the logger — saved as startedAt for NEW workouts so
  // startedAt→completedAt reflects the real session length, not the save
  // instant. Edits keep the workout's existing startedAt.
  const openedAtRef = useRef<Date>(new Date())
  const router = useRouter()

  const isEmpty = draft.exercises.length === 0

  // Fetch prior performance once per distinct exercise (added now or pre-filled in
  // edit mode), to seed per-set ghost placeholders.
  useEffect(() => {
    const missing = Array.from(new Set(draft.exercises.map((e) => e.wgerExerciseId))).filter(
      (id) => !requestedRef.current.has(id),
    )
    if (missing.length === 0) return

    let cancelled = false
    for (const id of missing) requestedRef.current.add(id) // reserve before awaiting
    // Fetch all missing exercises concurrently — each call is independent and
    // updates state as it resolves, so N exercises cost one round-trip, not N.
    for (const id of missing) {
      getLastPerformanceAction(id, workoutId)
        .then((result) => {
          if (!cancelled) setLastByExercise((prev) => ({ ...prev, [id]: result }))
        })
        .catch(() => {
          // Non-critical: drop the reservation so a later render can retry.
          requestedRef.current.delete(id)
        })
    }
    return () => {
      cancelled = true
    }
  }, [draft.exercises, workoutId])

  function handleSave() {
    startTransition(async () => {
      try {
        setError(null)
        if (workoutId) {
          await updateWorkoutAction(workoutId, draftToInput(draft, name, unit))
          router.push(`/workout/${workoutId}`)
        } else {
          await saveWorkoutAction({
            ...draftToInput(draft, name, unit),
            startedAt: openedAtRef.current,
          })
          router.push('/')
        }
      } catch {
        setError('Could not save workout. Please try again.')
      }
    })
  }

  return (
    <>
      <div className="space-y-4 py-5">
        <Input
          placeholder="Workout name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Workout name"
        />

        <ExercisePicker
          onAdd={(exercise) =>
            dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(exercise) })
          }
        />

        {isEmpty && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            Search above to add your first exercise.
          </p>
        )}

        {draft.exercises.map((exercise, exerciseIndex) => (
          <section
            key={exercise.id}
            className="space-y-3 rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 text-base leading-tight">
                {exercise.name}
                {exercise.category && (
                  <span className="mt-0.5 block text-sm font-normal tracking-normal text-muted-foreground">
                    {exercise.category}
                  </span>
                )}
              </h3>
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mr-1 shrink-0 text-muted-foreground"
                onClick={() => dispatch({ type: 'REMOVE_EXERCISE', index: exerciseIndex })}
                aria-label={`Remove ${exercise.name}`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
              </Button>
            </div>

            {exercise.sets.length > 0 && (
              <div className="flex items-center gap-2 px-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="w-8 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-center">Reps</span>
                <span className="flex-1 text-center">{unit}</span>
                <span className="size-9 shrink-0" aria-hidden="true" />
              </div>
            )}

            <div className="space-y-2">
              {exercise.sets.map((set, setIndex) => {
                // History ghost ("what you did last time") wins; the plan's
                // week-N target fills in when there's no history — e.g. a
                // machine lift's first session, where nothing else renders.
                const history = placeholderForSet(
                  lastByExercise[exercise.wgerExerciseId] ?? null,
                  setIndex,
                  unit,
                )
                const plan = planPlaceholderForSet(
                  planTargets?.[exercise.wgerExerciseId],
                  setIndex,
                  unit,
                )
                const ghost = {
                  reps: history.reps ?? plan.reps,
                  weight: history.weight ?? plan.weight,
                }
                return (
                <div key={set.id} className="flex items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold tnum text-muted-foreground">
                    {setIndex + 1}
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder={ghost.reps}
                    value={set.reps}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_SET',
                        exerciseIndex,
                        setIndex,
                        field: 'reps',
                        value: e.target.value,
                      })
                    }
                    aria-label={`Set ${setIndex + 1} reps`}
                    className="flex-1 text-center tnum"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.5"
                    placeholder={ghost.weight}
                    value={set.weight}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_SET',
                        exerciseIndex,
                        setIndex,
                        field: 'weight',
                        value: e.target.value,
                      })
                    }
                    aria-label={`Set ${setIndex + 1} weight in ${unit}`}
                    className="flex-1 text-center tnum"
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => dispatch({ type: 'REMOVE_SET', exerciseIndex, setIndex })}
                    aria-label={`Remove set ${setIndex + 1}`}
                  >
                    ✕
                  </Button>
                </div>
                )
              })}
            </div>

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => dispatch({ type: 'ADD_SET', exerciseIndex, set: newDraftSet() })}
            >
              + Add set
            </Button>
          </section>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-background/85 px-5 pt-3 pb-safe backdrop-blur-md">
        <Button
          size="lg"
          className="w-full font-semibold uppercase tracking-wide"
          disabled={isEmpty || isPending}
          onClick={handleSave}
        >
          {isPending ? 'Saving…' : workoutId ? 'Save changes' : 'Save workout'}
        </Button>
      </div>
    </>
  )
}
