/**
 * registry.ts — the open vocabularies: scales, enums, logging types,
 * exercises, metrics, facts and reducers.
 *
 * Each registry is a type-level interface plus a runtime mirror kept in
 * lockstep by `satisfies`: an entry added to the interface and not to the
 * mirror fails to compile. The mirror carries everything a consumer needs
 * (the checker's sorts, the describer's nouns), so a new metric or fact is
 * ONE entry, with its prose, and no consumer changes. demo.ts §6 proves it by
 * adding `power` and `hrv` and printing the whole diff surface.
 */
import { DIMS, type Dim } from './units'
import type { En, Ord, Q, Ty } from './algebra'

// ═══════════════════════════════════════════════════════════════════════════
// Scales: ordinal, subjective
// ═══════════════════════════════════════════════════════════════════════════

/** Ordinals COMPARE and INDEX tables; they never add. Perceived exertion is
 *  two scales of its own: Borg 6–20 and cardio RPE (CR10). Neither is RIR, so
 *  a Borg rating can never stand where reps in reserve are expected (the
 *  algebra's `rpe` input notation lowers to RIR, resistance sets only). */
export interface Scales {
  soreness: 0 | 1 | 2 | 3 // 0 never sore … 3 still sore at next session
  pump: 0 | 1 | 2 | 3
  jointPain: 0 | 1 | 2 | 3
  workload: 0 | 1 | 2 | 3 // 0 easy … 3 pushed past limits
  readiness: 1 | 2 | 3 | 4 | 5
  formQuality: 0 | 1 | 2 // 0 lost control, 1 shaky, 2 solid
  pain: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 // numeric rating scale, as rehab protocols gate on it
  borg: 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
  cardioRpe: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
}
export type Scale = keyof Scales
export const SCALE_LEVELS = {
  soreness: [0, 1, 2, 3],
  pump: [0, 1, 2, 3],
  jointPain: [0, 1, 2, 3],
  workload: [0, 1, 2, 3],
  readiness: [1, 2, 3, 4, 5],
  formQuality: [0, 1, 2],
  pain: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  borg: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  cardioRpe: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
} as const satisfies { [S in Scale]: readonly Scales[S][] }

// ═══════════════════════════════════════════════════════════════════════════
// Enums: built-in; programs declare their own on the definition
// ═══════════════════════════════════════════════════════════════════════════

/** The built-in enumerations. A definition declares its own (GZCLP stages)
 *  in its `enums` field; the checker validates exhaustiveness against that
 *  declaration, never against a global interface. */
export interface Enums {
  weekRole: 'train' | 'deload' | 'test' | 'taper' | 'intro' | 'accumulation' | 'intensification' | 'realization'
  setRole: 'warmup' | 'working' | 'backoff' | 'amrap' | 'test' | 'recovery'
  hrZone: 'z1' | 'z2' | 'z3' | 'z4' | 'z5'
  dietPhase: 'cut' | 'maintain' | 'bulk'
}
export type EnumName = keyof Enums
export const ENUM_VALUES = {
  weekRole: ['train', 'deload', 'test', 'taper', 'intro', 'accumulation', 'intensification', 'realization'],
  setRole: ['warmup', 'working', 'backoff', 'amrap', 'test', 'recovery'],
  hrZone: ['z1', 'z2', 'z3', 'z4', 'z5'],
  dietPhase: ['cut', 'maintain', 'bulk'],
} as const satisfies { [N in EnumName]: readonly Enums[N][] }

// ═══════════════════════════════════════════════════════════════════════════
// Logging types and metrics
// ═══════════════════════════════════════════════════════════════════════════

/** How an exercise is logged. The app's logging_type plus the cardio and
 *  range-of-motion shapes. A set target may name only metrics the exercise's
 *  logging type produces, which is what refuses "a load on a timed hold". */
