/**
 * Human one-liners for coach tool calls — what the approval card leads with
 * instead of raw JSON. Pure string-building over the tool INPUT only: the
 * input can't tell us before-values (an override doesn't carry what week 4
 * said before), so summaries state only what will be true after — the
 * "{field} → {new}" shape — and never invent a "was".
 *
 * Positions arrive 0-based (dayPosition/exercisePosition, matching
 * get_program) but render 1-based ("Day 3"), because users count from one;
 * setNumber and week are already 1-based. Inputs are model-authored, so every
 * field is re-checked here — a known tool with a mangled input degrades to
 * whatever is still true, and an unknown tool falls back to its humanized name.
 */

import { humanizeToolName } from './chat-ui'

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

/** Joins present location pieces: "day 2, exercise 3, set 1". */
function locationPhrase(args: Record<string, unknown>, includeSet: boolean): string | null {
  const pieces: string[] = []
  const day = ordinal(args.dayPosition)
  const exercise = ordinal(args.exercisePosition)
  const set = includeSet ? num(args.setNumber) : null
  if (day !== null) pieces.push(`day ${day}`)
  if (exercise !== null) pieces.push(`exercise ${exercise}`)
  if (set !== null) pieces.push(`set ${set}`)
  return pieces.length > 0 ? pieces.join(', ') : null
}

/** Capitalizes the first character (locations render sentence-initially). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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

/** "reps → 8–10" | "min reps → 8" | "reps cleared", from repMin/repMax. */
function repsPhrases({ args, nullWord }: FieldPhraseArgs): string[] {
  const { repMin, repMax } = args
  // Both explicitly null collapses to one phrase.
  if (repMin === null && repMax === null && nullWord) return [`reps ${nullWord}`]
  const min = num(repMin)
  const max = num(repMax)
  if (min !== null && max !== null) return [`reps → ${min === max ? min : `${min}–${max}`}`]
  const phrases: string[] = []
  if (min !== null) phrases.push(`min reps → ${min}`)
  else if (repMin === null && nullWord) phrases.push(`min reps ${nullWord}`)
  if (max !== null) phrases.push(`max reps → ${max}`)
  else if (repMax === null && nullWord) phrases.push(`max reps ${nullWord}`)
  return phrases
}

/** One "{field} → {new}" phrase; null input → the family's null word. */
function scalarPhrase(
  label: string,
  value: unknown,
  nullWord: NullWord,
  render: (n: number) => string = String,
): string | null {
  const n = num(value)
  if (n !== null) return `${label} → ${render(n)}`
  if (value === null && nullWord) return `${label} ${nullWord}`
  return null
}

/**
 * The shared planned-set target fields (add/update/override) as human
 * phrases, in a stable schema-ish order. `suggestedLoad` echoes the explicit
 * `unit` arg when given; without one the number is in the user's stored unit,
 * which the input alone can't name — so no unit is invented.
 */
function setTargetPhrases({ args, nullWord }: FieldPhraseArgs): string[] {
  const phrases: string[] = []
  const setType = str(args.setType)
  if (setType) phrases.push(`type → ${setType}`)
  const metricMode = str(args.metricMode)
  if (metricMode) phrases.push(`mode → ${metricMode.replaceAll('_', ' + ')}`)
  phrases.push(...repsPhrases({ args, nullWord }))
  for (const [label, key, render] of [
    ['RIR', 'rir', String],
    ['RPE', 'rpe', String],
    ['load', 'suggestedLoad', (n: number) => `${n}${str(args.unit) ? ` ${str(args.unit)}` : ''}`],
    ['duration', 'durationSec', (n: number) => `${n}s`],
    ['distance', 'distanceM', (n: number) => `${n} m`],
    ['rest', 'restSec', (n: number) => `${n}s`],
  ] as const) {
    const phrase = scalarPhrase(label, args[key], nullWord, render)
    if (phrase) phrases.push(phrase)
  }
  const tempo = str(args.tempo)
  if (tempo) phrases.push(`tempo → ${tempo}`)
  else if (args.tempo === null && nullWord) phrases.push(`tempo ${nullWord}`)
  if (typeof args.technique === 'object' && args.technique !== null) phrases.push('technique updated')
  else if (args.technique === null && nullWord) phrases.push(`technique ${nullWord}`)
  return phrases
}

