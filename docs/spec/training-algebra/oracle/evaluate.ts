/**
 * evaluate.ts — the operational semantics of all 47 term formers: a pure,
 * total function from (term, context) to a traced value.
 *
 * TOTAL. Every iteration ranges over a finite value or a literal bound (fold,
 * tabulate, sum, count, pick over lists; allocate up to its literal max;
 * repeat, until and while up to their literal counts), `app` resolves only
 * definitions published before the caller, and every domain edge has a value:
 *   - ratio over zero is absent (zeroDenominator); there is no other division;
 *   - round with an evaluated step ≤ 0 returns its operand unrounded (noted in
 *     the trace); a literal one is refused at check (literalDomain);
 *   - nth floors its index; hold clamps into [0, len−1], cycle takes the true
 *     modulus, so −1 cycles to the last element; over an empty list (which
 *     no checked definition can reach) it is none(emptyPick);
 *   - a set count is floored and never negative; allocate hands out
 *     floor(max(n, 0)) units, at most `max`, and traces what it dropped.
 * PURE. Every world read goes through the context's ports, which the caller
 * builds from stamped inputs (L12) and which record what was read.
 *
 * Absence is flattened at runtime (engine.ts Value): `some x` is x.
 */
import type { BoundIR, DefRef, FnDef, StepIR, Term } from './algebra'
import { canonicalJson } from './canonical'
import { enumsWith, keyOf, type Registry } from './checker'
import type { Absence, Field, Frame, IssuedBound, IssuedStep, IssuedTarget, PerformedSet, SessionValue, Trace, Value } from './engine'
import type { LoggingType } from './registry'
import type { CalQuery } from './time'
import { DIMS, dimEq, dimOp, litDim, nearestStep, stepDown, stepUp, unitFor, type DimVec, type Unit } from './units'
import { applyXform, floorQ, tempoOf } from './xform'

// ── values ───────────────────────────────────────────────────────────────────

export type QV = Extract<Value, { v: 'q' }>
export const qv = (n: number, dim: DimVec, unit: Unit | null, extra: Partial<QV> = {}): QV => ({ v: 'q', n, dim, unit, ...extra })
export const none = (cause: Absence): Value => ({ v: 'none', cause })
export const bool = (b: boolean): Value => ({ v: 'bool', b })
export const isNone = (v: Value): v is Extract<Value, { v: 'none' }> => v.v === 'none'
export function asQ(v: Value, what = 'a quantity'): QV {
  if (v.v !== 'q') throw new Error(`evaluate: expected ${what}, got ${v.v}`)
  return v
}
const EPS = 1e-9
/** Canonical numbers compare with a relative tolerance, so 0.1 + 0.2 = 0.3.
 *  Identical numbers (equal infinities included) are equal. The tolerance is
 *  not transitive (a ≈ b and b ≈ c do not give a ≈ c); every caller compares
 *  two operands once, so evaluation stays a function of its inputs (L2). */
export const cmpNum = (a: number, b: number) =>
  a === b ? 0 : !Number.isFinite(a) || !Number.isFinite(b) ? (a < b ? -1 : 1) : Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b)) ? 0 : a < b ? -1 : 1
/** Assisted bodyweight logs the ASSISTANCE as its load, so less is better:
 *  the one rule the verdict, the event reads, the performed former and live
 *  resolution share (F7). */
export const assistedLoad = (metric: string, logging: LoggingType | null | undefined) => metric === 'load' && logging === 'assisted_bodyweight'
const fromLit = (l: Extract<Extract<Term, { k: 'lit' }>['lit'], { k: 'q' }>): QV => qv(l.v, litDim(l.unit, l.per), l.unit, { ...(l.per ? { per: l.per } : {}), ...(l.notation ? { notation: l.notation } : {}) })

/** Structural equality of values, numbers to the canonical tolerance. Map and
 *  record keys are compared as sets; the order of a list matters. */
export function sameValue(a: Value, b: Value): boolean {
  if (a.v === 'none' || b.v === 'none') return a.v === b.v
  if (a.v !== b.v) return false
  const j = (x: unknown, y: unknown): boolean => {
    if (typeof x === 'number' && typeof y === 'number') return cmpNum(x, y) === 0
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => j(v, y[i]))
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const kx = Object.keys(x).filter((k) => !['unit', 'per', 'notation', 'dim', 'clock'].includes(k) && (x as Record<string, unknown>)[k] !== undefined)
      const ky = Object.keys(y).filter((k) => !['unit', 'per', 'notation', 'dim', 'clock'].includes(k) && (y as Record<string, unknown>)[k] !== undefined)
      return kx.length === ky.length && kx.every((k) => j((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]))
    }
    return x === y
  }
  if (a.v === 'map' && b.v === 'map') {
    const mb = new Map(b.entries)
    return a.entries.length === b.entries.length && a.entries.every(([k, v]) => mb.has(k) && sameValue(v, mb.get(k)!))
  }
  return j(a, b)
}

// ── the context ──────────────────────────────────────────────────────────────

/** Event reads with their keys already evaluated. */
export type EventRead =
  | Exclude<Extract<Term, { k: 'event' }>['q'], { q: 'trained' }>
  | { q: 'trained'; muscle: string }
export type AggRead = { q: 'slotsFor'; muscle: string } | { q: 'weekly'; metric: string; by: { k: 'slot' | 'muscle'; id: string } | { k: 'tag'; tag: string } }

/** World reads. A port absent from a context means its capability is not
 *  granted there; the checker guarantees no term reaches for it. */
