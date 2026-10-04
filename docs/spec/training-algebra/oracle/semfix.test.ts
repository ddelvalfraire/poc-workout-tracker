/**
 * semfix.test.ts — the semantics review round: every probe of the three
 * adversarial readers (scratchpad/semrev-a, semrev-b, semrev-c) as a named
 * regression test. Modules are imported as namespaces, so a test that needs a
 * function the frozen oracle lacks fails alone instead of failing the file;
 * the fail-first run against synthesis-ratified is ../semfix-prefix.txt.
 * Run: tsx semfix.test.ts
 */
import * as A from './algebra'
import type { FnDef, Term, Ty } from './algebra'
import * as CD from './checkdefs'
import * as CK from './checker'
import * as DR from './describe-run'
import type { Field, IssuedSession, IssuedSlot, Logged, PerformedSet, Resolution, TypeError, Value } from './engine'
import * as EV from './evaluate'
import * as IS from './issue'
import * as JU from './judge'
import * as P from './programs'
import * as PJ from './project'
import * as PO from './ports'
import * as ST from './step'
import type { ProgramDef, SchemeDef } from './structure'
import * as TI from './time'
import * as TK from './testkit'
import * as UN from './units'
import * as XF from './xform'

const { t, done } = TK.suite('semfix')
const assert: (ok: unknown, msg: string) => asserts ok = TK.assert
const { eq, near, reg, D0 } = TK
const F = TK.corpusFacts()
const T = (e: { term: Term }) => e.term
const clone = <X>(x: X): X => structuredClone(x)
const lit = (v: number, unit: string): Term => ({ k: 'lit', lit: { k: 'q', v, unit: unit as never } })
const ref = (kind: 'slot' | 'muscle' | 'exercise', id: string): Term => ({ k: 'lit', lit: { k: 'ref', kind, id } })
const vr = (name: string): Term => ({ k: 'var', name: name as never })
const LB = (n: number) => TK.num(TK.q(n, 'lb'))
const set = (values: Record<string, number>): PerformedSet => ({ values, stages: null }) as PerformedSet
const d = (n: number) => TI.addDays(D0, n)
const codes = (es: readonly TypeError[]) => es.map((e) => `${e.code}@${e.path.join('.')}`)
const fixedN = (f: Field | undefined): number | string => (f?.k === 'fixed' && f.v.b === 'exact' ? f.v.v : f ? f.k : 'none')
const rowsOf = (rows: readonly Resolution[]) => [...rows]
/** A full issued session around hand-built slots (the kit validates every argument). */
let stamp: IssuedSession['stamp'] | null = null
const issuedOf = (slots: unknown[]): IssuedSession => {
  stamp ??= { ...TK.issue(TK.start(P.linear3x5.def, {}, F), D0, F).issued.stamp, grids: {}, display: {} }
  return { issueKey: 'k', day: 'A', defaultDay: 'A', slots: slots as IssuedSlot[], stamp, due: { k: 'due' } }
}

// ── shared setups ────────────────────────────────────────────────────────────

/** APRE top set + back-offs on a 5 lb grid, as the readers ran it. */
function apre(s: SchemeDef = P.apreTopBackoff.def, r = reg) {
  const def = PJ.exampleProgram(s, { lift: T(A.exercise('wger:192')), small: T(A.lb(5)), big: T(A.lb(10)), backoffs: T(A.sets(2)), keep: T(A.pct(90)) })
  const run = TK.start({ ...def, grids: { load: T(A.lb(5)) } }, {}, F, 'apre', D0, r)
  return TK.issue(run, D0, F)
}
const withScheme = (s: SchemeDef) => ({ ...reg, schemes: new Map([...reg.schemes, [CK.keyOf(s.ref), s]]) })
/** semrev-a/chk.ts: APRE plus a finisher whose load is the given term. */
function finisher(load: Term): SchemeDef {
  const base = P.apreTopBackoff.def as SchemeDef
  const fin = { k: 'step', id: 'finisher', count: { k: 'n', n: lit(1, 'set') }, target: { k: 'set', role: 'backoff', target: { reps: { b: 'exact', v: lit(10, 'rep') }, load: { b: 'exact', v: load } }, rest: null, tempo: null, cluster: null } }
  const plan = base.plan as Extract<Term, { k: 'session' }>
  return { ...base, ref: { ...base.ref, version: 99 }, plan: { ...plan, steps: [...plan.steps, fin] } as never }
}
const topLogged = (reps: number, extra: Record<string, PerformedSet[]> = {}): Logged => ({ x: { top: [set({ reps, load: LB(185) })], ...extra } })
const viewLoad = (issued: IssuedSession, rows: readonly Resolution[], step: number) => {
  const f = IS.currentView(issued, rows)[0]!.steps[step]!.sets[0]!.metrics['load']!
  return f.k === 'fixed' && f.v.b === 'exact' ? Number((f.v.v / LB(1)).toFixed(2)) : `${f.k} ${JSON.stringify((f as { cause?: unknown }).cause ?? '')}`
}

// ── H1: the harness accumulates resolutions ─────────────────────────────────

t('', 'H1: the harness accumulates resolutions across live logging (testkit.liveLog), and closeOf carries them', () => {
  const x = apre()
  const live = (TK as unknown as { liveLog: (i: IssuedSession) => { log: (l: Logged) => Resolution[]; rows: () => Resolution[] } }).liveLog(x.issued)
  const first = live.log(topLogged(9))
  assert(first.length > 0, 'the first log resolves the back-offs')
  eq(live.log(topLogged(9)).length, 0, 'the same log again adds nothing')
  eq(live.log(topLogged(3)).length > 0, true, 'an edit supersedes')
  eq(live.rows().length, first.length * 2, 'every row is kept')
  const ev = TK.closeOf(x.issued, topLogged(3), D0, [], 'wH1', live.rows() as never) as Extract<import('./engine').Event, { k: 'sessionClosed' }>
  eq(ev.facts.resolutions.length, live.rows().length, 'the close carries the accumulated rows')
})

// ── F1: nth over an empty list is typed absence ─────────────────────────────

t('', 'F1 (semrev-b p2, semrev-c p1): nth over an empty list is none(emptyPick), never an undefined value; so is a positional table with no rows', () => {
  const cx = EV.ctxOf(reg)
  for (const overflow of ['hold', 'cycle'] as const) {
    const v = EV.evaluate({ k: 'nth', xs: { k: 'list', items: [], of: { t: 'q', dim: {} } }, i: lit(0, 'x'), overflow }, cx).value
    eq(v, { v: 'none', cause: { k: 'emptyPick' } }, `nth ${overflow} over []`)
  }
  const tb = EV.evaluate({ k: 'table', key: { k: 'pos', field: 'week' }, rows: [], otherwise: null, overflow: 'hold' }, EV.ctxOf(reg, { ports: { pos: () => EV.qv(0, { week: 1 }, 'wk', { clock: 'progress' }) } })).value
  eq(tb, { v: 'none', cause: { k: 'emptyPick' } }, 'positional table with no rows')
})

t('', 'F1 adjudication (reachability): slotsFor is possibly-empty, so nth over it is refused; an EMPTY declared enum was the reachable hole and is now refused (literalDomain)', () => {
  const sc: CK.Scope = { ...CK.baseScope(reg, 'aggregate', {}, { id: 'demo/semfix', seq: reg.seq.size }), program: { slots: ['a'], days: ['A'], muscles: ['chest', 'calves'], tags: [] } }
  const out: TypeError[] = []
  CK.top({ k: 'nth', xs: { k: 'agg', q: { q: 'slotsFor', muscle: ref('muscle', 'calves') } }, i: lit(0, 'x'), overflow: 'hold' }, sc, [], null, out)
  eq(codes(out), ['unitMismatch@'], 'nth over slotsFor of a primary-less muscle is refused (needs a non-empty list)')
  const nthE: Term = { k: 'nth', xs: { k: 'keys', of: 'enum:e' }, i: lit(0, 'x'), overflow: 'hold' }
  const f: FnDef = { kind: 'fn', ref: { id: 'user/empty-enum' as never, version: 1 }, params: {}, result: { t: 'q', dim: {} }, says: '', enums: { e: [] }, examples: [{ args: {}, gives: lit(1, 'x') }], body: { k: 'if', c: { k: 'cmp', op: '==', a: nthE, b: nthE }, a: lit(1, 'x'), b: lit(2, 'x') } } as never
  eq(codes(CD.checkFn(f, reg)), ['literalDomain@enums.e'], 'an enum with no tags is refused at its declaration')
})

