/**
 * checkdefs.ts — the definition-level half of the running checker: what a
 * whole fn, scheme, program or macro must satisfy beyond its terms.
 *
 * Closures this file owns (each has an IR negative in demo §3):
 *   publication order      a registry is an ordered publication log; `app`
 *                          sees only earlier entries (futureRef)
 *   primary muscle         every slot has exactly one primary (primaryMuscle)
 *   groups                 rest belongs to the group (restOwnedByGroup); an
 *                          EMOM member has a fixed set count unless the group
 *                          is death-by (emomNeedsFixedCount)
 *   policies and phases    Use args typed against the definition they apply;
 *                          the one application order (policyOrder); a plan
 *                          branching on a week role the program also
 *                          transforms (roleDoubleEncoding); an outcome rule
 *                          naming a kind no field has (noSuchKind)
 *   frequency              selectors resolve, bounds are literal, the set is
 *                          feasible with the rotation (infeasibleFrequency)
 *   exports and imports    names and types match the exporter (importMismatch)
 *   macros                 peakOn needs anchored drift and fixed phases;
 *                          bounded min ≤ max; open only last; fixed ⇒ once
 */
import type { FnDef, StepIR, Term, Ty } from './algebra'
import { BASE_VOCAB, type Vocab } from './registry'
import { baseScope, BOOL, DAYS, dom, enumsWith, eqTy, infer, isLib, keyOf, ONE, showTy, stepIds, top, type Path, type ProgramView, type Registry, type Scope } from './checker'
import { valueText } from './describe-run'
import { runFnExample } from './evaluate'
import { runSchemeExample } from './project'
import type { TypeError, WriteEntry } from './engine'
import { effectiveFrequency, feasibility, MAX_PERIOD_DAYS, type Selector } from './time'
import { calReads } from './ports'
export { calReads }
import { kindOf, LIFECYCLE_EXPORTS, type AggEventKind, type AnyDef, type MacroDef, type Policy, type ProgramDef, type SchemeDef, type SlotEventKind, type StateDecl, type Use, type Writer } from './structure'

// ── the publication log ─────────────────────────────────────────────────────

type Published = AnyDef | { def: AnyDef }
/** A registry is the publication log in ORDER. `app` may resolve only an
 *  entry published before its caller, so a definition can never reach itself:
 *  the reference graph is a DAG by time, and L1 holds by construction. */
export function publish(entries: readonly Published[], vocab: Vocab = BASE_VOCAB): Registry {
  const reg: Registry = { fns: new Map(), schemes: new Map(), programs: new Map(), macros: new Map(), seq: new Map(), vocab }
  for (const e of entries) {
    const d = 'kind' in e ? e : e.def
    const k = keyOf(d.ref)
    if (reg.seq.has(k)) continue
    reg.seq.set(k, reg.seq.size)
    if (d.kind === 'fn') reg.fns.set(k, d)
    if (d.kind === 'scheme') reg.schemes.set(k, d)
    if (d.kind === 'program') reg.programs.set(k, d)
    if (d.kind === 'macro') reg.macros.set(k, d)
  }
  return reg
}
/** A definition's publication seq; an unpublished one sits after everything. */
const seqOf = (reg: Registry, r: { id: string; version: number }) => reg.seq.get(keyOf(r)) ?? reg.seq.size
const defOf = (reg: Registry, r: { id: string; version: number }) => ({ id: r.id, seq: seqOf(reg, r) })

// ── declarations ────────────────────────────────────────────────────────────

/** The events a handler may be keyed by, total over each union. */
const SLOT_EVENTS: Record<SlotEventKind, true> = { session: true, weekEnd: true, cycleEnd: true, blockEnd: true, periodClosed: true }
const AGG_EVENTS: Record<AggEventKind, true> = { weekEnd: true, session: true, periodClosed: true }
const unknownEvent = (ev: string, known: Record<string, true>, at: Path, out: TypeError[]) =>
  !(ev in known) && !!out.push({ code: 'unknownName', name: ev, path: at, message: `no event ${ev}: a handler is keyed by ${Object.keys(known).join(', ')}` })

