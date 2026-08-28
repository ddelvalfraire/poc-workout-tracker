import type { ExerciseTrendPoint } from '@/db/exercise-stats'

/**
 * The pure half of the lift-trend widget: the geometry of the curve one
 * pinned lift draws.
 *
 * Home renders this curve SERVER-SIDE as inline SVG rather than reaching for
 * `components/charts/trend-chart` — that one is a Recharts client island, and
 * home is the surface that must not pay for a charting bundle. Normalizing
 * the points here (rather than in JSX) is what makes the shape testable
 * without a browser, and what a native client will reimplement against these
 * same numbers.
 */

/** How many sessions the curve draws. A trend is a recent shape, not an
 *  archive: past this the line is dense enough that individual sessions stop
 *  being legible in a cell 169px wide. */
export const LIFT_TREND_MAX_POINTS = 12

/** Below this there is no curve to draw. One session is a dot, and a "trend"
 *  through a single point is a fabrication — the widget returns null instead,
 *  which is the catalog's absence-over-emptiness rule. */
const MIN_POINTS = 2

/** A point in unit space: x and y both 0..1, y already flipped so 0 is the
 *  TOP of the box (SVG's own direction) and the caller only has to scale. */
export interface LiftTrendVertex {
  x: number
  y: number
  /** This session beat everything before it on screen — the volt dot. */
  pr: boolean
}

export interface LiftTrend {
  /** The most recent session's e1RM, in kg. The headline. */
  latestE1rmKg: number
  /** Change against the first point of the DRAWN window, in kg. Null when the
   *  window is flat, since "+0.0" reads as a measurement rather than as the
   *  absence of movement it actually is. */
  deltaKg: number | null
  /** The latest session is the best of the drawn window — "new best". */
  isNewBest: boolean
  /** When the latest session happened. */
  lastPerformedAt: Date
  /** Sessions drawn, oldest first. */
  vertices: LiftTrendVertex[]
}

/**
 * Turns a sparse e1RM series into the drawn curve.
 *
 * Points arrive ascending (the query's orderBy) and sparse — only sessions
 * that scored an e1RM appear, which is why x is normalized by TIME rather
 * than by index: a six-week layoff has to read as a gap, not as one more
 * evenly-spaced tick. A single instant (every drawn session on one day)
 * collapses x to the middle instead of dividing by zero.
 *
 * A PR dot marks a session that beat everything before it WITHIN the drawn
 * window. Scoping it to the window is deliberate: the widget's claim is about
 * the curve you can see, and marking a record whose predecessor is off-screen
 * would point at nothing.
 */
export function buildLiftTrend(points: readonly ExerciseTrendPoint[]): LiftTrend | null {
  const drawn = points.slice(-LIFT_TREND_MAX_POINTS)
  if (drawn.length < MIN_POINTS) return null

  const values = drawn.map((p) => p.e1rm)
  const times = drawn.map((p) => p.performedAt.getTime())
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const minTime = times[0]
  const maxTime = times[times.length - 1]
  const valueSpan = maxValue - minValue
  const timeSpan = maxTime - minTime

  let best = -Infinity
  const vertices = drawn.map((point, i) => {
    // Strictly greater keeps a tie on the earlier session — the same rule
    // aggregateExerciseStats and the trophies use for who owns a record.
    const pr = point.e1rm > best
    if (pr) best = point.e1rm
    return {
      x: timeSpan === 0 ? 0.5 : (times[i] - minTime) / timeSpan,
      // A flat series sits on the middle line rather than collapsing onto the
      // floor, which would read as "at your worst" when it means "unchanged".
      y: valueSpan === 0 ? 0.5 : 1 - (point.e1rm - minValue) / valueSpan,
      pr,
    }
  })

  // The first point can never be a PR: there is nothing on screen it beat.
  vertices[0].pr = false

  const latest = drawn[drawn.length - 1]
  const first = drawn[0]
  return {
    latestE1rmKg: latest.e1rm,
    deltaKg: valueSpan === 0 ? null : latest.e1rm - first.e1rm,
    isNewBest: latest.e1rm === maxValue && valueSpan > 0,
    lastPerformedAt: latest.performedAt,
    vertices,
  }
}

/**
 * The `points` attribute for a `<polyline>` drawn into a width x height box.
 *
 * The line — and ONLY the line — is drawn in SVG, stretched to the cell with
 * `preserveAspectRatio="none"`. The PR markers are positioned separately off
 * `vertex.x` / `vertex.y` as percentages, because a non-uniform stretch turns
 * an SVG circle into an ellipse: a "dot" that is round in one cell shape and
 * squashed in another. Both consumers read the same unit vertices, so they
 * land on the same points regardless of how the box is scaled.
 */
export function liftTrendPolyline(
  vertices: readonly LiftTrendVertex[],
  width: number,
  height: number,
): string {
  return vertices.map((v) => `${v.x * width},${v.y * height}`).join(' ')
}