t('', 'F1: the activation boundary refuses an empty list for a non-empty (list1) program parameter', () => {
  const def = { ...clone(P.linear3x5.def), params: { ladder: { t: 'list', of: { t: 'q', dim: {} }, nonEmpty: true } as Ty } } as ProgramDef
  const rt = PO.runtimeOf(reg, def, { id: 'f1', anchor: D0, activatedOn: D0 })
  let msg = ''
  try {
    ST.activate(rt, { ladder: { v: 'list', items: [] } }, F)
  } catch (e) {
    msg = (e as Error).message
  }
  assert(/ladder/.test(msg) && /non-empty/.test(msg), `refused naming the parameter: '${msg}'`)
})

// ── F2: frames are binding-environment-correct ──────────────────────────────

t('', 'F2 (semrev-a p8): a read under a static let inside a live bound is captured, so resolution cannot crash', () => {
  const perf: Term = { k: 'performed', step: 'top' as never, metric: 'load', pick: 'last' }
  const load: Term = { k: 'let', name: 'e' as never, label: 'the lift', value: { k: 'param', name: 'lift' }, body: { k: 'known', as: 'f' as never, then: true, a: { k: 'fact', fact: 'e1rm', key: vr('e') }, body: { k: 'known', as: 'p' as never, then: false, a: perf, body: { k: 'arith', op: 'min', a: vr('p'), b: vr('f') } } } }
  const s = finisher(load)
  eq(CD.checkScheme(s, reg), [], 'checks clean')
  const x = apre(s, withScheme(s))
  let rows: Resolution[] = []
  try {
    rows = IS.resolveLive({ reg: withScheme(s) }, x.issued, topLogged(9), [])
  } catch (e) {
    throw new Error(`resolveLive threw: ${(e as Error).message}`)
  }
  eq(viewLoad(x.issued, rows, 4), 185, 'finisher = min(185 lb logged, the e1RM fact)')
})

t('', 'F2 (semrev-b p4): a fact keyed by a let variable is captured with its bound value', () => {
  const term: Term = { k: 'let', name: 'x' as never, label: 'the lift', value: ref('exercise', 'wger:111'), body: { k: 'arith', op: 'max', a: { k: 'fact', fact: 'e1rm', key: vr('x') }, b: { k: 'orElse', a: { k: 'performed', step: 'w' as never, metric: 'load', pick: 'last' }, b: lit(0, 'kg') } } }
  const cxIssue = EV.ctxOf(reg, { ports: { fact: () => EV.qv(140, { mass: 1 }, 'kg'), performed: () => [], prescribed: () => null } })
  const fd = EV.boundField({ b: 'exact', v: term }, cxIssue, []) as Extract<Field, { k: 'open' }>
  eq(fd.k, 'open', 'open')
  const cxLive = EV.ctxOf(reg, { frame: fd.frame, ports: { performed: () => [set({ load: 100, reps: 5 })], prescribed: () => null } })
  let got: Field
  try {
    got = EV.boundField(fd.bound, cxLive, [])
  } catch (e) {
    throw new Error(`resolution threw: ${(e as Error).message}`)
  }
  eq(fixedN(got), 140, 'max(fact 140 kg, logged 100 kg)')
})

t('', 'F2 (semrev-c p9): a shadowing let resolves its read with the INNER binding', () => {
  const term: Term = { k: 'arith', op: '+', a: { k: 'let', name: 'x' as never, label: 'inner', value: ref('slot', 'B'), body: { k: 'fact', fact: 'e1rm', key: vr('x') } }, b: { k: 'performed', step: 's1' as never, metric: 'load', pick: 'sum' } }
  const fact = (_f: string, k: string | null) => EV.qv(k === 'A' ? 100 : 200, {}, 'kg')
  const outer = new Map([['x', { v: 'ref', kind: 'slot', id: 'A' } as Value]])
  const fd = EV.boundField({ b: 'exact', v: term }, EV.ctxOf(reg, { vars: outer, ports: { fact, performed: () => [], prescribed: () => null } }), []) as Extract<Field, { k: 'open' }>
  const live = EV.ctxOf(reg, { frame: fd.frame, ports: { performed: () => [set({ load: 1 })] } })
  eq(TK.num(EV.evaluate(term, live).value), 201, 'e1rm(B) = 200 plus 1 logged')
})

t('', 'F2: a fact keyed by a LIVE value cannot be served at resolution, so the checker refuses it in a live bound', () => {
  const sc: CK.Scope = { ...CK.baseScope(reg, 'live', {}, { id: 'demo/semfix', seq: reg.seq.size }), facts: ['e1rm'], steps: { earlier: ['a'], all: ['a', 'b'], own: null } }
  const pick: Term = { k: 'if', c: { k: 'cmp', op: '>=', a: { k: 'orElse', a: { k: 'performed', step: 'a' as never, metric: 'reps', pick: 'last' }, b: lit(0, 'rep') }, b: lit(5, 'rep') }, a: ref('exercise', 'wger:111'), b: ref('exercise', 'wger:192') }
  const direct: Term = { k: 'orElse', a: { k: 'fact', fact: 'e1rm', key: pick }, b: lit(0, 'kg') }
  const viaLet: Term = { k: 'let', name: 'e' as never, label: 'the lift', value: pick, body: { k: 'orElse', a: { k: 'fact', fact: 'e1rm', key: vr('e') }, b: lit(0, 'kg') } }
  for (const [name, term] of [['direct', direct], ['through a let', viaLet]] as const) {
    const out: TypeError[] = []
    CK.top(term, sc, [], null, out)
    assert(out.some((e) => e.code === 'capabilityEscape'), `${name}: ${codes(out)}`)
  }
  const ok: TypeError[] = []
  CK.top({ k: 'let', name: 'e' as never, label: 'the lift', value: ref('exercise', 'wger:111'), body: { k: 'orElse', a: { k: 'fact', fact: 'e1rm', key: vr('e') }, b: lit(0, 'kg') } }, sc, [], null, ok)
  eq(codes(ok), [], 'a static key stays legal')
})

t('', 'F2: a read on a branch the asPrescribed path does not take is still captured', () => {
  const perf: Term = { k: 'orElse', a: { k: 'performed', step: 'w' as never, metric: 'reps', pick: 'last' }, b: lit(0, 'rep') }
  const term: Term = { k: 'let', name: 'e' as never, label: 'the lift', value: { k: 'param', name: 'lift' }, body: { k: 'if', c: { k: 'cmp', op: '>', a: perf, b: lit(5, 'rep') }, a: { k: 'orElse', a: { k: 'fact', fact: 'e1rm', key: vr('e') }, b: lit(0, 'kg') }, b: lit(20, 'kg') } }
  const cxIssue = EV.ctxOf(reg, { params: { lift: { v: 'ref', kind: 'exercise', id: 'wger:111' } }, ports: { fact: () => EV.qv(140, { mass: 1 }, 'kg'), performed: () => [set({ reps: 5 })], prescribed: () => null } })
  const fd = EV.boundField({ b: 'exact', v: term }, cxIssue, []) as Extract<Field, { k: 'open' }>
  eq(fixedN(fd.planned), 20, 'planned takes the else branch')
  const live = EV.ctxOf(reg, { frame: fd.frame, ports: { performed: () => [set({ reps: 8 })] } })
  eq(fixedN(EV.boundField(fd.bound, live, [])), 140, 'the live branch reads the captured fact')
})

// ── F3: revert staleness ────────────────────────────────────────────────────

t('', 'F3 (semrev-a p1, semrev-c p5): A → B → A writes a superseding row; the view follows the latest row by seq', () => {
  const x = apre()
  let rows: Resolution[] = []
  const log = (r: number) => (rows = [...rows, ...IS.resolveLive({ reg }, x.issued, topLogged(r), rows)])
  log(9)
  eq(viewLoad(x.issued, rows, 3), 170, '9 reps')
  log(3)
  eq(viewLoad(x.issued, rows, 3), 160, 'edited to 3')
  log(9)
  eq(viewLoad(x.issued, rows, 3), 170, 'edited back to 9')
  const seqs = rows.map((r) => (r as Resolution & { seq?: number }).seq)
  assert(seqs.every((s) => typeof s === 'number'), 'every row carries a seq')
  eq(new Set(seqs).size, seqs.length, 'seqs are distinct')
  eq(viewLoad(x.issued, [...rows].reverse(), 3), 170, 'the view orders by seq, never by array position')
})

// ── F4: a field reading a just-resolved field resolves in the same pass ─────