export interface Ports {
  self(field: string): Value
  peer(slot: string, field: string, of: 'current' | 'prevPhase'): Value
  program(field: string): Value
  fact(fact: string, key: string | null): Value
  pos(field: 'week' | 'trainWeek' | 'role' | 'slotSession'): Value
  cal(q: CalQuery): Value
  /** The logged sets of the latest issued step with this id. */
  performed(step: string): PerformedSet[]
  /** The issued (or resolved) targets of the latest issued step with this id. */
  prescribed(step: string): IssuedTarget[] | null
  event(q: EventRead): Value
  agg(q: AggRead): Value
  keys(of: 'slots' | 'muscles'): Value[]
}

export interface Ctx {
  reg: Registry
  params: Record<string, Value>
  ports: Partial<Ports>
  vars: ReadonlyMap<string, Value>
  enums: Readonly<Record<string, readonly string[]>>
  /** Definitions not (yet) in the registry, by key: a definition whose
   *  examples are being run at publication. */
  extraFns?: ReadonlyMap<string, FnDef>
  /** The publication seq of the definition whose body is being evaluated:
   *  `app` may only enter a definition published BEFORE it, so evaluation is
   *  total even over a registry holding a definition its check refused. */
  seq?: number
  /** Resolution: the non-live reads captured when the field was issued. */
  frame?: Frame
  /** The unit each metric displays in (the program's grids), so a logged
   *  value reads in the program's units in a trace. */
  display?: Readonly<Partial<Record<string, Unit>>>
  /** The metrics the enclosing session's exercise logs, when known. */
  logs?: readonly string[] | null
  /** The enclosing session's exercise logging type, when known. */
  logging?: LoggingType | null
  /** Issue-time capture: told every non-live read with its closed key. */
  record?: (key: string, value: Value) => void
}

export function ctxOf(reg: Registry, over: Partial<Ctx> = {}): Ctx {
  return { reg, params: {}, ports: {}, vars: new Map(), enums: enumsWith(), ...over }
}
const port = <K extends keyof Ports>(cx: Ctx, k: K): Ports[K] => {
  const p = cx.ports[k]
  if (!p) throw new Error(`evaluate: no '${k}' read is available at this position`)
  return p as Ports[K]
}

/** The non-live reads: served by a port at issue, and from the field's frame
 *  at resolution (the live context grants only performed and prescribed). */
const READS = new Set(['param', 'self', 'peer', 'program', 'fact', 'pos', 'cal', 'keys'])
/** A read node CLOSED over its variables: each `var` replaced by the value it
 *  has where the read runs, as canonical JSON. The key a frame stores the
 *  read under, so the same node under a different binding (a shadowing let,
 *  an iteration) is a different read (F2). */
export function closedKey(t: Term, lookup: (name: string) => Value | undefined): string {
  const close = (x: unknown): unknown => {
    if (!x || typeof x !== 'object') return x
    if (Array.isArray(x)) return x.map(close)
    const n = x as Record<string, unknown>
    if (n['k'] === 'var' && typeof n['name'] === 'string') {
      const v = lookup(n['name'])
      return v ? { k: 'val', v } : n
    }
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, close(v)]))
  }
  return canonicalJson(close(t))
}
const lookupIn = (cx: Ctx) => (name: string) => cx.vars.get(name) ?? cx.frame?.vars[name]

export function fnOf(cx: Ctx, d: DefRef): FnDef {
  const k = keyOf(d)
  const f = cx.extraFns?.get(k) ?? cx.reg.fns.get(k)
  if (!f) throw new Error(`evaluate: ${k} is not published`)
  return f
}

// ── fields: a bound, evaluated, as the sink will issue it ────────────────────

/** Every node of a term, depth first. */
export function* nodesOf(t: unknown): Generator<Term> {
  if (!t || typeof t !== 'object') return
  const n = t as Term
  if (typeof n.k === 'string') yield n
  for (const v of Object.values(n)) if (v && typeof v === 'object') yield* nodesOf(v)
}
const boundTerms = (b: BoundIR): Term[] => (b.b === 'range' ? [b.min, b.max] : b.b === 'open' ? [] : [b.v])

/** The steps a live term depends on: every performed read, and every
 *  prescribed read of a field that is itself open. */
function liveDeps(terms: Term[], cx: Ctx): string[] {
  const out = new Set<string>()
  for (const t of terms)
    for (const n of nodesOf(t)) {
      if (n.k === 'performed') out.add(n.step)
      if (n.k === 'prescribed') for (const tg of cx.ports.prescribed?.(n.step) ?? []) for (const fd of Object.values(tg.metrics)) if (fd?.k === 'open') fd.dependsOn.forEach((d) => out.add(d))
    }
  return [...out]
}

/** The direct subterms of a node (binders' bodies included), for the walk below. */
function childTerms(t: Term): Term[] {
  const terms = (xs: readonly (Term | null | undefined)[]) => xs.filter((x): x is Term => !!x)
  switch (t.k) {
    case 'set':
      return terms([...Object.values(t.target).flatMap(boundTerms), t.rest, t.tempo, t.cluster?.per, t.cluster?.intraRest])
    case 'session':
      return terms([t.exercise, t.intensifier, ...t.steps.flatMap((s) => (s.k === 'repeat' ? s.body : [s])).flatMap((s) => [s.target, ...(s.count.k === 'n' ? [s.count.n] : s.count.k === 'range' ? [s.count.min, s.count.max] : [s.count.k === 'until' ? s.count.stop : s.count.go])])])
    case 'table':
      return terms([t.key, ...t.rows.map((r) => r.then), t.otherwise])
    case 'app':
      return Object.values(t.args)
    case 'patch':
      return Object.values(t.set).map((f) => f.to)
    case 'list':
      return t.items
    case 'match':
      return [t.on, ...Object.values(t.cases)]
    case 'technique':
      return t.stages
    case 'fact':
      return terms([t.key])
    case 'event':
      return t.q.q === 'trained' ? [t.q.muscle] : []
    case 'agg':
      return t.q.q === 'slotsFor' ? [t.q.muscle] : t.q.by.k === 'tag' ? [] : [t.q.by.of]
    case 'named':
      return [t.e]
    case 'xform':
      return terms([t.s, t.arg])
    default:
      return Object.values(t).filter((v): v is Term => !!v && typeof v === 'object' && typeof (v as { k?: unknown }).k === 'string')
  }
}

