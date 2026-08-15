import type {
  DeloadPolicy,
  DietPhase,
  MetricMode,
  ProgramInput,
  ProgramInputUnparsed,
  Progression,
  SetType,
  Technique,
} from '@/lib/program-input'
import type { ProgramDetail } from '@/db/programs'
import type { AutoregStallPolicy } from '@/lib/autoregulate'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { trainingMaxFromE1rm } from '@/lib/one-rep-max'
import { defaultMetricModeForCategory } from '@/lib/workout-input'
import {
  formatDistanceInput,
  formatDurationInput,
  parseDistanceInput,
  parseDurationInput,
} from '@/lib/duration'

/**
 * Pure client-state logic for the program builder, kept free of React/JSX so
 * the reducer and mappers unit-test as plain functions (mirroring
 * `workout-draft.ts`). The builder component wires this to `useReducer`.
 *
 * Editable fields are STRINGS because they back controlled `<input>`s; the
 * server-bound shape (numbers/null) is produced once, at save time, by
 * `draftToProgramInput`. Every reducer case returns fresh objects — no mutation.
 *
 * The builder edits TARGETS only (rep range, load, RPE). Everything richer —
 * progression schemes, techniques, timed metrics, set types — is agent-authored
 * (MCP) and carried through the draft as opaque pass-through fields, so a UI
 * edit of an agent-authored program round-trips that data losslessly instead of
 * destroying it (updateProgram is a full replace).
 */

/** A planned set as edited in the UI: string targets + opaque pass-through. */
export interface DraftProgramSet {
  /** Stable client id, used only for React keys — never persisted. */
  id: string
  repMin: string
  repMax: string
  /** Suggested load in the display unit; converted to kg at save time. */
  load: string
  rpe: string
  /** Rest after this set in seconds ('' = no prescribed target) — per-set,
   *  the finest granularity the tree offers. Editable (not pass-through):
   *  rest is a first-class builder target alongside reps/load/RPE. */
  restSec: string
  /** Cardio targets as typed — duration "mm:ss" (or bare minutes) and
   *  distance in km (lib/duration.ts speaks both). EDITABLE now (cardio v1):
   *  they render instead of rep/load inputs when metricMode ≠ reps_weight.
   *  Stored envelopes written before this change carried NUMBERS
   *  (durationSec/distanceM) — parseStoredProgramDraft converts. */
  duration: string
  distance: string
  // Pass-through fields (never edited by the builder; re-emitted verbatim).
  setType: SetType
  /** How the set is measured — editable via the exercise-level control
   *  (cardio v1); new Cardio-category adds default to duration_distance. */
  metricMode: MetricMode
  rir: number | null
  tempo: string | null
  technique: Technique | null
}

/** An exercise slot in the draft, seeded with at least one empty set. */
export interface DraftProgramExercise {
  /** Stable client id, used only for React keys — never persisted. */
  id: string
  wgerExerciseId: number
  /** Identity is the composite (source, wgerExerciseId). */
  source: ExerciseSource
  name: string
  category: string
  /** Pass-through: agent-authored progression scheme, re-emitted verbatim
   *  EXCEPT its training max, which the builder edits via `trainingMax`. */
  progression: Progression | null
  /** Training max in the display unit ('' = leave the stored value alone) —
   *  editable ONLY when the progression is percent-1rm / amrap-cycle; merged
   *  back into the progression JSONB at save time. */
  trainingMax: string
  /** True while `trainingMax` still holds the e1RM-derived prefill
   *  (e1rm × 0.85 — TM lifecycle §1); drives the "from your e1RM" caption
   *  and clears on the first user edit. */
  trainingMaxFromE1rm: boolean
  /** Pass-through: superset grouping isn't edited by the builder, but must
   *  survive the edit round-trip (a save is a full replace). */
  supersetGroup: number | null
  sets: DraftProgramSet[]
}

