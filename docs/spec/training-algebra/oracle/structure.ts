/**
 * structure.ts — the scopes of a training program, as definitions in the
 * calculus of algebra.ts.
 *
 * ONE MACHINE SHAPE AT EVERY STATEFUL SCOPE. A scheme (slot scope) and a
 * program's aggregate (muscle scope) are both Mealy machines:
 *
 *      state : record of StateDecl            (typed, kinded, writableBy)
 *      init  : params × facts → state         (InitCap)
 *      plan  : state × position → session     (PlanCap / LiveCap; slot scope only)
 *      on[e] : state × event → Upd(state)     (HandlerCap / AggregateCap)
 *
 * Scopes nest: set ⊂ session ⊂ slot ⊂ program ⊂ macro.
 *   set      a metric-keyed target record; may read PERFORMED or PRESCRIBED earlier steps
 *   session  ordered steps and repeat blocks + at most one intensifier (dose law)
 *   slot     owns its state; reads peers' state; reads program fields
 *   program  calendar, rotation, frequency, day groups, policies over plans
 *            and outcomes, the muscle-scope aggregate, typed exports
 *   macro    a sequence of programs with typed state handoff
 *
 * SINGLE-WRITER LAW (L3), DECLARED. Every state field names the handlers that
 * may write it (`writableBy`). Its KIND is DERIVED from its declared sort
 * (mass → load, sets → volume, anything else → plain), never labelled, so a
 * load field cannot be declared out of reach of the cut law.
 */
import {
  type AggregateCap,
  type B,
  type BindCap,
  type CadenceCap,
  type Cap,
  type DefRef,
  type DefId,
  type En,
  type EnumDecl,
  type EnumDecls,
  type Ex,
  type Expr,
  type ExprsC,
  type Fn,
  type HandlerCap,
  type HandoffCap,
  type InitCap,
  type List,
  type List1,
  type LiveCap,
  type Map_,
  type Opt,
  type PlanCap,
  type PolicyCap,
  type Q,
  type Ref,
  type SessionT,
  type SetT,
  type StepId,
  type StepIR,
  type TechniqueT,
  type TempoT,
  type Template,
  type Term,
  type Ty,
  type TyW,
  type TyWs,
  type Upd,
  type Verdict,
  type PatchField,
  type BoundIR,
  type ReadPick,
  type XformOp,
  type WeeklyBasis,
  type SuccessRule,
  type E1rmFormula,
  type ArgsWith,
  type DefaultOf,
  enumDecls,
  exprOfTerm as E,
} from './algebra'
import { METRIC_DECLS, type Enums, type FactId, type Facts, type LoggingType, type MetricId, type Metrics } from './registry'
import { DEFAULT_LAPSE_DAYS, type AdherenceWeeks, type CalQuery, type Drift, type Frequency, type LocalDay, type Measure, type Period, type Rotation, type Selector } from './time'
import { canonicalStrip, STRIP_DEFAULT, VOLUME_DEFAULTS } from './options'

// ═══════════════════════════════════════════════════════════════════════════
// §1 Set and session formers
// ═══════════════════════════════════════════════════════════════════════════

/** A metric bound in the embedding. A bare Expr is `exactly`. An exact,
 *  range or atMost edge may be absent (Opt): the sink issues it SILENT, with a trace
 *  naming the cause ("no load: Front Squat e1RM unknown"), never a default. */
export type BoundE<T, C extends Cap> =
  | { b: 'exact'; v: Expr<T, C> | Expr<Opt<T>, C> }
  | { b: 'range'; min: Expr<T, C> | Expr<Opt<T>, C>; max: Expr<T, C> | Expr<Opt<T>, C> }
  | { b: 'atLeast'; v: Expr<T, C> }
  | { b: 'atMost'; v: Expr<T, C> | Expr<Opt<T>, C> }
  | { b: 'open' }
export type BoundArg<T, C extends Cap> = BoundE<T, C> | Expr<T, C> | Expr<Opt<T>, C>
/** Overloads, not a union parameter: with a union TS would infer T as the
 *  Opt itself when handed an absent-able value. */
export function exactly<T, C extends Cap = never>(v: Expr<Opt<T>, C>): BoundE<T, C>
export function exactly<T, C extends Cap = never>(v: Expr<T, C>): BoundE<T, C>
export function exactly(v: Expr<unknown, Cap>): BoundE<unknown, Cap> {
  return { b: 'exact', v }
}
export function range<T, C extends Cap = never>(min: Expr<Opt<T>, C>, max: Expr<Opt<T>, C>): BoundE<T, C>
export function range<T, C extends Cap = never>(min: Expr<T, C>, max: Expr<T, C>): BoundE<T, C>
export function range(min: Expr<unknown, Cap>, max: Expr<unknown, Cap>): BoundE<unknown, Cap> {
  return { b: 'range', min, max }
}
export const atLeast = <T, C extends Cap = never>(v: Expr<T, C>): BoundE<T, C> => ({ b: 'atLeast', v })
export function atMost<T, C extends Cap = never>(v: Expr<Opt<T>, C>): BoundE<T, C>
export function atMost<T, C extends Cap = never>(v: Expr<T, C>): BoundE<T, C>
export function atMost(v: Expr<unknown, Cap>): BoundE<unknown, Cap> {
  return { b: 'atMost', v }
}
export const open = <T = never>(): BoundE<T, never> => ({ b: 'open' })
/** As many reps as possible: a reps floor with no ceiling. */
export const amrap = atLeast

const lowerBound = (x: BoundArg<unknown, Cap>): BoundIR => {
  if ('term' in x) return { b: 'exact', v: x.term }
  switch (x.b) {
    case 'exact':
    case 'atLeast':
    case 'atMost':
      return { b: x.b, v: x.v.term }
    case 'range':
      return { b: 'range', min: x.min.term, max: x.max.term }
    case 'open':
      return { b: 'open' }
  }
}

/** A set target. Its capabilities are the union of its fields'; the step that
 *  holds it admits LiveCap, so a target may read earlier steps (APRE). */
export function set<C extends Cap = never, M extends MetricId = never>(spec: {
  role?: Enums['setRole']
  target: { [K in M]: BoundArg<Metrics[K], C> }
  rest?: Expr<Q<'time'>, C>
  tempo?: Expr<TempoT, C>
  cluster?: { per: Expr<Q<'reps'>, C>; intraRest: Expr<Q<'time'>, C> }
}): Expr<SetT<M>, NoInfer<C>> {
  return E({
    k: 'set',
    role: spec.role ?? 'working',
    target: Object.fromEntries(Object.entries(spec.target).map(([m, b]) => [m, lowerBound(b as BoundArg<unknown, Cap>)])),
    rest: spec.rest?.term ?? null,
    tempo: spec.tempo?.term ?? null,
    cluster: spec.cluster ? { per: spec.cluster.per.term, intraRest: spec.cluster.intraRest.term } : null,
  })
}

export const tempo = (ecc: number, pause: number, con: number, top: number): Expr<TempoT> => E({ k: 'tempo', ecc, pause, con, top })
export const technique = <C extends Cap = never>(kind: Extract<Term, { k: 'technique' }>['kind'], ...stages: Expr<SetT, C>[]): Expr<TechniqueT, NoInfer<C>> =>
  E({ k: 'technique', kind, stages: stages.map((s) => s.term) })