/** update_program_exercise's change list ("swap to X", "ungroup superset"…). */
function exerciseChangePhrases(args: Record<string, unknown>): string[] {
  const phrases: string[] = []
  const name = str(args.name)
  const movementId = num(args.wgerExerciseId)
  if (movementId !== null) phrases.push(name ? `swap to “${name}”` : `swap movement (id ${movementId})`)
  else if (name) phrases.push(`rename to “${name}”`)
  const source = str(args.source)
  if (source && movementId === null && !name) phrases.push(`source → ${source}`)
  if (typeof args.progression === 'object' && args.progression !== null) phrases.push('update progression')
  else if (args.progression === null) phrases.push('clear progression')
  const superset = num(args.supersetGroup)
  if (superset !== null) phrases.push(`superset group → ${superset}`)
  else if (args.supersetGroup === null) phrases.push('ungroup superset')
  return phrases
}

/** update_program_day's change list. */
function dayChangePhrases(args: Record<string, unknown>): string[] {
  const phrases: string[] = []
  const name = str(args.name)
  if (name) phrases.push(`rename to “${name}”`)
  if (str(args.notes)) phrases.push('update notes')
  else if (args.notes === null) phrases.push('clear notes')
  return phrases
}

/** "Location: change, change" — or just the changes when location is unknown. */
function locatedChanges(location: string | null, changes: string[], fallback: string): string {
  if (changes.length === 0) return fallback
  const list = changes.join(', ')
  return location ? `${sentence(location)}: ${list}` : sentence(list)
}

/**
 * One-line human summary of a coach tool call, for the approval card (and the
 * cancelled/applying outcome lines). Every approval-gated tool has a bespoke
 * sentence; anything unknown degrades to the humanized tool name so a newly
 * gated tool is never a blank card.
 */
