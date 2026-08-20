import { backoffKg, AUTOREG_DEFAULT_STEP_KG, type AutoregAdjustment } from '@/lib/autoregulate'
import type { Progression } from '@/lib/program-input'
import { schemeSentence, type SchemeSentenceMessage } from '@/lib/scheme-copy'
import type { WeightUnit } from '@/lib/units'

/**
 * Pure view logic for the program detail page's Arc C additions (editorial
 * status line, WHOOP-collapse expand state, autoreg visibility, change-log
 * grouping) — kept free of JSX so it unit-tests as plain functions (same
 * convention as ./week-view and ./derived-format).
 */

export interface StatusLineInput {
  currentWeek: number
  mesocycleWeeks: number
  deloadWeek: number | null
  /** Distinct days completed in the CURRENT week (not the selected one). */
  daysDoneThisWeek: number
  dayCountTotal: number
  blockComplete: boolean
}

/**
 * The header's one editorial sentence — where the block actually stands,
 * regardless of which week is being browsed. CSS uppercases it (font-display
 * voice); the muted meta line beneath keeps the raw numbers as context.
 *   "Block complete."
 *   "Week 3 of 7 · 2 days to go."
 *   "Week 3 of 7 · week trained · deload next week."
 *   "Week 4 of 7 · deload week · 1 day to go."
 */
export function programStatusLine(input: StatusLineInput): string {
  if (input.blockComplete) return 'Block complete.'
  const parts = [`Week ${input.currentWeek} of ${input.mesocycleWeeks}`]
  if (input.currentWeek === input.deloadWeek) parts.push('deload week')
  if (input.dayCountTotal > 0) {
    const remaining = Math.max(0, input.dayCountTotal - input.daysDoneThisWeek)
    parts.push(
      remaining === 0 ? 'week trained' : `${remaining} day${remaining === 1 ? '' : 's'} to go`,
    )
  }
  if (input.deloadWeek !== null && input.deloadWeek === input.currentWeek + 1) {
    parts.push('deload next week')
  }
  return `${parts.join(' · ')}.`
}

/**
 * The `?expand=` search param as the set of day ids whose collapsed cards
 * show full targets. URL state on purpose (same philosophy as `?week=`):
 * expansion survives share/back/reload, and — the perf point — a collapsed
 * day's prescription derivation never runs at all. User-editable input, so
 * everything is defended: repeated params merge, values split on commas,
 * blanks drop. Unknown ids are harmless (they match no day).
 */
