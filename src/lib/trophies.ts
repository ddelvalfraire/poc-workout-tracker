import {
  activeProgramRef,
  countCompletedWorkouts,
  lifetimeTonnageKg,
  listTrophies,
  stampTrophies,
  workoutFinishFacts,
  type TrophyRow,
} from '@/db/trophies'
import { getExerciseStats, listLoggedExercises } from '@/db/exercise-stats'
import { getMessages } from '@/i18n/translate'
import { activeScheduledWeekdays, completedWorkoutTimes } from '@/db/goals'
import { programWeekState } from '@/db/programs'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { normalizeExerciseKey } from '@/lib/import/match'
import { weeklyStreak } from '@/lib/goal-progress'
import { sendPushToUser } from '@/lib/push'
import {
  CANONICAL_LIFTS,
  LIFT_NAMES,
  TROPHY_DEFS,
  TROPHY_KINDS,
  thresholdKg,
  type CanonicalLift,
  type TrophyContext,
  type TrophyDef,
  type TrophyKind,
} from '@/lib/trophy-kinds'
import { kgToDisplay, type WeightUnit } from '@/lib/units'

/**
 * Trophy composition over the db reads: pure detection rules up top, the
 * fails-soft check seam + the /trophies evaluation below — the same layering
 * as lib/goals.ts. Every candidate derives from truths the app already
 * computes (exercise-stats records, completed-workout counts, the goals
 * streak engine, programWeekState); this module never writes anything except
 * the stamp itself.
 *
 * THE RETROACTIVE RULE: a stamp may celebrate + push ONLY when it was
 * triggered by a live finish AND its fact involves that workout (the club
 * record was set in it, the count/tonnage threshold was crossed BY it, the
 * streak milestone needs its completion, the block closed with a program
 * session). Everything else — history imports, backfill on a later finish —
 * stamps quietly: trophy page only, no push, no celebration flood.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
// Streak evidence window: the 52-week trophy ceiling plus slack, mirroring
// lib/goals.ts' STREAK_LOOKBACK_DAYS sizing rule.
const STREAK_LOOKBACK_DAYS = 54 * 7
/**
 * Trophy streaks have no per-goal grace to inherit, so they use the goals
 * feature's DEFAULT grace (1 forgiven miss/week) — lenient enough that a
 * one-off miss doesn't zero a year, strict enough to stay a real streak.
 */
const TROPHY_STREAK_GRACE = 1

const ALL_LIFTS = Object.keys(CANONICAL_LIFTS) as readonly CanonicalLift[]
const SUM_CLUB_LIFTS: readonly CanonicalLift[] = ['squat', 'bench', 'deadlift']

// ── Pure rules ───────────────────────────────────────────────────────────────

/**
 * Which canonical lift (if any) an exercise identity scores. wger identities
 * match by curated id ONLY (variants are different lifts — the map documents
 * each exclusion); customs fall back to the normalized name, through the SAME
 * normalizer as the history importer so the two dialects can't drift.
 */
export function canonicalLiftFor(
  source: ExerciseSource,
  wgerExerciseId: number,
  name: string,
): CanonicalLift | null {
  for (const lift of ALL_LIFTS) {
    const def = CANONICAL_LIFTS[lift]
    if (source === 'wger' && def.wgerIds.includes(wgerExerciseId)) return lift
    if (source === 'custom' && def.nameKeys.includes(normalizeExerciseKey(name))) return lift
  }
  return null
}

/** The evidence every rule reads — gathered once per check (see gather). */
export interface TrophyEvidence {
  /** Best all-time e1RM per canonical lift + the workout that set it. */
  bestByLift: Partial<Record<CanonicalLift, { e1rmKg: number; workoutId: string }>>
  completedCount: number
  tonnageKg: number
  scheduledWeekdays: readonly number[]
  completions: readonly Date[]
  streakWeeks: number
  hasActiveProgram: boolean
  blockComplete: boolean
}

