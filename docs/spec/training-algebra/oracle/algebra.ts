/**
 * algebra.ts — the core calculus.
 *
 * POSITION ON THE DIAL: maximum power that stays total. The language is a
 * simply-typed, first-order-data, named-function calculus with dimensioned
 * quantities, finite collections, structural folds and total lookup tables.
 * It is roughly Gödel's System T with the higher-order part cut off (fold
 * accumulators are ground) and general recursion absent. Arithmetic,
 * aggregation, allocation, cross-scope reads and exercise-changing
 * progressions are IN. Division is OUT: ratios come from `ratio` (absent on a
 * zero denominator), and pace is a unit.
 *
 * ONE TYPING AUTHORITY. The IR checker (checker.ts) decides what a program
 * means and whether it is accepted. This file's `Expr<T, C>` embedding is a
 * BUILDER whose phantom sorts and capabilities catch most errors at tsc time,
 * best-effort: everything it refuses the IR refuses too (negative.ts and its
 * IR twins in demo §3), and what the IR accepts either typechecks here or is
 * a documented embedding gap (demo §3, the converse corpus).
 *
 * DESCRIBABILITY rests on four structural rules:
 *   D1. Every term former has exactly one describer (the DESCRIBERS table is
 *       typed `{ [K in Term['k']]: ... }`, so a new former without prose does
 *       not compile). Declarations get the same treatment (DECL_DESCRIBERS).
 *   D2. Functions exist ONLY as named, versioned definitions. There is no
 *       lambda value. A LIBRARY definition carries a prose template whose
 *       holes are its parameters; a user definition renders its mechanism.
 *   D3. Evaluation is traced, cut at named-definition boundaries.
 *   D4. The phrase budget: a readability LINT, not a describability
 *       guarantee. Between two name boundaries an expression may hold at most
 *       BUDGET operator nodes; the prescribed fix is to name an intermediate.
 *
 * CAPABILITIES ARE TYPES. `Expr<T, C>` carries, beside its sort T, the set C
 * of world-reads it needs. Each syntactic position grants a capability set
 * (§2), and a term is accepted only where its C is a subset.
 */
import { DIMS, UNITS, canon, type Dim, type DimOf, type DimVec, type Mul, type Rate, type Unit } from './units'
import type { EnumName, Enums, ExerciseId, Facts, LoggingOf, LoggingType, MetricId, Metrics, Scale, Scales, VerdictTag } from './registry'
import type { CalQuery } from './time'

export type { Dim, DimVec, Unit } from './units'

// ═══════════════════════════════════════════════════════════════════════════
// §1 Sorts
// ═══════════════════════════════════════════════════════════════════════════

export type RefKind = 'exercise' | 'slot' | 'muscle' | 'day'
/** A map is keyed by a ref kind or by an enum (zones, modalities). */
export type MapKey = RefKind | `enum:${string}`

/** Phantom sorts of the embedding (never instantiated; only carried). */
export interface Q<D extends Dim> {
  readonly q: D
}
export interface B {
  readonly bool: true
}
export interface Ord<S extends Scale> {
  readonly ord: S
}
/** An enum sort is its set of tags, so built-in and author-declared enums
 *  type `match` exhaustiveness the same way. */
export interface En<T extends string> {
  readonly en: T
}
/** The session verdict: not an En, so `is`/`eq` cannot take it and the only
 *  consumer is the three-armed `byVerdict`. */
export interface Verdict {
  readonly verdict: VerdictTag
}
export interface Ref<K extends Exclude<RefKind, 'exercise'>> {
  readonly ref: K
}
/** An exercise reference carries its logging type: it decides which metrics a
 *  set target on it may name. */
export interface Ex<L extends LoggingType> {
  readonly exercise: L
}
export interface Opt<T> {
  readonly opt: T
}
export interface List<T> {
  readonly list: T
}
/** Non-empty list: `nth` on it is total. */
export interface List1<T> {
  readonly list1: T
}
export interface Map_<K extends MapKey, T> {
  readonly map: [K, T]
}
/** A set target, phantom-indexed by the metrics it names (covariant), so a
 *  step can demand that they are metrics its exercise logs. */
export interface SetT<M extends string = string> {
  readonly setTarget?: M[]
}
export interface SessionT {
  readonly slotSession: true
}
export interface TechniqueT {
  readonly technique: true
}
export interface TempoT {
  readonly tempo: true
}
/** A transition outcome over a state shape S (see structure.ts). */
export interface Upd<S> {
  readonly upd: S
}

export type ScopeKind = 'slot' | 'program'
export type DomSort = 'set' | 'session' | 'technique' | 'tempo'
/** The two clocks as SORTS on a quantity. A progress read (pos.*) and a
 *  calendar read (cal.*) never meet in arithmetic or comparison, and a
 *  calendar-derived quantity may only be compared, never stored, targeted or
 *  used as an index (checker.ts `clockMix`). */
export type Clock = 'progress' | 'calendar'

/** Runtime sorts: what the IR checker manipulates. */
export type Ty =
  | { t: 'q'; dim: DimVec; clock?: Clock }
  | { t: 'bool' }
  | { t: 'ord'; scale: Scale }
  | { t: 'enum'; name: string }
  /** `logging`: the logging types this exercise may have (one for a known
   *  exercise, several for a mixed-logging ladder's element). */
  | { t: 'ref'; kind: RefKind; logging?: readonly LoggingType[] }
  | { t: 'opt'; of: Ty }
  | { t: 'list'; of: Ty; nonEmpty: boolean }
  | { t: 'map'; key: MapKey; of: Ty }
  /** A set: `metrics` it targets. A session: its exercise's possible
   *  `logging` (absent when unknown statically) and the `metrics` its steps
   *  target, so a transformer can be checked against what is logged. */
  | { t: 'dom'; sort: DomSort; metrics?: readonly string[]; logging?: readonly LoggingType[] }
  | { t: 'upd'; scope: ScopeKind }

/** Typed witness: a runtime Ty that also carries its phantom sort. */
export interface TyW<T> {
  readonly ty: Ty
  readonly __t?: T
}