const onCalendar = (t: Ty): boolean => (t.t === 'q' ? t.clock === 'calendar' : t.t === 'opt' || t.t === 'list' || t.t === 'map' ? onCalendar(t.of) : false)
/** The clock law at a declaration: a calendar-derived value may only be
 *  compared, so no param, result or state field may be declared on that clock
 *  (it would store the calendar or pass it on). */
function calendarDecls(decls: [Path, Ty][], out: TypeError[]) {
  for (const [at, t] of decls)
    if (onCalendar(t)) out.push({ code: 'clockMix', path: at, message: `${showTy(t)} is declared on the calendar clock: a calendar value may only be compared, never stored or passed on` })
}
/** An enum with no tags (F1): `keys enum:NAME` is typed a NON-EMPTY list, so
 *  an empty enum is the one way a checked definition could hand nth an empty
 *  list. Refused at the declaration. */
function enumDecls(enums: Readonly<Record<string, readonly string[]>>, out: TypeError[]) {
  for (const [name, tags] of Object.entries(enums))
    if (!tags.length) out.push({ code: 'literalDomain', former: 'enums', field: name, value: 0, path: ['enums', name], message: `enum ${name} declares no tags; an enum needs at least one` })
}
/** A slot, day or state field named like an array index (P2): a JSON object
 *  read by a JavaScript engine lists such keys first, in numeric order, so
 *  declaration order (which slot comes first in `keys slots`, which boundary
 *  handler runs first, which state field initializes first) would silently
 *  differ between implementations. Refused at the declaration. */
function nameDecls(names: readonly string[], at: Path, former: string, out: TypeError[]) {
  for (const n of names)
    if (/^(0|[1-9]\d*)$/.test(n)) out.push({ code: 'literalDomain', former, field: at.join('.'), value: n, path: [...at, n], message: `${n} is a number, not a name: name it (a number-like key would be reordered)` })
}
const paramDecls = (params: Record<string, Ty>): [Path, Ty][] => Object.entries(params).map(([k, t]) => [['params', k], t])
const stateDecls = (state: Record<string, StateDecl>, at: Path): [Path, Ty][] => Object.entries(state).map(([k, d]) => [[...at, k, 'ty'], d.ty])

// ── fns ─────────────────────────────────────────────────────────────────────

/** A library template renders in place of the mechanism, so it must name
 *  every parameter and nothing else (D5). */