export function describeToolCall(toolName: string, input: unknown): string {
  const args = asRecord(input)
  const fallback = humanizeToolName(toolName)
  switch (toolName) {
    case 'add_program_day': {
      const name = str(args.name)
      return name ? `Add day “${name}”` : 'Add a training day'
    }
    case 'update_program_day':
      return locatedChanges(locationPhrase(args, false), dayChangePhrases(args), fallback)
    case 'remove_program_day': {
      const day = ordinal(args.dayPosition)
      return day !== null ? `Remove day ${day} and everything in it` : fallback
    }
    case 'move_program_day': {
      const from = ordinal(args.from)
      const to = ordinal(args.to)
      return from !== null && to !== null ? `Move day ${from} → day ${to}` : fallback
    }
    case 'add_program_exercise': {
      const name = str(args.name)
      const day = ordinal(args.dayPosition)
      if (!name) return fallback
      return day !== null ? `Day ${day}: add “${name}”` : `Add “${name}”`
    }
    case 'update_program_exercise':
      return locatedChanges(locationPhrase(args, false), exerciseChangePhrases(args), fallback)
    case 'substitute_program_exercise': {
      const location = locationPhrase(args, false)
      const name = str(args.name)
      const change = name
        ? `substitute “${name}” (old loads cleared)`
        : 'substitute the movement (old loads cleared)'
      return location ? `${sentence(location)}: ${change}` : sentence(change)
    }
    case 'remove_program_exercise': {
      const day = ordinal(args.dayPosition)
      const exercise = ordinal(args.exercisePosition)
      if (day === null || exercise === null) return fallback
      return `Day ${day}: remove exercise ${exercise} and its sets`
    }
    case 'move_program_exercise': {
      const day = ordinal(args.dayPosition)
      const from = ordinal(args.from)
      const to = ordinal(args.to)
      if (from === null || to === null) return fallback
      return `${day !== null ? `Day ${day}: move` : 'Move'} exercise ${from} → ${to}`
    }
    case 'add_program_set': {
      const location = locationPhrase(args, false)
      const targets = setTargetPhrases({ args, nullWord: null })
      const base = location ? `${sentence(location)}: add a set` : 'Add a set'
      return targets.length > 0 ? `${base} (${targets.join(', ')})` : base
    }
    case 'update_program_set':
      return locatedChanges(
        locationPhrase(args, true),
        setTargetPhrases({ args, nullWord: 'cleared' }),
        fallback,
      )
    case 'remove_program_set': {
      const location = locationPhrase(args, false)
      const set = num(args.setNumber)
      if (set === null) return fallback
      return location ? `${sentence(location)}: remove set ${set}` : `Remove set ${set}`
    }
    case 'move_program_set': {
      const location = locationPhrase(args, false)
      const from = num(args.from)
      const to = num(args.to)
      if (from === null || to === null) return fallback
      const move = `move set ${from} → set ${to}`
      return location ? `${sentence(location)}: ${move}` : sentence(move)
    }
    case 'set_program_set_override': {
      const week = num(args.week)
      const location = locationPhrase(args, true)
      const targets = setTargetPhrases({ args, nullWord: 'unpinned' })
      if (targets.length === 0) return fallback
      const scope = [week !== null ? `week ${week} only` : null, location]
        .filter(Boolean)
        .join(' — ')
      return scope ? `${sentence(scope)}: ${targets.join(', ')}` : sentence(targets.join(', '))
    }
    case 'remove_program_set_override': {
      const week = num(args.week)
      const location = locationPhrase(args, true)
      if (week === null) return fallback
      const drop = `drop the week ${week} override`
      return location ? `${sentence(location)}: ${drop}` : sentence(drop)
    }
    case 'set_program_autoregulation':
      return typeof args.enabled === 'boolean'
        ? `Turn auto-regulation ${args.enabled ? 'on' : 'off'}`
        : fallback
    case 'set_program_deload_policy': {
      if (args.policy === null) return 'Clear the deload policy (back to the default behavior)'
      const mode =
        typeof args.policy === 'object' && args.policy !== null && 'mode' in args.policy
          ? String((args.policy as { mode: unknown }).mode)
          : null
      return mode === 'none' || mode === 'reactive' || mode === 'scheduled'
        ? `Set the deload policy → ${mode}`
        : fallback
    }
    case 'set_program_diet_phase': {
      if (args.phase === null) return 'Clear the diet phase'
      const phase = str(args.phase)
      return phase === 'cutting' || phase === 'maintaining' || phase === 'bulking'
        ? `Set the diet phase → ${phase}`
        : fallback
    }
    case 'set_program_overshoot_policy': {
      if (args.policy === null) return 'Clear the overshoot policy (back to scheme defaults)'
      const policy = str(args.policy)
      return policy === 'strict-load' || policy === 'e1rm-equivalent' || policy === 'any-metric'
        ? `Set the overshoot policy → ${policy}`
        : fallback
    }
    case 'set_program_plan_sync':
      return typeof args.enabled === 'boolean'
        ? `Turn plan sync ${args.enabled ? 'on' : 'off'}`
        : fallback
    case 'set_training_max': {
      const location = locationPhrase(args, false)
      const tm = num(args.trainingMax)
      if (tm === null) return fallback
      const unit = str(args.unit)
      const reason = str(args.reason)
      const change = `set the training max → ${tm}${unit ? ` ${unit}` : ''}${reason ? ` (${reason})` : ''}`
      return location ? `${sentence(location)}: ${change}` : sentence(change)
    }
    case 'upsert_program': {
      const verb = str(args.id) ? 'Replace' : 'Create'
      const name = str(args.name)
      const days = Array.isArray(args.days) ? args.days.length : null
      const weeks = num(args.mesocycleWeeks)
      const meta = [
        days !== null ? `${days} ${days === 1 ? 'day' : 'days'}` : null,
        weeks !== null ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : null,
      ].filter(Boolean)
      const title = name ? `${verb} program “${name}”` : `${verb} a program`
      return meta.length > 0 ? `${title} · ${meta.join(' · ')}` : title
    }
    default:
      return fallback
  }
}