/** An author-declared enumeration, carried on the definition that uses it. */
export interface EnumDecl<T extends string> {
  readonly name: string
  readonly values: readonly [T, ...T[]]
  readonly ty: TyW<En<T>>
  tag(t: T): Expr<En<T>>
}
export function declareEnum<const T extends string>(name: string, values: readonly [T, ...T[]]): EnumDecl<T> {
  return { name, values, ty: { ty: { t: 'enum', name } }, tag: (t) => E({ k: 'lit', lit: { k: 'enum', name, tag: t } }) }
}

export const ty = {
  q: <D extends Dim>(d: D): TyW<Q<D>> => ({ ty: { t: 'q', dim: DIMS[d] } }),
  bool: (): TyW<B> => ({ ty: { t: 'bool' } }),
  ord: <S extends Scale>(scale: S): TyW<Ord<S>> => ({ ty: { t: 'ord', scale } }),
  en: <N extends EnumName>(name: N): TyW<En<Enums[N]>> => ({ ty: { t: 'enum', name } }),
  ref: <K extends Exclude<RefKind, 'exercise'>>(kind: K): TyW<Ref<K>> => ({ ty: { t: 'ref', kind } }),
  /** One logging type, or several (a ladder whose rungs log differently): a
   *  target may then name only what EVERY one logs, here and in the checker. */
  exercise: <L extends LoggingType>(...logging: [L, ...L[]]): TyW<Ex<L>> => ({ ty: { t: 'ref', kind: 'exercise', logging } }),
  opt: <T>(of: TyW<T>): TyW<Opt<T>> => ({ ty: { t: 'opt', of: of.ty } }),
  list1: <T>(of: TyW<T>): TyW<List1<T>> => ({ ty: { t: 'list', of: of.ty, nonEmpty: true } }),
  map: <K extends Exclude<RefKind, 'exercise'>, T>(key: K, of: TyW<T>): TyW<Map_<K, T>> => ({ ty: { t: 'map', key, of: of.ty } }),
  session: (): TyW<SessionT> => ({ ty: { t: 'dom', sort: 'session' } }),
  technique: (): TyW<TechniqueT> => ({ ty: { t: 'dom', sort: 'technique' } }),
  tempo: (): TyW<TempoT> => ({ ty: { t: 'dom', sort: 'tempo' } }),
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 Capabilities: what a term reads, and what each position grants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * World-reads. A term's capability set is the union of its reads; binder
 * variables carry `elem`, which no position grants and which the binding
 * former DISCHARGES, so a bound variable cannot escape its binder.
 */
export type Cap =
  | 'param' //      a bound parameter of the enclosing definition
  | 'state' //      the enclosing scope's own state (pre-state in handlers)
  | 'peer' //       another slot's state (BBB reads the squat TM)
  | 'program' //    the program-scope field: a scalar, or a slot-keyed map at THIS slot's key
  | 'fact' //       a standing or pre-session fact (registry.ts)
  | 'pos' //        the progress clock and week role
  | 'cal' //        the calendar clock (time.ts), always against a stamped day
  | 'performed' //  this session's EARLIER steps: performed or prescribed (APRE)
  | 'event' //      the closing event's facts, including during- and post-session facts
  | 'agg' //        program structure and plans under the pre-state (aggregate only)
  | 'elem' //       a binder variable; discharged by its binder

/** A fn body sees only its parameters: a named definition is a pure function. */
export type FnCap = 'param'
/** Scheme init: params and facts. No clock: there is no position yet. */
export type InitCap = 'param' | 'fact'
/** Plan positions: set counts, exercise choice, session shape. */
export type PlanCap = 'param' | 'state' | 'peer' | 'program' | 'fact' | 'pos' | 'cal'
/** Live positions: set-target fields, which may read EARLIER steps (APRE). */
export type LiveCap = PlanCap | 'performed'
/** Slot handlers: pre-state plus the closing event, never live session reads. */
export type HandlerCap = PlanCap | 'event'
/** Aggregate (muscle-scope) handlers: program state, facts, the event, aggregates. */
export type AggregateCap = 'param' | 'state' | 'fact' | 'pos' | 'cal' | 'event' | 'agg'
/** Program-scope slot bindings: program params and peers' live state. */
export type BindCap = 'param' | 'peer'
/** Macro handoffs and advance predicates: phase state, the calendar (time
 *  floors), and facts (entry criteria read measured inputs). */
export type HandoffCap = 'peer' | 'cal' | 'fact'
/** Program policies: their `when` reads program state, facts and both clocks. */
export type PolicyCap = 'param' | 'state' | 'fact' | 'pos' | 'cal'
/** A frequency's gap term, evaluated at prescribe and stamped. */
export type CadenceCap = 'param' | 'state' | 'peer'

// ═══════════════════════════════════════════════════════════════════════════
// §3 The term IR (what is stored, hashed, checked, evaluated, described)
// ═══════════════════════════════════════════════════════════════════════════

export type VarName = string & { readonly __var: true }
export type StepId = string & { readonly __step: true }
export type DefId = string & { readonly __def: true }
export interface DefRef {
  id: DefId
  version: number
}
export type Lit =
  /** `v` is CANONICAL (kg, s, m, RIR, beats/s); `unit` is how it displays.
   *  `per`: a rate ("2.5 kg per rep"), its vector unit ÷ per. `notation:
   *  'rpe'`: an RIR value the author typed as RPE, displayed back that way. */
  | { k: 'q'; v: number; unit: Unit; per?: Unit; notation?: 'rpe' }
  | { k: 'bool'; v: boolean }
  | { k: 'ord'; scale: Scale; level: number }
  | { k: 'enum'; name: string; tag: string }
  /** No label: an exercise's label and logging come from the registry. */
  | { k: 'ref'; kind: RefKind; id: string }

/** A metric bound. A target is a partial record metric → bound; an `open`
 *  bound is logged and not targeted ("run 5 km": distance exact, duration open). */
export type BoundIR =
  | { b: 'exact'; v: Term }
  | { b: 'range'; min: Term; max: Term }
  | { b: 'atLeast'; v: Term }
  | { b: 'atMost'; v: Term }
  | { b: 'open' }
export type ReadPick = 'last' | 'best' | 'worst' | 'sum' | 'count'

/** A table row key is a LITERAL of the key's sort: an ordinal level, an
 *  enum tag or ref id, or a quantity (an inclusive upper threshold, with its
 *  unit); null for a positional (clock) row. */
export type RowKey = number | string | Lit | null
export interface TableRow {
  when: RowKey
  then: Term
}
/** One field of a patch: the new value and how it lands. */
export interface PatchField {
  to: Term
  mode: 'commit' | 'propose'
}

/**
 * The closed set of term formers (47). Grouped by what they buy:
 *
 *  core      lit var let named if match
 *  quantity  arith cmp logic not round ratio
 *  absence   some none known orElse asReps
 *  finite    list nth fold tabulate at keys range sum count pick allocate
 *  tables    table
 *  reuse     app
 *  context   param self peer program fact pos cal performed prescribed event agg
 *  domain    set session xform technique tempo
 *  outcome   patch
 *
 * TYPING JUDGMENT  Σ; Δ; Γ ⊢ e : τ ! C
 *   Σ  definition signatures published BEFORE the current one
 *   Δ  scope context: { position (grants a Cap set), params, own state
 *        (writable per StateDecl.writableBy in handlers), readable peers,
 *        declared facts, declared enums, EARLIER steps in scope, event }
 *   Γ  variables bound by built-in binders
 *   C  the capabilities e reads; accepted at a position iff C ⊆ grants
 */
export type Term =
  // ── core ────────────────────────────────────────────────────────────────
  | { k: 'lit'; lit: Lit }
  | { k: 'var'; name: VarName }
  /** Always labeled: a let is a NAME BOUNDARY, for the budget and for prose. */
  | { k: 'let'; name: VarName; label: string; value: Term; body: Term }
  /** Semantically the identity; a budget boundary. Outside the library its
   *  noun renders with its expansion, so a noun cannot lie about its body. */
  | { k: 'named'; noun: string; e: Term }
  | { k: 'if'; c: Term; a: Term; b: Term }
  /** on: an enum or the verdict; cases cover its DECLARED tags exactly. */
  | { k: 'match'; on: Term; cases: Record<string, Term> }
  // ── quantity ────────────────────────────────────────────────────────────
  /** (Add/Sub/Min/Max) same dim ⇒ same dim. (Mul) dims add. No division. */
  | { k: 'arith'; op: '+' | '-' | '*' | 'min' | 'max'; a: Term; b: Term }
  | { k: 'cmp'; op: '<' | '<=' | '==' | '>=' | '>'; a: Term; b: Term }
  | { k: 'logic'; op: 'and' | 'or'; a: Term; b: Term }
  | { k: 'not'; a: Term }
  | { k: 'round'; mode: 'down' | 'nearest' | 'up'; a: Term; step: Term }
  /** (Ratio) a,b : q[d] (same d) ⇒ opt q[one]; absent when b is zero. */
  | { k: 'ratio'; a: Term; b: Term }
  // ── absence ─────────────────────────────────────────────────────────────
  | { k: 'some'; a: Term }
  | { k: 'none'; of: Ty }
  | { k: 'known'; a: Term; as: VarName; body: Term; then: boolean }
  | { k: 'orElse'; a: Term; b: Term }
  /** (AsReps) q[effort] ⇒ q[reps]: reps in reserve ARE reps, for the e1RM
   *  arithmetic only. Legal only in a LIBRARY definition's body. */
  | { k: 'asReps'; a: Term }
  // ── finite collections (the only iteration there is) ────────────────────
  | { k: 'list'; items: Term[]; of: Ty }
  | { k: 'nth'; xs: Term; i: Term; overflow: 'hold' | 'cycle' }
  | { k: 'fold'; xs: Term; init: Term; acc: VarName; x: VarName; step: Term }
  /** Over refs or enum tags: a map. Over `range`: a list, in index order. */
  | { k: 'tabulate'; keys: Term; as: VarName; body: Term }
  | { k: 'at'; m: Term; key: Term }
  /** Declaration-order keys: the program's slots or muscles, or an enum's tags. */
  | { k: 'keys'; of: 'slots' | 'muscles' | `enum:${string}` }
  /** 0, 1, …, n−1 for a LITERAL n ≥ 1: a key list for tabulate. */
  | { k: 'range'; n: number }
  | { k: 'sum'; xs: Term; as: VarName; body: Term }
  | { k: 'count'; xs: Term; as: VarName; where: Term }
  | { k: 'pick'; mode: 'max' | 'min'; xs: Term; as: VarName; where: Term | null; score: Term }
  /**
   * Allocation with a LITERAL bound. NORMATIVE semantics (the evaluator must
   * match): units are handed out one at a time, at most `max` units in all,
   * starting from `into`. For each unit the candidates are the `among`
   * elements still below `cap` extra units; the unit goes to the one with the
   * highest `score`, ties broken by `among`'s declaration order. Scores are
   * evaluated ONCE, before the first unit, and are not re-ranked as units
   * land (a score cannot read the map being built). Units that no candidate
   * can take are dropped and reported in the trace. The checker refuses a
   * literal `n` above `max` (nExceedsMax): it could never be delivered.
   * Domain (R2): `n` is floored and clamped at 0 (a fraction or a negative
   * gap is dropped and traced, never placed or removed); a candidate missing
   * from `into` starts at 0; a negative score still ranks (a score orders,
   * the cap gates).
   */
  | { k: 'allocate'; n: Term; into: Term; among: Term; as: VarName; score: Term; cap: Term; max: number }
  // ── tables ──────────────────────────────────────────────────────────────
  /**
   * One lookup former. The KEY'S SORT selects the reading:
   *  - a progress-clock quantity: rows are positional (row i at index i),
   *    `overflow` says what happens past the last row; no `otherwise`;
   *  - an ordinal or an enum: one row per level or tag, exhaustive;
   *  - any other quantity: rows are inclusive upper thresholds, LITERAL and
   *    strictly ascending (a dead or unsorted row is refused), `otherwise`
   *    above the last;
   *  - a ref: one row per id, `otherwise` for the rest.
   */
  | { k: 'table'; key: Term; rows: TableRow[]; otherwise: Term | null; overflow: 'hold' | 'cycle' | null }
  // ── reuse ───────────────────────────────────────────────────────────────
  /** Σ holds only versions published BEFORE the current definition: the
   *  reference graph is a DAG by publication time (no recursion). */
  | { k: 'app'; def: DefRef; args: Record<string, Term> }
  // ── context reads (each needs one capability; see §2) ───────────────────
  | { k: 'param'; name: string }
  | { k: 'self'; field: string }
  | { k: 'peer'; slot: string; field: string; of: 'current' | 'prevPhase' }
  /** A program-scope field: a scalar reads as itself; a slot-keyed map reads
   *  at THIS slot's key, as opt. */
  | { k: 'program'; field: string }
  /** A registered fact. Standing/pre-session facts need `fact`; during- and
   *  post-session facts are about the closing session and need `event`. */
  | { k: 'fact'; fact: string; key: Term | null }
  /** Progress-clock reads. 0-based: the first block week is week 0. */
  | { k: 'pos'; field: 'week' | 'trainWeek' | 'role' | 'slotSession' }
  | { k: 'cal'; q: CalQuery }
  /** Live positions: a metric of an EARLIER step's logged sets (the step's
   *  own earlier sets inside an until/while step). last/best/worst: opt;
   *  sum: total so far; count: sets logged so far (the 0-based set index). */
  | { k: 'performed'; step: StepId; metric: string; pick: ReadPick }
  /** Live positions: the ISSUED bound of an earlier step's metric. */
  | { k: 'prescribed'; step: StepId; metric: string; edge: 'floor' | 'top' }
  | { k: 'event'; q: EventQuery }
  | { k: 'agg'; q: AggQuery }
  // ── domain formers ──────────────────────────────────────────────────────
  | {
      k: 'set'
      role: Enums['setRole']
      target: Record<string, BoundIR>
      rest: Term | null
      tempo: Term | null
      /** Intra-set rest on every set: the dose law refuses a cluster as an
       *  intensifier, so a whole-session cluster scheme lives here. */
      cluster: { per: Term; intraRest: Term } | null
    }
  | { k: 'session'; exercise: Term; steps: StepIR[]; intensifier: Term | null }
  /** `allowZero` is a scaleSets-only option: a line whose scaled count rounds
   *  to zero issues no sets (the default keeps the never-below-1 floor). */
  | { k: 'xform'; op: XformOp; s: Term; arg: Term | null; metric: string | null; allowZero?: true }
  | { k: 'technique'; kind: 'drop-set' | 'rest-pause' | 'myo-reps'; stages: Term[] }
  | { k: 'tempo'; ecc: number; pause: number; con: number; top: number }
  // ── the transition outcome (handler positions) ──────────────────────────
  /** One record field → value + mode. Keys are unique, so a handler can
   *  never write a field twice (L4); the empty patch is "keep". */
  | { k: 'patch'; set: Record<string, PatchField> }

/**
 * A session is a TELESCOPE of steps: a step may read steps declared before it
 * and nothing later. A `repeat` block repeats its body a LITERAL number of
 * times; a read of a body step from after the block sees its last iteration.
 * Counts: a set count (plan position), a count RANGE (athlete-chosen; the
 * floor drives volume accounting), `until` (post-tested: at least one set),
 * `while` (pre-tested: zero sets is possible, 5/3/1 Jokers). Both loops carry
 * a literal `max`.
 */
export type Count =
  | { k: 'n'; n: Term }
  | { k: 'range'; min: Term; max: Term }
  | { k: 'until'; stop: Term; max: number }
  | { k: 'while'; go: Term; max: number }
export type StepIR =
  | { k: 'step'; id: StepId; count: Count; target: Term }
  | { k: 'repeat'; id: StepId; n: number; body: [Extract<StepIR, { k: 'step' }>, ...Extract<StepIR, { k: 'step' }>[]] }

/** Session transformers. Metric-aware and checked against the session's
 *  logging when it is known: scaling, reshaping or capping a metric the
 *  exercise does not log is refused, and a swap must keep every targeted
 *  metric logged (`loggingMismatch`). */
export type XformOp =
  | 'scaleMetric' //     metric + arg q[one]
  | 'scaleSets' //       arg q[one], rounds down, never below 1
  | 'capEffort' //       arg q[effort]
  | 'setTempo' //        arg tempo
  | 'reshape' //         arg set: its bounds replace the working sets' bounds for the metrics it names
  | 'stripIntensifier'
  | 'swapExercise' //    arg ref[exercise]
  | 'addSets' //         arg q[sets] on the last working step

/** The verdict's success rule, a declared option (omitted = allSets, every
 *  bound of every judged set): `totalReps` judges the summed logged reps of
 *  the judged sets against the summed reps floor (other metrics stay
 *  per-set); `atLeastSets` hits when at least n judged sets fully hit. */
export type SuccessRule = 'totalReps' | { atLeastSets: number }
/** The e1RM estimator family. The default is Epley; the X6 RIR rule (logged
 *  reps in reserve count as reps) applies to every formula. */
export type E1rmFormula = 'epley' | 'brzycki' | 'lombardi' | 'mayhew'

export type EventQuery =
  /** THREE-VALUED, against the ISSUED bounds, metric by metric: `hit` when
   *  every bound was logged and met, `missed` when some logged value violates
   *  its bound, `unknown` otherwise (something unlogged, nothing violated).
   *  Its sort is the verdict, consumed only by an exhaustive match.
   *  `success` (an option; omitted = allSets) changes what "met" aggregates:
   *  see SuccessRule. */
  | { q: 'verdict'; steps: StepId[] | 'working'; bound: 'floor' | 'top'; success?: SuccessRule }
  | { q: 'metric'; step: StepId; metric: string; pick: ReadPick }
  /** The declared estimator (the program's `e1rm` declaration, Epley when
   *  none; `formula` overrides per read) over the best set, on EFFECTIVE load
   *  (the logging type's mass semantics). */
  | { q: 'e1rm'; step: StepId; formula?: E1rmFormula }
  | { q: 'prescribed'; step: StepId; metric: string; edge: 'floor' | 'top' }
  /** The intensifier's stage outcomes on the final set (rest-pause mini-sets). */
  | { q: 'stages'; step: StepId; pick: 'sum' | 'last' | 'count' }
  | { q: 'trained'; muscle: Term }
  | { q: 'week' }
  /** The score of the day group the slot sat in, when the group declares one. */
  | { q: 'groupScore'; score: 'time' | 'rounds' }

/** Aggregates over the program's structure and plans under the pre-state.
 *  `weekly` counts working sets ('sets', technique-weighted: a stage after the
 *  first counts 0.5, a cluster set counts 1) or sums a metric's planned values.
 *  Its two options are the one coaching judgment the read makes, declared:
 *  `basis` measures the week just closing (the default) or the coming week's
 *  plan; `roles` limits the read to weeks of the listed roles, any other week
 *  reading as absence. A read with a non-default option is `Opt`. */
export type AggQuery =
  | { q: 'slotsFor'; muscle: Term }
  | { q: 'weekly'; metric: string; by: { k: 'slot'; of: Term } | { k: 'muscle'; of: Term } | { k: 'tag'; tag: string }; basis?: WeeklyBasis; roles?: WeeklyRoles }

export type WeeklyBasis = 'closing' | 'upcoming'
export type WeeklyRoles = 'all' | Enums['weekRole'][]
/** Whether a weekly read can be absent: only a non-default option makes it so. */
export const weeklyIsOpt = (q: { basis?: WeeklyBasis; roles?: WeeklyRoles }): boolean => q.basis === 'upcoming' || Array.isArray(q.roles)

// ═══════════════════════════════════════════════════════════════════════════
// §4 The typed embedding: Expr<T, C> and builders
// ═══════════════════════════════════════════════════════════════════════════

/** `__c` is array-typed so the phantom stays covariant and survives C = never. */
export interface Expr<T, C extends Cap = never> {
  readonly term: Term
  readonly __t?: T
  readonly __c?: C[]
}
/** A literal: the only thing a table threshold accepts. */
export interface LitE<T> extends Expr<T> {
  readonly lit: Lit
}
const E = <T, C extends Cap = never>(term: Term): Expr<T, C> => ({ term })
const L = <T>(lit: Lit): LitE<T> => ({ term: { k: 'lit', lit }, lit })

export type TOf<X> = X extends Expr<infer T, Cap> ? T : never
export type COf<X> = X extends { readonly __c?: (infer C extends Cap)[] } ? C : never

let fresh = 0
const freshVar = (): VarName => `v${fresh++}` as VarName
/** Binders are written as TS lambdas (HOAS) and lowered to named variables. */
const bind = <A, R, CA extends Cap, CR extends Cap>(f: (x: Expr<A, CA>) => Expr<R, CR>): { as: VarName; body: Term } => {
  const as = freshVar()
  return { as, body: f(E<A, CA>({ k: 'var', name: as })).term }
}

// literals ─────────────────────────────────────────────────────────────────
export const q = <U extends Unit>(n: number, unit: U): LitE<Q<DimOf<U>>> => L({ k: 'q', v: canon(n, unit), unit })
/** Rate units the language can name and prose; a rate per day or per week is
 *  a clock conversion and does not exist. */
type RateOk<U extends Unit, P extends Unit> = [Rate<DimOf<U>, DimOf<P>>] extends [never] ? { readonly __rateError: `no rate ${U} per ${P}` } : unknown
/** A rate literal: "2.5 kg per rep". */
export const rate = <U extends Unit, P extends Unit>(n: number, unit: U, per: P & RateOk<U, P>): LitE<Q<Rate<DimOf<U>, DimOf<P>>>> =>
  L({ k: 'q', v: canon(n, unit, per), unit, per })
export const kg = (n: number) => q(n, 'kg')
export const lb = (n: number) => q(n, 'lb')
export const reps = (n: number) => q(n, 'rep')
export const sets = (n: number) => q(n, 'set')
export const sec = (n: number) => q(n, 's')
export const mins = (n: number) => q(n, 'min')
export const km = (n: number) => q(n, 'km')
export const rir = (n: number) => q(n, 'rir')
/** RPE is INPUT notation: it lowers to reps in reserve (10 − RPE) here. */
export const rpe = (n: number): LitE<Q<'effort'>> => L({ k: 'q', v: 10 - n, unit: 'rir', notation: 'rpe' })
export const pct = (n: number) => q(n, 'pct')
export const num = (n: number) => q(n, 'x')
export const wk = (n: number) => q(n, 'wk')
export const days = (n: number) => q(n, 'd')
export const deg = (n: number) => q(n, 'deg')
export const bpm = (n: number) => q(n, 'bpm')
export const yes: Expr<B> = E({ k: 'lit', lit: { k: 'bool', v: true } })
export const no: Expr<B> = E({ k: 'lit', lit: { k: 'bool', v: false } })
export const lvl = <S extends Scale>(scale: S, level: Scales[S]): LitE<Ord<S>> => L({ k: 'ord', scale, level })
/** A built-in enum tag. Author-declared enums tag through their EnumDecl. */
export const tag = <N extends EnumName>(name: N, t: Enums[N]): LitE<En<Enums[N]>> => L({ k: 'enum', name, tag: t })
/** An exercise is its registry id; label and logging type come from the registry. */
export const exercise = <I extends ExerciseId>(id: I): Expr<Ex<LoggingOf<I>>> => E({ k: 'lit', lit: { k: 'ref', kind: 'exercise', id } })
export const muscle = (id: string): LitE<Ref<'muscle'>> => L({ k: 'ref', kind: 'muscle', id })
export const slotRef = (id: string): LitE<Ref<'slot'>> => L({ k: 'ref', kind: 'slot', id })

/** Unit errors surface as this branded requirement on the second argument. */
type UnitOk<R extends Dim, A extends Dim, B2 extends Dim, Op extends string> = [R] extends [never]
  ? { readonly __unitError: `cannot ${Op} ${A} and ${B2}` }
  : unknown

// arithmetic ───────────────────────────────────────────────────────────────
const arith = (op: Extract<Term, { k: 'arith' }>['op'], a: Expr<unknown, Cap>, b: Expr<unknown, Cap>): Term => ({ k: 'arith', op, a: a.term, b: b.term })
export const add = <D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Q<D>, C1>, b: Expr<Q<NoInfer<D>>, C2>): Expr<Q<D>, NoInfer<C1 | C2>> =>
  E(arith('+', a, b))