/** The metrics a logging type produces, derived from the metric registry so
 *  the embedding and the checker can never disagree about it. For a union
 *  (a ladder mixing bodyweight and loaded rungs) it is the INTERSECTION: a
 *  target may name only what every rung logs. */
export type Logs<L extends LoggingType> = { [M in MetricId]: [L] extends [keyof (typeof METRIC_DECLS)[M]['loggedBy']] ? M : never }[MetricId]

/** A handle on a step: what was performed on it and what was prescribed for
 *  it. Obtainable only by declaring the step, so a forward reference is
 *  unrepresentable (the telescope rule). All reads carry `performed`, which
 *  only live positions grant. */
export interface StepHandle<M extends MetricId> {
  readonly id: StepId
  /** last | best | worst logged value of a metric: absent until logged. */
  read<K extends M>(m: K, pick?: 'last' | 'best' | 'worst'): Expr<Opt<Metrics[K]>, 'performed'>
  /** Running total so far ("reps so far"); 0 before the first set. */
  sum<K extends M>(m: K): Expr<Metrics[K], 'performed'>
  /** Sets logged so far: the 0-based index of the set being targeted. */
  readonly count: Expr<Q<'one'>, 'performed'>
  prescribed<K extends M>(m: K, edge?: 'floor' | 'top'): Expr<Opt<Metrics[K]>, 'performed'>
}
const handle = <M extends MetricId>(id: StepId): StepHandle<M> => {
  const perf = (metric: string, pick: ReadPick) => E<never, 'performed'>({ k: 'performed', step: id, metric, pick })
  return {
    id,
    read: (m, pick = 'last') => perf(m, pick),
    sum: (m) => perf(m, 'sum'),
    count: perf('*', 'count'),
    prescribed: (m, edge = 'floor') => E({ k: 'prescribed', step: id, metric: m, edge }),
  }
}

/** A count range: the athlete chooses within it; volume accounting uses the floor. */
export interface CountRange<C extends Cap> {
  readonly min: Expr<Q<'sets'>, C>
  readonly max: Expr<Q<'sets'>, C>
}
export const setsBetween = <C extends Cap = never>(min: Expr<Q<'sets'>, C>, max: Expr<Q<'sets'>, C>): CountRange<C> => ({ min, max })

type Target<C extends Cap, M extends MetricId> = Expr<SetT<M>, C | 'performed'>
/** C is the session's position grant; M the metrics its exercise logs. A
 *  step's COUNT is a plan position (C); its TARGET is live (C + performed). */
export interface StepBuilder<C extends Cap, M extends MetricId> {
  step(id: string, count: Expr<Q<'sets'>, C> | CountRange<C>, target: Target<C, M>): StepHandle<M>
  /** Post-tested: sets until `stop` holds over this step's own sets, at most
   *  `max` (a literal). The target may read its own earlier sets. */
  stepUntil(id: string, stop: (self: StepHandle<M>) => Expr<B, C | 'performed'>, max: number, target: Target<C, M> | ((self: StepHandle<M>) => Target<C, M>)): StepHandle<M>
  /** Pre-tested: zero sets when `go` is false up front (5/3/1 Jokers). */
  stepWhile(id: string, go: (self: StepHandle<M>) => Expr<B, C | 'performed'>, max: number, target: Target<C, M> | ((self: StepHandle<M>) => Target<C, M>)): StepHandle<M>
  /** A literal-bounded repeat block (run/walk intervals). Reads of a body step
   *  from after the block see its last iteration. */
  repeat(id: string, n: number, body: (b: Pick<StepBuilder<C, M>, 'step'>) => void): void
}


/**
 * DOSE LAW, STRUCTURAL: a session has at most ONE intensifier and it applies
 * to the final set of the last working step. There is no per-set technique
 * field, so "two intensifiers" or "an intensifier on set 2" cannot be built,
 * and a ramp cannot clone it. A cluster on EVERY set is the `cluster` set
 * field, not an intensifier. The sink strips the intensifier in deload, taper
 * and test weeks (L10).
 *
 * `C` defaults to PlanCap and is never inferred (NoInfer). `L` is the
 * exercise's logging type, and it decides which metrics the steps may target.
 */
export function session<C extends Cap = PlanCap, L extends LoggingType = LoggingType>(spec: {
  exercise: Expr<Ex<L>, NoInfer<C>>
  intensifier?: Expr<TechniqueT, NoInfer<C>>
  steps: (b: StepBuilder<C, Logs<L>>) => void
}): Expr<SessionT, NoInfer<C>> {
  const out: StepIR[] = []
  const count = (c: Expr<Q<'sets'>, Cap> | CountRange<Cap>): Extract<StepIR, { k: 'step' }>['count'] =>
    'term' in c ? { k: 'n', n: c.term } : { k: 'range', min: c.min.term, max: c.max.term }
  const tgt = (t: Target<Cap, MetricId> | ((h: StepHandle<MetricId>) => Target<Cap, MetricId>), h: StepHandle<MetricId>) => (typeof t === 'function' ? t(h) : t).term
  const mk = (into: StepIR[]): StepBuilder<C, Logs<L>> => ({
    step(id, c, target) {
      into.push({ k: 'step', id: id as StepId, count: count(c), target: target.term })
      return handle(id as StepId)
    },
    stepUntil(id, stop, max, target) {
      const h = handle<Logs<L>>(id as StepId)
      into.push({ k: 'step', id: id as StepId, count: { k: 'until', stop: stop(h).term, max }, target: tgt(target as never, h as never) })
      return h
    },
    stepWhile(id, go, max, target) {
      const h = handle<Logs<L>>(id as StepId)
      into.push({ k: 'step', id: id as StepId, count: { k: 'while', go: go(h).term, max }, target: tgt(target as never, h as never) })
      return h
    },
    repeat(id, n, body) {
      const inner: StepIR[] = []
      body(mk(inner))
      into.push({ k: 'repeat', id: id as StepId, n, body: inner as Extract<StepIR, { k: 'repeat' }>['body'] })
    },
  })
  spec.steps(mk(out))
  return E({ k: 'session', exercise: spec.exercise.term, steps: out, intensifier: spec.intensifier?.term ?? null })
}

const xf = <C extends Cap>(op: XformOp, s: Expr<SessionT, C>, arg: Expr<unknown, C> | null, metric: MetricId | null = null, allowZero = false): Expr<SessionT, C> =>
  E({ k: 'xform', op, s: s.term, arg: arg?.term ?? null, metric, ...(allowZero ? { allowZero: true as const } : {}) })
export const scaleMetric = <C1 extends Cap = never, C2 extends Cap = never>(s: Expr<SessionT, C1>, metric: MetricId, by: Expr<Q<'one'>, C2>) =>
  xf<C1 | C2>('scaleMetric', s, by, metric)
/** `allowZero` (C9): a line whose scaled count rounds to zero issues no sets
 *  for that line (the default keeps the never-below-1 floor, F12). */
