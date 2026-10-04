/**
 * kit-schema.ts — the JSON Schema of the IR and of every runtime shape a
 * fixture carries, built from the package's own types and runtime mirrors,
 * plus the validator verify step 8 runs over every fixture.
 *
 * The builders are typed against the TS declarations: `union<U, D>` demands
 * one branch per discriminant of U and, per branch, exactly U's fields with
 * U's optionality, so a new former, refusal code, absence cause or field that
 * the schema does not describe fails tsc (step 1), not a review. Enumerations
 * come from the runtime mirrors (UNITS, SCALE_LEVELS, ENUM_VALUES,
 * LOGGING_TYPES, BASE_DIMS, GRANTS, VERDICT_TAGS), and DESCRIBERS is checked
 * against the Term union at generation time.
 */
import type { BoundIR, Count, DefRef, EventQuery, AggQuery, FnDef, Lit, StepIR, Term, Ty, XformOp, Cap, Example } from './algebra'
import type { Cx } from './describe'
import type { Absence, ClosedFacts, Event, Field, Fired, Frame, IngestRefusal, IngestResult, IssuedBound, IssuedSession, IssuedSlot, IssuedStep, IssuedTarget, IssuedTechnique, Head, Instance, PerformedSet, Progress, ProgressPosition, Proposal, Resolution, SessionValue, Stamp, Trace, Transition, TypeError, Value, Assume, Projection, WriteEntry, FactReading } from './engine'
import type { Ctx } from './evaluate'
import type { Scope } from './checker'
import type { EventSource } from './judge'
import type { Inputs, Reads, Runtime } from './ports'
import type { PhaseRun } from './project'
import type { ExerciseDecl, FactDecl, MetricDecl, ReducerDecl } from './registry'
import type { StepResult } from './step'
import type { AggregateDef, Calendar, ExportDecl, Group, ImportDecl, Length, MacroDef, OutcomeRule, PhaseDef, Policy, ProgramDef, SchemeDef, SchemeExample, SlotBinding, SlotMeta, StateDecl, Use } from './structure'
import type { Adherence, AdherenceAmendment, CalEvent, CalendarSpec, CalendarState, CalQuery, Due, Expectation, Frequency, Infeasible, Occurrence, Period, Rotation, Selector, SlotView } from './time'
import { GRANTS } from './checker'
import { DESCRIBERS } from './describe'
import { ENUM_VALUES, LOGGING_TYPES, SCALE_LEVELS, VERDICT_TAGS } from './registry'
import { BASE_DIMS, UNITS } from './units'
import { WEEKDAYS } from './time'
import { OPS, type J, type Op } from './kit'

// ── builders ────────────────────────────────────────────────────────────────

export type S = { readonly [k: string]: unknown } & { readonly $opt?: never }
interface Opt {
  readonly $opt: S
}
type Fields<X> = { [F in keyof X]-?: {} extends Pick<X, F> ? Opt : S }
type Branches<U, D extends keyof U> = { [K in U[D] & string]: Fields<Omit<Extract<U, Record<D, K>>, D>> }

const DEFS: Record<string, S> = {}
const ref = (name: string): S => ({ $ref: `#/$defs/${name}` })
const def = (name: string, s: S): S => {
  if (DEFS[name]) throw new Error(`schema: ${name} defined twice`)
  DEFS[name] = s
  return ref(name)
}
const opt = (s: S): Opt => ({ $opt: s })
const str: S = { type: 'string' }
const bool: S = { type: 'boolean' }
const nul: S = { type: 'null' }
const any: S = {}
const lit = (v: string | number | boolean): S => ({ const: v })
const pattern = (p: string): S => ({ type: 'string', pattern: p })
const arr = (items: S, minItems = 0): S => (minItems ? { type: 'array', items, minItems } : { type: 'array', items })
const tuple = (...items: S[]): S => ({ type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length, items: false })
const nullable = (s: S): S => ({ anyOf: [s, nul] })
const anyOf = (...ss: S[]): S => ({ anyOf: ss })
const rec = (v: S): S => ({ type: 'object', additionalProperties: v })
function obj(fields: Record<string, S | Opt>): S {
  const properties: Record<string, S> = {}
  const required: string[] = []
  for (const [k, f] of Object.entries(fields)) {
    if ('$opt' in f && f.$opt) properties[k] = f.$opt as S
    else {
      properties[k] = f as S
      required.push(k)
    }
  }
  return { type: 'object', properties, required, additionalProperties: false }
}
/** A record type checked field by field against X. */
const shape =
  <X>() =>
  (fields: Fields<X>): S =>
    obj(fields as Record<string, S | Opt>)
/** A discriminated union checked branch by branch against U. */
function union<U, D extends keyof U & string>(name: string, disc: D, branches: Branches<U, D>): S {
  const oneOf = Object.entries(branches as Record<string, Record<string, S | Opt>>).map(([tag, f]) => obj({ [disc]: lit(tag), ...f }))
  return def(name, { 'x-union': name, 'x-disc': disc, oneOf })
}
/** A union of named record schemas, dispatched by a field. */
const refUnion = (name: string, disc: string, names: string[]): S => def(name, { 'x-union': name, 'x-disc': disc, oneOf: names.map(ref) })
/** A string enumeration: total over T by the record's keys. */
const strs = <T extends string>(name: string, all: Record<T, true>): S => def(name, { 'x-enum': name, enum: Object.keys(all) })
const enumOf = (name: string, values: readonly (string | number)[]): S => def(name, { 'x-enum': name, enum: [...values] })

// ── wire forms ──────────────────────────────────────────────────────────────

const NonFinite = def('NonFinite', obj({ $num: { enum: ['Infinity', '-Infinity', 'NaN'] } }))
const num = def('Number', anyOf({ type: 'number' }, NonFinite))
const int: S = { type: 'integer' }
const setOf = (s: S) => obj({ $set: arr(s) })
const mapOf = (k: S, v: S) => obj({ $map: arr(tuple(k, v)) })
const FnTok = def('FnToken', obj({ $fn: str }))
const RegistryTok = def('RegistryToken', obj({ $registry: str }))
const day = def('LocalDay', pattern('^\\d{4}-\\d{2}-\\d{2}$'))

// ── vocabularies (runtime mirrors) ──────────────────────────────────────────

