/**
 * units.ts — dimensions and units.
 *
 * A dimension is an integer exponent vector over the base dimensions (the
 * free abelian group). A unit is ONE record: its dimension, its scale to the
 * canonical value, its compact symbol and its prose.
 * Adding a unit is one entry here and nothing else: the describer, the
 * trace display and the checker all read the record.
 *
 * Three clocks get three dimensions and never mix: `time` (seconds, inside a
 * session), `day` (the calendar clock) and `week` (the progress clock).
 * `days(2) + weeks(1)` is a unit mismatch, and there is no conversion former.
 * No rate may be spelled per day or per week, so no literal converts one
 * clock into another or into a load (the IR refuses it as `clockRate`).
 *
 * A literal is stored CANONICAL (kg, s, m, RIR, beats/s) beside the unit it is
 * displayed in, so `100 kg + 5 lb` adds canonical values and shows both.
 */

export type BaseDim = 'mass' | 'rep' | 'set' | 'time' | 'length' | 'effort' | 'week' | 'day' | 'angle' | 'beat'
export type DimVec = Readonly<Partial<Record<BaseDim, number>>> // {} = dimensionless
export const BASE_DIMS: readonly BaseDim[] = ['mass', 'rep', 'set', 'time', 'length', 'effort', 'week', 'day', 'angle', 'beat']

/** The named dimensions the TS embedding spells. The IR checker works on
 *  vectors and accepts any well-formed one; these names are the embedding's
 *  vocabulary and the display lookup. */
export type Dim =
  | 'one' //         ratios, percents, counts of things that are not reps/sets
  | 'mass'
  | 'reps'
  | 'sets'
  | 'time'
  | 'length'
  | 'effort' //      reps in reserve; RPE is input notation lowered to RIR, resistance sets only
  | 'weeks' //       the progress clock
  | 'days' //        the calendar clock
  | 'angle' //       range of motion
  | 'heartRate' //   beats per time: beats are a base dimension so bpm never unifies with a cadence
  | 'pace' //        time per length (min/km is a unit of it, not a division)
  | 'speed'
  | 'power'
  | 'energy'
  | 'pressure' //    BFR cuff pressure
  | 'massPerRep' //  Juggernaut: "+2.5 kg per rep past the standard"
  | 'tonnage' //     mass · rep (volume load)

export const DIMS: Readonly<Record<Dim, DimVec>> = {
  one: {},
  mass: { mass: 1 },
  reps: { rep: 1 },
  sets: { set: 1 },
  time: { time: 1 },
  length: { length: 1 },
  effort: { effort: 1 },
  weeks: { week: 1 },
  days: { day: 1 },
  angle: { angle: 1 },
  heartRate: { beat: 1, time: -1 },
  pace: { time: 1, length: -1 },
  speed: { length: 1, time: -1 },
  power: { mass: 1, length: 2, time: -3 },
  energy: { mass: 1, length: 2, time: -2 },
  pressure: { mass: 1, length: -1, time: -2 },
  massPerRep: { mass: 1, rep: -1 },
  tonnage: { mass: 1, rep: 1 },
}

/** Products the embedding names. The IR checker is authoritative: it accepts
 *  every product as a vector; this table only decides which products tsc can
 *  spell. There is no quotient table because there is no division former
 *  (ratios come from `ratio`, and pace is a unit, not a quotient). */
type MulTable = {
  'massPerRep*reps': 'mass'
  'reps*massPerRep': 'mass'
  'mass*reps': 'tonnage'
  'reps*mass': 'tonnage'
  'speed*time': 'length'
  'time*speed': 'length'
  'pace*length': 'time'
  'length*pace': 'time'
}
/** Dimension product. `never` = the product is not a named Dim (a unit error
 *  in the embedding; the IR checker would still accept a well-formed vector). */
export type Mul<A extends Dim, B extends Dim> = A extends 'one'
  ? B
  : B extends 'one'
    ? A
    : `${A}*${B}` extends keyof MulTable
      ? MulTable[`${A}*${B}`]
      : never

/** Rates a literal may spell as `unit per unit` ("2.5 kg per rep"): the
 *  explicit-vector literal, kept as a quotient of two registered units so its
 *  display is always derivable and it can never carry a vector with no prose. */
type RateTable = {
  'mass/reps': 'massPerRep'
}
export type Rate<A extends Dim, B extends Dim> = `${A}/${B}` extends keyof RateTable ? RateTable[`${A}/${B}`] : never
/** The two clock units: a rate over either is refused (`clockRate`). */
export const CLOCK_UNITS: readonly string[] = ['d', 'wk']

