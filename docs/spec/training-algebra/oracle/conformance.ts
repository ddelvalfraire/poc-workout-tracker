/**
 * conformance.ts — the checker and publication half of R2's conformance:
 *   1. publication: every worked definition checks, every FnDef example and
 *      SchemeExample is EVALUATED (exampleFailed is live), and a wrong one is
 *      refused;
 *   2. the capability matrix: every (position, capability) cell, granted ones
 *      accepted and denied ones refused, plus a tsc-time proof that GRANTS
 *      equals the algebra's per-position capability unions;
 *   3. the checker suite: one IR negative per refusal class of the test plan.
 * The prose-versus-evaluation differential is differential.ts, imported last.
 * Run: tsx conformance.ts
 */
import type { AggregateCap, BindCap, CadenceCap, Cap, FnCap, FnDef, HandlerCap, HandoffCap, InitCap, LiveCap, PlanCap, PolicyCap, Term, Ty } from './algebra'
import { kg, lb, list1, mul, num, pct, reps, rir, sets, ty } from './algebra'
import { checkFn, checkMacro, checkProgram, checkScheme, publish } from './checkdefs'
import { baseScope, enumsWith, GRANTS, keyOf, top, type Scope } from './checker'
import type { Position, TypeError } from './engine'
import * as ER from './endurance-rehab'
import * as P from './programs'
import type { MacroDef, ProgramDef, SchemeDef } from './structure'
import { assert, eq, reg, suite } from './testkit'
import './differential'

const { t, done } = suite('conformance')
const clone = <X>(x: X): X => structuredClone(x)
const T = (e: { term: Term }) => e.term
const codesOf = (errs: TypeError[]) => errs.map((e) => e.code)
const L = (v: number): Term => ({ k: 'lit', lit: { k: 'q', v, unit: 'x' } })

// ── 1. publication ──────────────────────────────────────────────────────────

t('EC-91 EC-199 L8 X', 'publication: every worked definition checks clean, with all 14 FnDef examples and the SchemeExample evaluated', () => {
  const errs: string[] = []
  for (const f of reg.fns.values()) errs.push(...checkFn(f, reg).map((e) => `${f.ref.id}: ${e.code} ${e.message}`))
  for (const p of reg.programs.values()) for (const r of checkProgram(p, reg)) errs.push(...r.errors.map((e) => `${r.at}: ${e.code} ${e.message}`))
  for (const s of [P.apreTopBackoff.def, P.juggernautRealization.def, P.w531Jokers.def]) errs.push(...checkScheme(s, reg).map((e) => `${s.ref.id}: ${e.code}`))
  for (const m of reg.macros.values()) errs.push(...checkMacro(m, reg).map((e) => `${m.ref.id}: ${e.code}`))
  eq(errs, [], 'clean')
  eq([...reg.fns.values()].reduce((a, f) => a + f.examples.length, 0), 14, 'fn examples')
  eq([...reg.schemes.values()].reduce((a, s) => a + s.examples.length, 0), 1, 'scheme examples')
})
t('EC-91', 'exampleFailed fires: a deload example promising 3 sets where 4 × 50% gives 2 is refused at publication', () => {
  const bad = clone(P.deloadStd.def) as FnDef
  const gives = bad.examples[0]!.gives as Extract<Term, { k: 'session' }>
  ;(gives.steps[0] as Extract<Term, { k: 'session' }>['steps'][number] & { count: { k: 'n'; n: Term } }).count = { k: 'n', n: T(sets(3)) }
  const errs = checkFn(bad, reg)
  eq(codesOf(errs), ['exampleFailed'], 'refused')
})
t('EC-91', 'exampleFailed fires for a scheme: linear-gated promising 110 kg after three hits (it reaches 107.5) is refused', () => {
  const bad = clone(P.linearGated.def) as SchemeDef
  bad.examples[0]!.expect['load'] = T(kg(110))
  const errs = checkScheme(bad, reg)
  assert(codesOf(errs).includes('exampleFailed') && errs[0]!.message.includes('107.5 kg'), errs.map((e) => e.message).join('; '))
})