const Unit = enumOf('Unit', Object.keys(UNITS))
const BaseDim = enumOf('BaseDim', BASE_DIMS)
const DimVec = def('DimVec', { type: 'object', propertyNames: { enum: [...BASE_DIMS] }, additionalProperties: int })
const Scale = enumOf('Scale', Object.keys(SCALE_LEVELS))
const LoggingType = enumOf('LoggingType', LOGGING_TYPES)
const SetRole = enumOf('SetRole', ENUM_VALUES.setRole)
const WeekRole = enumOf('WeekRole', ENUM_VALUES.weekRole)
const Position = enumOf('Position', Object.keys(GRANTS))
const VerdictTag = enumOf('VerdictTag', VERDICT_TAGS)
const CapS = strs<Cap>('Cap', { param: true, state: true, peer: true, program: true, fact: true, pos: true, cal: true, performed: true, event: true, agg: true, elem: true })
const RefKind = strs<Extract<Ty, { t: 'ref' }>['kind']>('RefKind', { exercise: true, slot: true, muscle: true, day: true })
const MapKey = def('MapKey', anyOf(RefKind, pattern('^enum:.+$')))
const DomSort = strs<Extract<Ty, { t: 'dom' }>['sort']>('DomSort', { set: true, session: true, technique: true, tempo: true })
const XformOpS = strs<XformOp>('XformOp', { scaleMetric: true, scaleSets: true, capEffort: true, setTempo: true, reshape: true, stripIntensifier: true, swapExercise: true, addSets: true })
const ReadPick = strs<Extract<Term, { k: 'performed' }>['pick']>('ReadPick', { last: true, best: true, worst: true, sum: true, count: true })
const Edge = strs<'floor' | 'top'>('Edge', { floor: true, top: true })
const Writer = strs<'session' | 'weekEnd' | 'cycleEnd' | 'blockEnd' | 'periodClosed' | 'owner'>('Writer', { session: true, weekEnd: true, cycleEnd: true, blockEnd: true, periodClosed: true, owner: true })
const InstanceStatus = strs<Head['status']>('InstanceStatus', { active: true, paused: true, lapsed: true, completed: true, abandoned: true })
const Mode = strs<'commit' | 'propose'>('PatchMode', { commit: true, propose: true })
const Drift = strs<Calendar['drift']>('Drift', { slide: true, anchored: true })
const SuccessRuleS = def('SuccessRule', anyOf(lit('totalReps'), obj({ atLeastSets: int })))
const E1rmFormulaS = enumOf('E1rmFormula', ['epley', 'brzycki', 'lombardi', 'mayhew'])
const E1rmDeclS = def('E1rmDecl', obj({ formula: E1rmFormulaS, maxReps: opt(int) }))
const WeekdayS = enumOf('Weekday', WEEKDAYS)
const AdherenceWeeksS = def('AdherenceWeeksAligned', obj({ calendarAligned: obj({ weekStart: WeekdayS }) }))
const VolumeWeightsS = def('VolumeWeights', obj({ stage: opt(num), cluster: opt(num) }))
const TiesS = enumOf('Ties', ['down', 'up'])
const HitPolicy = strs<ProgramDef['hitPolicy']>('HitPolicy', { allInOrder: true, first: true })
const StateKind = strs<OutcomeRule['demote']['kinds'][number]>('StateKind', { load: true, volume: true, plain: true })

// ── sorts and the IR ────────────────────────────────────────────────────────

const Ty_: S = ref('Ty')
union<Ty, 't'>('Ty', 't', {
  q: { dim: DimVec, clock: opt(strs<'progress' | 'calendar'>('Clock', { progress: true, calendar: true })) },
  bool: {},
  ord: { scale: Scale },
  enum: { name: str },
  ref: { kind: RefKind, logging: opt(arr(LoggingType)) },
  opt: { of: Ty_ },
  list: { of: Ty_, nonEmpty: bool },
  map: { key: MapKey, of: Ty_ },
  dom: { sort: DomSort, metrics: opt(arr(str)), logging: opt(arr(LoggingType)) },
  upd: { scope: strs<'slot' | 'program'>('ScopeKind', { slot: true, program: true }) },
})

const DefRefS = def('DefRef', shape<DefRef>()({ id: str, version: int }))
const LitS = union<Lit, 'k'>('Lit', 'k', {
  q: { v: num, unit: Unit, per: opt(Unit), notation: opt(lit('rpe')) },
  bool: { v: bool },
  ord: { scale: Scale, level: num },
  enum: { name: str, tag: str },
  ref: { kind: RefKind, id: str },
})
const T: S = ref('Term')
const BoundS = union<BoundIR, 'b'>('BoundIR', 'b', {
  exact: { v: T },
  range: { min: T, max: T },
  atLeast: { v: T },
  atMost: { v: T },
  open: {},
})
const CountS = union<Count, 'k'>('Count', 'k', {
  n: { n: T },
  range: { min: T, max: T },
  until: { stop: T, max: int },
  while: { go: T, max: int },
})
const StepS = def('Step', obj({ k: lit('step'), id: str, count: CountS, target: T }))
union<StepIR, 'k'>('StepIR', 'k', {
  step: { id: str, count: CountS, target: T },
  repeat: { id: str, n: int, body: arr(StepS, 1) },
})
const SelectorS = union<Selector, 's'>('Selector', 's', {
  any: {},
  slot: { slot: str },
  day: { day: str },
  muscle: { muscles: arr(str, 1) },
  tag: { tag: str },
})
const MeasureS = def('Measure', { 'x-union': 'Measure', 'x-disc': 'm', oneOf: [obj({ m: lit('count') }), obj({ m: { enum: ['sum', 'max'] }, metric: str })] })
const CalQueryS = union<CalQuery, 'q'>('CalQuery', 'q', {
  day: {},
  earlierToday: {},
  gap: { of: SelectorS },
  recent: { of: SelectorS, days: int, measure: MeasureS },
})
const EventQueryS = union<EventQuery, 'q'>('EventQuery', 'q', {
  verdict: { steps: anyOf(arr(str), lit('working')), bound: Edge, success: opt(SuccessRuleS) },
  metric: { step: str, metric: str, pick: ReadPick },
  e1rm: { step: str, formula: opt(E1rmFormulaS) },
  prescribed: { step: str, metric: str, edge: Edge },
  stages: { step: str, pick: { enum: ['sum', 'last', 'count'] } },
  trained: { muscle: T },
  week: {},
  groupScore: { score: { enum: ['time', 'rounds'] } },
})
const AggQueryS = union<AggQuery, 'q'>('AggQuery', 'q', {
  slotsFor: { muscle: T },
  weekly: { metric: str, by: { anyOf: [obj({ k: lit('slot'), of: T }), obj({ k: lit('muscle'), of: T }), obj({ k: lit('tag'), tag: str })] }, basis: opt({ enum: ['closing', 'upcoming'] }), roles: opt({ anyOf: [lit('all'), arr(WeekRole, 1)] }) },
})
const RowKey = def('RowKey', anyOf({ type: 'number' }, str, LitS, nul))
const PatchField = def('PatchField', obj({ to: T, mode: Mode }))
const Tempo4 = def('Tempo4', tuple(num, num, num, num))

union<Term, 'k'>('Term', 'k', {
  lit: { lit: LitS },
  var: { name: str },
  let: { name: str, label: str, value: T, body: T },
  named: { noun: str, e: T },
  if: { c: T, a: T, b: T },
  match: { on: T, cases: rec(T) },
  arith: { op: { enum: ['+', '-', '*', 'min', 'max'] }, a: T, b: T },
  cmp: { op: { enum: ['<', '<=', '==', '>=', '>'] }, a: T, b: T },
  logic: { op: { enum: ['and', 'or'] }, a: T, b: T },
  not: { a: T },
  round: { mode: { enum: ['down', 'nearest', 'up'] }, a: T, step: T },
  ratio: { a: T, b: T },
  some: { a: T },
  none: { of: Ty_ },
  known: { a: T, as: str, body: T, then: bool },
  orElse: { a: T, b: T },
  asReps: { a: T },
  list: { items: arr(T), of: Ty_ },
  nth: { xs: T, i: T, overflow: { enum: ['hold', 'cycle'] } },
  fold: { xs: T, init: T, acc: str, x: str, step: T },
  tabulate: { keys: T, as: str, body: T },
  at: { m: T, key: T },
  keys: { of: pattern('^(slots|muscles|enum:.+)$') },
  range: { n: int },
  sum: { xs: T, as: str, body: T },
  count: { xs: T, as: str, where: T },
  pick: { mode: { enum: ['max', 'min'] }, xs: T, as: str, where: nullable(T), score: T },
  allocate: { n: T, into: T, among: T, as: str, score: T, cap: T, max: int },
  table: { key: T, rows: arr(obj({ when: RowKey, then: T })), otherwise: nullable(T), overflow: nullable({ enum: ['hold', 'cycle'] }) },
  app: { def: DefRefS, args: rec(T) },
  param: { name: str },
  self: { field: str },
  peer: { slot: str, field: str, of: { enum: ['current', 'prevPhase'] } },
  program: { field: str },
  fact: { fact: str, key: nullable(T) },
  pos: { field: { enum: ['week', 'trainWeek', 'role', 'slotSession'] } },
  cal: { q: CalQueryS },
  performed: { step: str, metric: str, pick: ReadPick },
  prescribed: { step: str, metric: str, edge: Edge },
  event: { q: EventQueryS },
  agg: { q: AggQueryS },
  set: { role: SetRole, target: rec(BoundS), rest: nullable(T), tempo: nullable(T), cluster: nullable(obj({ per: T, intraRest: T })) },
  session: { exercise: T, steps: arr(ref('StepIR')), intensifier: nullable(T) },
  xform: { op: XformOpS, s: T, arg: nullable(T), metric: nullable(str), allowZero: opt(lit(true)) },
  technique: { kind: { enum: ['drop-set', 'rest-pause', 'myo-reps'] }, stages: arr(T) },
  tempo: { ecc: num, pause: num, con: num, top: num },
  patch: { set: rec(PatchField) },
})