/** A training day in the draft — a named, ordered list of exercises. */
export interface DraftProgramDay {
  /** Stable client id, used only for React keys — never persisted. */
  id: string
  name: string
  /** Pass-through: day notes aren't edited by the builder. */
  notes: string | null
  /** Weekday schedule (0–6, Sunday-first), edited by the 7-chip picker;
   *  empty = unscheduled. Kept sorted by toggleWeekday. */
  weekdays: number[]
  exercises: DraftProgramExercise[]
}

export interface ProgramDraft {
  name: string
  /** Weeks per mesocycle as an input string; parsed (min 1) at save time. */
  mesocycleWeeks: string
  /** Deload week as an input string; blank means no deload. */
  deloadWeek: string
  /** Program-level auto-regulation switch (see programs.autoregulation). */
  autoregulation: boolean
  /** Fixed-mode stall policy (see programs.autoregStallPolicy): 'all-sets'
   *  (every working set must hit its floor) | 'first-set' (top set decides). */
  autoregStallPolicy: AutoregStallPolicy
  /** Deload policy (see programs.deloadPolicy). Null = never set — the
   *  read-time resolver keeps legacy behavior; the mode picker shows the
   *  RESOLVED mode but only writes a policy when the user picks one. */
  deloadPolicy: DeloadPolicy | null
  /** Diet-phase context (see programs.dietPhase). Null = None (the default
   *  forever) — no phase, byte-identical engine behavior. */
  dietPhase: DietPhase | null
  /** Performance→plan auto-sync switch (see programs.planSync). */
  planSync: boolean
  /** Suggested body check-in cadence in days as an input string; blank = no
   *  suggestion (see programs.checkInEveryDays). */
  checkInEveryDays: string
  days: DraftProgramDay[]
  // Pass-through fields (lifecycle/notes aren't edited by the builder).
  status: ProgramInput['status']
  notes: string | null
  // Pass-through article metadata (PRD §3): authored by the coach/import
  // paths, not the builder — but a UI edit is a full replace, so dropping
  // them here would silently wipe a program's article surface.
  description: string | null
  icon: string | null
  heroImageUrl: string | null
  sourceUrl: string | null
}

export type ProgramDraftAction =
  | {
      type: 'SET_META'
      field: 'name' | 'mesocycleWeeks' | 'deloadWeek' | 'checkInEveryDays'
      value: string
    }
  | { type: 'SET_AUTOREGULATION'; value: boolean }
  | { type: 'SET_AUTOREG_STALL_POLICY'; value: AutoregStallPolicy }
  | { type: 'SET_DELOAD_POLICY'; value: DeloadPolicy }
  | { type: 'SET_DIET_PHASE'; value: DietPhase | null }
  | { type: 'SET_PLAN_SYNC'; value: boolean }
  | { type: 'ADD_DAY'; day: DraftProgramDay }
  | { type: 'REMOVE_DAY'; index: number }
  | { type: 'RENAME_DAY'; index: number; name: string }
  | { type: 'SET_DAY_WEEKDAYS'; index: number; weekdays: number[] }
  | { type: 'ADD_EXERCISE'; dayIndex: number; exercise: DraftProgramExercise }
  | { type: 'REMOVE_EXERCISE'; dayIndex: number; index: number }
  | { type: 'UPDATE_EXERCISE_TM'; dayIndex: number; index: number; value: string }
  /** The exercise-level metric-mode control: stamps every set of the slot
   *  (per-set drift inside one slot is an agent affordance, not a builder
   *  one). Typed values survive — they re-read under the new mode's columns
   *  and simply don't emit while hidden. */
  | { type: 'SET_EXERCISE_METRIC_MODE'; dayIndex: number; index: number; value: MetricMode }
  | { type: 'ADD_SET'; dayIndex: number; exerciseIndex: number; set: DraftProgramSet }
  | {
      type: 'UPDATE_SET'
      dayIndex: number
      exerciseIndex: number
      setIndex: number
      field: 'repMin' | 'repMax' | 'load' | 'rpe' | 'restSec' | 'duration' | 'distance'
      value: string
    }
  | { type: 'REMOVE_SET'; dayIndex: number; exerciseIndex: number; setIndex: number }
  /** Mount-time restore from the localStorage snapshot — replaces the whole draft. */
  | { type: 'RESTORE_DRAFT'; draft: ProgramDraft }