// ── 2. the capability matrix ────────────────────────────────────────────────

/** tsc-time drift test (EC-92): each GRANTS row IS the algebra's union. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Row<P extends keyof typeof GRANTS> = (typeof GRANTS)[P][number]
export const GRANTS_MATCH_ALGEBRA: [
  Same<Row<'fnBody'>, FnCap>, Same<Row<'init'>, InitCap>, Same<Row<'plan'>, PlanCap>, Same<Row<'live'>, LiveCap>, Same<Row<'handler'>, HandlerCap>,
  Same<Row<'aggregate'>, AggregateCap>, Same<Row<'bind'>, BindCap>, Same<Row<'handoff'>, HandoffCap>, Same<Row<'policy'>, PolicyCap>, Same<Row<'cadence'>, CadenceCap>, Same<Row<'example'>, never>,
] = [true, true, true, true, true, true, true, true, true, true, true]

const ONE: Ty = { t: 'q', dim: {} }
const READ: Record<Exclude<Cap, 'elem'>, Term> = {
  param: { k: 'param', name: 'p' },
  state: { k: 'self', field: 'f' },
  peer: { k: 'peer', slot: 's', field: 'f', of: 'current' },
  program: { k: 'program', field: 'pf' },
  fact: { k: 'fact', fact: 'readiness', key: null },
  pos: { k: 'pos', field: 'week' },
  cal: { k: 'cal', q: { q: 'day' } },
  performed: { k: 'performed', step: 'a' as never, metric: 'reps', pick: 'count' },
  event: { k: 'event', q: { q: 'week' } },
  agg: { k: 'agg', q: { q: 'weekly', metric: 'sets', by: { k: 'tag', tag: 'x' } } },
}
const POSITIONS: Position[] = ['fnBody', 'init', 'plan', 'live', 'handler', 'aggregate', 'bind', 'handoff', 'policy', 'cadence', 'example']
/** The SPEC, stated independently of GRANTS: the test plan's matrix (its
 *  `input` row is `fact`), with v3's changes: handoffs read facts and the
 *  calendar, and the cal capability and the policy and cadence positions. */
const SPEC: Record<Exclude<Cap, 'elem'>, string> = {
  //         fB in pl li ha ag bi ho po ca ex
  param: '   G  G  G  G  G  G  G  x  G  G  x',
  state: '   x  x  G  G  G  G  x  x  G  G  x',
  peer: '    x  x  G  G  G  x  G  G  x  G  x',
  program: ' x  x  G  G  G  x  x  x  x  x  x',
  fact: '    x  G  G  G  G  G  x  G  G  x  x',
  pos: '     x  x  G  G  G  G  x  x  G  x  x',
  cal: '     x  x  G  G  G  G  x  G  G  x  x',
  performed: 'x x  x  G  x  x  x  x  x  x  x',
  event: '   x  x  x  x  G  G  x  x  x  x  x',
  agg: '     x  x  x  x  x  G  x  x  x  x  x',
}
const specGrants = (cap: Exclude<Cap, 'elem'>, position: Position) => SPEC[cap].trim().split(/\s+/)[POSITIONS.indexOf(position)] === 'G'
const fullScope = (position: Position): Scope => ({
  ...baseScope(reg, position, { p: ONE }, { id: 'demo/matrix', seq: reg.seq.size }),
  state: { f: { ty: ONE, init: L(0), writableBy: [], noun: 'f' } },
  facts: ['readiness'],
  peers: () => ONE,
  programFields: { pf: ONE },
  steps: { earlier: ['a'], all: ['a'], own: null },
})
t('EC-92 EC-93 EC-94 EC-81 EC-89 EC-90 EC-111 EC-125', 'the capability matrix, all 121 cells: every granted read is accepted, every other one is refused with capabilityEscape (an escaped binder variable with unknownName)', () => {
  const wrong: string[] = []
  let refused = 0
  for (const position of POSITIONS) {
    for (const [cap, term] of Object.entries(READ) as [Exclude<Cap, 'elem'>, Term][]) {
      const out: TypeError[] = []
      top(term, fullScope(position), [], null, out)
      const escaped = out.some((e) => e.code === 'capabilityEscape' && e.cap === cap)
      const granted = specGrants(cap, position)
      if (granted === escaped || (granted && out.length)) wrong.push(`${position}·${cap}: ${out.map((e) => e.code).join(',') || 'accepted'}`)
      if (!granted) refused++
    }
    const out: TypeError[] = []
    top({ k: 'var', name: 'escaped' as never }, fullScope(position), [], null, out)
    if (!out.some((e) => e.code === 'unknownName')) wrong.push(`${position}·elem accepted`)
    refused++
  }
  eq(wrong, [], 'every cell')
  assert(refused >= 58, `${refused} denied cells (the test plan counted 58 of its 90)`)
})

