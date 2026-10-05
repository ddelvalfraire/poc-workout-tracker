/**
 * engine.ts — the semantics hub: the laws, the refusal taxonomy, and the
 * runtime data shapes every engine operation shares (values, traces, issued
 * facts, events, the head, transitions, projections).
 *
 * The engine is a small interpreter. It knows NO training method: 5/3/1,
 * GZCLP, RP, OPT, Couch to 5K and a tendon-rehab protocol are definitions in
 * the language. Its size is proportional to the number of term formers (47)
 * and registry entries, not to the number of methods. It RUNS:
 *   evaluate.ts   evaluate (all 47 formers), traces, explain
 *   issue.ts      the sink, session transformers, prescribe, resolveLive, currentView
 *   step.ts       activate, step (handlers, patches, outcome policies, proposals,
 *                 the progress clock), ingest, replay, exportsOf
 *   project.ts    project (asPrescribed, allMiss, repeatLast, asScheduled, script),
 *                 scheme examples
 *   checker.ts / checkdefs.ts  check (examples evaluated at publication)
 *   describe.ts / describe-defs.ts / describe-run.ts  the renderers
 *   time.ts       reconcile, adherence, the due verdict
 * Still a signature only: content hashing and de Bruijn elaboration, WIDGETS,
 * irSchema, describeDiff (see rationale, "Not finished").
 *
 * LAWS (each has a property test in the implementation plan)
 *  L1 Totality.     Every well-typed term evaluates in finite time: no
 *                   fixpoint former; `app` resolves only versions published
 *                   BEFORE the caller (a DAG by time, checked: futureRef);
 *                   every iteration ranges over a finite collection or a
 *                   LITERAL bound; accumulators are ground.
 *  L2 Determinism.  evaluate is a pure function of (term, env). Ties in
 *                   pick/allocate break by declaration order; allocate's
 *                   full semantics are normative on its former (algebra.ts).
 *  L3 Single writer. Each state field DECLARES its writers (writableBy). A
 *                   patch may name a field only if the firing handler is
 *                   listed; an owner edit only if 'owner' is listed.
 *  L4 Commutation.  All handlers fired by one event read the same pre-state
 *                   and write disjoint fields. Structural: a handler yields
 *                   ONE patch record (keys unique), slot and program scopes
 *                   own disjoint state, and policies never write.
 *  L5 Idempotence.  The ledger is a set keyed by causeKey; a duplicate is a
 *                   no-op. State = fold of the ledger in INGESTION order.
 *                   Reconciliation is a set of per-day causeKeys; expectations
 *                   and adherence are keyed (instance, rule, window); progress
 *                   events are emitted atomically with the closure causing them.
 *  L6 Facts.        Issued prescriptions, due verdicts, expectations and
 *                   adherence are immutable. An open field closes by an
 *                   append-only Resolution; a late session appends an
 *                   AdherenceAmendment. Handlers read the issued snapshot.
 *  L7 Silence.      Absence is typed (Opt); a stale fact is absent. Sinks turn
 *                   absence into a silent target whose trace names the cause.
 *  L8 Describability. DESCRIBERS, DECL_DESCRIBERS and WIDGETS are total; every
 *                   library FnDef's holes equal its params and its examples
 *                   evaluate; every expression fits the phrase budget.
 *  L9 Honest projection. Every projected value is tagged with its assumption
 *                   model; `asScheduled` lays sessions on nominal days ("at 3
 *                   a week this block ends 20 Dec"); projection never writes.
 *  L10 Dose.        At the set sink, the weeks of the program's declared
 *                   stripIntensifierOn roles (default deload/taper/test) drop
 *                   the session's intensifier. The one-intensifier dose law
 *                   itself is not configurable.
 *  L11 Training causes progress. The progress clock advances only on closed
 *                   training, an owner skip, or an `anchored` week end. A slot
 *                   boundary handler with no completed session of that slot
 *                   in its window records keep(untrained) and does not run.
 *  L12 Stamped reads. No term reads "now" or the live store. Every calendar
 *                   read evaluates at a stamped LocalDay, and every fact a
 *                   handler reads is the snapshot carried on its event; each
 *                   read is stamped with its value on the fact it produced.
 *  L13 Time alone never commits. Handlers on calendar-caused events
 *                   (periodClosed, lapse) may only propose or keep.
 */