export const sub = <D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Q<D>, C1>, b: Expr<Q<NoInfer<D>>, C2>): Expr<Q<D>, NoInfer<C1 | C2>> =>
  E(arith('-', a, b))
export const min = <D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Q<D>, C1>, b: Expr<Q<NoInfer<D>>, C2>): Expr<Q<D>, NoInfer<C1 | C2>> =>
  E(arith('min', a, b))
export const max = <D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Q<D>, C1>, b: Expr<Q<NoInfer<D>>, C2>): Expr<Q<D>, NoInfer<C1 | C2>> =>
  E(arith('max', a, b))
export const mul = <A extends Dim, B2 extends Dim, C1 extends Cap = never, C2 extends Cap = never>(
  a: Expr<Q<A>, C1>,
  b: Expr<Q<B2>, C2> & UnitOk<Mul<A, B2>, A, B2, 'multiply'>,
): Expr<Q<Mul<A, B2>>, NoInfer<C1 | C2>> => E(arith('*', a, b))
/** a as a fraction of b; absent when b is zero. */
export const ratio = <D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Q<D>, C1>, b: Expr<Q<NoInfer<D>>, C2>): Expr<Opt<Q<'one'>>, NoInfer<C1 | C2>> =>
  E({ k: 'ratio', a: a.term, b: b.term })
