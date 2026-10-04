/**
 * xform.ts — the eight session transformers as functions over session
 * VALUES (engine.ts SessionValue). They run inside `evaluate` (the `xform`
 * former) and so inside every policy, role deload and phase transform.
 *
 * Decisions this file carries (rationale, "R2 law decisions"):
 *  - A transformer over an OPEN field wraps its term and scales its planned
 *    value, so the live resolution and the ghost both see it (EC-117).
 *  - A transformer over a SILENT field leaves it silent with its cause (EC-118).
 *  - scaleSets rounds down and never below 1, except that an empty line stays
 *    empty (a deload never adds a set). Repeated scaling rounds at each
 *    application: 6 sets × 60% × 60% is 3 then 1, not 36% of 6 = 2.
 *  - capEffort, reshape and addSets act on JUDGED sets (every role but warm-up
 *    and recovery); scaleMetric, scaleSets and setTempo act on every set.
 */
import type { BoundIR, Term } from './algebra'
import type { Field, IssuedBound, IssuedStep, IssuedTarget, SessionValue, Tempo4, Value } from './engine'

export const JUDGED_ROLES: readonly string[] = ['working', 'amrap', 'backoff', 'test']
export const isJudged = (t: IssuedTarget) => JUDGED_ROLES.includes(t.role)

const EPS = 1e-9
/** floor that forgives float noise: 0.6 × 5 is 3, not 2.9999999. */
export const floorQ = (x: number) => Math.floor(x + EPS)

const litX = (n: number): Term => ({ k: 'lit', lit: { k: 'q', v: n, unit: 'x' } })
const mapBound = (b: IssuedBound, f: (n: number) => number): IssuedBound => {
  switch (b.b) {
    case 'exact':
    case 'atLeast':
    case 'atMost':
      return { b: b.b, v: f(b.v) }
    case 'range':
      return { b: 'range', min: f(b.min), max: f(b.max) }
    case 'open':
      return b
  }
}
const mapBoundIR = (b: BoundIR, f: (t: Term) => Term): BoundIR => {
  switch (b.b) {
    case 'exact':
    case 'atLeast':
    case 'atMost':
      return { b: b.b, v: f(b.v) }
    case 'range':
      return { b: 'range', min: f(b.min), max: f(b.max) }
    case 'open':
      return b
  }
}
/** Apply a numeric map to a field: fixed values directly, an open field's term
 *  by wrapping each edge and its planned value the same way. */
export function mapField(fd: Field, num: (n: number) => number, term: (t: Term) => Term): Field {
  switch (fd.k) {
    case 'silent':
      return fd
    case 'fixed':
      return { k: 'fixed', v: mapBound(fd.v, num) }
    case 'open':
      return { ...fd, bound: mapBoundIR(fd.bound, term), planned: mapField(fd.planned, num, term) as Extract<Field, { k: 'fixed' | 'silent' }> }
  }
}

const mapSets = (s: SessionValue, f: (t: IssuedTarget, step: IssuedStep) => IssuedTarget): SessionValue => ({
  ...s,
  steps: s.steps.map((st) => ({ ...st, sets: st.sets.map((t) => f(t, st)) })),
})

const scaleCount = (n: number, f: number) => (n === 0 ? 0 : Math.max(1, floorQ(n * f)))

function scaleSets(s: SessionValue, f: number): SessionValue {
  return {
    ...s,
    steps: s.steps.map((st): IssuedStep => {
      const c = st.count
      if (c.k === 'n') {
        const n = scaleCount(c.n, f)
        return { ...st, count: { k: 'n', n }, sets: st.sets.slice(0, n) }
      }
      if (c.k === 'range') {
        const min = scaleCount(c.min, f)
        const max = Math.max(min, scaleCount(c.max, f))
        return { ...st, count: { k: 'range', min, max }, sets: st.sets.slice(0, max) }
      }
      const max = scaleCount(c.max, f)
      return { ...st, count: { k: c.k, max, planned: Math.min(c.planned, max) }, sets: st.sets.slice(0, max) }
    }),
  }
}

/** "at least c in reserve" folded into whatever effort bound the set has. */
function capField(fd: Field | undefined, c: number): Field {
  if (!fd) return { k: 'fixed', v: { b: 'exact', v: c } }
  const atLeastC = (t: Term): Term => ({ k: 'arith', op: 'max', a: t, b: { k: 'lit', lit: { k: 'q', v: c, unit: 'rir' } } })
  if (fd.k === 'fixed') {
    const b = fd.v
    if (b.b === 'open') return { k: 'fixed', v: { b: 'atLeast', v: c } }
    if (b.b === 'atMost') return { k: 'fixed', v: b.v < c ? { b: 'exact', v: c } : b }
    return { k: 'fixed', v: mapBound(b, (n) => Math.max(n, c)) }
  }
  return mapField(fd, (n) => Math.max(n, c), atLeastC)
}

function addSets(s: SessionValue, k: number): SessionValue {
  const last = s.steps.map((st, i) => [st, i] as const).filter(([st]) => st.sets.some(isJudged)).pop()
  if (!last || k <= 0) return s
  const [st, i] = last
  const extra = Array.from({ length: k }, () => st.sets[st.sets.length - 1]!)
  const count: IssuedStep['count'] =
    st.count.k === 'n' ? { k: 'n', n: st.count.n + k } : st.count.k === 'range' ? { k: 'range', min: st.count.min + k, max: st.count.max + k } : { ...st.count, max: st.count.max + k, planned: st.count.planned + k }
  const steps = [...s.steps]
  steps[i] = { ...st, count, sets: [...st.sets, ...extra] }
  return { ...s, steps }
}

/** Apply one transformer. `arg` is the evaluated argument; `logs` the metrics
 *  the session's exercise logs (null when unknown), so a transformer never
 *  writes a metric the exercise does not log (the checker refuses it where the
 *  logging is known statically; this is the runtime twin for a Use hole). */
export function applyXform(op: Extract<Term, { k: 'xform' }>['op'], s: SessionValue, arg: Value | null, metric: string | null, logs: readonly string[] | null): SessionValue {
  const num = () => (arg && arg.v === 'q' ? arg.n : NaN)
  switch (op) {
    case 'scaleMetric': {
      const f = num()
      return mapSets(s, (t) => {
        const fd = metric ? t.metrics[metric] : undefined
        if (!metric || !fd) return t
        return { ...t, metrics: { ...t.metrics, [metric]: mapField(fd, (n) => n * f, (x) => ({ k: 'arith', op: '*', a: x, b: litX(f) })) } }
      })
    }
    case 'scaleSets':
      return scaleSets(s, num())
    case 'capEffort': {
      if (logs && !logs.includes('effort')) return s
      const c = num()
      return mapSets(s, (t) => (isJudged(t) ? { ...t, metrics: { ...t.metrics, effort: capField(t.metrics['effort'], c) } } : t))
    }
    case 'setTempo':
      return mapSets(s, (t) => ({ ...t, tempo: arg && arg.v === 'tempo' ? arg.t : t.tempo }))
    case 'reshape': {
      const shape = arg && arg.v === 'set' ? arg.t : null
      if (!shape) return s
      return mapSets(s, (t) => (isJudged(t) ? { ...t, metrics: { ...t.metrics, ...shape.metrics } } : t))
    }
    case 'stripIntensifier':
      return { ...s, intensifier: null }
    case 'swapExercise':
      return arg ? { ...s, exercise: arg } : s
    case 'addSets':
      return addSets(s, floorQ(num()))
  }
}

export const tempoOf = (v: Value): Tempo4 | null => (v.v === 'tempo' ? v.t : null)