import type { BoundIR, Cap, Clock, DefRef, Lit, RefKind, StepId, Term, Ty, Unit } from './algebra'
import type { DimVec } from './units'
import type { Enums, LoggingType, MetricId, Scale } from './registry'
import type { AggEventKind, AnyDef, HitPolicy, SchemeDef, SlotEventKind, WeekRole, Writer } from './structure'
import type { AdherenceWeeks, CalQuery, CalendarState, Due, InstanceStatus, LocalDay, Selector } from './time'

const notImplemented = (what: string): never => {
  throw new Error(`not implemented: ${what}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// §1 Checking and elaboration
// ═══════════════════════════════════════════════════════════════════════════

/** Where a term sits, and so which capabilities it is granted (algebra §2). */
export type Position = 'fnBody' | 'init' | 'plan' | 'live' | 'handler' | 'aggregate' | 'bind' | 'handoff' | 'policy' | 'cadence' | 'example'

/** The phrase budget (D4). Calibrated on the worked programs; re-run as the
 *  library grows. Division stays out of v1 (D10). */
export const BUDGET = 4
export const OVER_BUDGET_FIX = 'name an intermediate quantity: wrap a subterm in named(noun, …) or bind it with a labeled let' as const

/**
 * A machine-checkable refusal: the MCP error channel. `path` addresses the
 * offending node in the IR JSON, so an LLM can repair exactly that node. Each
 * code carries the fields its repair needs.
 */
export type TypeError = { path: (string | number)[]; message: string } & (
  | { code: 'unitMismatch'; expected: Ty; got: Ty }
  | { code: 'notComparable'; got: Ty }
  | { code: 'absenceUnhandled'; got: Ty }
  | { code: 'unknownName'; name: string }
  | { code: 'missingArg'; param: string }
  | { code: 'forwardStepRef'; step: string }
  | { code: 'capabilityEscape'; cap: Cap; position: Position }
  | { code: 'notOwner'; field: string }
  | { code: 'notWritableHere'; field: string; writer: Writer | AggEventKind; writableBy: Writer[] }
  | { code: 'undeclaredFact'; fact: string }
  | { code: 'nonGroundAccumulator'; got: Ty }
  | { code: 'nonExhaustive'; missing: string[] }
  | { code: 'boundNotLiteral'; got: unknown }
  | { code: 'templateHoles'; extra: string[]; missing: string[] }
  | { code: 'exampleFailed' }
  | { code: 'futureRef'; ref: DefRef } //                    app of itself, a later version, or anything not published before
  | { code: 'peakNeedsFixed'; phase: string }
  | { code: 'overBudget'; cost: number; budget: number; fix: typeof OVER_BUDGET_FIX }
  | { code: 'metricNotLogged'; metric: string; logging: string } //      a load on a timed hold; capEffort on a run
  | { code: 'shapeNotAllowed'; metric: string; shape: string } //       a heart rate given as one exact number
  | { code: 'scopedFormer'; former: string } //                         asReps outside a library body
  | { code: 'infeasibleFrequency'; a: number; b: number | null; why: string }
  | { code: 'timeCommit' } //                                           a periodClosed handler that commits
  | { code: 'anchoredRequired' } //                                     peakOn under slide drift
  | { code: 'restOwnedByGroup'; slot: string } //                       a member set's own rest inside a group
  | { code: 'windowTooLong'; days: number } //                          cal.recent beyond 56 days
  | { code: 'primaryMuscle'; slot: string; primaries: number } //       a slot needs exactly one primary muscle
  | { code: 'boundsInverted'; min: number; max: number } //             bounded phase with min > max
  | { code: 'openNotLast'; phase: string }
  | { code: 'fixedNeedsOnce'; phase: string } //                        a fixed phase over a cycling calendar
  | { code: 'emomNeedsFixedCount'; slot: string }
  | { code: 'importMismatch'; param: string; why: string }
  // new in v3
  | { code: 'clockMix'; message: string } //                           progress meets calendar, or a calendar value used as a magnitude
  | { code: 'clockRate'; unit: string; per: string } //                 a rate per day or per week
  | { code: 'loggingMismatch'; from: string; to: string; metrics: string[] } // a swap that would target metrics the new exercise does not log
  | { code: 'nExceedsMax'; n: number; max: number } //                  allocate asked for more units than its bound can deliver
  | { code: 'unlabeledLet' } //                                         a let with no label: budget and prose boundaries must coincide
  | { code: 'thresholdOrder'; at: number } //                           a threshold row not strictly above the one before (dead or unsorted)
  | { code: 'tableShape'; why: string } //                              rows or overflow/otherwise that do not fit the key's sort
  | { code: 'roleDoubleEncoding'; role: string; slot: string } //       a plan branching on a week role the program also transforms
  | { code: 'noSuchKind'; kind: string } //                             an outcome rule naming a kind no state field has
  | { code: 'policyOrder'; at: number } //                              policies out of the one application order
  // new in R2 (the evaluator's domain, decided at check where it is literal)
  | { code: 'literalDomain'; former: string; field: string; value: number | string } // round step ≤ 0, a negative or fractional nth index, a session with no steps
)

/** Refusals at ingestion: the engine never applies these events. */
export type IngestRefusal =
  /** EC-177: a session closed with zero logged sets is a typed NON-EVENT. No
   *  rule fires, no streak moves, nothing is hit or missed, no gap resets. */
  | { code: 'emptySession'; workoutId: string }
  /** The client's day stamp is more than one day from the instant's UTC date. */
  | { code: 'dayStampOutOfRange'; stamped: LocalDay; utc: string }
  /** EC-161: prescribing past the end of a `once` calendar. */
  | { code: 'programComplete' }
  /** A phase advanced by the owner before its time floor without the explicit
   *  confirmation the warning asks for. Never a hard lock: confirming advances. */
  | { code: 'floorNotConfirmed'; floorDays: number }
  // new in R2
  /** A day stamp that is not a real calendar date (2026-02-30). */
  | { code: 'notALocalDay'; stamped: string }
  /** Prescribing or logging into an abandoned instance. */
  | { code: 'instanceClosed'; status: InstanceStatus }
  /** An owner edit of a field whose writableBy does not list 'owner', or an
   *  edit clearing a field that is not optional. */
  | { code: 'notOwnerWritable'; scope: string; field: string }
  /** A rebind to a scheme whose state declaration differs: the frozen grammar
   *  has no record sort, so a migration cannot be written; refused, never guessed. */
  | { code: 'rebindNeedsMigration'; slot: string; fields: string[] }
  // new in the configurability fix round
  /** An instance-activation override outside its domain, or one spelling the
   *  program's own value (one form per meaning); returned typed, never thrown (Y9). */
  | { code: 'badOverride'; option: string; value: number | string }

/** The elaborated, content-addressed form: the ONLY input of every engine
 *  operation below. */
export interface Elaborated<D extends AnyDef = AnyDef> {
  readonly hash: string & { readonly __hash: true }
  readonly def: D
  /** What the shell must load: facts, peers, program fields, and the longest
   *  calendar window any read needs (`cal.recent`), so history loads are bounded. */
  readonly reads: {
    facts: { fact: string; keyed: boolean }[]
    peers: { slot: string; field: string }[]
    programFields: string[]
    calWindow: number
    /** Every selector a `cal.gap`/`cal.recent` read names: the calendar
     *  keeps a last day for each (time.ts CalendarSpec.tracked). */
    selectors: Selector[]
  }
  readonly writers: Record<string, { on: SlotEventKind | AggEventKind; branch: Term; mode: 'commit' | 'propose' }[]>
}

/** The content-addressed registry the elaborated form will live in. The
 *  running engine uses the publication log (checker.ts `Registry`) until
 *  content hashing lands. */
export type ElaboratedRegistry = ReadonlyMap<string, Elaborated>

// ═══════════════════════════════════════════════════════════════════════════
// §2 Values and traces (D3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A runtime value. Absence is FLATTENED: a present optional value is its
 * value, and `none` carries why it is absent (the checker guarantees that no
 * arithmetic or comparison ever meets a `none`, so no `some` wrapper is
 * needed at runtime). A quantity holds its CANONICAL number beside its
 * vector, its display unit and its clock.
 */
export type Value =
  | { v: 'q'; n: number; dim: DimVec; unit: Unit | null; per?: Unit; clock?: Clock; notation?: 'rpe' }
  | { v: 'bool'; b: boolean }
  | { v: 'ord'; scale: Scale; level: number }
  | { v: 'enum'; name: string; tag: string }
  | { v: 'ref'; kind: RefKind; id: string }
  | { v: 'none'; cause: Absence }
  | { v: 'list'; items: Value[] }
  | { v: 'map'; entries: [string, Value][] }
  | { v: 'set'; t: IssuedTarget }
  | { v: 'session'; s: SessionValue }
  | { v: 'technique'; t: IssuedTechnique }
  | { v: 'tempo'; t: Tempo4 }
  | { v: 'patch'; fields: Record<string, { value: Value; mode: 'commit' | 'propose' }> }

export type Tempo4 = [number, number, number, number]
export interface IssuedTechnique {
  kind: Extract<Term, { k: 'technique' }>['kind']
  stages: IssuedTarget[]
}
/** A session as a value: what a plan evaluates to and a transformer maps. */
export interface SessionValue {
  exercise: Value
  steps: IssuedStep[]
  intensifier: IssuedTechnique | null
}

/** Why a value is absent: the leaf of a silence trace. */
export type Absence =
  | { k: 'factUnknown'; fact: string; key: string | null }
  | { k: 'factStale'; fact: string; observedOn: LocalDay; maxAgeDays: number }
  | { k: 'stateUnset'; field: string; noun?: string }
  | { k: 'declaredNone' } //          a literal `none` (a parameter bound to nothing)
  | { k: 'notPerformed'; step: string }
  | { k: 'notTargeted'; step: string; metric: string } // the issued target names no such bound
  | { k: 'emptyPick' }
  | { k: 'missingKey'; key: string }
  | { k: 'zeroDenominator' }
  | { k: 'noPriorSession' } //       cal.gap before the first matching occurrence
  | { k: 'outOfDomain'; field: string; value: number }
  | { k: 'ownerCleared'; field: string }
  | { k: 'roleExcluded'; role: WeekRole } // a weekly read whose roles filter leaves this week out
  | { k: 'noUpcomingWeek' } //       an upcoming weekly read in a once calendar's final week
  | { k: 'outsideFormulaDomain'; formula: string; reps: number; cap?: number } // an e1RM read where NO logged set qualifies: out-of-domain sets are skipped (Y6), so this names the best offender, and `cap` when the program's declared maxReps was the binding limit

/** An evaluation, node by node. `def` marks a named-definition boundary (the
 *  trace is cut there at intent zoom); `note` records a decision the value
 *  alone does not show (units dropped by allocate, a skipped rounding). */
export interface Trace {
  node: Term
  value: Value
  kids: Trace[]
  def?: DefRef
  note?: string
}

/** A fact as read: the value, when it was observed. */
export interface FactReading {
  fact: string
  key: string | null
  value: Value
  observedOn: LocalDay
}
export interface FactSource {
  get(fact: string, key: string | null): FactReading | null
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 Issuance: plan → immutable prescription (the sink)
// ═══════════════════════════════════════════════════════════════════════════

/** The non-live reads an open field's term makes, captured at issue: params,
 *  state, peers, program fields, facts, the position and the calendar, keyed
 *  by the read node, plus the binder variables in scope. Resolution evaluates
 *  the field's own term against this frame and the LOGGED sets, so a live
 *  value is computed from the same inputs the prescription was. */
export interface Frame {
  vars: Record<string, Value>
  reads: Record<string, Value>
}

/** An issued bound, canonical units. */
export type IssuedBound = { b: 'exact'; v: number } | { b: 'range'; min: number; max: number } | { b: 'atLeast'; v: number } | { b: 'atMost'; v: number } | { b: 'open' }

export type Field =
  | { k: 'fixed'; v: IssuedBound }
  | { k: 'silent'; cause: Absence }
  /** Reads a performed set: resolved live. `planned` is its value under
   *  asPrescribed (what projection and the ghost show before you log). */
  | { k: 'open'; bound: BoundIR; frame: Frame; planned: Extract<Field, { k: 'fixed' | 'silent' }>; dependsOn: string[] }

/** Metric-keyed: a run issues distance and pace, a hold issues duration, a
 *  lift issues reps, load and effort, all through one record. */
export interface IssuedTarget {
  role: Enums['setRole']
  metrics: Partial<Record<MetricId | string, Field>>
  restSec: number | null
  tempo: Tempo4 | null
  cluster: { per: number; intraRestSec: number } | null
}

/** A count range issues both edges (volume reads the floor). An until/while
 *  step issues `max` set slots and its condition, decided live. */
export interface IssuedStep {
  id: StepId
  /** The key its logged sets are filed under: the id, or id@iteration in a repeat block. */
  key: string
  count: { k: 'n'; n: number } | { k: 'range'; min: number; max: number } | { k: 'until' | 'while'; max: number; planned: number }
  sets: IssuedTarget[]
  block: { id: StepId; iteration: number } | null
  /** until/while: the stop or go condition, evaluated live against the frame. */
  live: { cond: Term; frame: Frame } | null
}

export interface Resolution {
  /** issueKey:slot:stepKey:index:metric@digest of the dependencies' values
   *  (canonical JSON, canonical.ts). A cell's LATEST row (by seq) decides:
   *  any other dependency values get a NEW row that supersedes (EC-186),
   *  including a revert to values an older row saw, so a key may recur. */
  readonly key: string
  /** Position in the issue's append-only resolution log: 1 + the largest seq
   *  before it. The view is the latest row per cell by seq (F3). */
  readonly seq: number
  readonly issueKey: string
  readonly slot: string
  readonly step: string
  readonly index: number
  readonly metric: string
  readonly value: Extract<Field, { k: 'fixed' | 'silent' }>
  readonly trace: Trace
}

export interface IssuedSlot {
  slot: string
  exercise: { id: string; label: string; logging: LoggingType } | { silent: Absence }
  steps: IssuedStep[]
  intensifier: IssuedTechnique | null
  trace: Trace
}

export interface Stamp {
  programHash: string
  stateSeq: number
  position: ProgressPosition
  /** The day the client stamped at prescribe: every calendar read used it. */
  issuedOn: LocalDay
  factsRead: FactReading[]
  calReads: { q: CalQuery; value: Value }[]
  /** The plan policies applied, in the one application order, after the
   *  program's hit policy (`first` keeps one per channel). */
  hitPolicy: HitPolicy
  policies: number[]
  phaseTransform: DefRef | null
  /** The quantization grids, canonical; resolution quantizes with them too. */
  grids: { load?: number; distance?: number }
  /** U2: per-slot grid overrides, present only when a slot declares its own
   *  grids: that slot's steps (canonical) and display units, exactly as the
   *  sink issued under them; resolution reads the stamp, never re-deriving,
   *  and the issued values' display unit IS the slot grid's unit (U-L2). */
  slotGrids?: Record<string, { grids: { load?: number; distance?: number }; display: Partial<Record<string, Unit>> }>
  /** The program's declared tie direction for exact bounds (present only when
   *  'up'); resolution quantizes with it too, never re-deriving (C6). */
  ties?: 'up'
  /** The program's declared estimator (present only when declared); live
   *  resolution of an open field computes with it too, never re-deriving (Y7). */
  e1rm?: { formula: string; maxReps?: number }
  /** The unit each metric displays in: the grid's unit where there is one. */
  display: Partial<Record<string, Unit>>
}
export interface ProgressPosition {
  week: number
  trainWeek: number
  role: WeekRole
  slotSessions: Record<string, number>
  phase: string | null
}

export interface IssuedSession {
  readonly issueKey: string
  readonly day: string
  /** The shell's default day for this session; a different `day` is recorded, never corrected. */
  readonly defaultDay: string
  readonly slots: IssuedSlot[]
  readonly stamp: Stamp
  /** Soft: "Rest today. Your next workout is due Thursday." */
  readonly due: Due
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 Transitions: events, ledger, head
// ═══════════════════════════════════════════════════════════════════════════

/** A performed set, metric-keyed. `values.load` is the RAW logged mass;
 *  effective load is derived from the exercise's logging type. There is no
 *  completion flag: the boundary drops a set the athlete did not complete
 *  before it becomes a PerformedSet (issue.ts `boundaryLogged`, F14). */
export interface PerformedSet {
  values: Partial<Record<MetricId | string, number>>
  /** Intensifier mini-set outcomes on the final set (D11). */
  stages: { reps: number }[] | null
}
/** Logged sets per slot, per issued step key. */
export type Logged = Record<string, Record<string, PerformedSet[]>>

/** What a handler can see: the issued fact, what happened, and the facts it
 *  may read, SNAPSHOTTED at close (L12). Never the live store. */
export interface ClosedFacts {
  workoutId: string
  issued: IssuedSession
  resolutions: Resolution[]
  performed: Logged
  facts: FactReading[]
  groupScores: Record<string, { time?: number; rounds?: number }>
  /** The day the session STARTED (a midnight-crossing session belongs to it). */
  localDay: LocalDay
  /** This instance's sessions already closed that day (0 for the first). */
  earlierToday: number
  startedEarly: boolean
}

export interface Instance {
  id: string
  anchor: LocalDay
  activatedOn: LocalDay
  /** The activation overrides, recorded on the instance so a replay that
   *  rebuilds the runtime from this record sees the SAME calendar spec and
   *  window geometry as the original activation (Y9); omitted when none. */
  overrides?: { lapseAfterDays?: number; adherenceWeeks?: AdherenceWeeks }
  /** The predecessor run whose exports seed this instance's imports. */
  predecessor: string | null
}

/** What can be ingested. Progress events (weekEnd, cycleEnd, blockEnd) and
 *  periodClosed are never ingested: `step` emits them in the same transition
 *  as the closure that causes them (L11), under their own causeKeys. */
export type Event =
  | { k: 'sessionClosed'; causeKey: `session:${string}`; facts: ClosedFacts }
  | { k: 'dayClosed'; causeKey: `day:${string}:${LocalDay}`; day: LocalDay }
  | { k: 'skip'; causeKey: `skip:${string}`; slot: string }
  | { k: 'pause'; causeKey: `pause:${string}`; from: LocalDay; until: LocalDay | null }
  | { k: 'resume'; causeKey: `resume:${string}`; on: LocalDay }
  | { k: 'abandon'; causeKey: `abandon:${string}`; on: LocalDay }
  | { k: 'ownerEdit'; causeKey: `edit:${string}`; scope: string; patch: Record<string, Lit | null> }
  | { k: 'proposalDecided'; causeKey: `decision:${string}`; proposalKey: string; accepted: boolean }
  | { k: 'rebind'; causeKey: `rebind:${string}`; slot: string; to: DefRef; args: Record<string, Term> }
export type EmittedKind = 'weekEnd' | 'cycleEnd' | 'blockEnd' | 'periodClosed'

/** A pending proposal: the values SNAPSHOTTED when proposed, the values the
 *  fields had then, and the handler that proposed them (the writer of
 *  record). Accepting applies the snapshot only if every proposed field is
 *  still writable by that handler or by the owner (EC-146) and none has moved
 *  since (staleness, EC-143); a newer proposal on a field supersedes the
 *  older one (EC-144). */
export interface Proposal {
  key: string
  scope: string
  on: SlotEventKind
  fields: Record<string, Value>
  base: Record<string, Value>
  seq: number
  causeKey: string
}

export interface Progress {
  /** Block weeks closed since activation: pos.week (0-based). */
  week: number
  /** Sessions closed per slot: pos.slotSession. */
  slotSessions: Record<string, number>
  /** Rotation entries closed this block week (a session or an owner skip). */
  weekEntries: number
  /** Program sessions closed in total: the rotation cursor. */
  sessions: number
  /** Slots with a completed session this week / this cycle (L11). */
  weekSlots: string[]
  cycleSlots: string[]
}

export interface Head {
  seq: number
  /** Scope → field → value; scopes are slot names and `program`. */
  state: Record<string, Record<string, Value>>
  /** The program's activation arguments (imports already seeded). */
  params: Record<string, Value>
  /** Slot → its current binding (a rebind changes it). */
  bindings: Record<string, { scheme: DefRef; args: Record<string, Term> }>
  pending: Record<string, Proposal>
  progress: Progress
  status: InstanceStatus
  calendar: CalendarState
  instance: Instance
}

export interface Fired {
  scope: string
  on: SlotEventKind | 'owner' | 'decision'
  causeKey: string
  /** Per field: how it landed and every outcome policy that demoted it. */
  patch: Record<string, { value: Value; mode: 'commit' | 'propose' | 'keep' | 'void'; demotedBy: number[] }>
  /** The handler's trace: the condition path is the reason. */
  reason: Trace | null
  /** L11: a boundary handler of a slot with no session in its window. */
  skipped?: 'untrained'
}

export interface Transition {
  seq: number
  causeKey: string
  /** The progress and period events this closure emitted, by causeKey. */
  emitted: string[]
  fired: Fired[]
  /** What the handlers read, with values (amendment C): replay reproduces it. */
  factsRead: FactReading[]
  calReads: { q: CalQuery; value: Value }[]
  before: Head['state']
  after: Head['state']
}

export type IngestResult = { k: 'applied'; head: Head; transition: Transition } | { k: 'already'; seq: number } | { k: 'refused'; refusal: IngestRefusal }

// ═══════════════════════════════════════════════════════════════════════════
// §5 Analysis: projection and static questions
// ═══════════════════════════════════════════════════════════════════════════

export type Assume =
  | { k: 'asPrescribed' }
  | { k: 'allMiss' }
  | { k: 'repeatLast' }
  | { k: 'asScheduled' } //        sessions on nominal rotation days: answers "when does this end"
  | { k: 'script'; outcomes: { week: number; day: string; hit: boolean; amrapReps?: number }[] }

export interface Projection {
  assume: Assume
  weeks: { week: number; role: WeekRole; sessions: IssuedSession[]; endsOn: LocalDay | null; projected: true }[]
  changes: Transition[]
  /** Where the assumption could not apply as stated (repeatLast with no history). */
  fallbacks: string[]
}

export interface WriteEntry {
  scope: 'slot' | 'program'
  field: string
  on: SlotEventKind | AggEventKind
  mode: 'commit' | 'propose'
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 Renderers (signatures still open: WIDGETS, irSchema, describeDiff)
// ═══════════════════════════════════════════════════════════════════════════

export type Zoom = 'intent' | 'mechanism' | 'exact'

export type FormNode =
  | { w: 'paramForm'; def: DefRef; fields: { name: string; sort: Ty; value: FormNode }[] }
  | { w: 'quantity'; sort: Ty; value: Lit | null }
  | { w: 'picker'; sort: Ty; options: 'exercises' | 'slots' | 'muscles' | 'defsOfSignature'; value: string | null }
  | { w: 'table'; keySort: Ty; valueSort: Ty; rows: FormNode[][] }
  | { w: 'tree'; former: Term['k']; holes: { label: string; sort: Ty; child: FormNode }[] }
export type Widgets = { [K in Term['k']]: (node: Extract<Term, { k: K }>, expected: Ty) => FormNode }

export function describeDiff(before: AnyDef, after: AnyDef): string {
  return notImplemented('describeDiff')
}
export function irSchema(): object {
  return notImplemented('irSchema')
}

export type { SchemeDef, Elaborated as ElaboratedDef }