/**
 * Capture what an open field's terms read that the live context cannot
 * serve (F2). Resolution re-evaluates the SAME terms against the logged sets,
 * so the frame must hold every non-live read any evaluation of them can make.
 * The walk carries the binders in scope, each with its value when it does not
 * depend on a logged set (null when it does):
 *  - a subterm that reads no logged set and no live binder evaluates the same
 *    at issue and at resolution, so it is evaluated now and every read it
 *    makes is recorded under its closed key (canonical JSON of the read node
 *    with its variables replaced by their values);
 *  - otherwise its children are walked: a binder over a static value binds
 *    that value, an iteration over a static list walks its body once per item,
 *    and a static condition (`if`, `match`, `logic`, `orElse`, `known`) walks
 *    only the branch resolution will take; a live condition walks both.
 * The one read this cannot capture is a fact whose KEY depends on a logged
 * set; the checker refuses that in a live position (capabilityEscape), so no
 * checkable program can make resolution reach for a port it lacks.
 */
export function captureFrame(terms: Term[], cx: Ctx): Frame {
  const reads: Record<string, Value> = {}
  const vars: Record<string, Value> = {}
  for (const t of terms) for (const n of nodesOf(t)) if (n.k === 'var' && cx.vars.has(n.name)) vars[n.name] = cx.vars.get(n.name)!
  type Env = ReadonlyMap<string, Value | null>
  const record = (key: string, v: Value) => void (reads[key] = v)
  const isStatic = (t: Term, env: Env) => [...nodesOf(t)].every((n) => n.k !== 'performed' && n.k !== 'prescribed' && !(n.k === 'var' && env.get(n.name) === null))
  const run = (t: Term, env: Env): Value => evaluate(t, { ...cx, vars: new Map([...cx.vars, ...([...env].filter(([, v]) => v !== null) as [string, Value][])]), record }).value
  const bind = (env: Env, name: string, src: Term): Env => new Map([...env, [name, isStatic(src, env) ? run(src, env) : null]])
  const each = (xs: Term, env: Env, names: string[], body: Term[]) => {
    const items = isStatic(xs, env) ? run(xs, env) : null
    if (items?.v === 'list') for (const x of items.items) for (const b of body) walk(b, new Map([...env, ...names.map((n, i) => [n, i === 0 ? x : null] as const)]))
    else for (const b of body) walk(b, new Map([...env, ...names.map((n) => [n, null] as const)]))
  }
  const walk = (t: Term, env: Env): void => {
    if (isStatic(t, env)) return void run(t, env)
    const decided = (c: Term) => (isStatic(c, env) ? run(c, env) : null)
    switch (t.k) {
      case 'let':
        walk(t.value, env)
        return walk(t.body, bind(env, t.name, t.value))
      case 'known': {
        walk(t.a, env)
        const a = decided(t.a)
        if (a && isNone(a)) return
        return walk(t.body, bind(env, t.as, t.a))
      }
      case 'if': {
        const c = decided(t.c)
        if (c) return walk(c.v === 'bool' && c.b ? t.a : t.b, env)
        return [t.c, t.a, t.b].forEach((x) => walk(x, env))
      }
      case 'match': {
        const on = decided(t.on)
        const arm = on?.v === 'enum' ? t.cases[on.tag] : undefined
        if (arm) return walk(arm, env)
        return [t.on, ...Object.values(t.cases)].forEach((x) => walk(x, env))
      }
      case 'logic': {
        const a = decided(t.a)
        walk(t.a, env)
        if (a && a.v === 'bool' && a.b === (t.op === 'or')) return
        return walk(t.b, env)
      }
      case 'orElse': {
        const a = decided(t.a)
        walk(t.a, env)
        if (a && !isNone(a)) return
        return walk(t.b, env)
      }
      case 'fold':
        walk(t.init, env)
        walk(t.xs, env)
        return each(t.xs, env, [t.x, t.acc], [t.step])
      case 'tabulate':
        walk(t.keys, env)
        return each(t.keys, env, [t.as], [t.body])
      case 'sum':
        walk(t.xs, env)
        return each(t.xs, env, [t.as], [t.body])
      case 'count':
        walk(t.xs, env)
        return each(t.xs, env, [t.as], [t.where])
      case 'pick':
        walk(t.xs, env)
        return each(t.xs, env, [t.as], t.where ? [t.where, t.score] : [t.score])
      case 'allocate':
        ;[t.n, t.into, t.among].forEach((x) => walk(x, env))
        return each(t.among, env, [t.as], [t.score, t.cap])
      default:
        return childTerms(t).forEach((x) => walk(x, env))
    }
  }
  for (const t of terms) walk(t, new Map())
  return { vars, reads }
}