t('', 'F4 (semrev-a p2): a finisher reading the back-off’s resolved load resolves in the same ingestion', () => {
  const pres: Term = { k: 'prescribed', step: 'backoff' as never, metric: 'load', edge: 'floor' }
  for (const load of [pres, { k: 'orElse', a: pres, b: lit(0, 'kg') } as Term]) {
    const s = finisher(load)
    const r2 = withScheme(s)
    const x = apre(s, r2)
    let rows: Resolution[] = []
    const add1 = IS.resolveLive({ reg: r2 }, x.issued, topLogged(9), rows)
    rows = [...rows, ...add1]
    eq([viewLoad(x.issued, rows, 3), viewLoad(x.issued, rows, 4)], [170, 170], `${load.k}: pass 1`)
    eq(IS.resolveLive({ reg: r2 }, x.issued, topLogged(9), rows).length, 0, `${load.k}: pass 2 adds nothing`)
  }
})

// ── F5: repeat blocks resolve per iteration ─────────────────────────────────

t('', 'F5 (semrev-a p11): each round’s back-offs resolve from THAT round’s top set', () => {
  const base = P.apreTopBackoff.def as SchemeDef
  const [r1, r2s, top, bo] = (base.plan as Extract<Term, { k: 'session' }>).steps
  const s = { ...base, ref: { ...base.ref, version: 98 }, plan: { ...(base.plan as object), steps: [r1, r2s, { k: 'repeat', id: 'round', n: 2, body: [top, bo] }] } } as SchemeDef
  eq(CD.checkScheme(s, reg), [], 'checks clean')
  const rg = withScheme(s)
  const def = PJ.exampleProgram(s, { lift: T(A.exercise('wger:192')), small: T(A.lb(5)), big: T(A.lb(10)), backoffs: T(A.sets(1)), keep: T(A.pct(90)) })
  const x = TK.issue(TK.start({ ...def, grids: { load: T(A.lb(5)) } }, {}, F, 'apre', D0, rg), D0, F)
  const bo0 = x.issued.slots[0]!.steps.findIndex((st) => st.key === 'backoff@0')
  const bo1 = x.issued.slots[0]!.steps.findIndex((st) => st.key === 'backoff@1')
  let logged: Logged = { x: { 'top@0': [set({ reps: 9, load: LB(185) })] } }
  let rows = IS.resolveLive({ reg: rg }, x.issued, logged, [])
  eq(viewLoad(x.issued, rows, bo0), 170, 'after round 0: backoff@0 from top@0 (185 × 9)')
  logged = { x: { ...logged['x'], 'top@1': [set({ reps: 3, load: LB(185) })] } }
  rows = [...rows, ...IS.resolveLive({ reg: rg }, x.issued, logged, rows)]
  eq([viewLoad(x.issued, rows, bo0), viewLoad(x.issued, rows, bo1)], [170, 160], 'after round 1: backoff@0 unchanged, backoff@1 from top@1')
})

t('', 'F5 (semrev-c p10): B@0 reads A@0, B@1 reads A@1', () => {
  const ex = ref('exercise', 'wger:111')
  const setT = (target: unknown): Term => ({ k: 'set', role: 'working', target: target as never, rest: null, tempo: null, cluster: null })
  const Ast = { k: 'step', id: 'A', count: { k: 'n', n: lit(1, 'x') }, target: setT({ reps: { b: 'exact', v: lit(5, 'rep') }, load: { b: 'exact', v: lit(100, 'kg') } }) }
  const Bst = { k: 'step', id: 'B', count: { k: 'n', n: lit(1, 'x') }, target: setT({ reps: { b: 'exact', v: lit(5, 'rep') }, load: { b: 'exact', v: { k: 'orElse', a: { k: 'performed', step: 'A', metric: 'load', pick: 'last' }, b: lit(0, 'kg') } } }) }
  const tr = EV.evaluate({ k: 'session', exercise: ex, steps: [{ k: 'repeat', id: 'blk' as never, n: 2, body: [Ast, Bst] as never }], intensifier: null }, EV.ctxOf(reg))
  const s = (tr.value as Extract<Value, { v: 'session' }>).s
  const issued = issuedOf([{ slot: 's', exercise: { id: 'wger:111', label: 'Squat', logging: 'weight_reps' }, steps: s.steps, intensifier: null, trace: tr }])
  const val = (rows: readonly Resolution[], key: string) => rows.find((r) => r.step === key)?.value
  const r1 = IS.resolveLive({ reg }, issued, { s: { 'A@0': [set({ reps: 5, load: 100 })] } }, [])
  eq(fixedN(val(r1, 'B@0')), 100, 'only A@0 logged: B@0 resolves to 100')
  const r2 = IS.resolveLive({ reg }, issued, { s: { 'A@0': [set({ reps: 5, load: 100 })], 'A@1': [set({ reps: 5, load: 120 })] } }, [])
  eq([fixedN(val(r2, 'B@0')), fixedN(val(r2, 'B@1'))], [100, 120], 'B@0 100, B@1 120')
})

// ── F6: e1RM absence ────────────────────────────────────────────────────────

const slotOf = (logging: string): IssuedSlot =>
  ({ slot: 'x', exercise: { id: 'wger:111', label: 'Squat', logging }, steps: [{ id: 'top', key: 'top', count: { k: 'n', n: 2 }, sets: [], block: null, live: null }], intensifier: null, trace: null }) as never
const port = (logging: string, sets: PerformedSet[], facts: import('./engine').FactReading[] = []) =>
  JU.eventPort({ reg, slots: [slotOf(logging)], performed: { x: { top: sets } }, facts, groupScores: {}, week: 0, primary: () => undefined })

t('', 'F6 (semrev-a p4, semrev-b p3, semrev-c p15): a reps-only set on a loaded lift is skipped by e1RM; none qualifying is absent', () => {
  eq(port('weight_reps', [set({ reps: 5 })])({ q: 'e1rm', step: 'top' as never }).v, 'none', 'reps without load')
  eq(port('weight_reps', [set({ reps: 5 }), set({ reps: 5 })])({ q: 'e1rm', step: 'top' as never }).v, 'none', 'two load-less sets')
  near(TK.num(port('weight_reps', [set({ reps: 5, load: 100 }), set({ reps: 12 })])({ q: 'e1rm', step: 'top' as never })), 100 * (1 + 5 / 30), 'mixed: only the loaded set counts')
  const bw = [{ fact: 'bodyweight', key: null, value: EV.qv(80, { mass: 1 }, 'kg'), observedOn: D0 }]
  near(TK.num(port('weighted_bodyweight', [set({ reps: 6 })], bw)({ q: 'e1rm', step: 'top' as never })), 80 * (1 + 6 / 30), 'weighted bodyweight: no added load means 0 added')
})

// ── F7: assisted direction everywhere ───────────────────────────────────────

t('', 'F7 (semrev-b p6, semrev-c p4): the performed former and live resolution read the best ASSISTED load as the lowest, as the event path does', () => {
  const sets = [set({ reps: 8, load: 30 }), set({ reps: 8, load: 20 })]
  const ev = port('assisted_bodyweight', sets)({ q: 'metric', step: 'top' as never, metric: 'load', pick: 'best' })
  eq(TK.num(ev), 20, 'event path')
  const cx = EV.ctxOf(reg, { logging: 'assisted_bodyweight', ports: { performed: () => sets } } as never)
  eq(TK.num(EV.evaluate({ k: 'performed', step: 'w' as never, metric: 'load', pick: 'best' }, cx).value), 20, 'the performed former')
  const setT = (target: unknown): Term => ({ k: 'set', role: 'working', target: target as never, rest: null, tempo: null, cluster: null })
  const tr = EV.evaluate(
    { k: 'session', exercise: ref('exercise', 'wger:111'), intensifier: null, steps: [{ k: 'step', id: 'A' as never, count: { k: 'n', n: lit(2, 'set') }, target: setT({ reps: { b: 'exact', v: lit(8, 'rep') } }) }, { k: 'step', id: 'B' as never, count: { k: 'n', n: lit(1, 'set') }, target: setT({ load: { b: 'exact', v: { k: 'orElse', a: { k: 'performed', step: 'A' as never, metric: 'load', pick: 'best' }, b: lit(0, 'kg') } } }) }] },
    EV.ctxOf(reg),
  )
  const s = (tr.value as Extract<Value, { v: 'session' }>).s
  const issued = issuedOf([{ slot: 's', exercise: { id: 'x:assisted', label: 'Assisted Pull-up', logging: 'assisted_bodyweight' }, steps: s.steps, intensifier: null, trace: tr }])
  const rows = IS.resolveLive({ reg }, issued, { s: { A: sets } }, [])
  eq(fixedN(rows.find((r) => r.step === 'B')?.value), 20, 'live resolution')
})

// ── F8: calendar ordering ───────────────────────────────────────────────────

