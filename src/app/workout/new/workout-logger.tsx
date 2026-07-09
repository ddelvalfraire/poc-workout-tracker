'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Dumbbell, Trash2, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppHeader } from '@/components/app-header'
import {
  saveWorkoutAction,
  updateWorkoutAction,
  getLastPerformanceAction,
  getWorkoutDraftAction,
  putWorkoutDraftAction,
  deleteWorkoutDraftAction,
} from '@/app/workout/actions'
import { ExerciseSheet } from './exercise-sheet'
import {
  workoutDraftReducer,
  draftToInput,
  emptyDraft,
  newDraftExercise,
  newDraftSet,
  type DraftExercise,
  type DraftSet,
  type WorkoutDraft,
} from './workout-draft'
import { draftKey, buildDraftPayload, parseDraftPayload } from './draft-payload'
import { createDraftSyncQueue, type DraftSyncQueue, type DraftSyncStatus } from './draft-sync'
import { HeaderClock } from './session-clock'
import { PlateSheet } from './plate-sheet'
import { RestSheet } from './rest-sheet'
import { resolveRestTarget } from '@/lib/rest-target'
import { DEFAULT_EQUIPMENT, type Equipment } from '@/lib/equipment'
import { LOGGING_TYPES, isLoggingType, type LoggingType } from '@/lib/workout-input'
import { type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import {
  placeholderForSet,
  planPlaceholderForSet,
  adoptableGhostValue,
  type PlanSetTarget,
} from '@/lib/format'
import type { LastPerformance } from '@/db/workouts'

/** How long the inline "Removed — Undo" affordance stays actionable. */
const UNDO_WINDOW_MS = 5000

/** Compact labels for the per-exercise logging-type select (Hevy-style). */
const LOGGING_TYPE_LABELS: Record<LoggingType, string> = {
  weight_reps: 'Weight × reps',
  bodyweight_reps: 'Bodyweight',
  weighted_bodyweight: 'BW + weight',
  assisted_bodyweight: 'BW − assist',
}

/** One reversible removal. Sets capture their exercise by STABLE id, not
 *  index — the exercise list can shift (or the exercise itself vanish and be
 *  undone back) before the user taps Undo. */
type RemovedEntry =
  | { kind: 'exercise'; exercise: DraftExercise; index: number }
  | { kind: 'set'; exerciseId: string; exerciseName: string; setIndex: number; set: DraftSet }

interface WorkoutLoggerProps {
  /** When set, the logger is in edit mode: Save updates this workout and returns to its detail page. */
  workoutId?: string
  /** Live session being logged now (Finish + running clock) vs correcting a
   *  finished workout (Save changes). NOT the same as !workoutId: a program
   *  session started from home is edit-mode WITH a workoutId, yet live. */
  isLive?: boolean
  /** Header title — the logger owns the app bar so the clock can live in it. */
  title: string
  /** Where the header's Close lands (the page decides; see the pages' comments). */
  closeHref: string
  initialDraft?: WorkoutDraft
  initialName?: string
  /** Weight display/entry unit; weights are converted to kg at save time. */
  unit?: WeightUnit
  /** Per-exercise planned targets (by wgerExerciseId) for program workouts —
   *  the ghost fallback when an exercise has no prior history. */
  planTargets?: Record<number, PlanSetTarget[]>
  /** The persisted session start, for edit mode; new sessions clock from open time. */
  startedAt?: Date
  /** The user's bars + plate denominations for the plate calculator (display unit). */
  equipment?: Equipment
  /** The user's stored default rest target (seconds) — seeds the session
   *  default the countdown falls back to when a set has no plan restSec. */
  defaultRestSec?: number | null
  /** Feature switch: false suppresses the whole rest surface — no readout,
   *  no countdown, plan targets ignored. The elapsed clock is unaffected. */
  restTimerEnabled?: boolean
}

export function WorkoutLogger({
  workoutId,
  isLive = true,
  title,
  closeHref,
  initialDraft = emptyDraft,
  initialName = '',
  unit = 'kg',
  planTargets,
  startedAt,
  equipment,
  defaultRestSec = null,
  restTimerEnabled = true,
}: WorkoutLoggerProps) {
  const [draft, dispatch] = useReducer(workoutDraftReducer, initialDraft)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // Prior performance per distinct exercise, for the per-set ghost
  // placeholders. TanStack Query owns dedupe/caching/retry (this replaced a
  // hand-rolled requestedRef cache); provider defaults keep ghosts fresh per
  // session and a tab refocus picks up sets logged elsewhere (e.g. via MCP).
  const exerciseIds = Array.from(new Set(draft.exercises.map((e) => e.wgerExerciseId)))
  const lastPerformanceQueries = useQueries({
    queries: exerciseIds.map((id) => ({
      queryKey: ['last-performance', id, workoutId ?? null],
      queryFn: () => getLastPerformanceAction(id, workoutId),
    })),
  })
  const lastByExercise: Record<number, LastPerformance | null> = {}
  exerciseIds.forEach((id, i) => {
    const result = lastPerformanceQueries[i].data
    if (result !== undefined) lastByExercise[id] = result
  })
  // When the user opened the logger — saved as startedAt for NEW workouts so
  // startedAt→completedAt reflects the real session length, not the save
  // instant. Edits keep the workout's existing startedAt. State (not a ref)
  // because a restored snapshot rewinds it to the original session start.
  const [openedAt, setOpenedAt] = useState<Date>(() => startedAt ?? new Date())
  // Value-based change detection for the autosave effect. Run-counting
  // ("skip the first run") breaks under StrictMode, which re-runs effects
  // with UNCHANGED deps: the mount re-run slipped past the consumed skip
  // flag, enqueued an empty-draft delete, and its dirty flag blocked the
  // restore — resuming a session from the home banner wiped the draft in
  // dev. Comparing snapshots is immune to double-runs by construction.
  const lastSnapshotRef = useRef<string | null>(null)
  // Set once the user changes anything. The async restore checks it before
  // applying, so a draft fetched over the network never clobbers input typed
  // while the request was in flight.
  const dirtyRef = useRef(false)
  const key = draftKey(workoutId)
  // Sync-failure signal for the offline hint; 'pending' is the constant
  // typing state and stays invisible.
  const [syncStatus, setSyncStatus] = useState<DraftSyncStatus>('synced')
  // The write-behind queue owns debounce + offline retry + the save-time
  // pause (a paused queue can't re-put the draft the save action deletes —
  // the resurrection race). Created once via the state initializer (never
  // re-set); `key` is stable per mount.
  const [queue] = useState<DraftSyncQueue>(() =>
    createDraftSyncQueue({
      send: (payload) => putWorkoutDraftAction(key, payload),
      remove: () => deleteWorkoutDraftAction(key),
      onStatus: setSyncStatus,
    }),
  )
  const router = useRouter()
  const queryClient = useQueryClient()
  // Gear is server-passed but user-editable inside the sheet; local state so a
  // save reflects immediately without a round-trip re-render.
  const [gear, setGear] = useState<Equipment>(equipment ?? DEFAULT_EQUIPMENT[unit])
  // Which exercise's plate sheet is open (by index), if any.
  const [plateSheetFor, setPlateSheetFor] = useState<number | null>(null)
  // Whether the add-exercise sheet is up — opened from the sticky bar, so
  // adding stays one thumb-reach away however deep the workout scrolls.
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  // Just-removed exercises AND sets, held as a stack for the inline Undo
  // window. Any removal mid-workout is a destructive slip (values gone,
  // autosave persists the loss within the debounce), so both levels must be
  // reversible — a stack (not a single slot) so rapid removals can't silently
  // drop an earlier undo. Each removal restarts the shared window; Undo
  // restores last-removed-first.
  const [removed, setRemoved] = useState<RemovedEntry[]>([])
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When the user last checked off a set — starts the between-sets rest
  // count-up. In-session only by design: a restored draft can't know how long
  // ago the interrupted session's last set really was.
  const [restStartedAt, setRestStartedAt] = useState<Date | null>(null)
  // The CURRENT rest period's plan-prescribed target (the completed set's
  // restSec), captured at check-off time. Kept separate from the session
  // default instead of pre-merged so the two stay independently live: editing
  // the default mid-rest retargets a default-driven countdown instantly but
  // never overwrites a plan prescription. The effective target below is the
  // same value resolveRestTarget(plan, setIndex, sessionRestSec) yields.
  const [restPlanSec, setRestPlanSec] = useState<number | null>(null)
  // The session's fallback rest target — server-seeded, sheet-editable
  // (optimistic local state; the server persist is best-effort). Same
  // local-first pattern as `gear`.
  const [sessionRestSec, setSessionRestSec] = useState<number | null>(defaultRestSec)
  // Whether the rest-target sheet is up (opened by tapping the header's rest
  // readout).
  const [isRestSheetOpen, setIsRestSheetOpen] = useState(false)
  const restTargetSec = restPlanSec ?? sessionRestSec

  function pushRemoved(entry: RemovedEntry) {
    setRemoved((prev) => [...prev, entry])
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setRemoved([]), UNDO_WINDOW_MS)
  }

  function handleRemoveExercise(index: number) {
    const exercise = draft.exercises[index]
    dispatch({ type: 'REMOVE_EXERCISE', index })
    pushRemoved({ kind: 'exercise', exercise, index })
  }

  function handleRemoveSet(exerciseIndex: number, setIndex: number) {
    const exercise = draft.exercises[exerciseIndex]
    const set = exercise.sets[setIndex]
    dispatch({ type: 'REMOVE_SET', exerciseIndex, setIndex })
    pushRemoved({
      kind: 'set',
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setIndex,
      set,
    })
  }

  function handleUndoRemove() {
    const last = removed[removed.length - 1]
    if (!last) return
    if (last.kind === 'exercise') {
      dispatch({ type: 'INSERT_EXERCISE', index: last.index, exercise: last.exercise })
    } else {
      // Resolve the exercise's CURRENT index by id; if its own removal is
      // deeper in the stack, undoing that first brings this set's home back.
      const exerciseIndex = draft.exercises.findIndex((e) => e.id === last.exerciseId)
      if (exerciseIndex !== -1) {
        dispatch({ type: 'INSERT_SET', exerciseIndex, setIndex: last.setIndex, set: last.set })
      }
    }
    setRemoved((prev) => prev.slice(0, -1))
    if (removed.length === 1 && undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

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
        // A whole-draft replace orphans any pending undo entries; drop them
        // so the Undo button can't promise a restore it can no longer make.
        setRemoved([])
      })
      .catch(() => {
        // Non-critical: restore is best-effort; the logger works without it.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: key/unit are stable per page load
  }, [])

  // Autosave every change to the server draft. The queue debounces bursts,
  // sends only the latest snapshot, and retries failures on an interval —
  // a gym dead zone delays the sync instead of silently dropping it.
  useEffect(() => {
    const snapshot = JSON.stringify({ name, exercises: draft.exercises })
    if (lastSnapshotRef.current === snapshot) return // StrictMode re-run or no real change
    const isMount = lastSnapshotRef.current === null
    lastSnapshotRef.current = snapshot
    if (isMount) return // the server-seeded first render — nothing user-entered yet
    dirtyRef.current = true
    const isEmptyDraft = draft.exercises.length === 0 && !name.trim()
    queue.enqueue(
      isEmptyDraft ? null : buildDraftPayload({ draft, name, unit, openedAt }),
    )
  }, [draft, name, unit, openedAt, queue])

  // Reconnect signal: retry a failed sync the moment the network is back,
  // instead of waiting out the retry interval. Unmount stops the queue;
  // setup resumes it so the pair is symmetric — StrictMode's dev-time
  // mount→cleanup→mount would otherwise leave the queue paused forever.
  useEffect(() => {
    queue.resume()
    const onOnline = () => queue.flush()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      queue.pause()
    }
  }, [queue])

  const isEmpty = draft.exercises.length === 0
  // Every exercise has sets and every set is checked off — the moment the
  // Finish button starts nudging (and the last card outline turns volt).
  const isSessionDone =
    !isEmpty &&
    draft.exercises.every(
      (exercise) => exercise.sets.length > 0 && exercise.sets.every((set) => set.completed),
    )

  // Deliberately NOT wrapped in startTransition: tying router.push to an async
  // transition made the experimental <ViewTransition> capture race the
  // destination page's suspended data reads, which could strand the old
  // screen's snapshot over the new page (taps landed on a frozen picture).
  // Await everything first, then navigate outside any transition scope.
  async function handleSave() {
    setPlateSheetFor(null) // a live showModal() dialog must not cross navigation
    setIsPickerOpen(false) // same top-layer invariant for the exercise sheet
    setIsRestSheetOpen(false) // and for the rest-target sheet
    setIsSaving(true)
    try {
      setError(null)
      // Save-time barrier: pause autosave AND wait out any put already on
      // the wire, so nothing can land after the save action deletes the
      // draft and resurrect it.
      await queue.settle()
      // The save actions delete this surface's server draft themselves —
      // the saved workout supersedes it on every device.
      if (workoutId) {
        await updateWorkoutAction(workoutId, draftToInput(draft, name, unit))
        // History changed: the browser QueryClient outlives this page, so
        // cached ghosts would otherwise show pre-save data next session.
        queryClient.invalidateQueries({ queryKey: ['last-performance'], refetchType: 'none' })
        router.push(`/workout/${workoutId}`)
      } else {
        const { id } = await saveWorkoutAction({
          ...draftToInput(draft, name, unit),
          // Live session bounds: opened → saved. Without the explicit
          // completedAt the DB layer would fall back to startedAt (the
          // backdating default) and every live log would read as 0 min.
          startedAt: openedAt,
          completedAt: new Date(),
        })
        queryClient.invalidateQueries({ queryKey: ['last-performance'], refetchType: 'none' })
        // Land on the session summary (duration, volume, PR badges) — the
        // finish deserves a readout, not a home-screen redirect.
        router.push(`/workout/${id}`)
      }
      // isSaving intentionally stays true on success: the button reads
      // "Saving…" until the navigation unmounts this screen.
    } catch {
      queue.resume() // save failed — autosave picks the latest back up
      setIsSaving(false)
      setError('Could not save workout. Please try again.')
    }
  }

  return (
    <>
      {/* The logger owns the app bar: the session clock belongs up there
          (glanceable without scrolling, out of the workout body), and only
          the logger knows the session's openedAt. Header action says
          "Close", not "Cancel": the autosaved draft survives and resumes
          from the home banner — nothing is cancelled. */}
      <AppHeader
        title={title}
        trailing={
          <>
            {/* Clock only for a live session — a finished workout's edit
                has no running time to show. openedAt (not a prop clock):
                a restored draft rewinds it to the original session start. */}
            {isLive && (
              <HeaderClock
                startedAt={openedAt}
                restStartedAt={restStartedAt}
                restTargetSec={restTargetSec}
                onRestClick={() => setIsRestSheetOpen(true)}
              />
            )}
            <Link href={closeHref} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              Close
            </Link>
          </>
        }
      />
      {/* The width wrapper moved in from the pages alongside the header:
          the sticky bar's -mx-5 bleed is calibrated against this px-5, so
          the pair must live in the same component. Pages keep the outer
          min-h flex column. */}
      <main className="mx-auto w-full max-w-md flex-1 px-5">
      <div className="space-y-4 py-5">
        <div>
          {/* A real label, not placeholder-as-label: the placeholder vanishes
              the moment typing starts, and an unlabeled box at the top of the
              screen reads as a mystery field. */}
          <label
            htmlFor="workout-name"
            className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Workout name
          </label>
          <Input
            id="workout-name"
            placeholder="Optional — e.g. Lower"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
          />
        </div>

        {syncStatus === 'failed' && (
          <p className="px-1 text-sm text-warning" role="status">
            Offline — changes will sync when you&apos;re back.
          </p>
        )}

        {isEmpty && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            Tap + Exercise to add your first movement.
          </p>
        )}

        {draft.exercises.map((exercise, exerciseIndex) => (
          <section
            key={exercise.id}
            className={cn(
              'space-y-3 rounded-2xl border bg-card p-4 transition-colors',
              // Every set checked off = this movement is done: the volt
              // outline is the same "live/complete" state marker the resume
              // banner and rest readout use.
              exercise.sets.length > 0 && exercise.sets.every((set) => set.completed)
                ? 'border-primary/50'
                : 'border-border',
            )}
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
              {/* How this exercise logs (Hevy-style). A native select — four
                  options don't justify a custom menu, and the OS picker is the
                  best small-screen affordance. Ghost-quiet on purpose: it's a
                  per-exercise setting touched once, not a control competing
                  with the movement name — small caps + chevron, no box. */}
              <span className="relative shrink-0">
                <select
                  value={exercise.loggingType}
                  onChange={(e) => {
                    // The DOM only offers whitelisted options; the guard keeps
                    // the reducer payload typed without an `as` cast.
                    if (isLoggingType(e.target.value)) {
                      dispatch({
                        type: 'SET_LOGGING_TYPE',
                        exerciseIndex,
                        loggingType: e.target.value,
                      })
                    }
                  }}
                  aria-label={`Logging type for ${exercise.name}`}
                  className="h-9 appearance-none rounded-lg bg-transparent pl-1 pr-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {LOGGING_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {LOGGING_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
              </span>
              {/* Plates only make sense for a barbell-style total load — a
                  bodyweight movement has nothing to rack. */}
              {exercise.loggingType === 'weight_reps' && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setPlateSheetFor(exerciseIndex)}
                  aria-label={`Plates for ${exercise.name}`}
                >
                  <Dumbbell aria-hidden="true" className="size-4" />
                </Button>
              )}
              {/* Hairline gap between the everyday utilities and the
                  destructive remove — adjacency invites mid-set slips. */}
              <span aria-hidden="true" className="h-5 w-px shrink-0 self-center bg-border" />
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mr-1 shrink-0 text-muted-foreground"
                onClick={() => handleRemoveExercise(exerciseIndex)}
                aria-label={`Remove ${exercise.name}`}
              >
                <Trash2 aria-hidden="true" className="size-4" />
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
                  // Weight ghosts assume "weight = total load" — meaningless
                  // under a BW reading, so BW types keep the reps ghost only.
                  weight:
                    exercise.loggingType === 'weight_reps'
                      ? (history.weight ?? plan.weight)
                      : undefined,
                }
                return (
                <div key={set.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({
                        type: 'TOGGLE_SET_COMPLETED',
                        exerciseIndex,
                        setIndex,
                        // Tap-to-accept: checking off an untouched set adopts
                        // the ghost ("do what I did last time" in one tap).
                        // A "8–12" plan range adopts its floor.
                        fill: {
                          reps: adoptableGhostValue(ghost.reps),
                          // A bodyweight set HAS no weight value to adopt —
                          // filling one would persist a phantom load.
                          weight:
                            exercise.loggingType === 'bodyweight_reps'
                              ? undefined
                              : adoptableGhostValue(ghost.weight),
                        },
                      })
                      // Checking off starts the rest clock; unchecking is a
                      // correction, not a new rest period. The plan component
                      // of the target is resolved from THIS set's slot
                      // (session default deliberately not merged here — see
                      // restPlanSec above); ad-hoc exercises have no plan
                      // targets and resolve to null → the session default.
                      // Feature switch first: with the rest timer off, no
                      // rest state ever starts, so the readout/sheet never
                      // render — the surface disappears, not just the target.
                      if (restTimerEnabled && !set.completed) {
                        setRestStartedAt(new Date())
                        setRestPlanSec(
                          resolveRestTarget(planTargets?.[exercise.wgerExerciseId], setIndex, null),
                        )
                      }
                    }}
                    aria-pressed={set.completed}
                    aria-label={
                      set.completed
                        ? `Mark set ${setIndex + 1} incomplete`
                        : `Mark set ${setIndex + 1} complete`
                    }
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
                      <Check aria-hidden="true" strokeWidth={3} className="size-4" />
                    ) : (
                      setIndex + 1
                    )}
                  </button>
                  <Input
                    type="text"
                    inputMode="numeric"
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
                  {exercise.loggingType === 'bodyweight_reps' ? (
                    // The lifter IS the load: a non-editable pill holds the
                    // weight input's footprint so rows never jump on switch.
                    <span
                      aria-label={`Set ${setIndex + 1} uses bodyweight`}
                      className="flex h-11 flex-1 items-center justify-center rounded-lg border border-border bg-muted text-base font-medium text-muted-foreground"
                    >
                      BW
                    </span>
                  ) : (
                    <div className="relative flex-1">
                      {exercise.loggingType !== 'weight_reps' && (
                        // Sign prefix inside the field: this number is added
                        // to (+) or subtracted from (−) bodyweight, not total.
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground"
                        >
                          {exercise.loggingType === 'assisted_bodyweight' ? '−' : '+'}
                        </span>
                      )}
                      <Input
                        type="text"
                        inputMode="decimal"
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
                        aria-label={
                          exercise.loggingType === 'weighted_bodyweight'
                            ? `Set ${setIndex + 1} added weight in ${unit}`
                            : exercise.loggingType === 'assisted_bodyweight'
                              ? `Set ${setIndex + 1} assistance in ${unit}`
                              : `Set ${setIndex + 1} weight in ${unit}`
                        }
                        className="w-full text-center tnum"
                      />
                    </div>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    // Invisible inset lifts the 36px visual button toward the
                    // 44px HIG target without shifting the row (same trick as
                    // the set-complete circle).
                    className="relative shrink-0 text-muted-foreground before:absolute before:-inset-1"
                    onClick={() => handleRemoveSet(exerciseIndex, setIndex)}
                    aria-label={`Remove set ${setIndex + 1}`}
                  >
                    <X aria-hidden="true" className="size-4" />
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
        {removed.length > 0 && (
          <div
            role="status"
            className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5"
          >
            <p className="min-w-0 truncate text-sm">
              Removed{' '}
              <span className="font-medium">
                {(() => {
                  const last = removed[removed.length - 1]
                  return last.kind === 'exercise'
                    ? last.exercise.name
                    : `set ${last.setIndex + 1} · ${last.exerciseName}`
                })()}
              </span>
            </p>
            <Button size="sm" variant="outline" className="shrink-0" onClick={handleUndoRemove}>
              {removed.length > 1 ? `Undo (${removed.length})` : 'Undo'}
            </Button>
          </div>
        )}
        <div className="flex gap-3">
          {/* Adding an exercise is the second-most-frequent act mid-session,
              so it earns a permanent slot in the thumb bar — outline, so the
              volt Finish stays the unmistakable primary. Disabled while
              saving: the draft is frozen once the save barrier engages. */}
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            disabled={isSaving}
            onClick={() => setIsPickerOpen(true)}
          >
            + Exercise
          </Button>
          <Button
            size="lg"
            // Keyed off isLive, NOT workoutId: a live program session is
            // edit-mode with a workoutId but still ends with a volt Finish.
            // "Finish", not "Save": ending a session is the product's peak
            // moment, not filing paperwork. Correcting a finished workout
            // keeps an outline "Save changes" — that IS paperwork.
            variant={isLive ? 'default' : 'outline'}
            className={cn(
              'flex-[1.6] font-semibold uppercase tracking-wide',
              // Every planned set is done: a gentle scale nudge says "wrap it
              // up" — motion as state (session complete), not decoration.
              // Reduced-motion users get the same information from the volt
              // card outlines above.
              isLive && isSessionDone && !isSaving && 'motion-safe:animate-finish-nudge',
            )}
            disabled={isEmpty || isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Saving…' : isLive ? 'Finish workout' : 'Save changes'}
          </Button>
        </div>
      </div>
      </main>

      {isPickerOpen && (
        <ExerciseSheet
          onAdd={(exercise) =>
            dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(exercise) })
          }
          onClose={() => setIsPickerOpen(false)}
        />
      )}

      {/* Guarded on loggingType too: the open button only renders for
          weight_reps, but the type can switch while the sheet is up. */}
      {plateSheetFor !== null &&
        draft.exercises[plateSheetFor] &&
        draft.exercises[plateSheetFor].loggingType === 'weight_reps' && (
        <PlateSheet
          exerciseName={draft.exercises[plateSheetFor].name}
          weights={Array.from(
            new Set(
              draft.exercises[plateSheetFor].sets
                .map((set) => parseFloat(set.weight))
                .filter((weight) => Number.isFinite(weight) && weight > 0),
            ),
          ).sort((a, b) => b - a)}
          unit={unit}
          equipment={gear}
          onClose={() => setPlateSheetFor(null)}
          onEquipmentSaved={setGear}
        />
      )}

      {isRestSheetOpen && (
        <RestSheet
          currentSec={sessionRestSec}
          onClose={() => setIsRestSheetOpen(false)}
          // Optimistic: the session default (and any default-driven countdown
          // running right now) adopts the value immediately; the sheet owns
          // the best-effort server persist and its error text.
          onSaved={setSessionRestSec}
        />
      )}
    </>
  )
}
