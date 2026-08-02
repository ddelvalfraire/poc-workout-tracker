/**
 * Day-bucket zero-fill for the ops board's fixed-window charts. Sources
 * (Postgres date_trunc buckets, Langfuse daily metrics) only return days that
 * HAVE data; a chart over a fixed window must render the silent days as 0 or
 * the x-axis lies about the gap. Pure and UTC-only — every source keys days
 * as UTC "YYYY-MM-DD", so no timezone math belongs here.
 */

export interface DayPoint {
  /** UTC calendar date, "YYYY-MM-DD". */
  day: string
  value: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** UTC "YYYY-MM-DD" for a Date. */
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Expands sparse `{day, value}` rows into a dense ascending window of
 * `days` entries ending at `end` (inclusive, UTC). Missing days become 0;
 * rows outside the window are dropped; duplicate days sum.
 */
export function fillDailySeries(rows: DayPoint[], days: number, end: Date = new Date()): DayPoint[] {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.value)
  }
  const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  const series: DayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDayKey(new Date(endMs - i * MS_PER_DAY))
    series.push({ day, value: byDay.get(day) ?? 0 })
  }
  return series
}