export const emptyProgramDraft: ProgramDraft = {
  name: '',
  mesocycleWeeks: '',
  deloadWeek: '',
  autoregulation: true,
  autoregStallPolicy: 'all-sets',
  deloadPolicy: null,
  dietPhase: null,
  planSync: true,
  checkInEveryDays: '',
  days: [],
  status: 'draft',
  notes: null,
  description: null,
  icon: null,
  heroImageUrl: null,
  sourceUrl: null,
}

/**
 * Factories that mint stable client ids. Impure (id generation) and therefore
 * kept OUT of the reducer — callers create the object, the reducer just places
 * it, so the reducer stays pure and deterministic for unit tests.
 */
export function newDraftProgramSet(metricMode: MetricMode = 'reps_weight'): DraftProgramSet {
  return {
    id: crypto.randomUUID(),
    repMin: '',
    repMax: '',
    load: '',
    rpe: '',
    restSec: '',
    duration: '',
    distance: '',
    setType: 'working',
    metricMode,
    rir: null,
    tempo: null,
    technique: null,
  }
}

/** Builds a draft exercise from a picked exercise, seeded with one empty set.
 *  A Cardio-category pick seeds duration_distance sets (mapping at add time —
 *  flip via the metric-mode control). */
export function newDraftProgramExercise(picked: {
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  category: string
}): DraftProgramExercise {
  return {
    id: crypto.randomUUID(),
    ...picked,
    progression: null,
    trainingMax: '',
    trainingMaxFromE1rm: false,
    supersetGroup: null,
    sets: [newDraftProgramSet(defaultMetricModeForCategory(picked.category))],
  }
}

/** Builds an empty draft day with the given name. */
export function newDraftProgramDay(name: string): DraftProgramDay {
  return { id: crypto.randomUUID(), name, notes: null, weekdays: [], exercises: [] }
}

/**
 * Toggles one weekday (0–6) in a schedule, returning a fresh sorted array —
 * the chip picker's single state transition, kept here so it unit-tests as a
 * plain function and the draft's sorted invariant has one owner.
 */
export function toggleWeekday(weekdays: readonly number[], weekday: number): number[] {
  return weekdays.includes(weekday)
    ? weekdays.filter((w) => w !== weekday)
    : [...weekdays, weekday].sort((a, b) => a - b)
}

/** Replaces the day at `index` via `update`, returning a new days array. */
function mapDayAt(
  days: DraftProgramDay[],
  index: number,
  update: (day: DraftProgramDay) => DraftProgramDay,
): DraftProgramDay[] {
  return days.map((day, i) => (i === index ? update(day) : day))
}

/** Replaces the exercise at `index` within a day via `update`. */
function mapExerciseAt(
  exercises: DraftProgramExercise[],
  index: number,
  update: (exercise: DraftProgramExercise) => DraftProgramExercise,
): DraftProgramExercise[] {
  return exercises.map((exercise, i) => (i === index ? update(exercise) : exercise))
}

