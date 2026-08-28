import { describe, it, expect } from 'vitest'
import type { ExerciseTrendPoint } from '@/db/exercise-stats'
import { buildLiftTrend, liftTrendPolyline, LIFT_TREND_MAX_POINTS } from './lift-trend'

/** Sessions one day apart unless `dayGaps` says otherwise — the sparse series
 *  `getExerciseStats` returns, ascending by session start. UTC so the spacing
 *  assertions do not move with the runner's timezone. */
function series(e1rms: readonly number[], dayGaps?: readonly number[]): ExerciseTrendPoint[] {
  let day = 0
  return e1rms.map((e1rm, i) => {
    day += i === 0 ? 0 : (dayGaps?.[i - 1] ?? 1)
    return { workoutId: `w${i}`, performedAt: new Date(Date.UTC(2026, 6, 1 + day)), e1rm }
  })
}

describe('buildLiftTrend', () => {
  it('returns null below two sessions — one point is a dot, not a trend', () => {
    expect(buildLiftTrend([])).toBeNull()
    expect(buildLiftTrend(series([140]))).toBeNull()
  })

  it('reads the headline and the delta off the drawn window', () => {
    const trend = buildLiftTrend(series([140, 145, 152.5]))
    expect(trend).not.toBeNull()
    expect(trend!.latestE1rmKg).toBe(152.5)
    expect(trend!.deltaKg).toBe(12.5)
    expect(trend!.isNewBest).toBe(true)
  })

  it('reports a fall as a negative delta and not a new best', () => {
    const trend = buildLiftTrend(series([160, 155, 150]))!
    expect(trend.deltaKg).toBe(-10)
    expect(trend.isNewBest).toBe(false)
  })

  it('does not claim a new best when the peak is behind the latest session', () => {
    const trend = buildLiftTrend(series([140, 165, 150]))!
    expect(trend.latestE1rmKg).toBe(150)
    expect(trend.isNewBest).toBe(false)
  })

  it('draws a flat series down the middle rather than on the floor', () => {
    const trend = buildLiftTrend(series([150, 150, 150]))!
    expect(trend.vertices.map((v) => v.y)).toEqual([0.5, 0.5, 0.5])
    // "+0.0 kg" would read as a measurement; nothing moved, so there is no
    // delta to state.
    expect(trend.deltaKg).toBeNull()
    expect(trend.isNewBest).toBe(false)
  })

  it('normalizes y so the best sits at the top and the worst on the floor', () => {
    const trend = buildLiftTrend(series([100, 150, 200]))!
    expect(trend.vertices.map((v) => v.y)).toEqual([1, 0.5, 0])
  })

  it('spaces x by TIME, so a layoff reads as a gap', () => {
    // Three sessions: one day apart, then nine days apart.
    const trend = buildLiftTrend(series([140, 145, 150], [1, 9]))!
    expect(trend.vertices.map((v) => v.x)).toEqual([0, 0.1, 1])
  })

  it('collapses x to the middle when every drawn session is the same instant', () => {
    const trend = buildLiftTrend(series([140, 150], [0]))!
    expect(trend.vertices.map((v) => v.x)).toEqual([0.5, 0.5])
  })

  it('flags a PR only when the session beat everything before it on screen', () => {
    const trend = buildLiftTrend(series([140, 150, 145, 150, 155]))!
    // The first can never be a PR; a tie does not take the record, only a
    // strictly greater value does.
    expect(trend.vertices.map((v) => v.pr)).toEqual([false, true, false, false, true])
  })

  it('draws only the last window and measures the delta against it', () => {
    const rising = Array.from({ length: LIFT_TREND_MAX_POINTS + 5 }, (_, i) => 100 + i)
    const trend = buildLiftTrend(series(rising))!
    expect(trend.vertices).toHaveLength(LIFT_TREND_MAX_POINTS)
    // The window opens at the 6th value, not at the series start.
    expect(trend.deltaKg).toBe(rising[rising.length - 1] - rising[5])
  })

  it('never mutates its input', () => {
    const points = series([140, 150])
    const snapshot = JSON.stringify(points)
    buildLiftTrend(points)
    expect(JSON.stringify(points)).toBe(snapshot)
  })
})

describe('liftTrendPolyline', () => {
  it('scales unit vertices into the view box', () => {
    const trend = buildLiftTrend(series([100, 200]))!
    expect(liftTrendPolyline(trend.vertices, 100, 40)).toBe('0,40 100,0')
  })

  it('agrees with the percentage the markers are placed at', () => {
    // The line is drawn in SVG and the PR markers in CSS percentages; both
    // read the same unit vertices, which is what keeps a marker on the line
    // however non-uniformly the cell stretches the box.
    const trend = buildLiftTrend(series([140, 150, 145]))!
    const pr = trend.vertices.findIndex((v) => v.pr)
    expect(pr).toBeGreaterThan(-1)
    const vertex = trend.vertices[pr]
    expect(liftTrendPolyline(trend.vertices, 100, 40).split(' ')[pr]).toBe(
      `${vertex.x * 100},${vertex.y * 40}`,
    )
  })
})