function templateHoles(says: string, params: Record<string, Ty>, out: TypeError[]) {
  const holes = [...says.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
  const names = Object.keys(params)
  const extra = holes.filter((h) => !names.includes(h))
  const missing = names.filter((p) => !holes.includes(p))
  if (extra.length || missing.length) out.push({ code: 'templateHoles', extra, missing, path: ['says'], message: `template holes must equal params (extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})` })
}

export function checkFn(f: FnDef, reg: Registry): TypeError[] {
  const out: TypeError[] = []
  calendarDecls([...paramDecls(f.params), [['result'], f.result]], out)
  enumDecls(f.enums, out)
  // A template renders only on a library definition (D5); only there must its holes equal the params.
  if (f.ref.id.startsWith('lib/')) templateHoles(f.says, f.params, out)
  const def = defOf(reg, f.ref)
  const sc = (position: Scope['position'], params: Record<string, Ty>): Scope => ({ ...baseScope(reg, position, params, def), enums: enumsWith(f.enums) })
  top(f.body, sc('fnBody', f.params), ['body'], f.result, out)
  f.examples.forEach((ex, i) => {
    for (const [a, x] of Object.entries(ex.args))
      if (!(a in f.params)) out.push({ code: 'unknownName', name: a, path: ['examples', i, 'args', a], message: `${f.ref.id} has no parameter ${a}` })
      else top(x, sc('example', {}), ['examples', i, 'args', a], f.params[a]!, out)
    top(ex.gives, sc('example', {}), ['examples', i, 'gives'], f.result, out)
  })
  // Publication runs every example: a definition whose own example is wrong is refused (L8).
  if (!out.length)
    f.examples.forEach((ex, i) => {
      const r = runFnExample(reg, f, ex)
      if (!r.ok)
        out.push({ code: 'exampleFailed', path: ['examples', i], message: typeof r.got === 'string' ? `example ${i} cannot be evaluated: ${r.got}` : `example ${i} evaluates to ${valueText(r.got, reg)}, not the ${valueText(r.want, reg)} it promises` })
    })
  return out
}

// ── schemes ─────────────────────────────────────────────────────────────────

/** Every node of a term, depth first (for structural rules over plans). */
function* nodes(t: unknown): Generator<Term> {
  if (!t || typeof t !== 'object') return
  const n = t as Term
  if (typeof n.k === 'string') yield n
  for (const v of Object.values(n)) if (v && typeof v === 'object') yield* nodes(v)
}
/** A plan prescribes rest when one of its sets carries a rest term; authoring JSON may omit the field. */
export const prescribesRest = (plan: Term): boolean => [...nodes(plan)].some((n) => n.k === 'set' && n.rest != null)
const planStepIds = (plan: Term): string[] => [...new Set([...nodes(plan)].flatMap((n) => (n.k === 'session' ? stepIds(n.steps) : [])))]
const planSteps = (plan: Term): Extract<StepIR, { k: 'step' }>[] =>
  [...nodes(plan)].flatMap((n) => (n.k === 'session' ? n.steps.flatMap((s) => (s.k === 'repeat' ? s.body : [s])) : []))

export interface SlotContext {
  peers: Scope['peers']
  programFields: Record<string, Ty> | null
  program: ProgramView | null
}

export function checkScheme(d: SchemeDef, reg: Registry, ctx: SlotContext = { peers: null, programFields: null, program: null }): TypeError[] {
  const out: TypeError[] = []
  calendarDecls([...paramDecls(d.params), ...stateDecls(d.state, ['state'])], out)
  enumDecls(d.enums, out)
  nameDecls(Object.keys(d.state), ['state'], 'scheme', out)
  const all = planStepIds(d.plan)
  const sc = (position: Scope['position'], writer: Scope['writer'] = null): Scope => ({
    ...baseScope(reg, position, d.params, defOf(reg, d.ref)),
    state: d.state,
    facts: d.facts,
    enums: enumsWith(d.enums),
    peers: ctx.peers,
    programFields: ctx.programFields,
    program: ctx.program,
    steps: { earlier: [], all, own: null },
    writer,
  })
  for (const [k, s] of Object.entries(d.state)) top(s.init, sc('init'), ['state', k, 'init'], s.ty, out)
  top(d.plan, sc('plan'), ['plan'], dom('session'), out)
  for (const [ev, h] of Object.entries(d.on)) if (h && !unknownEvent(ev, SLOT_EVENTS, ['on', ev], out)) top(h, sc('handler', ev as Writer), ['on', ev], { t: 'upd', scope: 'slot' }, out)
  // A library scheme's template renders, so its holes must be its params (as for a fn). It is checked
  // after the handlers here and before the body in checkFn: each order is fixed by the spec.
  if (isLib(d.ref.id)) templateHoles(d.says, d.params, out)
  // Publication projects every scheme example and compares the state it reaches.
  if (!out.length)
    d.examples.forEach((ex, i) => {
      const r = runSchemeExample(reg, d, ex)
      if (!r.ok) out.push({ code: 'exampleFailed', path: ['examples', i], message: `after ${ex.afterSessions} sessions (${ex.assume}) the state is ${Object.entries(r.got).map(([k, v]) => `${k} ${valueText(v, reg)}`).join(', ')}, not ${Object.entries(r.want).map(([k, v]) => `${k} ${valueText(v, reg)}`).join(', ')}` })
    })
  return out
}

/** writeSet: every (field, event, mode) the handlers can produce. */
export function writeSet(d: SchemeDef | ProgramDef): WriteEntry[] {
  const out: WriteEntry[] = []
  const walk = (h: Term, scope: WriteEntry['scope'], on: WriteEntry['on']) => {
    for (const n of nodes(h)) if (n.k === 'patch') for (const [field, f] of Object.entries(n.set)) out.push({ scope, field, on, mode: f.mode })
  }
  if (d.kind === 'scheme') for (const [on, h] of Object.entries(d.on)) walk(h, 'slot', on as WriteEntry['on'])
  else for (const [on, h] of Object.entries(d.aggregate?.on ?? {})) walk(h, 'program', on as WriteEntry['on'])
  return out
}

// ── programs ────────────────────────────────────────────────────────────────

function peersOf(p: ProgramDef, reg: Registry): NonNullable<Scope['peers']> {
  // A program has no previous phase: only a macro handoff reads one (checkMacro).
  return (slot, field, of) => {
    const b = p.slots[slot]
    return b && of === 'current' ? reg.schemes.get(keyOf(b.scheme))?.state[field]?.ty : undefined
  }
}

/** A Use applied to a session: its definition is a published session→session
 *  fn and its args match the remaining params exactly, by type. */
function checkUse(u: Use, at: Path, sc: Scope, out: TypeError[]) {
  const f = sc.reg.fns.get(keyOf(u.def))
  if (!f || seqOf(sc.reg, u.def) >= sc.def.seq) {
    out.push({ code: 'futureRef', ref: u.def, path: at, message: `${keyOf(u.def)} is not published before ${sc.def.id}` })
    return
  }
  if (!eqTy(f.params[u.hole] ?? ONE, dom('session')) || !eqTy(f.result, dom('session')))
    out.push({ code: 'unitMismatch', expected: dom('session'), got: f.result, path: at, message: `${u.def.id} is not a session→session definition` })
  for (const p of Object.keys(f.params)) if (p !== u.hole && !(p in u.args)) out.push({ code: 'missingArg', param: p, path: [...at, 'args'], message: `${u.def.id} needs ${p}` })
  for (const [a, x] of Object.entries(u.args)) {
    const want = f.params[a]
    if (!want || a === u.hole) out.push({ code: 'unknownName', name: a, path: [...at, 'args', a], message: `${u.def.id} has no parameter ${a} to bind` })
    else top(x, sc, [...at, 'args', a], want, out)
  }
}

/** The week roles a term branches on: `pos.role == r`, or a match/table on pos.role. */
const roleTests = (t: Term): string[] =>
  [...nodes(t)].flatMap((n) => {
    const isRole = (x: Term) => x.k === 'pos' && x.field === 'role'
    if (n.k === 'cmp' && (isRole(n.a) || isRole(n.b))) return [n.a, n.b].flatMap((x) => (x.k === 'lit' && x.lit.k === 'enum' ? [x.lit.tag] : []))
    if (n.k === 'match' && isRole(n.on)) return Object.keys(n.cases)
    if (n.k === 'table' && isRole(n.key)) return n.rows.flatMap((r) => (typeof r.when === 'string' ? [r.when] : []))
    return []
  })
const ORIGIN_ORDER: Policy['origin'][] = ['role', 'allocation', 'declared']

const literalDays = (n: unknown, at: Path, out: TypeError[], what: string) => {
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PERIOD_DAYS) return true
  out.push({ code: 'boundNotLiteral', got: n, path: at, message: `${what} is a literal number of days from 1 to ${MAX_PERIOD_DAYS}` })
  return false
}