export function programDraftReducer(
  state: ProgramDraft,
  action: ProgramDraftAction,
): ProgramDraft {
  switch (action.type) {
    case 'SET_META':
      return { ...state, [action.field]: action.value }

    case 'SET_AUTOREGULATION':
      return { ...state, autoregulation: action.value }

    case 'SET_AUTOREG_STALL_POLICY':
      return { ...state, autoregStallPolicy: action.value }

    case 'SET_DELOAD_POLICY':
      return { ...state, deloadPolicy: action.value }

    case 'SET_DIET_PHASE':
      return { ...state, dietPhase: action.value }

    case 'SET_PLAN_SYNC':
      return { ...state, planSync: action.value }

    case 'ADD_DAY':
      return { ...state, days: [...state.days, action.day] }

    case 'REMOVE_DAY':
      return { ...state, days: state.days.filter((_, i) => i !== action.index) }

    case 'RENAME_DAY':
      return {
        ...state,
        days: mapDayAt(state.days, action.index, (day) => ({ ...day, name: action.name })),
      }

    case 'SET_DAY_WEEKDAYS':
      return {
        ...state,
        days: mapDayAt(state.days, action.index, (day) => ({ ...day, weekdays: action.weekdays })),
      }

    case 'ADD_EXERCISE':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: [...day.exercises, action.exercise],
        })),
      }

    case 'REMOVE_EXERCISE':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: day.exercises.filter((_, i) => i !== action.index),
        })),
      }

    case 'UPDATE_EXERCISE_TM':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: mapExerciseAt(day.exercises, action.index, (exercise) => ({
            ...exercise,
            trainingMax: action.value,
            // The first user edit ends the prefill's provenance claim.
            trainingMaxFromE1rm: false,
          })),
        })),
      }

    case 'SET_EXERCISE_METRIC_MODE':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: mapExerciseAt(day.exercises, action.index, (exercise) => ({
            ...exercise,
            sets: exercise.sets.map((set) => ({ ...set, metricMode: action.value })),
          })),
        })),
      }

    case 'ADD_SET':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: mapExerciseAt(day.exercises, action.exerciseIndex, (exercise) => ({
            ...exercise,
            sets: [...exercise.sets, action.set],
          })),
        })),
      }

    case 'UPDATE_SET':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: mapExerciseAt(day.exercises, action.exerciseIndex, (exercise) => ({
            ...exercise,
            sets: exercise.sets.map((set, i) =>
              i === action.setIndex ? { ...set, [action.field]: action.value } : set,
            ),
          })),
        })),
      }

    case 'REMOVE_SET':
      return {
        ...state,
        days: mapDayAt(state.days, action.dayIndex, (day) => ({
          ...day,
          exercises: mapExerciseAt(day.exercises, action.exerciseIndex, (exercise) => ({
            ...exercise,
            sets: exercise.sets.filter((_, i) => i !== action.setIndex),
          })),
        })),
      }

    case 'RESTORE_DRAFT':
      return action.draft

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// localStorage persistence. The builder is a long phone form with no server
// draft (unlike the logger); a backgrounded-tab kill would otherwise destroy
// a 30-set program mid-build. Envelope is versioned + TTL'd, and the parser
// validates structure — storage is external data and is never trusted.

/** How long a stored builder draft stays restorable. Mirrors the intent of the
 *  logger's server-draft TTL: yesterday's abandoned form shouldn't hijack a
 *  fresh build next week. */
export const STORED_PROGRAM_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

const STORED_PROGRAM_DRAFT_VERSION = 1

/** Serializes the draft into the versioned, timestamped storage envelope. */
export function buildStoredProgramDraft(draft: ProgramDraft, now: Date): string {
  return JSON.stringify({
    v: STORED_PROGRAM_DRAFT_VERSION,
    savedAt: now.toISOString(),
    draft,
  })
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number'
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

function isDraftProgramSet(v: unknown): v is DraftProgramSet {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    isString(s.id) &&
    isString(s.repMin) &&
    isString(s.repMax) &&
    isString(s.load) &&
    isString(s.rpe) &&
    // Tolerate a missing restSec: envelopes stored before the rest-timer
    // feature predate the field; parseStoredProgramDraft normalizes to ''.
    (s.restSec === undefined || isString(s.restSec)) &&
    isString(s.setType) &&
    isString(s.metricMode) &&
    isNumberOrNull(s.rir) &&
    isStringOrNull(s.tempo) &&
    // Cardio fields changed SHAPE (cardio v1): pre-change envelopes carry
    // numeric durationSec/distanceM pass-throughs, new ones carry the
    // editable duration/distance strings. Both restore; the parse converts.
    (s.duration === undefined || isString(s.duration)) &&
    (s.distance === undefined || isString(s.distance)) &&
    (s.durationSec === undefined || isNumberOrNull(s.durationSec)) &&
    (s.distanceM === undefined || isNumberOrNull(s.distanceM)) &&
    isStringOrNull(s.technique)
  )
}

