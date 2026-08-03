import { displayToKg } from './units'

/**
 * Trophy kind identities + their fact definitions — the boundary module the
 * schema types against (mirrors lib/goal-input.ts for goals). Every kind maps
 * to a LIFTING fact the app already computes; there are deliberately no
 * engagement kinds (login streaks, app-opens) — the honesty brand holds.
 *
 * Thresholds are lb-defined (plate-club culture: 315 IS the trophy's name)
 * and compared in stored kg. `thresholdKg` converts at the SAME 2dp column
 * precision as weight entry (`displayToKg`), so a lifter who typed "315 lb"
 * (stored 142.88 kg) clears the 315 club exactly — full-precision conversion
 * (142.8816…) would fail the boundary by a rounding phantom.
 */

/** The canonical barbell lifts plate clubs score. */
export type CanonicalLift = 'squat' | 'bench' | 'deadlift' | 'ohp'

export type TrophyKind =
  | 'club_bench_135'
  | 'club_bench_225'
  | 'club_bench_315'
  | 'club_squat_225'
  | 'club_squat_315'
  | 'club_squat_405'
  | 'club_deadlift_225'
  | 'club_deadlift_315'
  | 'club_deadlift_405'
  | 'club_deadlift_495'
  | 'club_ohp_135'
  | 'club_ohp_225'
  | 'club_1000'
  | 'workouts_1'
  | 'workouts_50'
  | 'workouts_100'
  | 'workouts_250'
  | 'workouts_500'
  | 'streak_4'
  | 'streak_12'
  | 'streak_26'
  | 'streak_52'
  | 'block_complete'
  | 'tonnage_1m'
  | 'tonnage_2m'

/**
 * The recorded fact behind a stamp (narrow, app-validated jsonb — nothing
 * aggregates over it). `workoutId` is present ONLY when the stamp was
 * attributed to a live finish — its absence is what keeps import/backfill
 * stamps off the celebration surfaces (the retroactive-quiet rule).
 */
export interface TrophyContext {
  workoutId?: string
  /** Clubs: the qualifying best e1RM (kg); club_1000: the S+B+D sum. */
  e1rmKg?: number
  count?: number
  weeks?: number
  tonnageKg?: number
}

export type TrophyDef =
  | { family: 'club'; lift: CanonicalLift; lb: number }
  | { family: 'sum_club'; lb: number }
  | { family: 'count'; count: number }
  | { family: 'streak'; weeks: number }
  | { family: 'block' }
  | { family: 'tonnage'; lb: number }

export const TROPHY_DEFS: Readonly<Record<TrophyKind, TrophyDef>> = {
  club_bench_135: { family: 'club', lift: 'bench', lb: 135 },
  club_bench_225: { family: 'club', lift: 'bench', lb: 225 },
  club_bench_315: { family: 'club', lift: 'bench', lb: 315 },
  club_squat_225: { family: 'club', lift: 'squat', lb: 225 },
  club_squat_315: { family: 'club', lift: 'squat', lb: 315 },
  club_squat_405: { family: 'club', lift: 'squat', lb: 405 },
  club_deadlift_225: { family: 'club', lift: 'deadlift', lb: 225 },
  club_deadlift_315: { family: 'club', lift: 'deadlift', lb: 315 },
  club_deadlift_405: { family: 'club', lift: 'deadlift', lb: 405 },
  club_deadlift_495: { family: 'club', lift: 'deadlift', lb: 495 },
  club_ohp_135: { family: 'club', lift: 'ohp', lb: 135 },
  club_ohp_225: { family: 'club', lift: 'ohp', lb: 225 },
  club_1000: { family: 'sum_club', lb: 1000 },
  workouts_1: { family: 'count', count: 1 },
  workouts_50: { family: 'count', count: 50 },
  workouts_100: { family: 'count', count: 100 },
  workouts_250: { family: 'count', count: 250 },
  workouts_500: { family: 'count', count: 500 },
  streak_4: { family: 'streak', weeks: 4 },
  streak_12: { family: 'streak', weeks: 12 },
  streak_26: { family: 'streak', weeks: 26 },
  streak_52: { family: 'streak', weeks: 52 },
  block_complete: { family: 'block' },
  tonnage_1m: { family: 'tonnage', lb: 1_000_000 },
  tonnage_2m: { family: 'tonnage', lb: 2_000_000 },
}

/** Every kind, in the DEFS declaration order (the surfaces' display order). */
export const TROPHY_KINDS = Object.keys(TROPHY_DEFS) as readonly TrophyKind[]

/** A kind's lb threshold in kg AT ENTRY PRECISION (2dp) — see module doc. */
export function thresholdKg(lb: number): number {
  return displayToKg(lb, 'lb')
}

/**
 * The canonical-lift map, curated against the live wger catalog (2026-08).
 * `wgerIds` are exact catalog ids; `nameKeys` are normalized names (see
 * `normalizeExerciseKey`) matched against CUSTOM exercises only — a custom
 * "Back Squat" scores the squat clubs, but wger variants stay id-curated.
 *
 * Curation decisions (each excluded id is a DIFFERENT lift, not a snub):
 *  - squat: 615 "Squats" (barbell back squat), 1801 "Barbell Full Squat".
 *    Excludes front (257), box (977), hack (43), split/goblet variants.
 *  - bench: 73 "Bench Press" (barbell, flat). Excludes incline (538),
 *    decline (185), close-grip (76), and every dumbbell variant.
 *  - deadlift: 184 "Deadlifts" (conventional), 630 "Sumo Deadlift" — sumo is
 *    a legal competition deadlift. Excludes RDL (507, 1700), stiff-leg (627),
 *    deficit (189), rack pulls (484), speed work (604).
 *  - ohp: 687 "Overhead Press", 566 "Shoulder Press, Barbell" — the PRD's
 *    open question resolved: barbell-only; dumbbell (567), machine (543,
 *    569), SZ-bar (418) variants excluded.
 */
export const CANONICAL_LIFTS: Readonly<
  Record<CanonicalLift, { wgerIds: readonly number[]; nameKeys: readonly string[] }>
> = {
  squat: {
    wgerIds: [615, 1801],
    nameKeys: [
      'squat',
      'squats',
      'back squat',
      'barbell squat',
      'barbell back squat',
      'high bar squat',
      'low bar squat',
      'competition squat',
    ],
  },
  bench: {
    wgerIds: [73],
    nameKeys: [
      'bench',
      'bench press',
      'barbell bench press',
      'flat bench press',
      'flat barbell bench press',
      'competition bench press',
    ],
  },
  deadlift: {
    wgerIds: [184, 630],
    nameKeys: [
      'deadlift',
      'deadlifts',
      'barbell deadlift',
      'conventional deadlift',
      'sumo deadlift',
      'competition deadlift',
    ],
  },
  ohp: {
    wgerIds: [687, 566],
    nameKeys: [
      'ohp',
      'overhead press',
      'barbell overhead press',
      'standing overhead press',
      'military press',
      'standing military press',
      'strict press',
      'strict military press',
      'standing barbell press',
      'barbell shoulder press',
    ],
  },
}

/** Human names for lift-scoped copy ("Squat Club", "No deadlift e1RM yet"). */
export const LIFT_NAMES: Readonly<Record<CanonicalLift, string>> = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  ohp: 'OHP',
}