// ── declarations ────────────────────────────────────────────────────────────

const Templ = str
const EnumDecls = rec(arr(str))
const ExampleS = def('Example', shape<Example>()({ args: rec(T), gives: T }))
const FnDefS = def('FnDef', shape<FnDef>()({ kind: lit('fn'), ref: DefRefS, params: rec(Ty_), defaults: opt(rec(T)), result: Ty_, says: Templ, enums: EnumDecls, examples: arr(ExampleS, 1), body: T }))
const StateDeclS = def('StateDecl', shape<StateDecl>()({ ty: Ty_, init: T, writableBy: arr(Writer), noun: str }))
const SchemeExampleS = def(
  'SchemeExample',
  shape<SchemeExample>()({ args: rec(T), facts: rec(T), assume: { enum: ['asPrescribed', 'allMiss'] }, afterSessions: int, expect: rec(T) }),
)
const SlotEvent = strs<'session' | 'weekEnd' | 'cycleEnd' | 'blockEnd' | 'periodClosed'>('SlotEventKind', { session: true, weekEnd: true, cycleEnd: true, blockEnd: true, periodClosed: true })
const SchemeDefS = def(
  'SchemeDef',
  shape<SchemeDef>()({
    kind: lit('scheme'),
    ref: DefRefS,
    says: Templ,
    params: rec(Ty_),
    defaults: opt(rec(T)),
    facts: arr(str),
    enums: EnumDecls,
    state: rec(StateDeclS),
    plan: T,
    on: { type: 'object', propertyNames: ref('SlotEventKind'), additionalProperties: T },
    examples: arr(SchemeExampleS),
  }),
)
void SlotEvent
const SlotMetaS = def('SlotMeta', shape<SlotMeta>()({ muscles: rec(num), tags: opt(arr(str)), success: opt(SuccessRuleS) }))
const SlotBindingS = def('SlotBinding', shape<SlotBinding>()({ scheme: DefRefS, args: rec(T), meta: SlotMetaS }))
const GroupS = union<Group, 'k'>('Group', 'k', {
  single: { slot: str },
  superset: { slots: arr(str, 2), between: T, after: T },
  circuit: { slots: arr(str, 1), restBetweenRounds: T, score: nullable({ enum: ['time', 'rounds'] }) },
  emom: { slots: arr(str, 1), every: T, untilFail: nullable(obj({ max: int })) },
  amrapFor: { slots: arr(str, 1), cap: T, score: lit('rounds') },
})
const CalendarS = def('Calendar', shape<Calendar>()({ weeks: arr(WeekRole, 1), repeat: { enum: ['once', 'cycle'] }, drift: Drift }))
const RotationS = union<Rotation, 'k'>('Rotation', 'k', {
  weekly: { days: arr(str) },
  alternate: { days: arr(str), perWeek: int },
  pattern: { days: arr(anyOf(str, obj({ rest: lit(true) })), 1) },
  daily: { days: arr(str), perDay: int },
})
const PeriodS = union<Period, 'k'>('Period', 'k', { day: {}, week: {}, days: { n: int } })
const FrequencyS = union<Frequency, 'k'>('Frequency', 'k', {
  atLeast: { n: int, of: SelectorS, per: PeriodS },
  atMost: { n: int, of: SelectorS, withinDays: int },
  minGap: { of: SelectorS, gap: T, ceiling: int },
})
const UseS = def('Use', shape<Use>()({ def: DefRefS, hole: str, args: rec(T) }))
const OutcomeRuleS = def(
  'OutcomeRule',
  shape<OutcomeRule>()({ demote: obj({ kinds: arr(StateKind), direction: { enum: ['decrease', 'increase', 'any'] } }), volumeKeep: bool }),
)
const PolicyS = def('Policy', shape<Policy>()({ when: T, plan: nullable(UseS), outcome: nullable(OutcomeRuleS), origin: { enum: ['role', 'allocation', 'declared'] } }))
const AggEvent = strs<'weekEnd' | 'session' | 'periodClosed'>('AggEventKind', { weekEnd: true, session: true, periodClosed: true })
const AggregateS = def(
  'AggregateDef',
  shape<AggregateDef>()({ state: rec(StateDeclS), on: { type: 'object', propertyNames: AggEvent, additionalProperties: T } }),
)
const ExportS = union<ExportDecl, 'k'>('ExportDecl', 'k', { slotState: { slot: str, field: str, ty: Ty_ } })
const ImportS = def('ImportDecl', shape<ImportDecl>()({ from: DefRefS, export: str }))
const ProgramDefS = def(
  'ProgramDef',
  shape<ProgramDef>()({
    kind: lit('program'),
    ref: DefRefS,
    says: Templ,
    params: rec(Ty_),
    facts: arr(str),
    enums: EnumDecls,
    calendar: CalendarS,
    grids: obj({ load: opt(T), distance: opt(T) }),
    muscles: arr(str),
    slots: rec(SlotBindingS),
    days: rec(arr(GroupS)),
    rotation: RotationS,
    frequency: arr(FrequencyS),
    lapseAfterDays: int,
    hitPolicy: HitPolicy,
    e1rm: opt(E1rmDeclS),
    adherenceWeeks: opt(AdherenceWeeksS),
    volumeWeights: opt(VolumeWeightsS),
    stripIntensifierOn: opt(arr(WeekRole)),
    ties: opt(lit('up')),
    staleness: opt(rec(int)),
    policies: arr(PolicyS),
    aggregate: nullable(AggregateS),
    exports: rec(ExportS),
    imports: rec(ImportS),
  }),
)
const LengthS = union<Length, 'k'>('Length', 'k', {
  fixed: {},
  bounded: { min: int, max: int, advanceWhen: T, atMax: { enum: ['advance', 'propose'] } },
  open: {},
})
const PhaseDefS = def('PhaseDef', shape<PhaseDef>()({ label: str, program: DefRefS, length: LengthS, args: rec(T), transform: nullable(UseS) }))
const MacroDefS = def(
  'MacroDef',
  shape<MacroDef>()({
    kind: lit('macro'),
    ref: DefRefS,
    says: Templ,
    anchor: { anyOf: [obj({ k: lit('peakOn'), date: day }), obj({ k: lit('startOn'), date: day })] },
    drift: Drift,
    phases: arr(PhaseDefS),
  }),
)
const AnyDef = refUnion('AnyDef', 'kind', ['FnDef', 'SchemeDef', 'ProgramDef', 'MacroDef'])
void [FnDefS, SchemeDefS, ProgramDefS, MacroDefS]