// `source`/`supersetGroup` are DELIBERATELY not checked here: pre-4b snapshots
// lack them, and the restore backfill defaults 'wger'/null. Adding the check
// would discard every legacy draft; malformed present values are the server
// Zod schema's problem (lenient-mapper policy).
function isDraftProgramExercise(v: unknown): v is DraftProgramExercise {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    isString(e.id) &&
    typeof e.wgerExerciseId === 'number' &&
    isString(e.name) &&
    isString(e.category) &&
    Array.isArray(e.sets) &&
    e.sets.every(isDraftProgramSet)
  )
}

function isDraftProgramDay(v: unknown): v is DraftProgramDay {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    isString(d.id) &&
    isString(d.name) &&
    isStringOrNull(d.notes) &&
    // Tolerate a missing weekdays: pre-schedule envelopes predate the field;
    // parseStoredProgramDraft backfills [] (same policy as restSec).
    (d.weekdays === undefined ||
      (Array.isArray(d.weekdays) && d.weekdays.every((w) => typeof w === 'number'))) &&
    Array.isArray(d.exercises) &&
    d.exercises.every(isDraftProgramExercise)
  )
}

function isProgramDraft(v: unknown): v is ProgramDraft {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    isString(d.name) &&
    isString(d.mesocycleWeeks) &&
    isString(d.deloadWeek) &&
    typeof d.autoregulation === 'boolean' &&
    // Tolerate a missing stall policy: pre-policy envelopes predate the
    // field; parseStoredProgramDraft backfills 'all-sets' (same policy as
    // checkInEveryDays).
    (d.autoregStallPolicy === undefined ||
      d.autoregStallPolicy === 'all-sets' ||
      d.autoregStallPolicy === 'first-set') &&
    // Tolerate a missing/loose deloadPolicy: pre-policy envelopes predate the
    // field, and malformed values are the server Zod schema's problem
    // (lenient-mapper policy); parseStoredProgramDraft backfills null.
    (d.deloadPolicy === undefined ||
      d.deloadPolicy === null ||
      typeof d.deloadPolicy === 'object') &&
    // Tolerate a missing/loose dietPhase: pre-phase envelopes predate the
    // field; parseStoredProgramDraft backfills null (lenient-mapper policy —
    // the server union rejects junk values at save time).
    (d.dietPhase === undefined || d.dietPhase === null || typeof d.dietPhase === 'string') &&
    typeof d.planSync === 'boolean' &&
    // Tolerate a missing checkInEveryDays: pre-cadence envelopes predate the
    // field; parseStoredProgramDraft backfills '' (same policy as weekdays).
    (d.checkInEveryDays === undefined || isString(d.checkInEveryDays)) &&
    isString(d.status) &&
    isStringOrNull(d.notes) &&
    Array.isArray(d.days) &&
    d.days.every(isDraftProgramDay)
  )
}

/**
 * Parses a stored envelope back into a draft, or null when the payload is
 * malformed, from a different envelope version, or older than the TTL. The
 * pass-through unions (setType, technique, …) are validated as strings only —
 * the server's Zod schema re-validates them at save time, mirroring how
 * `draftToProgramInput` is lenient by design.
 */