export const roundTo = <D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(
  a: Expr<Q<D>, C1>,
  step: Expr<Q<NoInfer<D>>, C2>,
  mode: 'down' | 'nearest' | 'up' = 'nearest',
): Expr<Q<D>, NoInfer<C1 | C2>> => E({ k: 'round', mode, a: a.term, step: step.term })

// comparison & logic ─────────────────────────────────────────────────────────
type Comparable = Q<Dim> | Ord<Scale>
const cmp = (op: Extract<Term, { k: 'cmp' }>['op']) =>
  <T extends Comparable, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<T, C1>, b: Expr<NoInfer<T>, C2>): Expr<B, NoInfer<C1 | C2>> =>
    E({ k: 'cmp', op, a: a.term, b: b.term })
export const lt = cmp('<')
export const le = cmp('<=')
export const eq = cmp('==')
export const ge = cmp('>=')
export const gt = cmp('>')
export const and = <C1 extends Cap = never, C2 extends Cap = never>(a: Expr<B, C1>, b: Expr<B, C2>): Expr<B, NoInfer<C1 | C2>> =>
  E({ k: 'logic', op: 'and', a: a.term, b: b.term })
export const or = <C1 extends Cap = never, C2 extends Cap = never>(a: Expr<B, C1>, b: Expr<B, C2>): Expr<B, NoInfer<C1 | C2>> =>
  E({ k: 'logic', op: 'or', a: a.term, b: b.term })