// ── registries' entry shapes ────────────────────────────────────────────────

const MetricDeclS = def(
  'MetricDecl',
  shape<MetricDecl>()({
    dim: str,
    shapes: arr({ enum: ['exact', 'range', 'atLeast', 'atMost', 'open'] }),
    loggedBy: { type: 'object', propertyNames: LoggingType, additionalProperties: { enum: ['external', 'assisted', 'bodyweightPlus', 'plain'] } },
    measuredBy: opt(str),
    better: { enum: ['higher', 'lower'] },
    noun: str,
    lead: str,
    open: str,
  }),
)
const FactDeclS = def(
  'FactDecl',
  shape<FactDecl>()({
    key: { enum: ['none', 'exercise', 'muscle', 'slot', 'zone'] },
    ty: Ty_,
    observed: { enum: ['standing', 'preSession', 'duringSession', 'postSession'] },
    maxAgeDays: nullable(int),
    grain: { anyOf: [obj({ g: lit('instant') }), obj({ g: lit('reducer'), reducer: str })] },
    noun: str,
  }),
)
const ReducerDeclS = def('ReducerDecl', shape<ReducerDecl>()({ series: { enum: ['hr', 'barVelocity', 'power'] }, prose: str }))
const ExerciseDeclS = def('ExerciseDecl', shape<ExerciseDecl>()({ label: str, logging: LoggingType }))
const VocabS = def('Vocab', obj({ metrics: rec(MetricDeclS), facts: rec(FactDeclS), reducers: rec(ReducerDeclS), exercises: rec(ExerciseDeclS) }))
def('RegistryFile', obj({ entries: arr(AnyDef), vocab: anyOf(lit('base'), VocabS) }))

// ── refusals ────────────────────────────────────────────────────────────────

const Path = def('Path', arr(anyOf(str, int)))
const TE = { path: Path, message: str }
const TypeErrorS = union<TypeError, 'code'>('TypeError', 'code', {
  unitMismatch: { ...TE, expected: Ty_, got: Ty_ },
  notComparable: { ...TE, got: Ty_ },
  absenceUnhandled: { ...TE, got: Ty_ },
  unknownName: { ...TE, name: str },
  missingArg: { ...TE, param: str },
  forwardStepRef: { ...TE, step: str },
  capabilityEscape: { ...TE, cap: CapS, position: Position },
  notOwner: { ...TE, field: str },
  notWritableHere: { ...TE, field: str, writer: anyOf(Writer, AggEvent), writableBy: arr(Writer) },
  undeclaredFact: { ...TE, fact: str },
  nonGroundAccumulator: { ...TE, got: Ty_ },
  nonExhaustive: { ...TE, missing: arr(str) },
  boundNotLiteral: { ...TE, got: any },
  templateHoles: { ...TE, extra: arr(str), missing: arr(str) },
  exampleFailed: { ...TE },
  futureRef: { ...TE, ref: DefRefS },
  peakNeedsFixed: { ...TE, phase: str },
  overBudget: { ...TE, cost: int, budget: int, fix: str },
  metricNotLogged: { ...TE, metric: str, logging: str },
  shapeNotAllowed: { ...TE, metric: str, shape: str },
  scopedFormer: { ...TE, former: str },
  infeasibleFrequency: { ...TE, a: int, b: nullable(int), why: str },
  timeCommit: { ...TE },
  anchoredRequired: { ...TE },
  restOwnedByGroup: { ...TE, slot: str },
  windowTooLong: { ...TE, days: int },
  primaryMuscle: { ...TE, slot: str, primaries: int },
  boundsInverted: { ...TE, min: int, max: int },
  openNotLast: { ...TE, phase: str },
  fixedNeedsOnce: { ...TE, phase: str },
  emomNeedsFixedCount: { ...TE, slot: str },
  importMismatch: { ...TE, param: str, why: str },
  clockMix: { ...TE },
  clockRate: { ...TE, unit: str, per: str },
  loggingMismatch: { ...TE, from: str, to: str, metrics: arr(str) },
  nExceedsMax: { ...TE, n: num, max: int },
  unlabeledLet: { ...TE },
  thresholdOrder: { ...TE, at: int },
  tableShape: { ...TE, why: str },
  roleDoubleEncoding: { ...TE, role: str, slot: str },
  noSuchKind: { ...TE, kind: str },
  policyOrder: { ...TE, at: int },
  literalDomain: { ...TE, former: str, field: str, value: anyOf(num, str) },
})
const IngestRefusalS = union<IngestRefusal, 'code'>('IngestRefusal', 'code', {
  emptySession: { workoutId: str },
  notALocalDay: { stamped: str },
  dayStampOutOfRange: { stamped: day, utc: str },
  programComplete: {},
  floorNotConfirmed: { floorDays: int },
  instanceClosed: { status: InstanceStatus },
  notOwnerWritable: { scope: str, field: str },
  rebindNeedsMigration: { slot: str, fields: arr(str) },
})

// ── runtime shapes ──────────────────────────────────────────────────────────