export type LoggingType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'weighted_bodyweight'
  | 'assisted_bodyweight'
  | 'timed' //          holds, planks, isometrics
  | 'cardio' //         runs, rides, rows, walks
  | 'rom_reps' //       passive or active range-of-motion work
export const LOGGING_TYPES: readonly LoggingType[] = ['weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'assisted_bodyweight', 'timed', 'cardio', 'rom_reps']

/** The exercise catalog: an exercise IS its id. Its label and logging type
 *  come from here at describe and check time and never from the author, so a
 *  reference cannot carry a label that lies about it (the app's exercise
 *  table plays this role in production). */
export interface ExerciseDecl {
  readonly label: string
  readonly logging: LoggingType
}
export const EXERCISE_DECLS = {
  'wger:111': { label: 'Barbell Back Squat', logging: 'weight_reps' },
  'wger:192': { label: 'Barbell Bench Press', logging: 'weight_reps' },
  'wger:105': { label: 'Deadlift', logging: 'weight_reps' },
  'wger:119': { label: 'Overhead Press', logging: 'weight_reps' },
  'wger:97': { label: 'Flat DB Press', logging: 'weight_reps' },
  'wger:314': { label: 'Incline DB Press', logging: 'weight_reps' },
  'wger:122': { label: 'Cable Fly', logging: 'weight_reps' },
  'wger:212': { label: 'Chest-Supported Row', logging: 'weight_reps' },
  'wger:158': { label: 'Lat Pulldown', logging: 'weight_reps' },
  'wger:507': { label: 'Romanian Deadlift', logging: 'weight_reps' },
  'wger:hip-thrust': { label: 'Barbell Hip Thrust', logging: 'weight_reps' },
  'wger:ball-push-up': { label: 'Push-Up, Hands on Stability Ball', logging: 'bodyweight_reps' },
  'wger:sa-ball-db-press': { label: 'Alternating DB Chest Press on Ball', logging: 'weight_reps' },
  'wger:sl-cable-press': { label: 'Single-Leg Standing Cable Press', logging: 'weight_reps' },
  'wger:ball-wall-squat': { label: 'Ball Wall Squat', logging: 'bodyweight_reps' },
  'wger:sl-squat': { label: 'Single-Leg Squat', logging: 'bodyweight_reps' },
  'wger:sl-squat-pad': { label: 'Single-Leg Squat on Foam Pad', logging: 'bodyweight_reps' },
  'wger:mb-chest-pass': { label: 'Medicine Ball Chest Pass', logging: 'bodyweight_reps' },
  'push-up': { label: 'Push-Up', logging: 'bodyweight_reps' },
  burpee: { label: 'Burpee', logging: 'bodyweight_reps' },
  plank: { label: 'Plank', logging: 'timed' },
  'calf-iso': { label: 'Isometric Calf-Raise Hold', logging: 'timed' },
  'heel-drop': { label: 'Eccentric Heel Drop', logging: 'weighted_bodyweight' },
  run: { label: 'Run, with brisk-walk recoveries', logging: 'cardio' },
  'road-run': { label: 'Road Run', logging: 'cardio' },
  'indoor-bike': { label: 'Indoor Bike', logging: 'cardio' },
  'ex:demo': { label: 'Demo', logging: 'weight_reps' },
} as const satisfies Record<string, ExerciseDecl>
export type ExerciseId = keyof typeof EXERCISE_DECLS
export type LoggingOf<I extends ExerciseId> = (typeof EXERCISE_DECLS)[I]['logging']

/** What a logged mass MEANS (the owner law: sets.weight varies by logging
 *  type). e1RM and every "decrease" rule read the EFFECTIVE load derived from
 *  this tag, never the raw number: an assisted pull-up with less assistance is
 *  a load INCREASE. */
export type MassSemantics = 'external' | 'assisted' | 'bodyweightPlus'

export type BoundShape = 'exact' | 'range' | 'atLeast' | 'atMost' | 'open'

/** The metric registry. A set target is a partial record metric → bound;
 *  performed sets, event reads, issued targets and resolutions are keyed the
 *  same way. */
export interface Metrics {
  reps: Q<'reps'>
  load: Q<'mass'>
  effort: Q<'effort'>
  duration: Q<'time'>
  distance: Q<'length'>
  pace: Q<'pace'>
  hr: Q<'heartRate'>
  rom: Q<'angle'>
}
export type MetricId = keyof Metrics
type DimOfQ<T> = T extends Q<infer D> ? D : never

export interface MetricDecl {
  readonly dim: Dim
  readonly shapes: readonly BoundShape[]
  /** Which logging types produce it; for mass, what the number means there. */
  readonly loggedBy: Readonly<Partial<Record<LoggingType, MassSemantics | 'plain'>>>
  /** A metric whose logged value IS a reduced fact (heart rate comes from the
   *  HR trace): targeting it requires the definition to declare that fact. */
  readonly measuredBy?: string
  /** Which way is better: decides best/worst picks and what "decrease" means. */
  readonly better: 'higher' | 'lower'
  /** Prose: the noun, the word that leads a bound, and an open bound's phrase. */
  readonly noun: string
  readonly lead: string
  readonly open: string
}

const LIFT = { weight_reps: 'plain', bodyweight_reps: 'plain', weighted_bodyweight: 'plain', assisted_bodyweight: 'plain' } as const
export const METRIC_DECLS = {
  reps: { dim: 'reps', shapes: ['exact', 'range', 'atLeast', 'atMost', 'open'], loggedBy: { ...LIFT, rom_reps: 'plain' }, better: 'higher', noun: 'reps', lead: '', open: 'however many reps' },
  load: {
    dim: 'mass',
    shapes: ['exact', 'range', 'atMost', 'open'],
    loggedBy: { weight_reps: 'external', weighted_bodyweight: 'bodyweightPlus', assisted_bodyweight: 'assisted' },
    better: 'higher',
    noun: 'load',
    lead: 'at',
    open: 'at a load you choose',
  },
  effort: { dim: 'effort', shapes: ['exact', 'range', 'atLeast'], loggedBy: LIFT, better: 'higher', noun: 'reps in reserve', lead: 'with', open: 'at any effort' },
  duration: { dim: 'time', shapes: ['exact', 'range', 'atLeast', 'atMost', 'open'], loggedBy: { timed: 'plain', cardio: 'plain' }, better: 'higher', noun: 'time', lead: '', open: 'timed' },
  distance: { dim: 'length', shapes: ['exact', 'range', 'atLeast', 'open'], loggedBy: { cardio: 'plain' }, better: 'higher', noun: 'distance', lead: '', open: 'whatever distance it takes' },
  pace: { dim: 'pace', shapes: ['exact', 'range', 'atMost', 'atLeast', 'open'], loggedBy: { cardio: 'plain' }, better: 'lower', noun: 'pace', lead: 'at', open: 'at any pace' },
  hr: { dim: 'heartRate', shapes: ['range', 'atMost', 'atLeast', 'open'], loggedBy: { cardio: 'plain' }, measuredBy: 'avgHr', better: 'lower', noun: 'heart rate', lead: 'keeping heart rate', open: 'heart rate recorded' },
  rom: { dim: 'angle', shapes: ['exact', 'range', 'atMost', 'open'], loggedBy: { rom_reps: 'plain', timed: 'plain' }, better: 'higher', noun: 'range of motion', lead: 'through', open: 'through a comfortable range' },
} as const satisfies { [M in MetricId]: MetricDecl & { dim: DimOfQ<Metrics[M]> } }

/** The open, runtime-extensible view the checker and describer consume. The
 *  TS interface above types the embedding; the checker takes a `Vocab` so an
 *  extension (demo §6) is one entry in a record. */
export type MetricTable = Readonly<Record<string, MetricDecl>>

// ═══════════════════════════════════════════════════════════════════════════
// Facts: one registry for everything the language reads from outside
// ═══════════════════════════════════════════════════════════════════════════

/** When a fact is observed. `standing` and `preSession` facts are readable
 *  wherever `fact` is granted; `duringSession` and `postSession` facts are
 *  facts ABOUT the closing session, so reading them needs `event` (handlers
 *  only). This axis replaces the old inputs-versus-feedback duality. */
export type Observed = 'standing' | 'preSession' | 'duringSession' | 'postSession'
export type FactKey = 'none' | 'exercise' | 'muscle' | 'slot' | 'zone'

/** Everything external, typed. Reads are Opt: a fact can be unknown or
 *  stale, and the author must say what happens then. */
export interface Facts {
  e1rm: { key: 'exercise'; ty: Q<'mass'> }
  bodyweight: { key: 'none'; ty: Q<'mass'> }
  velocity: { key: 'exercise'; ty: Q<'speed'> }
  soreness: { key: 'muscle'; ty: Ord<'soreness'> }
  readiness: { key: 'none'; ty: Ord<'readiness'> }
  pump: { key: 'muscle'; ty: Ord<'pump'> }
  jointPain: { key: 'slot'; ty: Ord<'jointPain'> }
  workload: { key: 'none'; ty: Ord<'workload'> }
  formQuality: { key: 'none'; ty: Ord<'formQuality'> }
  pain: { key: 'none'; ty: Ord<'pain'> }
  morningPain: { key: 'none'; ty: Ord<'pain'> }
  borg: { key: 'none'; ty: Ord<'borg'> }
  dietPhase: { key: 'none'; ty: En<Enums['dietPhase']> }
  ftp: { key: 'none'; ty: Q<'power'> }
  lthr: { key: 'none'; ty: Q<'heartRate'> }
  cuffPressure: { key: 'none'; ty: Q<'pressure'> }
  avgHr: { key: 'none'; ty: Q<'heartRate'> }
  timeInZone: { key: 'zone'; ty: Q<'time'> }
  hrDrift: { key: 'none'; ty: Q<'one'> }
}
export type FactId = keyof Facts

/** A raw series never enters the language. A registered reducer turns it into
 *  a declared scalar at the boundary, and carries the describer for it. */
export interface ReducerDecl {
  readonly series: 'hr' | 'barVelocity' | 'power'
  readonly prose: string
}
export const REDUCERS = {
  avgHr: { series: 'hr', prose: 'averaged over the session from your heart-rate recording' },
  timeInZone: { series: 'hr', prose: 'summed from your heart-rate recording, per zone' },
  hrDrift: { series: 'hr', prose: 'first half against second half of your heart-rate recording' },
  meanVelocity: { series: 'barVelocity', prose: 'the mean bar speed per set from your velocity device' },
} as const satisfies Record<string, ReducerDecl>

export interface FactDecl {
  readonly key: FactKey
  readonly ty: Ty
  readonly observed: Observed
  /** Older than this is stale, and a stale read is SILENCE (the sink's trace
   *  names it), never the last known value. null = never stale. */
  readonly maxAgeDays: number | null
  readonly grain: { readonly g: 'instant' } | { readonly g: 'reducer'; readonly reducer: string }
  /** The phrase prose uses. Folded into the declaration: there is no
   *  fallback text table anywhere in the describer. */
  readonly noun: string
}

const q = (d: Dim): Ty => ({ t: 'q', dim: DIMS[d] })
const ord = (scale: Scale): Ty => ({ t: 'ord', scale })
const instant = { g: 'instant' } as const
export const FACT_DECLS = {
  e1rm: { key: 'exercise', ty: q('mass'), observed: 'standing', maxAgeDays: 56, grain: instant, noun: 'your estimated max' },
  bodyweight: { key: 'none', ty: q('mass'), observed: 'standing', maxAgeDays: 14, grain: instant, noun: 'your bodyweight' },
  velocity: { key: 'exercise', ty: q('speed'), observed: 'duringSession', maxAgeDays: null, grain: { g: 'reducer', reducer: 'meanVelocity' }, noun: 'your bar speed' },
  soreness: { key: 'muscle', ty: ord('soreness'), observed: 'preSession', maxAgeDays: 1, grain: instant, noun: 'your soreness check-in' },
  readiness: { key: 'none', ty: ord('readiness'), observed: 'preSession', maxAgeDays: 1, grain: instant, noun: 'your readiness check-in' },
  pump: { key: 'muscle', ty: ord('pump'), observed: 'postSession', maxAgeDays: null, grain: instant, noun: 'your pump rating' },
  jointPain: { key: 'slot', ty: ord('jointPain'), observed: 'postSession', maxAgeDays: null, grain: instant, noun: 'your joint-pain rating' },
  workload: { key: 'none', ty: ord('workload'), observed: 'postSession', maxAgeDays: null, grain: instant, noun: 'your workload rating' },
  formQuality: { key: 'none', ty: ord('formQuality'), observed: 'postSession', maxAgeDays: null, grain: instant, noun: 'your form rating' },
  pain: { key: 'none', ty: ord('pain'), observed: 'postSession', maxAgeDays: null, grain: instant, noun: 'the pain you rated during the session' },
  morningPain: { key: 'none', ty: ord('pain'), observed: 'preSession', maxAgeDays: 1, grain: instant, noun: 'your pain rating the morning after the last session' },
  borg: { key: 'none', ty: ord('borg'), observed: 'postSession', maxAgeDays: null, grain: instant, noun: 'your Borg rating of the session' },
  dietPhase: { key: 'none', ty: { t: 'enum', name: 'dietPhase' }, observed: 'standing', maxAgeDays: null, grain: instant, noun: 'your diet phase' },
  ftp: { key: 'none', ty: q('power'), observed: 'standing', maxAgeDays: 84, grain: instant, noun: 'your FTP' },
  lthr: { key: 'none', ty: q('heartRate'), observed: 'standing', maxAgeDays: 84, grain: instant, noun: 'your lactate-threshold heart rate' },
  cuffPressure: { key: 'none', ty: q('pressure'), observed: 'standing', maxAgeDays: null, grain: instant, noun: 'your cuff occlusion pressure' },
  avgHr: { key: 'none', ty: q('heartRate'), observed: 'duringSession', maxAgeDays: null, grain: { g: 'reducer', reducer: 'avgHr' }, noun: 'your average heart rate' },
  timeInZone: { key: 'zone', ty: q('time'), observed: 'duringSession', maxAgeDays: null, grain: { g: 'reducer', reducer: 'timeInZone' }, noun: 'your time in zone' },
  hrDrift: { key: 'none', ty: q('one'), observed: 'duringSession', maxAgeDays: null, grain: { g: 'reducer', reducer: 'hrDrift' }, noun: 'your heart-rate drift' },
} as const satisfies { [F in FactId]: FactDecl & { key: Facts[F]['key'] } }
export type FactTable = Readonly<Record<string, FactDecl>>

/** The vocabulary the checker and describer run against. Extending the
 *  language with a metric, a fact or an exercise is one entry in one of these
 *  records. */
export interface Vocab {
  readonly metrics: MetricTable
  readonly facts: FactTable
  readonly reducers: Readonly<Record<string, ReducerDecl>>
  readonly exercises: Readonly<Record<string, ExerciseDecl>>
}
export const BASE_VOCAB: Vocab = { metrics: METRIC_DECLS, facts: FACT_DECLS, reducers: REDUCERS, exercises: EXERCISE_DECLS }

/** The three-valued verdict of a closing session against its issued bounds.
 *  Not a user enum: it is MATCHED, never compared, so no handler can fold
 *  `unknown` into `missed` (or into `hit`) with a two-way test. */
export const VERDICT_TAGS = ['hit', 'missed', 'unknown'] as const
export type VerdictTag = (typeof VERDICT_TAGS)[number]