export function checkProgram(p: ProgramDef, reg: Registry): { at: string; errors: TypeError[] }[] {
  const report: { at: string; errors: TypeError[] }[] = []
  const out: TypeError[] = []
  const def = defOf(reg, p.ref)
  const peers = peersOf(p, reg)
  const agState = p.aggregate?.state ?? {}
  const programFields = Object.fromEntries(Object.entries(agState).map(([k, s]) => [k, s.ty]))
  const view: ProgramView = {
    slots: Object.keys(p.slots),
    days: Object.keys(p.days),
    muscles: p.muscles,
    tags: [...new Set(Object.values(p.slots).flatMap((b) => b.meta.tags ?? []))],
  }
  const scope = (position: Scope['position'], extra: Partial<Scope> = {}): Scope => ({
    ...baseScope(reg, position, p.params, def),
    facts: p.facts,
    enums: enumsWith(p.enums),
    program: view,
    ...extra,
  })

  calendarDecls([...paramDecls(p.params), ...stateDecls(agState, ['aggregate', 'state'])], out)
  enumDecls(p.enums, out)
  nameDecls(Object.keys(p.slots), ['slots'], 'program', out)
  nameDecls(Object.keys(p.days), ['days'], 'program', out)
  nameDecls(Object.keys(agState), ['aggregate', 'state'], 'program', out)

  // Slots: bindings, muscles, exactly one primary.
  const checked = new Set<string>()
  for (const [slot, b] of Object.entries(p.slots)) {
    const s = reg.schemes.get(keyOf(b.scheme))
    if (!s || seqOf(reg, b.scheme) >= def.seq) {
      out.push({ code: 'futureRef', ref: b.scheme, path: ['slots', slot, 'scheme'], message: `${keyOf(b.scheme)} is not published before ${p.ref.id}` })
      continue
    }
    for (const prm of Object.keys(s.params)) if (!(prm in b.args)) out.push({ code: 'missingArg', param: prm, path: ['slots', slot, 'args'], message: `${slot} must bind ${prm}` })
    for (const [a, x] of Object.entries(b.args))
      if (!(a in s.params)) out.push({ code: 'unknownName', name: a, path: ['slots', slot, 'args', a], message: `${s.ref.id} has no parameter ${a} to bind` })
      else top(x, scope('bind', { peers }), ['slots', slot, 'args', a], s.params[a]!, out)
    for (const m of Object.keys(b.meta.muscles)) if (!p.muscles.includes(m)) out.push({ code: 'unknownName', name: m, path: ['slots', slot, 'meta'], message: `muscle ${m} is not declared by the program` })
    const primaries = Object.values(b.meta.muscles).filter((c) => c === 1).length
    if (primaries !== 1) out.push({ code: 'primaryMuscle', slot, primaries, path: ['slots', slot, 'meta', 'muscles'], message: `${slot} has ${primaries} primary muscles; exactly one (contribution 1) is required, or allocation never reaches it` })
    const k = keyOf(b.scheme)
    if (!checked.has(k)) {
      checked.add(k)
      report.push({ at: `scheme ${k}`, errors: checkScheme(s, reg, { peers, programFields, program: view }) })
    }
  }

  // Days and groups: the group owns rest; EMOM members count fixed sets.
  const planOf = (slot: string) => {
    const b = p.slots[slot]
    return b ? reg.schemes.get(keyOf(b.scheme))?.plan : undefined
  }
  for (const [day, groups] of Object.entries(p.days))
    groups.forEach((g, gi) => {
      const at = ['days', day, gi]
      const members = g.k === 'single' ? [g.slot] : g.slots
      for (const s of members) if (!(s in p.slots)) out.push({ code: 'unknownName', name: s, path: at, message: `day ${day} names no slot ${s}` })
      const times: [string, Term][] =
        g.k === 'superset' ? [['between', g.between], ['after', g.after]] : g.k === 'circuit' ? [['restBetweenRounds', g.restBetweenRounds]] : g.k === 'emom' ? [['every', g.every]] : g.k === 'amrapFor' ? [['cap', g.cap]] : []
      for (const [f, x] of times) top(x, scope('example'), [...at, f], { t: 'q', dim: { time: 1 } }, out)
      if (g.k === 'single') return
      for (const s of members) {
        const plan = planOf(s)
        if (!plan) continue
        if (prescribesRest(plan))
          out.push({ code: 'restOwnedByGroup', slot: s, path: [...at, 'slots'], message: `${s} prescribes its own rest inside a ${g.k}; the group owns rest between members and rounds` })
        if (g.k === 'emom' && !g.untilFail && planSteps(plan).some((st) => st.count.k !== 'n'))
          out.push({ code: 'emomNeedsFixedCount', slot: s, path: [...at, 'slots'], message: `${s} has a variable set count; an EMOM takes one set per member per minute, so its count must be fixed (or declare the group death-by)` })
      }
    })
  const rotationDays = p.rotation.k === 'pattern' ? p.rotation.days.filter((x): x is string => typeof x === 'string') : p.rotation.days
  for (const d of rotationDays) if (!(d in p.days)) out.push({ code: 'unknownName', name: d, path: ['rotation'], message: `the rotation names no day ${d}` })

  // Policies: `when` is a predicate over program state, facts and both
  // clocks; origins follow the one application order; a role transformed by
  // policy is not ALSO branched on inside a slot's plan; an outcome rule
  // names a kind some field has.
  const policyScope = scope('policy', { state: agState })
  const kinds = new Set(
    [...Object.values(p.slots).flatMap((b) => Object.values(reg.schemes.get(keyOf(b.scheme))?.state ?? {})), ...Object.values(agState)].map((d) => kindOf(d.ty)),
  )
  p.policies.forEach((pol, i) => {
    top(pol.when, policyScope, ['policies', i, 'when'], BOOL, out)
    if (pol.plan) checkUse(pol.plan, ['policies', i, 'plan'], policyScope, out)
    const prev = p.policies[i - 1]
    if (prev && ORIGIN_ORDER.indexOf(prev.origin) > ORIGIN_ORDER.indexOf(pol.origin))
      out.push({ code: 'policyOrder', at: i, path: ['policies', i], message: `a ${pol.origin} policy after a ${prev.origin} one: the order is role sugar, the allocation default, then declared policies` })
    for (const k of pol.outcome?.demote.kinds ?? [])
      if (!kinds.has(k)) out.push({ code: 'noSuchKind', kind: k, path: ['policies', i, 'outcome', 'demote', 'kinds'], message: `no state field of this program is a ${k} field, so this rule could never apply` })
  })
  const transformed = new Set(p.policies.filter((x) => x.origin === 'role' && x.plan).flatMap((x) => roleTests(x.when)))
  for (const [slot, b] of Object.entries(p.slots)) {
    const plan = reg.schemes.get(keyOf(b.scheme))?.plan
    for (const role of plan ? new Set(roleTests(plan)) : [])
      if (transformed.has(role))
        out.push({ code: 'roleDoubleEncoding', role, slot, path: ['slots', slot], message: `${slot}'s plan already branches on ${role} weeks, and the program transforms ${role} weeks too: the two would stack` })
  }

  // Grids: one per issued metric, of that metric's dimension.
  for (const [m, g] of Object.entries(p.grids)) if (g) top(g, scope('example'), ['grids', m], { t: 'q', dim: m === 'load' ? { mass: 1 } : { length: 1 } }, out)

  // Frequency: selectors, literal bounds, cadence terms, feasibility.
  const sel = (s: Selector, at: Path) => infer({ k: 'cal', q: { q: 'gap', of: s } }, scope('plan'), at, out)
  p.frequency.forEach((f, i) => {
    const at = ['frequency', i]
    sel(f.of, [...at, 'of'])
    if (f.k !== 'minGap' && !(Number.isInteger(f.n) && f.n >= 1)) out.push({ code: 'boundNotLiteral', got: f.n, path: [...at, 'n'], message: 'a frequency count is a literal positive integer' })
    if (f.k === 'atLeast' && f.per.k === 'days') literalDays(f.per.n, [...at, 'per', 'n'], out, 'a period')
    if (f.k === 'atMost') literalDays(f.withinDays, [...at, 'withinDays'], out, 'a rolling window')
    if (f.k === 'minGap') {
      literalDays(f.ceiling, [...at, 'ceiling'], out, 'a gap ceiling')
      top(f.gap, scope('cadence', { state: agState, peers }), [...at, 'gap'], DAYS, out)
    }
  })
  const eff = effectiveFrequency(p.frequency, p.rotation)
  // Feasibility is decided over literal counts and periods of at most MAX_PERIOD_DAYS; a longer
  // period (explicit ones are refused above; a pattern rotation's default may exceed it) is not judged.
  if (eff.every((f) => (f.k === 'minGap' || (Number.isInteger(f.n) && f.n >= 1)) && (f.k !== 'atLeast' || f.per.k !== 'days' || f.per.n <= MAX_PERIOD_DAYS))) {
    const bad = feasibility(eff, p.rotation.k === 'daily' ? p.rotation.perDay : 1)
    if (bad) out.push({ code: 'infeasibleFrequency', a: bad.a, b: bad.b, why: bad.why, path: ['frequency'], message: `frequency ${bad.a}${bad.b === null ? '' : ` with ${bad.b}`} is infeasible: ${bad.why}` })
  }

  // Aggregate: facts are the program's declared ones; periodClosed never commits.
  if (p.aggregate) {
    const ag = p.aggregate
    const sc = (position: Scope['position'], writer: Scope['writer'] = null): Scope => scope(position, { state: ag.state, steps: { earlier: [], all: 'any', own: null }, writer })
    for (const [k, s] of Object.entries(ag.state)) top(s.init, sc('init'), ['aggregate', 'state', k, 'init'], s.ty, out)
    for (const [ev, h] of Object.entries(ag.on)) if (h && !unknownEvent(ev, AGG_EVENTS, ['aggregate', 'on', ev], out)) top(h, sc('aggregate', ev as AggEventKind), ['aggregate', 'on', ev], { t: 'upd', scope: 'program' }, out)
  }

  // Exports and imports: names and types against the declarations.
  for (const [name, e] of Object.entries(p.exports)) {
    const t = peers(e.slot, e.field, 'current')
    if (!t || !eqTy(t, e.ty)) out.push({ code: 'importMismatch', param: name, path: ['exports', name], why: t ? `${e.slot}.${e.field} is ${showTy(t)}, declared ${showTy(e.ty)}` : `no slot ${e.slot} with state ${e.field}`, message: `export ${name} does not match its source` })
  }
  for (const [param, imp] of Object.entries(p.imports)) {
    const at = ['imports', param]
    const pt = p.params[param]
    const exporter = reg.programs.get(keyOf(imp.from))
    if (exporter && seqOf(reg, imp.from) >= def.seq) {
      out.push({ code: 'futureRef', ref: imp.from, path: at, message: `${keyOf(imp.from)} is not published before ${p.ref.id}` })
      continue
    }
    const et = exporter ? (exporter.exports[imp.export]?.ty ?? LIFECYCLE_EXPORTS[imp.export]) : undefined
    const why = !pt
      ? `no param ${param}`
      : pt.t !== 'opt'
        ? `${param} must be optional: an absent or abandoned predecessor is silence`
        : !exporter
          ? `no program ${keyOf(imp.from)}`
          : !et
            ? `${imp.from.id} exports no ${imp.export}`
            : !eqTy(pt.of, et) && !eqTy(pt, et) // an optional export feeds an optional param: absence collapses
              ? `${imp.from.id}.${imp.export} is ${showTy(et)}, ${param} expects ${showTy(pt.of)}`
              : null
    if (why) out.push({ code: 'importMismatch', param, why, path: at, message: `import ${param}: ${why}` })
  }

  report.unshift({ at: `program ${keyOf(p.ref)}`, errors: out })
  return report
}