const V: S = ref('Value')
const AbsenceS = union<Absence, 'k'>('Absence', 'k', {
  factUnknown: { fact: str, key: nullable(str) },
  factStale: { fact: str, observedOn: day, maxAgeDays: int },
  stateUnset: { field: str, noun: opt(str) },
  declaredNone: {},
  notPerformed: { step: str },
  notTargeted: { step: str, metric: str },
  emptyPick: {},
  missingKey: { key: str },
  zeroDenominator: {},
  noPriorSession: {},
  outOfDomain: { field: str, value: num },
  ownerCleared: { field: str },
  roleExcluded: { role: WeekRole },
  noUpcomingWeek: {},
  outsideFormulaDomain: { formula: str, reps: num },
})
const IssuedBoundS = union<IssuedBound, 'b'>('IssuedBound', 'b', {
  exact: { v: num },
  range: { min: num, max: num },
  atLeast: { v: num },
  atMost: { v: num },
  open: {},
})
const FrameS = def('Frame', shape<Frame>()({ vars: rec(V), reads: rec(V) }))
const ClosedField = def('ClosedField', anyOf(obj({ k: lit('fixed'), v: IssuedBoundS }), obj({ k: lit('silent'), cause: AbsenceS })))
const FieldS = union<Field, 'k'>('Field', 'k', {
  fixed: { v: IssuedBoundS },
  silent: { cause: AbsenceS },
  open: { bound: BoundS, frame: FrameS, planned: ClosedField, dependsOn: arr(str) },
})
const IssuedTargetS = def(
  'IssuedTarget',
  shape<IssuedTarget>()({ role: SetRole, metrics: rec(FieldS), restSec: nullable(num), tempo: nullable(Tempo4), cluster: nullable(obj({ per: num, intraRestSec: num })) }),
)
const IssuedTechniqueS = def('IssuedTechnique', shape<IssuedTechnique>()({ kind: { enum: ['drop-set', 'rest-pause', 'myo-reps'] }, stages: arr(IssuedTargetS) }))
const IssuedStepS = def(
  'IssuedStep',
  shape<IssuedStep>()({
    id: str,
    key: str,
    count: { anyOf: [obj({ k: lit('n'), n: num }), obj({ k: lit('range'), min: num, max: num }), obj({ k: { enum: ['until', 'while'] }, max: int, planned: num })] },
    sets: arr(IssuedTargetS),
    block: nullable(obj({ id: str, iteration: int })),
    live: nullable(obj({ cond: T, frame: FrameS })),
  }),
)
const SessionValueS = def('SessionValue', shape<SessionValue>()({ exercise: V, steps: arr(IssuedStepS), intensifier: nullable(IssuedTechniqueS) }))
union<Value, 'v'>('Value', 'v', {
  q: { n: num, dim: DimVec, unit: nullable(Unit), per: opt(Unit), clock: opt(ref('Clock')), notation: opt(lit('rpe')) },
  bool: { b: bool },
  ord: { scale: Scale, level: num },
  enum: { name: str, tag: str },
  ref: { kind: RefKind, id: str },
  none: { cause: AbsenceS },
  list: { items: arr(V) },
  map: { entries: arr(tuple(str, V)) },
  set: { t: IssuedTargetS },
  session: { s: SessionValueS },
  technique: { t: IssuedTechniqueS },
  tempo: { t: Tempo4 },
  patch: { fields: rec(obj({ value: V, mode: Mode })) },
})
const TraceS = def('Trace', shape<Trace>()({ node: T, value: V, kids: arr(ref('Trace')), def: opt(DefRefS), note: opt(str) }))
const FactReadingS = def('FactReading', shape<FactReading>()({ fact: str, key: nullable(str), value: V, observedOn: day }))
const IssuedSlotS = def(
  'IssuedSlot',
  shape<IssuedSlot>()({
    slot: str,
    exercise: anyOf(obj({ id: str, label: str, logging: LoggingType }), obj({ silent: AbsenceS })),
    steps: arr(IssuedStepS),
    intensifier: nullable(IssuedTechniqueS),
    trace: TraceS,
  }),
)
const PositionS = def('ProgressPosition', shape<ProgressPosition>()({ week: int, trainWeek: int, role: WeekRole, slotSessions: rec(int), phase: nullable(str) }))
const CalRead = def('CalRead', obj({ q: CalQueryS, value: V }))
const StampS = def(
  'Stamp',
  shape<Stamp>()({
    programHash: str,
    stateSeq: int,
    position: PositionS,
    issuedOn: day,
    factsRead: arr(FactReadingS),
    calReads: arr(CalRead),
    hitPolicy: HitPolicy,
    policies: arr(int),
    phaseTransform: nullable(DefRefS),
    grids: obj({ load: opt(num), distance: opt(num) }),
    ties: opt(lit('up')),
    display: rec(Unit),
  }),
)
const DueS = union<Due, 'k'>('Due', 'k', { due: {}, early: { dueOn: day, rule: int }, notBefore: { day, rule: int } })
const AssumeK = strs<Assume['k']>('AssumeKind', { asPrescribed: true, allMiss: true, repeatLast: true, asScheduled: true, script: true })
const issuedSessionFields = shape<IssuedSession>()({ issueKey: str, day: str, defaultDay: str, slots: arr(IssuedSlotS), stamp: StampS, due: DueS }) as { properties: Record<string, S> }
/** An issued session; one a projection produced carries its tag (L9, F23) wherever it is passed on. */
const IssuedSessionS = def('IssuedSession', obj({ ...issuedSessionFields.properties, projected: opt(lit(true)), assume: opt(AssumeK) }))
const ResolutionS = def(
  'Resolution',
  shape<Resolution>()({ key: str, seq: int, issueKey: str, slot: str, step: str, index: int, metric: str, value: ClosedField, trace: TraceS }),
)
const PerformedSetS = def('PerformedSet', shape<PerformedSet>()({ values: rec(num), stages: nullable(arr(obj({ reps: num }))) }))
const LoggedS = def('Logged', rec(rec(arr(PerformedSetS))))
const ClosedFactsS = def(
  'ClosedFacts',
  shape<ClosedFacts>()({
    workoutId: str,
    issued: IssuedSessionS,
    resolutions: arr(ResolutionS),
    performed: LoggedS,
    facts: arr(FactReadingS),
    groupScores: rec(obj({ time: opt(num), rounds: opt(num) })),
    localDay: day,
    earlierToday: int,
    startedEarly: bool,
  }),
)
const InstanceS = def('Instance', shape<Instance>()({ id: str, anchor: day, activatedOn: day, predecessor: nullable(str) }))
const EventS = union<Event, 'k'>('Event', 'k', {
  sessionClosed: { causeKey: pattern('^session:'), facts: ClosedFactsS },
  dayClosed: { causeKey: pattern('^day:'), day },
  skip: { causeKey: pattern('^skip:'), slot: str },
  pause: { causeKey: pattern('^pause:'), from: day, until: nullable(day) },
  resume: { causeKey: pattern('^resume:'), on: day },
  abandon: { causeKey: pattern('^abandon:'), on: day },
  ownerEdit: { causeKey: pattern('^edit:'), scope: str, patch: rec(nullable(LitS)) },
  proposalDecided: { causeKey: pattern('^decision:'), proposalKey: str, accepted: bool },
  rebind: { causeKey: pattern('^rebind:'), slot: str, to: DefRefS, args: rec(T) },
})
const ProposalS = def('Proposal', shape<Proposal>()({ key: str, scope: str, on: ref('SlotEventKind'), fields: rec(V), base: rec(V), seq: int, causeKey: str }))
const ProgressS = def(
  'Progress',
  shape<Progress>()({ week: int, slotSessions: rec(int), weekEntries: int, sessions: int, weekSlots: arr(str), cycleSlots: arr(str) }),
)
const OccurrenceS = def(
  'Occurrence',
  shape<Occurrence>()({
    workoutId: str,
    localDay: day,
    day: nullable(str),
    slots: arr(str),
    muscles: arr(str),
    startedEarly: bool,
    totals: opt(rec(obj({ sum: num, max: num }))),
  }),
)
const ExpectationS = def(
  'Expectation',
  shape<Expectation>()({ key: pattern('^expect:'), rule: int, window: obj({ from: day, through: day }), n: int, of: SelectorS, status: { enum: ['issued', 'void'] } }),
)
const AdherenceS = def(
  'Adherence',
  shape<Adherence>()({ key: pattern('^adhere:'), expectation: str, met: arr(obj({ workoutId: str, localDay: day })), missed: int, void: bool }),
)
const AmendmentS = def('AdherenceAmendment', shape<AdherenceAmendment>()({ key: pattern('^amend:'), adherence: str, workoutId: str, localDay: day }))
const CalendarStateS = def(
  'CalendarState',
  shape<CalendarState>()({
    reconciledThrough: day,
    seen: setOf(str),
    status: InstanceStatus,
    occurrences: arr(OccurrenceS),
    lastOn: rec(day),
    pauses: arr(obj({ from: day, until: nullable(day) })),
    expectations: arr(ExpectationS),
    adherence: arr(AdherenceS),
    amendments: arr(AmendmentS),
  }),
)
const HeadS = def(
  'Head',
  shape<Head>()({
    seq: int,
    state: rec(rec(V)),
    params: rec(V),
    bindings: rec(obj({ scheme: DefRefS, args: rec(T) })),
    pending: rec(ProposalS),
    progress: ProgressS,
    status: InstanceStatus,
    calendar: CalendarStateS,
    instance: InstanceS,
  }),
)
const FiredS = def(
  'Fired',
  shape<Fired>()({
    scope: str,
    on: anyOf(ref('SlotEventKind'), { enum: ['owner', 'decision'] }),
    causeKey: str,
    patch: rec(obj({ value: V, mode: { enum: ['commit', 'propose', 'keep', 'void'] }, demotedBy: arr(int) })),
    reason: nullable(TraceS),
    skipped: opt(lit('untrained')),
  }),
)
const TransitionS = def(
  'Transition',
  shape<Transition>()({
    seq: int,
    causeKey: str,
    emitted: arr(str),
    fired: arr(FiredS),
    factsRead: arr(FactReadingS),
    calReads: arr(CalRead),
    before: rec(rec(V)),
    after: rec(rec(V)),
  }),
)
const IngestResultS = union<IngestResult, 'k'>('IngestResult', 'k', {
  applied: { head: HeadS, transition: TransitionS },
  already: { seq: int },
  refused: { refusal: IngestRefusalS },
})
const StepResultS = union<StepResult, 'k'>('StepResult', 'k', { applied: { head: HeadS, transition: TransitionS }, refused: { refusal: IngestRefusalS } })
const ledgerFields = { head: HeadS, keys: setOf(str), events: arr(EventS), transitions: arr(TransitionS) }
/** A ledger; one that came out of a projection is tagged (L9, F23), and may be fed back in. */
const LedgerS = def('Ledger', obj({ ...ledgerFields, projected: opt(lit(true)), assume: opt(AssumeK) }))
const ProjectedLedgerS = def('ProjectedLedger', obj({ ...ledgerFields, projected: lit(true), assume: AssumeK }))
const AssumeS = union<Assume, 'k'>('Assume', 'k', {
  asPrescribed: {},
  allMiss: {},
  repeatLast: {},
  asScheduled: {},
  script: { outcomes: arr(obj({ week: int, day: str, hit: bool, amrapReps: opt(num) })) },
})
const ProjectedSessionS = def('ProjectedIssuedSession', obj({ ...issuedSessionFields.properties, projected: lit(true), assume: AssumeK }))
const ProjectionWeeks = arr(obj({ week: int, role: WeekRole, sessions: arr(ProjectedSessionS), endsOn: nullable(day), projected: lit(true) }))
const ProjectionS = def(
  'Projection',
  shape<Projection & { ledger: unknown }>()({ assume: AssumeS, weeks: ProjectionWeeks, changes: arr(TransitionS), fallbacks: arr(str), ledger: ProjectedLedgerS }),
)
const PhaseRunS = def(
  'PhaseRun',
  shape<PhaseRun>()({
    label: str,
    program: str,
    weeks: int,
    startsOn: day,
    ended: { enum: ['completed', 'criteria', 'max', 'askedAtMax', 'open'] },
    handoff: obj({ values: rec(V), projected: lit(true), assume: AssumeK }),
    final: ProjectedLedgerS,
    projection: ProjectionWeeks,
  }),
)
const SlotViewS = def('SlotView', shape<SlotView>()({ primary: str, tags: arr(str) }))
const CalendarSpecS = def(
  'CalendarSpec',
  shape<CalendarSpec>()({ instance: str, anchor: day, activatedOn: day, frequency: arr(FrequencyS), slots: rec(SlotViewS), lapseAfterDays: int, adherenceWeeks: opt(AdherenceWeeksS), tracked: arr(SelectorS) }),
)
const CalEventS = union<CalEvent, 'k'>('CalEvent', 'k', {
  dayClosed: { causeKey: pattern('^day:'), day },
  sessionClosed: { causeKey: pattern('^session:'), occurrence: OccurrenceS, adHoc: bool },
  pause: { causeKey: pattern('^pause:'), from: day, until: nullable(day) },
})
const InfeasibleS = def('Infeasible', shape<Infeasible>()({ a: int, b: nullable(int), why: str }))
const WriteEntryS = def(
  'WriteEntry',
  shape<WriteEntry>()({ scope: { enum: ['slot', 'program'] }, field: str, on: anyOf(ref('SlotEventKind'), AggEvent), mode: Mode }),
)
const GridsS = obj({ load: opt(num), distance: opt(num) })
const FactSourceS = def('FactSource', obj({ get: FnTok }))
const ReadsS = def('Reads', shape<Reads>()({ facts: arr(FactReadingS), cal: arr(CalRead) }))