t('', 'F8 (semrev-a p3): a late-ingested older session neither lapses the instance nor makes cal.gap negative', () => {
  let r = TK.start(P.linear3x5.def, {}, F, 'B')
  const x1 = TK.issue(r, d(1), F)
  r = x1.run
  const x2 = TK.issue(r, d(19), F)
  r = TK.close(x2.run, x2.issued, TK.asPrescribed(x2.issued), d(19)).run
  r = TK.close(r, x1.issued, TK.asPrescribed(x1.issued), d(1)).run
  eq(ST.prescribe(r.rt, r.ledger, 'B', F, d(23)).ledger.head.calendar.status, 'active', 'trained on day 19, closed through day 22')
  const g = PO.calPort(r.rt.spec, r.ledger.head.calendar, d(1), 0, PO.newReads())({ q: 'gap', of: { s: 'any' } })
  eq(TK.num(g), 0, 'cal.gap at the late session’s own day')
})

t('', 'F8 (semrev-c p7): lapse counts from the latest session day, never the latest ingested', () => {
  let run = TK.start(P.linear3x5.def, {}, F)
  const a = TK.issue(run, D0, F)
  const b = TK.issue(a.run, d(30), F)
  run = b.run
  const ing = (e: import('./engine').Event) => (run = { ...run, ledger: ST.ingest(run.rt, run.ledger, e).ledger })
  ing(TK.closeOf(b.issued, TK.asPrescribed(b.issued), d(30), [], 'wB'))
  ing(TK.closeOf(a.issued, TK.asPrescribed(a.issued), d(2), [], 'wA'))
  for (let n = 31; n <= 40; n++) ing({ k: 'dayClosed', causeKey: `day:${run.rt.spec.instance}:${d(n)}`, day: d(n) })
  eq(run.ledger.head.calendar.status, 'active', 'a session 10 days earlier')
})

t('', 'F8 (semrev-c p18): cal.gap never goes negative when the tracked last day is after the stamped day', () => {
  const a = TK.issue(TK.start(P.linear3x5.def, {}, F), D0, F)
  const r = ST.ingest(a.run.rt, a.run.ledger, TK.closeOf(a.issued, TK.asPrescribed(a.issued), d(5), [], 'w1'))
  eq(PO.calPort(a.run.rt.spec, r.ledger.head.calendar, d(3), 0, PO.newReads())({ q: 'gap', of: { s: 'any' } }), { v: 'none', cause: { k: 'noPriorSession' } }, 'nothing on or before day 3')
})

t('', 'F8 (semrev-c p6): dayClosed is monotonic: a regressed day cannot un-close, a skipped day cannot orphan a window', () => {
  const r = TK.start(P.linear3x5.def)
  const ev = (n: number) => ({ k: 'dayClosed', causeKey: `day:${r.rt.spec.instance}:${d(n)}`, day: d(n) }) as import('./engine').Event
  const fold = (ns: number[]) => ns.reduce((l, n) => ST.ingest(r.rt, l, ev(n)).ledger, r.ledger)
  const back = fold([0, 1, 2, 3, 4, 5, 6, 8, 7])
  eq(back.head.calendar.reconciledThrough, d(8), 'closing day 7 after day 8 does not move reconciliation back')
  const gap = fold([0, 1, 2, 3, 4, 5, 7])
  eq(gap.head.calendar.adherence.map((a) => a.key), [`adhere:${r.rt.spec.instance}:0:0`], 'skipping day 6 still closes the week-0 window')
  eq(gap.head.calendar.reconciledThrough, d(7), 'reconciled through the max seen day')
  eq(TI.reconcile(r.rt.spec, back.head.calendar, d(9)).map((e) => e.day), [], 'nothing left to reconcile')
})

// ── F9: nothing advances past blockEnd ──────────────────────────────────────

t('', 'F9 (semrev-c p14): a skip after blockEnd is refused programComplete; the week never moves past the end', () => {
  const def = { ...P.linear3x5.def, calendar: { weeks: ['train', 'train'], repeat: 'once', drift: 'slide' } } as ProgramDef
  let r = TK.start(def, {}, F)
  let n = 0
  const skip = () => {
    const x = ST.ingest(r.rt, r.ledger, { k: 'skip', causeKey: `skip:${++n}`, slot: 'x' })
    r = { ...r, ledger: x.ledger }
    return x.result
  }
  while (r.ledger.head.status !== 'completed' && n < 100) skip()
  const week = r.ledger.head.progress.week
  const res = skip()
  eq(res.k === 'refused' ? res.refusal.code : res.k, 'programComplete', 'skip after completion')
  skip()
  skip()
  eq(r.ledger.head.progress.week, week, 'the week stays at the end')
  for (const e of [{ k: 'pause', causeKey: 'pause:x', from: d(30), until: null }, { k: 'resume', causeKey: 'resume:x', on: d(31) }] as import('./engine').Event[]) {
    const x = ST.ingest(r.rt, r.ledger, e).result
    eq(x.k === 'refused' ? x.refusal.code : x.k, 'programComplete', `${e.k} after completion`)
  }
})

// ── F10: anchored drift ─────────────────────────────────────────────────────

t('', 'F10 (semrev-a p9): activated before the anchor, the anchor day closes nothing before the program starts (5/3/1 week 1)', () => {
  const def = { ...P.fiveThreeOneBBB.def, calendar: { ...P.fiveThreeOneBBB.def.calendar, drift: 'anchored' } } as ProgramDef
  const rt = PO.runtimeOf(reg, def, { id: 'a', anchor: D0, activatedOn: d(-4) })
  const p = ST.prescribe(rt, ST.ledgerOf(ST.activate(rt, {}, F)), def.rotation.days[0] as string, F, D0)
  eq(p.ledger.head.progress.week, 0, 'block week 0 on the anchor day')
  eq(p.ledger.transitions.flatMap((x) => x.emitted), [], 'no week closed')
  const q = ST.prescribe(rt, p.ledger, def.rotation.days[0] as string, F, d(7))
  eq(q.ledger.head.progress.week, 1, 'the first week closes on anchor + 6')
})

t('', 'F10 (semrev-c p8): anchored projection reconciles before issuing, so weekly projections issue the rotation’s count per week', () => {
  const def = { ...P.linear3x5.def, calendar: { ...P.linear3x5.def.calendar, drift: 'anchored' } } as ProgramDef
  const rt = PO.runtimeOf(reg, def, { id: 'm-anch', anchor: D0, activatedOn: D0 })
  let l = ST.ledgerOf(ST.activate(rt, {}, F))
  const per: Record<number, number> = {}
  for (let w = 0; w < 3; w++) {
    const p = PJ.project(rt, l, l.head.progress.week + 1, { k: 'asPrescribed' }, F, d(7 * w))
    l = p.ledger
    for (const x of p.weeks) per[x.week] = (per[x.week] ?? 0) + x.sessions.length
  }
  eq(per, { 0: 3, 1: 3, 2: 3 }, 'three per week')
})

// ── F11: prescribed reads carry the metric's dimension ──────────────────────

t('', 'F11 (semrev-a p7, semrev-c p3, semrev-b p3): a prescribed edge carries the metric’s dimension and display unit; its trace reads in that unit', () => {
  const tgt = { role: 'amrap', metrics: { load: { k: 'fixed', v: { b: 'exact', v: 170 * 0.45359237 } } }, restSec: null, tempo: null, cluster: null }
  const cx = EV.ctxOf(reg, { display: { load: 'lb' }, ports: { prescribed: () => [tgt as never], performed: () => [set({ load: 170 * 0.45359237, reps: 6 })] } })
  const wrap = (a: Term): Term => ({ k: 'round', mode: 'nearest', a: { k: 'arith', op: '*', a, b: lit(0.9, 'pct') }, step: lit(5 * 0.45359237, 'lb') })
  const viaPres = DR.explain(EV.evaluate(wrap({ k: 'prescribed', step: 'top' as never, metric: 'load', edge: 'floor' }), cx), reg)
  const viaPerf = DR.explain(EV.evaluate(wrap({ k: 'performed', step: 'top' as never, metric: 'load', pick: 'last' }), cx), reg)
  eq(viaPres, viaPerf, 'the same math reads the same')
  eq(viaPres, '155 lb (153 lb (170 lb × 90%) rounded to the nearest 5 lb)', 'in lb')
  const c3 = EV.ctxOf(reg, { ports: { prescribed: () => [{ ...tgt, metrics: { load: { k: 'fixed', v: { b: 'exact', v: 80 } } } } as never] } })
  const r3 = EV.evaluate({ k: 'arith', op: '*', a: { k: 'prescribed', step: 'a' as never, metric: 'load', edge: 'floor' }, b: lit(1.05, 'pct') }, c3)
  eq(DR.explain(r3, reg), '84 kg (80 kg × 105%)', 'no display unit: the metric’s first unit')
  eq((r3.value as EV.QV).dim, { mass: 1 }, 'dimension mass')
  const ev = port('weight_reps', [])({ q: 'prescribed', step: 'top' as never, metric: 'load', edge: 'floor' })
  eq(ev.v === 'none' ? 'none' : (ev as EV.QV).dim, 'none', 'no issued sets: absent')
})