export const not = <C extends Cap = never>(a: Expr<B, C>): Expr<B, NoInfer<C>> => E({ k: 'not', a: a.term })
/** Enum equality (enums compare for == only; the verdict never compares). */
export const is = <T extends string, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<En<T>, C1>, b: Expr<En<NoInfer<T>>, C2>): Expr<B, NoInfer<C1 | C2>> =>
  E({ k: 'cmp', op: '==', a: a.term, b: b.term })

// control ──────────────────────────────────────────────────────────────────
export const iff = <T, C0 extends Cap = never, C1 extends Cap = never, C2 extends Cap = never>(
  c: Expr<B, C0>,
  a: Expr<T, C1>,
  b: Expr<NoInfer<T>, C2>,
): Expr<T, NoInfer<C0 | C1 | C2>> => E({ k: 'if', c: c.term, a: a.term, b: b.term })
const cases = (cs: object) => Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, (v as Expr<unknown, Cap>).term]))
/** Exhaustive by construction over the enum's tags, built-in or declared. */
export const match = <T extends string, C0 extends Cap, Cases extends { [K in T]: Expr<unknown, Cap> }>(
  on: Expr<En<T>, C0>,
  cs: Cases,
): Expr<TOf<Cases[T]>, NoInfer<C0 | COf<Cases[T]>>> => E({ k: 'match', on: on.term, cases: cases(cs) })
/** The only consumer of a verdict: all three arms, so silence (`unknown`) is
 *  always a decision the author wrote down. */