// ── unit records ─────────────────────────────────────────────────────────────

const trim = (n: number) => String(Number(n.toFixed(3)))
const plural = (n: number, w: string) => `${trim(n)} ${w}${n === 1 ? '' : 's'}`
/** mm:ss, for pace and long durations ("5:30"). Whole seconds first, so
 *  119.6 s is "2:00", never "1:60". */
export const clock = (secs: number) => {
  const total = Math.round(secs)
  const m = Math.floor(total / 60)
  return `${m}:${String(total - m * 60).padStart(2, '0')}`
}

export interface UnitDecl {
  readonly dim: Dim
  /** canonical = n × scale */
  readonly scale: number
  /** Compact suffix for table rows ("65/70/75%"). */
  readonly symbol: string
  /** The authored number in prose ("5 reps", "5:30 per km"). */
  readonly prose: (n: number) => string
}

/** A literal keeps its DISPLAY unit so prose says "5 lb" when the author wrote
 *  lb; its value is canonical. */
export const UNITS = {
  kg: { dim: 'mass', scale: 1, symbol: ' kg', prose: (n) => `${trim(n)} kg` },
  lb: { dim: 'mass', scale: 0.45359237, symbol: ' lb', prose: (n) => `${trim(n)} lb` },
  rep: { dim: 'reps', scale: 1, symbol: ' reps', prose: (n) => plural(n, 'rep') },
  set: { dim: 'sets', scale: 1, symbol: ' sets', prose: (n) => plural(n, 'set') },
  s: { dim: 'time', scale: 1, symbol: ' s', prose: (n) => `${trim(n)} s` },
  min: { dim: 'time', scale: 60, symbol: ' min', prose: (n) => (Number.isInteger(n) ? `${trim(n)} min` : `${clock(n * 60)} min`) },
  h: { dim: 'time', scale: 3600, symbol: ' h', prose: (n) => plural(n, 'hour') },
  m: { dim: 'length', scale: 1, symbol: ' m', prose: (n) => `${trim(n)} m` },
  km: { dim: 'length', scale: 1000, symbol: ' km', prose: (n) => `${trim(n)} km` },
  mi: { dim: 'length', scale: 1609.344, symbol: ' mi', prose: (n) => plural(n, 'mile') },
  rir: { dim: 'effort', scale: 1, symbol: ' in reserve', prose: (n) => `${trim(n)} in reserve` },
  pct: { dim: 'one', scale: 0.01, symbol: '%', prose: (n) => `${trim(n)}%` },
  x: { dim: 'one', scale: 1, symbol: '', prose: (n) => trim(n) },
  wk: { dim: 'weeks', scale: 1, symbol: ' weeks', prose: (n) => plural(n, 'week') },
  d: { dim: 'days', scale: 1, symbol: ' days', prose: (n) => plural(n, 'day') },
  deg: { dim: 'angle', scale: 1, symbol: '°', prose: (n) => `${trim(n)}°` },
  bpm: { dim: 'heartRate', scale: 1 / 60, symbol: ' bpm', prose: (n) => `${trim(n)} bpm` },
  minPerKm: { dim: 'pace', scale: 0.06, symbol: ' /km', prose: (n) => `${clock(n * 60)} per km` },
  minPerMi: { dim: 'pace', scale: 60 / 1609.344, symbol: ' /mi', prose: (n) => `${clock(n * 60)} per mile` },
  mps: { dim: 'speed', scale: 1, symbol: ' m/s', prose: (n) => `${trim(n)} m/s` },
  W: { dim: 'power', scale: 1, symbol: ' W', prose: (n) => `${trim(n)} W` },
  kcal: { dim: 'energy', scale: 4184, symbol: ' kcal', prose: (n) => `${trim(n)} kcal` },
  mmHg: { dim: 'pressure', scale: 133.322, symbol: ' mmHg', prose: (n) => `${trim(n)} mmHg` },
} as const satisfies Record<string, UnitDecl>
export type Unit = keyof typeof UNITS
export type DimOf<U extends Unit> = (typeof UNITS)[U]['dim']

/** Authored number → canonical value, and back for display. */
export const canon = (n: number, unit: Unit, per?: Unit) => (n * UNITS[unit].scale) / (per ? UNITS[per].scale : 1)
export const shown = (v: number, unit: Unit, per?: Unit) => Number(((v / UNITS[unit].scale) * (per ? UNITS[per].scale : 1)).toPrecision(12))

