'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, X } from 'lucide-react'
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
  buildStoredProgramDraft,
  parseStoredProgramDraft,
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
  const [isPending, setIsPending] = useState(false)
  const router = useRouter()
  // Local draft persistence: the builder is a long phone form with no server
  // draft (unlike the logger) — a backgrounded-tab kill would otherwise
  // destroy a 30-set program mid-build. Keyed per surface; a live local draft
  // wins over the server-seeded rows it was forked from (logger rationale).
  const storageKey = `program-draft:${programId ?? 'new'}`
  // Value-based change detection, immune to StrictMode double-runs (same
  // pattern as the logger's autosave): mount snapshot skips the seeded render.
  const lastSnapshotRef = useRef<string | null>(null)

  // Whether this render is showing a restored local draft. Restore must be
  // VISIBLE: `/programs/new` shares one storage slot, so without a banner an
  // abandoned Program A would silently seed an unrelated Program B, and in
  // edit mode a stale local draft would silently beat newer server rows.
  const [wasRestored, setWasRestored] = useState(false)

  // Restore an interrupted build. localStorage is sync, so this lands before
  // the user can type; parse validates shape, version, and TTL.
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(storageKey)
    } catch {
      return // storage unavailable (private mode) — the builder works without it
    }
    if (!stored) return
    const restored = parseStoredProgramDraft(stored, new Date())
    if (restored) {
      dispatch({ type: 'RESTORE_DRAFT', draft: restored })
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync from localStorage (external system)
      setWasRestored(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: storageKey is stable per page load
  }, [])

  function handleDiscardRestored() {
    clearStoredDraft()
    // Pre-seed the snapshot ref so the persist effect sees "no change" and
    // doesn't immediately re-write the discarded draft back to storage.
    lastSnapshotRef.current = JSON.stringify(initialDraft)
    dispatch({ type: 'RESTORE_DRAFT', draft: initialDraft })
    setWasRestored(false)
  }

  // Persist every change. Drafts are small (the server caps programs long
  // before localStorage limits matter), so no debounce.
  useEffect(() => {
    const snapshot = JSON.stringify(draft)
    if (lastSnapshotRef.current === snapshot) return
    const isMount = lastSnapshotRef.current === null
    lastSnapshotRef.current = snapshot
    if (isMount) return // seeded first render — nothing user-entered yet
    try {
      window.localStorage.setItem(storageKey, buildStoredProgramDraft(draft, new Date()))
    } catch {
      // Quota/private mode: persistence is best-effort, never blocks editing.
    }
  }, [draft, storageKey])

  function clearStoredDraft() {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Best-effort; an orphaned draft expires via TTL anyway.
    }
  }

  // Mirror the server's Zod minimums (≥1 day, ≥1 exercise per day, ≥1 set per
  // exercise) so Save is disabled instead of guaranteed to fail.
  const isIncomplete =
    draft.days.length === 0 ||
    draft.days.some(
      (day) => day.exercises.length === 0 || day.exercises.some((e) => e.sets.length === 0),
    )

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot over the
  // destination (see workout-logger handleSave). Await, then navigate.
  async function handleSave() {
    setIsPending(true)
    try {
      setError(null)
      if (programId) {
        await updateProgramAction(programId, draftToProgramInput(draft, unit))
        clearStoredDraft() // the saved program supersedes the local draft
        router.push(`/programs/${programId}`)
      } else {
        const { id } = await saveProgramAction(draftToProgramInput(draft, unit))
        clearStoredDraft()
        router.push(`/programs/${id}`)
      }
    } catch {
      setIsPending(false)
      setError('Could not save program. Please try again.')
    }
  }

  return (
    <>
      <div className="space-y-4 py-5">
        {wasRestored && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5"
          >
            <p className="min-w-0 text-sm">Restored your unsaved draft.</p>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={handleDiscardRestored}>
                Discard
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWasRestored(false)}>
                Keep
              </Button>
            </div>
          </div>
        )}

        <Input
          placeholder="Program name"
          value={draft.name}
          onChange={(e) => dispatch({ type: 'SET_META', field: 'name', value: e.target.value })}
          aria-label="Program name"
        />

        <div className="flex gap-2">
          <Input
            type="text"
            inputMode="numeric"
            placeholder="Weeks (default 1)"
            value={draft.mesocycleWeeks}
            onChange={(e) =>
              dispatch({ type: 'SET_META', field: 'mesocycleWeeks', value: e.target.value })
            }
            aria-label="Program length in weeks"
            className="flex-1 tnum"
          />
          <Input
            type="text"
            inputMode="numeric"
            placeholder="Deload week (optional)"
            value={draft.deloadWeek}
            onChange={(e) =>
              dispatch({ type: 'SET_META', field: 'deloadWeek', value: e.target.value })
            }
            aria-label="Deload week"
            aria-describedby="deload-hint"
            className="flex-1 tnum"
          />
        </div>
        <p id="deload-hint" className="px-1 text-sm text-muted-foreground">
          A deload week eases the load partway through so you recover before the next block.
        </p>

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
                <Trash2 aria-hidden="true" className="size-4" />
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
                    {/* Trash2 = container (day, exercise); X = single row
                        (set) — one glyph per meaning, matching the logger. */}
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>

                {exercise.sets.length > 0 && (
                  <div className="flex items-center gap-2 px-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="w-6 shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-center">Rep min</span>
                    <span className="flex-1 text-center">Rep max</span>
                    <span className="flex-[1.4] text-center">{unit}</span>
                    <span className="flex-1 text-center">RPE</span>
                    <span className="flex-1 text-center">Rest s</span>
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
                          // Per-set rest target in seconds — the granularity
                          // the product asked for ("per exercise per set").
                          // Rides the same UPDATE_SET path as its siblings.
                          {
                            field: 'restSec',
                            label: 'rest in seconds',
                            mode: 'numeric',
                            value: set.restSec,
                          },
                        ] as const
                      ).map(({ field, label, mode, value }) => (
                        <Input
                          key={field}
                          type="text"
                          inputMode={mode}
                          // Rest is the one optional-feeling column; the ghost
                          // hint says what the blank means without a legend.
                          placeholder={field === 'restSec' ? 'Rest s' : undefined}
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
                        <X aria-hidden="true" className="size-4" />
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