// ── F12: scaleSets never grows ──────────────────────────────────────────────

t('', 'F12 (semrev-a p6, semrev-c p11): a literal scaleSets factor above 1 is refused; an evaluated one never grows the count past the issued targets', () => {
  const tgt = { role: 'working', metrics: { reps: { k: 'fixed', v: { b: 'exact', v: 5 } } }, restSec: null, tempo: null, cluster: null } as never
  const s = { exercise: { v: 'ref', kind: 'exercise', id: 'wger:111' }, steps: [{ id: 'm', key: 'm', count: { k: 'n', n: 3 }, sets: [tgt, tgt, tgt], block: null, live: null }], intensifier: null } as never
  const o = XF.applyXform('scaleSets', s, EV.qv(1.5, {}, 'x'), null, null)
  eq([o.steps[0]!.count, o.steps[0]!.sets.length], [{ k: 'n', n: 3 }, 3], 'count and targets agree')
  eq(PO.plannedSets(o.steps, 0), 3, 'planned volume')
  eq(IS.setsDue({ reg }, { slot: 'x', exercise: { id: 'wger:111', label: 'Squat', logging: 'weight_reps' }, steps: o.steps, intensifier: null, trace: { node: lit(0, 'x'), value: EV.qv(0, {}, 'x'), kids: [] } }, o.steps[0]!, {}), 3, 'the logger asks for 3')
  const sess: Term = { k: 'session', exercise: ref('exercise', 'wger:111'), intensifier: null, steps: [{ k: 'step', id: 'A' as never, count: { k: 'n', n: lit(4, 'set') }, target: { k: 'set', role: 'working', target: { reps: { b: 'exact', v: lit(5, 'rep') } }, rest: null, tempo: null, cluster: null } }] }
  const out: TypeError[] = []
  CK.top({ k: 'xform', op: 'scaleSets', s: sess, arg: lit(1.5, 'x'), metric: null }, CK.baseScope(reg, 'plan', {}, { id: 'demo/semfix', seq: reg.seq.size }), [], null, out)
  eq(codes(out), ['literalDomain@arg'], 'refused at check')
})

// ── F13: quantization preserves direction ───────────────────────────────────

t('', 'F13 (semrev-c p16, semrev-b p1): a ceiling quantizes down, a floor up, exact to nearest; an inverted or emptied range is outOfDomain', () => {
  const sink = (v: unknown, m = 'load') => IS.sinkField({ k: 'fixed', v: v as never }, m, { load: 2.5 })
  eq(sink({ b: 'atMost', v: 101.3 }), { k: 'fixed', v: { b: 'atMost', v: 100 } }, 'atMost down')
  eq(sink({ b: 'atLeast', v: 101.2 }), { k: 'fixed', v: { b: 'atLeast', v: 102.5 } }, 'atLeast up')
  eq(sink({ b: 'exact', v: 101.3 }), { k: 'fixed', v: { b: 'exact', v: 102.5 } }, 'exact nearest')
  eq(sink({ b: 'exact', v: 101.25 }), { k: 'fixed', v: { b: 'exact', v: 100 } }, 'exact tie down')
  eq(sink({ b: 'range', min: 101.3, max: 108.7 }), { k: 'fixed', v: { b: 'range', min: 102.5, max: 107.5 } }, 'range tightens')
  eq(sink({ b: 'range', min: 3, max: 1 }).k, 'silent', 'an inverted range is outOfDomain')
  eq(sink({ b: 'range', min: 101.3, max: 101.9 }).k, 'silent', 'a range with no grid point inside is outOfDomain')
})

t('', 'F13: reps quantize to whole numbers at the sink, in the bound’s direction', () => {
  const rt = TK.start(P.linear3x5.def).rt
  const tgt = (b: unknown) => ({ role: 'working', metrics: { reps: { k: 'fixed', v: b } }, restSec: null, tempo: null, cluster: null })
  const s = { exercise: { v: 'ref', kind: 'exercise', id: 'wger:111' }, intensifier: null, steps: [{ id: 'w', key: 'w', count: { k: 'n', n: 3 }, block: null, live: null, sets: [tgt({ b: 'exact', v: 3.75 }), tgt({ b: 'atLeast', v: 7.2 }), tgt({ b: 'atMost', v: 7.8 })] }] } as never
  const sl = IS.sinkSlot(rt, 'x', s, {}, null as never)
  eq(sl.steps[0]!.sets.map((x) => x.metrics['reps']), [{ k: 'fixed', v: { b: 'exact', v: 4 } }, { k: 'fixed', v: { b: 'atLeast', v: 8 } }, { k: 'fixed', v: { b: 'atMost', v: 7 } }], 'whole reps')
})

t('', 'F13 (semrev-b p5): a literal inverted range is refused; an evaluated inverted count range issues a consistent count', () => {
  const tg: Term = { k: 'set', role: 'working', target: { reps: { b: 'range', min: lit(12, 'rep'), max: lit(8, 'rep') } }, rest: null, tempo: null, cluster: null }
  const out: TypeError[] = []
  CK.top(tg, CK.baseScope(reg, 'live', {}, { id: 'demo/semfix', seq: reg.seq.size }), [], null, out)
  eq(codes(out), ['literalDomain@target.reps'], 'literal bound range 12–8')
  const session = (min: Term, max: Term): Term => ({ k: 'session', exercise: ref('exercise', 'wger:111'), intensifier: null, steps: [{ k: 'step', id: 'w' as never, count: { k: 'range', min, max }, target: { k: 'set', role: 'working', target: { reps: { b: 'exact', v: lit(5, 'rep') } }, rest: null, tempo: null, cluster: null } }] })
  const o2: TypeError[] = []
  CK.top(session(lit(5, 'set'), lit(2, 'set')), CK.baseScope(reg, 'plan', {}, { id: 'demo/semfix', seq: reg.seq.size }), [], null, o2)
  eq(codes(o2), ['literalDomain@steps.0.count'], 'literal count range 5–2')
  const v = EV.evaluate(session({ k: 'param', name: 'lo' }, { k: 'param', name: 'hi' }), EV.ctxOf(reg, { params: { lo: EV.qv(5, { set: 1 }, 'set'), hi: EV.qv(2, { set: 1 }, 'set') } })).value as Extract<Value, { v: 'session' }>
  const st = v.s.steps[0]!
  eq([EV.plannedCount(st), st.sets.length, PO.plannedSets(v.s.steps, 0)], [2, 2, 2], 'count, issued slots and volume agree')
})

// ── F14: the completed flag leaves the shape ────────────────────────────────

t('', 'F14 (semrev-b p3): the boundary drops uncompleted sets; PerformedSet has no completed field; a session of only uncompleted sets is empty', () => {
  const tgt = { role: 'working', metrics: { reps: { k: 'fixed', v: { b: 'exact', v: 5 } } }, restSec: null, tempo: null, cluster: null } as never
  eq('completed' in EV.asPrescribedSet(tgt), false, 'asPrescribedSet')
  const raw = { squat: { work: [{ values: { reps: 5, load: 100 }, completed: false, stages: null }, { values: { reps: 5, load: 100 }, completed: true, stages: null }] } }
  const logged = (IS as unknown as { boundaryLogged: (r: unknown) => Logged }).boundaryLogged(raw)
  eq(logged, { squat: { work: [{ values: { reps: 5, load: 100 }, stages: null }] } }, 'filtered, flag dropped')
  const empty = (IS as unknown as { boundaryLogged: (r: unknown) => Logged }).boundaryLogged({ squat: { work: [{ values: { reps: 5 }, completed: false, stages: null }] } })
  const x = TK.issue(TK.start(P.linear3x5.def, {}, F), D0, F)
  const r = ST.ingest(x.run.rt, x.run.ledger, TK.closeOf(x.issued, empty, D0, [], 'wF14')).result
  eq(r.k === 'refused' ? r.refusal.code : r.k, 'emptySession', 'nothing completed is the empty-finish law')
})

// ── F15: a zero-logged slot is untrained ────────────────────────────────────

