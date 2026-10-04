/**
 * checker.ts — a RUNNING slice of engine.ts `check`: the term judgment over
 * the IR, and the language's single typing authority. Definition-level rules
 * (programs, frequency, groups, policies, exports, macros) live in
 * checkdefs.ts.
 *
 * The coach and MCP author JSON, not TypeScript, so every rule runs here:
 *   - sorts and units as exponent vectors; the two clocks as sorts on a
 *     quantity; ordinals, enums (built-in and declared), the verdict, Opt;
 *   - capabilities by POSITION (algebra §2);
 *   - the telescope, with repeat blocks and self-reads in until/while steps;
 *   - metric targets and session transformers against the exercise's
 *     logging (the intersection, for a mixed-logging ladder);
 *   - facts by observation time (during/post-session facts need `event`);
 *   - calendar reads: literal windows of at most 56 days;
 *   - L3 declared, L13 (a periodClosed handler never commits);
 *   - publication order: `app` resolves only definitions published BEFORE
 *     the caller, which is what makes recursion unrepresentable;
 *   - D4, the phrase budget (a lint).
 * The vocabulary (metrics, facts, exercises) is an INPUT, so an extension is
 * checked by the same code with one more registry entry (demo §7).
 */
import { CLOCK_UNITS, DIMS, dimEq, dimName, dimOp, litDim, UNITS, type DimVec } from './units'
import { ENUM_VALUES, SCALE_LEVELS, VERDICT_TAGS, type LoggingType, type Scale, type Vocab } from './registry'
import { weeklyIsOpt, type BoundIR, type Cap, type Clock, type FnDef, type MapKey, type RefKind, type StepIR, type Term, type Ty } from './algebra'
import { BUDGET, OVER_BUDGET_FIX, type Position, type TypeError } from './engine'
import { MAX_WINDOW_DAYS, type Selector } from './time'
import type { AggEventKind, MacroDef, ProgramDef, SchemeDef, StateDecl, Writer } from './structure'

export type Path = (string | number)[]
/** A refusal before its path is attached (Omit distributed over the union). */
export type Refusal = TypeError extends infer X ? (X extends unknown ? Omit<X, 'path'> : never) : never
interface Res {
  ty: Ty
  cost: number
}

const PLAN = ['param', 'state', 'peer', 'program', 'fact', 'pos', 'cal'] as const
/** Literal tuples, so conformance.ts can prove at tsc time that each row
 *  equals the algebra's capability union for that position (EC-92). */
export const GRANTS = {
  fnBody: ['param'],
  init: ['param', 'fact'],
  plan: PLAN,
  live: [...PLAN, 'performed'],
  handler: [...PLAN, 'event'],
  aggregate: ['param', 'state', 'fact', 'pos', 'cal', 'event', 'agg'],
  bind: ['param', 'peer'],
  handoff: ['peer', 'cal', 'fact'],
  policy: ['param', 'state', 'fact', 'pos', 'cal'],
  cadence: ['param', 'state', 'peer'],
  example: [],
} as const satisfies Record<Position, readonly Cap[]>

/** Published definitions, in publication order. `seq` is what makes the
 *  reference graph a DAG by time. */
export interface Registry {
  fns: Map<string, FnDef>
  schemes: Map<string, SchemeDef>
  programs: Map<string, ProgramDef>
  macros: Map<string, MacroDef>
  seq: Map<string, number>
  vocab: Vocab
}
export const keyOf = (r: { id: string; version: number }) => `${r.id}@${r.version}`
export const isLib = (id: string) => id.startsWith('lib/')

/** What a selector may name, when a program is in view. */
export interface ProgramView {
  slots: readonly string[]
  days: readonly string[]
  muscles: readonly string[]
  tags: readonly string[]
  /** The calendar's week-role set, or null when no calendar is in view. */
  roles: readonly string[] | null
}

export interface Scope {
  position: Position
  /** The definition being checked: its id (library or not) and publication seq. */
  def: { id: string; seq: number }
  params: Record<string, Ty>
  state: Record<string, StateDecl> | null
  facts: readonly string[]
  enums: Readonly<Record<string, readonly string[]>>
  peers: ((slot: string, field: string, of: 'current' | 'prevPhase') => Ty | undefined) | null
  programFields: Record<string, Ty> | null
  program: ProgramView | null
  steps: { earlier: readonly string[]; all: readonly string[] | 'any'; own: string | null }
  writer: Writer | AggEventKind | null
  vars: ReadonlyMap<string, Ty>
  /** Binder variables (live positions) whose value depends on a logged set. */
  live?: ReadonlySet<string>
  reg: Registry
}

// ── sorts ───────────────────────────────────────────────────────────────────

const Q = (dim: DimVec, clock?: Clock): Ty => (clock ? { t: 'q', dim, clock } : { t: 'q', dim })
export const ONE = Q(DIMS.one)
export const SETS = Q(DIMS.sets)
export const REPS = Q(DIMS.reps)
export const MASS = Q(DIMS.mass)
export const TIME = Q(DIMS.time)
export const DAYS = Q(DIMS.days)
export const EFFORT = Q(DIMS.effort)
export const WEEKS = Q(DIMS.weeks)
export const BOOL: Ty = { t: 'bool' }
const VERDICT: Ty = { t: 'enum', name: 'verdict' }
export const opt = (of: Ty): Ty => ({ t: 'opt', of })
export const ref = (kind: RefKind): Ty => ({ t: 'ref', kind })
export const dom = (sort: 'set' | 'session' | 'technique' | 'tempo'): Ty => ({ t: 'dom', sort })
const metricTy = (sc: Scope, m: string, clock?: Clock): Ty | null => {
  const d = sc.reg.vocab.metrics[m]
  return d ? Q(DIMS[d.dim], clock) : null
}
/** The metrics a logging type produces, read from the vocabulary; for
 *  several possible types, what EVERY one of them produces. */
export const loggedMetrics = (v: Vocab, ls: readonly LoggingType[]): string[] =>
  Object.entries(v.metrics).filter(([, d]) => ls.every((l) => l in d.loggedBy)).map(([m]) => m)

/** a fits where b is wanted. For exercise refs that is a ⊆ b on logging
 *  types; everything else is equality. Clocks are judged at the sinks. */
export function eqTy(a: Ty, b: Ty): boolean {
  switch (a.t) {
    case 'q':
      return b.t === 'q' && dimEq(a.dim, b.dim)
    case 'bool':
      return b.t === 'bool'
    case 'ord':
      return b.t === 'ord' && a.scale === b.scale
    case 'enum':
      return b.t === 'enum' && a.name === b.name
    case 'ref':
      return b.t === 'ref' && a.kind === b.kind && (!a.logging || !b.logging || a.logging.every((l) => b.logging!.includes(l)))
    case 'opt':
      return b.t === 'opt' && eqTy(a.of, b.of)
    case 'list':
      return b.t === 'list' && eqTy(a.of, b.of) && (a.nonEmpty || !b.nonEmpty)
    case 'map':
      return b.t === 'map' && a.key === b.key && eqTy(a.of, b.of)
    case 'dom':
      return b.t === 'dom' && a.sort === b.sort
    case 'upd':
      return b.t === 'upd' && a.scope === b.scope
  }
}

export function showTy(t: Ty): string {
  switch (t.t) {
    case 'q':
      return `${dimName(t.dim)}${t.clock ? ` (${t.clock} clock)` : ''}`
    case 'opt':
      return `optional ${showTy(t.of)}`
    case 'list':
      return `list of ${showTy(t.of)}`
    case 'map':
      return `map ${t.key} → ${showTy(t.of)}`
    case 'ord':
      return `${t.scale} rating`
    case 'enum':
      return t.name
    case 'ref':
      return t.logging ? `${t.kind} (${t.logging.join(' or ')})` : t.kind
    case 'dom':
      return t.sort
    case 'upd':
      return `${t.scope} outcome`
    case 'bool':
      return 'yes/no'
  }
}
/** Statement-sorted terms are clauses: their value children are budgeted one by one. */
const isClause = (t: Ty): boolean => t.t === 'upd' || (t.t === 'dom' && t.sort !== 'tempo') || (t.t === 'opt' && isClause(t.of))
const keyTyOf = (k: MapKey): Ty => (k.startsWith('enum:') ? { t: 'enum', name: k.slice(5) } : ref(k as RefKind))
const literalInt = (t: number) => Number.isInteger(t) && t >= 1
/** A literal quantity's unit and per name registered units (else the one that does not). */
const unknownUnit = (l: { unit: string; per?: string }): string | null => (!(l.unit in UNITS) ? l.unit : l.per !== undefined && !(l.per in UNITS) ? l.per : null)
const clockOf = (t: Ty): Clock | undefined => (t.t === 'q' ? t.clock : t.t === 'opt' ? clockOf(t.of) : undefined)
/** The two-clock law at a sink: a calendar-derived quantity may be compared,
 *  never stored, targeted, passed on or used as an index. */