// ── contexts (an argument's ports are `$fn` tokens; their calls are the world) ──

const PortsS = obj(Object.fromEntries(['self', 'peer', 'program', 'fact', 'pos', 'cal', 'performed', 'prescribed', 'event', 'agg', 'keys'].map((p) => [p, opt(FnTok)])))
const CtxS = def(
  'Ctx',
  shape<Ctx>()({
    reg: RegistryTok,
    params: rec(V),
    ports: PortsS,
    vars: mapOf(str, V),
    enums: rec(arr(str)),
    extraFns: opt(mapOf(str, FnDefS)),
    seq: opt(int),
    frame: opt(FrameS),
    display: opt(rec(Unit)),
    logs: opt(nullable(arr(str))),
    ties: opt(lit('up')),
    logging: opt(nullable(LoggingType)),
    record: opt(FnTok),
  }),
)
const CxS = def(
  'Cx',
  shape<Cx>()({
    zoom: { enum: ['intent', 'mechanism'] },
    reg: RegistryTok,
    lib: bool,
    names: mapOf(str, str),
    sorts: mapOf(str, nullable(RefKind)),
    params: rec(str),
    nouns: rec(str),
    flags: setOf(str),
    peer: FnTok,
    programNouns: rec(str),
    slotSuccess: opt(SuccessRuleS),
    alignedWeeks: opt(str),
  }),
)
const RuntimeS = def('Runtime', shape<Runtime>()({ reg: RegistryTok, def: ProgramDefS, spec: CalendarSpecS, phaseTransform: nullable(UseS), phase: nullable(str) }))
const InputsS = def(
  'Inputs',
  shape<Inputs>()({ facts: FactSourceS, today: day, earlierToday: int, reads: ReadsS, prevPhase: opt(rec(rec(V))) }),
)
const EventSourceS = def(
  'EventSource',
  shape<EventSource>()({
    reg: RegistryTok,
    slots: arr(IssuedSlotS),
    performed: LoggedS,
    facts: arr(FactReadingS),
    groupScores: rec(obj({ time: opt(num), rounds: opt(num) })),
    week: int,
    primary: FnTok,
    success: opt(rec(SuccessRuleS)),
    e1rm: opt(E1rmDeclS),
  }),
)
const RegOnly = obj({ reg: RegistryTok })
const ScopeS = def(
  'Scope',
  shape<Scope>()({
    position: Position,
    def: obj({ id: str, seq: int }),
    params: rec(Ty_),
    state: nullable(rec(StateDeclS)),
    facts: arr(str),
    enums: rec(arr(str)),
    peers: nullable(FnTok),
    programFields: nullable(rec(Ty_)),
    program: nullable(obj({ slots: arr(str), days: arr(str), muscles: arr(str), tags: arr(str), roles: nullable(arr(str)) })),
    steps: obj({ earlier: arr(str), all: anyOf(arr(str), lit('any')), own: nullable(str) }),
    writer: nullable(anyOf(Writer, AggEvent)),
    vars: mapOf(str, Ty_),
    live: opt(setOf(str)),
    reg: RegistryTok,
  }),
)

// ── operations: positional arguments and the result ─────────────────────────