export const scaleSets = <C1 extends Cap = never, C2 extends Cap = never>(s: Expr<SessionT, C1>, by: Expr<Q<'one'>, C2>, opts?: { allowZero?: true }) => xf<C1 | C2>('scaleSets', s, by, null, !!opts?.allowZero)
export const capEffort = <C1 extends Cap = never, C2 extends Cap = never>(s: Expr<SessionT, C1>, atLeastRir: Expr<Q<'effort'>, C2>) =>
  xf<C1 | C2>('capEffort', s, atLeastRir)
export const setTempo = <C1 extends Cap = never, C2 extends Cap = never>(s: Expr<SessionT, C1>, t: Expr<TempoT, C2>) => xf<C1 | C2>('setTempo', s, t)
export const reshape = <C1 extends Cap = never, C2 extends Cap = never>(s: Expr<SessionT, C1>, shape: Expr<SetT, C2>) => xf<C1 | C2>('reshape', s, shape)
export const stripIntensifier = <C1 extends Cap = never>(s: Expr<SessionT, C1>) => xf<C1>('stripIntensifier', s, null)
export const swapExercise = <C1 extends Cap = never, C2 extends Cap = never, L extends LoggingType = LoggingType>(s: Expr<SessionT, C1>, to: Expr<Ex<L>, C2>) =>
  xf<C1 | C2>('swapExercise', s, to)
export const addSets = <C1 extends Cap = never, C2 extends Cap = never>(s: Expr<SessionT, C1>, n: Expr<Q<'sets'>, C2>) => xf<C1 | C2>('addSets', s, n)

// ═══════════════════════════════════════════════════════════════════════════
// §2 Reads: each carries the one capability it needs
// ═══════════════════════════════════════════════════════════════════════════

export type WeekRole = Enums['weekRole']

/** The progress clock. Advances only on training (L11). 0-based. */
export interface PosView {
  readonly week: Expr<Q<'weeks'>, 'pos'>
  readonly trainWeek: Expr<Q<'weeks'>, 'pos'>
  readonly role: Expr<En<WeekRole>, 'pos'>
  readonly slotSession: Expr<Q<'one'>, 'pos'>
}
export const pos: PosView = {
  week: E({ k: 'pos', field: 'week' }),
  trainWeek: E({ k: 'pos', field: 'trainWeek' }),
  role: E({ k: 'pos', field: 'role' }),
  slotSession: E({ k: 'pos', field: 'slotSession' }),
}

/** The calendar clock. Every read evaluates at a stamped day (L12). */
const calE = <T>(q: CalQuery) => E<T, 'cal'>({ k: 'cal', q })
export const cal = {
  day: calE<Q<'days'>>({ q: 'day' }),
  earlierToday: calE<Q<'one'>>({ q: 'earlierToday' }),
  gap: (of: Selector) => calE<Opt<Q<'days'>>>({ q: 'gap', of }),
  count: (of: Selector, days: number) => calE<Q<'one'>>({ q: 'recent', of, days, measure: { m: 'count' } }),
  sum: <K extends MetricId>(of: Selector, days: number, metric: K) => calE<Metrics[K]>({ q: 'recent', of, days, measure: { m: 'sum', metric } }),
  max: <K extends MetricId>(of: Selector, days: number, metric: K) => calE<Opt<Metrics[K]>>({ q: 'recent', of, days, measure: { m: 'max', metric } as Measure }),
}
export const sel = {
  any: (): Selector => ({ s: 'any' }),
  slot: (slot: string): Selector => ({ s: 'slot', slot }),
  day: (day: string): Selector => ({ s: 'day', day }),
  muscle: (m: string, ...more: string[]): Selector => ({ s: 'muscle', muscles: [m, ...more] }),
  tag: (t: string): Selector => ({ s: 'tag', tag: t }),
}
export const per = { day: (): Period => ({ k: 'day' }), week: (): Period => ({ k: 'week' }), days: (n: number): Period => ({ k: 'days', n }) }

/** Facts observed during or after the session are facts ABOUT the closing
 *  session: reading one needs `event`. Everything else needs `fact`. */
type PostFact = { [F in FactId]: (typeof import('./registry').FACT_DECLS)[F]['observed'] extends 'duringSession' | 'postSession' ? F : never }[FactId]
type FactCap<F extends FactId> = F extends PostFact ? 'event' : 'fact'
type FactKeyArg<F extends FactId> = Facts[F]['key'] extends 'none'
  ? []
  : Facts[F]['key'] extends 'zone'
    ? [key: Expr<En<Enums['hrZone']>, Cap>]
    : Facts[F]['key'] extends 'exercise'
      ? [key: Expr<Ex<LoggingType>, Cap>]
      : [key: Expr<Ref<Exclude<Facts[F]['key'], 'none' | 'zone' | 'exercise'>>, Cap>]
type KeyCap<A extends unknown[]> = A extends [Expr<unknown, infer C>] ? C : never
export function fact<F extends FactId, A extends FactKeyArg<F>>(f: F, ...key: A): Expr<Opt<Facts[F]['ty']>, NoInfer<FactCap<F> | KeyCap<A>>> {
  return E({ k: 'fact', fact: f, key: key[0]?.term ?? null })
}

type StepRef = { id: StepId } | string
export interface EventView {
  /** hit | missed | unknown against the issued bounds; consumed by byVerdict. */
  /** `success` (C1): the slot's declared rule, this read's override, or the
   *  allSets default when neither says otherwise. */
  verdict(steps?: StepRef[], bound?: 'floor' | 'top', success?: 'allSets' | SuccessRule): Expr<Verdict, 'event'>
  metric<K extends MetricId>(step: StepRef, m: K, pick?: 'last' | 'best' | 'worst'): Expr<Opt<Metrics[K]>, 'event'>
  total<K extends MetricId>(step: StepRef, m: K): Expr<Metrics[K], 'event'>
  e1rm(step: StepRef, formula?: E1rmFormula): Expr<Opt<Q<'mass'>>, 'event'>
  prescribed<K extends MetricId>(step: StepRef, m: K, edge?: 'floor' | 'top'): Expr<Opt<Metrics[K]>, 'event'>
  /** The intensifier's mini-set outcomes on the final set (D11). */
  stageReps(step: StepRef, pick: 'sum' | 'last'): Expr<Opt<Q<'reps'>>, 'event'>
  trained<C extends Cap = never>(m: Expr<Ref<'muscle'>, C>): Expr<B, NoInfer<'event' | C>>
  groupScore(score: 'time'): Expr<Opt<Q<'time'>>, 'event'>
}
const sid = (s: StepRef) => (typeof s === 'string' ? (s as StepId) : s.id)
const ids = (steps?: StepRef[]) => (steps ? steps.map(sid) : 'working')
export const ev: EventView = {
  // 'allSets' is KEPT (Y8): on a read it is an override back to the per-set
  // reading, meaningful wherever a slot declares another rule.
  verdict: (steps, bound = 'floor', success) => E({ k: 'event', q: { q: 'verdict', steps: ids(steps), bound, ...(success ? { success } : {}) } }),
  metric: (step, m, pick = 'last') => E({ k: 'event', q: { q: 'metric', step: sid(step), metric: m, pick } }),
  total: (step, m) => E({ k: 'event', q: { q: 'metric', step: sid(step), metric: m, pick: 'sum' } }),
  e1rm: (step, formula) => E({ k: 'event', q: { q: 'e1rm', step: sid(step), ...(formula ? { formula } : {}) } }),
  prescribed: (step, m, edge = 'floor') => E({ k: 'event', q: { q: 'prescribed', step: sid(step), metric: m, edge } }),
  stageReps: (step, pick) => E({ k: 'event', q: { q: 'stages', step: sid(step), pick } }),
  trained: (m) => E({ k: 'event', q: { q: 'trained', muscle: m.term } }),
  groupScore: (score) => E({ k: 'event', q: { q: 'groupScore', score } }),
}