/** An evidence object that claims nothing — the gather baseline. */
export function emptyEvidence(): TrophyEvidence {
  return {
    bestByLift: {},
    completedCount: 0,
    tonnageKg: 0,
    scheduledWeekdays: [],
    completions: [],
    streakWeeks: 0,
    hasActiveProgram: false,
    blockComplete: false,
  }
}

export interface TrophyCandidate {
  kind: TrophyKind
  context: TrophyContext
}

/** Round for the recorded fact — jsonb keeps 2dp, matching column precision. */
function factKg(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Every unearned kind whose fact currently holds, with the fact recorded as
 * context. Pure: thresholds compared in kg at entry precision (see
 * thresholdKg); a kind already in `earned` never re-candidates.
 */
export function trophyCandidates(
  evidence: TrophyEvidence,
  earned: ReadonlySet<TrophyKind>,
): TrophyCandidate[] {
  const candidates: TrophyCandidate[] = []
  for (const kind of TROPHY_KINDS) {
    if (earned.has(kind)) continue
    const def = TROPHY_DEFS[kind]
    if (def.family === 'club') {
      const best = evidence.bestByLift[def.lift]
      if (best && best.e1rmKg >= thresholdKg(def.lb)) {
        candidates.push({ kind, context: { e1rmKg: factKg(best.e1rmKg) } })
      }
    } else if (def.family === 'sum_club') {
      const bests = SUM_CLUB_LIFTS.map((lift) => evidence.bestByLift[lift])
      if (bests.every((b) => b !== undefined)) {
        const sum = bests.reduce((total, b) => total + (b?.e1rmKg ?? 0), 0)
        if (sum >= thresholdKg(def.lb)) {
          candidates.push({ kind, context: { e1rmKg: factKg(sum) } })
        }
      }
    } else if (def.family === 'count') {
      if (evidence.completedCount >= def.count) {
        candidates.push({ kind, context: { count: evidence.completedCount } })
      }
    } else if (def.family === 'streak') {
      // weeklyStreak is 0 without a schedule, so streak trophies only ever
      // fire when a consistency-capable schedule exists.
      if (evidence.streakWeeks >= def.weeks) {
        candidates.push({ kind, context: { weeks: evidence.streakWeeks } })
      }
    } else if (def.family === 'block') {
      if (evidence.blockComplete) candidates.push({ kind, context: {} })
    } else if (evidence.tonnageKg >= thresholdKg(def.lb)) {
      candidates.push({ kind, context: { tonnageKg: factKg(evidence.tonnageKg) } })
    }
  }
  return candidates
}

/** The facts the attribution rule needs about the just-finished workout. */
export interface FinishAttribution {
  workoutId: string
  /** False (uncompleted/unowned workout) disqualifies everything. */
  completed: boolean
  workoutTonnageKg: number
  /** The streak with THIS workout's completion removed from the evidence. */
  streakWeeksWithout: number
  hasProgramProvenance: boolean
}

/**
 * Does this candidate's fact involve the just-finished workout? The honest-
 * celebration gate: a threshold that was already met BEFORE this workout
 * (feature-ship backfill, restored history) stamps quietly even at a live
 * finish — only the workout that actually crossed the line celebrates.
 */
export function isAttributedToFinish(
  kind: TrophyKind,
  evidence: TrophyEvidence,
  finish: FinishAttribution,
): boolean {
  if (!finish.completed) return false
  const def = TROPHY_DEFS[kind]
  switch (def.family) {
    case 'club':
      // The qualifying record was set in this workout.
      return evidence.bestByLift[def.lift]?.workoutId === finish.workoutId
    case 'sum_club':
      // The sum crossed with at least one contributing record from this
      // workout. (A pre-existing over-threshold sum would have stamped on an
      // earlier finish or falls under quiet backfill.)
      return SUM_CLUB_LIFTS.some(
        (lift) => evidence.bestByLift[lift]?.workoutId === finish.workoutId,
      )
    case 'count':
      // Without this workout the count sat below the line.
      return evidence.completedCount - 1 < def.count
    case 'streak':
      // The milestone needs this workout's completion to hold.
      return finish.streakWeeksWithout < def.weeks
    case 'block':
      // A program session closed the block; a coincidental quick log at an
      // already-complete block stamps quietly.
      return finish.hasProgramProvenance
    case 'tonnage':
      // This workout's own tonnage carried the total over the line.
      return evidence.tonnageKg - finish.workoutTonnageKg < thresholdKg(def.lb)
  }
}

// ── Labels + hints (display words, shared by page / push / celebration) ─────

/**
 * Message DESCRIPTORS for the `Trophies` namespace (docs/I18N-KEYS.md §9).
 * Each function below decides WHICH line a medal or locked row shows and
 * with which numbers; the catalog owns the words and ICU's `number` argument
 * owns the digit grouping, so the `toLocaleString('en-US')` calls that used
 * to print "1,000" to a reader whose locale writes "1.000" are gone.
 *
 * LIFT NAMES stay out of the catalog and ride as ICU arguments: they are
 * curated exercise content, not UI copy.
 */
export type TrophyLabelMessage =
  | { key: 'label.club'; values: { lb: number; lift: string } }
  | { key: 'label.sumClub'; values: { lb: number } }
  | { key: 'label.count'; values: { count: number } }
  | { key: 'label.streak'; values: { weeks: number } }
  | { key: 'label.block'; values?: undefined }
  | { key: 'label.tonnage'; values: { millions: number } }

/** The trophy's name. Clubs keep their lb-culture names for every user —
 *  "315 Squat Club" IS the trophy; the context line speaks the user's unit. */
export function trophyLabel(kind: TrophyKind): TrophyLabelMessage {
  const def = TROPHY_DEFS[kind]
  switch (def.family) {
    case 'club':
      return { key: 'label.club', values: { lb: def.lb, lift: LIFT_NAMES[def.lift] } }
    case 'sum_club':
      return { key: 'label.sumClub', values: { lb: def.lb } }
    case 'count':
      return { key: 'label.count', values: { count: def.count } }
    case 'streak':
      return { key: 'label.streak', values: { weeks: def.weeks } }
    case 'block':
      return { key: 'label.block' }
    case 'tonnage':
      return { key: 'label.tonnage', values: { millions: def.lb / 1_000_000 } }
  }
}

export type TrophyContextMessage =
  | { key: 'context.clubE1rm' | 'context.sumTotal'; values: { value: number; unit: WeightUnit } }
  | { key: 'context.count'; values: { count: number } }
  | { key: 'context.streak'; values: { weeks: number } }
  | { key: 'context.tonnage'; values: { value: number; unit: WeightUnit } }

/** One line naming the recorded fact behind an earned trophy, or null. */
export function trophyContextLine(row: TrophyRow, unit: WeightUnit): TrophyContextMessage | null {
  const def = TROPHY_DEFS[row.kind]
  const c = row.context
  if ((def.family === 'club' || def.family === 'sum_club') && c.e1rmKg !== undefined) {
    return {
      key: def.family === 'club' ? 'context.clubE1rm' : 'context.sumTotal',
      values: { value: kgToDisplay(c.e1rmKg, unit), unit },
    }
  }
  if (def.family === 'count' && c.count !== undefined) {
    return { key: 'context.count', values: { count: c.count } }
  }
  if (def.family === 'streak' && c.weeks !== undefined) {
    return { key: 'context.streak', values: { weeks: c.weeks } }
  }
  if (def.family === 'tonnage' && c.tonnageKg !== undefined) {
    return {
      key: 'context.tonnage',
      values: { value: Math.round(kgToDisplay(c.tonnageKg, unit)), unit },
    }
  }
  return null
}

/** Whole display units for progress fractions — a NUMBER, so the reader's
 *  locale decides the grouping separator at render, not this module. */
function wholeDisplay(kg: number, unit: WeightUnit): number {
  return Math.round(kgToDisplay(kg, unit))
}

export type TrophyHintMessage =
  | { key: 'hint.clubNoLift'; values: { lift: string } }
  | {
      key: 'hint.weightProgress'
      values: { current: number; target: number; remaining: number; unit: WeightUnit }
    }
  | { key: 'hint.sumMissing'; values: { lifts: string } }
  | { key: 'hint.count'; values: { current: number; target: number } }
  | { key: 'hint.streakUnscheduled'; values?: undefined }
  | { key: 'hint.streak'; values: { current: number; target: number } }
  | { key: 'hint.blockActive' | 'hint.blockNoProgram'; values?: undefined }
  | { key: 'hint.tonnage'; values: { current: number; target: number; unit: WeightUnit } }

/**
 * The honest progress line for a LOCKED trophy — computed from the same
 * evidence detection reads, never invented ("285/315 lb — 30 lb to go").
 */
export function trophyHint(
  kind: TrophyKind,
  evidence: TrophyEvidence,
  unit: WeightUnit,
): TrophyHintMessage {
  const def = TROPHY_DEFS[kind]
  switch (def.family) {
    case 'club': {
      const best = evidence.bestByLift[def.lift]
      if (!best) return { key: 'hint.clubNoLift', values: { lift: LIFT_NAMES[def.lift] } }
      const target = thresholdKg(def.lb)
      return {
        key: 'hint.weightProgress',
        values: {
          current: wholeDisplay(best.e1rmKg, unit),
          target: wholeDisplay(target, unit),
          remaining: wholeDisplay(Math.max(0, target - best.e1rmKg), unit),
          unit,
        },
      }
    }
    case 'sum_club': {
      const missing = SUM_CLUB_LIFTS.filter((lift) => evidence.bestByLift[lift] === undefined)
      if (missing.length > 0) {
        // Lift names are content, so they travel joined as ONE argument
        // rather than as keys the catalog would have to stitch together.
        return {
          key: 'hint.sumMissing',
          values: { lifts: missing.map((l) => LIFT_NAMES[l]).join(', ') },
        }
      }
      const sum = SUM_CLUB_LIFTS.reduce(
        (total, lift) => total + (evidence.bestByLift[lift]?.e1rmKg ?? 0),
        0,
      )
      const target = thresholdKg(def.lb)
      return {
        key: 'hint.weightProgress',
        values: {
          current: wholeDisplay(sum, unit),
          target: wholeDisplay(target, unit),
          remaining: wholeDisplay(Math.max(0, target - sum), unit),
          unit,
        },
      }
    }
    case 'count':
      return { key: 'hint.count', values: { current: evidence.completedCount, target: def.count } }
    case 'streak':
      if (evidence.scheduledWeekdays.length === 0) return { key: 'hint.streakUnscheduled' }
      return { key: 'hint.streak', values: { current: evidence.streakWeeks, target: def.weeks } }
    case 'block':
      return { key: evidence.hasActiveProgram ? 'hint.blockActive' : 'hint.blockNoProgram' }
    case 'tonnage':
      return {
        key: 'hint.tonnage',
        values: {
          current: wholeDisplay(evidence.tonnageKg, unit),
          target: wholeDisplay(thresholdKg(def.lb), unit),
          unit,
        },
      }
  }
}

// ── Fractions, zones + the CLOSEST rail (display composition, all pure) ─────

export type TrophyFamily = TrophyDef['family']

/** Zone order on /trophies — clubs are the culture, so they lead. */
export const TROPHY_FAMILY_ORDER: readonly TrophyFamily[] = [
  'club',
  'sum_club',
  'count',
  'streak',
  'block',
  'tonnage',
]

export interface TrophyFraction {
  /** Evidence numerator, same axis as `target` (kg for weight families). */
  current: number
  target: number
  /** Integer 0–100, floored so 99.9% never claims 100. */
  percent: number
}

/**
 * The numerator/denominator behind trophyHint's words, from the SAME evidence
 * the page already gathers for every locked family (evaluateTrophies →
 * gatherTrophyEvidence(needsFor(locked))) — no re-evaluation, no added reads.
 * Null = no honest fraction exists: a club with no e1RM on the lift yet, a
 * streak with nothing scheduled, and block (binary — done or not).
 */
export function trophyFraction(kind: TrophyKind, evidence: TrophyEvidence): TrophyFraction | null {
  const def = TROPHY_DEFS[kind]
  const fraction = (current: number, target: number): TrophyFraction => ({
    current,
    target,
    percent: target > 0 ? Math.max(0, Math.min(100, Math.floor((current / target) * 100))) : 0,
  })
  switch (def.family) {
    case 'club': {
      const best = evidence.bestByLift[def.lift]
      return best === undefined ? null : fraction(best.e1rmKg, thresholdKg(def.lb))
    }
    case 'sum_club': {
      const bests = SUM_CLUB_LIFTS.map((lift) => evidence.bestByLift[lift])
      if (bests.some((b) => b === undefined)) return null
      const sum = bests.reduce((total, b) => total + (b?.e1rmKg ?? 0), 0)
      return fraction(sum, thresholdKg(def.lb))
    }
    case 'count':
      return fraction(evidence.completedCount, def.count)
    case 'streak':
      return evidence.scheduledWeekdays.length === 0
        ? null
        : fraction(evidence.streakWeeks, def.weeks)
    case 'block':
      return null
    case 'tonnage':
      return fraction(evidence.tonnageKg, thresholdKg(def.lb))
  }
}

/**
 * The CLOSEST rail: locked kinds with the highest completion percent, capped
 * at `limit`. Zero-percent and fraction-less kinds never qualify (a rail of
 * 0% "almosts" is noise, not motivation). Ties keep DEFS order — the lower
 * threshold of a family lists first.
 */
export function closestTrophies(
  locked: readonly TrophyKind[],
  evidence: TrophyEvidence,
  limit = 3,
): TrophyKind[] {
  return locked
    .map((kind) => ({ kind, fraction: trophyFraction(kind, evidence) }))
    .filter((e): e is { kind: TrophyKind; fraction: TrophyFraction } => e.fraction !== null)
    .filter((e) => e.fraction.percent > 0)
    .sort((a, b) => b.fraction.percent - a.fraction.percent)
    .slice(0, Math.max(0, limit))
    .map((e) => e.kind)
}

/**
 * The medal's hero glyph — the threshold number IS the trophy ("315").
 * Null for block, the one kind without a number (its icon carries it).
 *
 * A NUMBER plus a notation, not a formatted string: "1,000" and "1M" are both
 * `Intl.NumberFormat` output, and which separator or compact suffix a reader
 * sees is their locale's answer, not this module's. `standard` keeps grouping
 * off below the sum-club thresholds, matching the plain "315" the medals
 * always showed.
 */
export interface TrophyGlyph {
  value: number
  notation: 'standard' | 'grouped' | 'compact'
}

export function trophyHeroGlyph(kind: TrophyKind): TrophyGlyph | null {
  const def = TROPHY_DEFS[kind]
  switch (def.family) {
    case 'club':
      return { value: def.lb, notation: 'standard' }
    case 'sum_club':
      return { value: def.lb, notation: 'grouped' }
    case 'count':
      return { value: def.count, notation: 'standard' }
    case 'streak':
      return { value: def.weeks, notation: 'standard' }
    case 'block':
      return null
    case 'tonnage':
      return { value: def.lb, notation: 'compact' }
  }
}

export interface TrophyZone {
  /** The zone's header key is `family.<family>` in the `Trophies` namespace —
   *  the family IS the key, so no English header travels with the zone. */
  family: TrophyFamily
  /** Earned rows of the family, newest achievement first. */
  earned: TrophyRow[]
  /** Locked kinds of the family, DEFS (threshold-ascending) order. */
  locked: TrophyKind[]
}

/** Family zones in display order — earned medals newest-first, locked kinds
 *  after, empty families omitted (nothing renders an empty header). */
export function groupTrophiesByFamily(
  earned: readonly TrophyRow[],
  locked: readonly TrophyKind[],
): TrophyZone[] {
  return TROPHY_FAMILY_ORDER.flatMap((family) => {
    const earnedRows = earned
      .filter((row) => TROPHY_DEFS[row.kind].family === family)
      .sort((a, b) => b.achievedAt.getTime() - a.achievedAt.getTime())
    const lockedKinds = locked.filter((kind) => TROPHY_DEFS[kind].family === family)
    if (earnedRows.length === 0 && lockedKinds.length === 0) return []
    return [{ family, earned: earnedRows, locked: lockedKinds }]
  })
}

// ── Evidence gathering + the check seam ──────────────────────────────────────

interface EvidenceNeeds {
  clubs: boolean
  count: boolean
  tonnage: boolean
  streak: boolean
  block: boolean
}

function needsFor(unearned: readonly TrophyKind[]): EvidenceNeeds {
  const families = new Set(unearned.map((kind) => TROPHY_DEFS[kind].family))
  return {
    clubs: families.has('club') || families.has('sum_club'),
    count: families.has('count'),
    tonnage: families.has('tonnage'),
    streak: families.has('streak'),
    block: families.has('block'),
  }
}

/**
 * Fetches only the evidence the unearned kinds still need — a fully-earned
 * family costs nothing forever after. Costs, documented:
 *  - clubs: listLoggedExercises (one indexed scan of the user's exercise
 *    occurrences) + one exercise-stats aggregation PER matched canonical
 *    exercise (a handful at most — the curated map bounds it);
 *  - count/streak/block: cheap indexed reads (count(*), schedule rows,
 *    completions since lookback, the existing week-state queries);
 *  - tonnage: the one full aggregate over the user's sets (see
 *    lifetimeTonnageKg) — paid only until both tonnage trophies stamp.
 */
async function gatherTrophyEvidence(
  userId: string,
  need: EvidenceNeeds,
  now: Date,
): Promise<TrophyEvidence> {
  const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * MS_PER_DAY)
  const [logged, completedCount, tonnageKg, scheduledWeekdays, completions, program] =
    await Promise.all([
      need.clubs ? listLoggedExercises(userId) : Promise.resolve([]),
      need.count ? countCompletedWorkouts(userId) : Promise.resolve(0),
      need.tonnage ? lifetimeTonnageKg(userId) : Promise.resolve(0),
      need.streak ? activeScheduledWeekdays(userId) : Promise.resolve([]),
      need.streak ? completedWorkoutTimes(userId, since) : Promise.resolve([]),
      need.block ? activeProgramRef(userId) : Promise.resolve(null),
    ])

  const bestByLift: TrophyEvidence['bestByLift'] = {}
  if (need.clubs) {
    const matched = logged.flatMap((entry) => {
      const lift = canonicalLiftFor(entry.source, entry.wgerExerciseId, entry.name)
      return lift === null ? [] : [{ entry, lift }]
    })
    const stats = await Promise.all(
      matched.map(({ entry }) => getExerciseStats(userId, entry.source, entry.wgerExerciseId)),
    )
    for (const [i, stat] of stats.entries()) {
      const record = stat?.records.bestE1rm
      if (!record) continue
      const lift = matched[i].lift
      const current = bestByLift[lift]
      if (current === undefined || record.e1rm > current.e1rmKg) {
        bestByLift[lift] = { e1rmKg: record.e1rm, workoutId: record.workoutId }
      }
    }
  }

  const blockComplete =
    program !== null &&
    (await programWeekState(userId, program.id, program.mesocycleWeeks)).blockComplete

  return {
    bestByLift,
    completedCount,
    tonnageKg,
    scheduledWeekdays,
    completions,
    streakWeeks: need.streak
      ? weeklyStreak({
          scheduledWeekdays,
          completions,
          allowedMissesPerWeek: TROPHY_STREAK_GRACE,
          now,
        })
      : 0,
    hasActiveProgram: program !== null,
    blockComplete,
  }
}