type Sig = { args: (S | Opt)[]; ret: S }
const strings = arr(str)
const TypeErrors = arr(TypeErrorS)
export const OP_SIGS: { [K in Op]: Sig } = {
  'evaluate.evaluate': { args: [T, CtxS], ret: TraceS },
  'issue.sinkField': { args: [FieldS, str, rec(num), opt(TiesS)], ret: FieldS },
  'issue.applyUse': { args: [UseS, SessionValueS, CtxS], ret: SessionValueS },
  'issue.currentView': { args: [IssuedSessionS, arr(ResolutionS)], ret: arr(IssuedSlotS) },
  'issue.resolveLive': { args: [anyOf(RegOnly, RuntimeS), IssuedSessionS, LoggedS, arr(ResolutionS)], ret: arr(ResolutionS) },
  'issue.setsDue': { args: [anyOf(RegOnly, RuntimeS), IssuedSlotS, IssuedStepS, rec(arr(PerformedSetS))], ret: num },
  'xform.applyXform': { args: [XformOpS, SessionValueS, nullable(V), nullable(str), nullable(strings), opt(nullable(strings)), opt(bool)], ret: SessionValueS },
  'judge.verdictOf': { args: [EventSourceS, anyOf(strings, lit('working')), Edge, opt(SuccessRuleS)], ret: VerdictTag },
  'step.activate': { args: [RuntimeS, rec(V), FactSourceS], ret: HeadS },
  'step.step': { args: [RuntimeS, HeadS, EventS], ret: StepResultS },
  'step.ingest': { args: [RuntimeS, LedgerS, EventS], ret: obj({ ledger: LedgerS, result: IngestResultS }) },
  'step.replay': { args: [RuntimeS, HeadS, arr(EventS)], ret: LedgerS },
  'step.prescribe': { args: [RuntimeS, LedgerS, str, FactSourceS, day], ret: obj({ ledger: LedgerS, issued: anyOf(IssuedSessionS, IngestRefusalS) }) },
  'step.exportsOf': { args: [RuntimeS, HeadS], ret: rec(V) },
  'project.project': { args: [RuntimeS, LedgerS, int, AssumeS, FactSourceS, day, opt(int), opt(arr(FactReadingS))], ret: ProjectionS },
  'project.projectMacro': { args: [RegistryTok, MacroDefS, AssumeS, FactSourceS, int, opt(arr(FactReadingS))], ret: arr(PhaseRunS) },
  'time.activate': { args: [CalendarSpecS], ret: CalendarStateS },
  'time.reconcile': { args: [CalendarSpecS, CalendarStateS, day], ret: arr(CalEventS) },
  'time.stepCalendar': { args: [CalendarSpecS, CalendarStateS, CalEventS], ret: CalendarStateS },
  'time.dueVerdict': { args: [CalendarSpecS, CalendarStateS, day, FnTok], ret: DueS },
  'time.feasibility': { args: [arr(FrequencyS), int], ret: nullable(InfeasibleS) },
  'time.occurrenceOf': {
    args: [obj({ workoutId: str, localDay: day, day: nullable(str), slots: strings, startedEarly: bool, totals: opt(rec(obj({ sum: num, max: num }))), loggedSets: int }), CalendarSpecS],
    ret: anyOf(OccurrenceS, obj({ refused: lit('emptySession'), workoutId: str })),
  },
  'time.completedFraction': { args: [CalendarStateS], ret: num },
  'time.calendarSpecOf': { args: [ProgramDefS, arr(SelectorS), str, day, day, opt(obj({ lapseAfterDays: opt(int), adherenceWeeks: opt(anyOf(lit('fromAnchor'), AdherenceWeeksS)) }))], ret: CalendarSpecS },
  'checker.top': { args: [T, ScopeS, Path, nullable(Ty_), TypeErrors], ret: nullable(obj({ ty: Ty_, cost: int })) },
  'checkdefs.checkFn': { args: [FnDefS, RegistryTok], ret: TypeErrors },
  'checkdefs.checkScheme': { args: [SchemeDefS, RegistryTok, opt(any)], ret: TypeErrors },
  'checkdefs.checkProgram': { args: [ProgramDefS, RegistryTok], ret: arr(obj({ at: str, errors: TypeErrors })) },
  'checkdefs.checkMacro': { args: [MacroDefS, RegistryTok], ret: TypeErrors },
  'checkdefs.writeSet': { args: [anyOf(SchemeDefS, ProgramDefS)], ret: arr(WriteEntryS) },
  'describe.describe': { args: [T, CxS], ret: str },
  'describe.phrase': { args: [T, CxS], ret: str },
  'describe-defs.describeProgram': { args: [ProgramDefS, CxS], ret: strings },
  'describe-defs.describeSlot': { args: [SchemeDefS, rec(str), CxS, opt(nullable(CalendarS))], ret: strings },
  'describe-defs.describeMacroPhases': { args: [MacroDefS, CxS], ret: strings },
  'describe-defs.headline': { args: [ProgramDefS], ret: str },
  'describe-defs.macroHeadline': { args: [MacroDefS], ret: str },
  'describe-defs.stackingText': { args: [ProgramDefS, CxS], ret: strings },
  'describe-defs.dueText': { args: [DueS, CalendarSpecS, FnTok, CxS], ret: str },
  'describe-defs.adherenceText': { args: [CalendarStateS, AdherenceS, CalendarSpecS], ret: str },
  'describe-defs.bindingArgs': { args: [ProgramDefS, SlotBindingS, CxS], ret: rec(str) },
  'describe-run.sessionText': { args: [IssuedSessionS, RegistryTok, opt(obj({ mass: opt({ enum: ['kg', 'lb'] }) }))], ret: strings },
  'describe-run.valueText': { args: [V, RegistryTok], ret: str },
  'describe-run.explain': { args: [TraceS, RegistryTok], ret: str },
  'describe-run.transitionText': { args: [TransitionS, RegistryTok, FnTok], ret: strings },
}
void BaseDim

// ── fixture envelopes ───────────────────────────────────────────────────────

const SourceS = def('Source', obj({ suite: str, test: str, ids: strings }))
const WorldS = def('World', rec(arr(obj({ args: arr(any), ret: any }))))
const ExpectedFor = (ret: S, mutated: S) => anyOf(obj({ ret, mutated: opt(mutated) }), obj({ throws: str }))
const fixtureBranch = (op: Op, extra: Record<string, S | Opt> = {}): S => {
  const sig = OP_SIGS[op]
  const req = sig.args.filter((a) => !('$opt' in a && a.$opt)).length
  const items = sig.args.map((a) => ('$opt' in a && a.$opt ? (a.$opt as S) : (a as S)))
  return obj({
    op: lit(op),
    args: { type: 'array', prefixItems: items, minItems: req, maxItems: items.length, items: false },
    world: WorldS,
    expected: ExpectedFor(sig.ret, obj(Object.fromEntries(items.map((a, i) => [String(i), opt(a)])))),
    expectedCode: opt(str),
    expectedPath: opt(Path),
    label: opt(str),
    zoom: opt(str),
    locale: opt(str),
    ...extra,
  })
}
const FixtureStrict = def('FixtureStrict', { 'x-union': 'Op', 'x-disc': 'op', oneOf: (Object.keys(OPS) as Op[]).map((op) => fixtureBranch(op)) })
const CHECK_OPS = (Object.keys(OPS) as Op[]).filter((o) => o.startsWith('checkdefs.check') || o === 'checker.top')
/** Authoring JSON handed to the checker that does not parse as canonical IR
 *  (a term where a literal belongs, an operator the grammar lacks, a field the
 *  grammar does not have): its arguments are any JSON, and `inputSchemaErrors`
 *  says why they do not parse. The checker's answer is still the expectation. */