/** A weekly read's declared coaching choice. Omitted, it measures the week
 *  just closing, every week; `basis: 'upcoming'` measures the coming week's
 *  plan, and a `roles` list leaves other weeks absent. */
export interface WeeklyOpts {
  readonly basis?: WeeklyBasis
  readonly roles?: 'all' | readonly [WeekRole, ...WeekRole[]]
}
/** The read is `Opt` unless the options are PROVABLY default (algebra
 *  weeklyIsOpt): a widened or unknown options type may carry `upcoming` or a
 *  roles list, so it must type as the IR would, Opt (X3). */
type WeeklyOf<T, O extends WeeklyOpts> = [O] extends [{ basis?: 'closing'; roles?: 'all' }] ? T : Opt<T>
/** Defaults are not written, so a default read has one IR form. */
const weeklyOpts = (o: WeeklyOpts | undefined) => ({
  ...(o?.basis === 'upcoming' ? { basis: o.basis } : {}),
  ...(o?.roles && o.roles !== 'all' ? { roles: [...o.roles] } : {}),
})

/** Aggregate reads: program structure and plans under the pre-state. */
export const aggQ = {
  slotsFor: <C extends Cap = never>(m: Expr<Ref<'muscle'>, C>): Expr<List<Ref<'slot'>>, NoInfer<'agg' | C>> => E({ k: 'agg', q: { q: 'slotsFor', muscle: m.term } }),
  /** Working sets per week (technique-weighted), by slot or by muscle. */
  setsFor: <C extends Cap = never, const O extends WeeklyOpts = {}>(
    of: Expr<Ref<'slot'>, C> | Expr<Ref<'muscle'>, C>,
    by: 'slot' | 'muscle',
    opts?: O,
  ): Expr<WeeklyOf<Q<'sets'>, O>, NoInfer<'agg' | C>> => E({ k: 'agg', q: { q: 'weekly', metric: 'sets', by: { k: by, of: of.term }, ...weeklyOpts(opts) } }),
  /** A metric's planned weekly total ("weekly km of hard runs"). */
  weekly: <K extends MetricId, const O extends WeeklyOpts = {}>(metric: K, tagged: string, opts?: O): Expr<WeeklyOf<Metrics[K], O>, 'agg'> =>
    E({ k: 'agg', q: { q: 'weekly', metric, by: { k: 'tag', tag: tagged }, ...weeklyOpts(opts) } }),
}

/** A live read of another slot's state, for a binding ARGUMENT (BBB's TM). */
export const peerState = <T>(slot: string, field: string, _w: TyW<T>): Expr<T, 'peer'> => E({ k: 'peer', slot, field, of: 'current' })

// ═══════════════════════════════════════════════════════════════════════════
// §3 State declarations and contexts
// ═══════════════════════════════════════════════════════════════════════════

/** When slot handlers can fire. Progress events (weekEnd, cycleEnd, blockEnd)
 *  are caused by training (L11). `periodClosed` is caused by the calendar, so
 *  its handlers may only propose or keep (L13). */
export type SlotEventKind = 'session' | 'weekEnd' | 'cycleEnd' | 'blockEnd' | 'periodClosed'
export type AggEventKind = 'weekEnd' | 'session' | 'periodClosed'
export type Writer = SlotEventKind | 'owner'

/** What a state field IS, for policies that gate outcomes by meaning. */
export type StateKind = 'load' | 'volume' | 'plain'
/** Derived from the declared dimension, looking through opt and map. */
export function kindOf(t: Ty): StateKind {
  if (t.t === 'opt' || t.t === 'map') return kindOf(t.of)
  if (t.t !== 'q') return 'plain'
  const keys = Object.keys(t.dim)
  return keys.length === 1 && t.dim.mass === 1 ? 'load' : keys.length === 1 && t.dim.set === 1 ? 'volume' : 'plain'
}

export interface StateDecl {
  ty: Ty
  init: Term
  writableBy: Writer[]
  noun: string
}

/** A field that lands as a proposal inside a patch. */
export interface Proposed<T, C extends Cap> {
  readonly propose: Expr<T, C>
}
export const proposed = <T, C extends Cap = never>(e: Expr<T, C>): Proposed<T, C> => ({ propose: e })
/** A handler's patch: a field not writable at this event has type `never`. */
export type Patch<S, Wr extends keyof S, C extends Cap> = { [K in keyof S]?: K extends Wr ? Expr<S[K], C> : never }
export type MixedPatch<S, Wr extends keyof S, C extends Cap> = { [K in keyof S]?: K extends Wr ? Expr<S[K], C> | Proposed<S[K], C> : never }
export type WritableSpec<S, W extends string> = { readonly [K in keyof S]: readonly W[] }
export type WritableAt<Wr, Ev extends string> = { [K in keyof Wr]: Wr[K] extends readonly (infer X)[] ? (Ev extends X ? K : never) : never }[keyof Wr]

export interface InitCtx<P> {
  readonly p: ExprsC<P, 'param'>
  readonly fact: typeof fact
}
export interface PlanCtx<P, S> extends InitCtx<P> {
  readonly s: ExprsC<S, 'state'>
  readonly pos: PosView
  readonly cal: typeof cal
  peer<T>(slot: string, field: string, w: TyW<T>): Expr<T, 'peer'>
  /** A program-scope slot-keyed map field, at THIS slot's key. */
  fromProgram<T>(field: string, w: TyW<T>): Expr<Opt<T>, 'program'>
  /** A program-scope scalar field (the diet phase a policy keeps). */
  programScalar<T>(field: string, w: TyW<T>): Expr<T, 'program'>
}
export interface HandlerCtx<P, S, Wr extends keyof S> extends PlanCtx<P, S> {
  readonly ev: EventView
  /** One patch, field by field: a bare value commits (applies now; the
   *  recorded REASON is the trace of the condition path), `proposed(v)` asks
   *  the owner (values SNAPSHOTTED at proposal time). */
  patch(p: MixedPatch<S, Wr, HandlerCap>): Expr<Upd<S>>
  /** Sugar: every field commits. */
  commit(p: Patch<S, Wr, HandlerCap>): Expr<Upd<S>>
  /** Sugar: every field is proposed. */
  propose(p: Patch<S, Wr, HandlerCap>): Expr<Upd<S>>
  /** The empty patch. */
  readonly keep: Expr<Upd<S>>
}
/** A calendar-caused handler can only propose or keep (L13: time alone never commits). */
export type PeriodCtx<P, S, Wr extends keyof S> = Omit<HandlerCtx<P, S, Wr>, 'commit' | 'patch'>