export const byVerdict = <C0 extends Cap, Cases extends { [K in VerdictTag]: Expr<unknown, Cap> }>(
  on: Expr<Verdict, C0>,
  cs: Cases,
): Expr<TOf<Cases[VerdictTag]>, NoInfer<C0 | COf<Cases[VerdictTag]>>> => E({ k: 'match', on: on.term, cases: cases(cs) })
export const letv = <A, R, C1 extends Cap = never, C2 extends Cap = never>(
  label: string,
  value: Expr<A, C1>,
  body: (x: Expr<A, C1>) => Expr<R, C2>,
): Expr<R, NoInfer<C1 | C2>> => {
  const b = bind(body)
  return E({ k: 'let', name: b.as, label, value: value.term, body: b.body })
}
export const named = <T, C extends Cap = never>(noun: string, e: Expr<T, C>): Expr<T, NoInfer<C>> => E({ k: 'named', noun, e: e.term })

// absence ──────────────────────────────────────────────────────────────────
export const some = <T, C extends Cap = never>(a: Expr<T, C>): Expr<Opt<T>, NoInfer<C>> => E({ k: 'some', a: a.term })
export const none = <T>(of: TyW<T>): Expr<Opt<T>> => E({ k: 'none', of: of.ty })
export const known = <A, R, C1 extends Cap = never, C2 extends Cap = never>(
  a: Expr<Opt<A>, C1>,
  body: (x: Expr<A, C1>) => Expr<R, C2>,
): Expr<Opt<R>, NoInfer<C1 | C2>> => {
  const b = bind(body)
  return E({ k: 'known', a: a.term, as: b.as, body: b.body, then: false })
}
export const knownThen = <A, R, C1 extends Cap = never, C2 extends Cap = never>(
  a: Expr<Opt<A>, C1>,
  body: (x: Expr<A, C1>) => Expr<Opt<R>, C2>,
): Expr<Opt<R>, NoInfer<C1 | C2>> => {
  const b = bind(body)
  return E({ k: 'known', a: a.term, as: b.as, body: b.body, then: true })
}
export const known2 = <A, A2, R, C1 extends Cap = never, C2 extends Cap = never, C3 extends Cap = never>(
  a: Expr<Opt<A>, C1>,
  b: Expr<Opt<A2>, C2>,
  body: (x: Expr<A, C1>, y: Expr<A2, C2>) => Expr<R, C3>,
): Expr<Opt<R>, NoInfer<C1 | C2 | C3>> => knownThen(a, (x) => known(b, (y) => body(x, y)))
export function orElse<T, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Opt<T>, C1>, b: Expr<Opt<NoInfer<T>>, C2>): Expr<Opt<T>, NoInfer<C1 | C2>>
export function orElse<T, C1 extends Cap = never, C2 extends Cap = never>(a: Expr<Opt<T>, C1>, b: Expr<NoInfer<T>, C2>): Expr<T, NoInfer<C1 | C2>>
export function orElse(a: Expr<unknown, Cap>, b: Expr<unknown, Cap>): Expr<unknown, Cap> {
  return E({ k: 'orElse', a: a.term, b: b.term })
}
/** Takes only parameters or literals, so in the embedding it can only sit in
 *  a definition body; the IR checker narrows that to library bodies. */