const edge = (v: Value): number | Absence => (v.v === 'none' ? v.cause : asQ(v).n)
function fieldOf(b: BoundIR, cx: Ctx, kids: Trace[]): Extract<Field, { k: 'fixed' | 'silent' }> {
  const ev = (t: Term) => {
    const r = evaluate(t, cx)
    kids.push(r)
    return edge(r.value)
  }
  const fixed = (v: IssuedBound): Extract<Field, { k: 'fixed' }> => ({ k: 'fixed', v })
  switch (b.b) {
    case 'open':
      return fixed({ b: 'open' })
    case 'range': {
      const [lo, hi] = [ev(b.min), ev(b.max)]
      if (typeof lo !== 'number') return { k: 'silent', cause: lo }
      if (typeof hi !== 'number') return { k: 'silent', cause: hi }
      return fixed({ b: 'range', min: lo, max: hi })
    }
    default: {
      const v = ev(b.v)
      return typeof v === 'number' ? fixed({ b: b.b, v }) : { k: 'silent', cause: v }
    }
  }
}
/** A bound becomes a field: OPEN when it reads a performed set (it is
 *  resolved live, and `planned` is its asPrescribed value), else fixed or
 *  silent with the cause of its absence. */
export function boundField(b: BoundIR, cx: Ctx, kids: Trace[]): Field {
  const planned = fieldOf(b, cx, kids)
  if (cx.frame) return planned
  const deps = liveDeps(boundTerms(b), cx)
  return deps.length ? { k: 'open', bound: b, frame: captureFrame(boundTerms(b), cx), planned, dependsOn: deps } : planned
}

/** A metric's dimension and the unit it reads in: the display unit where
 *  the program has one (its grid's unit), else the first unit of its dimension. */
export function metricQ(n: number, metric: string, cx: Pick<Ctx, 'reg' | 'display'>): QV {
  const d = cx.reg.vocab.metrics[metric]
  const dim = d ? DIMS[d.dim] : {}
  return qv(n, dim, cx.display?.[metric] ?? (d ? (unitFor(dim) ?? null) : null))
}
/** A field's edge as a value: what `prescribed` reads, in the metric's
 *  dimension and display unit (F11). */
export function edgeOf(fd: Field | undefined, edgeK: 'floor' | 'top', step: string, metric: string, live: boolean, cx: Pick<Ctx, 'reg' | 'display'>): Value {
  if (!fd) return none({ k: 'notTargeted', step, metric })
  if (fd.k === 'silent') return none(fd.cause)
  if (fd.k === 'open') return live ? none({ k: 'notPerformed', step: fd.dependsOn[0] ?? step }) : edgeOf(fd.planned, edgeK, step, metric, live, cx)
  const b = fd.v
  const n = b.b === 'open' ? null : b.b === 'range' ? (edgeK === 'floor' ? b.min : b.max) : b.v
  return n === null ? none({ k: 'notTargeted', step, metric }) : metricQ(n, metric, cx)
}
/** The value a set would be logged at if it went exactly as prescribed: the
 *  floor of every fixed bound (an open field's planned floor). */
export function asPrescribedSet(t: IssuedTarget): PerformedSet {
  const values: Record<string, number> = {}
  for (const [m, fd] of Object.entries(t.metrics)) {
    const f = fd?.k === 'open' ? fd.planned : fd
    if (f?.k !== 'fixed' || f.v.b === 'open') continue
    values[m] = f.v.b === 'range' ? f.v.min : f.v.v
  }
  return { values, stages: null }
}

// ── the evaluator ────────────────────────────────────────────────────────────

const ROLE_SETS = new Set(['warmup', 'working', 'backoff', 'amrap', 'test', 'recovery'])