const patchOf = (p: object, mode: PatchField['mode'] | null): Term => ({
  k: 'patch',
  set: Object.fromEntries(
    Object.entries(p).map(([k, v]) => {
      const x = v as Expr<unknown, Cap> | Proposed<unknown, Cap>
      return [k, 'propose' in x ? { to: x.propose.term, mode: 'propose' } : { to: x.term, mode: mode ?? 'commit' }]
    }),
  ),
})
const outcomes = {
  patch: (p: object) => E<never>(patchOf(p, null)),
  commit: (p: object) => E<never>(patchOf(p, 'commit')),
  propose: (p: object) => E<never>(patchOf(p, 'propose')),
  keep: E<never>({ k: 'patch', set: {} }),
}

function contexts<P, S>(params: TyWs<P>, state: TyWs<S>) {
  const pE = Object.fromEntries(Object.keys(params as object).map((n) => [n, E({ k: 'param', name: n })])) as unknown as ExprsC<P, 'param'>
  const sE = Object.fromEntries(Object.keys(state as object).map((n) => [n, E({ k: 'self', field: n })])) as unknown as ExprsC<S, 'state'>
  const init: InitCtx<P> = { p: pE, fact }
  const plan: PlanCtx<P, S> = {
    ...init,
    s: sE,
    pos,
    cal,
    peer: (slot, field) => E({ k: 'peer', slot, field, of: 'current' }),
    fromProgram: (field) => E({ k: 'program', field }),
    programScalar: (field) => E({ k: 'program', field }),
  }
  const handler: HandlerCtx<P, S, keyof S> = { ...plan, ev, ...outcomes }
  return { init, plan, handler }
}

const tys = <P>(w: TyWs<P>): Record<string, Ty> => Object.fromEntries(Object.entries(w as object).map(([k, v]) => [k, (v as TyW<unknown>).ty]))

function stateDecls(state: object, init: object, writableBy: object, nouns: object): Record<string, StateDecl> {
  const i = init as Record<string, Expr<unknown, Cap>>
  const w = writableBy as Record<string, readonly Writer[]>
  const n = nouns as Record<string, string | undefined>
  return Object.fromEntries(
    Object.entries(state as Record<string, TyW<unknown>>).map(([f, t]) => [f, { ty: t.ty, init: (i[f] as Expr<unknown, Cap>).term, writableBy: [...(w[f] ?? [])], noun: n[f] ?? f }]),
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 Schemes (slot scope)
// ═══════════════════════════════════════════════════════════════════════════

/** The checker projects the scheme forward under an assumption model and
 *  compares the resulting state: D2 lifted to machines. */
export interface SchemeExample {
  args: Record<string, Term>
  facts: Record<string, Term>
  assume: 'asPrescribed' | 'allMiss'
  afterSessions: number
  expect: Record<string, Term>
}

export interface SchemeDef {
  kind: 'scheme'
  ref: DefRef
  says: Template
  params: Record<string, Ty>
  /** As FnDef.defaults (C10): closed literal defaults a binding or example
   *  may rely on; omitted when empty. */
  defaults?: Record<string, Term>
  /** As FnDef.labels (Y11): display labels for the "(with …)" append. */
  labels?: Record<string, string>
  /** The facts it may read; the checker refuses any other. */
  facts: string[]
  enums: EnumDecls
  state: Record<string, StateDecl>
  plan: Term
  on: Partial<Record<SlotEventKind, Term>>
  examples: SchemeExample[]
}

export interface Scheme<P, S, D = never> {
  readonly def: SchemeDef
  bind(args: ArgsWith<P, D, BindCap>, meta: SlotMetaSpec): SlotBinding
  readonly __s?: S
}

export interface SlotMeta {
  /** Contribution per muscle: exactly one PRIMARY (1), any secondaries (0.5). */
  muscles: Record<string, number>
  /** Static tags for selectors ("hard"). Never computed from performance. */
  tags?: string[]
  /** The slot's verdict success rule (C1): the default for every verdict
   *  read of this slot that does not declare its own. Omitted = allSets. */
  success?: SuccessRule
  /** U2: per-metric grids for THIS slot, winning over the program's for this
   *  slot's sink, prose and display unit. Each is a closed literal of the
   *  metric's dimension; the grid is never converted (U-L2), so a 5 lb slot
   *  grid on a kg program lands on lb multiples and displays in lb. A slot
   *  grid spelling the program's own grid is refused (one form per meaning);
   *  omitted (the default) means the program's grids. */
  grids?: { load?: Term; distance?: Term }
}
/** The embedding's spelling of SlotMeta: grid steps as typed expressions,
 *  lowered (and dropped when empty) by `bind`. */
export type SlotMetaSpec = Omit<SlotMeta, 'grids'> & { grids?: { load?: Expr<Q<'mass'>>; distance?: Expr<Q<'length'>> } }
export interface SlotBinding {
  scheme: DefRef
  args: Record<string, Term>
  meta: SlotMeta
}

type SlotHandlers<P, S, W> = {
  [Ev in Exclude<SlotEventKind, 'periodClosed'>]?: (c: HandlerCtx<P, S, WritableAt<W, Ev> & keyof S>) => Expr<Upd<S>, HandlerCap>
} & { periodClosed?: (c: PeriodCtx<P, S, WritableAt<W, 'periodClosed'> & keyof S>) => Expr<Upd<S>, HandlerCap> }

export function scheme<P, S, const W extends WritableSpec<S, Writer>, const D extends string = never>(spec: {
  id: string
  version: number
  says: Template
  params: TyWs<P>
  /** Closed literal values; a binding or example may then omit the param. */
  defaults?: { [K in D]: DefaultOf<NoInfer<P>, K> }
  /** Display labels for the defaulted params' "(with …)" append (Y11). */
  labels?: { [K in D]?: string }
  facts?: FactId[]
  enums?: readonly EnumDecl<string>[]
  state: TyWs<S>
  writableBy: W
  nouns?: { [K in keyof NoInfer<S>]?: string }
  init: (c: InitCtx<P>) => ExprsC<NoInfer<S>, InitCap>
  plan: (c: PlanCtx<P, S>) => Expr<SessionT, PlanCap>
  on: SlotHandlers<P, S, W>
  examples?: {
    args: ExprsC<P, Cap>
    facts?: Record<string, Expr<unknown, Cap>>
    assume: SchemeExample['assume']
    afterSessions: number
    expect: Partial<ExprsC<S, Cap>>
  }[]
}): Scheme<P, S, D> {
  const c = contexts(spec.params, spec.state)
  const ref: DefRef = { id: spec.id as DefId, version: spec.version }
  const lower = (r: object) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v as Expr<unknown, Cap>).term]))
  const defaults = spec.defaults && Object.keys(spec.defaults).length ? { defaults: lower(spec.defaults) } : {}
  const labels = spec.labels && Object.keys(spec.labels).length ? { labels: { ...(spec.labels as Record<string, string>) } } : {}
  const def: SchemeDef = {
    kind: 'scheme',
    ref,
    says: spec.says,
    params: tys(spec.params),
    ...defaults,
    ...labels,
    facts: spec.facts ?? [],
    enums: enumDecls(spec.enums),
    state: stateDecls(spec.state, spec.init(c.init), spec.writableBy, spec.nouns ?? {}),
    plan: spec.plan(c.plan).term,
    on: Object.fromEntries(Object.entries(spec.on).map(([k, h]) => [k, (h as (x: HandlerCtx<P, S, keyof S>) => Expr<unknown, Cap>)(c.handler).term])),
    examples: (spec.examples ?? []).map((ex) => ({
      args: lower(ex.args),
      facts: lower(ex.facts ?? {}),
      assume: ex.assume,
      afterSessions: ex.afterSessions,
      expect: lower(ex.expect),
    })),
  }
  // A slot grid lowers to its term; an empty grids record is dropped, so the
  // embedding has one spelling of "the program's grids" (omission, U2).
  const lowerMeta = (m: SlotMetaSpec): SlotMeta => {
    const { grids, ...rest } = m
    const entries = Object.entries(grids ?? {}).filter(([, g]) => g !== undefined)
    return entries.length ? { ...rest, grids: Object.fromEntries(entries.map(([k, g]) => [k, (g as Expr<unknown>).term])) } : rest
  }
  return { def, bind: (args, meta) => ({ scheme: ref, args: lower(args), meta: lowerMeta(meta) }) }
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 Programs (day, calendar, muscle, policy scopes)
// ═══════════════════════════════════════════════════════════════════════════