t('', 'F15 (semrev-c p12): a slot with no logged sets in a closing session does not advance and its handler records keep(untrained)', () => {
  const run = TK.start(P.fiveThreeOneBBB.def, {}, F)
  const x = TK.issue(run, D0, F)
  const all = TK.asPrescribed(x.issued)
  const logged: Logged = { press: all['press']!, pressBbb: Object.fromEntries(Object.keys(all['pressBbb']!).map((k) => [k, []])) }
  const r = TK.close(x.run, x.issued, logged, D0)
  const p = r.run.ledger.head.progress
  eq([p.slotSessions, p.weekSlots], [{ press: 1 }, ['press']], 'only the trained slot advances')
  eq(r.run.ledger.head.calendar.occurrences[0]!.slots, ['press'], 'the occurrence names the trained slot')
  const tr = r.run.ledger.transitions.at(-1)!
  const bbbFired = tr.fired.find((f) => f.scope === 'pressBbb')
  assert(!bbbFired || bbbFired.skipped === 'untrained', 'the untrained slot’s handler does not run')
})

// ── F16: pause is real ──────────────────────────────────────────────────────

t('', 'F16 (semrev-b p5): a pause sets status paused, the lapse clock stops, and resume clears it', () => {
  const spec: TI.CalendarSpec = { instance: 'i', anchor: TI.localDay('2026-10-05'), activatedOn: TI.localDay('2026-10-05'), frequency: [{ k: 'atLeast', n: 3, of: { s: 'any' }, per: { k: 'week' } }], slots: {}, lapseAfterDays: 21, tracked: [{ s: 'any' }] }
  let st = TI.activate(spec)
  st = TI.stepCalendar(spec, st, { k: 'pause', causeKey: 'pause:1', from: TI.localDay('2026-10-06'), until: null })
  for (const e of TI.reconcile(spec, st, TI.localDay('2026-11-10'))) st = TI.stepCalendar(spec, st, e)
  eq(st.status, 'paused', 'after 36 paused days')
  let b = TI.activate(spec)
  b = TI.stepCalendar(spec, b, { k: 'pause', causeKey: 'pause:2', from: spec.activatedOn, until: TI.localDay('2026-10-09') })
  eq(b.status, 'paused', 'a pause from today takes effect at its event')
  for (const e of TI.reconcile(spec, b, TI.localDay('2026-10-12'))) b = TI.stepCalendar(spec, b, e)
  eq(b.status, 'active', 'a bounded pause ends by itself')
  let run = TK.start(P.linear3x5.def, {}, F)
  const ing = (e: import('./engine').Event) => (run = { ...run, ledger: ST.ingest(run.rt, run.ledger, e).ledger })
  ing({ k: 'pause', causeKey: 'pause:p', from: d(2), until: null })
  eq(run.ledger.head.status, 'active', 'a pause from a later day is not in effect yet')
  ing({ k: 'dayClosed', causeKey: `day:${run.rt.spec.instance}:${d(0)}`, day: d(0) })
  ing({ k: 'dayClosed', causeKey: `day:${run.rt.spec.instance}:${d(1)}`, day: d(1) })
  eq(run.ledger.head.status, 'paused', 'paused on its first day')
  for (let n = 2; n < 30; n++) ing({ k: 'dayClosed', causeKey: `day:${run.rt.spec.instance}:${d(n)}`, day: d(n) })
  ing({ k: 'resume', causeKey: 'resume:p', on: d(30) })
  eq([run.ledger.head.status, run.ledger.head.calendar.status], ['active', 'active'], 'resumed')
  for (let n = 30; n < 35; n++) ing({ k: 'dayClosed', causeKey: `day:${run.rt.spec.instance}:${d(n)}`, day: d(n) })
  eq(run.ledger.head.calendar.status, 'active', 'five unpaused days after resume is not a lapse')
})

t('', 'F16 (semrev-c p13): a zero-length pause voids nothing; a one-day pause voids its window', () => {
  for (const [resume, voided] of [[2, false], [3, true]] as const) {
    let r = TK.start(P.linear3x5.def)
    const ing = (e: import('./engine').Event) => (r = { ...r, ledger: ST.ingest(r.rt, r.ledger, e).ledger })
    ing({ k: 'pause', causeKey: 'pause:1', from: d(2), until: null })
    ing({ k: 'resume', causeKey: 'resume:1', on: d(resume) })
    for (let n = 0; n < 7; n++) ing({ k: 'dayClosed', causeKey: `day:${r.rt.spec.instance}:${d(n)}`, day: d(n) })
    eq(r.ledger.head.calendar.adherence[0]!.void, voided, `resume on D+${resume}`)
  }
})

// ── F17: capEffort on atMost ────────────────────────────────────────────────

t('', 'F17: capEffort on “at most v in reserve” with v ≥ cap is the range [cap, v]', () => {
  const tgt = { role: 'working', metrics: { reps: { k: 'fixed', v: { b: 'exact', v: 5 } }, effort: { k: 'fixed', v: { b: 'atMost', v: 4 } } }, restSec: null, tempo: null, cluster: null }
  const s = { exercise: { v: 'ref', kind: 'exercise', id: 'wger:111' }, steps: [{ id: 'm', key: 'm', count: { k: 'n', n: 1 }, sets: [tgt], block: null, live: null }], intensifier: null } as never
  eq(XF.applyXform('capEffort', s, EV.qv(2, { effort: 1 }, 'rir'), null, null).steps[0]!.sets[0]!.metrics['effort'], { k: 'fixed', v: { b: 'range', min: 2, max: 4 } }, 'eased')
  const low = { ...tgt, metrics: { ...tgt.metrics, effort: { k: 'fixed', v: { b: 'atMost', v: 1 } } } }
  eq(XF.applyXform('capEffort', { ...(s as object), steps: [{ id: 'm', key: 'm', count: { k: 'n', n: 1 }, sets: [low], block: null, live: null }] } as never, EV.qv(2, { effort: 1 }, 'rir'), null, null).steps[0]!.sets[0]!.metrics['effort'], { k: 'fixed', v: { b: 'exact', v: 2 } }, 'below the cap: exact cap')
})

// ── F18: movement needs a value on both sides ───────────────────────────────

t('', 'F18: an outcome policy’s increase/decrease is present → present only; unset → value and value → absent move neither way', () => {
  const moved = (ST as unknown as { moved: (b: Value | undefined, a: Value) => { up: boolean; down: boolean; any: boolean } }).moved
  const kg = (n: number) => EV.qv(n, { mass: 1 }, 'kg')
  const unset: Value = { v: 'none', cause: { k: 'stateUnset', field: 'load' } }
  eq(moved(undefined, kg(50)), { up: false, down: false, any: true }, 'unset → value')
  eq(moved(unset, kg(50)), { up: false, down: false, any: true }, 'none → value')
  eq(moved(kg(50), unset), { up: false, down: false, any: true }, 'value → absent')
  eq(moved(kg(50), kg(40)), { up: false, down: true, any: true }, 'present decrease')
  const m = (e: [string, number][]): Value => ({ v: 'map', entries: e.map(([k, n]) => [k, EV.qv(n, { set: 1 }, 'set')]) })
  eq(moved(m([['a', 1]]), m([['a', 1], ['b', 2]])), { up: false, down: false, any: true }, 'a new map entry is neither')
})

// ── F19: the latest observation wins ────────────────────────────────────────

t('', 'F19: duplicate snapshot facts resolve to the latest observation (observedOn, then ingestion)', () => {
  const r = (n: number, on: string) => ({ fact: 'bodyweight', key: null, value: EV.qv(n, { mass: 1 }, 'kg'), observedOn: TI.localDay(on) })
  eq(TK.num(PO.snapshotSource([r(80, '2026-10-05'), r(79, '2026-10-06')]).get('bodyweight', null)!.value), 79, 'later observedOn')
  eq(TK.num(PO.snapshotSource([r(80, '2026-10-05'), r(78, '2026-10-05')]).get('bodyweight', null)!.value), 78, 'same day: the later reading')
  eq(TK.num(PO.snapshotSource([r(79, '2026-10-06'), r(80, '2026-10-05')]).get('bodyweight', null)!.value), 79, 'an older reading appended late does not win')
  near(TK.num(port('weighted_bodyweight', [set({ reps: 6 })], [r(80, '2026-10-05'), r(70, '2026-10-05')])({ q: 'e1rm', step: 'top' as never })), 70 * 1.2, 'the e1RM reads the post-session reading')
})

// ── F20, F21: planned volume and the issued trace after policies ────────────

const readinessFacts = () => TK.factsOf({ e1rm: TK.E1RM, readiness: { v: 'ord', scale: 'readiness', level: 2 } })

