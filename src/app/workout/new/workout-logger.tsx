'use client'

import { useEffect, useReducer, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  saveWorkoutAction,
  updateWorkoutAction,
  getLastPerformanceAction,
  getWorkoutDraftAction,
  putWorkoutDraftAction,
  deleteWorkoutDraftAction,
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
import { draftKey, buildDraftPayload, parseDraftPayload } from './draft-payload'
import { SessionClock } from './session-clock'
import { type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { placeholderForSet, planPlaceholderForSet, type PlanSetTarget } from '@/lib/format'
import type { LastPerformance } from '@/db/workouts'

// One server write per pause in activity; long enough to coalesce a burst of
// keystrokes, short enough that little is lost to a sudden tab close.
const DRAFT_SYNC_DEBOUNCE_MS = 800

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
  /** The persisted session start, for edit mode; new sessions clock from open time. */
  startedAt?: Date
}

export function WorkoutLogger({
  workoutId,
  initialDraft = emptyDraft,
  initialName = '',
  unit = 'kg',
  planTargets,
  startedAt,
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
  // instant. Edits keep the workout's existing startedAt. State (not a ref)
  // because a restored snapshot rewinds it to the original session start.
  const [openedAt, setOpenedAt] = useState<Date>(() => startedAt ?? new Date())
  // Makes the autosave effect skip its mount run: that run still sees the
  // first render's (server-seeded) draft and would overwrite the server draft
  // before the restore resolves. Nothing user-entered exists yet, so there is
  // nothing to sync until a change (or the restore) re-fires the effect.
  const skipPersistRef = useRef(true)
  // Set once the user changes anything. The async restore checks it before
  // applying, so a draft fetched over the network never clobbers input typed
  // while the request was in flight.
  const dirtyRef = useRef(false)
  // Set when a save starts. A pending debounce could otherwise fire mid-save
  // and re-put the draft the save action just deleted, resurrecting it as a
  // stale restore next session. Reset only if the save fails.
  const savingRef = useRef(false)
  const key = draftKey(workoutId)
  const router = useRouter()

  // Restore an interrupted session from the server draft (cross-device: a
  // session started on the phone resumes on the laptop). In edit mode this
  // intentionally wins over the server-seeded workout rows: a live draft is
  // newer than the row it was seeded from. Last writer wins across devices.
  useEffect(() => {
    let cancelled = false
    getWorkoutDraftAction(key)
      .then((payload) => {
        if (cancelled || dirtyRef.current) return
        // parseDraftPayload also clamps a future openedAt (clock skew) to now.
        const restored = parseDraftPayload(payload, { unit, now: new Date() })
        if (!restored) return
        dispatch({ type: 'RESTORE_DRAFT', draft: restored.draft })
        setName(restored.name)
        setOpenedAt(restored.openedAt)
      })
      .catch(() => {
        // Non-critical: restore is best-effort; the logger works without it.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: key/unit are stable per page load
  }, [])

  // Autosave every change to the server draft (debounced — one write per
  // pause, not per keystroke). Failures are swallowed: sync is best-effort
  // and logging must keep working offline-ish until Save.
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    dirtyRef.current = true
    const timer = setTimeout(() => {
      if (savingRef.current) return
      const isEmptyDraft = draft.exercises.length === 0 && !name.trim()
      const sync = isEmptyDraft
        ? deleteWorkoutDraftAction(key) // cleared out — drop the draft everywhere
        : putWorkoutDraftAction(key, buildDraftPayload({ draft, name, unit, openedAt }))
      sync.catch(() => {})
    }, DRAFT_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, name, unit, openedAt, key])

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
        savingRef.current = true // freeze autosave: the save deletes the draft
        // The save actions delete this surface's server draft themselves —
        // the saved workout supersedes it on every device.
        if (workoutId) {
          await updateWorkoutAction(workoutId, draftToInput(draft, name, unit))
          router.push(`/workout/${workoutId}`)
        } else {
          await saveWorkoutAction({
            ...draftToInput(draft, name, unit),
            // Live session bounds: opened → saved. Without the explicit
            // completedAt the DB layer would fall back to startedAt (the
            // backdating default) and every live log would read as 0 min.
            startedAt: openedAt,
            completedAt: new Date(),
          })
          router.push('/')
        }
      } catch {
        savingRef.current = false // save failed — resume autosave
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

        <SessionClock startedAt={openedAt} />

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
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'TOGGLE_SET_COMPLETED', exerciseIndex, setIndex })
                    }
                    aria-pressed={set.completed}
                    aria-label={`Mark set ${setIndex + 1} complete`}
                    className={cn(
                      'relative grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tnum transition-colors',
                      // Invisible inset expands the tap target toward HIG size
                      // without growing the visual circle or shifting the row
                      // (Tailwind v4 injects content on before: automatically).
                      'before:absolute before:-inset-1.5',
                      set.completed
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {set.completed ? (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      setIndex + 1
                    )}
                  </button>
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