export function evaluate(t: Term, cx: Ctx): Trace {
  const kids: Trace[] = []
  const sub = (x: Term, c: Ctx = cx): Value => {
    const r = evaluate(x, c)
    kids.push(r)
    return r.value
  }
  const out = (value: Value, extra: Partial<Trace> = {}): Trace => ({ node: t, value, kids, ...extra })
  const bindV = (name: string, v: Value, c: Ctx = cx): Ctx => ({ ...c, vars: new Map([...c.vars, [name, v]]) })
  const listItems = (v: Value): Value[] => (v.v === 'list' ? v.items : [])
  const idOf = (v: Value): string => (v.v === 'ref' ? v.id : v.v === 'enum' ? v.tag : v.v === 'q' ? String(v.n) : JSON.stringify(v))

  if (cx.frame && READS.has(t.k)) {
    const hit = cx.frame.reads[closedKey(t, lookupIn(cx))]
    if (hit) return out(hit)
  }
  /** A non-live read's value, told to an issue-time capture. */
  const read = (value: Value): Trace => {
    cx.record?.(closedKey(t, lookupIn(cx)), value)
    return out(value)
  }

  switch (t.k) {
    // ── core ────────────────────────────────────────────────────────────────
    case 'lit': {
      const l = t.lit
      switch (l.k) {
        case 'q':
          return out(fromLit(l))
        case 'bool':
          return out(bool(l.v))
        case 'ord':
          return out({ v: 'ord', scale: l.scale, level: l.level })
        case 'enum':
          return out({ v: 'enum', name: l.name, tag: l.tag })
        case 'ref':
          return out({ v: 'ref', kind: l.kind, id: l.id })
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'var': {
      const v = cx.vars.get(t.name) ?? cx.frame?.vars[t.name]
      if (!v) throw new Error(`evaluate: unbound variable ${t.name}`)
      return out(v)
    }
    case 'let': {
      const v = sub(t.value)
      return out(sub(t.body, bindV(t.name, v)))
    }
    case 'named':
      return out(sub(t.e))
    case 'if': {
      const c = sub(t.c)
      return out(sub(c.v === 'bool' && c.b ? t.a : t.b))
    }
    case 'match': {
      const on = sub(t.on)
      const tag = on.v === 'enum' ? on.tag : ''
      const arm = t.cases[tag]
      if (!arm) throw new Error(`evaluate: match has no arm ${tag}`)
      return out(sub(arm))
    }
    // ── quantity ────────────────────────────────────────────────────────────
    case 'arith': {
      const a = asQ(sub(t.a))
      const b = asQ(sub(t.b))
      const clock = a.clock ?? b.clock
      const keepClock = clock ? { clock } : {}
      if (t.op === '*') {
        const dim = dimOp(a.dim, b.dim, 1)
        const keep = dimEq(b.dim, {}) ? a : dimEq(a.dim, {}) ? b : null
        const n = a.n * b.n
        if (keep && keep.unit) return out(qv(n, keep.dim, keep.unit, { ...(keep.per ? { per: keep.per } : {}), ...keepClock }))
        return out(qv(n, dim, unitFor(dim, [a.unit, b.unit].filter((u): u is Unit => !!u), n), keepClock))
      }
      const n = t.op === '+' ? a.n + b.n : t.op === '-' ? a.n - b.n : t.op === 'min' ? Math.min(a.n, b.n) : Math.max(a.n, b.n)
      const shown = a.unit ? a : b
      // The checker makes both sides one dimension; only the empty sum's
      // dimensionless zero differs, and it takes its partner's (P5).
      const dim = dimEq(a.dim, {}) ? b.dim : a.dim
      return out(qv(n, dim, shown.unit, { ...(shown.per ? { per: shown.per } : {}), ...keepClock }))
    }
    case 'cmp': {
      const a = sub(t.a)
      const b = sub(t.b)
      let c: number
      if (a.v === 'q' && b.v === 'q') c = cmpNum(a.n, b.n)
      else if (a.v === 'ord' && b.v === 'ord') c = Math.sign(a.level - b.level)
      else if (a.v === 'enum' && b.v === 'enum') return out(bool(t.op === '==' ? a.tag === b.tag : false))
      else throw new Error(`evaluate: cannot compare ${a.v} with ${b.v}`)
      const r = { '<': c < 0, '<=': c <= 0, '==': c === 0, '>=': c >= 0, '>': c > 0 }[t.op]
      return out(bool(r))
    }
    case 'logic': {
      const a = sub(t.a)
      const ab = a.v === 'bool' && a.b
      // Short-circuit: the right side is not read when the left decides.
      if (t.op === 'and' && !ab) return out(bool(false))
      if (t.op === 'or' && ab) return out(bool(true))
      const b = sub(t.b)
      return out(bool(b.v === 'bool' && b.b))
    }
    case 'not': {
      const a = sub(t.a)
      return out(bool(!(a.v === 'bool' && a.b)))
    }
    case 'round': {
      const a = asQ(sub(t.a))
      const s = asQ(sub(t.step)).n
      if (!(s > 0)) return out(a, { note: `step ${s} is not positive: left unrounded` })
      return out({ ...a, n: (t.mode === 'nearest' ? nearestStep : t.mode === 'down' ? stepDown : stepUp)(a.n, s) })
    }
    case 'ratio': {
      const a = asQ(sub(t.a))
      const b = asQ(sub(t.b))
      if (cmpNum(b.n, 0) === 0) return out(none({ k: 'zeroDenominator' }))
      const clock = a.clock ?? b.clock
      return out(qv(a.n / b.n, {}, 'x', clock ? { clock } : {}))
    }
    // ── absence ─────────────────────────────────────────────────────────────
    case 'some':
      return out(sub(t.a))
    case 'none':
      return out(none({ k: 'declaredNone' }))
    case 'known': {
      const a = sub(t.a)
      if (isNone(a)) return out(a)
      return out(sub(t.body, bindV(t.as, a)))
    }
    case 'orElse': {
      const a = sub(t.a)
      return out(isNone(a) ? sub(t.b) : a)
    }
    case 'asReps': {
      const a = asQ(sub(t.a))
      return out(qv(a.n, DIMS.reps, 'rep'))
    }
    // ── finite collections ──────────────────────────────────────────────────
    case 'list':
      return out({ v: 'list', items: t.items.map((x) => sub(x)) })
    case 'nth': {
      const xs = listItems(sub(t.xs))
      const i = floorQ(asQ(sub(t.i)).n)
      const len = xs.length
      // Unreachable from a checked definition (nth needs a non-empty list);
      // typed absence, never an undefined value, if a boundary lets one in (F1).
      if (!len) return out(none({ k: 'emptyPick' }), { note: 'the list is empty' })
      const j = t.overflow === 'hold' ? Math.min(Math.max(i, 0), len - 1) : ((i % len) + len) % len
      return out(xs[j]!, i !== j ? { note: `index ${i} ${t.overflow === 'hold' ? 'held' : 'cycled'} to ${j}` } : {})
    }
    case 'fold': {
      let acc = sub(t.init)
      for (const x of listItems(sub(t.xs))) acc = sub(t.step, bindV(t.x, x, bindV(t.acc, acc)))
      return out(acc)
    }
    case 'tabulate': {
      const ks = listItems(sub(t.keys))
      if (t.keys.k === 'range') return out({ v: 'list', items: ks.map((k) => sub(t.body, bindV(t.as, k))) })
      return out({ v: 'map', entries: ks.map((k) => [idOf(k), sub(t.body, bindV(t.as, k))] as [string, Value]) })
    }
    case 'at': {
      const m = sub(t.m)
      const k = idOf(sub(t.key))
      const hit = m.v === 'map' ? m.entries.find(([x]) => x === k) : undefined
      return out(hit ? hit[1] : none({ k: 'missingKey', key: k }))
    }
    case 'keys': {
      if (t.of.startsWith('enum:')) {
        const name = t.of.slice(5)
        return read({ v: 'list', items: (cx.enums[name] ?? []).map((tag) => ({ v: 'enum', name, tag })) })
      }
      return read({ v: 'list', items: port(cx, 'keys')(t.of as 'slots' | 'muscles') })
    }
    case 'range':
      return out({ v: 'list', items: Array.from({ length: t.n }, (_, i) => qv(i, {}, 'x')) })
    case 'sum': {
      const xs = listItems(sub(t.xs)).map((x) => asQ(sub(t.body, bindV(t.as, x))))
      return out(xs.length ? { ...xs[0]!, n: xs.reduce((a, b) => a + b.n, 0) } : qv(0, {}, null))
    }
    case 'count': {
      let n = 0
      for (const x of listItems(sub(t.xs))) {
        const w = sub(t.where, bindV(t.as, x))
        if (w.v === 'bool' && w.b) n++
      }
      return out(qv(n, {}, 'x'))
    }
    case 'pick': {
      let best: { x: Value; s: number } | null = null
      for (const x of listItems(sub(t.xs))) {
        const inner = bindV(t.as, x)
        if (t.where) {
          const w = sub(t.where, inner)
          if (!(w.v === 'bool' && w.b)) continue
        }
        const sv = sub(t.score, inner)
        // An absent score never ranks (unreachable from a checked definition).
        if (sv.v !== 'q' && sv.v !== 'ord') continue
        const s = sv.v === 'q' ? sv.n : sv.level
        // Ties keep the earlier element (declaration order, L2).
        if (!best || (t.mode === 'max' ? cmpNum(s, best.s) > 0 : cmpNum(s, best.s) < 0)) best = { x, s }
      }
      return out(best ? best.x : none({ k: 'emptyPick' }))
    }
    case 'allocate':
      return allocate(t)
    // ── tables ──────────────────────────────────────────────────────────────
    case 'table': {
      const key = sub(t.key)
      const pick = (): Term | null => {
        if (t.rows.every((r) => r.when === null)) {
          const i = floorQ(asQ(key).n)
          const len = t.rows.length
          const j = t.overflow === 'cycle' ? ((i % len) + len) % len : Math.min(Math.max(i, 0), len - 1)
          return t.rows[j]!.then
        }
        if (key.v === 'ord') return t.rows.find((r) => Number(r.when) === key.level)?.then ?? null
        if (key.v === 'enum') return t.rows.find((r) => r.when === key.tag)?.then ?? null
        if (key.v === 'ref') return t.rows.find((r) => r.when === key.id)?.then ?? t.otherwise
        const n = asQ(key).n
        return t.rows.find((r) => typeof r.when === 'object' && r.when && r.when.k === 'q' && cmpNum(n, r.when.v) <= 0)?.then ?? t.otherwise
      }
      if (!t.rows.length) return out(none({ k: 'emptyPick' }), { note: 'the table has no rows' })
      const arm = pick()
      if (!arm) throw new Error('evaluate: table has no row for its key')
      return out(sub(arm))
    }
    // ── reuse ───────────────────────────────────────────────────────────────
    case 'app': {
      const f = fnOf(cx, t.def)
      const seq = cx.reg.seq.get(keyOf(t.def)) ?? cx.reg.seq.size
      if (cx.seq !== undefined && seq >= cx.seq) throw new Error(`evaluate: ${keyOf(t.def)} is not published before its caller (L1: no recursion)`)
      const params = Object.fromEntries(Object.entries(t.args).map(([k, x]) => [k, sub(x)]))
      const body = evaluate(f.body, { reg: cx.reg, params, ports: {}, vars: new Map(), enums: enumsWith(f.enums), seq, ...(cx.extraFns ? { extraFns: cx.extraFns } : {}) })
      kids.push(body)
      return out(body.value, { def: t.def })
    }
    // ── context reads ───────────────────────────────────────────────────────
    case 'param': {
      const v = cx.params[t.name]
      if (!v) throw new Error(`evaluate: no parameter ${t.name}`)
      return read(v)
    }
    case 'self':
      return read(port(cx, 'self')(t.field))
    case 'peer':
      return read(port(cx, 'peer')(t.slot, t.field, t.of))
    case 'program':
      return read(port(cx, 'program')(t.field))
    case 'fact':
      return read(port(cx, 'fact')(t.fact, t.key ? idOf(sub(t.key)) : null))
    case 'pos':
      return read(port(cx, 'pos')(t.field))
    case 'cal':
      return read(port(cx, 'cal')(t.q))
    case 'performed':
      return out(performedRead(port(cx, 'performed')(t.step), t.step, t.metric, t.pick, cx, assistedLoad(t.metric, cx.logging)))
    case 'prescribed': {
      const sets = port(cx, 'prescribed')(t.step)
      return out(sets?.length ? edgeOf(sets[0]!.metrics[t.metric], t.edge, t.step, t.metric, !!cx.frame, cx) : none({ k: 'notPerformed', step: t.step }))
    }
    case 'event': {
      const q = t.q
      return out(port(cx, 'event')(q.q === 'trained' ? { q: 'trained', muscle: idOf(sub(q.muscle)) } : q))
    }
    case 'agg': {
      const q = t.q
      if (q.q === 'slotsFor') return out(port(cx, 'agg')({ q: 'slotsFor', muscle: idOf(sub(q.muscle)) }))
      const by = q.by.k === 'tag' ? q.by : { k: q.by.k, id: idOf(sub(q.by.of)) }
      return out(port(cx, 'agg')({ q: 'weekly', metric: q.metric, by }))
    }
    // ── domain formers ──────────────────────────────────────────────────────
    case 'set': {
      const metrics: IssuedTarget['metrics'] = {}
      for (const [m, b] of Object.entries(t.target)) metrics[m] = boundField(b, cx, kids)
      const restSec = t.rest ? asQ(sub(t.rest)).n : null
      const tempo = t.tempo ? tempoOf(sub(t.tempo)) : null
      const cluster = t.cluster ? { per: asQ(sub(t.cluster.per)).n, intraRestSec: asQ(sub(t.cluster.intraRest)).n } : null
      if (!ROLE_SETS.has(t.role)) throw new Error(`evaluate: no set role ${t.role}`)
      return out({ v: 'set', t: { role: t.role, metrics, restSec, tempo, cluster } })
    }
    case 'session':
      return session(t)
    case 'xform': {
      const s = sub(t.s)
      if (s.v !== 'session') throw new Error('evaluate: xform needs a session')
      const arg = t.arg ? sub(t.arg) : null
      const ex = s.s.exercise
      const logs = ex.v === 'ref' ? loggedBy(cx, ex.id) : null
      const argLogs = arg?.v === 'ref' && arg.kind === 'exercise' ? loggedBy(cx, arg.id) : null
      const grow = t.op === 'scaleSets' && arg?.v === 'q' && arg.n > 1 ? { note: `a factor of ${arg.n} above 1 leaves the sets as they are: a count never grows past its targets (growth is addSets)` } : {}
      return out({ v: 'session', s: applyXform(t.op, s.s, arg, t.metric, logs, argLogs) }, grow)
    }
    case 'technique':
      return out({ v: 'technique', t: { kind: t.kind, stages: t.stages.map((x) => (sub(x) as Extract<Value, { v: 'set' }>).t) } })
    case 'tempo':
      return out({ v: 'tempo', t: [t.ecc, t.pause, t.con, t.top] })
    // ── the transition outcome ──────────────────────────────────────────────
    case 'patch':
      return out({ v: 'patch', fields: Object.fromEntries(Object.entries(t.set).map(([f, p]) => [f, { value: sub(p.to), mode: p.mode }])) })
  }

  // allocate's NORMATIVE semantics (algebra.ts), plus the R2 domain decisions:
  // n is floored and clamped at 0; a candidate missing from `into` starts at 0;
  // a negative score still ranks (a score orders, a cap gates).
  function allocate(a: Extract<Term, { k: 'allocate' }>): Trace {
    const n = asQ(sub(a.n)).n
    const into = sub(a.into)
    const among = listItems(sub(a.among))
    const units = Math.max(0, floorQ(n))
    const given = new Map<string, number>()
    const scored = among.map((x) => {
      const inner = bindV(a.as, x)
      // A cap is a whole number of units, floored with the floor tolerance (P4).
      return { id: idOf(x), score: asQ(sub(a.score, inner)).n, cap: floorQ(asQ(sub(a.cap, inner)).n) }
    })
    let placed = 0
    for (let u = 0; u < Math.min(units, a.max); u++) {
      let best: (typeof scored)[number] | null = null
      for (const c of scored) if ((given.get(c.id) ?? 0) < c.cap && (!best || cmpNum(c.score, best.score) > 0)) best = c
      if (!best) break
      given.set(best.id, (given.get(best.id) ?? 0) + 1)
      placed++
    }
    const base: [string, Value][] = into.v === 'map' ? into.entries : []
    const entries: [string, Value][] = base.map(([k, v]) => [k, given.has(k) ? { ...asQ(v), n: asQ(v).n + given.get(k)! } : v])
    for (const [k, g] of given) if (!base.some(([x]) => x === k)) entries.push([k, qv(g, DIMS.sets, 'set')])
    const dropped = units - placed
    const frac = Math.max(0, n) - units
    const notes = [
      `${placed} of ${units} set${units === 1 ? '' : 's'} placed`,
      ...(units > a.max ? [`${units - a.max} over the bound of ${a.max}`] : []),
      ...(dropped > 0 ? [`${dropped} could not be placed`] : []),
      ...(frac > EPS ? [`a fraction of ${Number(frac.toFixed(3))} set dropped`] : []),
    ]
    return out({ v: 'map', entries }, { note: notes.join('; ') })
  }

  // The telescope. Counts are plan positions; targets may read EARLIER steps
  // (prescribed: their issued bound; performed: in planning, their
  // asPrescribed sets). An until/while step issues `max` set slots, each
  // target planned against the slots before it, and its condition.
  function session(s: Extract<Term, { k: 'session' }>): Trace {
    const exercise = sub(s.exercise)
    const logs = exercise.v === 'ref' ? loggedBy(cx, exercise.id) : null
    const logging = exercise.v === 'ref' ? (cx.reg.vocab.exercises[exercise.id]?.logging ?? null) : null
    const steps: IssuedStep[] = []
    const latest = (id: string) => [...steps].reverse().find((x) => x.id === id)
    const inner = (own: { id: string; sets: IssuedTarget[] } | null): Ctx => ({
      ...cx,
      logs,
      logging,
      ports: {
        ...cx.ports,
        prescribed: (id) => (own && own.id === id ? own.sets : (latest(id)?.sets ?? null)),
        performed: (id) => {
          if (own && own.id === id) return own.sets.map(asPrescribedSet)
          const st = latest(id)
          return st ? st.sets.slice(0, plannedCount(st)).map(asPrescribedSet) : []
        },
      },
    })
    const count = (c: Extract<StepIR, { k: 'step' }>['count']): number[] => {
      if (c.k === 'n') return [Math.max(0, floorQ(asQ(sub(c.n, inner(null))).n))]
      if (c.k === 'range') {
        // An evaluated range whose min is above its max issues its max as
        // both edges, so the count, its slots and volume agree (F13); a
        // literal one is refused at check (literalDomain).
        const [lo, hi] = [Math.max(0, floorQ(asQ(sub(c.min, inner(null))).n)), Math.max(0, floorQ(asQ(sub(c.max, inner(null))).n))]
        return [Math.min(lo, hi), hi]
      }
      return [c.max]
    }
    const issue = (st: Extract<StepIR, { k: 'step' }>, block: IssuedStep['block']) => {
      const key = block ? `${st.id}@${block.iteration}` : st.id
      const c = st.count
      if (c.k === 'n' || c.k === 'range') {
        const ns = count(c)
        const target = (sub(st.target, inner(null)) as Extract<Value, { v: 'set' }>).t
        const slots = ns[ns.length - 1]!
        steps.push({ id: st.id, key, count: c.k === 'n' ? { k: 'n', n: ns[0]! } : { k: 'range', min: ns[0]!, max: ns[1]! }, sets: Array.from({ length: slots }, () => target), block, live: null })
        return
      }
      const own = { id: st.id, sets: [] as IssuedTarget[] }
      let planned = -1
      for (let i = 0; i < c.max; i++) {
        if (c.k === 'while' && planned < 0) {
          const go = sub(c.go, inner(own))
          if (!(go.v === 'bool' && go.b)) planned = i
        }
        own.sets.push((sub(st.target, inner(own)) as Extract<Value, { v: 'set' }>).t)
        if (c.k === 'until' && planned < 0) {
          const stop = sub(c.stop, inner(own))
          if (stop.v === 'bool' && stop.b) planned = i + 1
        }
      }
      const cond = c.k === 'until' ? c.stop : c.go
      steps.push({ id: st.id, key, count: { k: c.k, max: c.max, planned: planned < 0 ? c.max : planned }, sets: own.sets, block, live: { cond, frame: captureFrame([cond], inner(own)) } })
    }
    for (const st of s.steps) {
      if (st.k === 'step') issue(st, null)
      else for (let it = 0; it < st.n; it++) for (const b of st.body) issue(b, { id: st.id, iteration: it })
    }
    const intensifier = s.intensifier ? (sub(s.intensifier, inner(null)) as Extract<Value, { v: 'technique' }>).t : null
    const sv: SessionValue = { exercise, steps, intensifier }
    return out({ v: 'session', s: sv })
  }
}

/** The sets a step expects when it goes as planned: its count, a range's
 *  floor (volume reads the floor), an until/while step's planned count. */
export const plannedCount = (st: IssuedStep) => (st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.min : st.count.planned)

/** The metrics an exercise's logging type produces (the vocabulary decides). */
export function loggedBy(cx: Ctx, exerciseId: string): string[] | null {
  const ex = cx.reg.vocab.exercises[exerciseId]
  if (!ex) return null
  return Object.entries(cx.reg.vocab.metrics)
    .filter(([, d]) => ex.logging in d.loggedBy)
    .map(([m]) => m)
}

/** A metric of logged sets: last | best | worst (absent when nothing was
 *  logged), sum (0 when nothing was), count (the sets logged so far). "Best"
 *  follows the metric's direction, flipped for an assisted load. */
export function performedRead(sets: PerformedSet[], step: string, metric: string, pick: string, cx: Pick<Ctx, 'reg' | 'display'>, assisted = false): Value {
  if (pick === 'count') return qv(sets.length, {}, 'x')
  const d = cx.reg.vocab.metrics[metric]
  const dim = d ? DIMS[d.dim] : {}
  const unit = cx.display?.[metric] ?? (d ? (unitFor(dim) ?? null) : null)
  const xs = sets.map((s) => s.values[metric]).filter((x): x is number => typeof x === 'number')
  if (pick === 'sum') return qv(xs.reduce((a, b) => a + b, 0), dim, unit)
  if (!xs.length) return none({ k: 'notPerformed', step })
  const higher = (d?.better ?? 'higher') === 'higher' !== assisted
  const best = (a: number, b: number) => (higher ? Math.max(a, b) : Math.min(a, b))
  const worst = (a: number, b: number) => (higher ? Math.min(a, b) : Math.max(a, b))
  const n = pick === 'last' ? xs[xs.length - 1]! : pick === 'best' ? xs.reduce(best) : xs.reduce(worst)
  return qv(n, dim, unit)
}

/** Run one FnDef example: the call on its arguments against its `gives`. */
export function runFnExample(reg: Registry, f: FnDef, ex: FnDef['examples'][number]): { ok: boolean; got: Value | string; want: Value } {
  const cx = ctxOf(reg, { extraFns: new Map([[keyOf(f.ref), f]]) })
  const want = evaluate(ex.gives, cx).value
  try {
    const got = evaluate({ k: 'app', def: f.ref, args: ex.args }, cx).value
    return { ok: sameValue(got, want), got, want }
  } catch (e) {
    return { ok: false, got: (e as Error).message.replace(/^evaluate: /, ''), want }
  }
}
