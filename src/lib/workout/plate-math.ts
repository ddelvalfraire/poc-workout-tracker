/**
 * Barbell loading math for the plate calculator and warm-up ramp. Everything
 * here works in the user's DISPLAY unit — plates are physical objects entered
 * in the unit they're stamped with, and the logger's weight inputs are
 * display-unit too, so no kg conversion belongs in this module.
 *
 * Internally weights are scaled to integer hundredths ("cents") so fractional
 * plates (2.5 lb, 1.25 kg) never accumulate float drift.
 */

const toCents = (weight: number) => Math.round(weight * 100)

export interface PlateLoad {
  /** Plates on ONE side, heaviest first. */
  perSide: number[]
  /** Total weight actually built (bar + 2 × per-side sum) — ≤ target. */
  achieved: number
  /** True when the target is buildable exactly with the given denominations. */
  exact: boolean
}

/**
 * Greedy per-side loading: `(target − bar) / 2` filled largest-denomination
 * first (unlimited pairs of each — the inventory is denominations owned, not
 * counts). When the target isn't buildable the result is the closest greedy
 * weight BELOW it, flagged `exact: false`. Returns null when the target is
 * below the bar itself. `bar` may be 0 for plate-loaded machines.
 */
export function loadBar(target: number, bar: number, plates: number[]): PlateLoad | null {
  const targetCents = toCents(target)
  const barCents = toCents(bar)
  if (targetCents < barCents) return null

  const denominations = Array.from(new Set(plates.filter((p) => p > 0).map(toCents))).sort(
    (a, b) => b - a,
  )

  const perSideTarget = Math.floor((targetCents - barCents) / 2)
  let remaining = perSideTarget
  const perSide: number[] = []
  for (const denomination of denominations) {
    while (remaining >= denomination) {
      perSide.push(denomination / 100)
      remaining -= denomination
    }
  }

  const achievedCents = barCents + 2 * (perSideTarget - remaining)
  return {
    perSide,
    achieved: achievedCents / 100,
    exact: achievedCents === targetCents,
  }
}

/**
 * Total weight from plates counted on ONE side: bar + 2 × side sum. The
 * inverse of `loadBar`, for the "what am I looking at" direction — count the
 * plates already on the bar and get the number to type into the set.
 */
export function totalFromPlates(perSide: number[], bar: number): number {
  const sideCents = perSide.reduce((sum, plate) => sum + toCents(plate), 0)
  return (toCents(bar) + 2 * sideCents) / 100
}

export interface WarmupStep {
  weight: number
  reps: number
  /** Plates on one side for this step (empty for the bare bar). */
  perSide: number[]
}

/** The classic ramp shape: empty bar, then rising percentages at falling reps. */
const RAMP = [
  { fraction: 0.4, reps: 5 },
  { fraction: 0.6, reps: 3 },
  { fraction: 0.8, reps: 1 },
] as const

const BAR_REPS = 10

/**
 * Warm-up ramp toward `working`: the empty bar, then ~40/60/80% — each step
 * rounded DOWN to what the available plates can actually build (this is where
 * the ramp and the plate calculator become one system). Steps that fall at or
 * below the bar, reach the working weight, or collapse onto an earlier step's
 * achievable weight are dropped. Empty when the working weight is below the
 * bar; just the bar step when they're equal.
 */
export function warmupRamp(working: number, bar: number, plates: number[]): WarmupStep[] {
  const workingCents = toCents(working)
  const barCents = toCents(bar)
  if (workingCents < barCents) return []

  const steps: WarmupStep[] = []
  const seen = new Set<number>()

  if (barCents > 0) {
    steps.push({ weight: bar, reps: BAR_REPS, perSide: [] })
    seen.add(barCents)
  }

  for (const { fraction, reps } of RAMP) {
    const load = loadBar((workingCents * fraction) / 100, bar, plates)
    if (!load) continue
    const achievedCents = toCents(load.achieved)
    if (achievedCents <= 0 || achievedCents >= workingCents) continue
    if (seen.has(achievedCents)) continue
    seen.add(achievedCents)
    steps.push({ weight: load.achieved, reps, perSide: load.perSide })
  }

  return steps
}