export function parseExpandParam(raw: string | string[] | undefined): ReadonlySet<string> {
  const parts = (Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  return new Set(parts)
}

/** The `expand` query value with `dayId` added (stable order, deduped). */
export function withExpanded(expanded: ReadonlySet<string>, dayId: string): string {
  return [...new Set([...expanded, dayId])].join(',')
}

/** The `expand` query value with `dayId` removed; null = drop the param. */
export function withoutExpanded(expanded: ReadonlySet<string>, dayId: string): string | null {
  const rest = [...expanded].filter((id) => id !== dayId)
  return rest.length > 0 ? rest.join(',') : null
}

/**
 * Whether a day's week-N prescription should be derived at all. Done and
 * in-progress cards never render targets (hasState), and of the untouched
 * days only the next-up card and explicitly expanded cards show them — every
 * skipped derivation saves real per-exercise history reads (the WHOOP-collapse
 * perf win the day-card comments have always admitted to paying).
 */
export function shouldDeriveDay(
  hasState: boolean,
  isNextUp: boolean,
  isExpanded: boolean,
): boolean {
  return !hasState && (isNextUp || isExpanded)
}

/** One held/backed-off lift for the autoreg visibility card. */
export interface AutoregNote {
  exerciseName: string
  adjustment: AutoregAdjustment
}

/**
 * The lifts the engine is currently holding back, from the prescriptions the
 * page ALREADY derived (never extra reads — a collapsed day contributes
 * nothing, honestly). Only 'repeat' and 'decrement' verdicts surface: those
 * are the stall states worth a quiet heads-up; 'step'/'anchor' are progress
 * and already speak through the targets themselves. Deduped by exercise name
 * (a lift repeated across days carries one verdict — deriveDayPrescription
 * caches per composite key).
 */
export function collectAutoregNotes(
  days: readonly { exercises: readonly { name: string }[] }[],
  prescriptions: readonly (readonly { autoreg: AutoregAdjustment | null }[])[],
): AutoregNote[] {
  const notes: AutoregNote[] = []
  const seen = new Set<string>()
  days.forEach((day, dayIndex) => {
    day.exercises.forEach((exercise, exerciseIndex) => {
      const adjustment = prescriptions[dayIndex]?.[exerciseIndex]?.autoreg ?? null
      if (adjustment === null) return
      if (adjustment.action !== 'repeat' && adjustment.action !== 'decrement') return
      if (seen.has(exercise.name)) return
      seen.add(exercise.name)
      notes.push({ exerciseName: exercise.name, adjustment })
    })
  })
  return notes
}

/** One M4-flagged lift with its owner-confirmable TM reduction (TM lifecycle
 *  §1): the flag verdict says "training max likely set too high"; the page
 *  turns it into a PROPOSED ~10% reduction the owner may confirm — never an
 *  automatic write. */
export interface TmResetProposal {
  exerciseName: string
  /** 0-based address for the setter (adjustTrainingMaxAction). */
  dayPosition: number
  exercisePosition: number
  currentTmKg: number
  proposedTmKg: number
}

/**
 * The proposed post-flag training max: current TM minus ~10% snapped to
 * loadable 2.5 kg increments — exactly `backoffKg`'s semantics (incl. its
 * one-increment floor and 25% cap), so the proposal and the autoreg
 * decrement rule can never disagree about what "~10% off" means. Null when
 * no sensible reduction exists (TM already 0).
 */
export function proposedTrainingMaxKg(currentTmKg: number): number | null {
  const reduction = backoffKg(currentTmKg, AUTOREG_DEFAULT_STEP_KG)
  if (reduction <= 0) return null
  return currentTmKg - reduction
}

/**
 * The M4-flagged lifts as confirmable TM-reduction proposals, from the
 * prescriptions the page ALREADY derived (same no-extra-reads honesty as
 * `collectAutoregNotes`, which deliberately excludes 'flag'). Only TM-bearing
 * schemes (percent-1rm / amrap-cycle) can be flagged, but the scheme is
 * re-checked here so a mismatched verdict can never propose against a scheme
 * without a TM. Deduped by exercise name (one verdict per lift, as in
 * collectAutoregNotes).
 */
export function collectTmResetProposals(
  days: readonly {
    exercises: readonly { name: string; progression: Progression | null }[]
  }[],
  prescriptions: readonly (readonly { autoreg: AutoregAdjustment | null }[])[],
): TmResetProposal[] {
  const proposals: TmResetProposal[] = []
  const seen = new Set<string>()
  days.forEach((day, dayIndex) => {
    day.exercises.forEach((exercise, exerciseIndex) => {
      const adjustment = prescriptions[dayIndex]?.[exerciseIndex]?.autoreg ?? null
      if (adjustment === null || adjustment.action !== 'flag') return
      const progression = exercise.progression
      if (progression?.scheme !== 'percent-1rm' && progression?.scheme !== 'amrap-cycle') return
      const proposedTmKg = proposedTrainingMaxKg(progression.trainingMaxKg)
      if (proposedTmKg === null) return
      if (seen.has(exercise.name)) return
      seen.add(exercise.name)
      proposals.push({
        exerciseName: exercise.name,
        dayPosition: dayIndex,
        exercisePosition: exerciseIndex,
        currentTmKg: progression.trainingMaxKg,
        proposedTmKg,
      })
    })
  })
  return proposals
}

/**
 * The muted "how this progresses" line for one exercise row (#228): the
 * scheme-copy sentence with the exercise's REAL numbers — the heaviest
 * non-warmup derived load anchors the "at 65 lb" clause (already quantized
 * at derivation, and `schemeSentence` quantizes again at display). Null when
 * the exercise has no progression — the row renders nothing rather than
 * inventing copy.
 */
export function progressionLine(
  progression: Progression | null,
  derivedSets: readonly { loadKg: number | null; setType?: string | null }[],
  unit: WeightUnit,
): SchemeSentenceMessage | null {
  if (progression === null) return null
  let currentLoadKg: number | null = null
  for (const set of derivedSets) {
    if (set.setType === 'warmup' || set.loadKg === null) continue
    if (currentLoadKg === null || set.loadKg > currentLoadKg) currentLoadKg = set.loadKg
  }
  return schemeSentence(progression, { unit, currentLoadKg })
}

/** Change-log events bucketed under one calendar-day label. */
export interface EventDayGroup<T> {
  /** Display label — also the grouping key, so the formatter defines "a day". */
  label: string
  events: T[]
}

/**
 * Groups change events by calendar day, preserving input order (newest first
 * from listProgramEvents) both across groups and within them. The caller's
 * formatter is the day key — same string the header renders, so grouping and
 * display can never disagree.
 */
export function groupEventsByDay<T extends { occurredAt: Date }>(
  events: readonly T[],
  formatDay: (date: Date) => string,
): EventDayGroup<T>[] {
  const groups: EventDayGroup<T>[] = []
  for (const event of events) {
    const label = formatDay(event.occurredAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.events.push(event)
    else groups.push({ label, events: [event] })
  }
  return groups
}
