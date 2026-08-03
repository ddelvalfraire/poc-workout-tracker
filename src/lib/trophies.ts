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
import { activeScheduledWeekdays, completedWorkoutTimes } from '@/db/goals'
import { programWeekState } from '@/db/programs'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { formatE1RM } from '@/lib/format'
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

/** The trophy's name. Clubs keep their lb-culture names for every user —
 *  "315 Squat Club" IS the trophy; the context line speaks the user's unit. */
export function trophyLabel(kind: TrophyKind): string {
  const def = TROPHY_DEFS[kind]
  switch (def.family) {
    case 'club':
      return `${def.lb} ${LIFT_NAMES[def.lift]} Club`
    case 'sum_club':
      return `${def.lb.toLocaleString('en-US')} lb Club`
    case 'count':
      return def.count === 1 ? 'First Workout' : `${def.count} Workouts`
    case 'streak':
      return `${def.weeks}-Week Streak`
    case 'block':
      return 'Block Complete'
    case 'tonnage':
      return `${def.lb / 1_000_000}M lb Lifted`
  }
}

/** One line naming the recorded fact behind an earned trophy, or null. */
export function trophyContextLine(row: TrophyRow, unit: WeightUnit): string | null {
  const def = TROPHY_DEFS[row.kind]
  const c = row.context
  if ((def.family === 'club' || def.family === 'sum_club') && c.e1rmKg !== undefined) {
    return def.family === 'club'
      ? `e1RM ${formatE1RM(c.e1rmKg, unit)}`
      : `Total ${formatE1RM(c.e1rmKg, unit)}`
  }
  if (def.family === 'count' && c.count !== undefined) {
    return def.count === 1 ? 'First session logged' : `Workout #${c.count}`
  }
  if (def.family === 'streak' && c.weeks !== undefined) {
    return `${c.weeks} consecutive weeks`
  }
  if (def.family === 'tonnage' && c.tonnageKg !== undefined) {
    return `${Math.round(kgToDisplay(c.tonnageKg, unit)).toLocaleString('en-US')} ${unit} lifted`
  }
  return null
}

/** "1,234 lb" style whole-number display for progress fractions. */
function wholeDisplay(kg: number, unit: WeightUnit): string {
  return Math.round(kgToDisplay(kg, unit)).toLocaleString('en-US')
}

/**
 * The honest progress line for a LOCKED trophy — computed from the same
 * evidence detection reads, never invented ("285/315 lb — 30 lb to go").
 */
export function trophyHint(
  kind: TrophyKind,
  evidence: TrophyEvidence,
  unit: WeightUnit,
): string {
  const def = TROPHY_DEFS[kind]
  switch (def.family) {
    case 'club': {
      const best = evidence.bestByLift[def.lift]
      if (!best) return `No ${LIFT_NAMES[def.lift]} e1RM yet`
      const target = thresholdKg(def.lb)
      const remaining = Math.max(0, target - best.e1rmKg)
      return (
        `${wholeDisplay(best.e1rmKg, unit)}/${wholeDisplay(target, unit)} ${unit}` +
        ` — ${wholeDisplay(remaining, unit)} ${unit} to go`
      )
    }
    case 'sum_club': {
      const missing = SUM_CLUB_LIFTS.filter((lift) => evidence.bestByLift[lift] === undefined)
      if (missing.length > 0) {
        return `Needs a ${missing.map((l) => LIFT_NAMES[l]).join(', ')} e1RM`
      }
      const sum = SUM_CLUB_LIFTS.reduce(
        (total, lift) => total + (evidence.bestByLift[lift]?.e1rmKg ?? 0),
        0,
      )
      const target = thresholdKg(def.lb)
      return (
        `${wholeDisplay(sum, unit)}/${wholeDisplay(target, unit)} ${unit}` +
        ` — ${wholeDisplay(Math.max(0, target - sum), unit)} ${unit} to go`
      )
    }
    case 'count':
      return `${evidence.completedCount}/${def.count} workouts`
    case 'streak':
      if (evidence.scheduledWeekdays.length === 0) {
        return 'Schedule program days to start a streak'
      }
      return `${evidence.streakWeeks}/${def.weeks} weeks`
    case 'block':
      return evidence.hasActiveProgram
        ? "Train every day of your program's final week"
        : 'Start a program'
    case 'tonnage':
      return `${wholeDisplay(evidence.tonnageKg, unit)}/${wholeDisplay(thresholdKg(def.lb), unit)} ${unit} lifted`
  }
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
    for (const row of celebrated) {
      await sendPushToUser(userId, {
        title: `Trophy: ${trophyLabel(row.kind)}`,
        body: 'Earned — see your trophies.',
        url: '/trophies',
      })
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