// ── 3. the checker suite: one IR negative per refusal class ─────────────────

const sc = (position: Position, over: Partial<Scope> = {}): Scope => ({ ...fullScope(position), ...over })
const refuses = (code: TypeError['code'], term: Term, s: Scope, want: Ty | null = null) => {
  const out: TypeError[] = []
  top(term, s, [], want, out)
  assert(codesOf(out).includes(code), `expected ${code}, got ${codesOf(out).join(',') || 'nothing'}`)
}
const accepts = (term: Term, s: Scope, want: Ty | null = null) => {
  const out: TypeError[] = []
  top(term, s, [], want, out)
  eq(codesOf(out), [], 'accepted')
}
const q = (v: number, unit: string, per?: string): Term => ({ k: 'lit', lit: { k: 'q', v, unit: unit as never, ...(per ? { per: per as never } : {}) } })
const ord = (scale: string, level: number): Term => ({ k: 'lit', lit: { k: 'ord', scale: scale as never, level } })
const ar = (op: '+' | '-' | '*' | 'min' | 'max', a: Term, b: Term): Term => ({ k: 'arith', op, a, b })
const B = (v: boolean): Term => ({ k: 'lit', lit: { k: 'bool', v } })
const NONE: Term = { k: 'none', of: { t: 'q', dim: { mass: 1 } } }
const MASS: Ty = { t: 'q', dim: { mass: 1 } }
const plan = sc('plan')
const lib = (pos: Position, params: Record<string, Ty> = {}) => sc(pos, { def: { id: 'lib/x', seq: reg.seq.size }, params })