/** Day shapes. The GROUP owns rest between its members and rounds: a member
 *  set's own `rest` inside a non-single group is refused (`restOwnedByGroup`).
 *  A group may declare a score over its members (time to complete, rounds). */
export type Group =
  | { k: 'single'; slot: string }
  | { k: 'superset'; slots: [string, string, ...string[]]; between: Term; after: Term }
  | { k: 'circuit'; slots: [string, ...string[]]; restBetweenRounds: Term; score: 'time' | 'rounds' | null }
  /** Each round takes the next set of every slot, on the minute: members need
   *  a FIXED set count, unless `untilFail` (death-by) bounds the rounds instead. */
  | { k: 'emom'; slots: [string, ...string[]]; every: Term; untilFail: { max: number } | null }
  | { k: 'amrapFor'; slots: [string, ...string[]]; cap: Term; score: 'rounds' }
export const single = (slot: string): Group => ({ k: 'single', slot })
export const superset = (a: string, b: string, rest: { between: Expr<Q<'time'>>; after: Expr<Q<'time'>> }): Group => ({
  k: 'superset',
  slots: [a, b],
  between: rest.between.term,
  after: rest.after.term,
})
export const circuit = (slots: [string, ...string[]], restBetweenRounds: Expr<Q<'time'>>, score: 'time' | 'rounds' | null = null): Group => ({
  k: 'circuit',
  slots,
  restBetweenRounds: restBetweenRounds.term,
  score,
})
export const emom = (every: Expr<Q<'time'>>, ...slots: [string, ...string[]]): Group => ({ k: 'emom', slots, every: every.term, untilFail: null })
/** Death-by: the reps climb each round until failure, so the ROUNDS are the
 *  bound (a literal), and a member's set count is free. */
export const deathBy = (every: Expr<Q<'time'>>, maxRounds: number, ...slots: [string, ...string[]]): Group => ({ k: 'emom', slots, every: every.term, untilFail: { max: maxRounds } })

/** A calendar is a list of week roles on the PROGRESS clock. `drift` says what
 *  happens when the calendar outruns training: `slide` waits (the default),
 *  `anchored` closes the week on schedule and skips what is left. */
export interface Calendar {
  weeks: [WeekRole, ...WeekRole[]]
  repeat: 'once' | 'cycle'
  drift: Drift
}

/** Partial application of a named session→session definition. */
export interface Use {
  def: DefRef
  hole: string
  args: Record<string, Term>
}
export function use<P extends { s: SessionT }, D = never>(f: Fn<P, SessionT, D>, args: ArgsWith<Omit<P, 's'>, Exclude<D, 's'>, 'param'>): Use {
  return { def: f.def.ref, hole: 's', args: Object.fromEntries(Object.entries(args as object).flatMap(([k, v]) => (v ? [[k, (v as Expr<unknown, Cap>).term]] : []))) }
}

/** What an outcome policy does to a transition at the sink. Verdict math
 *  stays phase-blind; this only changes how its result lands. */
export interface OutcomeRule {
  /** Commits that move a field of these (derived) kinds in this direction
   *  become proposals (direction read on EFFECTIVE load). */
  demote: { kinds: StateKind[]; direction: 'decrease' | 'increase' | 'any' }
  /** Companion: a decrease of a `volume` field becomes keep while the policy holds. */
  volumeKeep: boolean
}
/**
 * A program-scope conditional transformer over plans AND outcomes. Where it
 * came from fixes its place in the ONE application order, which the checker
 * verifies: role sugar, then the allocation default, then the declared
 * policies in order, then (in prescribe) the phase transform. A plan
 * policy's `when` reads the state and facts at prescribe; an outcome
 * policy's `when` reads the event's stamped snapshot (L12).
 */
export interface Policy {
  when: Term
  plan: Use | null
  outcome: OutcomeRule | null
  origin: 'role' | 'allocation' | 'declared'
}
/** How co-firing policies combine, per channel (plan, outcome): every one
 *  whose `when` holds, composed in order (the default), or only the first. */
export type HitPolicy = 'allInOrder' | 'first'

/** A named, typed terminal fact a program run publishes for its successor. */
export type ExportDecl = { k: 'slotState'; slot: string; field: string; ty: Ty }
/** Every instance also exports these, from its lifecycle (time.ts). */
export const LIFECYCLE_EXPORTS: Record<string, Ty> = {
  completedFraction: { t: 'q', dim: {} },
  missedTotal: { t: 'q', dim: {} },
  finalWeek: { t: 'q', dim: { week: 1 } },
  status: { t: 'enum', name: 'instanceStatus' },
}
/** A program PARAM seeded from the predecessor run's export. The param must
 *  be Opt: an absent or abandoned predecessor is silence, not a default. */
export interface ImportDecl {
  from: DefRef
  export: string
}

export interface AggregateDef {
  state: Record<string, StateDecl>
  on: Partial<Record<AggEventKind, Term>>
}
export interface AggCtx<A, Wr extends keyof A> {
  readonly s: ExprsC<A, 'state'>
  readonly pos: PosView
  readonly cal: typeof cal
  readonly ev: EventView
  readonly fact: typeof fact
  readonly slotsFor: typeof aggQ.slotsFor
  readonly setsFor: typeof aggQ.setsFor
  patch(p: MixedPatch<A, Wr, AggregateCap>): Expr<Upd<A>>
  commit(p: Patch<A, Wr, AggregateCap>): Expr<Upd<A>>
  propose(p: Patch<A, Wr, AggregateCap>): Expr<Upd<A>>
  readonly keep: Expr<Upd<A>>
}

