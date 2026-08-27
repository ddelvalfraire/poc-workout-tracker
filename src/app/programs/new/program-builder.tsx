'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resolveOvershootPolicy } from '@/lib/overshoot-policy'
import { OvershootField, type OvershootPreview } from '@/components/overshoot-field'
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
  toggleWeekday,
  type ProgramDraft,
  type DraftProgramExercise,
} from './program-draft'
import { SchemeSubtitle } from './scheme-subtitle'
import { type WeightUnit } from '@/lib/units'
import { WEEKDAY_TOKENS } from '@/lib/schedule-anchor'
import { metricModeSchema, type DeloadPolicy, type MetricMode } from '@/lib/program-input'
import { useTranslations } from 'next-intl'

/** The per-exercise metric-mode select (same ghost-quiet native-select
 *  idiom as the logger's logging-type control), as VALUES only. A label
 *  built here would be built at module load, before any request, so it
 *  could never be translated; the copy lives in the catalog under
 *  `metricMode.<key>`. The keys are camelCase rather than the snake_case
 *  enum values so a catalog leaf survives an Android strings.xml export. */
const METRIC_MODE_KEYS = {
  reps_weight: 'repsWeight',
  duration: 'duration',
  duration_distance: 'durationDistance',
} as const

const METRIC_MODES = Object.keys(METRIC_MODE_KEYS) as MetricMode[]

/** The heaviest load the movement asks for, with its reps — the concrete
 *  prescription the overshoot sheet reasons about. Null when the draft has no
 *  load-bearing set yet, in which case the sheet shows options only rather
 *  than inventing an example. */
function overshootPreview(
  exercise: DraftProgramExercise,
  unit: WeightUnit,
): OvershootPreview | null {
  const loaded = exercise.sets.filter((set) => set.load.trim() !== '')
  if (loaded.length === 0) return null
  const top = loaded.reduce((best, set) =>
    Number(set.load) > Number(best.load) ? set : best,
  )
  const reps =
    top.repMin.trim() === ''
      ? null
      : top.repMax.trim() === '' || top.repMax === top.repMin
        ? top.repMin
        : `${top.repMin}\u2013${top.repMax}`
  if (reps === null) return null
  return { reps, load: `${top.load} ${unit}` }
}


/** A set with no stored mode measures reps × weight, as it always has. */
const DEFAULT_METRIC_MODE: MetricMode = 'reps_weight'

/** Option VALUES for the three radio groups; every label is a catalog
 *  lookup at render (see `deloadPolicy.*`, `timedExercises.*`,
 *  `dietPhase.*`). */
const DELOAD_MODES = ['none', 'reactive', 'scheduled'] as const
const TIMED_EXERCISE_ARMS = ['untouched', 'scaled'] as const
const DIET_PHASES = [null, 'cutting', 'maintaining', 'bulking'] as const

/** Catalog key per editable set field. The accessible name of each input
 *  is one ICU sentence with the field name as an ARGUMENT, so a language
 *  that orders it differently still reads correctly — the old code glued
 *  an English label onto the end of a template string. */
const FIELD_LABEL_KEYS = {
  duration: 'duration',
  distance: 'distance',
  rpe: 'rpe',
  restSec: 'rest',
  repMin: 'repMin',
  repMax: 'repMax',
  load: 'load',
} as const

/** The scheduled shape at the historical defaults — what a never-set policy
 *  resolves to, and the seed when the picker writes an explicit one. */
const DEFAULT_DELOAD_SHAPE = {
  loadFactor: 0.85,
  setFactor: 0.5,
  rpeCap: null,
  timedExercises: 'untouched',
} as const

/** The shape the read-only scheduled caption describes: the stored shape
 *  when one exists (agent-configured), the historical defaults otherwise.
 *  The caption itself is assembled at RENDER from the catalog — a sentence
 *  built here would be built before the translator exists. */
function deloadShapeOf(policy: DeloadPolicy | null) {
  return policy?.mode === 'scheduled' ? policy.shape : DEFAULT_DELOAD_SHAPE
}

/** The scheduled shape's timedExercises arm as the picker shows it. A
 *  pre-field stored policy (or none at all) reads 'untouched' — mirroring
 *  the zod default resolveDeloadPolicy applies at read time. */