t('', 'F20: weekly(metric) is the planned volume AFTER policies and the sink, in the metric’s dimension', () => {
  const facts = readinessFacts()
  const x = TK.issue(TK.start(P.upperHypertrophy.def, {}, facts), D0, facts)
  assert(x.issued.stamp.policies.length > 0, 'the readiness policy fired')
  const press = x.issued.slots.find((s) => s.slot === 'press')!
  const issuedLoad = press.steps.reduce((a, st) => a + st.sets.slice(0, EV.plannedCount(st)).filter(XF.isJudged).reduce((b, tg) => {
    const f = tg.metrics['load']
    const fx = f?.k === 'open' ? f.planned : f
    return b + (fx?.k === 'fixed' && fx.v.b !== 'open' ? (fx.v.b === 'range' ? fx.v.min : fx.v.v) : 0)
  }, 0), 0)
  const v = PO.aggPort(x.run.rt, x.run.ledger.head, { facts, today: D0, earlierToday: 0, reads: PO.newReads() })({ q: 'weekly', metric: 'load', by: { k: 'slot', id: 'press' } }) as EV.QV
  near(v.n, issuedLoad * PO.sessionsPerWeek(P.upperHypertrophy.def, 'press'), 'what is issued, times sessions a week')
  eq(v.dim, { mass: 1 }, 'mass')
})

t('', 'F21: the issued trace explains the actual numbers: the policy’s transform is in it and its value is the sunk session', () => {
  const facts = readinessFacts()
  const x = TK.issue(TK.start(P.upperHypertrophy.def, {}, facts), D0, facts)
  const press = x.issued.slots.find((s) => s.slot === 'press')!
  const apps: string[] = []
  const walk = (tr: import('./engine').Trace) => {
    if (tr.node.k === 'app') apps.push(tr.node.def.id)
    tr.kids.forEach(walk)
  }
  walk(press.trace)
  assert(apps.includes('lib/deload'), `the deload is in the trace: ${apps}`)
  const root = press.trace.value as Extract<Value, { v: 'session' }>
  eq(root.s.steps[0]!.sets[0]!.metrics['load'], press.steps[0]!.sets[0]!.metrics['load'], 'the trace’s value is the issued (sunk) one')
})

// ── F22: issue identity and canonical hashes ────────────────────────────────

t('', 'F22 (semrev-c p17, p5): distinct issues have distinct keys; resolution digests are key-order independent', () => {
  const a = TK.issue(TK.start(P.linear3x5.def, {}, F), D0, F)
  const edited = ST.ingest(a.run.rt, a.run.ledger, { k: 'ownerEdit', causeKey: 'edit:1', scope: 'squat', patch: { load: { k: 'q', v: 120, unit: 'kg' } } })
  const b = TK.issue({ ...a.run, ledger: edited.ledger }, D0, F)
  assert(a.issued.issueKey !== b.issued.issueKey, `distinct: ${a.issued.issueKey} vs ${b.issued.issueKey}`)
  const x = apre()
  const one = IS.resolveLive({ reg }, x.issued, { x: { top: [set({ reps: 9, load: LB(185) })] } }, [])
  const two = IS.resolveLive({ reg }, x.issued, { x: { top: [set({ load: LB(185), reps: 9 })] } }, one)
  eq(two.length, 0, 'the same logged data with its keys swapped adds no row')
  eq(PO.hashOf({ a: 1, b: [2, { c: 3, d: 4 }] }), PO.hashOf({ b: [2, { d: 4, c: 3 }], a: 1 }), 'hashOf is over canonical JSON')
})

// ── F23: projection is tagged in the types ──────────────────────────────────

t('', 'F23: projected sessions, the projected ledger and macro handoff values are tagged projected with their assumption', () => {
  const run = TK.start(P.linear3x5.def, {}, F)
  const p = PJ.project(run.rt, run.ledger, 1, { k: 'allMiss' }, F, D0) as unknown as { ledger: { projected?: boolean }; weeks: { sessions: { projected?: boolean; assume?: string }[] }[] }
  assert(p.weeks.every((w) => w.sessions.every((s) => s.projected === true && s.assume === 'allMiss')), 'every projected session is tagged')
  eq(p.ledger.projected, true, 'the projected ledger is tagged')
  const runs = PJ.projectMacro(reg, P.optMacro, { k: 'asPrescribed' }, TK.corpusFacts(D0), 40, TK.readings({ formQuality: { v: 'ord', scale: 'formQuality', level: 2 } }, D0)) as unknown as { handoff?: { projected?: boolean; values?: Record<string, Value> } }[]
  assert(runs.length > 1 && runs.every((r) => r.handoff?.projected === true && !!r.handoff.values), 'each phase’s handoff values are tagged')
})

// ── P1: canonical JSON and the pinned FNV input ─────────────────────────────

t('', 'P1: FNV-1a runs over the UTF-16 code units of canonical JSON (a non-BMP character hashes both surrogates)', () => {
  const ref32 = (s: string) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  eq(PO.hashOf('𝄞'), ref32(JSON.stringify('𝄞')), 'a G clef')
  assert(PO.hashOf('\u{1D11E}') !== PO.hashOf('\u{1D11F}'), 'two non-BMP characters differing in the low surrogate differ')
  eq(PO.hashOf({ z: 1, a: 2 }), ref32('{"a":2,"z":1}'), 'sorted keys')
})

// ── P2: declaration order ───────────────────────────────────────────────────

t('', 'P2: integer-like slot ids, day names and state fields are refused (a JS object would reorder them); list order is declaration order', () => {
  const p = clone(P.linear3x5.def) as ProgramDef
  const slots = p.slots as Record<string, unknown>
  p.slots = { '12': slots['squat'], bench: slots['bench'], press: slots['press'], dead: slots['dead'] } as never
  p.days = { A: [{ k: 'single', slot: '12' }, { k: 'single', slot: 'bench' }, { k: 'single', slot: 'dead' }], B: [{ k: 'single', slot: '12' }, { k: 'single', slot: 'press' }, { k: 'single', slot: 'dead' }] } as never
  const errs = CD.checkProgram(p, reg).flatMap((x) => x.errors)
  assert(errs.some((e) => e.code === 'literalDomain' && e.path.join('.') === 'slots.12'), `refused: ${codes(errs)}`)
  const s = clone(P.linearGated.def) as SchemeDef
  s.state = { '0': s.state['misses']!, load: s.state['load']! } as never
  assert(CD.checkScheme(s, reg).some((e) => e.code === 'literalDomain' && e.path.join('.') === 'state.0'), 'integer-like state field')
  const ids = ['10', '2', '1']
  const items = ids.map((id) => ref('slot', id))
  const among: Term = { k: 'list', items, of: { t: 'ref', kind: 'slot' } }
  const al = EV.evaluate({ k: 'allocate', n: lit(2, 'set'), into: { k: 'tabulate', keys: among, as: 's' as never, body: lit(0, 'set') }, among, as: 's' as never, score: lit(1, 'x'), cap: lit(1, 'set'), max: 5 }, EV.ctxOf(reg)).value as Extract<Value, { v: 'map' }>
  eq(al.entries.map(([k, v]) => [k, TK.num(v)]), [['10', 1], ['2', 1], ['1', 0]], 'allocate: ties go in declaration order, entries keep it')
  const pk = EV.evaluate({ k: 'pick', mode: 'max', xs: among, as: 's' as never, where: null, score: lit(1, 'x') }, EV.ctxOf(reg)).value
  eq(pk, { v: 'ref', kind: 'slot', id: '10' }, 'pick: the first declared on a tie')
})

// ── P3: LocalDay ────────────────────────────────────────────────────────────

