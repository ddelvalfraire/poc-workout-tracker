/** The fields the trend helpers read from a bodyweight log row (kg stored). */
export interface BodyweightPoint {
  weighedAt: Date
  weightKg: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** EMA time constant: a reading's influence decays over ~a week, so daily
 *  water-weight noise averages out while a real month trend still shows. */
const TREND_TAU_DAYS = 7

/**
 * The change between the freshest value and the state "~`days` days ago", or
 * null when it can't honestly be computed. Baseline = the freshest point AT
 * OR BEFORE now − days: that point was the known state at the cutoff even if
 * it was logged earlier ("latest wins", the current-value sync semantics).
 * No point that old → null; surfaces omit the delta line rather than compare
 * against a window the data doesn't cover. `points` is freshest-first.
 */
export function seriesDeltaAt(
  points: readonly { atMs: number; value: number }[],
  days: number,
  nowMs: number,
): number | null {
  if (points.length < 2) return null
  const cutoff = nowMs - days * MS_PER_DAY
  const current = points[0]
  const baseline = points.find((point) => point.atMs <= cutoff)
  if (!baseline || baseline === current) return null
  return current.value - baseline.value
}

/**
 * The change in bodyweight (kg) between the freshest entry and the state
 * "~`days` days ago" — seriesDeltaAt over log rows, rounded to the weight
 * column's 2dp precision. `logs` is freshest-first, exactly as
 * `listBodyweightLogs` returns it.
 */
export function bodyweightDeltaKg(
  logs: readonly BodyweightPoint[],
  days: number,
  now: Date = new Date(),
): number | null {
  const delta = seriesDeltaAt(
    logs.map((log) => ({ atMs: log.weighedAt.getTime(), value: log.weightKg })),
    days,
    now.getTime(),
  )
  // Column precision is 2dp; the subtraction stays at 2dp too.
  return delta === null ? null : Math.round(delta * 100) / 100
}

/**
 * Trend weight: a time-decayed exponential moving average (τ = 7 days) over
 * irregular weigh-ins — the Happy Scale/Withings "trend over noise" number.
 * Per chronological step: w = 1 − e^(−Δdays/τ); trend += w · (raw − trend);
 * the first reading seeds the trend. Time-decayed (not per-sample α) so two
 * readings a day don't move the trend twice as fast as one daily reading.
 *
 * Input freshest-first (the listBodyweightLogs convention); output is the
 * same points freshest-first with `weightKg` replaced by the trend value —
 * shape-compatible with bodyweightDeltaKg for the direction line.
 */
export function trendWeightSeries(
  logs: readonly BodyweightPoint[],
  tauDays: number = TREND_TAU_DAYS,
): BodyweightPoint[] {
  if (logs.length === 0) return []
  const chronological = [...logs].reverse()
  const out: BodyweightPoint[] = []
  let trend = chronological[0].weightKg
  let prevMs = chronological[0].weighedAt.getTime()
  for (const point of chronological) {
    const deltaDays = Math.max(0, (point.weighedAt.getTime() - prevMs) / MS_PER_DAY)
    const w = 1 - Math.exp(-deltaDays / tauDays)
    trend += w * (point.weightKg - trend)
    prevMs = point.weighedAt.getTime()
    out.push({ weighedAt: point.weighedAt, weightKg: trend })
  }
  return out.reverse()
}