function resolvedTimedExercises(policy: DeloadPolicy | null): 'untouched' | 'scaled' {
  if (policy?.mode !== 'scheduled') return 'untouched'
  return policy.shape.timedExercises ?? 'untouched'
}

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
  const t = useTranslations('ProgramBuilder')
  const [draft, dispatch] = useReducer(programDraftReducer, initialDraft)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  // The deload-mode picker's checked state: an explicit policy wins; a
  // never-set one shows the LEGACY resolution (scheduled when a deload week
  // is typed, none otherwise) — mirroring resolveDeloadPolicy's read path.
  const resolvedDeloadMode =
    draft.deloadPolicy?.mode ?? (draft.deloadWeek.trim() !== '' ? 'scheduled' : 'none')
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
      setError(t('saveError'))
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
            <p className="min-w-0 text-sm">{t('restoredNotice')}</p>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={handleDiscardRestored}>
                {t('discardAction')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWasRestored(false)}>
                {t('keepAction')}
              </Button>
            </div>
          </div>
        )}

        <Input
          placeholder={t('namePlaceholder')}
          value={draft.name}
          onChange={(e) => dispatch({ type: 'SET_META', field: 'name', value: e.target.value })}
          aria-label={t('nameAriaLabel')}
        />

        <div className="flex gap-2">
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t('weeksPlaceholder')}
            value={draft.mesocycleWeeks}
            onChange={(e) =>
              dispatch({ type: 'SET_META', field: 'mesocycleWeeks', value: e.target.value })
            }
            aria-label={t('weeksAriaLabel')}
            className="flex-1 tnum"
          />
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t('deloadWeekPlaceholder')}
            value={draft.deloadWeek}
            onChange={(e) =>
              dispatch({ type: 'SET_META', field: 'deloadWeek', value: e.target.value })
            }
            aria-label={t('deloadWeekAriaLabel')}
            aria-describedby="deload-hint"
            className="flex-1 tnum"
          />
        </div>
        <p id="deload-hint" className="px-1 text-sm text-muted-foreground">
          {t('deloadHint')}
        </p>

        {/* Deload policy: the same compact radio idiom as the stall policy
            below. The checked state shows the RESOLVED mode (a never-set
            policy displays what the program will actually do — scheduled
            when a deload week is set, none otherwise); picking an option
            writes an explicit policy. Scheduled's shape is read-only here —
            the historical back-off unless an agent configured otherwise. */}
        <fieldset className="px-1">
          <legend className="text-sm">{t('deloadPolicy.legend')}</legend>
          <div className="mt-1 flex flex-col gap-1">
            {DELOAD_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="deload-policy-mode"
                  checked={resolvedDeloadMode === mode}
                  onChange={() =>
                    dispatch({
                      type: 'SET_DELOAD_POLICY',
                      value:
                        mode === 'scheduled'
                          ? {
                              mode,
                              shape:
                                draft.deloadPolicy?.mode === 'scheduled'
                                  ? draft.deloadPolicy.shape
                                  : DEFAULT_DELOAD_SHAPE,
                            }
                          : { mode },
                    })
                  }
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="text-sm text-muted-foreground">{t(`deloadPolicy.${mode}`)}</span>
              </label>
            ))}
          </div>
          {resolvedDeloadMode === 'scheduled' &&
            (() => {
              const shape = deloadShapeOf(draft.deloadPolicy)
              const load = Math.round(shape.loadFactor * 100)
              const sets = Math.round(shape.setFactor * 100)
              return (
                <p className="mt-1 pl-6.5 text-sm text-muted-foreground">
                  {shape.rpeCap !== null
                    ? t('deloadPolicy.shapeWithCap', { load, sets, rpeCap: shape.rpeCap })
                    : t('deloadPolicy.shape', { load, sets })}
                </p>
              )
            })()}
          {/* Timed exercises on the deload week (D3, "creator decides"):
              the same compact radio idiom, nested under Scheduled like the
              stall policy under auto-regulation. Untouched is the default —
              a duration exercise's deload week trains as written unless the
              creator opts its sets into the back-off. Picking either option
              writes an explicit policy (seeding the current/default shape). */}
          {resolvedDeloadMode === 'scheduled' && (
            <fieldset className="mt-2 pl-6.5">
              <legend className="text-sm">{t('timedExercises.legend')}</legend>
              <div className="mt-1 flex flex-col gap-1">
                {TIMED_EXERCISE_ARMS.map((arm) => (
                  <label key={arm} className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="deload-timed-exercises"
                      checked={resolvedTimedExercises(draft.deloadPolicy) === arm}
                      onChange={() =>
                        dispatch({
                          type: 'SET_DELOAD_POLICY',
                          value: {
                            mode: 'scheduled',
                            shape: {
                              ...(draft.deloadPolicy?.mode === 'scheduled'
                                ? draft.deloadPolicy.shape
                                : DEFAULT_DELOAD_SHAPE),
                              timedExercises: arm,
                            },
                          },
                        })
                      }
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="text-sm text-muted-foreground">{t(`timedExercises.${arm}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </fieldset>

        {/* The program-wide default an exercise may override. It went missing
            when the old detail-page control was deleted, which left it
            settable only through MCP — a capability regression this closes. */}
        <OvershootField
          value={draft.overshootPolicy}
          onChange={(value) => dispatch({ type: 'SET_OVERSHOOT_POLICY', value })}
          // No exercise and no single scheme here, so "follow the plan"
          // resolves to the scheme default for a program with no scheme.
          resolvesTo={resolveOvershootPolicy(null, null, null)}
          className="border-t border-border"
        />

        {/* Diet phase: the same compact radio idiom as the deload policy
            above. None is first and the default — no phase means the engine
            behaves exactly as it always has. Cutting only reframes stall
            verdicts (holding is the win) and asks before backing off; it
            never changes a load. */}
        <fieldset className="px-1">
          <legend className="text-sm">{t('dietPhase.legend')}</legend>
          <div className="mt-1 flex flex-col gap-1">
            {DIET_PHASES.map((phase) => (
              <label key={phase ?? 'none'} className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="diet-phase"
                  checked={draft.dietPhase === phase}
                  onChange={() => dispatch({ type: 'SET_DIET_PHASE', value: phase })}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="text-sm text-muted-foreground">{t(`dietPhase.${phase ?? 'none'}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Program-level auto-regulation switch. A native checkbox — one
            boolean doesn't justify custom chrome, and the adjusted targets
            always arrive as proposals with a per-exercise escape. */}
        <label className="flex items-start gap-2.5 px-1">
          <input
            type="checkbox"
            checked={draft.autoregulation}
            onChange={(e) => dispatch({ type: 'SET_AUTOREGULATION', value: e.target.checked })}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="text-sm">
            {t('autoreg.label')}
            <span className="mt-0.5 block text-muted-foreground">
              {t('autoreg.description')}
            </span>
          </span>
        </label>

        {/* Fixed-mode stall policy: a compact radio pair riding next to the
            auto-regulation switch it refines — native inputs, same form idiom.
            Only meaningful while auto-regulation is on, so it hides with it
            (the stored value is preserved either way). */}
        {draft.autoregulation && (
          <fieldset className="px-1 pl-7">
            <legend className="text-sm">{t('stallPolicy.legend')}</legend>
            <div className="mt-1 flex flex-col gap-1">
              <label className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="autoreg-stall-policy"
                  checked={draft.autoregStallPolicy === 'all-sets'}
                  onChange={() =>
                    dispatch({ type: 'SET_AUTOREG_STALL_POLICY', value: 'all-sets' })
                  }
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="text-sm text-muted-foreground">{t('stallPolicy.allSets')}</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="autoreg-stall-policy"
                  checked={draft.autoregStallPolicy === 'first-set'}
                  onChange={() =>
                    dispatch({ type: 'SET_AUTOREG_STALL_POLICY', value: 'first-set' })
                  }
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="text-sm text-muted-foreground">{t('stallPolicy.firstSet')}</span>
              </label>
            </div>
          </fieldset>
        )}

        {/* Performance→plan auto-sync switch: same native-checkbox row as
            auto-regulation above. Off is for deliberate-percentage programs
            (5/3/1-style waves) where lifting past the listed load is by
            design, not a stale plan. */}
        <label className="flex items-start gap-2.5 px-1">
          <input
            type="checkbox"
            checked={draft.planSync}
            onChange={(e) => dispatch({ type: 'SET_PLAN_SYNC', value: e.target.checked })}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="text-sm">
            {t('planSync.label')}
            <span className="mt-0.5 block text-muted-foreground">
              {t('planSync.description')}
            </span>
          </span>
        </label>

        {/* Program-suggested body check-in cadence: a small number input, not
            a toggle — blank IS the off state (programs.checkInEveryDays null),
            so there's no second control to keep in sync. */}
        <div className="space-y-1 px-1">
          <label className="flex items-center gap-2.5 text-sm" htmlFor="check-in-every-days">
            <span className="flex-1">{t('checkIn.label')}</span>
            <Input
              id="check-in-every-days"
              type="text"
              inputMode="numeric"
              placeholder={t('checkIn.placeholder')}
              value={draft.checkInEveryDays}
              onChange={(e) =>
                dispatch({ type: 'SET_META', field: 'checkInEveryDays', value: e.target.value })
              }
              aria-label={t('checkIn.ariaLabel')}
              aria-describedby="check-in-hint"
              className="w-16 shrink-0 text-center tnum"
            />
            <span className="shrink-0">{t('checkIn.unit')}</span>
          </label>
          <p id="check-in-hint" className="text-sm text-muted-foreground">
            {t('checkIn.hint')}
          </p>
        </div>

        {draft.days.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {t('empty.days')}
          </p>
        )}

        {draft.days.map((day, dayIndex) => (
          // De-carded (review contract): each day is a hairline section — a
          // condensed-caps header over content that closes with a hairline,
          // not a rounded card shell. The name input keeps its exact wiring;
          // only the shell around it changed.
          <section
            key={day.id}
            aria-label={t('day.ariaLabel', { position: dayIndex + 1 })}
            className="space-y-3 border-b border-b-border/60 pb-6 pt-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground tnum">
                {t('day.title', { position: dayIndex + 1 })}
              </h2>
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mr-1 shrink-0 text-muted-foreground"
                onClick={() => dispatch({ type: 'REMOVE_DAY', index: dayIndex })}
                aria-label={t('day.removeAriaLabel', { position: dayIndex + 1 })}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <Input
              placeholder={t('day.namePlaceholder', { position: dayIndex + 1 })}
              value={day.name}
              onChange={(e) =>
                dispatch({ type: 'RENAME_DAY', index: dayIndex, name: e.target.value })
              }
              aria-label={t('day.nameAriaLabel', { position: dayIndex + 1 })}
              className="min-w-0"
            />

            {/* Weekday schedule: 7 toggle chips, Sunday-first to match the
                stored 0–6 indices. Optional — no selection = unscheduled, and
                the home hero renders exactly as before. aria-pressed carries
                the on/off state; the label carries the full weekday name the
                single letter can't. */}
            <div
              role="group"
              aria-label={t('day.scheduleAriaLabel', {
                dayName: day.name || t('day.title', { position: dayIndex + 1 }),
              })}
              className="flex gap-1.5 px-0.5"
            >
              {WEEKDAY_TOKENS.map((weekdayToken, weekday) => {
                const isSelected = day.weekdays.includes(weekday)
                return (
                  <button
                    key={weekdayToken}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={t('weekday', { weekday: weekdayToken })}
                    onClick={() =>
                      dispatch({
                        type: 'SET_DAY_WEEKDAYS',
                        index: dayIndex,
                        weekdays: toggleWeekday(day.weekdays, weekday),
                      })
                    }
                    className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {/* The glyph is its own message, not name[0]: which
                        letters disambiguate seven weekdays is a per-language
                        question (Spanish needs L/M/X/J/V/S/D). */}
                    {t('weekdayInitial', { weekday: weekdayToken })}
                  </button>
                )
              })}
            </div>

            <ExercisePicker
              includeCustom
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
                {t('empty.exercises')}
              </p>
            )}

            {/* Exercise rows: a hairline opens each exercise instead of a
                nested box — the sets below read as the row's indented body. */}
            {day.exercises.map((exercise, exerciseIndex) => {
              // What this slot's sets measure — one control per exercise
              // (the builder edits sets uniformly; per-set drift stays an
              // agent affordance). First set speaks for the slot.
              const exerciseMode: MetricMode = exercise.sets[0]?.metricMode ?? DEFAULT_METRIC_MODE
              const isCardioExercise = exerciseMode !== 'reps_weight'
              return (
              <div key={exercise.id} className="space-y-2 border-t border-t-border/60 pt-3">
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
                    aria-label={t('exercise.removeAriaLabel', { exerciseName: exercise.name })}
                  >
                    {/* Trash2 = container (day, exercise); X = single row
                        (set) — one glyph per meaning, matching the logger. */}
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>

                {/* How this exercise's sets are measured (cardio v1): the
                    same ghost-quiet native-select idiom as the logger's
                    logging-type control. Cardio-category adds default to
                    duration + distance; this is the flip. */}
                <span className="relative inline-block">
                  <select
                    value={exerciseMode}
                    onChange={(e) => {
                      // The DOM only offers whitelisted options; the guard
                      // keeps the reducer payload typed without an `as` cast.
                      const parsed = metricModeSchema.safeParse(e.target.value)
                      if (parsed.success) {
                        dispatch({
                          type: 'SET_EXERCISE_METRIC_MODE',
                          dayIndex,
                          index: exerciseIndex,
                          value: parsed.data,
                        })
                      }
                    }}
                    aria-label={t('exercise.metricModeAriaLabel', {
                      exerciseName: exercise.name,
                    })}
                    className="h-9 appearance-none rounded-lg bg-transparent pl-1 pr-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
                  >
                    {METRIC_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`metricMode.${METRIC_MODE_KEYS[mode]}`)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                </span>

                {/* Scheme line (#228): name + plain one-liner for exercises
                    whose sketch carries a progression — what the scheme will
                    DO, in lifter language, since the builder never edits it. */}
                {exercise.progression !== null && (
                  <SchemeSubtitle scheme={exercise.progression.scheme} />
                )}

                {/* Training max: only TM-bearing schemes (percent-1rm /
                    amrap-cycle) render it — the one progression field the
                    builder edits (the rest stays agent-authored pass-
                    through). Seeded from the stored TM, or prefilled
                    e1rm × 0.85 for authored sketches (the caption says so
                    until the first edit). */}
                {(exercise.progression?.scheme === 'percent-1rm' ||
                  exercise.progression?.scheme === 'amrap-cycle') && (
                  <label className="flex items-center gap-2.5 px-0.5 text-sm">
                    <span className="shrink-0">{t('trainingMax.label', { unit })}</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={exercise.trainingMax}
                      onChange={(e) =>
                        dispatch({
                          type: 'UPDATE_EXERCISE_TM',
                          dayIndex,
                          index: exerciseIndex,
                          value: e.target.value,
                        })
                      }
                      aria-label={t('trainingMax.ariaLabel', {
                        exerciseName: exercise.name,
                        unit,
                      })}
                      className="w-24 shrink-0 text-center tnum"
                    />
                    {exercise.trainingMaxFromE1rm && (
                      <span className="text-xs text-muted-foreground">{t('trainingMax.fromE1rmNote')}</span>
                    )}
                  </label>
                )}

                {/* What counts as beating the target for THIS movement.
                    Authoring, which is why it lives here and not on the
                    active-program page: an active plan is a thing you read
                    and execute, and changing how it scores you is editing it.
                    A sheet rather than a select — four words of jargon in a
                    dropdown is not a decision surface, so each option states
                    what it DOES and the sheet closes with the rule applied to
                    this movement's own prescription. */}
                <OvershootField
                  value={exercise.overshootPolicy}
                  onChange={(value) =>
                    dispatch({
                      type: 'UPDATE_EXERCISE_OVERSHOOT',
                      dayIndex,
                      index: exerciseIndex,
                      value,
                    })
                  }
                  exerciseName={exercise.name}
                  // What "follow the plan" resolves to for THIS exercise: the
                  // program's own policy, else the scheme's default.
                  resolvesTo={resolveOvershootPolicy(
                    draft.overshootPolicy,
                    null,
                    exercise.progression?.scheme ?? null,
                  )}
                  preview={overshootPreview(exercise, unit)}
                  className="px-0.5"
                />

                {/* The set group: indentation + the exercise hairline carry
                    the grouping the removed inner box used to. */}
                <div className="space-y-2 pl-2">
                  {exercise.sets.length > 0 && (
                    <div className="flex items-center gap-2 px-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="w-6 shrink-0" aria-hidden="true" />
                      {isCardioExercise ? (
                        <>
                          {/* Cardio columns: mm:ss + optional km replace the
                              rep/load trio; RPE stays (effort cap) and rest
                              keeps its slot. */}
                          <span className="flex-[1.4] text-center">{t('column.time')}</span>
                          {exerciseMode === 'duration_distance' && (
                            <span className="flex-[1.4] text-center">{t('column.km')}</span>
                          )}
                          <span className="flex-1 text-center">{t('column.rpe')}</span>
                          <span className="flex-1 text-center">{t('column.rest')}</span>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-center">{t('column.repMin')}</span>
                          <span className="flex-1 text-center">{t('column.repMax')}</span>
                          <span className="flex-[1.4] text-center">{unit}</span>
                          <span className="flex-1 text-center">{t('column.rpe')}</span>
                          <span className="flex-1 text-center">{t('column.rest')}</span>
                        </>
                      )}
                      <span className="size-9 shrink-0" aria-hidden="true" />
                    </div>
                  )}
  
                  <div className="space-y-2">
                    {exercise.sets.map((set, setIndex) => (
                      <div key={set.id} className="flex items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tnum text-muted-foreground">
                          {setIndex + 1}
                        </span>
                        {(set.metricMode !== 'reps_weight'
                          ? ([
                              // Cardio row: duration (mm:ss, stored seconds)
                              // + km for duration_distance; RPE stays as the
                              // optional effort cap, rest keeps its slot.
                              {
                                field: 'duration',
                                mode: 'numeric',
                                value: set.duration,
                              },
                              ...(set.metricMode === 'duration_distance'
                                ? ([
                                    {
                                      field: 'distance',
                                      mode: 'decimal',
                                      value: set.distance,
                                    },
                                  ] as const)
                                : []),
                              { field: 'rpe', mode: 'decimal', value: set.rpe },
                              {
                                field: 'restSec',
                                mode: 'numeric',
                                value: set.restSec,
                              },
                            ] as const)
                          : ([
                            { field: 'repMin', mode: 'numeric', value: set.repMin },
                            { field: 'repMax', mode: 'numeric', value: set.repMax },
                            {
                              field: 'load',
                              mode: 'decimal',
                              value: set.load,
                            },
                            { field: 'rpe', mode: 'decimal', value: set.rpe },
                            // Per-set rest target in seconds — the granularity
                            // the product asked for ("per exercise per set").
                            // Rides the same UPDATE_SET path as its siblings.
                            {
                              field: 'restSec',
                              mode: 'numeric',
                              value: set.restSec,
                            },
                          ] as const)
                        ).map(({ field, mode, value }) => (
                          <Input
                            key={field}
                            type="text"
                            inputMode={mode}
                            // Rest is the one optional-feeling column; the ghost
                            // hint says what the blank means without a legend.
                            // Duration hints its dialect the same quiet way.
                            placeholder={
                              field === 'restSec'
                                ? t('placeholder.rest')
                                : field === 'duration'
                                  ? t('placeholder.duration')
                                  : undefined
                            }
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
                            aria-label={t('set.ariaLabel', {
                              exerciseName: exercise.name,
                              position: setIndex + 1,
                              field:
                                field === 'load'
                                  ? t('field.load', { unit })
                                  : t(`field.${FIELD_LABEL_KEYS[field]}`),
                            })}
                            // The load column gets extra width: 3-digit values +
                            // a decimal must not clip at the 390px PWA viewport
                            // — and so do cardio's mm:ss / km columns.
                            className={`min-w-0 px-1 text-center tnum ${
                              field === 'load' || field === 'duration' || field === 'distance'
                                ? 'flex-[1.4]'
                                : 'flex-1'
                            }`}
                          />
                        ))}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="shrink-0 text-muted-foreground"
                          onClick={() =>
                            dispatch({ type: 'REMOVE_SET', dayIndex, exerciseIndex, setIndex })
                          }
                          aria-label={t('set.removeAriaLabel', {
                            exerciseName: exercise.name,
                            position: setIndex + 1,
                          })}
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
                        // New sets join the slot's current mode.
                        set: newDraftProgramSet(exerciseMode),
                      })
                    }
                  >
                    {t('addSetAction')}
                  </Button>
                </div>
              </div>
              )
            })}
          </section>
        ))}

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() =>
            dispatch({
              type: 'ADD_DAY',
              // Stored data, NOT copy: a translated seed would freeze the
              // creating user's language into the saved program, leave old
              // names behind when they switch locale, and hand localized
              // values to the MCP/API consumers. The display already falls
              // back to a localized title when a day has no name.
              day: newDraftProgramDay(`Day ${draft.days.length + 1}`),
            })
          }
        >
          {t('addDayAction')}
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
          {isPending ? t('saving') : programId ? t('saveChangesAction') : t('saveAction')}
        </Button>
      </div>
    </>
  )
}
