/**
 * Human one-liners for coach tool calls — what the approval card leads with
 * instead of raw JSON. Pure structure-building over the tool INPUT only: the
 * input can't tell us before-values (an override doesn't carry what week 4
 * said before), so summaries state only what will be true after — the
 * "{field} → {new}" shape — and never invent a "was".
 *
 * Nothing here returns a sentence (docs/I18N-KEYS.md §9). The function picks
 * the location pieces and the change phrases; `renderToolCall` in
 * ./render-tool-call.ts turns them into the line, so the same decision
 * renders in the client chat (useTranslations) and on the server-rendered
 * program page (getTranslations).
 *
 * Positions arrive 0-based (dayPosition/exercisePosition, matching
 * get_program) but render 1-based ("Day 3"), because users count from one;
 * setNumber and week are already 1-based. Inputs are model-authored, so every
 * field is re-checked here — a known tool with a mangled input degrades to
 * whatever is still true, and an unknown tool falls back to its humanized name.
 */

import type { Message } from '@/lib/message'

/** Catalog keys for the tool-call summaries — all under the `CoachToolCall`
 *  namespace, shared by the chat's approval card and the program page's
 *  proposal diff. */
export type ToolCallKey =
  | 'location.day'
  | 'location.exercise'
  | 'location.set'
  | 'location.week'
  | 'change.addDay'
  | 'change.addDayNamed'
  | 'change.removeDay'
  | 'change.moveDay'
  | 'change.addExercise'
  | 'change.removeExercise'
  | 'change.moveExercise'
  | 'change.rename'
  | 'change.swapTo'
  | 'change.swapMovement'
  | 'change.source'
  | 'change.progressionUpdate'
  | 'change.progressionClear'
  | 'change.supersetGroup'
  | 'change.supersetUngroup'
  | 'change.notesUpdate'
  | 'change.notesClear'
  | 'change.substitute'
  | 'change.substituteMovement'
  | 'change.addSet'
  | 'change.removeSet'
  | 'change.moveSet'
  | 'change.dropOverride'
  | 'change.autoregulationOn'
  | 'change.autoregulationOff'
  | 'change.planSyncEnabled'
  | 'change.planSyncDisabled'
  | 'change.deloadPolicyClear'
  | 'change.deloadPolicy'
  | 'change.dietPhaseClear'
  | 'change.dietPhase'
  | 'change.overshootClear'
  | 'change.overshoot'
  | 'change.trainingMax'
  | 'change.trainingMaxWithReason'
  | 'change.program'
  | 'change.programNamed'
  | 'target.value'
  | 'target.cleared'
  | 'target.unpinned'
  | 'target.techniqueUpdated'
  | 'meta.days'
  | 'meta.weeks'

type Phrase = Message<ToolCallKey>

/**
 * A tool call as its parts, in render order. The renderer joins them —
 * "Week 4 only — day 2, exercise 3: reps → 8–10" — with punctuation only, so
 * every translatable fragment stays its own catalog entry and no sentence is
 * ever built by gluing translations together.
 */
export interface ToolCallDescription {
  /** Week scope, ahead of the location ("week 4 only — day 2, …"). */
  scope: Phrase | null
  /** Location pieces: "day 2", "exercise 3", "set 1". */
  location: Phrase[]
  /** The changes themselves. Empty means "nothing survived validation" and
   *  the renderer falls back to the humanized `toolName`. */
  changes: Phrase[]
  /** Parenthesised target list, for a set being added with prescriptions. */
  detail: Phrase[]
  /** Trailing dot-separated meta ("· 3 days · 6 weeks"). */
  meta: Phrase[]
  /** The MCP tool name — a protocol identifier, not copy, so it never enters
   *  the catalog. The renderer humanizes it for the never-blank fallback. */
  toolName: string
}