t('EC-02 EC-04 EC-07 EC-08 EC-09 EC-11 EC-13 EC-15 EC-16 EC-18', 'sorts in the IR: kg + reps; kg × kg used as a mass; ordinals that add; absent operands; reps + RIR; asReps of a non-effort; ordinal vs quantity; enum <; logic on a number; a step of another dimension', () => {
  refuses('unitMismatch', ar('+', q(5, 'kg'), q(3, 'rep')), plan)
  refuses('unitMismatch', ar('*', q(5, 'kg'), q(3, 'kg')), plan, MASS)
  refuses('notComparable', ar('+', ord('soreness', 1), ord('soreness', 2)), plan)
  refuses('absenceUnhandled', ar('*', NONE, q(0.9, 'x')), plan)
  refuses('unitMismatch', ar('+', q(5, 'rep'), q(2, 'rir')), plan)
  refuses('unitMismatch', { k: 'asReps', a: q(5, 'kg') }, lib('fnBody'))
  refuses('notComparable', { k: 'cmp', op: '<', a: q(5, 'x'), b: ord('pain', 2) }, plan)
  refuses('notComparable', { k: 'cmp', op: '<', a: T({ term: { k: 'lit', lit: { k: 'enum', name: 'weekRole', tag: 'train' } } }), b: { k: 'lit', lit: { k: 'enum', name: 'weekRole', tag: 'deload' } } }, plan)
  refuses('unitMismatch', { k: 'logic', op: 'and', a: q(1, 'x'), b: B(true) }, plan)
  refuses('unitMismatch', { k: 'round', mode: 'nearest', a: q(100, 'kg'), step: q(1, 'rep') }, plan)
})
t('EC-23 EC-24 EC-28 EC-33 EC-36 EC-37 EC-39 EC-40 EC-41', 'absence and control: knownThen with a plain body; known of a plain value; orElse of a plain value; an unlabeled let; a non-bool condition; branches of two sorts; a match missing, adding, or not on an enum', () => {
  refuses('unitMismatch', { k: 'known', a: NONE, as: 'x' as never, body: q(1, 'kg'), then: true }, plan)
  refuses('unitMismatch', { k: 'known', a: q(1, 'kg'), as: 'x' as never, body: q(1, 'kg'), then: false }, plan)
  refuses('unitMismatch', { k: 'orElse', a: q(1, 'kg'), b: q(1, 'kg') }, plan)
  refuses('unlabeledLet', { k: 'let', name: 'x' as never, label: '', value: q(1, 'kg'), body: q(1, 'kg') }, plan)
  refuses('unitMismatch', { k: 'if', c: q(1, 'x'), a: q(1, 'kg'), b: q(2, 'kg') }, plan)
  refuses('unitMismatch', { k: 'if', c: B(true), a: q(1, 'kg'), b: q(2, 'rep') }, plan)
  const role: Term = { k: 'pos', field: 'role' }
  const cases = Object.fromEntries(enumsWith().weekRole!.map((r) => [r, q(1, 'x')]))
  const { deload: _d, ...missing } = cases
  refuses('nonExhaustive', { k: 'match', on: role, cases: missing }, plan)
  refuses('unknownName', { k: 'match', on: role, cases: { ...cases, bogus: q(1, 'x') } }, plan)
  refuses('notComparable', { k: 'match', on: q(1, 'x'), cases: {} }, plan)
})
const anyList: Term = { k: 'keys', of: 'slots' }
const list3 = T(list1(ty.q('one'), num(1), num(2), num(3)))
t('EC-42 EC-43 EC-44 EC-47 EC-48 EC-50 EC-52 EC-58 EC-62 EC-72', 'collections: nth on a possibly-empty list or by a mass; a fold carrying an outcome or changing sort; tabulate over booleans; at by the wrong ref kind; pick by a yes/no; an escaped variable; allocate of the wrong sorts', () => {
  refuses('unitMismatch', { k: 'nth', xs: anyList, i: q(0, 'x'), overflow: 'hold' }, plan)
  refuses('unitMismatch', { k: 'nth', xs: { k: 'list', items: [], of: ONE }, i: q(0, 'x'), overflow: 'hold' }, plan)
  refuses('unitMismatch', { k: 'nth', xs: list3, i: q(0, 'kg'), overflow: 'hold' }, plan)
  accepts({ k: 'nth', xs: list3, i: q(0, 'wk'), overflow: 'hold' }, plan)
  const handler = sc('handler', { writer: 'session', state: { f: { ty: ONE, init: L(0), writableBy: ['session'], noun: 'f' } } })
  refuses('nonGroundAccumulator', { k: 'fold', xs: list3, init: { k: 'patch', set: {} }, acc: 'a' as never, x: 'x' as never, step: { k: 'var', name: 'a' as never } }, handler)
  refuses('unitMismatch', { k: 'fold', xs: list3, init: q(0, 'kg'), acc: 'a' as never, x: 'x' as never, step: q(1, 'rep') }, plan)
  refuses('unitMismatch', { k: 'tabulate', keys: { k: 'list', items: [B(true)], of: { t: 'bool' } }, as: 'k' as never, body: q(1, 'x') }, plan)
  refuses('unitMismatch', { k: 'at', m: { k: 'tabulate', keys: anyList, as: 'k' as never, body: q(1, 'x') }, key: { k: 'lit', lit: { k: 'ref', kind: 'muscle', id: 'chest' } } }, plan)
  refuses('notComparable', { k: 'pick', mode: 'max', xs: list3, as: 'x' as never, where: null, score: B(true) }, plan)
  refuses('unknownName', { k: 'var', name: 'escaped' as never }, plan)
  refuses('unitMismatch', { k: 'allocate', n: q(2, 'kg'), into: { k: 'tabulate', keys: anyList, as: 'k' as never, body: q(0, 'set') }, among: anyList, as: 's' as never, score: q(1, 'x'), cap: q(4, 'set'), max: 8 }, sc('aggregate'))
})
t('EC-76 EC-79 EC-80 EC-82 BV-07 BV-10 BV-23 BV-40 BV-43 BV-47', 'tables and literal domains: a yes/no key; an ordinal row past the scale; no rows; rows of two sorts; allocate max 0 or 2.5; a literal rounding step of 0; a literal list position of −1 or 1.5; an until max of 0; a session with no steps', () => {
  refuses('tableShape', { k: 'table', key: B(true), rows: [{ when: 'x', then: q(1, 'x') }], otherwise: q(0, 'x'), overflow: null }, plan)
  const soreRows = [0, 1, 2, 3].map((l) => ({ when: l, then: q(l, 'x') }))
  refuses('unknownName', { k: 'table', key: ord('soreness', 1), rows: [...soreRows, { when: 4, then: q(4, 'x') }], otherwise: null, overflow: null }, plan)
  refuses('tableShape', { k: 'table', key: { k: 'pos', field: 'week' }, rows: [], otherwise: null, overflow: 'hold' }, plan)
  refuses('unitMismatch', { k: 'table', key: { k: 'pos', field: 'week' }, rows: [{ when: null, then: q(1, 'kg') }, { when: null, then: q(1, 'rep') }], otherwise: null, overflow: 'hold' }, plan)
  const alloc = (max: number): Term => ({ k: 'allocate', n: q(2, 'set'), into: { k: 'tabulate', keys: anyList, as: 'k' as never, body: q(0, 'set') }, among: anyList, as: 's' as never, score: q(1, 'x'), cap: q(4, 'set'), max })
  refuses('boundNotLiteral', alloc(0), sc('aggregate'))
  refuses('boundNotLiteral', alloc(2.5), sc('aggregate'))
  refuses('literalDomain', { k: 'round', mode: 'nearest', a: q(100, 'kg'), step: q(0, 'kg') }, plan)
  refuses('literalDomain', { k: 'nth', xs: list3, i: q(-1, 'x'), overflow: 'hold' }, plan)
  refuses('literalDomain', { k: 'nth', xs: list3, i: q(1.5, 'x'), overflow: 'hold' }, plan)
  const sess = (steps: unknown[]): Term => ({ k: 'session', exercise: { k: 'lit', lit: { k: 'ref', kind: 'exercise', id: 'wger:192' } }, steps: steps as never, intensifier: null })
  const tgt: Term = { k: 'set', role: 'working', target: { reps: { b: 'exact', v: q(5, 'rep') } }, rest: null, tempo: null, cluster: null }
  refuses('boundNotLiteral', sess([{ k: 'step', id: 'u', count: { k: 'until', stop: B(true), max: 0 }, target: tgt }]), plan)
  refuses('literalDomain', sess([]), plan)
})
const mkStep = (id: string, target: Term, count: unknown = { k: 'n', n: q(1, 'set') }) => ({ k: 'step', id, count, target })
const setOf = (target: Record<string, unknown>, extra: Record<string, unknown> = {}): Term => ({ k: 'set', role: 'working', target: target as never, rest: null, tempo: null, cluster: null, ...extra })
const benchSess = (steps: unknown[]): Term => ({ k: 'session', exercise: { k: 'lit', lit: { k: 'ref', kind: 'exercise', id: 'wger:192' } }, steps: steps as never, intensifier: null })
t('EC-30 EC-102 EC-104 EC-105 EC-108 EC-109 EC-110 EC-113 EC-116 EC-154', 'domain formers: a reps target in sets; an effort target in reps; a rest that is not a time; a target reading a later step, its own step or no step; an until bound that is a term; a transformer with a wrong or missing argument', () => {
  refuses('unitMismatch', benchSess([mkStep('a', setOf({ reps: { b: 'exact', v: q(5, 'set') } }))]), plan)
  refuses('absenceUnhandled', benchSess([mkStep('a', setOf({ reps: { b: 'exact', v: q(5, 'rep') } }), { k: 'n', n: { k: 'none', of: { t: 'q', dim: { set: 1 } } } })]), plan)
  refuses('unknownName', { k: 'event', q: { q: 'metric', step: 'zz' as never, metric: 'reps', pick: 'last' } }, sc('handler', { steps: { earlier: [], all: ['a'], own: null } }))
  refuses('unitMismatch', benchSess([mkStep('a', setOf({ effort: { b: 'exact', v: q(2, 'rep') } }))]), plan)
  refuses('unitMismatch', benchSess([mkStep('a', setOf({ reps: { b: 'exact', v: q(5, 'rep') } }, { rest: q(2, 'kg') }))]), plan)
  const read = (step: string): Term => ({ k: 'orElse', a: { k: 'performed', step: step as never, metric: 'load', pick: 'last' }, b: q(50, 'kg') })
  refuses('forwardStepRef', benchSess([mkStep('a', setOf({ load: { b: 'exact', v: read('b') } })), mkStep('b', setOf({ reps: { b: 'exact', v: q(5, 'rep') } }))]), plan)
  refuses('forwardStepRef', benchSess([mkStep('a', setOf({ load: { b: 'exact', v: read('a') } }))]), plan)
  refuses('unknownName', benchSess([mkStep('a', setOf({ load: { b: 'exact', v: read('zz') } }))]), plan)
  refuses('boundNotLiteral', benchSess([mkStep('a', setOf({ reps: { b: 'exact', v: q(1, 'rep') } }), { k: 'until', stop: B(true), max: q(3, 'x') })]), plan)
  const s = benchSess([mkStep('a', setOf({ reps: { b: 'exact', v: q(5, 'rep') } }))])
  refuses('unitMismatch', { k: 'xform', op: 'scaleSets', s, arg: q(2, 'kg'), metric: null }, plan)
  refuses('missingArg', { k: 'xform', op: 'capEffort', s, arg: null, metric: null }, plan)
})
t('EC-84 EC-85 EC-86 EC-87 EC-88 EC-95 EC-98 EC-99 EC-100 EC-128 EC-133', 'reuse, facts and outcomes: a call missing, adding or mistyping an argument; an unpublished or later definition; an outcome outside a handler; a keyed fact with no key; an undeclared fact; a key on an unkeyed fact; a patch on a field this scope does not own or no event may write', () => {
  const app = (args: Record<string, Term>, id = 'lib/juggernaut-bump'): Term => ({ k: 'app', def: { id: id as never, version: 1 }, args })
  const ok = { amrap: q(13, 'rep'), standard: q(10, 'rep'), perRep: q(2.5, 'kg', 'rep') }
  accepts(app(ok), plan)
  refuses('missingArg', app({ amrap: ok.amrap, standard: ok.standard }), plan)
  refuses('unknownName', app({ ...ok, extra: q(1, 'x') }), plan)
  refuses('unitMismatch', app({ ...ok, amrap: q(13, 'kg') }), plan)
  refuses('futureRef', app(ok, 'lib/nowhere'), plan)
  refuses('futureRef', app(ok), sc('plan', { def: { id: 'demo/early', seq: 0 } }))
  refuses('capabilityEscape', { k: 'patch', set: {} }, plan)
  refuses('missingArg', { k: 'fact', fact: 'e1rm', key: null }, sc('plan', { facts: ['e1rm'] }))
  refuses('undeclaredFact', { k: 'fact', fact: 'bodyweight', key: null }, plan)
  refuses('unitMismatch', { k: 'fact', fact: 'readiness', key: { k: 'lit', lit: { k: 'ref', kind: 'muscle', id: 'chest' } } }, plan)
  const handler = sc('handler', { writer: 'session', state: { f: { ty: ONE, init: L(0), writableBy: [], noun: 'f' } } })
  refuses('notOwner', { k: 'patch', set: { g: { to: q(1, 'x'), mode: 'commit' } } }, handler)
  refuses('notWritableHere', { k: 'patch', set: { f: { to: q(1, 'x'), mode: 'commit' } } }, handler)
})
t('EC-200 EC-201', 'templates: a library fn template with a hole no param fills is refused; a library scheme template that omits a param is refused (5/3/1’s once omitted tmPct)', () => {
  const f = clone(P.juggernautBump.def) as FnDef
  f.says = `${f.says} and {bogus}`
  eq(codesOf(checkFn(f, reg)), ['templateHoles'], 'extra hole')
  const s = clone(P.w531.def) as SchemeDef
  s.says = s.says.replace('{tmPct}', 'a fixed share')
  assert(codesOf(checkScheme(s, reg)).includes('templateHoles'), 'missing hole')
})
const prog = (f: (p: ProgramDef) => void, base: ProgramDef = P.fiveThreeOneBBB.def) => {
  const p = clone(base)
  f(p)
  return codesOf(checkProgram(p, reg).flatMap((r) => r.errors))
}
t('EC-213 EC-214 EC-215 EC-216 EC-217 EC-219 EC-222 EC-224', 'program structure: a binding missing or adding an argument; a peer of the wrong sort or that does not exist; an undeclared muscle; a day naming no slot; a role policy whose definition is not session→session; a slot reading a program field with no aggregate', () => {
  assert(prog((p) => void delete p.slots['press']!.args['inc']).includes('missingArg'), 'missing')
  assert(prog((p) => void (p.slots['press']!.args['bogus'] = T(num(1)))).includes('unknownName'), 'extra arg (EC-214)')
  assert(prog((p) => void (p.slots['pressBbb']!.args['tm'] = { k: 'peer', slot: 'press', field: 'missed', of: 'current' })).includes('unitMismatch'), 'peer sort')
  assert(prog((p) => void (p.slots['pressBbb']!.args['tm'] = { k: 'peer', slot: 'nope', field: 'tm', of: 'current' })).includes('unknownName'), 'no peer')
  assert(prog((p) => void (p.slots['press']!.meta.muscles = { neck: 1 })).includes('unknownName'), 'muscle')
  assert(prog((p) => void (p.days['press'] = [{ k: 'single', slot: 'ghost' }])).includes('unknownName'), 'day')
  assert(prog((p) => void (p.policies = [{ when: B(true), plan: { def: P.loadFor.def.ref, hole: 'e1rm', args: { reps: T(reps(5)), rir: T(rir(1)) } }, outcome: null, origin: 'declared' }])).includes('unitMismatch'), 'not session→session')
  const noAgg = clone(P.rpMeso.def)
  noAgg.aggregate = null
  noAgg.policies = noAgg.policies.filter((x) => x.origin !== 'allocation')
  assert(codesOf(checkProgram(noAgg, reg).flatMap((r) => r.errors)).includes('unknownName'), 'program field with no aggregate')
})
const macro = (f: (m: MacroDef) => void) => {
  const m = clone(P.optMacro)
  f(m)
  return codesOf(checkMacro(m, reg))
}
t('EC-78 EC-231', 'the IR halves of two TS negatives: an ordinal table missing a level; a peakOn macro with a bounded phase', () => {
  const soreRows = [0, 1, 2].map((l) => ({ when: l, then: q(l, 'x') }))
  refuses('nonExhaustive', { k: 'table', key: ord('soreness', 1), rows: soreRows, otherwise: null, overflow: null }, plan)
  const m = clone(P.optMacro)
  const peak: MacroDef = { ...m, anchor: { k: 'peakOn', date: m.anchor.date }, drift: 'anchored' }
  assert(codesOf(checkMacro(peak, reg)).includes('peakNeedsFixed'), 'peakNeedsFixed')
})
t('EC-96 EC-97 EC-235 EC-236 EC-237', 'macro handoffs: an argument reading the CURRENT phase, a gate reading the PREVIOUS one, a slot the previous phase lacks, a missing param, a mistyped transform argument', () => {
  assert(macro((m) => void (m.phases[1]!.args['rung'] = { k: 'peer', slot: 'pushStab', field: 'rung', of: 'current' })).includes('unknownName'), 'EC-96')
  assert(macro((m) => void ((m.phases[0]!.length as { advanceWhen: Term }).advanceWhen = { k: 'cmp', op: '>=', a: { k: 'peer', slot: 'pushStab', field: 'rung', of: 'prevPhase' }, b: T(num(2)) })).includes('unknownName'), 'EC-97')
  assert(macro((m) => void (m.phases[2]!.args['benchStart'] = { k: 'peer', slot: 'ghost', field: 'load', of: 'prevPhase' })).includes('unknownName'), 'EC-235')
  assert(macro((m) => void delete m.phases[1]!.args['rung']).includes('missingArg'), 'EC-236')
  assert(macro((m) => void (m.phases[1]!.transform!.args['t'] = T(kg(1)))).includes('unitMismatch'), 'EC-237')
})
t('BV-01 BV-02 BV-03 BV-04 BV-05 BV-06', 'the budget lint: 3 and 4 operators pass; 5 is refused; naming does not launder a 5 inside the name; an unlabeled let is no boundary (refused outright)', () => {
  const chain = (k: number): Term => (k === 0 ? q(1, 'kg') : ar('+', chain(k - 1), q(1, 'kg')))
  accepts(chain(3), plan)
  accepts(chain(4), plan)
  refuses('overBudget', chain(5), plan)
  refuses('overBudget', { k: 'named', noun: 'n', e: chain(5) }, plan)
  refuses('unlabeledLet', { k: 'let', name: 'x' as never, label: '', value: chain(5), body: q(1, 'kg') }, plan)
  accepts(benchSess([mkStep('a', setOf({ reps: { b: 'exact', v: ar('+', ar('+', q(1, 'rep'), q(1, 'rep')), ar('+', q(1, 'rep'), q(1, 'rep'))) }, load: { b: 'exact', v: chain(4) } }))]), plan)
})

