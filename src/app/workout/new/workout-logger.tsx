'use client'

import { useReducer, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { saveWorkoutAction, updateWorkoutAction } from '@/app/workout/actions'
import { ExercisePicker } from './exercise-picker'
import {
  workoutDraftReducer,
  draftToInput,
  emptyDraft,
  newDraftExercise,
  newDraftSet,
  type WorkoutDraft,
} from './workout-draft'

interface WorkoutLoggerProps {
  /** When set, the logger is in edit mode: Save updates this workout and returns to its detail page. */
  workoutId?: string
  initialDraft?: WorkoutDraft
  initialName?: string
}

export function WorkoutLogger({
  workoutId,
  initialDraft = emptyDraft,
  initialName = '',
}: WorkoutLoggerProps) {
  const [draft, dispatch] = useReducer(workoutDraftReducer, initialDraft)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const isEmpty = draft.exercises.length === 0

  function handleSave() {
    startTransition(async () => {
      try {
        setError(null)
        if (workoutId) {
          await updateWorkoutAction(workoutId, draftToInput(draft, name))
          router.push(`/workout/${workoutId}`)
        } else {
          await saveWorkoutAction(draftToInput(draft, name))
          router.push('/')
        }
      } catch {
        setError('Could not save workout. Please try again.')
      }
    })
  }

  return (
    <>
      <div className="space-y-4 py-6">
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

      {draft.exercises.map((exercise, exerciseIndex) => (
        <Card key={exercise.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {exercise.name}
              {exercise.category && (
                <span className="font-normal text-muted-foreground"> · {exercise.category}</span>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dispatch({ type: 'REMOVE_EXERCISE', index: exerciseIndex })}
              aria-label={`Remove ${exercise.name}`}
            >
              Remove
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {exercise.sets.map((set, setIndex) => (
              <div key={set.id} className="flex items-center gap-2">
                <span className="w-10 text-sm text-muted-foreground">Set {setIndex + 1}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="reps"
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
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  placeholder="kg"
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
                  aria-label={`Set ${setIndex + 1} weight in kg`}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => dispatch({ type: 'REMOVE_SET', exerciseIndex, setIndex })}
                  aria-label={`Remove set ${setIndex + 1}`}
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => dispatch({ type: 'ADD_SET', exerciseIndex, set: newDraftSet() })}
            >
              + Add set
            </Button>
          </CardContent>
        </Card>
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