const calendarSink = (got: Ty, want: Ty): Refusal | null =>
  clockOf(got) === 'calendar' && clockOf(want) !== 'calendar'
    ? { code: 'clockMix', message: `a calendar-derived ${showTy(got)} may only be compared, never stored, targeted or used as an index (it would let the calendar drive progress)` }
    : null
const sessionTy = (logging: readonly LoggingType[] | undefined, metrics: readonly string[]): Ty =>
  logging ? { t: 'dom', sort: 'session', metrics, logging } : { t: 'dom', sort: 'session', metrics }

/** Every step id a step list declares, repeat bodies included. */
export const stepIds = (steps: readonly StepIR[]): string[] => steps.flatMap((s) => (s.k === 'repeat' ? [s.id, ...s.body.map((b) => b.id)] : [s.id]))

// ── the judgment ────────────────────────────────────────────────────────────

/** Γ ⊢ t : τ ! C, plus the D4 cost. Errors are appended to `out`; a failed
 *  subterm returns null and its parent normally stops without cascading. The
 *  exceptions are specified (SPEC, Per-former rules): `list`, `pick`, `app` and
 *  the reported-not-refusing loop bounds return a sort anyway, so a parent may
 *  add refusals on top of a refused definition. */
export function infer(t: Term, sc: Scope, path: Path, out: TypeError[]): Res | null {
  const kids: { r: Res | null; path: Path }[] = []
  const sub = (x: Term, seg: (string | number)[], s: Scope = sc): Res | null => {
    const p = [...path, ...seg]
    const r = infer(x, s, p, out)
    kids.push({ r, path: p })
    return r
  }
  const err = (e: Refusal, at: Path = path): null => {
    out.push({ ...e, path: at } as TypeError)
    return null
  }
  const need = (cap: Cap): boolean => {
    if ((GRANTS[sc.position] as readonly Cap[]).includes(cap)) return true
    err({ code: 'capabilityEscape', cap, position: sc.position, message: `reads '${cap}', which a ${sc.position} position does not grant` })
    return false
  }
  const expect = (r: Res | null, want: Ty, at: Path): boolean => {
    if (!r) return false
    if (r.ty.t === 'opt' && want.t !== 'opt' && eqTy(r.ty.of, want))
      return !!err({ code: 'absenceUnhandled', got: r.ty, message: `optional ${showTy(want)} used where a ${showTy(want)} is required; handle absence with known/orElse` }, at)
    if (!eqTy(r.ty, want)) return !!err({ code: 'unitMismatch', expected: want, got: r.ty, message: `expected ${showTy(want)}, got ${showTy(r.ty)}` }, at)
    const sink = calendarSink(r.ty, want)
    return sink ? !!err(sink, at) : true
  }
  const with_ = (s: Partial<Scope>): Scope => ({ ...sc, ...s })
  /** A term that depends on a logged set: a performed or prescribed read, or
   *  a binder variable bound to one. */
  const isLive = (x: Term): boolean => [...termNodes(x)].some((n) => n.k === 'performed' || n.k === 'prescribed' || (n.k === 'var' && !!sc.live?.has(n.name)))
  /** Bind a variable; in a live position it is live when its source is. */
  const bindVar = (name: string, ty: Ty, src: readonly Term[] = []): Scope => {
    const live = new Set(sc.live ?? [])
    if (sc.position === 'live' && src.some(isLive)) live.add(name)
    else live.delete(name)
    return with_({ vars: new Map([...sc.vars, [name, ty]]), live })
  }
  const boundary = (k: { r: Res | null; path: Path }) => {
    if (k.r && k.r.cost > BUDGET)
      err({ code: 'overBudget', cost: k.r.cost, budget: BUDGET, fix: OVER_BUDGET_FIX, message: `${k.r.cost} operators in one phrase (budget ${BUDGET}); ${OVER_BUDGET_FIX}` }, k.path)
    if (k.r) k.r = { ...k.r, cost: 0 }
  }
  const done = (ty: Ty, own: 0 | 1): Res => {
    if (isClause(ty)) {
      for (const k of kids) boundary(k)
      return { ty, cost: 0 }
    }
    return { ty, cost: own + kids.reduce((n, k) => n + (k.r?.cost ?? 0), 0) }
  }
  const lastKid = () => kids[kids.length - 1]!
  const literalBound = (n: unknown, at: Path) =>
    typeof n === 'number' && literalInt(n) ? true : !!err({ code: 'boundNotLiteral', got: n, message: 'a loop bound must be a literal positive integer' }, at)
  const enumTags = (name: string) => sc.enums[name]
  /** Quantities from two clocks never meet; one clock and none is that clock. */
  const joinClock = (a: Ty, b: Ty, what: string): Clock | undefined | null => {
    const [x, y] = [clockOf(a), clockOf(b)]
    if (x && y && x !== y) return err({ code: 'clockMix', message: `${what} mixes a ${x}-clock value with a ${y}-clock value: the two clocks never meet` })
    return x ?? y
  }
  const selector = (s: Selector, at: Path): boolean => {
    const pv = sc.program
    if (!pv) return true
    const miss = (what: string, name: string) => !!err({ code: 'unknownName', name, message: `the selector names no ${what} ${name}` }, at)
    if (s.s === 'slot') return pv.slots.includes(s.slot) || miss('slot', s.slot)
    if (s.s === 'day') return pv.days.includes(s.day) || miss('day', s.day)
    if (s.s === 'tag') return pv.tags.includes(s.tag) || miss('tag', s.tag)
    if (s.s === 'muscle') return s.muscles.every((m) => pv.muscles.includes(m) || miss('muscle', m))
    return true
  }
  /** A step read: an earlier step, or this until/while step's own earlier sets. */
  const stepVisible = (step: string, what: string): boolean => {
    if (sc.steps.earlier.includes(step) || sc.steps.own === step) return true
    const exists = sc.steps.all === 'any' || sc.steps.all.includes(step)
    return exists
      ? !!err({ code: 'forwardStepRef', step, message: `${what}(${step}) must name an EARLIER step of this session` })
      : !!err({ code: 'unknownName', name: step, message: `no step ${step}` })
  }
  const pickTy = (base: Ty, pick: string): Ty => (pick === 'count' ? ONE : pick === 'sum' ? base : opt(base))
  const notLogged = (m: string, logging: readonly LoggingType[], logs: readonly string[], at: Path) =>
    !!err({ code: 'metricNotLogged', metric: m, logging: logging.join(' or '), message: `${m} is not logged for a ${logging.join(' or ')} exercise (it logs ${logs.join(', ')})` }, at)

  switch (t.k) {
    case 'lit': {
      const l = t.lit
      switch (l.k) {
        case 'q': {
          const u = unknownUnit(l)
          if (u !== null) return err({ code: 'unknownName', name: u, message: `no unit ${u}` })
          if (l.per && (CLOCK_UNITS.includes(l.unit) || CLOCK_UNITS.includes(l.per)))
            return err({ code: 'clockRate', unit: l.unit, per: l.per, message: `a rate of ${l.unit} per ${l.per} converts a clock into a quantity; progress follows training, never the passing of days or weeks` })
          return done(Q(litDim(l.unit, l.per)), 0)
        }
        case 'bool':
          return done(BOOL, 0)
        case 'ord':
          return SCALE_LEVELS[l.scale as Scale]?.some((x: number) => x === l.level)
            ? done({ t: 'ord', scale: l.scale }, 0)
            : err({ code: 'unknownName', name: `${l.scale} ${l.level}`, message: `${l.scale} has no level ${l.level}` })
        case 'enum':
          return enumTags(l.name)?.includes(l.tag)
            ? done({ t: 'enum', name: l.name }, 0)
            : err({ code: 'unknownName', name: `${l.name}.${l.tag}`, message: `${l.tag} is not a declared ${l.name}` })
        case 'ref': {
          if (l.kind !== 'exercise') {
            const known = sc.program && { slot: sc.program.slots, muscle: sc.program.muscles, day: sc.program.days }[l.kind]
            return !known || known.includes(l.id) ? done(ref(l.kind), 0) : err({ code: 'unknownName', name: l.id, message: `the program declares no ${l.kind} ${l.id}` })
          }
          const x = sc.reg.vocab.exercises[l.id]
          return x ? done({ t: 'ref', kind: 'exercise', logging: [x.logging] }, 0) : err({ code: 'unknownName', name: l.id, message: `no exercise ${l.id} in the registry` })
        }
        default: {
          const k = (l as { k: string }).k
          return err({ code: 'unknownName', name: String(k), message: `no literal kind ${String(k)}` })
        }
      }
    }
    case 'var': {
      const v = sc.vars.get(t.name)
      return v ? done(v, 0) : err({ code: 'unknownName', name: t.name, message: `unbound variable ${t.name}` })
    }
    case 'let': {
      if (!t.label) return err({ code: 'unlabeledLet', message: 'a let needs a label: it is a name boundary, and the label is what prose calls the value' })
      const v = sub(t.value, ['value'])
      if (!v) return null
      boundary(lastKid())
      const b = sub(t.body, ['body'], bindVar(t.name, v.ty, [t.value]))
      return b && done(b.ty, 0)
    }
    case 'named': {
      sub(t.e, ['e'])
      const k = lastKid()
      boundary(k)
      // Outside the library a noun is spelled out where it is used, so it costs a node.
      return k.r && done(k.r.ty, isLib(sc.def.id) ? 0 : 1)
    }
    case 'if': {
      const c = sub(t.c, ['c'])
      const a = sub(t.a, ['a'])
      const b = sub(t.b, ['b'])
      if (!expect(c, BOOL, [...path, 'c']) || !a || !expect(b, a.ty, [...path, 'b'])) return null
      const [x, y] = [a.ty, b!.ty]
      if (x.t === 'dom' && y.t === 'dom' && (x.sort === 'set' || x.sort === 'session')) {
        const metrics = [...new Set([...(x.metrics ?? []), ...(y.metrics ?? [])])]
        if (x.sort === 'set') return done({ t: 'dom', sort: 'set', metrics }, 1)
        return done(sessionTy(x.logging && y.logging ? [...new Set([...x.logging, ...y.logging])] : undefined, metrics), 1)
      }
      return done(x, 1)
    }
    case 'match': {
      const on = sub(t.on, ['on'])
      if (!on) return null
      if (on.ty.t !== 'enum') return err({ code: 'notComparable', got: on.ty, message: `match needs an enum or a verdict, got ${showTy(on.ty)}` })
      const tags = enumTags(on.ty.name) ?? []
      const missing = tags.filter((x) => !(x in t.cases))
      if (missing.length) return err({ code: 'nonExhaustive', missing, message: `match on ${on.ty.name} misses ${missing.join(', ')}` })
      let ty: Ty | null = null
      for (const [tag, c] of Object.entries(t.cases)) {
        if (!tags.includes(tag)) return err({ code: 'unknownName', name: tag, message: `${tag} is not a declared ${on.ty.name}` })
        const r = sub(c, ['cases', tag])
        boundary(lastKid())
        if (!r) return null
        if (ty && !expect(r, ty, [...path, 'cases', tag])) return null
        ty ??= r.ty
      }
      return done(ty!, 1)
    }
    case 'arith': {
      if (!['+', '-', '*', 'min', 'max'].includes(t.op)) return err({ code: 'unknownName', name: t.op, message: `no arithmetic operator ${t.op}: division is not a former (use ratio)` })
      const a = sub(t.a, ['a'])
      const b = sub(t.b, ['b'])
      if (!a || !b) return null
      for (const [r, s] of [[a, 'a'], [b, 'b']] as const)
        if (r.ty.t === 'opt') return err({ code: 'absenceUnhandled', got: r.ty, message: `${showTy(r.ty)} in arithmetic; handle absence with known/orElse` }, [...path, s])
      if (a.ty.t !== 'q' || b.ty.t !== 'q') return err({ code: 'notComparable', got: a.ty.t !== 'q' ? a.ty : b.ty, message: `arithmetic needs quantities (ordinals never add)` })
      const clock = joinClock(a.ty, b.ty, 'this arithmetic')
      if (clock === null) return null
      if (t.op === '*') return done(Q(dimOp(a.ty.dim, b.ty.dim, 1), clock), 1)
      if (!eqTy(b.ty, a.ty)) return err({ code: 'unitMismatch', expected: a.ty, got: b.ty, message: `expected ${showTy(a.ty)}, got ${showTy(b.ty)}` }, [...path, 'b'])
      return done(Q(a.ty.dim, clock), 1)
    }
    case 'ratio': {
      const a = sub(t.a, ['a'])
      const b = sub(t.b, ['b'])
      if (!a || !b) return null
      for (const [r, s] of [[a, 'a'], [b, 'b']] as const)
        if (r.ty.t === 'opt') return err({ code: 'absenceUnhandled', got: r.ty, message: `${showTy(r.ty)} in a ratio; handle absence with known/orElse` }, [...path, s])
      if (a.ty.t !== 'q') return err({ code: 'notComparable', got: a.ty, message: 'ratio needs quantities' })
      const clock = joinClock(a.ty, b.ty, 'this ratio')
      if (clock === null || !eqTy(b.ty, a.ty)) return clock === null ? null : err({ code: 'unitMismatch', expected: a.ty, got: b.ty, message: `expected ${showTy(a.ty)}, got ${showTy(b.ty)}` }, [...path, 'b'])
      return done(opt(Q(DIMS.one, clock)), 1)
    }
    case 'cmp': {
      const a = sub(t.a, ['a'])
      const b = sub(t.b, ['b'])
      if (!a || !b) return null
      for (const [r, s] of [[a, 'a'], [b, 'b']] as const)
        if (r.ty.t === 'opt') return err({ code: 'absenceUnhandled', got: r.ty, message: `${showTy(r.ty)} compared; say what happens when it is unknown with known/orElse` }, [...path, s])
      if (a.ty.t === 'enum' && a.ty.name === 'verdict')
        return err({ code: 'notComparable', got: a.ty, message: 'a verdict is matched with all three arms (hit, missed, unknown), never compared: a two-way test would decide silence by accident' })
      if (joinClock(a.ty, b.ty, 'this comparison') === null) return null
      const ok = (a.ty.t === 'q' && eqTy(a.ty, b.ty)) || (a.ty.t === 'ord' && eqTy(a.ty, b.ty)) || (a.ty.t === 'enum' && eqTy(a.ty, b.ty) && t.op === '==')
      return ok ? done(BOOL, 1) : err({ code: 'notComparable', got: b.ty, message: `cannot compare ${showTy(a.ty)} ${t.op} ${showTy(b.ty)}` })
    }
    case 'logic': {
      const a = sub(t.a, ['a'])
      const b = sub(t.b, ['b'])
      return expect(a, BOOL, [...path, 'a']) && expect(b, BOOL, [...path, 'b']) ? done(BOOL, 1) : null
    }
    case 'not': {
      const a = sub(t.a, ['a'])
      return expect(a, BOOL, [...path, 'a']) ? done(BOOL, 1) : null
    }
    case 'round': {
      const a = sub(t.a, ['a'])
      const s = sub(t.step, ['step'])
      if (a?.ty.t === 'opt') return err({ code: 'absenceUnhandled', got: a.ty, message: `${showTy(a.ty)} rounded; handle absence with known/orElse` }, [...path, 'a'])
      if (!a || a.ty.t !== 'q') return a && err({ code: 'unitMismatch', expected: ONE, got: a.ty, message: 'round needs a quantity' })
      if (t.step.k === 'lit' && t.step.lit.k === 'q' && !(t.step.lit.v > 0))
        return err({ code: 'literalDomain', former: 'round', field: 'step', value: t.step.lit.v, message: `a rounding step must be above zero, got ${t.step.lit.v}` }, [...path, 'step'])
      return expect(s, a.ty, [...path, 'step']) ? done(a.ty, 1) : null
    }
    case 'some': {
      const a = sub(t.a, ['a'])
      return a && done(opt(a.ty), 0)
    }
    case 'none':
      return done(opt(t.of), 0)
    case 'known': {
      const a = sub(t.a, ['a'])
      if (!a) return null
      if (a.ty.t !== 'opt') return err({ code: 'unitMismatch', expected: { t: 'opt', of: a.ty }, got: a.ty, message: `known needs an optional value, got ${showTy(a.ty)}` })
      const b = sub(t.body, ['body'], bindVar(t.as, a.ty.of, [t.a]))
      if (!b) return null
      if (t.then && b.ty.t !== 'opt') return err({ code: 'unitMismatch', expected: { t: 'opt', of: b.ty }, got: b.ty, message: 'knownThen body must be optional' })
      return done(t.then ? b.ty : opt(b.ty), 0)
    }
    case 'orElse': {
      const a = sub(t.a, ['a'])
      const b = sub(t.b, ['b'])
      if (!a || !b) return null
      if (a.ty.t !== 'opt') return err({ code: 'unitMismatch', expected: { t: 'opt', of: a.ty }, got: a.ty, message: 'orElse needs an optional left side' })
      if (eqTy(b.ty, a.ty.of)) {
        // The result is either side, so it carries the clock of both: a calendar fallback taints it.
        const clock = joinClock(a.ty.of, b.ty, 'this orElse')
        return clock === null ? null : done(a.ty.of.t === 'q' ? Q(a.ty.of.dim, clock) : a.ty.of, 1)
      }
      return expect(b, a.ty, [...path, 'b']) ? done(a.ty, 1) : null
    }
    case 'asReps': {
      if (sc.position !== 'fnBody' || !isLib(sc.def.id))
        return err({ code: 'scopedFormer', former: 'asReps', message: 'asReps (reps in reserve counted as reps) is legal only inside a library definition: the e1RM arithmetic' })
      const a = sub(t.a, ['a'])
      return expect(a, EFFORT, [...path, 'a']) ? done(REPS, 0) : null
    }
    case 'list': {
      t.items.forEach((x, i) => expect(sub(x, ['items', i]), t.of, [...path, 'items', i]))
      return done({ t: 'list', of: t.of, nonEmpty: t.items.length > 0 }, 0)
    }
    case 'nth': {
      const xs = sub(t.xs, ['xs'])
      const i = sub(t.i, ['i'])
      if (!xs || !i) return null
      if (xs.ty.t !== 'list' || !xs.ty.nonEmpty) return err({ code: 'unitMismatch', expected: { t: 'list', of: ONE, nonEmpty: true }, got: xs.ty, message: 'nth needs a non-empty list' })
      if (i.ty.t !== 'q' || !(dimEq(i.ty.dim, DIMS.one) || dimEq(i.ty.dim, DIMS.weeks))) return err({ code: 'unitMismatch', expected: ONE, got: i.ty, message: 'nth index must be a count or a block week' })
      if (i.ty.clock === 'calendar') return err({ code: 'clockMix', message: 'a calendar-derived value cannot index a list: positions in a progression follow the progress clock' }, [...path, 'i'])
      if (t.i.k === 'lit' && t.i.lit.k === 'q' && !(Number.isInteger(t.i.lit.v) && t.i.lit.v >= 0))
        return err({ code: 'literalDomain', former: 'nth', field: 'i', value: t.i.lit.v, message: `a literal list position is a whole number from 0, got ${t.i.lit.v}` }, [...path, 'i'])
      return done(xs.ty.of, 1)
    }
    case 'fold': {
      const xs = sub(t.xs, ['xs'])
      const init = sub(t.init, ['init'])
      if (!xs || !init) return null
      if (xs.ty.t !== 'list') return err({ code: 'unitMismatch', expected: { t: 'list', of: ONE, nonEmpty: false }, got: xs.ty, message: 'fold needs a list' })
      if (init.ty.t === 'upd') return err({ code: 'nonGroundAccumulator', got: init.ty, message: 'a fold accumulator must be ground data' })
      const foldLive = sc.position === 'live' && [t.xs, t.init, t.step].some(isLive)
      const live = new Set([...(sc.live ?? [])].filter((n) => n !== t.acc && n !== t.x))
      if (foldLive) [t.acc, t.x].forEach((n) => live.add(n))
      const s = sub(t.step, ['step'], with_({ vars: new Map([...sc.vars, [t.acc, init.ty], [t.x, xs.ty.of]]), live }))
      return expect(s, init.ty, [...path, 'step']) ? done(init.ty, 1) : null
    }
    case 'tabulate': {
      const ks = sub(t.keys, ['keys'])
      if (!ks) return null
      if (ks.ty.t === 'list' && ks.ty.of.t === 'q' && dimEq(ks.ty.of.dim, DIMS.one)) {
        const b = sub(t.body, ['body'], bindVar(t.as, ks.ty.of, [t.keys]))
        return b && done({ t: 'list', of: b.ty, nonEmpty: ks.ty.nonEmpty }, 1)
      }
      if (ks.ty.t !== 'list' || (ks.ty.of.t !== 'ref' && ks.ty.of.t !== 'enum'))
        return err({ code: 'unitMismatch', expected: { t: 'list', of: ref('slot'), nonEmpty: false }, got: ks.ty, message: 'tabulate needs a list of refs, enum tags or a range' })
      const key: MapKey = ks.ty.of.t === 'ref' ? ks.ty.of.kind : `enum:${ks.ty.of.name}`
      const b = sub(t.body, ['body'], bindVar(t.as, ks.ty.of, [t.keys]))
      return b && done({ t: 'map', key, of: b.ty }, 1)
    }
    case 'at': {
      const m = sub(t.m, ['m'])
      const k = sub(t.key, ['key'])
      if (!m || !k) return null
      if (m.ty.t !== 'map') return err({ code: 'unitMismatch', expected: { t: 'map', key: 'slot', of: ONE }, got: m.ty, message: 'at needs a map' })
      return expect(k, keyTyOf(m.ty.key), [...path, 'key']) ? done(opt(m.ty.of), 0) : null
    }
    case 'keys':
      if (t.of.startsWith('enum:')) {
        const name = t.of.slice(5)
        if (!enumTags(name)) return err({ code: 'unknownName', name, message: `no enum ${name}` })
        return done({ t: 'list', of: { t: 'enum', name }, nonEmpty: true }, 0)
      }
      if (t.of !== 'slots' && t.of !== 'muscles') return err({ code: 'unknownName', name: String(t.of), message: `keys of ${String(t.of)}: the collections are slots, muscles and enum:<name>` })
      return done({ t: 'list', of: ref(t.of === 'slots' ? 'slot' : 'muscle'), nonEmpty: false }, 0)
    case 'range':
      return literalBound(t.n, [...path, 'n']) ? done({ t: 'list', of: ONE, nonEmpty: true }, 0) : null
    case 'sum':
    case 'count': {
      const xs = sub(t.xs, ['xs'])
      if (!xs || xs.ty.t !== 'list') return xs && err({ code: 'unitMismatch', expected: { t: 'list', of: ONE, nonEmpty: false }, got: xs.ty, message: `${t.k} needs a list` })
      const b = sub(t.k === 'sum' ? t.body : t.where, [t.k === 'sum' ? 'body' : 'where'], bindVar(t.as, xs.ty.of, [t.xs]))
      if (!b) return null
      if (t.k === 'count') return expect(b, BOOL, [...path, 'where']) ? done(ONE, 1) : null
      return b.ty.t === 'q' ? done(b.ty, 1) : err({ code: 'unitMismatch', expected: ONE, got: b.ty, message: 'sum needs a quantity body' })
    }
    case 'pick': {
      const xs = sub(t.xs, ['xs'])
      if (!xs || xs.ty.t !== 'list') return xs && err({ code: 'unitMismatch', expected: { t: 'list', of: ONE, nonEmpty: false }, got: xs.ty, message: 'pick needs a list' })
      const inner = bindVar(t.as, xs.ty.of, [t.xs])
      if (t.where) expect(sub(t.where, ['where'], inner), BOOL, [...path, 'where'])
      const s = sub(t.score, ['score'], inner)
      if (s && s.ty.t !== 'q' && s.ty.t !== 'ord') return err({ code: 'notComparable', got: s.ty, message: 'pick scores by a quantity or rating' })
      return done(opt(xs.ty.of), 1)
    }
    case 'allocate': {
      // Reported, not refusing: the definition is refused anyway, and the children still report.
      literalBound(t.max, [...path, 'max'])
      if (t.n.k === 'lit' && t.n.lit.k === 'q' && typeof t.max === 'number' && t.n.lit.v > t.max)
        return err({ code: 'nExceedsMax', n: t.n.lit.v, max: t.max, message: `allocate hands out ${t.n.lit.v} units but its bound is ${t.max}: the rest could never be placed` }, [...path, 'n'])
      const n = sub(t.n, ['n'])
      const into = sub(t.into, ['into'])
      const among = sub(t.among, ['among'])
      const inner = bindVar(t.as, ref('slot'), [t.among])
      const score = sub(t.score, ['score'], inner)
      const cap = sub(t.cap, ['cap'], inner)
      const ok =
        expect(n, SETS, [...path, 'n']) &&
        expect(into, { t: 'map', key: 'slot', of: SETS }, [...path, 'into']) &&
        expect(among, { t: 'list', of: ref('slot'), nonEmpty: false }, [...path, 'among']) &&
        expect(score, ONE, [...path, 'score']) &&
        expect(cap, SETS, [...path, 'cap'])
      return ok ? done({ t: 'map', key: 'slot', of: SETS }, 1) : null
    }
    case 'table':
      return table(t)
    case 'app': {
      // Not a budget boundary: argument costs add to the caller's phrase; only the callee body is budgeted elsewhere.
      const k = keyOf(t.def)
      const f = sc.reg.fns.get(k)
      const at = sc.reg.seq.get(k)
      if (!f || at === undefined || at >= sc.def.seq)
        return err({ code: 'futureRef', ref: t.def, message: `${k} is not published before ${sc.def.id}: a definition may call only earlier publications (no recursion)` })
      for (const p of Object.keys(f.params)) if (!(p in t.args) && !(p in (f.defaults ?? {}))) err({ code: 'missingArg', param: p, message: `${t.def.id} needs ${p}` })
      for (const [a, x] of Object.entries(t.args)) {
        const want = f.params[a]
        if (!want) {
          err({ code: 'unknownName', name: a, message: `${t.def.id} has no parameter ${a}` }, [...path, 'args', a])
          continue
        }
        expect(sub(x, ['args', a]), want, [...path, 'args', a])
      }
      return done(f.result, 0)
    }
    case 'param': {
      if (!need('param')) return null
      const p = sc.params[t.name]
      return p ? done(p, 0) : err({ code: 'unknownName', name: t.name, message: `no parameter ${t.name}` })
    }
    case 'self': {
      if (!need('state')) return null
      const d = sc.state?.[t.field]
      return d ? done(d.ty, 0) : err({ code: 'unknownName', name: t.field, message: `no state field ${t.field}` })
    }
    case 'peer': {
      if (!need('peer')) return null
      const p = sc.peers?.(t.slot, t.field, t.of)
      return p ? done(p, 0) : err({ code: 'unknownName', name: `${t.slot}.${t.field}`, message: `no slot ${t.slot} with state ${t.field} (${t.of})` })
    }
    case 'program': {
      if (!need('program')) return null
      const f = sc.programFields?.[t.field]
      if (!f) return err({ code: 'unknownName', name: t.field, message: `no program field ${t.field}` })
      if (f.t === 'map') return f.key === 'slot' ? done(opt(f.of), 0) : err({ code: 'unknownName', name: t.field, message: `${t.field} is a map not keyed by slot` })
      return done(f, 0)
    }
    case 'fact': {
      const d = sc.reg.vocab.facts[t.fact]
      if (!d) return err({ code: 'unknownName', name: t.fact, message: `no fact ${t.fact}` })
      if (!need(d.observed === 'duringSession' || d.observed === 'postSession' ? 'event' : 'fact')) return null
      if (!sc.facts.includes(t.fact)) return err({ code: 'undeclaredFact', fact: t.fact, message: `reads ${t.fact}, which the definition does not declare` })
      // A live field is resolved from its frame and the logged sets; a fact
      // whose KEY depends on a logged set was never read at issue, so it
      // cannot be served there (F2).
      if (sc.position === 'live' && t.key && isLive(t.key))
        return err({ code: 'capabilityEscape', cap: 'fact', position: 'live', message: `${t.fact} keyed by a logged value cannot be read once the set is logged: a live target reads facts only as they were at issue` }, [...path, 'key'])
      if (d.key === 'none') {
        // expected/got are ONE placeholders by spec: there is no key sort to name, the code tells the author to drop the key.
        if (t.key) return err({ code: 'unitMismatch', expected: ONE, got: ONE, message: `${t.fact} is not keyed` })
      } else {
        const want: Ty = d.key === 'zone' ? { t: 'enum', name: 'hrZone' } : ref(d.key)
        if (!t.key) return err({ code: 'missingArg', param: 'key', message: `${t.fact} is keyed by ${d.key}` })
        if (!expect(sub(t.key, ['key']), want, [...path, 'key'])) return null
      }
      return done(opt(d.ty), 0)
    }
    case 'pos': {
      if (!need('pos')) return null
      if (!['week', 'trainWeek', 'role', 'slotSession'].includes(t.field)) return err({ code: 'unknownName', name: String(t.field), message: `no position field ${String(t.field)}` })
      return done(t.field === 'role' ? { t: 'enum', name: 'weekRole' } : t.field === 'slotSession' ? Q(DIMS.one, 'progress') : Q(DIMS.weeks, 'progress'), 0)
    }
    case 'cal': {
      if (!need('cal')) return null
      const q = t.q
      switch (q.q) {
        case 'day':
          return done(Q(DIMS.days, 'calendar'), 0)
        case 'earlierToday':
          return done(Q(DIMS.one, 'calendar'), 0)
        case 'gap':
          return selector(q.of, [...path, 'q', 'of']) ? done(opt(Q(DIMS.days, 'calendar')), 0) : null
        case 'recent': {
          if (!(typeof q.days === 'number' && literalInt(q.days))) return err({ code: 'boundNotLiteral', got: q.days, message: 'a calendar window is a literal number of days' }, [...path, 'q', 'days'])
          if (q.days > MAX_WINDOW_DAYS) return err({ code: 'windowTooLong', days: q.days, message: `a calendar window is at most ${MAX_WINDOW_DAYS} days, got ${q.days}` }, [...path, 'q', 'days'])
          if (!selector(q.of, [...path, 'q', 'of'])) return null
          if (q.measure.m === 'count') return done(Q(DIMS.one, 'calendar'), 0)
          const mt = metricTy(sc, q.measure.metric, 'calendar')
          if (!mt) return err({ code: 'unknownName', name: q.measure.metric, message: `no metric ${q.measure.metric}` })
          return done(q.measure.m === 'sum' ? mt : opt(mt), 0)
        }
        default:
          return err({ code: 'unknownName', name: (q as { q: string }).q, message: `no calendar read ${(q as { q: string }).q}` })
      }
    }
    case 'performed':
    case 'prescribed': {
      if (!need('performed')) return null
      if (!stepVisible(t.step, t.k)) return null
      if (t.k === 'performed' && t.pick === 'count') return done(ONE, 0)
      const mt = metricTy(sc, t.metric)
      if (!mt) return err({ code: 'unknownName', name: t.metric, message: `no metric ${t.metric}` })
      return done(t.k === 'performed' ? pickTy(mt, t.pick) : opt(mt), 0)
    }
    case 'event': {
      if (!need('event')) return null
      const q = t.q
      const stepOk = (s: string) => sc.steps.all === 'any' || sc.steps.all.includes(s) || !!err({ code: 'unknownName', name: s, message: `the event has no step ${s}` })
      switch (q.q) {
        case 'verdict': {
          if (q.steps !== 'working' && !q.steps.every(stepOk)) return null
          const su = q.success
          if (su !== undefined && su !== 'totalReps') {
            if (!su || typeof su !== 'object' || !('atLeastSets' in su))
              return err({ code: 'unknownName', name: String(su), message: `no verdict success rule ${String(su)} (totalReps, or {atLeastSets: n}; omit it for allSets)` }, [...path, 'q', 'success'])
            if (!(Number.isInteger(su.atLeastSets) && su.atLeastSets >= 1))
              return err({ code: 'literalDomain', former: 'event', field: 'success', value: su.atLeastSets, message: `atLeastSets is a whole number of sets from 1, got ${su.atLeastSets}` }, [...path, 'q', 'success'])
          }
          return done(VERDICT, 0)
        }
        case 'metric':
        case 'prescribed': {
          if (!stepOk(q.step)) return null
          if (q.q === 'metric' && q.pick === 'count') return done(ONE, 0)
          const mt = metricTy(sc, q.metric)
          if (!mt) return err({ code: 'unknownName', name: q.metric, message: `no metric ${q.metric}` })
          return done(q.q === 'metric' ? pickTy(mt, q.pick) : opt(mt), 0)
        }
        case 'e1rm':
          if (q.formula !== undefined && !['epley', 'brzycki', 'lombardi', 'mayhew'].includes(q.formula))
            return err({ code: 'unknownName', name: String(q.formula), message: `no e1RM formula ${String(q.formula)} (epley, brzycki, lombardi, mayhew)` }, [...path, 'q', 'formula'])
          return stepOk(q.step) ? done(opt(MASS), 0) : null
        case 'stages':
          return stepOk(q.step) ? done(q.pick === 'count' ? ONE : opt(REPS), 0) : null
        case 'trained':
          return expect(sub(q.muscle, ['q', 'muscle']), ref('muscle'), [...path, 'q', 'muscle']) ? done(BOOL, 0) : null
        case 'week':
          return done(Q(DIMS.weeks, 'progress'), 0)
        case 'groupScore':
          return done(opt(q.score === 'time' ? TIME : ONE), 0)
        default:
          return err({ code: 'unknownName', name: (q as { q: string }).q, message: `no event read ${(q as { q: string }).q} (a session is judged by the three-valued verdict)` })
      }
    }
    case 'agg': {
      if (!need('agg')) return null
      const q = t.q
      if (q.q === 'slotsFor') return expect(sub(q.muscle, ['q', 'muscle']), ref('muscle'), [...path, 'q', 'muscle']) ? done({ t: 'list', of: ref('slot'), nonEmpty: false }, 0) : null
      const m0 = q.metric === 'sets' ? SETS : metricTy(sc, q.metric)
      if (!m0) return err({ code: 'unknownName', name: q.metric, message: `no metric ${q.metric}` })
      if (q.basis !== undefined && q.basis !== 'closing' && q.basis !== 'upcoming') return err({ code: 'unknownName', name: String(q.basis), message: `no weekly basis ${q.basis} (closing or upcoming)` }, [...path, 'q', 'basis'])
      if (q.roles !== undefined && q.roles !== 'all') {
        if (!Array.isArray(q.roles)) return err({ code: 'unknownName', name: String(q.roles), message: `a weekly roles filter is 'all' or a list of week roles` }, [...path, 'q', 'roles'])
        if (!q.roles.length) return err({ code: 'literalDomain', former: 'agg', field: 'roles', value: 0, message: 'a weekly roles filter with no roles is absent every week' }, [...path, 'q', 'roles'])
        const bad = q.roles.findIndex((r) => !(ENUM_VALUES.weekRole as readonly string[]).includes(r))
        if (bad >= 0) return err({ code: 'unknownName', name: String(q.roles[bad]), message: `no week role ${q.roles[bad]}` }, [...path, 'q', 'roles', bad])
        const cal = sc.program?.roles
        if (cal && !q.roles.some((r) => cal.includes(r)))
          return err({ code: 'literalDomain', former: 'agg', field: 'roles', value: 0, message: `the roles filter (${q.roles.join(', ')}) names no week of this program's calendar (${[...new Set(cal)].join(', ')}): the read would be absent every week` }, [...path, 'q', 'roles'])
      }
      const mt = weeklyIsOpt(q) ? opt(m0) : m0
      if (q.by.k === 'tag') return !sc.program || sc.program.tags.includes(q.by.tag) ? done(mt, 0) : err({ code: 'unknownName', name: q.by.tag, message: `the program tags no slot ${q.by.tag}` })
      return expect(sub(q.by.of, ['q', 'by', 'of']), ref(q.by.k), [...path, 'q', 'by', 'of']) ? done(mt, 0) : null
    }
    case 'set': {
      let ok = true
      for (const [m, b] of Object.entries(t.target)) {
        const at = [...path, 'target', m]
        const decl = sc.reg.vocab.metrics[m]
        if (!decl) {
          ok = !!err({ code: 'unknownName', name: m, message: `no metric ${m}` }, at)
          continue
        }
        if (!(decl.shapes as readonly string[]).includes(b.b)) ok = !!err({ code: 'shapeNotAllowed', metric: m, shape: b.b, message: `${decl.noun} cannot be targeted as ${b.b} (allowed: ${decl.shapes.join(', ')})` }, at)
        if (decl.measuredBy && !sc.facts.includes(decl.measuredBy))
          ok = !!err({ code: 'undeclaredFact', fact: decl.measuredBy, message: `a ${decl.noun} target is judged from ${decl.measuredBy}, which the definition does not declare` }, at)
        ok = bound(b, Q(DIMS[decl.dim]), at) && ok
      }
      if (t.rest) ok = expect(sub(t.rest, ['rest']), TIME, [...path, 'rest']) && ok
      if (t.tempo) ok = expect(sub(t.tempo, ['tempo']), dom('tempo'), [...path, 'tempo']) && ok
      if (t.cluster) ok = expect(sub(t.cluster.per, ['cluster', 'per']), REPS, [...path, 'cluster', 'per']) && expect(sub(t.cluster.intraRest, ['cluster', 'intraRest']), TIME, [...path, 'cluster', 'intraRest']) && ok
      return ok ? done({ t: 'dom', sort: 'set', metrics: Object.keys(t.target) }, 0) : null
    }
    case 'session': {
      // The telescope: counts are plan positions, targets are live.
      const countPos: Position = sc.position === 'live' ? 'plan' : sc.position
      const targetPos: Position = sc.position === 'plan' ? 'live' : sc.position
      const all = stepIds(t.steps)
      if (!t.steps.length) return err({ code: 'literalDomain', former: 'session', field: 'steps', value: 0, message: 'a session needs at least one step: an empty one would be judged on nothing' })
      const ex = sub(t.exercise, ['exercise'])
      let ok = expect(ex, ref('exercise'), [...path, 'exercise'])
      const logging = ex?.ty.t === 'ref' ? ex.ty.logging : undefined
      const logs = logging ? loggedMetrics(sc.reg.vocab, logging) : null
      const targets = new Set<string>()
      const earlier: string[] = []
      const checkStep = (s: Extract<StepIR, { k: 'step' }>, at: Path) => {
        const steps = { earlier: [...earlier], all, own: null }
        const own = { earlier: [...earlier], all, own: s.id as string }
        const c = s.count
        if (c.k === 'n') ok = expect(sub(c.n, [...at, 'count', 'n'], with_({ position: countPos, steps })), SETS, [...path, ...at, 'count', 'n']) && ok
        else if (c.k === 'range' && invertedLiterals(c.min, c.max)) ok = !!err({ code: 'literalDomain', former: 'step', field: 'count', value: litNum(c.min)!, message: `a set-count range from ${litNum(c.min)} down to ${litNum(c.max)} is empty: its min is above its max` }, [...path, ...at, 'count'])
        else if (c.k === 'range')
          ok = expect(sub(c.min, [...at, 'count', 'min'], with_({ position: countPos, steps })), SETS, [...path, ...at, 'count', 'min']) && expect(sub(c.max, [...at, 'count', 'max'], with_({ position: countPos, steps })), SETS, [...path, ...at, 'count', 'max']) && ok
        else {
          literalBound(c.max, [...path, ...at, 'count', 'max'])
          const cond = c.k === 'until' ? c.stop : c.go
          const seg = c.k === 'until' ? 'stop' : 'go'
          ok = expect(sub(cond, [...at, 'count', seg], with_({ position: targetPos, steps: own })), BOOL, [...path, ...at, 'count', seg]) && ok
        }
        const loops = c.k === 'until' || c.k === 'while'
        const r = sub(s.target, [...at, 'target'], with_({ position: targetPos, steps: loops ? own : steps }))
        ok = expect(r, dom('set'), [...path, ...at, 'target']) && ok
        if (r && r.ty.t === 'dom')
          for (const m of r.ty.metrics ?? []) {
            targets.add(m)
            // A literal set names the metric's own node; any other target (if, app, param) only the step's target.
            if (logs && logging && !logs.includes(m)) ok = notLogged(m, logging, logs, s.target.k === 'set' ? [...path, ...at, 'target', 'target', m] : [...path, ...at, 'target'])
          }
        earlier.push(s.id)
      }
      t.steps.forEach((s, i) => {
        if (s.k === 'step') return checkStep(s, ['steps', i])
        literalBound(s.n, [...path, 'steps', i, 'n'])
        s.body.forEach((b, j) => checkStep(b, ['steps', i, 'body', j]))
        earlier.push(s.id)
      })
      if (t.intensifier) ok = expect(sub(t.intensifier, ['intensifier']), dom('technique'), [...path, 'intensifier']) && ok
      return ok ? done(sessionTy(logging, [...targets]), 0) : null
    }
    case 'xform':
      return xform(t)
    case 'technique': {
      if (!t.stages.length) return err({ code: 'literalDomain', former: 'technique', field: 'stages', value: 0, message: 'a technique needs at least one stage' }, [...path, 'stages'])
      const ok = t.stages.every((s, i) => expect(sub(s, ['stages', i]), dom('set'), [...path, 'stages', i]))
      return ok ? done(dom('technique'), 0) : null
    }
    case 'tempo': {
      const bad = (['ecc', 'pause', 'con', 'top'] as const).find((f) => !(typeof t[f] === 'number' && Number.isFinite(t[f]) && t[f] >= 0))
      if (bad) return err({ code: 'literalDomain', former: 'tempo', field: bad, value: t[bad], message: `a tempo phase is a number of seconds from 0, got ${t[bad]}` }, [...path, bad])
      return done(dom('tempo'), 0)
    }
    case 'patch': {
      // `cap: 'event'` stands in for "not a handler scope"; GRANTS is not consulted (specified).
      if (!sc.state || !sc.writer) return err({ code: 'capabilityEscape', cap: 'event', position: sc.position, message: 'a patch is a handler outcome' })
      let ok = true
      for (const [field, f] of Object.entries(t.set)) {
        const at = [...path, 'set', field]
        const d = sc.state[field]
        if (f.mode === 'commit' && sc.writer === 'periodClosed') {
          ok = !!err({ code: 'timeCommit', message: `a calendar-caused handler may only propose or keep: time alone never commits (L13), and ${field} would commit` }, at)
          continue
        }
        if (!d) {
          ok = !!err({ code: 'notOwner', field, message: `this scope does not own ${field}` }, at)
          continue
        }
        if (!(d.writableBy as string[]).includes(sc.writer))
          ok = !!err({ code: 'notWritableHere', field, writer: sc.writer, writableBy: d.writableBy, message: `${field} is writable by ${d.writableBy.join(', ')}, not ${sc.writer}` }, at)
        ok = expect(sub(f.to, ['set', field, 'to']), d.ty, [...at, 'to']) && ok
      }
      return ok ? done({ t: 'upd', scope: sc.position === 'aggregate' ? 'program' : 'slot' }, 0) : null
    }
    default: {
      const k = (t as { k: string }).k
      return err({ code: 'unknownName', name: k, message: `no former ${k}${k === 'both' || k === 'commit' || k === 'propose' || k === 'keep' ? ': a handler outcome is one patch' : k === 'iterate' ? ': iterate is fold over range' : ['bands', 'byLevel', 'schedule', 'mapLit'].includes(k) ? ': lookups are table' : ''}` })
    }
  }

  function table(t: Extract<Term, { k: 'table' }>): Res | null {
    const key = sub(t.key, ['key'])
    if (!key) return null
    const kt = key.ty
    const shape = (why: string) => err({ code: 'tableShape', why, message: `table on ${showTy(kt)}: ${why}` })
    let ty: Ty | null = null
    const value = (x: Term, seg: (string | number)[]) => {
      const r = sub(x, seg)
      boundary(lastKid())
      if (r && ty && !expect(r, ty, [...path, ...seg])) return false
      if (r) ty ??= r.ty
      return !!r
    }
    let ok = t.rows.length > 0 || !!shape('a table needs at least one row')
    t.rows.forEach((row, i) => (ok = value(row.then, ['rows', i, 'then']) && ok))
    if (t.otherwise) ok = value(t.otherwise, ['otherwise']) && ok
    if (!ok || !ty) return null
    const keys = t.rows.map((r) => r.when)
    if (kt.t === 'q' && kt.clock === 'progress') {
      if (keys.some((k) => k !== null)) return shape('rows on the progress clock are positional: row i is week i')
      if (!t.overflow) return shape('say what happens past the last row: hold or cycle')
      if (t.otherwise) return shape('a positional table has no otherwise: overflow covers it')
    } else if (t.overflow) return shape('only a table on the progress clock has an overflow')
    else if (kt.t === 'ord' || kt.t === 'enum') {
      if (t.otherwise) return shape('rows cover every level or tag, so an otherwise could never apply')
      const all: readonly (number | string)[] = kt.t === 'ord' ? SCALE_LEVELS[kt.scale] : (enumTags(kt.name) ?? [])
      if (keys.some((k) => typeof k !== (kt.t === 'ord' ? 'number' : 'string'))) return shape(kt.t === 'ord' ? 'ordinal rows are keyed by level' : 'enum rows are keyed by tag')
      if (new Set(keys).size !== keys.length) return shape('each level or tag has one row: a repeated row could never apply')
      const given = keys as (number | string)[]
      const missing = all.filter((x) => !given.includes(x)).map(String)
      if (missing.length) return err({ code: 'nonExhaustive', missing, message: `table on ${showTy(kt)} misses ${missing.join(', ')}` })
      const extra = given.filter((g) => !all.includes(g as never))
      if (extra.length) return err({ code: 'unknownName', name: String(extra[0]), message: `${String(extra[0])} is not a ${showTy(kt)}` })
    } else if (kt.t === 'q') {
      if (!t.otherwise) return shape('threshold rows need an otherwise above the last one')
      let prev = -Infinity
      for (const [i, k] of keys.entries()) {
        const at = [...path, 'rows', i, 'when']
        if (!k || typeof k !== 'object' || k.k !== 'q') return err({ code: 'boundNotLiteral', got: k, message: 'a threshold is a literal quantity' }, at)
        const u = unknownUnit(k)
        if (u !== null) return err({ code: 'unknownName', name: u, message: `no unit ${u}` }, at)
        if (k.per && (CLOCK_UNITS.includes(k.unit) || CLOCK_UNITS.includes(k.per)))
          return err({ code: 'clockRate', unit: k.unit, per: k.per, message: `a rate of ${k.unit} per ${k.per} converts a clock into a quantity; progress follows training, never the passing of days or weeks` }, at)
        if (!dimEq(litDim(k.unit, k.per), kt.dim)) return err({ code: 'unitMismatch', expected: Q(kt.dim), got: Q(litDim(k.unit, k.per)), message: `threshold in ${dimName(litDim(k.unit, k.per))} on a ${dimName(kt.dim)} key` }, at)
        if (!(k.v > prev)) return err({ code: 'thresholdOrder', at: i, message: `row ${i} is not above the row before it, so it could never apply: thresholds ascend strictly` }, at)
        prev = k.v
      }
    } else if (kt.t === 'ref') {
      if (!t.otherwise) return shape('ref rows need an otherwise for every other id')
      if (keys.some((k) => typeof k !== 'string')) return shape('ref rows are keyed by id')
      if (kt.kind === 'muscle' && sc.program) for (const k of keys) if (!sc.program.muscles.includes(k as string)) return err({ code: 'unknownName', name: String(k), message: `no muscle ${String(k)}` })
      if (kt.kind === 'exercise') for (const k of keys) if (!sc.reg.vocab.exercises[k as string]) return err({ code: 'unknownName', name: String(k), message: `no exercise ${String(k)} in the registry` })
    } else return shape('a table key is a clock, a rating, an enum, a quantity or a ref')
    return done(ty, 1)
  }

  function xform(t: Extract<Term, { k: 'xform' }>): Res | null {
    const s = sub(t.s, ['s'])
    if (!expect(s, dom('session'), [...path, 's'])) return null
    const st = s!.ty.t === 'dom' ? s!.ty : (dom('session') as Extract<Ty, { t: 'dom' }>)
    const logs = st.logging ? loggedMetrics(sc.reg.vocab, st.logging) : null
    const wants: Record<string, Ty | null> = { scaleMetric: ONE, scaleSets: ONE, capEffort: EFFORT, setTempo: dom('tempo'), reshape: dom('set'), stripIntensifier: null, swapExercise: ref('exercise'), addSets: SETS }
    if (!(t.op in wants)) return err({ code: 'unknownName', name: String(t.op), message: `no session transformer ${String(t.op)}` })
    const want = wants[t.op]!
    if (t.op === 'scaleMetric' && !(t.metric && sc.reg.vocab.metrics[t.metric])) return err({ code: 'unknownName', name: t.metric ?? 'metric', message: 'scaleMetric names a registered metric' })
    const touched = t.op === 'scaleMetric' ? t.metric! : t.op === 'capEffort' ? 'effort' : null
    if (touched && logs && st.logging && !logs.includes(touched)) return (notLogged(touched, st.logging, logs, path), null)
    if (!want) return done(st, 0)
    if (!t.arg) return err({ code: 'missingArg', param: 'arg', message: `${t.op} needs an argument` })
    const a = sub(t.arg, ['arg'])
    if (!expect(a, want, [...path, 'arg'])) return null
    if (t.allowZero !== undefined && (t.op !== 'scaleSets' || t.allowZero !== true))
      return err({ code: 'literalDomain', former: 'xform', field: 'allowZero', value: String(t.allowZero), message: `allowZero is scaleSets's option and is written as true or omitted` }, [...path, 'allowZero'])
    if (t.op === 'scaleSets' && t.arg.k === 'lit' && t.arg.lit.k === 'q' && t.arg.lit.v > 1)
      return err({ code: 'literalDomain', former: 'xform', field: 'arg', value: t.arg.lit.v, message: `scaleSets shrinks a session (a deload); a factor of ${t.arg.lit.v} would add sets it has no targets for: add sets with addSets` }, [...path, 'arg'])
    if (t.op === 'reshape' && logs && st.logging && a!.ty.t === 'dom')
      for (const m of a!.ty.metrics ?? []) if (!logs.includes(m)) return (notLogged(m, st.logging, logs, [...path, 'arg']), null)
    if (t.op === 'swapExercise' && a!.ty.t === 'ref') {
      const to = a!.ty.logging
      if (!to) return done(sessionTy(undefined, st.metrics ?? []), 0)
      const newLogs = loggedMetrics(sc.reg.vocab, to)
      const lost = (st.metrics ?? []).filter((m) => !newLogs.includes(m))
      if (lost.length)
        return err({ code: 'loggingMismatch', from: (st.logging ?? ['unknown']).join(' or '), to: to.join(' or '), metrics: lost, message: `swapping to a ${to.join(' or ')} exercise would target ${lost.join(', ')}, which it does not log` }, [...path, 'arg'])
      return done(sessionTy(to, st.metrics ?? []), 0)
    }
    return done(st, 0)
  }

  function bound(b: BoundIR, want: Ty, at: Path): boolean {
    const v = (x: Term, seg: string, mayBeAbsent: boolean) => {
      const r = sub(x, [...at.slice(path.length), seg])
      if (r && mayBeAbsent && r.ty.t === 'opt') return expect({ ...r, ty: r.ty.of }, want, [...at, seg])
      return expect(r, want, [...at, seg])
    }
    switch (b.b) {
      case 'exact':
      case 'atMost':
        return v(b.v, 'v', true)
      case 'atLeast':
        return v(b.v, 'v', false)
      case 'range':
        if (invertedLiterals(b.min, b.max)) return !!err({ code: 'literalDomain', former: 'set', field: 'range', value: litNum(b.min)!, message: `a range from ${litNum(b.min)} down to ${litNum(b.max)} is empty: its min is above its max` }, at)
        return v(b.min, 'min', true) && v(b.max, 'max', true)
      case 'open':
        return true
    }
  }
}