export interface ProgramDef {
  kind: 'program'
  ref: DefRef
  says: Template
  params: Record<string, Ty>
  facts: string[]
  enums: EnumDecls
  calendar: Calendar
  /** Quantization per metric, only where the program issues that metric. */
  grids: { load?: Term; distance?: Term }
  muscles: string[]
  slots: Record<string, SlotBinding>
  days: Record<string, Group[]>
  rotation: Rotation
  /** Empty: derived from the rotation (time.ts defaultFrequency). */
  frequency: Frequency[]
  lapseAfterDays: number
  hitPolicy: HitPolicy
  /** Declared options (configurability round). Each is OMITTED at its
   *  default, so a program that declares nothing is byte-identical, and each
   *  is a fact of the program hash like everything else here. */
  /** C2: the e1RM estimator every `ev.e1rm` read of this program uses (a
   *  read-level `formula` still wins); `maxReps` caps the effective reps any
   *  formula will estimate from. Omitted = Epley, uncapped. */
  e1rm?: { formula: E1rmFormula; maxReps?: number }
  /** C3: how `per week` adherence windows lie on the calendar. */
  adherenceWeeks?: Extract<AdherenceWeeks, { calendarAligned: unknown }>
  /** C4: technique-stage and cluster-set weights in planned-volume counting.
   *  Domain (0, 1]; omitted fields mean stage 0.5, cluster 1. */
  volumeWeights?: { stage?: number; cluster?: number }
  /** C5: the week roles whose sink drops the intensifier (L10). Omitted =
   *  deload, taper, test; [] = never by role. */
  stripIntensifierOn?: WeekRole[]
  /** C6: where an exact bound lands on a grid tie (and `round nearest`).
   *  Omitted = down. Per program, never per viewer: the issued number is a
   *  shared fact. */
  ties?: 'up'
  /** C8: per-fact staleness overrides (days), replacing the registry's
   *  maxAgeDays for reads under this program. */
  staleness?: Record<string, number>
  policies: Policy[]
  aggregate: AggregateDef | null
  exports: Record<string, ExportDecl>
  imports: Record<string, ImportDecl>
}
export interface Program<P> {
  readonly def: ProgramDef
  readonly __p?: P
}

export interface PolicyCtx<P, A> {
  readonly p: ExprsC<P, 'param'>
  readonly s: ExprsC<A, 'state'>
  readonly pos: PosView
  readonly cal: typeof cal
  readonly fact: typeof fact
}
export const policy = (spec: { when: Expr<B, PolicyCap>; plan?: Use; outcome?: OutcomeRule }): Policy => ({
  when: spec.when.term,
  plan: spec.plan ?? null,
  outcome: spec.outcome ?? null,
  origin: 'declared',
})
export const freq = {
  atLeast: (n: number, of: Selector, p: Period): Frequency => ({ k: 'atLeast', n, of, per: p }),
  atMost: (n: number, of: Selector, withinDays: number): Frequency => ({ k: 'atMost', n, of, withinDays }),
  minGap: (of: Selector, gap: Expr<Q<'days'>, CadenceCap>, ceiling: number): Frequency => ({ k: 'minGap', of, gap: gap.term, ceiling }),
}

/** The declared options, each dropped at its language default so a program
 *  that writes a default has the same one IR form as one that writes nothing
 *  (the weekbasis precedent). */
function declaredOptions(spec: {
  e1rm?: { formula: E1rmFormula; maxReps?: number }
  adherenceWeeks?: AdherenceWeeks
  volumeWeights?: { stage?: number; cluster?: number }
  stripIntensifierOn?: WeekRole[]
  ties?: 'down' | 'up'
  staleness?: Partial<Record<string, number>>
}, calendarWeeks?: readonly WeekRole[]): Pick<ProgramDef, 'e1rm' | 'adherenceWeeks' | 'volumeWeights' | 'stripIntensifierOn' | 'ties' | 'staleness'> {
  const out: ReturnType<typeof declaredOptions> = {}
  if (spec.e1rm && !(spec.e1rm.formula === 'epley' && spec.e1rm.maxReps === undefined))
    out.e1rm = { formula: spec.e1rm.formula, ...(spec.e1rm.maxReps !== undefined ? { maxReps: spec.e1rm.maxReps } : {}) }
  if (spec.adherenceWeeks && spec.adherenceWeeks !== 'fromAnchor') out.adherenceWeeks = spec.adherenceWeeks
  const vw = {
    ...(spec.volumeWeights?.stage !== undefined && spec.volumeWeights.stage !== VOLUME_DEFAULTS.stage ? { stage: spec.volumeWeights.stage } : {}),
    ...(spec.volumeWeights?.cluster !== undefined && spec.volumeWeights.cluster !== VOLUME_DEFAULTS.cluster ? { cluster: spec.volumeWeights.cluster } : {}),
  }
  if (Object.keys(vw).length) out.volumeWeights = vw
  // The embedding canonicalizes a role list to THE one spelling (Y4): each
  // role once, in calendar declaration order; the default set drops.
  const strip = spec.stripIntensifierOn && calendarWeeks ? canonicalStrip(spec.stripIntensifierOn, calendarWeeks) : spec.stripIntensifierOn && [...new Set(spec.stripIntensifierOn)]
  if (strip && [...strip].sort().join() !== [...STRIP_DEFAULT].sort().join()) out.stripIntensifierOn = strip as WeekRole[]
  if (spec.ties === 'up') out.ties = 'up'
  if (spec.staleness && Object.keys(spec.staleness).length) out.staleness = Object.fromEntries(Object.entries(spec.staleness).filter(([, v]) => v !== undefined)) as Record<string, number>
  return out
}

