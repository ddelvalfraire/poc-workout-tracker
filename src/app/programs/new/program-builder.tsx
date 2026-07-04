'use client'

import { useReducer, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExercisePicker } from '@/app/workout/new/exercise-picker'
import { saveProgramAction, updateProgramAction } from '@/app/programs/actions'
import {
  programDraftReducer,
  draftToProgramInput,
  emptyProgramDraft,
  newDraftProgramDay,
  newDraftProgramExercise,
  newDraftProgramSet,
  type ProgramDraft,
} from './program-draft'
import { type WeightUnit } from '@/lib/units'

interface ProgramBuilderProps {
  /** When set, the builder is in edit mode: Save updates this program and returns to its detail page. */
  programId?: string
  initialDraft?: ProgramDraft
  /** Load display/entry unit; loads are converted to kg at save time. */
  unit?: WeightUnit
}

export function ProgramBuilder({
  programId,
  initialDraft = emptyProgramDraft,
  unit = 'kg',
}: ProgramBuilderProps) {
  const [draft, dispatch] = useReducer(programDraftReducer, initialDraft)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  // Mirror the server's Zod minimums (≥1 day, ≥1 exercise per day, ≥1 set per
  // exercise) so Save is disabled instead of guaranteed to fail.
  const isIncomplete =
    draft.days.length === 0 ||
    draft.days.some(
      (day) => day.exercises.length === 0 || day.exercises.some((e) => e.sets.length === 0),
    )

  function handleSave() {
    startTransition(async () => {
      try {
        setError(null)
        if (programId) {
          await updateProgramAction(programId, draftToProgramInput(draft, unit))
          router.push(`/programs/${programId}`)
        } else {
          const { id } = await saveProgramAction(draftToProgramInput(draft, unit))
          router.push(`/programs/${id}`)
        }
      } catch {
        setError('Could not save program. Please try again.')
      }
    })
  }

  return (
    <>
      <div className="space-y-4 py-5">
        <Input
          placeholder="Program name"
          value={draft.name}
          onChange={(e) => dispatch({ type: 'SET_META', field: 'name', value: e.target.value })}
          aria-label="Program name"
        />

        <div className="flex gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="Weeks (default 1)"
            value={draft.mesocycleWeeks}
            onChange={(e) =>
              dispatch({ type: 'SET_META', field: 'mesocycleWeeks', value: e.target.value })
            }
            aria-label="Mesocycle weeks"
            className="flex-1 tnum"
          />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="Deload wk (none)"
            value={draft.deloadWeek}
            onChange={(e) =>
              dispatch({ type: 'SET_META', field: 'deloadWeek', value: e.target.value })
            }
            aria-label="Deload week"
            className="flex-1 tnum"
          />
        </div>

        {draft.days.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            Add a training day to start building your program.
          </p>
        )}

        {draft.days.map((day, dayIndex) => (
          <section key={day.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <Input
                placeholder={`Day ${dayIndex + 1} name`}
                value={day.name}
                onChange={(e) =>
                  dispatch({ type: 'RENAME_DAY', index: dayIndex, name: e.target.value })
                }
                aria-label={`Day ${dayIndex + 1} name`}
                className="min-w-0 flex-1"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mr-1 shrink-0 text-muted-foreground"
                onClick={() => dispatch({ type: 'REMOVE_DAY', index: dayIndex })}
                aria-label={`Remove day ${dayIndex + 1}`}
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

            <ExercisePicker
              onAdd={(exercise) =>
                dispatch({
                  type: 'ADD_EXERCISE',
                  dayIndex,
                  exercise: newDraftProgramExercise(exercise),
                })
              }
            />

            {day.exercises.length === 0 && (
              <p className="px-1 py-3 text-center text-sm text-muted-foreground">
                Search above to add an exercise to this day.
              </p>
            )}

            {day.exercises.map((exercise, exerciseIndex) => (
              <div key={exercise.id} className="space-y-2 rounded-xl border border-border p-3">
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
                    onClick={() =>
                      dispatch({ type: 'REMOVE_EXERCISE', dayIndex, index: exerciseIndex })
                    }
                    aria-label={`Remove ${exercise.name}`}
                  >
                    ✕
                  </Button>
                </div>

                {exercise.sets.length > 0 && (
                  <div className="flex items-center gap-2 px-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="w-6 shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-center">Rep min</span>
                    <span className="flex-1 text-center">Rep max</span>
                    <span className="flex-[1.4] text-center">{unit}</span>
                    <span className="flex-1 text-center">RPE</span>
                    <span className="size-9 shrink-0" aria-hidden="true" />
                  </div>
                )}

                <div className="space-y-2">
                  {exercise.sets.map((set, setIndex) => (
                    <div key={set.id} className="flex items-center gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tnum text-muted-foreground">
                        {setIndex + 1}
                      </span>
                      {(
                        [
                          { field: 'repMin', label: 'rep min', mode: 'numeric', value: set.repMin },
                          { field: 'repMax', label: 'rep max', mode: 'numeric', value: set.repMax },
                          {
                            field: 'load',
                            label: `load in ${unit}`,
                            mode: 'decimal',
                            value: set.load,
                          },
                          { field: 'rpe', label: 'RPE', mode: 'decimal', value: set.rpe },
                        ] as const
                      ).map(({ field, label, mode, value }) => (
                        <Input
                          key={field}
                          type="number"
                          inputMode={mode}
                          min={0}
                          step={mode === 'decimal' ? '0.5' : undefined}
                          value={value}
                          onChange={(e) =>
                            dispatch({
                              type: 'UPDATE_SET',
                              dayIndex,
                              exerciseIndex,
                              setIndex,
                              field,
                              value: e.target.value,
                            })
                          }
                          aria-label={`${exercise.name} set ${setIndex + 1} ${label}`}
                          // The load column gets extra width: 3-digit values +
                          // a decimal must not clip at the 390px PWA viewport.
                          className={`min-w-0 px-1 text-center tnum ${field === 'load' ? 'flex-[1.4]' : 'flex-1'}`}
                        />
                      ))}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground"
                        onClick={() =>
                          dispatch({ type: 'REMOVE_SET', dayIndex, exerciseIndex, setIndex })
                        }
                        aria-label={`Remove ${exercise.name} set ${setIndex + 1}`}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    dispatch({
                      type: 'ADD_SET',
                      dayIndex,
                      exerciseIndex,
                      set: newDraftProgramSet(),
                    })
                  }
                >
                  + Add set
                </Button>
              </div>
            ))}
          </section>
        ))}

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() =>
            dispatch({ type: 'ADD_DAY', day: newDraftProgramDay(`Day ${draft.days.length + 1}`) })
          }
        >
          + Add day
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-background/85 px-5 pt-3 pb-safe backdrop-blur-md">
        <Button
          size="lg"
          className="w-full font-semibold uppercase tracking-wide"
          disabled={isIncomplete || isPending}
          onClick={handleSave}
        >
          {isPending ? 'Saving…' : programId ? 'Save changes' : 'Save program'}
        </Button>
      </div>
    </>
  )
}