export function parseStoredProgramDraft(raw: string, now: Date): ProgramDraft | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.v !== STORED_PROGRAM_DRAFT_VERSION) return null
  if (!isString(envelope.savedAt)) return null
  const savedAt = Date.parse(envelope.savedAt)
  if (Number.isNaN(savedAt) || now.getTime() - savedAt > STORED_PROGRAM_DRAFT_TTL_MS) return null
  if (!isProgramDraft(envelope.draft)) return null
  // Backfill fields newer than the stored draft (same envelope version — the
  // shape only GREW): a pre-rest-timer draft restores with restSec unset
  // instead of being discarded a day into a 30-set build.
  return {
    ...envelope.draft,
    // Pre-cadence snapshots restore with no suggestion, not discarded.
    checkInEveryDays: envelope.draft.checkInEveryDays ?? '',
    // Pre-stall-policy snapshots restore on the default rule, not discarded.
    autoregStallPolicy: envelope.draft.autoregStallPolicy ?? 'all-sets',
    // Pre-deload-policy snapshots restore on legacy resolution, not discarded.
    deloadPolicy: envelope.draft.deloadPolicy ?? null,
    // Pre-diet-phase snapshots restore phase-less, not discarded.
    dietPhase: envelope.draft.dietPhase ?? null,
    // Pre-article-metadata snapshots restore with the fields absent → null.
    description: envelope.draft.description ?? null,
    icon: envelope.draft.icon ?? null,
    heroImageUrl: envelope.draft.heroImageUrl ?? null,
    sourceUrl: envelope.draft.sourceUrl ?? null,
    days: envelope.draft.days.map((day) => ({
      ...day,
      // Pre-schedule snapshots restore unscheduled, not discarded.
      weekdays: day.weekdays ?? [],
      exercises: day.exercises.map((exercise) => ({
        ...exercise,
        // Pre-composite-identity drafts restore as plain wger, ungrouped.
        source: exercise.source ?? 'wger',
        supersetGroup: exercise.supersetGroup ?? null,
        // Pre-TM-field snapshots restore with the stored TM untouched.
        trainingMax: exercise.trainingMax ?? '',
        trainingMaxFromE1rm: exercise.trainingMaxFromE1rm ?? false,
        sets: exercise.sets.map((set) => {
          // Legacy cardio pass-throughs (numeric durationSec/distanceM)
          // convert to today's editable strings; the numeric keys are
          // dropped from the restored object.
          const { durationSec, distanceM, ...rest } = set as Omit<
            DraftProgramSet,
            'duration' | 'distance'
          > & {
            duration?: string
            distance?: string
            durationSec?: number | null
            distanceM?: number | null
          }
          return {
            ...rest,
            restSec: rest.restSec ?? '',
            duration:
              rest.duration ?? (durationSec != null ? formatDurationInput(durationSec) : ''),
            distance:
              rest.distance ?? (distanceM != null ? formatDistanceInput(distanceM) : ''),
          }
        }),
      })),
    })),
  }
}

