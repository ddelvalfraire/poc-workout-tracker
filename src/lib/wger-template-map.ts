/**
 * Pure mapper: a wger routine structure → our `ProgramInputUnparsed`.
 *
 * wger's `/routine/{id}/structure/` nests days → slots → slot entries, each
 * entry carrying per-iteration config lists (sets, repetitions, weight, rest,
 * RIR). We flatten the ITERATION-1 baseline of each config into one planned
 * set shape and replicate it `sets` times — wger's per-iteration progression
 * rules (operation/step) are its own engine's concern and are deliberately not
 * imported. Unmappable pieces are skipped and noted, never fatal: one unknown
 * exercise must not sink a whole template.
 *
 * Everything here is pure and defensive: the input is upstream data validated
 * only at the top level by the fetch layer, so every field read is narrowed
 * before use (mirroring `wger.ts`'s per-record policy).
 */
import type { ProgramInputUnparsed } from './program-input'
import { MAX_REST_SEC } from './program-input'

/** Our schema's mesocycle ceiling (`programInputSchema.mesocycleWeeks` max). */
const MAX_WEEKS = 52
const MIN_WEEKS = 1
/** "default 4 if unclear" — a routine without usable start/end dates. */
const DEFAULT_WEEKS = 4
/** Baseline sets per slot entry; more than 10 in a template is upstream noise. */
const MAX_SETS_PER_ENTRY = 10
const MAX_REPS = 10_000
const MAX_DURATION_SEC = 86_400
const MAX_NAME = 200
const MAX_DESCRIPTION = 4000
const LB_TO_KG = 0.45359237
const MS_PER_DAY = 24 * 60 * 60 * 1000

// wger unit ids (wger/core/fixtures/setting_*_units.json).
const REP_UNIT_REPETITIONS = 1
const REP_UNIT_UNTIL_FAILURE = 2
const REP_UNIT_SECONDS = 3
const REP_UNIT_MINUTES = 4
const REP_UNIT_MAX_REPS = 7
const WEIGHT_UNIT_KG = 1
const WEIGHT_UNIT_LB = 2

// --- Upstream shapes (RoutineStructureSerializer) — only the fields we read.
// wger serializes decimals as strings, so config `value` is string | number.

export interface WgerConfigValue {
  iteration?: unknown
  value?: unknown
}

export interface WgerSlotEntry {
  exercise?: unknown
  repetition_unit?: unknown
  weight_unit?: unknown
  repetitions_configs?: unknown
  max_repetitions_configs?: unknown
  weight_configs?: unknown
  set_nr_configs?: unknown
  rir_configs?: unknown
  rest_configs?: unknown
}

export interface WgerSlot {
  entries?: unknown
}

export interface WgerRoutineDay {
  name?: unknown
  is_rest?: unknown
  slots?: unknown
}

export interface WgerRoutineStructure {
  id: number
  name?: unknown
  description?: unknown
  start?: unknown
  end?: unknown
  days?: unknown
}

/** The mapper's result: a schema-ready input plus human-readable skip notes. */
export interface MappedTemplate {
  input: ProgramInputUnparsed
  /** What was dropped and why — surfaced to the importer, not silently lost. */
  skipped: string[]
}

/** Baseline value of a config list: the entry with the LOWEST iteration. */
function baselineValue(configs: unknown): number | null {
  if (!Array.isArray(configs)) return null
  let best: { iteration: number; value: number } | null = null
  for (const raw of configs) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as WgerConfigValue
    const iteration = typeof c.iteration === 'number' ? c.iteration : Number.MAX_SAFE_INTEGER
    const value =
      typeof c.value === 'number'
        ? c.value
        : typeof c.value === 'string'
          ? Number.parseFloat(c.value)
          : Number.NaN
    if (!Number.isFinite(value)) continue
    if (best === null || iteration < best.iteration) best = { iteration, value }
  }
  return best?.value ?? null
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}

/**
 * Derives `mesocycleWeeks` from a routine's start/end dates: round the span to
 * whole weeks, clamped to our schema's bounds. Missing or malformed dates —
 * or an end before the start — fall back to 4 weeks.
 */
export function deriveMesocycleWeeks(start: unknown, end: unknown): number {
  if (typeof start !== 'string' || typeof end !== 'string') return DEFAULT_WEEKS
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return DEFAULT_WEEKS
  const days = (endMs - startMs) / MS_PER_DAY
  if (days <= 0) return DEFAULT_WEEKS
  return clampInt(days / 7, MIN_WEEKS, MAX_WEEKS)
}

/** Keyword → emoji for template cards; ordered, first match wins. */
const ICON_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/5x5|5\/3\/1|531|strength|power/i, '🏋️'],
  [/hypertrophy|muscle|body\s*build|mass/i, '💪'],
  [/run|cardio|hiit|conditioning/i, '🏃'],
  [/push|pull|legs|ppl|split/i, '🔀'],
  [/full\s*body|total\s*body/i, '🔁'],
]
const DEFAULT_ICON = '📋'

/** Picks a card emoji from the template's name + description keywords. */
export function pickTemplateIcon(name: string, description: string): string {
  const haystack = `${name} ${description}`
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(haystack)) return icon
  }
  return DEFAULT_ICON
}

type DayShape = ProgramInputUnparsed['days'][number]
type ExerciseShape = DayShape['exercises'][number]
type SetShape = ExerciseShape['sets'][number]

/** Builds the replicated set shapes for one slot entry, or null when the
 *  entry's repetition unit is one we cannot express (distance-based, etc.). */