/** Every node of a term, depth first. */
function* termNodes(t: unknown): Generator<Term> {
  if (!t || typeof t !== 'object') return
  const n = t as Term
  if (typeof n.k === 'string') yield n
  for (const v of Object.values(n)) if (v && typeof v === 'object') yield* termNodes(v)
}
const litNum = (t: Term): number | null => (t.k === 'lit' && t.lit.k === 'q' ? t.lit.v : null)
/** Two literal edges in the wrong order (F13). */
const invertedLiterals = (min: Term, max: Term) => {
  const [a, b] = [litNum(min), litNum(max)]
  return a !== null && b !== null && a > b
}

// ── shared helpers for the definition checks ────────────────────────────────

/** Built-in enums plus the ones a definition declares; the verdict last, so
 *  no declaration can redefine it. */
export const enumsWith = (own: Readonly<Record<string, readonly string[]>> = {}): Record<string, readonly string[]> => ({
  ...ENUM_VALUES,
  instanceStatus: ['active', 'paused', 'lapsed', 'completed', 'abandoned'],
  ...own,
  verdict: VERDICT_TAGS,
})

export const baseScope = (reg: Registry, position: Position, params: Record<string, Ty>, def: Scope['def']): Scope => ({
  position,
  def,
  params,
  state: null,
  facts: [],
  enums: enumsWith(),
  peers: null,
  programFields: null,
  program: null,
  steps: { earlier: [], all: [], own: null },
  writer: null,
  vars: new Map(),
  reg,
})

/** Check one term at a top-level position: sort, the clock sink, then the budget. */
export function top(t: Term, sc: Scope, path: Path, want: Ty | null, out: TypeError[]): Res | null {
  const r = infer(t, sc, path, out)
  if (!r) return null
  if (want && r.ty.t === 'opt' && want.t !== 'opt' && eqTy(r.ty.of, want)) {
    out.push({ code: 'absenceUnhandled', got: r.ty, path, message: `optional ${showTy(want)} used where a ${showTy(want)} is required; handle absence with known/orElse` })
    return null
  }
  if (want && !eqTy(r.ty, want)) {
    out.push({ code: 'unitMismatch', expected: want, got: r.ty, path, message: `expected ${showTy(want)}, got ${showTy(r.ty)}` })
    return null
  }
  const sink = want && calendarSink(r.ty, want)
  if (sink) {
    out.push({ ...sink, path } as TypeError)
    return null
  }
  if (r.cost > BUDGET) out.push({ code: 'overBudget', cost: r.cost, budget: BUDGET, fix: OVER_BUDGET_FIX, path, message: `${r.cost} operators in one phrase (budget ${BUDGET}); ${OVER_BUDGET_FIX}` })
  return r
}
