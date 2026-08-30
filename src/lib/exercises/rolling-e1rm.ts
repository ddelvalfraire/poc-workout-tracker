import { estimate1RM, MAX_RELIABLE_REPS } from '@/lib/exercises/one-rep-max'
import type { SetType } from '@/lib/programs/program-input'

/**
 * The ROLLING e1RM — the control signal of RPE-aware autoregulation
 * (.claude/PRPs/plans/rpe-aware-autoreg.plan.md §3.1). Where `bestSet` is the
 * all-time monotonic best (a bad month never lowers it), this averages the
 * per-session TOP-set e1RMs over the newest few sessions, so the signal
 * tracks current strength in both directions.
 *
 * Effort-aware but effort-OPTIONAL: a logged RIR credits reps in the bank
 * (Epley on reps + rir — the set "was" a harder set than its face reps),
 * while a set with no effort log counts at face value, so users who never
 * touch the chips keep working targets. Two literature guards (Halperin
 * 2022): far-from-failure sets (RIR > 3) and high-rep sets (> 12) are too
 * noisy to estimate from and are excluded entirely.
 *
 * Pure — the caller feeds history rows (weight_reps only, same admissibility
 * rule as the bestSet path it replaces for rpe-target). Sessions are the
 * recency mechanism: no wall-clock cutoff, so a returning lifter still gets
 * targets from their newest real sessions instead of a null.
 */

/** Per-session top sets averaged — the window that lets a bad stretch
 *  actually lower the signal (5 = the literature's 3–5 upper bound; more
 *  smoothing, same responsiveness scale as the engine's 4-session window). */
export const ROLLING_E1RM_SESSIONS = 5

/** RIR above this = too far from failure to estimate from (Halperin 2022). */
const MAX_CREDIBLE_RIR = 3

export interface RollingE1rmRow {
  workoutId: string
  startedAtMs: number
  reps: number | null
  weightKg: number | null
  rir: number | null
  setType: SetType
  completed: boolean
}

/** Epley with RIR credit; null for non-qualifying rows. */
function creditedE1rm(row: RollingE1rmRow): number | null {
  if (!row.completed || row.setType === 'warmup') return null
  if (row.reps === null || row.reps > MAX_RELIABLE_REPS) return null
  if (row.rir !== null && row.rir > MAX_CREDIBLE_RIR) return null
  return estimate1RM(row.reps + (row.rir ?? 0), row.weightKg)
}

export function rollingE1rm(rows: readonly RollingE1rmRow[]): number | null {
  // Top qualifying e1RM per session, newest sessions first.
  const topBySession = new Map<string, { startedAtMs: number; e1rm: number }>()
  for (const row of rows) {
    const e1rm = creditedE1rm(row)
    if (e1rm === null) continue
    const current = topBySession.get(row.workoutId)
    if (current === undefined || e1rm > current.e1rm) {
      topBySession.set(row.workoutId, { startedAtMs: row.startedAtMs, e1rm })
    }
  }
  const tops = [...topBySession.values()]
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, ROLLING_E1RM_SESSIONS)
  if (tops.length === 0) return null
  return tops.reduce((sum, t) => sum + t.e1rm, 0) / tops.length
}