t('', 'P3 (semrev-a p10, semrev-c p1): a LocalDay is a real calendar date; anything else is refused with notALocalDay', () => {
  for (const s of ['2026-02-30', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10', '2026-02-29']) {
    let threw = false
    try {
      TI.localDay(s)
    } catch {
      threw = true
    }
    assert(threw, `${s} refused`)
    eq((TI as unknown as { parseLocalDay: (s: string) => unknown }).parseLocalDay(s), { code: 'notALocalDay', stamped: s }, `${s} refusal`)
  }
  eq(TI.localDay('2028-02-29'), '2028-02-29', 'a leap day')
  const r = TK.start(P.linear3x5.def)
  const res = ST.ingest(r.rt, r.ledger, { k: 'dayClosed', causeKey: `day:${r.rt.spec.instance}:2026-02-30` as never, day: '2026-02-30' as never }).result
  eq(res.k === 'refused' ? res.refusal : res.k, { code: 'notALocalDay', stamped: '2026-02-30' }, 'ingest refuses an event stamped on a day that does not exist')
})

// ── P4: arithmetic law ──────────────────────────────────────────────────────

t('', 'P4 (semrev-c p1): allocate’s cap compares with the floor tolerance; cmpNum treats equal infinities as equal', () => {
  const cap: Term = { k: 'arith', op: '*', a: { k: 'arith', op: '+', a: lit(0.1, 'x'), b: lit(0.2, 'x') }, b: lit(10, 'set') }
  const r = EV.evaluate({ k: 'allocate', n: lit(10, 'set'), into: { k: 'tabulate', keys: { k: 'keys', of: 'slots' }, as: 's' as never, body: lit(0, 'set') }, among: { k: 'keys', of: 'slots' }, as: 's' as never, score: lit(1, 'x'), cap, max: 10 }, EV.ctxOf(reg, { ports: { keys: () => [{ v: 'ref', kind: 'slot', id: 'a' }] } })).value as Extract<Value, { v: 'map' }>
  eq(TK.num(r.entries[0]![1]), 3, 'a cap of 0.1 + 0.2 times 10 sets is 3 sets')
  eq(EV.cmpNum(Infinity, Infinity), 0, '∞ = ∞')
  eq(EV.cmpNum(-Infinity, Infinity), -1, '−∞ < ∞')
})

t('', 'P4 (semrev-c p2, semrev-b p1, semrev-a p10): nearestStep matches exact rational arithmetic on decimal and lb grids (characterization)', () => {
  const refN = (a: bigint, b: bigint) => {
    const num = 2n * a - b
    const den = 2n * b
    let q = num / den
    if (num % den !== 0n && num > 0n === den > 0n) q += 1n
    return q
  }
  let bad = 0
  for (const [st, sr] of [[2.5, 250n], [1.25, 125n], [0.5, 50n], [1, 100n], [0.25, 25n]] as const)
    for (let a = -2000; a <= 60000; a += 7) if (Math.abs(UN.nearestStep(a / 100, st) - Number(refN(BigInt(a), sr)) * st) > 1e-9) bad++
  for (const g of [5, 2.5, 1.25]) for (let a = 0; a <= 20000; a += 3) if (Math.abs(UN.nearestStep(UN.canon(a / 8, 'lb'), UN.canon(g, 'lb')) - Number(refN(BigInt(a), BigInt(g * 8))) * UN.canon(g, 'lb')) > 1e-9) bad++
  eq(bad, 0, 'no mismatch')
  eq([UN.nearestStep(101.25, 2.5), UN.nearestStep(-101.25, 2.5), UN.nearestStep(7.5, 1)], [100, -102.5, 7], 'ties down, toward −∞')
  eq([UN.nearestStep((40.5 + 3e-10) * 2.5, 2.5), UN.nearestStep((40.5 + 8e-10) * 2.5, 2.5)], [100, 102.5], 'the half-billionth boundary')
})

t('', 'P4 (semrev-b p2): allocate with a duplicate id in among is one candidate (its first occurrence); pick skips an absent score', () => {
  const a = ref('slot', 'a')
  const al = EV.evaluate({ k: 'allocate', n: lit(4, 'x'), max: 10, into: { k: 'tabulate', keys: { k: 'list', items: [a], of: { t: 'ref', kind: 'slot' } }, as: 'k' as never, body: lit(0, 'x') }, among: { k: 'list', items: [a, a], of: { t: 'ref', kind: 'slot' } }, as: 'c' as never, score: lit(1, 'x'), cap: lit(3, 'x') }, EV.ctxOf(reg)).value as Extract<Value, { v: 'map' }>
  eq(TK.num(al.entries[0]![1]), 3, 'the cap holds for the id')
  const none: Term = { k: 'none', of: { t: 'q', dim: {} } }
  const xs: Term = { k: 'list', items: [lit(1, 'x'), lit(2, 'x'), lit(3, 'x')], of: { t: 'q', dim: {} } }
  const score: Term = { k: 'if', c: { k: 'cmp', op: '==', a: vr('x'), b: lit(1, 'x') }, a: none, b: vr('x') }
  eq(TK.num(EV.evaluate({ k: 'pick', mode: 'min', xs, as: 'x' as never, where: null, score }, EV.ctxOf(reg)).value), 2, 'min skips the absent score')
})

t('', 'P4 (semrev-a p5, p10): a literal stores its canonical number beside its display unit; nearestStep on a 5 lb grid (characterization)', () => {
  eq([T(A.lb(5)), T(A.pct(90)), T(A.kg(2.5))], [lit(5 * 0.45359237, 'lb'), lit(0.9, 'pct'), lit(2.5, 'kg')], 'canonical kg, ratio and kg')
  const g = UN.canon(5, 'lb')
  eq([172.5, 167.5, 2.5].map((x) => Number((UN.nearestStep(UN.canon(x, 'lb'), g) / 0.45359237).toFixed(6))), [170, 165, 0], 'ties down on the lb grid')
})

// ── P5: the nits with teeth ─────────────────────────────────────────────────

t('', 'P5 (semrev-c p19): mm:ss never shows :60', () => {
  eq([UN.clock(119.6), UN.clock(359.7), UN.UNITS.minPerKm.prose(5.9999), UN.UNITS.min.prose(2.9999)], ['2:00', '6:00', '6:00 per km', '3:00 min'], 'rounded first')
})

t('', 'P5 (semrev-c p1): the empty sum is a dimensionless zero that takes its partner’s dimension', () => {
  const empty: Term = { k: 'sum', xs: { k: 'list', items: [], of: { t: 'q', dim: {} } }, as: 'x' as never, body: lit(5, 'kg') }
  eq(EV.evaluate(empty, EV.ctxOf(reg)).value, EV.qv(0, {}, null), 'empty sum')
  const v = EV.evaluate({ k: 'arith', op: '+', a: empty, b: lit(5, 'kg') }, EV.ctxOf(reg)).value as EV.QV
  eq([v.n, v.dim, v.unit], [5, { mass: 1 }, 'kg'], 'empty sum + 5 kg is 5 kg')
})

t('', 'P5: activation is independent of slot declaration order (a binding argument reading a peer’s initial state)', () => {
  const s = clone(P.linearGated.def) as SchemeDef
  s.ref = { id: 'user/peer-init' as never, version: 1 }
  s.state['misses'] = { ...s.state['misses']!, init: { k: 'param', name: 'stalls' } }
  const rg = withScheme(s)
  const base = clone(P.linear3x5.def) as ProgramDef
  const bind = (args: Record<string, Term>, m: string) => ({ scheme: s.ref, args, meta: { muscles: { [m]: 1 } } })
  const sq = (base.slots as Record<string, { args: Record<string, Term> }>)['squat']!.args
  const be = (base.slots as Record<string, { args: Record<string, Term> }>)['bench']!.args
  const squat = bind({ ...sq, stalls: lit(3, 'x') }, 'quads')
  const bench = bind({ ...be, stalls: { k: 'peer', slot: 'squat', field: 'misses', of: 'current' } }, 'chest')
  const misses = (slots: Record<string, unknown>) => {
    const def = { ...base, slots, days: { A: [{ k: 'single', slot: 'squat' }, { k: 'single', slot: 'bench' }], B: [{ k: 'single', slot: 'squat' }] }, exports: {} } as ProgramDef
    const rt = PO.runtimeOf(rg, def, { id: 'p5', anchor: D0, activatedOn: D0 })
    return ST.activate(rt, {}, F).state['bench']!['misses']
  }
  const a = misses({ squat, bench })
  const b = misses({ bench, squat })
  eq(b, a, 'same either way')
  eq(TK.num(a!), 3, 'the peer’s initial value')
})

t('', 'P5: the runtime twins of the reshape and swap logging rules leave the session unchanged', () => {
  const tg: Term = { k: 'set', role: 'working', target: { reps: { b: 'exact', v: lit(5, 'rep') }, load: { b: 'exact', v: lit(100, 'kg') } }, rest: null, tempo: null, cluster: null }
  const sess: Term = { k: 'session', exercise: { k: 'param', name: 'ex' }, intensifier: null, steps: [{ k: 'step', id: 'w' as never, count: { k: 'n', n: lit(3, 'set') }, target: tg }] }
  const cx = EV.ctxOf(reg, { params: { ex: { v: 'ref', kind: 'exercise', id: 'wger:111' }, to: { v: 'ref', kind: 'exercise', id: 'push-up' } } })
  const sw = EV.evaluate({ k: 'xform', op: 'swapExercise', s: sess, arg: { k: 'param', name: 'to' }, metric: null }, cx).value as Extract<Value, { v: 'session' }>
  eq(sw.s.exercise, { v: 'ref', kind: 'exercise', id: 'wger:111' }, 'a swap to an exercise that does not log load is a no-op')
  const shape: Term = { k: 'set', role: 'working', target: { distance: { b: 'exact', v: lit(400, 'm') } }, rest: null, tempo: null, cluster: null }
  const rs = EV.evaluate({ k: 'xform', op: 'reshape', s: sess, arg: shape, metric: null }, cx).value as Extract<Value, { v: 'session' }>
  eq(Object.keys(rs.s.steps[0]!.sets[0]!.metrics), ['reps', 'load'], 'a reshape naming an unlogged metric is a no-op')
})

void rowsOf
void ({} as SchemeDef | Field)
done()