const OVERSHOOT_ARMS: Record<string, string | undefined> = {
  'strict-load': 'strictLoad',
  'e1rm-equivalent': 'e1rmEquivalent',
  'any-metric': 'anyMetric',
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 0-based position → 1-based display ordinal, or null when absent/mangled. */
function ordinal(value: unknown): number | null {
  const n = num(value)
  return n !== null && Number.isInteger(n) && n >= 0 ? n + 1 : null
}

/** The present location pieces: day, exercise, and optionally set. */
function locationPhrases(args: Record<string, unknown>, includeSet: boolean): Phrase[] {
  const phrases: Phrase[] = []
  const day = ordinal(args.dayPosition)
  const exercise = ordinal(args.exercisePosition)
  const set = includeSet ? num(args.setNumber) : null
  if (day !== null) phrases.push({ key: 'location.day', values: { day } })
  if (exercise !== null) phrases.push({ key: 'location.exercise', values: { exercise } })
  if (set !== null) phrases.push({ key: 'location.set', values: { set } })
  return phrases
}

/**
 * How a null value reads per tool family: updates CLEAR a stored value,
 * overrides UNPIN a week back to the engine. Adds skip nulls entirely —
 * "clearing" a field on a set that doesn't exist yet says nothing.
 */
type NullWord = 'cleared' | 'unpinned' | null

interface FieldPhraseArgs {
  args: Record<string, unknown>
  nullWord: NullWord
}

/** "{field} cleared" / "{field} unpinned" — one key per null word, with the
 *  field selected inside the message so the translator owns the whole line
 *  instead of receiving two half-sentences to concatenate. */
function nullPhrase(field: string, nullWord: Exclude<NullWord, null>): Phrase {
  return { key: nullWord === 'cleared' ? 'target.cleared' : 'target.unpinned', values: { field } }
}

/** "{field} → {value}". `value` is always a formatted datum (a number, a rep
 *  range, a load with its unit), never a phrase. */
function valuePhrase(field: string, value: string): Phrase {
  return { key: 'target.value', values: { field, value } }
}

/** "reps → 8–10" | "min reps → 8" | "reps cleared", from repMin/repMax. */
function repsPhrases({ args, nullWord }: FieldPhraseArgs): Phrase[] {
  const { repMin, repMax } = args
  // Both explicitly null collapses to one phrase.
  if (repMin === null && repMax === null && nullWord) return [nullPhrase('reps', nullWord)]
  const min = num(repMin)
  const max = num(repMax)
  if (min !== null && max !== null) {
    return [valuePhrase('reps', min === max ? String(min) : `${min}–${max}`)]
  }
  const phrases: Phrase[] = []
  if (min !== null) phrases.push(valuePhrase('minReps', String(min)))
  else if (repMin === null && nullWord) phrases.push(nullPhrase('minReps', nullWord))
  if (max !== null) phrases.push(valuePhrase('maxReps', String(max)))
  else if (repMax === null && nullWord) phrases.push(nullPhrase('maxReps', nullWord))
  return phrases
}

/** One "{field} → {new}" phrase; null input → the family's null word. */
function scalarPhrase(
  field: string,
  value: unknown,
  nullWord: NullWord,
  render: (n: number) => string = String,
): Phrase | null {
  const n = num(value)
  if (n !== null) return valuePhrase(field, render(n))
  if (value === null && nullWord) return nullPhrase(field, nullWord)
  return null
}

/**
 * The shared planned-set target fields (add/update/override) as phrases, in a
 * stable schema-ish order. `suggestedLoad` echoes the explicit `unit` arg when
 * given; without one the number is in the user's stored unit, which the input
 * alone can't name — so no unit is invented.
 */
function setTargetPhrases({ args, nullWord }: FieldPhraseArgs): Phrase[] {
  const phrases: Phrase[] = []
  const setType = str(args.setType)
  if (setType) phrases.push(valuePhrase('type', setType))
  const metricMode = str(args.metricMode)
  if (metricMode) phrases.push(valuePhrase('mode', metricMode.replaceAll('_', ' + ')))
  phrases.push(...repsPhrases({ args, nullWord }))
  for (const [field, key, render] of [
    ['rir', 'rir', String],
    ['rpe', 'rpe', String],
    ['load', 'suggestedLoad', (n: number) => `${n}${str(args.unit) ? ` ${str(args.unit)}` : ''}`],
    ['duration', 'durationSec', (n: number) => `${n}s`],
    ['distance', 'distanceM', (n: number) => `${n} m`],
    ['rest', 'restSec', (n: number) => `${n}s`],
  ] as const) {
    const phrase = scalarPhrase(field, args[key], nullWord, render)
    if (phrase) phrases.push(phrase)
  }
  const tempo = str(args.tempo)
  if (tempo) phrases.push(valuePhrase('tempo', tempo))
  else if (args.tempo === null && nullWord) phrases.push(nullPhrase('tempo', nullWord))
  if (typeof args.technique === 'object' && args.technique !== null) {
    phrases.push({ key: 'target.techniqueUpdated' })
  } else if (args.technique === null && nullWord) phrases.push(nullPhrase('technique', nullWord))
  return phrases
}

/** update_program_exercise's change list ("swap to X", "ungroup superset"…). */
function exerciseChangePhrases(args: Record<string, unknown>): Phrase[] {
  const phrases: Phrase[] = []
  const name = str(args.name)
  const movementId = num(args.wgerExerciseId)
  if (movementId !== null) {
    phrases.push(
      name
        ? { key: 'change.swapTo', values: { name } }
        : { key: 'change.swapMovement', values: { id: movementId } },
    )
  } else if (name) phrases.push({ key: 'change.rename', values: { name } })
  const source = str(args.source)
  if (source && movementId === null && !name) {
    phrases.push({ key: 'change.source', values: { source } })
  }
  if (typeof args.progression === 'object' && args.progression !== null) {
    phrases.push({ key: 'change.progressionUpdate' })
  } else if (args.progression === null) phrases.push({ key: 'change.progressionClear' })
  const superset = num(args.supersetGroup)
  if (superset !== null) phrases.push({ key: 'change.supersetGroup', values: { group: superset } })
  else if (args.supersetGroup === null) phrases.push({ key: 'change.supersetUngroup' })
  return phrases
}

/** update_program_day's change list. */
function dayChangePhrases(args: Record<string, unknown>): Phrase[] {
  const phrases: Phrase[] = []
  const name = str(args.name)
  if (name) phrases.push({ key: 'change.rename', values: { name } })
  if (str(args.notes)) phrases.push({ key: 'change.notesUpdate' })
  else if (args.notes === null) phrases.push({ key: 'change.notesClear' })
  return phrases
}

/** An empty description — every part absent, so the renderer falls back to
 *  the humanized tool name. */
function nothing(toolName: string): ToolCallDescription {
  return { scope: null, location: [], changes: [], detail: [], meta: [], toolName }
}

function described(
  toolName: string,
  parts: Partial<Omit<ToolCallDescription, 'toolName'>>,
): ToolCallDescription {
  return { ...nothing(toolName), ...parts }
}

/**
 * The parts of a coach tool call's one-line summary, for the approval card
 * (and the cancelled/applying outcome lines). Every approval-gated tool has a
 * bespoke phrasing; anything unknown leaves `changes` empty so the renderer
 * degrades to the humanized tool name and a newly gated tool is never a blank
 * card.
 */
export function describeToolCall(toolName: string, input: unknown): ToolCallDescription {
  const args = asRecord(input)
  switch (toolName) {
    case 'add_program_day': {
      const name = str(args.name)
      return described(toolName, {
        changes: [name ? { key: 'change.addDayNamed', values: { name } } : { key: 'change.addDay' }],
      })
    }
    case 'update_program_day':
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: dayChangePhrases(args),
      })
    case 'remove_program_day': {
      const day = ordinal(args.dayPosition)
      return day !== null
        ? described(toolName, { changes: [{ key: 'change.removeDay', values: { day } }] })
        : nothing(toolName)
    }
    case 'move_program_day': {
      const from = ordinal(args.from)
      const to = ordinal(args.to)
      return from !== null && to !== null
        ? described(toolName, { changes: [{ key: 'change.moveDay', values: { from, to } }] })
        : nothing(toolName)
    }
    case 'add_program_exercise': {
      const name = str(args.name)
      const day = ordinal(args.dayPosition)
      if (!name) return nothing(toolName)
      return described(toolName, {
        location: day !== null ? [{ key: 'location.day', values: { day } }] : [],
        changes: [{ key: 'change.addExercise', values: { name } }],
      })
    }
    case 'update_program_exercise':
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: exerciseChangePhrases(args),
      })
    case 'substitute_program_exercise': {
      const name = str(args.name)
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: [
          name
            ? { key: 'change.substitute', values: { name } }
            : { key: 'change.substituteMovement' },
        ],
      })
    }
    case 'remove_program_exercise': {
      const day = ordinal(args.dayPosition)
      const exercise = ordinal(args.exercisePosition)
      if (day === null || exercise === null) return nothing(toolName)
      return described(toolName, {
        location: [{ key: 'location.day', values: { day } }],
        changes: [{ key: 'change.removeExercise', values: { exercise } }],
      })
    }
    case 'move_program_exercise': {
      const day = ordinal(args.dayPosition)
      const from = ordinal(args.from)
      const to = ordinal(args.to)
      if (from === null || to === null) return nothing(toolName)
      return described(toolName, {
        location: day !== null ? [{ key: 'location.day', values: { day } }] : [],
        changes: [{ key: 'change.moveExercise', values: { from, to } }],
      })
    }
    case 'add_program_set':
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: [{ key: 'change.addSet' }],
        detail: setTargetPhrases({ args, nullWord: null }),
      })
    case 'update_program_set':
      return described(toolName, {
        location: locationPhrases(args, true),
        changes: setTargetPhrases({ args, nullWord: 'cleared' }),
      })
    case 'remove_program_set': {
      const set = num(args.setNumber)
      if (set === null) return nothing(toolName)
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: [{ key: 'change.removeSet', values: { set } }],
      })
    }
    case 'move_program_set': {
      const from = num(args.from)
      const to = num(args.to)
      if (from === null || to === null) return nothing(toolName)
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: [{ key: 'change.moveSet', values: { from, to } }],
      })
    }
    case 'set_program_set_override': {
      const week = num(args.week)
      const targets = setTargetPhrases({ args, nullWord: 'unpinned' })
      if (targets.length === 0) return nothing(toolName)
      return described(toolName, {
        scope: week !== null ? { key: 'location.week', values: { week } } : null,
        location: locationPhrases(args, true),
        changes: targets,
      })
    }
    case 'remove_program_set_override': {
      const week = num(args.week)
      if (week === null) return nothing(toolName)
      return described(toolName, {
        location: locationPhrases(args, true),
        changes: [{ key: 'change.dropOverride', values: { week } }],
      })
    }
    case 'set_program_autoregulation':
      return typeof args.enabled === 'boolean'
        ? described(toolName, {
            changes: [
              { key: args.enabled ? 'change.autoregulationOn' : 'change.autoregulationOff' },
            ],
          })
        : nothing(toolName)
    case 'set_program_deload_policy': {
      if (args.policy === null) {
        return described(toolName, { changes: [{ key: 'change.deloadPolicyClear' }] })
      }
      const mode =
        typeof args.policy === 'object' && args.policy !== null && 'mode' in args.policy
          ? String((args.policy as { mode: unknown }).mode)
          : null
      return mode === 'none' || mode === 'reactive' || mode === 'scheduled'
        ? described(toolName, { changes: [{ key: 'change.deloadPolicy', values: { mode } }] })
        : nothing(toolName)
    }
    case 'set_program_diet_phase': {
      if (args.phase === null) {
        return described(toolName, { changes: [{ key: 'change.dietPhaseClear' }] })
      }
      const phase = str(args.phase)
      return phase === 'cutting' || phase === 'maintaining' || phase === 'bulking'
        ? described(toolName, { changes: [{ key: 'change.dietPhase', values: { phase } }] })
        : nothing(toolName)
    }
    case 'set_program_overshoot_policy': {
      if (args.policy === null) {
        return described(toolName, { changes: [{ key: 'change.overshootClear' }] })
      }
      const policy = str(args.policy)
      // ICU `select` arm names must be alphanumeric, so the hyphenated policy
      // ids travel as camelCase tokens; the message still renders the id the
      // settings UI shows.
      const arm = policy !== null ? OVERSHOOT_ARMS[policy] : undefined
      return arm !== undefined
        ? described(toolName, { changes: [{ key: 'change.overshoot', values: { policy: arm } }] })
        : nothing(toolName)
    }
    case 'set_program_plan_sync':
      return typeof args.enabled === 'boolean'
        ? described(toolName, {
            changes: [{ key: args.enabled ? 'change.planSyncEnabled' : 'change.planSyncDisabled' }],
          })
        : nothing(toolName)
    case 'set_training_max': {
      const tm = num(args.trainingMax)
      if (tm === null) return nothing(toolName)
      const unit = str(args.unit)
      const reason = str(args.reason)
      const load = `${tm}${unit ? ` ${unit}` : ''}`
      return described(toolName, {
        location: locationPhrases(args, false),
        changes: [
          reason
            ? { key: 'change.trainingMaxWithReason', values: { load, reason } }
            : { key: 'change.trainingMax', values: { load } },
        ],
      })
    }
    case 'upsert_program': {
      const mode = str(args.id) ? 'replace' : 'create'
      const name = str(args.name)
      const days = Array.isArray(args.days) ? args.days.length : null
      const weeks = num(args.mesocycleWeeks)
      const meta: Phrase[] = []
      if (days !== null) meta.push({ key: 'meta.days', values: { days } })
      if (weeks !== null) meta.push({ key: 'meta.weeks', values: { weeks } })
      return described(toolName, {
        changes: [
          name
            ? { key: 'change.programNamed', values: { mode, name } }
            : { key: 'change.program', values: { mode } },
        ],
        meta,
      })
    }
    default:
      return nothing(toolName)
  }
}