// ── 4. the deferred Consider items, decided with the evaluator as evidence ──

t('R2-consider', 'allocate-as-fold is NOT expressible in the frozen grammar: the prototype (fold over range(max) picking a slot and bumping its entry) is refused, because refs do not compare and maps have no update', () => {
  const v = (n: string): Term => ({ k: 'var', name: n as never })
  const zero = q(0, 'set')
  const at = (m: Term, k: Term): Term => ({ k: 'orElse', a: { k: 'at', m, key: k }, b: zero })
  const among: Term = { k: 'agg', q: { q: 'slotsFor', muscle: { k: 'lit', lit: { k: 'ref', kind: 'muscle', id: 'chest' } } } }
  const into: Term = { k: 'self', field: 'extra' }
  const given = (acc: Term, s: string): Term => ar('-', at(acc, v(s)), at(into, v(s)))
  const step: Term = {
    k: 'if',
    c: { k: 'cmp', op: '<', a: { k: 'sum', xs: among, as: 's1' as never, body: given(v('acc'), 's1') }, b: q(4, 'set') },
    a: {
      k: 'orElse',
      a: {
        k: 'known',
        a: { k: 'pick', mode: 'max', xs: among, as: 's2' as never, where: { k: 'cmp', op: '<', a: given(v('acc'), 's2'), b: q(4, 'set') }, score: q(1, 'x') },
        as: 'p' as never,
        then: false,
        body: { k: 'tabulate', keys: { k: 'keys', of: 'slots' }, as: 'k' as never, body: { k: 'if', c: { k: 'cmp', op: '==', a: v('k'), b: v('p') }, a: ar('+', at(v('acc'), v('k')), q(1, 'set')), b: at(v('acc'), v('k')) } },
      },
      b: v('acc'),
    },
    b: v('acc'),
  }
  const fold: Term = { k: 'fold', xs: { k: 'range', n: 8 }, init: into, acc: 'acc' as never, x: 'i' as never, step }
  const agg = sc('aggregate', { state: { extra: { ty: { t: 'map', key: 'slot', of: { t: 'q', dim: { set: 1 } } }, init: L(0), writableBy: ['weekEnd'], noun: 'extra sets' } }, program: { slots: ['flatDb'], days: [], muscles: ['chest'], tags: [], roles: null } })
  const out: TypeError[] = []
  top(fold, agg, [], null, out)
  eq(out.map((e) => `${e.code}: ${e.message}`), ['notComparable: cannot compare slot == slot'], 'the only refusal is the ref comparison')
})

void lb
void mul
void pct
void keyOf
void publish
void ER
done()
