/** The fields the trend helper reads from a bodyweight log row (kg stored). */
export interface BodyweightPoint {
  weighedAt: Date
  weightKg: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The change in bodyweight (kg) between the freshest entry and the state
 * "~`days` days ago", or null when it can't honestly be computed.
 *
 * Baseline = the freshest entry AT OR BEFORE now − days: that entry was the
 * user's known weight at the cutoff, even if it was logged earlier — the
 * same "latest wins" semantics the current-value sync uses. No entry that
 * old (all logs are recent) → null; the hero simply omits the delta line
 * rather than comparing against a window the data doesn't cover.
 *
 * `logs` is freshest-first, exactly as `listBodyweightLogs` returns it.
 */
export function bodyweightDeltaKg(
  logs: readonly BodyweightPoint[],
  days: number,
  now: Date = new Date(),
): number | null {
  if (logs.length < 2) return null
  const cutoff = now.getTime() - days * MS_PER_DAY
  const current = logs[0]
  const baseline = logs.find((log) => log.weighedAt.getTime() <= cutoff)
  if (!baseline || baseline === current) return null
  // Column precision is 2dp; the subtraction stays at 2dp too.
  return Math.round((current.weightKg - baseline.weightKg) * 100) / 100
}