function buildSets(entry: WgerSlotEntry): SetShape[] | null {
  const repUnit = typeof entry.repetition_unit === 'number' ? entry.repetition_unit : null
  const weightUnit = typeof entry.weight_unit === 'number' ? entry.weight_unit : null

  const setCount = clampInt(baselineValue(entry.set_nr_configs) ?? 1, 1, MAX_SETS_PER_ENTRY)
  const reps = baselineValue(entry.repetitions_configs)
  const maxReps = baselineValue(entry.max_repetitions_configs)
  const weight = baselineValue(entry.weight_configs)
  const rir = baselineValue(entry.rir_configs)
  const rest = baselineValue(entry.rest_configs)

  const shape: SetShape = {}

  if (repUnit === null || repUnit === REP_UNIT_REPETITIONS) {
    if (reps !== null) {
      shape.repMin = clampInt(reps, 0, MAX_REPS)
      // wger's max-repetitions config is the range top; absent = fixed reps.
      shape.repMax =
        maxReps !== null && maxReps >= reps ? clampInt(maxReps, 0, MAX_REPS) : shape.repMin
    }
  } else if (repUnit === REP_UNIT_UNTIL_FAILURE || repUnit === REP_UNIT_MAX_REPS) {
    shape.setType = 'amrap'
  } else if (repUnit === REP_UNIT_SECONDS || repUnit === REP_UNIT_MINUTES) {
    if (reps === null) return null // a timed set with no duration is meaningless
    const seconds = repUnit === REP_UNIT_MINUTES ? reps * 60 : reps
    shape.metricMode = 'duration'
    shape.durationSec = clampInt(seconds, 0, MAX_DURATION_SEC)
  } else {
    return null // distance-based units don't fit a strength plan slot
  }

  // Weight: kg passes through, lb converts (canonical kg, like every weight
  // in the app); bodyweight/speed units carry no load.
  if (weight !== null && weight > 0) {
    if (weightUnit === null || weightUnit === WEIGHT_UNIT_KG) {
      shape.suggestedLoadKg = Math.round(weight * 100) / 100
    } else if (weightUnit === WEIGHT_UNIT_LB) {
      shape.suggestedLoadKg = Math.round(weight * LB_TO_KG * 100) / 100
    }
  }

  if (rir !== null) shape.rir = clampInt(rir, 0, 20)
  if (rest !== null && rest > 0) shape.restSec = clampInt(rest, 0, MAX_REST_SEC)

  return Array.from({ length: setCount }, () => ({ ...shape }))
}

/**
 * Maps a wger routine structure to a schema-ready program input against the
 * given exercise catalog (wger exercise id → English name). Returns null when
 * nothing mappable remains (no trainable days). Unknown exercises and
 * inexpressible entries are skipped with a note — never a hard failure.
 */
export function mapWgerRoutineToProgram(
  routine: WgerRoutineStructure,
  catalog: ReadonlyMap<number, string>,
): MappedTemplate | null {
  const skipped: string[] = []
  const name =
    typeof routine.name === 'string' && routine.name.trim().length > 0
      ? routine.name.trim().slice(0, MAX_NAME)
      : `wger routine ${routine.id}`
  const description =
    typeof routine.description === 'string' && routine.description.trim().length > 0
      ? routine.description.trim().slice(0, MAX_DESCRIPTION)
      : null

  const days: DayShape[] = []
  const rawDays = Array.isArray(routine.days) ? routine.days : []
  // Superset groups are unique across the whole program; number across days.
  let supersetCounter = 0

  for (const [dayIndex, rawDay] of rawDays.entries()) {
    if (!rawDay || typeof rawDay !== 'object') continue
    const day = rawDay as WgerRoutineDay
    if (day.is_rest === true) continue // rest days have no slots to plan

    const dayName =
      typeof day.name === 'string' && day.name.trim().length > 0
        ? day.name.trim().slice(0, MAX_NAME)
        : `Day ${dayIndex + 1}`

    const exercises: ExerciseShape[] = []
    const slots = Array.isArray(day.slots) ? day.slots : []
    for (const rawSlot of slots) {
      if (!rawSlot || typeof rawSlot !== 'object') continue
      const slot = rawSlot as WgerSlot
      const entries = Array.isArray(slot.entries) ? slot.entries : []

      const slotExercises: ExerciseShape[] = []
      for (const rawEntry of entries) {
        if (!rawEntry || typeof rawEntry !== 'object') continue
        const entry = rawEntry as WgerSlotEntry
        if (typeof entry.exercise !== 'number') continue

        const exerciseName = catalog.get(entry.exercise)
        if (exerciseName === undefined) {
          skipped.push(`${dayName}: unknown exercise #${entry.exercise} skipped`)
          continue
        }
        const sets = buildSets(entry)
        if (sets === null) {
          skipped.push(`${dayName}: ${exerciseName} uses an unsupported unit, skipped`)
          continue
        }
        slotExercises.push({ wgerExerciseId: entry.exercise, name: exerciseName, sets })
      }

      // A multi-entry slot IS a superset in wger's model; ours marks that by
      // giving every member the same non-null group number.
      if (slotExercises.length > 1) {
        supersetCounter += 1
        for (const exercise of slotExercises) exercise.supersetGroup = supersetCounter
      }
      exercises.push(...slotExercises)
    }

    if (exercises.length === 0) {
      skipped.push(`${dayName}: no mappable exercises, day skipped`)
      continue
    }
    days.push({ name: dayName, exercises })
  }

  if (days.length === 0) return null

  const input: ProgramInputUnparsed = {
    name,
    status: 'draft',
    mesocycleWeeks: deriveMesocycleWeeks(routine.start, routine.end),
    ...(description !== null ? { description } : {}),
    icon: pickTemplateIcon(name, description ?? ''),
    // Attribution is a requirement: wger content is CC-licensed.
    sourceUrl: `https://wger.de/en/routine/${routine.id}/view`,
    days,
  }
  return { input, skipped }
}