export const asReps = <C extends 'param' = never>(a: Expr<Q<'effort'>, C>): Expr<Q<'reps'>, NoInfer<C>> => E({ k: 'asReps', a: a.term })
export const neg = <D extends Dim, C extends Cap = never>(a: Expr<Q<D>, C>): Expr<Q<D>, NoInfer<C>> =>
  E({ k: 'arith', op: '*', a: a.term, b: { k: 'lit', lit: { k: 'q', v: -1, unit: 'x' } } })

// collections ──────────────────────────────────────────────────────────────
type AnyList<X> = List<X> | List1<X>
export const list1 = <T, C extends Cap = never>(of: TyW<T>, head: Expr<T, C>, ...rest: Expr<T, C>[]): Expr<List1<T>, NoInfer<C>> =>
  E({ k: 'list', of: of.ty, items: [head, ...rest].map((x) => x.term) })
export const nth = <T, C1 extends Cap = never, C2 extends Cap = never>(
  xs: Expr<List1<T>, C1>,
  i: Expr<Q<'one'>, C2> | Expr<Q<'weeks'>, C2>,
  overflow: 'hold' | 'cycle',
): Expr<T, NoInfer<C1 | C2>> => E({ k: 'nth', xs: xs.term, i: i.term, overflow })
export const allSlots: Expr<List<Ref<'slot'>>> = E({ k: 'keys', of: 'slots' })
export const allMuscles: Expr<List<Ref<'muscle'>>> = E({ k: 'keys', of: 'muscles' })
/** 0 … n−1: the key list for a computed wave. */
export const range = (n: number): Expr<List1<Q<'one'>>> => E({ k: 'range', n })
export const sumOver = <X, D extends Dim, C1 extends Cap = never, C2 extends Cap = never>(
  xs: Expr<AnyList<X>, C1>,
  body: (x: Expr<X, 'elem'>) => Expr<Q<D>, C2>,
): Expr<Q<D>, NoInfer<C1 | Exclude<C2, 'elem'>>> => {
  const b = bind(body)
  return E({ k: 'sum', xs: xs.term, as: b.as, body: b.body })
}
export function tabulate<T, C1 extends Cap = never, C2 extends Cap = never>(keys: Expr<List1<Q<'one'>>, C1>, body: (i: Expr<Q<'one'>, 'elem'>) => Expr<T, C2>): Expr<List1<T>, NoInfer<C1 | Exclude<C2, 'elem'>>>
export function tabulate<K extends Exclude<RefKind, 'exercise'>, T, C1 extends Cap = never, C2 extends Cap = never>(keys: Expr<List<Ref<K>>, C1>, body: (k: Expr<Ref<K>, 'elem'>) => Expr<T, C2>): Expr<Map_<K, T>, NoInfer<C1 | Exclude<C2, 'elem'>>>
export function tabulate(keys: Expr<unknown, Cap>, body: (k: never) => Expr<unknown, Cap>): Expr<unknown, Cap> {
  const b = bind(body as (k: Expr<unknown, 'elem'>) => Expr<unknown, Cap>)
  return E({ k: 'tabulate', keys: keys.term, as: b.as, body: b.body })
}
export const at = <K extends Exclude<RefKind, 'exercise'>, T, C1 extends Cap = never, C2 extends Cap = never>(m: Expr<Map_<K, T>, C1>, key: Expr<Ref<K>, C2>): Expr<Opt<T>, NoInfer<C1 | C2>> =>
  E({ k: 'at', m: m.term, key: key.term })
export const foldOver = <X, S, C0 extends Cap = never, C1 extends Cap = never, C2 extends Cap = never>(
  xs: Expr<AnyList<X>, C1>,
  init: Expr<S, C0>,
  step: (acc: Expr<S, 'elem'>, x: Expr<X, 'elem'>) => Expr<S, C2>,
): Expr<S, NoInfer<C0 | C1 | Exclude<C2, 'elem'>>> => {
  const acc = freshVar()
  const x = freshVar()
  return E({ k: 'fold', xs: xs.term, init: init.term, acc, x, step: step(E({ k: 'var', name: acc }), E({ k: 'var', name: x })).term })
}
/** `max` is a JS number, not a term: the loop bound is a literal by construction. */
export const allocate = <Cn extends Cap = never, Ci extends Cap = never, Ca extends Cap = never, Cs extends Cap = never, Cc extends Cap = never>(spec: {
  n: Expr<Q<'sets'>, Cn>
  into: Expr<Map_<'slot', Q<'sets'>>, Ci>
  among: Expr<List<Ref<'slot'>>, Ca>
  score: (s: Expr<Ref<'slot'>, 'elem'>) => Expr<Q<'one'>, Cs>
  cap: (s: Expr<Ref<'slot'>, 'elem'>) => Expr<Q<'sets'>, Cc>
  max: number
}): Expr<Map_<'slot', Q<'sets'>>, NoInfer<Cn | Ci | Ca | Exclude<Cs | Cc, 'elem'>>> => {
  const as = freshVar()
  const s = E<Ref<'slot'>, 'elem'>({ k: 'var', name: as })
  return E({ k: 'allocate', n: spec.n.term, into: spec.into.term, among: spec.among.term, as, score: spec.score(s).term, cap: spec.cap(s).term, max: spec.max })
}