/** Parses an int string to a non-negative integer, or null when blank/invalid. */
function toInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = parseInt(trimmed, 10)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Parses a decimal string to a non-negative number, or null when blank/invalid. */
function toDecimal(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = parseFloat(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** True for the schemes that carry a training max (TM lifecycle §1). */
function hasTrainingMax(
  progression: Progression | null,
): progression is Extract<Progression, { scheme: 'percent-1rm' | 'amrap-cycle' }> {
  return progression?.scheme === 'percent-1rm' || progression?.scheme === 'amrap-cycle'
}

/**
 * Merges the builder's display-unit training-max input back into the
 * progression JSONB at save time. Blank/invalid (or a non-TM scheme) leaves
 * the stored progression untouched — the pass-through guarantee holds unless
 * the user actually typed a number. Immutable: a fresh object, never a patch
 * of the draft's progression.
 */
function withDraftTrainingMax(
  progression: Progression | null,
  trainingMax: string,
  unit: WeightUnit,
): Progression | null {
  if (!hasTrainingMax(progression)) return progression
  const tm = toDecimal(trainingMax)
  if (tm === null) return progression
  return { ...progression, trainingMaxKg: displayToKg(tm, unit) }
}

/**
 * The server-bound payload: `ProgramInput` except that a blank program name is
 * dropped (mirroring `draftToInput`) so the server's Zod `min(1)` rejects it
 * with a clear error instead of the mapper inventing one.
 */
export type ProgramInputPayload = Omit<ProgramInputUnparsed, 'name'> & { name?: string }

/**
 * Maps the string-based draft to the server contract. Lenient by design — the
 * Server Action re-validates via `parseProgramInput`; here `''` → `null` and
 * numeric strings become numbers (a repMin > repMax pair is sent as-is and
 * rejected server-side). Loads are entered in `unit` and converted to canonical
 * kg here. `mesocycleWeeks` falls back to 1 (the schema default) when blank or
 * invalid; a blank deload week means no deload. All pass-through fields are
 * re-emitted verbatim so agent-authored data survives a UI edit.
 */
export function draftToProgramInput(
  draft: ProgramDraft,
  unit: WeightUnit = 'kg',
): ProgramInputPayload {
  const trimmedName = draft.name.trim()
  const days = draft.days.map((day) => ({
    name: day.name,
    notes: day.notes,
    weekdays: day.weekdays,
    exercises: day.exercises.map((exercise) => ({
      wgerExerciseId: exercise.wgerExerciseId,
      source: exercise.source,
      name: exercise.name,
      progression: withDraftTrainingMax(exercise.progression, exercise.trainingMax, unit),
      supersetGroup: exercise.supersetGroup,
      sets: exercise.sets.map((set) => {
        const load = toDecimal(set.load)
        return {
          setType: set.setType,
          metricMode: set.metricMode,
          repMin: toInt(set.repMin),
          repMax: toInt(set.repMax),
          rir: set.rir,
          rpe: toDecimal(set.rpe),
          suggestedLoadKg: load === null ? null : displayToKg(load, unit),
          tempo: set.tempo,
          // Cardio strings parse to canonical units (mm:ss → seconds, km →
          // meters); blank/invalid → null, and a cardio set missing its
          // duration is the server integrity rule's to reject visibly.
          durationSec: parseDurationInput(set.duration),
          distanceM: parseDistanceInput(set.distance),
          // Seconds are unit-less — no display conversion, unlike load. An
          // out-of-range value passes through for the server's 0..3600
          // bound to reject visibly (lenient-mapper policy above).
          restSec: toInt(set.restSec),
          technique: set.technique,
        }
      }),
    })),
  }))

  const base = {
    status: draft.status,
    // ?? not ||: blank/invalid falls back to the schema default, but an explicit
    // "0" passes through so the server's min(1) rejects it visibly.
    mesocycleWeeks: toInt(draft.mesocycleWeeks) ?? 1,
    deloadWeek: toInt(draft.deloadWeek),
    autoregulation: draft.autoregulation,
    autoregStallPolicy: draft.autoregStallPolicy,
    // Null round-trips to null (nothing stored → nothing cleared); a picked
    // mode persists. Full-replace safe: the draft always carries the stored
    // value via detailToProgramDraft.
    deloadPolicy: draft.deloadPolicy,
    // Null round-trips to null when nothing was ever set; picking None on a
    // phased program sends an explicit null, which clears (full-replace
    // safe: the draft always carries the stored value via
    // detailToProgramDraft, same as deloadPolicy above).
    dietPhase: draft.dietPhase,
    planSync: draft.planSync,
    // Blank = clear the suggestion (explicit null — the builder always shows
    // the stored value, so a full replace saying null MEANS off). An
    // out-of-range value passes through for the server's 3–90 bound to
    // reject visibly (lenient-mapper policy).
    checkInEveryDays: toInt(draft.checkInEveryDays),
    notes: draft.notes,
    description: draft.description,
    icon: draft.icon,
    heroImageUrl: draft.heroImageUrl,
    sourceUrl: draft.sourceUrl,
    days,
  }
  return trimmedName ? { name: trimmedName, ...base } : base
}

/** Narrows the loose `text` status column to the schema's status union. */
function toStatus(status: string): ProgramInput['status'] {
  return status === 'active' || status === 'archived' ? status : 'draft'
}

/**
 * Seeds an editable draft from a persisted program (the inverse of
 * draftToProgramInput). Numbers become input strings (`null` → `''`); the
 * persisted row UUIDs are reused as the draft's client ids (stable React keys).
 * `category` is not a persisted column, so it comes back empty. Stored kg loads
 * are converted to `unit` for display. Pass-through fields (progression,
 * technique, set types, timed metrics, notes, status) are carried verbatim.
 * Pure (no `crypto`), so the edit Server Component can call it safely.
 */
/** Display-unit string for a TM input, rounded to 1 decimal (kg passes
 *  through kgToDisplay unrounded, so an e1RM-derived prefill needs its own
 *  rounding — 97.75000001 must read "97.8"). */
function tmDisplayString(valueKg: number, unit: WeightUnit): string {
  return (Math.round(kgToDisplay(valueKg, unit) * 10) / 10).toString()
}

/** The builder's seed for one exercise's TM input: the stored training max
 *  when one is set; when the stored TM is 0 (an authored sketch) and e1RM
 *  history exists, the e1rm × 0.85 prefill (flagged for the "from your e1RM"
 *  caption); blank otherwise. Non-TM schemes always seed blank. */
function seedTrainingMax(
  progression: Progression | null,
  e1rmKg: number | null | undefined,
  unit: WeightUnit,
): { trainingMax: string; trainingMaxFromE1rm: boolean } {
  if (!hasTrainingMax(progression)) return { trainingMax: '', trainingMaxFromE1rm: false }
  if (progression.trainingMaxKg > 0) {
    return { trainingMax: tmDisplayString(progression.trainingMaxKg, unit), trainingMaxFromE1rm: false }
  }
  const suggested = trainingMaxFromE1rm(e1rmKg ?? null)
  if (suggested === null) return { trainingMax: '', trainingMaxFromE1rm: false }
  return { trainingMax: tmDisplayString(suggested, unit), trainingMaxFromE1rm: true }
}

/** The e1RM map key used by `detailToProgramDraft` — composite identity,
 *  matching the catalog convention. */
export function e1rmKey(source: ExerciseSource, wgerExerciseId: number): string {
  return `${source}:${wgerExerciseId}`
}

export function detailToProgramDraft(
  detail: ProgramDetail,
  unit: WeightUnit = 'kg',
  /** e1RMs (kg) keyed by `e1rmKey(source, id)` — feeds the TM prefill for
   *  authored sketches (stored TM 0). Absent = no prefill (the /new page). */
  e1rmKgByExercise?: ReadonlyMap<string, number>,
): ProgramDraft {
  return {
    name: detail.name,
    mesocycleWeeks: detail.mesocycleWeeks.toString(),
    deloadWeek: detail.deloadWeek?.toString() ?? '',
    autoregulation: detail.autoregulation,
    autoregStallPolicy: detail.autoregStallPolicy,
    deloadPolicy: detail.deloadPolicy,
    dietPhase: detail.dietPhase,
    planSync: detail.planSync,
    checkInEveryDays: detail.checkInEveryDays?.toString() ?? '',
    status: toStatus(detail.status),
    notes: detail.notes,
    description: detail.description,
    icon: detail.icon,
    heroImageUrl: detail.heroImageUrl,
    sourceUrl: detail.sourceUrl,
    days: detail.days.map((day) => ({
      id: day.id,
      name: day.name,
      notes: day.notes,
      weekdays: day.weekdays,
      exercises: day.exercises.map((exercise) => ({
        id: exercise.id,
        wgerExerciseId: exercise.wgerExerciseId,
        source: exercise.source,
        name: exercise.name,
        category: '',
        progression: exercise.progression,
        ...seedTrainingMax(
          exercise.progression,
          e1rmKgByExercise?.get(e1rmKey(exercise.source, exercise.wgerExerciseId)),
          unit,
        ),
        supersetGroup: exercise.supersetGroup,
        sets: exercise.sets.map((set) => ({
          id: set.id,
          repMin: set.repMin?.toString() ?? '',
          repMax: set.repMax?.toString() ?? '',
          load:
            set.suggestedLoadKg === null ? '' : kgToDisplay(set.suggestedLoadKg, unit).toString(),
          rpe: set.rpe?.toString() ?? '',
          restSec: set.restSec?.toString() ?? '',
          duration: set.durationSec !== null ? formatDurationInput(set.durationSec) : '',
          distance: set.distanceM !== null ? formatDistanceInput(set.distanceM) : '',
          setType: set.setType,
          metricMode: set.metricMode,
          rir: set.rir,
          tempo: set.tempo,
          technique: set.technique,
        })),
      })),
    })),
  }
}