// ── macros ──────────────────────────────────────────────────────────────────

export function checkMacro(m: MacroDef, reg: Registry): TypeError[] {
  const out: TypeError[] = []
  const def = defOf(reg, m.ref)
  if (m.anchor.k === 'peakOn' && m.drift !== 'anchored')
    out.push({ code: 'anchoredRequired', path: ['drift'], message: 'a peakOn macro needs anchored drift: the meet does not move when training slips' })
  m.phases.forEach((ph, i) => {
    const prog = reg.programs.get(keyOf(ph.program))
    if (!prog) {
      out.push({ code: 'unknownName', name: keyOf(ph.program), path: ['phases', i, 'program'], message: `no program ${keyOf(ph.program)}` })
      return
    }
    if (seqOf(reg, ph.program) >= def.seq) {
      out.push({ code: 'futureRef', ref: ph.program, path: ['phases', i, 'program'], message: `${keyOf(ph.program)} is not published before ${m.ref.id}` })
      return
    }
    const L = ph.length
    if (m.anchor.k === 'peakOn' && L.k !== 'fixed') out.push({ code: 'peakNeedsFixed', phase: ph.label, path: ['phases', i, 'length'], message: `${ph.label}: a peak anchor needs fixed-length phases` })
    if (L.k === 'open' && i !== m.phases.length - 1) out.push({ code: 'openNotLast', phase: ph.label, path: ['phases', i, 'length'], message: `${ph.label}: an open phase never ends, so it may only be last` })
    if (L.k === 'fixed' && prog.calendar.repeat !== 'once') out.push({ code: 'fixedNeedsOnce', phase: ph.label, path: ['phases', i, 'length'], message: `${ph.label}: a fixed phase needs a once calendar to have a length` })
    if (L.k === 'bounded' && L.min > L.max) out.push({ code: 'boundsInverted', min: L.min, max: L.max, path: ['phases', i, 'length'], message: `${ph.label}: min ${L.min} weeks exceeds max ${L.max}` })
    const prev = i > 0 ? reg.programs.get(keyOf(m.phases[i - 1]!.program)) : undefined
    const cur = peersOf(prog, reg)
    const before = prev ? peersOf(prev, reg) : () => undefined
    // A handoff argument seeds the phase being started, so it reads only the
    // PREVIOUS phase's terminal state; an advance gate judges the CURRENT one.
    const sc: Scope = { ...baseScope(reg, 'handoff', {}, def), peers: (slot, field, of) => (of === 'prevPhase' ? before(slot, field, 'current') : undefined), facts: prog.facts }
    const gate: Scope = { ...sc, peers: (slot, field, of) => (of === 'current' ? cur(slot, field, 'current') : undefined) }
    for (const prm of Object.keys(prog.params)) if (!(prm in ph.args)) out.push({ code: 'missingArg', param: prm, path: ['phases', i, 'args'], message: `${ph.label} must hand off ${prm}` })
    for (const [a, x] of Object.entries(ph.args))
      if (!(a in prog.params)) out.push({ code: 'unknownName', name: a, path: ['phases', i, 'args', a], message: `${ph.label} has no parameter ${a}` })
      else top(x, sc, ['phases', i, 'args', a], prog.params[a]!, out)
    if (L.k === 'bounded') top(L.advanceWhen, gate, ['phases', i, 'length', 'advanceWhen'], BOOL, out)
    if (ph.transform) checkUse(ph.transform, ['phases', i, 'transform'], { ...baseScope(reg, 'policy', {}, def) }, out)
  })
  return out
}