// tables: one IR former, spelled by key sort ───────────────────────────────
/** An ordinal key: one row per level, exhaustive. */
export function table<S extends Scale, C0 extends Cap, Rows extends { [Lv in Scales[S]]: Expr<unknown, Cap> }>(key: Expr<Ord<S>, C0>, rows: Rows): Expr<TOf<Rows[Scales[S]]>, NoInfer<C0 | COf<Rows[Scales[S]]>>>
/** A quantity key: literal, ascending, inclusive thresholds; `otherwise` above. */
export function table<D extends Dim, T, C0 extends Cap = never, C1 extends Cap = never>(key: Expr<Q<D>, C0>, rows: [upTo: LitE<Q<NoInfer<D>>>, value: Expr<T, C1>][], otherwise: Expr<NoInfer<T>, C1>): Expr<T, NoInfer<C0 | C1>>
/** A ref key: a row per id; `otherwise` for every other id. */
export function table<K extends Exclude<RefKind, 'exercise'>, T, C0 extends Cap = never, C1 extends Cap = never>(key: Expr<Ref<K>, C0>, rows: Record<string, Expr<T, C1>>, otherwise: Expr<NoInfer<T>, C1>): Expr<T, NoInfer<C0 | C1>>
export function table(key: Expr<unknown, Cap>, rows: unknown, otherwise?: Expr<unknown, Cap>): Expr<unknown, Cap> {
  const tableRows: TableRow[] = Array.isArray(rows)
    ? (rows as [LitE<unknown>, Expr<unknown, Cap>][]).map(([u, v]) => ({ when: u.lit, then: v.term }))
    : Object.entries(rows as Record<string, Expr<unknown, Cap>>).map(([k, v]) => ({ when: otherwise ? k : Number(k), then: v.term }))
  return E({ k: 'table', key: key.term, rows: tableRows, otherwise: otherwise?.term ?? null, overflow: null })
}
/** Embedding sugar for a table keyed by the progress clock: row i is block
 *  (or training) week i. */
export const schedule = <T, C extends Cap = never>(clock: 'week' | 'trainWeek', overflow: 'hold' | 'cycle', ...rows: Expr<T, C>[]): Expr<T, NoInfer<C | 'pos'>> =>
  E({ k: 'table', key: { k: 'pos', field: clock }, rows: rows.map((r) => ({ when: null, then: r.term })), otherwise: null, overflow })
// ═══════════════════════════════════════════════════════════════════════════
// §5 Named definitions: the only functions (D2)
// ═══════════════════════════════════════════════════════════════════════════

export type ExprsC<P, C extends Cap> = { [K in keyof P]: Expr<P[K], C> }
export type TyWs<P> = { [K in keyof P]: TyW<P[K]> }

/** A prose template with `{name}` holes. Checker law: holes = params. Only a
 *  library definition's template renders; a user definition renders its
 *  generated mechanism prose (the template is the one place copy can lie
 *  about behavior, so it is unlocked by library review, not by authoring). */
export type Template = string

export interface Example {
  args: Record<string, Term>
  gives: Term
}

/** Enums a definition declares for itself: name → tags in declaration order. */
export type EnumDecls = Record<string, readonly string[]>
export const enumDecls = (ds: readonly EnumDecl<string>[] = []): EnumDecls => Object.fromEntries(ds.map((d) => [d.name, d.values]))

export interface FnDef {
  kind: 'fn'
  ref: DefRef
  params: Record<string, Ty>
  /** CONFIGURABILITY ROUND (declaration field, no new former): a param with a
   *  default (a closed literal term) may be omitted by a call, a Use or an
   *  example, and the template need not name it; a non-default argument for a
   *  hole-less defaulted param is appended to the rendered template. Omitted
   *  when empty, so a definition without defaults is byte-identical. */
  defaults?: Record<string, Term>
  result: Ty
  says: Template
  enums: EnumDecls
  /** ≥1, closed values; the checker EVALUATES each before publication. */
  examples: [Example, ...Example[]]
  body: Term
}

/** A call may omit any defaulted parameter. */
export type ArgsWith<P, D, C extends Cap> = ExprsC<Omit<P, D & keyof P>, C> & Partial<ExprsC<Pick<P, D & keyof P>, C>>
/** The value a default for K must have: P[K], once K is known to be a param. */
export type DefaultOf<P, K> = K extends keyof P ? Expr<P[K]> : never
export interface Fn<P, R, D = never> {
  <C extends Cap = never>(args: ArgsWith<P, D, C>): Expr<R, NoInfer<C>>
  readonly def: FnDef
}

export function fn<P, R, const D extends string = never>(spec: {
  id: string
  version: number
  params: TyWs<P>
  /** Closed literal values; a call, Use or example may then omit the param. */
  defaults?: { [K in D]: DefaultOf<NoInfer<P>, K> }
  result: TyW<R>
  says: Template
  enums?: readonly EnumDecl<string>[]
  examples: [{ args: ExprsC<P, Cap>; gives: Expr<R, Cap> }, ...{ args: ExprsC<P, Cap>; gives: Expr<R, Cap> }[]]
  body: (p: ExprsC<P, 'param'>) => Expr<R, FnCap>
}): Fn<P, R, D> {
  const ref: DefRef = { id: spec.id as DefId, version: spec.version }
  const names = Object.keys(spec.params) as (keyof P & string)[]
  const paramExprs = Object.fromEntries(names.map((n) => [n, E({ k: 'param', name: n })])) as unknown as ExprsC<P, 'param'>
  const lower = (args: Partial<Record<string, Expr<unknown, Cap>>>) => Object.fromEntries(names.flatMap((n) => (args[n] ? [[n, args[n]!.term] as const] : [])))
  const defaults = spec.defaults && Object.keys(spec.defaults).length ? { defaults: lower(spec.defaults as Record<string, Expr<unknown, Cap>>) } : {}
  const def: FnDef = {
    kind: 'fn',
    ref,
    params: Object.fromEntries(names.map((n) => [n, (spec.params[n] as TyW<unknown>).ty])),
    ...defaults,
    result: spec.result.ty,
    says: spec.says,
    enums: enumDecls(spec.enums),
    examples: spec.examples.map((ex) => ({ args: lower(ex.args as Record<string, Expr<unknown, Cap>>), gives: ex.gives.term })) as FnDef['examples'],
    body: spec.body(paramExprs).term,
  }
  const call = <C extends Cap = never>(args: ArgsWith<P, D, C>): Expr<R, NoInfer<C>> => E({ k: 'app', def: ref, args: lower(args as Record<string, Expr<unknown, Cap>>) })
  return Object.assign(call, { def })
}

/** The metric value sort, and the fact sort, for the embedding. */
export type MetricTy<M extends MetricId> = Metrics[M]
export type FactTy<F extends keyof Facts> = Facts[F]['ty']

/** Lift an IR term into the embedding. Used only by structure.ts builders,
 *  never by programs; the IR checker re-checks every term whatever TS believed. */
export { E as exprOfTerm, UNITS }