export function program<P, A = Record<never, never>, const WA extends WritableSpec<A, AggEventKind | 'owner'> = WritableSpec<A, AggEventKind | 'owner'>>(spec: {
  id: string
  version: number
  says: Template
  params: TyWs<P>
  facts?: FactId[]
  enums?: readonly EnumDecl<string>[]
  calendar: { weeks: [WeekRole, ...WeekRole[]]; repeat: 'once' | 'cycle'; drift?: Drift }
  grids?: { load?: Expr<Q<'mass'>>; distance?: Expr<Q<'length'>> }
  muscles?: string[]
  slots: (p: ExprsC<P, 'param'>) => Record<string, SlotBinding>
  days: Record<string, Group[]>
  rotation: Rotation
  frequency?: (c: { p: ExprsC<P, 'param'>; s: ExprsC<A, 'state'> }) => Frequency[]
  lapseAfterDays?: number
  e1rm?: { formula: E1rmFormula; maxReps?: number }
  adherenceWeeks?: AdherenceWeeks
  volumeWeights?: { stage?: number; cluster?: number }
  stripIntensifierOn?: WeekRole[]
  ties?: 'down' | 'up'
  staleness?: Partial<Record<FactId, number>>
  /** Sugar: a role maps to a session transformer (when: pos.role == role). */
  roles?: Partial<Record<WeekRole, Use>>
  policies?: (c: PolicyCtx<P, A>) => Policy[]
  hitPolicy?: HitPolicy
  /** D4: an aggregate's set reallocations land as proposals unless the
   *  program opts into committing them. */
  allocation?: 'propose' | 'commit'
  aggregate?: {
    state: TyWs<A>
    writableBy: WA
    nouns?: { [K in keyof NoInfer<A>]?: string }
    init: (c: { p: ExprsC<P, 'param'> }) => ExprsC<NoInfer<A>, 'param'>
    on: { [Ev in AggEventKind]?: (c: AggCtx<A, WritableAt<WA, Ev> & keyof A>) => Expr<Upd<A>, AggregateCap> }
  }
  exports?: Record<string, ExportDecl>
  imports?: { [K in keyof NoInfer<P>]?: ImportDecl }
}): Program<P> {
  const pE = Object.fromEntries(Object.keys(spec.params as object).map((n) => [n, E({ k: 'param', name: n })])) as unknown as ExprsC<P, 'param'>
  const aState = (spec.aggregate?.state ?? {}) as object
  const sE = Object.fromEntries(Object.keys(aState).map((n) => [n, E({ k: 'self', field: n })])) as unknown as ExprsC<A, 'state'>
  let aggregate: AggregateDef | null = null
  if (spec.aggregate) {
    const ag = spec.aggregate
    const ctx: AggCtx<A, keyof A> = {
      s: sE,
      pos,
      cal,
      ev,
      fact,
      slotsFor: aggQ.slotsFor,
      setsFor: aggQ.setsFor,
      ...outcomes,
    }
    aggregate = {
      state: stateDecls(ag.state, ag.init({ p: pE }), ag.writableBy, ag.nouns ?? {}),
      on: Object.fromEntries(Object.entries(ag.on).map(([k, h]) => [k, (h as (c: AggCtx<A, keyof A>) => Expr<unknown, Cap>)(ctx).term])),
    }
  }
  const allocationPolicy: Policy[] =
    aggregate && (spec.allocation ?? 'propose') === 'propose' && Object.values(aggregate.state).some((d) => kindOf(d.ty) === 'volume')
      ? [{ when: { k: 'lit', lit: { k: 'bool', v: true } }, plan: null, outcome: { demote: { kinds: ['volume'], direction: 'any' }, volumeKeep: false }, origin: 'allocation' }]
      : []
  const rolePolicies: Policy[] = Object.entries(spec.roles ?? {}).map(([role, u]) => ({
    when: { k: 'cmp', op: '==', a: { k: 'pos', field: 'role' }, b: { k: 'lit', lit: { k: 'enum', name: 'weekRole', tag: role } } },
    plan: u as Use,
    outcome: null,
    origin: 'role',
  }))
  return {
    def: {
      kind: 'program',
      ref: { id: spec.id as DefId, version: spec.version },
      says: spec.says,
      params: tys(spec.params),
      facts: spec.facts ?? [],
      enums: enumDecls(spec.enums),
      calendar: { weeks: spec.calendar.weeks, repeat: spec.calendar.repeat, drift: spec.calendar.drift ?? 'slide' },
      grids: Object.fromEntries(Object.entries(spec.grids ?? {}).map(([m, g]) => [m, (g as Expr<unknown>).term])),
      muscles: spec.muscles ?? [],
      slots: spec.slots(pE),
      days: spec.days,
      rotation: spec.rotation,
      frequency: spec.frequency?.({ p: pE, s: sE }) ?? [],
      lapseAfterDays: spec.lapseAfterDays ?? DEFAULT_LAPSE_DAYS,
      hitPolicy: spec.hitPolicy ?? 'allInOrder',
      ...declaredOptions(spec, spec.calendar.weeks),
      policies: [...rolePolicies, ...allocationPolicy, ...(spec.policies?.({ p: pE, s: sE, pos, cal, fact }) ?? [])],
      aggregate,
      exports: spec.exports ?? {},
      imports: (spec.imports ?? {}) as Record<string, ImportDecl>,
    },
  }
}
export const exportState = <T>(slot: string, field: string, w: TyW<T>): ExportDecl => ({ k: 'slotState', slot, field, ty: w.ty })
export const importFrom = (p: Program<unknown> | { def: { ref: DefRef } }, name: string): ImportDecl => ({ from: p.def.ref, export: name })

// ═══════════════════════════════════════════════════════════════════════════
// §6 Macrocycles (phase sequencing, handoff, peaking)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase length kinds. A `bounded` phase repeats its calendar until
 * `advanceWhen` holds at a weekEnd, never fewer than `min` nor more than
 * `max` weeks. At max, `atMax` decides: `advance` for a plain time box,
 * `propose` (the default when advanceWhen reads criteria) so a safety phase
 * never times out into the next one without the owner. An `open` phase never
 * ends and may only be LAST.
 */
export type Length =
  | { k: 'fixed' }
  | { k: 'bounded'; min: number; max: number; advanceWhen: Term; atMax: 'advance' | 'propose' }
  | { k: 'open' }

/** What a handoff may read: the TERMINAL state of the previous phase. A
 *  handoff is sugar over exports and imports: each `prevPhase` read is an
 *  implicit export of that slot field from the previous phase's run. */
export interface PrevView {
  state<T>(slot: string, field: string, w: TyW<T>): Expr<T, 'peer'>
}

export interface PhaseDef {
  label: string
  program: DefRef
  length: Length
  args: Record<string, Term>
  transform: Use | null
}
export interface Phase<L extends Length['k']> {
  readonly def: PhaseDef
  readonly __len?: L
}
export type LengthE =
  | { k: 'fixed' }
  | { k: 'open' }
  | { k: 'bounded'; min: number; max: number; advanceWhen: (cur: PrevView & { cal: typeof cal; fact: typeof fact }) => Expr<B, HandoffCap>; atMax?: 'advance' | 'propose' }

export function phase<P, const LE extends LengthE>(
  label: string,
  prog: Program<P>,
  length: LE,
  args: (prev: PrevView) => ExprsC<P, HandoffCap>,
  transform: Use | null = null,
): Phase<LE['k']> {
  const view = (of: 'current' | 'prevPhase'): PrevView => ({ state: (slot, field) => E({ k: 'peer', slot, field, of }) })
  let len: Length
  if (length.k === 'bounded') {
    const w = length.advanceWhen({ ...view('current'), cal, fact }).term
    len = { k: 'bounded', min: length.min, max: length.max, advanceWhen: w, atMax: length.atMax ?? (w.k === 'lit' ? 'advance' : 'propose') }
  } else len = { k: length.k }
  const a = args(view('prevPhase')) as Record<string, Expr<unknown, Cap>>
  return { def: { label, program: prog.def.ref, length: len, args: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.term])), transform } }
}

/**
 * Anchors. `peakOn` lays the calendar out BACKWARDS from a date, so every
 * phase must have a known length AND the drift must be `anchored` (the meet
 * does not move when training slips). `startOn` admits bounded phases and one
 * trailing open phase; its date may be in the past (a surgery date).
 */
export type MacroSpec =
  | { anchor: { k: 'peakOn'; date: LocalDay }; drift: 'anchored'; phases: [Phase<'fixed'>, ...Phase<'fixed'>[]] }
  | { anchor: { k: 'startOn'; date: LocalDay }; drift: Drift; phases: [...Phase<'fixed' | 'bounded'>[], Phase<'fixed' | 'bounded' | 'open'>] }

export interface MacroDef {
  kind: 'macro'
  ref: DefRef
  says: Template
  anchor: MacroSpec['anchor']
  drift: Drift
  phases: PhaseDef[]
}
export function macro(spec: { id: string; version: number; says: Template } & MacroSpec): MacroDef {
  return { kind: 'macro', ref: { id: spec.id as DefId, version: spec.version }, says: spec.says, anchor: spec.anchor, drift: spec.drift, phases: spec.phases.map((p) => p.def) }
}

export type AnyDef = import('./algebra').FnDef | SchemeDef | ProgramDef | MacroDef

export type { List1, Map_, LiveCap }
