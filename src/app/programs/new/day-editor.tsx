'use client'

import { useId, useState } from 'react'
import { ChevronRight, Trash2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { EmptyWords } from '@/components/ui/empty-words'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ExercisePicker } from '@/app/workout/new/exercise-picker'
import { WEEKDAY_TOKENS } from '@/lib/schedule-anchor'
import { metricModeSchema, type MetricMode } from '@/lib/program-input'
import { type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { SchemeSubtitle } from './scheme-subtitle'
import {
  newDraftProgramExercise,
  newDraftProgramSet,
  toggleWeekday,
  type DraftProgramDay,
  type ProgramDraftAction,
} from './program-draft'

/** The per-exercise metric-mode options, as VALUES only. A label built here
 *  would be built at module load, before any request, so it could never be
 *  translated; the copy lives in the catalog under `metricMode.<key>`. The
 *  keys are camelCase rather than the snake_case enum values so a catalog leaf
 *  survives an Android strings.xml export. */
const METRIC_MODE_KEYS = {
  reps_weight: 'repsWeight',
  duration: 'duration',
  duration_distance: 'durationDistance',
} as const

const METRIC_MODES = Object.keys(METRIC_MODE_KEYS) as MetricMode[]

/** A set with no stored mode measures reps × weight, as it always has. */
const DEFAULT_METRIC_MODE: MetricMode = 'reps_weight'

/** Catalog key per editable set field. The accessible name of each input is one
 *  ICU sentence with the field name as an ARGUMENT, so a language that orders
 *  it differently still reads correctly. */
const FIELD_LABEL_KEYS = {
  duration: 'duration',
  distance: 'distance',
  rpe: 'rpe',
  restSec: 'rest',
  repMin: 'repMin',
  repMax: 'repMax',
  load: 'load',
} as const

interface DayEditorProps {
  day: DraftProgramDay
  /** Zero-based; the catalog numbers days from 1. */
  dayIndex: number
  dispatch: React.Dispatch<ProgramDraftAction>
  /** Load display/entry unit; loads are converted to kg at save time. */
  unit: WeightUnit
}

/**
 * One training day, as a hairline row that opens onto its movements.
 *
 * The row states what the day IS — its number, its name, how much is in it —
 * before it states anything editable, so a program with six days can be
 * scanned rather than scrolled. It opens by DEFAULT: the builder's job is
 * editing, and a collapsed-by-default list would make every visit start with
 * six taps of housekeeping.
 *
 * The body is hidden with the `hidden` attribute rather than unmounted, so a
 * half-typed load survives a stray collapse and stays out of the tab order
 * while closed.
 */
export function DayEditor({ day, dayIndex, dispatch, unit }: DayEditorProps) {
  const t = useTranslations('ProgramBuilder')
  const [isOpen, setIsOpen] = useState(true)
  const panelId = useId()
  const position = dayIndex + 1
  const title =
    day.name.trim() === ''
      ? t('day.title', { position })
      : t('day.titleNamed', { position, name: day.name })

  return (
    <section aria-label={t('day.ariaLabel', { position })}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm py-2 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              isOpen && 'rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-lg uppercase leading-tight tracking-wide tnum">
              {title}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t('day.exerciseCount', { count: day.exercises.length })}
            </span>
          </span>
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="-mr-1 shrink-0 text-muted-foreground"
          onClick={() => dispatch({ type: 'REMOVE_DAY', index: dayIndex })}
          aria-label={t('day.removeAriaLabel', { position })}
        >
          {/* Trash2 = container (day, exercise); X = single row (set) — one
              glyph per meaning, matching the logger. */}
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div id={panelId} hidden={!isOpen} className="space-y-3 pb-5 pl-6">
        <Input
          placeholder={t('day.namePlaceholder', { position })}
          value={day.name}
          onChange={(event) =>
            dispatch({ type: 'RENAME_DAY', index: dayIndex, name: event.target.value })
          }
          aria-label={t('day.nameAriaLabel', { position })}
          className="min-w-0"
        />

        {/* Weekday schedule: 7 toggle chips, Sunday-first to match the stored
            0–6 indices. Optional — no selection = unscheduled. aria-pressed
            carries the on/off state; the label carries the full weekday name
            the single letter cannot. */}
        <div
          role="group"
          aria-label={t('day.scheduleAriaLabel', {
            dayName: day.name || t('day.title', { position }),
          })}
          className="flex gap-1.5"
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
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {/* The glyph is its own message, not name[0]: which letters
                    disambiguate seven weekdays is a per-language question
                    (Spanish needs L/M/X/J/V/S/D). */}
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

        {day.exercises.length === 0 ? (
          <EmptyWords>{t('empty.exercises')}</EmptyWords>
        ) : (
          <div className="divide-y divide-border/60 border-t border-t-border/60">
            {day.exercises.map((exercise, exerciseIndex) => (
              <ExerciseEditor
                key={exercise.id}
                exercise={exercise}
                dayIndex={dayIndex}
                exerciseIndex={exerciseIndex}
                dispatch={dispatch}
                unit={unit}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface ExerciseEditorProps {
  exercise: DraftProgramDay['exercises'][number]
  dayIndex: number
  exerciseIndex: number
  dispatch: React.Dispatch<ProgramDraftAction>
  unit: WeightUnit
}

/**
 * One movement inside a day: its name, what its sets measure, an optional
 * training max, and the sets themselves.
 *
 * A hairline opens each movement instead of a nested box — the sets below read
 * as the row's indented body, which is what the removed inner card was doing
 * with a shell.
 */
function ExerciseEditor({ exercise, dayIndex, exerciseIndex, dispatch, unit }: ExerciseEditorProps) {
  const t = useTranslations('ProgramBuilder')
  // What this slot's sets measure — one control per exercise (the builder edits
  // sets uniformly; per-set drift stays an agent affordance). First set speaks
  // for the slot.
  const exerciseMode: MetricMode = exercise.sets[0]?.metricMode ?? DEFAULT_METRIC_MODE
  const isCardioExercise = exerciseMode !== 'reps_weight'
  // Base UI resolves a value to its human label through `items`; without it the
  // trigger would render the wire value (`duration_distance`) at the user.
  const metricModeItems = METRIC_MODES.map((mode) => ({
    value: mode,
    label: t(`metricMode.${METRIC_MODE_KEYS[mode]}`),
  }))

  return (
    <div className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 text-base leading-tight">
          {exercise.name}
          {exercise.category && (
            <span className="mt-0.5 block text-sm font-normal tracking-normal text-muted-foreground">
              {exercise.category}
            </span>
          )}
        </h4>
        <Button
          size="icon-sm"
          variant="ghost"
          className="-mr-1 shrink-0 text-muted-foreground"
          onClick={() => dispatch({ type: 'REMOVE_EXERCISE', dayIndex, index: exerciseIndex })}
          aria-label={t('exercise.removeAriaLabel', { exerciseName: exercise.name })}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* How this exercise's sets are measured (cardio v1). Cardio-category
          adds default to duration + distance; this is the flip. */}
      <Select
        items={metricModeItems}
        value={exerciseMode}
        onValueChange={(value: string | null) => {
          // The list only offers whitelisted options; the guard keeps the
          // reducer payload typed without an `as` cast.
          const parsed = metricModeSchema.safeParse(value)
          if (parsed.success) {
            dispatch({
              type: 'SET_EXERCISE_METRIC_MODE',
              dayIndex,
              index: exerciseIndex,
              value: parsed.data,
            })
          }
        }}
      >
        <SelectTrigger
          aria-label={t('exercise.metricModeAriaLabel', { exerciseName: exercise.name })}
          className="w-full sm:w-56"
        />
        <SelectContent>
          {metricModeItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Scheme line (#228): a plain one-liner for exercises whose sketch
          carries a progression — what the scheme will DO, in lifter language,
          since the builder never edits it. */}
      {exercise.progression !== null && <SchemeSubtitle scheme={exercise.progression.scheme} />}

      {/* Training max: only TM-bearing schemes (percent-1rm / amrap-cycle)
          render it — the one progression field the builder edits. Seeded from
          the stored TM, or prefilled e1rm × 0.85 for authored sketches (the
          caption says so until the first edit). */}
      {(exercise.progression?.scheme === 'percent-1rm' ||
        exercise.progression?.scheme === 'amrap-cycle') && (
        <label className="flex items-center gap-2.5 text-sm">
          <span className="shrink-0">{t('trainingMax.label', { unit })}</span>
          <Input
            type="text"
            inputMode="decimal"
            value={exercise.trainingMax}
            onChange={(event) =>
              dispatch({
                type: 'UPDATE_EXERCISE_TM',
                dayIndex,
                index: exerciseIndex,
                value: event.target.value,
              })
            }
            aria-label={t('trainingMax.ariaLabel', { exerciseName: exercise.name, unit })}
            className="w-24 shrink-0 text-center tnum"
          />
          {exercise.trainingMaxFromE1rm && (
            <span className="text-xs text-muted-foreground">{t('trainingMax.fromE1rmNote')}</span>
          )}
        </label>
      )}

      {/* The set group: indentation + the exercise hairline carry the grouping
          the removed inner box used to. */}
      <div className="space-y-2 pl-2">
        {exercise.sets.length > 0 && (
          <div className="flex items-center gap-2 px-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="w-6 shrink-0" aria-hidden="true" />
            {isCardioExercise ? (
              <>
                {/* Cardio columns: mm:ss + optional km replace the rep/load
                    trio; RPE stays (effort cap) and rest keeps its slot. */}
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
                    // Cardio row: duration (mm:ss, stored seconds) + km for
                    // duration_distance; RPE stays as the optional effort cap,
                    // rest keeps its slot.
                    { field: 'duration', mode: 'numeric', value: set.duration },
                    ...(set.metricMode === 'duration_distance'
                      ? ([{ field: 'distance', mode: 'decimal', value: set.distance }] as const)
                      : []),
                    { field: 'rpe', mode: 'decimal', value: set.rpe },
                    { field: 'restSec', mode: 'numeric', value: set.restSec },
                  ] as const)
                : ([
                    { field: 'repMin', mode: 'numeric', value: set.repMin },
                    { field: 'repMax', mode: 'numeric', value: set.repMax },
                    { field: 'load', mode: 'decimal', value: set.load },
                    { field: 'rpe', mode: 'decimal', value: set.rpe },
                    // Per-set rest target in seconds — the granularity the
                    // product asked for ("per exercise per set"). Rides the
                    // same UPDATE_SET path as its siblings.
                    { field: 'restSec', mode: 'numeric', value: set.restSec },
                  ] as const)
              ).map(({ field, mode, value }) => (
                <Input
                  key={field}
                  type="text"
                  inputMode={mode}
                  // Rest is the one optional-feeling column; the ghost hint says
                  // what the blank means without a legend. Duration hints its
                  // dialect the same quiet way.
                  placeholder={
                    field === 'restSec'
                      ? t('placeholder.rest')
                      : field === 'duration'
                        ? t('placeholder.duration')
                        : undefined
                  }
                  value={value}
                  onChange={(event) =>
                    dispatch({
                      type: 'UPDATE_SET',
                      dayIndex,
                      exerciseIndex,
                      setIndex,
                      field,
                      value: event.target.value,
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
                  // The load column gets extra width: 3-digit values + a decimal
                  // must not clip at the 390px PWA viewport — and so do cardio's
                  // mm:ss / km columns.
                  className={cn(
                    'min-w-0 px-1 text-center tnum',
                    field === 'load' || field === 'duration' || field === 'distance'
                      ? 'flex-[1.4]'
                      : 'flex-1',
                  )}
                />
              ))}
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                onClick={() => dispatch({ type: 'REMOVE_SET', dayIndex, exerciseIndex, setIndex })}
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
}