const unparsed = (extra: Record<string, S | Opt>) =>
  obj({
    op: { enum: CHECK_OPS },
    args: arr(any),
    world: WorldS,
    expected: obj({ ret: any, mutated: opt(rec(any)) }),
    expectedCode: opt(str),
    expectedPath: opt(Path),
    label: opt(str),
    inputSchemaErrors: arr(str, 1),
    ...extra,
  })
const FixtureUnparsed = def('FixtureUnparsed', unparsed({}))
const FixtureS = def('Fixture', anyOf(FixtureStrict, FixtureUnparsed))
def('FixtureFile', obj({ source: SourceS, fixtures: arr(FixtureS, 1) }))
const RefusalFixture = def('RefusalFixture', { 'x-union': 'Op', 'x-disc': 'op', oneOf: (Object.keys(OPS) as Op[]).map((op) => fixtureBranch(op, { source: SourceS, expectedCode: str, expectedPath: Path })) })
const RefusalUnparsed = def('RefusalUnparsed', unparsed({ source: SourceS, expectedCode: str, expectedPath: Path }))
def('RefusalFile', anyOf(RefusalFixture, RefusalUnparsed))

// ── the document ────────────────────────────────────────────────────────────

/** Term formers per the schema, which must equal DESCRIBERS (the describer's
 *  total table over Term['k']). */
export const FORMERS = ((DEFS['Term'] as { oneOf: { properties: { k: { const: string } } }[] }).oneOf).map((b) => b.properties.k.const)
{
  const d = Object.keys(DESCRIBERS).sort().join()
  if (FORMERS.slice().sort().join() !== d) throw new Error('schema: the Term union and DESCRIBERS disagree')
}

export const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'training-algebra/ir-schema.json',
  title: 'Training-program algebra IR (v3 + R2), with the runtime shapes the conformance fixtures carry',
  description:
    'Generated by synthesis/kit-schema.ts from the TS declarations and runtime mirrors; never hand-edited. The root validates one definition (fixtures/defs). Fixtures validate against #/$defs/FixtureFile, #/$defs/RefusalFile and #/$defs/RegistryFile after $def and $ref are expanded. x-union/x-disc/x-enum are annotations: x-disc names the field a oneOf dispatches on.',
  $ref: '#/$defs/AnyDef',
  $defs: DEFS,
}

// ── the validator ───────────────────────────────────────────────────────────

/** One coverage hit: a union branch or an enumeration value. */
export type Hit = [kind: string, tag: string]
const isObj = (x: unknown): x is Record<string, J> => !!x && typeof x === 'object' && !Array.isArray(x)
const deq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const dispatch = new Map<object, Map<string, S>>()
const resolve = (s: S): S => {
  let x = s
  while (typeof x['$ref'] === 'string') {
    const name = (x['$ref'] as string).replace('#/$defs/', '')
    const t = DEFS[name]
    if (!t) throw new Error(`schema: no $defs/${name}`)
    x = t
  }
  return x
}
function table(s: S): Map<string, S> {
  const hit = dispatch.get(s)
  if (hit) return hit
  const disc = s['x-disc'] as string
  const m = new Map<string, S>()
  for (const b of s['oneOf'] as S[]) {
    const p = (resolve(b)['properties'] as Record<string, S> | undefined)?.[disc]
    const tags = p ? ('const' in p ? [p['const'] as string] : ((p['enum'] as string[]) ?? [])) : []
    for (const t of tags) m.set(t, b)
  }
  dispatch.set(s, m)
  return m
}

/** Validate `data` against a named $def. Returns up to `max` errors; every
 *  union branch and enumeration value the data exercises is pushed to `hits`. */
export function validate(name: string, data: J, hits: Hit[] = [], max = 5): string[] {
  const errs: string[] = []
  const go = (s0: S, d: J, at: string, out: Hit[]): boolean => {
    const s = resolve(s0)
    if (errs.length >= max) return false
    const fail = (m: string) => (errs.push(`${at}: ${m}`), false)
    if ('const' in s && !deq(s['const'], d)) return fail(`expected ${JSON.stringify(s['const'])}`)
    if (s['enum']) {
      if (!(s['enum'] as unknown[]).some((e) => deq(e, d))) return fail(`${JSON.stringify(d)} not in ${s['x-enum'] ?? 'enum'}`)
      if (s['x-enum']) out.push([s['x-enum'] as string, String(d)])
    }
    if (s['allOf']) for (const x of s['allOf'] as S[]) if (!go(x, d, at, out)) return false
    if (s['oneOf'] && s['x-disc']) {
      const tag = isObj(d) ? d[s['x-disc'] as string] : undefined
      const b = typeof tag === 'string' ? table(s).get(tag) : undefined
      if (!b) return fail(`no ${s['x-union']} branch for ${s['x-disc']} = ${JSON.stringify(tag)}`)
      const mine: Hit[] = []
      if (!go(b, d, `${at}<${tag}>`, mine)) return false
      out.push([s['x-union'] as string, tag as string], ...mine)
    } else if (s['anyOf'] || s['oneOf']) {
      const alts = (s['anyOf'] ?? s['oneOf']) as S[]
      const before = errs.length
      let ok = false
      for (const a of alts) {
        const mine: Hit[] = []
        const n = errs.length
        if (go(a, d, at, mine)) {
          errs.length = n
          out.push(...mine)
          ok = true
          break
        }
        errs.length = n
      }
      if (!ok) {
        errs.length = before
        return fail(`matches none of ${alts.length} alternatives (${JSON.stringify(d)?.slice(0, 80)})`)
      }
    }
    const ty = s['type'] as string | undefined
    if (ty) {
      const okTy =
        ty === 'object' ? isObj(d) : ty === 'array' ? Array.isArray(d) : ty === 'integer' ? Number.isInteger(d) : ty === 'null' ? d === null : typeof d === ty
      if (!okTy) return fail(`expected ${ty}, got ${d === null ? 'null' : Array.isArray(d) ? 'array' : typeof d}`)
    }
    if (typeof s['pattern'] === 'string' && typeof d === 'string' && !new RegExp(s['pattern'] as string).test(d)) return fail(`${d} does not match ${s['pattern']}`)
    if (isObj(d) && (s['properties'] || s['additionalProperties'] !== undefined || s['propertyNames'])) {
      const props = (s['properties'] ?? {}) as Record<string, S>
      for (const r of (s['required'] ?? []) as string[]) if (!(r in d)) return fail(`missing ${r}`)
      for (const [k, v] of Object.entries(d)) {
        if (s['propertyNames'] && !go(s['propertyNames'] as S, k, `${at}.${k}(key)`, out)) return false
        const ps = props[k] ?? (s['additionalProperties'] === false ? null : ((s['additionalProperties'] as S | undefined) ?? any))
        if (ps === null) return fail(`unexpected field ${k}`)
        if (!go(ps, v, `${at}.${k}`, out)) return false
      }
    }
    if (Array.isArray(d)) {
      if (typeof s['minItems'] === 'number' && d.length < (s['minItems'] as number)) return fail(`fewer than ${s['minItems']} items`)
      if (typeof s['maxItems'] === 'number' && d.length > (s['maxItems'] as number)) return fail(`more than ${s['maxItems']} items`)
      const pre = (s['prefixItems'] ?? []) as S[]
      for (let i = 0; i < d.length; i++) {
        const is = i < pre.length ? pre[i]! : s['items']
        if (is === false) return fail(`unexpected item ${i}`)
        if (is && !go(is as S, d[i]!, `${at}[${i}]`, out)) return false
      }
    }
    return true
  }
  go(ref(name), data, '$', hits)
  return errs
}
