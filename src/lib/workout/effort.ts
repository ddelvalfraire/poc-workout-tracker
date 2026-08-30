/**
 * RPE/RIR effort logging — validation, display, and the one show rule.
 *
 * Both scales are stored side by side, never converted (half-point RPE
 * straddles RIR integers — a lossy mapping would corrupt the logged fact).
 * Pure functions, no IO: the logger, summary, MCP tools, and the input
 * boundary all speak through here so the ranges live in exactly one place.
 */

/** Reps-in-reserve bounds — 0 (nothing left) to a generous 10. */
export const RIR_MIN = 0
export const RIR_MAX = 10

/** RPE bounds (as used in lifting): 4–10, half-point steps. */
export const RPE_MIN = 4
export const RPE_MAX = 10

/** True for an integer RIR within 0..10. */
export function isValidRir(value: number): boolean {
  return Number.isInteger(value) && value >= RIR_MIN && value <= RIR_MAX
}

/** True for an RPE within 4..10 on a half-point step. */
export function isValidRpe(value: number): boolean {
  if (!Number.isFinite(value) || value < RPE_MIN || value > RPE_MAX) return false
  // Half-point grid: doubling must land on an integer (8.5 → 17; 8.25 → 16.5).
  return Number.isInteger(value * 2)
}

/**
 * Logged effort as words — "RIR 2" / "RPE 8.5" / "RIR 1 · RPE 9" — or null
 * when nothing was logged. Display-only: surfaces render it muted after the
 * set text, never as a control.
 */
export function effortLabel(rir: number | null, rpe: number | null): string | null {
  const parts: string[] = []
  if (rir !== null) parts.push(`RIR ${rir}`)
  if (rpe !== null) parts.push(`RPE ${rpe}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The slice of a planned set the show rule reads — satisfied by
 *  `PlanSetTarget` (fields optional there: pre-effort targets carry neither). */
export interface EffortTargetLike {
  rir?: number | null
  rpe?: number | null
}

/**
 * THE show rule (spec-exact): the effort chip row appears iff the set has a
 * prescribed effort target OR the user opted in via the rpeLoggingEnabled
 * preference. No program-level flag, no per-workout toggle — structure or
 * preference, nothing else.
 */
export function shouldShowEffortRow(
  target: EffortTargetLike | undefined,
  rpeLoggingEnabled: boolean,
): boolean {
  if (rpeLoggingEnabled) return true
  if (!target) return false
  return (target.rir ?? null) !== null || (target.rpe ?? null) !== null
}