// ── vector arithmetic (the checker's and the display's shared core) ──────────

/** THE quantization law, one for the language (the sink's plate fitting and
 *  `round` nearest alike): the nearest multiple of `step`, ties DOWN (toward
 *  −∞). Pinned so another implementation reproduces it bit for bit: the only
 *  float operations are u = x ÷ step, then u × 10⁹, then m = that rounded
 *  half away from zero. n = ⌈(m − Q/2) ÷ Q⌉ (Q = 10⁹) is exact integer
 *  arithmetic, and the result is n × step. So a tie is any u within half a
 *  billionth of a step of a half-integer. Past |m| > 2⁵² the operand is
 *  returned as is. */
export const QUANTA_PER_STEP = 1_000_000_000
export type Ties = 'down' | 'up'
/** `ties: 'up'` is the program-declared alternative (the `ties` option): the
 *  same integer formulation with n = ⌊(m + Q/2) ÷ Q⌋, so a tie is sent toward
 *  +∞ and every non-tie is unchanged. */
export function nearestStep(x: number, step: number, ties: Ties = 'down'): number {
  const v = (x / step) * QUANTA_PER_STEP
  const m = Math.sign(v) * Math.round(Math.abs(v))
  if (!(Math.abs(m) <= 2 ** 52)) return x
  if (ties === 'up') {
    const a = m + QUANTA_PER_STEP / 2
    const r = ((a % QUANTA_PER_STEP) + QUANTA_PER_STEP) % QUANTA_PER_STEP
    return ((a - r) / QUANTA_PER_STEP) * step
  }
  const a = m - QUANTA_PER_STEP / 2
  const r = a % QUANTA_PER_STEP
  return ((a - r) / QUANTA_PER_STEP + (r > 0 ? 1 : 0)) * step
}
/** Directed quantization: the step multiple at or below x (`round` down, a
 *  ceiling at the sink) and at or above x (`round` up, a floor at the sink),
 *  forgiving float noise of 1e-9 of a step: floor(x/s + 1e-9)·s and
 *  ceil(x/s − 1e-9)·s, in that operation order. */
export const stepDown = (x: number, s: number) => Math.floor(x / s + 1e-9) * s
export const stepUp = (x: number, s: number) => Math.ceil(x / s - 1e-9) * s
export const dimEq = (a: DimVec, b: DimVec) => BASE_DIMS.every((d) => (a[d] ?? 0) === (b[d] ?? 0))
export const dimOp = (a: DimVec, b: DimVec, sign: 1 | -1): DimVec => {
  const out: Partial<Record<BaseDim, number>> = {}
  for (const d of BASE_DIMS) {
    const n = (a[d] ?? 0) + sign * (b[d] ?? 0)
    if (n !== 0) out[d] = n
  }
  return out
}
/** A literal's vector: its unit's, divided by its `per` unit's if present. */
export const litDim = (unit: Unit, per?: Unit): DimVec => (per ? dimOp(DIMS[UNITS[unit].dim], DIMS[UNITS[per].dim], -1) : DIMS[UNITS[unit].dim])

const DIM_NAMES = Object.entries(DIMS) as [Dim, DimVec][]
export const dimName = (v: DimVec): string => DIM_NAMES.find(([, x]) => dimEq(x, v))?.[0] ?? JSON.stringify(v)

/** Display: the unit to show a computed vector in. Prefers a unit the
 *  operands were authored in (an lb program stays in lb), then the first
 *  registered unit of that dimension. Derived from the vector, never from a
 *  per-operator special case. */
export function unitFor(v: DimVec, prefer: readonly Unit[] = [], magnitude?: number): Unit | null {
  const fits = (u: Unit) => dimEq(DIMS[UNITS[u].dim], v)
  const preferred = prefer.find(fits)
  if (preferred) return preferred
  // A DERIVED duration (pace × distance) reads in minutes once it is a minute
  // or more: "23:45 min", never "1425 s" (the R2 display decision).
  if (magnitude !== undefined && dimEq(v, DIMS.time)) return Math.abs(magnitude) >= 60 ? 'min' : 's'
  return (Object.keys(UNITS) as Unit[]).find(fits) ?? null
}

/** A quantity in prose: "5 reps", "2.5 kg per rep". */
export function qtyText(n: number, unit: Unit, per?: Unit): string {
  if (!per) return UNITS[unit].prose(n)
  const perWord = UNITS[per].prose(1).replace(/^1 /, '')
  return `${UNITS[unit].prose(n)} per ${perWord}`
}
export { trim as trimNumber }
