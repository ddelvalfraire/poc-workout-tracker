import type {
  MetricMode,
  ProgramInput,
  ProgramInputUnparsed,
  Progression,
  SetType,
  Technique,
} from '@/lib/program-input'
import type { ProgramDetail } from '@/db/programs'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'

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
  // Pass-through fields (never edited by the builder; re-emitted verbatim).
  setType: SetType
  metricMode: MetricMode
  rir: number | null
  tempo: string | null
  durationSec: number | null
  distanceM: number | null
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
  /** Pass-through: agent-authored progression scheme, re-emitted verbatim. */
  progression: Progression | null
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
  | { type: 'SET_META'; field: 'name' | 'mesocycleWeeks' | 'deloadWeek'; value: string }
  | { type: 'SET_AUTOREGULATION'; value: boolean }
  | { type: 'ADD_DAY'; day: DraftProgramDay }
  | { type: 'REMOVE_DAY'; index: number }
  | { type: 'RENAME_DAY'; index: number; name: string }
  | { type: 'ADD_EXERCISE'; dayIndex: number; exercise: DraftProgramExercise }
  | { type: 'REMOVE_EXERCISE'; dayIndex: number; index: number }
  | { type: 'ADD_SET'; dayIndex: number; exerciseIndex: number; set: DraftProgramSet }
  | {
      type: 'UPDATE_SET'
      dayIndex: number
      exerciseIndex: number
      setIndex: number
      field: 'repMin' | 'repMax' | 'load' | 'rpe' | 'restSec'
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
export function newDraftProgramSet(): DraftProgramSet {
  return {
    id: crypto.randomUUID(),
    repMin: '',
    repMax: '',
    load: '',
    rpe: '',
    restSec: '',
    setType: 'working',
    metricMode: 'reps_weight',
    rir: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    technique: null,
  }
}

/** Builds a draft exercise from a picked exercise, seeded with one empty set. */
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
    supersetGroup: null,
    sets: [newDraftProgramSet()],
  }
}

/** Builds an empty draft day with the given name. */
export function newDraftProgramDay(name: string): DraftProgramDay {
  return { id: crypto.randomUUID(), name, notes: null, exercises: [] }
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

    case 'ADD_DAY':
      return { ...state, days: [...state.days, action.day] }

    case 'REMOVE_DAY':
      return { ...state, days: state.days.filter((_, i) => i !== action.index) }

    case 'RENAME_DAY':
      return {
        ...state,
        days: mapDayAt(state.days, action.index, (day) => ({ ...day, name: action.name })),
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
    isNumberOrNull(s.durationSec) &&
    isNumberOrNull(s.distanceM) &&
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
    // Pre-article-metadata snapshots restore with the fields absent → null.
    description: envelope.draft.description ?? null,
    icon: envelope.draft.icon ?? null,
    heroImageUrl: envelope.draft.heroImageUrl ?? null,
    sourceUrl: envelope.draft.sourceUrl ?? null,
    days: envelope.draft.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => ({
        ...exercise,
        // Pre-composite-identity drafts restore as plain wger, ungrouped.
        source: exercise.source ?? 'wger',
        supersetGroup: exercise.supersetGroup ?? null,
        sets: exercise.sets.map((set) => ({ ...set, restSec: set.restSec ?? '' })),
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
    exercises: day.exercises.map((exercise) => ({
      wgerExerciseId: exercise.wgerExerciseId,
      source: exercise.source,
      name: exercise.name,
      progression: exercise.progression,
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
          durationSec: set.durationSec,
          distanceM: set.distanceM,
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
export function detailToProgramDraft(
  detail: ProgramDetail,
  unit: WeightUnit = 'kg',
): ProgramDraft {
  return {
    name: detail.name,
    mesocycleWeeks: detail.mesocycleWeeks.toString(),
    deloadWeek: detail.deloadWeek?.toString() ?? '',
    autoregulation: detail.autoregulation,
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
      exercises: day.exercises.map((exercise) => ({
        id: exercise.id,
        wgerExerciseId: exercise.wgerExerciseId,
        source: exercise.source,
        name: exercise.name,
        category: '',
        progression: exercise.progression,
        supersetGroup: exercise.supersetGroup,
        sets: exercise.sets.map((set) => ({
          id: set.id,
          repMin: set.repMin?.toString() ?? '',
          repMax: set.repMax?.toString() ?? '',
          load:
            set.suggestedLoadKg === null ? '' : kgToDisplay(set.suggestedLoadKg, unit).toString(),
          rpe: set.rpe?.toString() ?? '',
          restSec: set.restSec?.toString() ?? '',
          setType: set.setType,
          metricMode: set.metricMode,
          rir: set.rir,
          tempo: set.tempo,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          technique: set.technique,
        })),
      })),
    })),
  }
}
