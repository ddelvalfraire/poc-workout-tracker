'use client'

import { useReducer, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { saveWorkoutAction } from '@/app/workout/actions'
import { ExercisePicker } from './exercise-picker'
import {
  workoutDraftReducer,
  draftToInput,
  emptyDraft,
  newDraftExercise,
  newDraftSet,
} from './workout-draft'

export function WorkoutLogger() {
  const [draft, dispatch] = useReducer(workoutDraftReducer, emptyDraft)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const isEmpty = draft.exercises.length === 0

  function handleSave() {
    startTransition(async () => {
      try {
        setError(null)
        await saveWorkoutAction(draftToInput(draft, name))
        router.push('/')
      } catch {
        setError('Could not save workout. Please try again.')
      }
    })
  }

  return (
    <div className="mt-6 space-y-4">
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
              <span className="font-normal text-muted-foreground"> · {exercise.category}</span>
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

      <Button className="w-full" disabled={isEmpty || isPending} onClick={handleSave}>
        {isPending ? 'Saving…' : 'Save workout'}
      </Button>
    </div>
  )
}