export type TrophyTrigger =
  | { kind: 'finish'; workoutId: string }
  | { kind: 'import' }
  | { kind: 'other' }

/**
 * The trophy seam: rides after the goal check on a finish, and after
 * commitImport (trigger 'import'). Fails SOFT — the parent write already
 * committed and must never fail because a trophy check did. Idempotent
 * end-to-end: stampTrophies' ON CONFLICT DO NOTHING stamps once, and the push
 * + returned celebration list ride only rows THIS call created AND attributed
 * to the live finish. 'import'/'other' triggers stamp silently and return [].
 */
export async function checkTrophies(
  userId: string,
  trigger: TrophyTrigger,
  now: Date = new Date(),
): Promise<TrophyRow[]> {
  try {
    const earned = new Set((await listTrophies(userId)).map((t) => t.kind))
    const unearned = TROPHY_KINDS.filter((kind) => !earned.has(kind))
    if (unearned.length === 0) return []

    const evidence = await gatherTrophyEvidence(userId, needsFor(unearned), now)
    const candidates = trophyCandidates(evidence, earned)
    if (candidates.length === 0) return []

    let finish: FinishAttribution | null = null
    if (trigger.kind === 'finish') {
      const facts = await workoutFinishFacts(userId, trigger.workoutId)
      if (facts !== null && facts.completedAt !== null) {
        const completedAtMs = facts.completedAt.getTime()
        // Remove ONE completion at this workout's instant to ask: does the
        // streak milestone still hold without it?
        const index = evidence.completions.findIndex((d) => d.getTime() === completedAtMs)
        const without =
          index === -1
            ? evidence.completions
            : evidence.completions.filter((_, i) => i !== index)
        finish = {
          workoutId: trigger.workoutId,
          completed: true,
          workoutTonnageKg: facts.tonnageKg,
          streakWeeksWithout: weeklyStreak({
            scheduledWeekdays: evidence.scheduledWeekdays,
            completions: without,
            allowedMissesPerWeek: TROPHY_STREAK_GRACE,
            now,
          }),
          hasProgramProvenance: facts.programDayId !== null,
        }
      }
    }

    // The attribution mark rides INTO the stored context: workoutId present =
    // this exact finish earned it — the celebration surfaces key off it.
    const stampable = candidates.map((candidate) =>
      finish !== null && isAttributedToFinish(candidate.kind, evidence, finish)
        ? { ...candidate, context: { ...candidate.context, workoutId: finish.workoutId } }
        : candidate,
    )
    const stamped = await stampTrophies(userId, stampable)

    const celebrated = stamped.filter(
      (row) => trigger.kind === 'finish' && row.context.workoutId === trigger.workoutId,
    )
    if (celebrated.length > 0) {
      const t = await getMessages('Trophies')
      for (const row of celebrated) {
        const label = trophyLabel(row.kind)
        await sendPushToUser(userId, {
          title: t('push.title', { name: t(label.key, label.values) }),
          body: t('push.body'),
          url: '/trophies',
        })
      }
    }
    return celebrated
  } catch (error) {
    // Fails soft: the triggering write is the source of truth.
    console.error('trophy check failed (parent write unaffected)', error)
    return []
  }
}

/** What the /trophies page renders: earned rows + locked kinds, plus the
 *  evidence so the page can compute honest hints in the user's unit. */
export interface TrophiesEvaluation {
  earned: TrophyRow[]
  locked: TrophyKind[]
  evidence: TrophyEvidence
}

/** One read for the /trophies page. Evidence covers every locked family so
 *  each locked card can show a real progress hint. */
export async function evaluateTrophies(
  userId: string,
  now: Date = new Date(),
): Promise<TrophiesEvaluation> {
  const earned = await listTrophies(userId)
  const earnedKinds = new Set(earned.map((t) => t.kind))
  const locked = TROPHY_KINDS.filter((kind) => !earnedKinds.has(kind))
  const evidence =
    locked.length > 0
      ? await gatherTrophyEvidence(userId, needsFor(locked), now)
      : emptyEvidence()
  return { earned, locked, evidence }
}
