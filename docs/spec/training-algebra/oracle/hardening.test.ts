/**
 * hardening.test.ts — the oracle-hardening round: one test per typing
 * observation (kit-spec-typing.md, Observations) triaged as a real defect.
 * Each test failed on the oracle before its fix. Run: tsx hardening.test.ts
 */
import type { FnDef, Term, Ty } from './algebra'
import { checkFn, checkMacro, checkProgram, checkScheme, prescribesRest, publish } from './checkdefs'
import { baseScope, enumsWith, top, type Scope } from './checker'
import type { Position, TypeError } from './engine'
import * as ER from './endurance-rehab'
import * as P from './programs'
import type { AnyDef, MacroDef, ProgramDef, SchemeDef } from './structure'
import { assert, eq, reg, suite } from './testkit'

const { t, done } = suite('hardening')
const clone = <X>(x: X): X => structuredClone(x)
const ONE: Ty = { t: 'q', dim: {} }
const DAYS: Ty = { t: 'q', dim: { day: 1 } }
const MASS: Ty = { t: 'q', dim: { mass: 1 } }
const q = (v: number, unit: string, per?: string): Term => ({ k: 'lit', lit: { k: 'q', v, unit: unit as never, ...(per ? { per: per as never } : {}) } })
const B = (v: boolean): Term => ({ k: 'lit', lit: { k: 'bool', v } })
const ref = (kind: 'slot' | 'muscle' | 'day' | 'exercise', id: string): Term => ({ k: 'lit', lit: { k: 'ref', kind, id } })
const none = (of: Ty): Term => ({ k: 'none', of })
const calCount: Term = { k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 7, measure: { m: 'count' } } }
const VIEW = { slots: ['a', 'b'], days: ['A'], muscles: ['chest'], tags: ['hard'] }

const scope = (position: Position, over: Partial<Scope> = {}): Scope => ({
  ...baseScope(reg, position, { p: ONE }, { id: 'demo/hardening', seq: reg.seq.size }),
  state: { f: { ty: ONE, init: q(0, 'x'), writableBy: ['session'], noun: 'f' } },
  facts: ['readiness', 'e1rm'],
  peers: () => ONE,
  programFields: { pf: ONE },
  steps: { earlier: ['a'], all: ['a'], own: null },
  ...over,
})
const run = (term: Term, s: Scope, want: Ty | null = null): TypeError[] => {
  const out: TypeError[] = []
  top(term, s, [], want, out)
  return out
}
const brief = (es: readonly TypeError[]) => es.map((e) => `${e.code}@${e.path.join('.')}`)
const codes = (es: readonly TypeError[]) => es.map((e) => e.code)
const plan = scope('plan')
const handler = scope('handler', { writer: 'session' })
const programErrors = (p: ProgramDef, r = reg) => checkProgram(p, r).flatMap((x) => x.errors)
const setOf = (target: Record<string, unknown>, extra: Record<string, unknown> = {}): Term => ({ k: 'set', role: 'working', target: target as never, rest: null, tempo: null, cluster: null, ...extra })
const sess = (exercise: string, steps: unknown[]): Term => ({ k: 'session', exercise: ref('exercise', exercise), steps: steps as never, intensifier: null })
const step = (id: string, target: Term, count: unknown = { k: 'n', n: q(1, 'set') }) => ({ k: 'step', id, count, target })
/** A registry with one definition moved to the end of the publication log. */
const publishedLast = (key: string, extra: AnyDef[] = []) => {
  const all = [...P.PUBLISHED, ...ER.PUBLISHED].map((x) => ('kind' in x ? x : x.def) as AnyDef)
  const moved = all.find((d) => `${d.ref.id}@${d.ref.version}` === key)!
  return publish([...all.filter((d) => d !== moved), ...extra, moved])
}

t('', 'obs 1: orElse joins the clocks of its sides, so a calendar value cannot launder into an unclocked quantity', () => {
  eq(brief(run({ k: 'orElse', a: none(DAYS), b: { k: 'cal', q: { q: 'day' } } }, plan, DAYS)), ['clockMix@'], 'orElse(none days, cal.day) used as days')
  eq(brief(run({ k: 'patch', set: { f: { to: { k: 'orElse', a: none(ONE), b: calCount }, mode: 'commit' } } }, handler)), ['clockMix@set.f.to'], 'committed into state')
  eq(brief(run({ k: 'orElse', a: none({ ...DAYS, clock: 'progress' }), b: { k: 'cal', q: { q: 'day' } } }, plan)), ['clockMix@'], 'progress meets calendar')
  eq(brief(run({ k: 'cmp', op: '>', a: { k: 'orElse', a: none(ONE), b: calCount }, b: q(3, 'x') }, plan)), [], 'a laundered value may still be compared')
})

t('', 'obs 2: a declaration on the calendar clock (state field, param, result) is refused: a calendar value is never stored or passed on', () => {
  const s = clone(ER.c25k.def) as SchemeDef
  s.state['seen'] = { ty: { ...DAYS, clock: 'calendar' }, init: q(0, 'd'), writableBy: ['session'], noun: 'days seen' }
  eq(brief(checkScheme(s, reg)).filter((x) => x.startsWith('clockMix')), ['clockMix@state.seen.ty'], 'calendar state field')
  const f = clone(P.withTempo.def) as FnDef
  f.params = { ...f.params, d: { ...DAYS, clock: 'calendar' } }
  assert(brief(checkFn(f, reg)).includes('clockMix@params.d'), `calendar param: ${brief(checkFn(f, reg))}`)
})

t('', 'obs 4: an unknown literal kind is unknownName naming that kind (it fell into the var case with name undefined)', () => {
  const out = run({ k: 'lit', lit: { k: 'bogus' } } as never, plan)
  eq(out.map((e) => [e.code, (e as { name?: string }).name]), [['unknownName', 'bogus']], 'refusal')
})

t('', 'obs 5: an unknown unit or per is a refusal, not a thrown exception (literals and threshold rows)', () => {
  eq(brief(run(q(1, 'furlong'), plan)), ['unknownName@'], 'unit')
  eq(brief(run(q(1, 'kg', 'fortnight'), plan)), ['unknownName@'], 'per')
  const table: Term = { k: 'table', key: q(5, 'rep'), rows: [{ when: { k: 'q', v: 3, unit: 'furlong' } as never, then: q(1, 'x') }], otherwise: q(0, 'x'), overflow: null }
  eq(brief(run(table, plan)), ['unknownName@rows.0.when'], 'threshold row')
})

t('', 'obs 6: ref literals name something the program declares, and exercise-keyed rows name a registered exercise', () => {
  const inProgram = scope('plan', { program: VIEW })
  eq(brief(run(ref('muscle', 'neck'), inProgram)), ['unknownName@'], 'muscle')
  eq(brief(run(ref('slot', 'ghost'), inProgram)), ['unknownName@'], 'slot')
  eq(brief(run(ref('day', 'Z'), inProgram)), ['unknownName@'], 'day')
  eq(brief(run(ref('muscle', 'neck'), plan)), [], 'no program in view: nothing to check against')
  const rows: Term = { k: 'table', key: ref('exercise', 'wger:111'), rows: [{ when: 'wger:nope', then: q(1, 'x') }], otherwise: q(0, 'x'), overflow: null }
  eq(brief(run(rows, plan)), ['unknownName@'], 'exercise row')
})

t('', 'obs 7: a keyed fact whose key is refused reports only the key refusal (no spurious missingArg)', () => {
  eq(codes(run({ k: 'fact', fact: 'e1rm', key: { k: 'var', name: 'nobody' as never } }, plan)), ['unknownName'], 'refused key')
  eq(codes(run({ k: 'fact', fact: 'e1rm', key: null }, plan)), ['missingArg'], 'absent key')
})

t('', 'obs 9 and 10: pos fields and keys collections are validated (an unknown one typed as weeks or muscles)', () => {
  eq(brief(run({ k: 'pos', field: 'bogus' } as never, plan)), ['unknownName@'], 'pos')
  eq(brief(run({ k: 'keys', of: 'bogus' } as never, plan)), ['unknownName@'], 'keys')
  eq(brief(run({ k: 'keys', of: 'muscles' }, plan)), [], 'muscles')
})

t('', 'obs 11: ordinal rows are keyed by level and enum rows by tag, once each', () => {
  const sore = (whens: unknown[]): Term => ({ k: 'table', key: { k: 'lit', lit: { k: 'ord', scale: 'soreness', level: 1 } }, rows: whens.map((w) => ({ when: w as never, then: q(1, 'x') })), otherwise: null, overflow: null })
  eq(codes(run(sore([null, 1, 2, 3]), plan)), ['tableShape'], 'null level')
  eq(codes(run(sore([0, 1, 2, 3, 3]), plan)), ['tableShape'], 'duplicate level')
  eq(codes(run(sore([0, 1, 2, 3]), plan)), [], 'exact cover')
  const roles: Term = { k: 'table', key: { k: 'pos', field: 'role' }, rows: [...enumsWith().weekRole!, 'train'].map((w) => ({ when: w, then: q(1, 'x') })), otherwise: null, overflow: null }
  assert(codes(run(roles, plan)).includes('tableShape'), `duplicate tag: ${codes(run(roles, plan))}`)
})

t('', 'obs 12: a threshold row is a literal, so a rate per day is clockRate there too', () => {
  const s = scope('plan', { params: { p: { t: 'q', dim: { mass: 1, day: -1 } } } })
  const table: Term = { k: 'table', key: { k: 'param', name: 'p' }, rows: [{ when: { k: 'q', v: 1, unit: 'kg', per: 'd' } as never, then: q(1, 'x') }], otherwise: q(0, 'x'), overflow: null }
  eq(brief(run(table, s)), ['clockRate@rows.0.when'], 'rate row')
})

t('', 'obs 13: agg weekly by tag names a tag the program declares', () => {
  const agg = scope('aggregate', { program: VIEW })
  eq(brief(run({ k: 'agg', q: { q: 'weekly', metric: 'sets', by: { k: 'tag', tag: 'nope' } } }, agg)), ['unknownName@'], 'unknown tag')
  eq(brief(run({ k: 'agg', q: { q: 'weekly', metric: 'sets', by: { k: 'tag', tag: 'hard' } } }, agg)), [], 'declared tag')
})

t('', 'obs 14 and 15: refusals point at real nodes (an until condition at count.stop; metricNotLogged at a non-literal target)', () => {
  const reps5 = setOf({ reps: { b: 'exact', v: q(5, 'rep') } })
  eq(brief(run(sess('wger:192', [step('u', reps5, { k: 'until', stop: q(1, 'x'), max: 3 })]), plan)), ['unitMismatch@steps.0.count.stop'], 'until')
  const load = setOf({ load: { b: 'exact', v: q(20, 'kg') } })
  eq(brief(run(sess('plank', [step('a', { k: 'if', c: B(true), a: load, b: load })]), plan)), ['metricNotLogged@steps.0.target'], 'if target')
  eq(brief(run(sess('plank', [step('a', load)]), plan)), ['metricNotLogged@steps.0.target.target.load'], 'literal set target keeps its precise path')
})

t('', 'obs 16 and 17: an unknown transformer, a technique with no stages, and a negative tempo are refused', () => {
  const s = sess('wger:192', [step('a', setOf({ reps: { b: 'exact', v: q(5, 'rep') } }))])
  eq(brief(run({ k: 'xform', op: 'bogus' as never, s, arg: null, metric: null }, plan)), ['unknownName@'], 'xform')
  eq(brief(run({ k: 'technique', kind: 'drop-set', stages: [] }, plan)), ['literalDomain@stages'], 'no stages')
  eq(brief(run({ k: 'tempo', ecc: -1, pause: 0, con: 1, top: 0 }, plan)), ['literalDomain@ecc'], 'negative tempo')
})

t('', 'obs 20: an optional value where a plain one is wanted is absenceUnhandled everywhere (top, ratio, round)', () => {
  eq(codes(run(none(MASS), plan, MASS)), ['absenceUnhandled'], 'top')
  eq(brief(run({ k: 'ratio', a: none(MASS), b: q(1, 'kg') }, plan)), ['absenceUnhandled@a'], 'ratio a')
  eq(brief(run({ k: 'ratio', a: q(1, 'kg'), b: none(MASS) }, plan)), ['absenceUnhandled@b'], 'ratio b')
  eq(brief(run({ k: 'round', mode: 'nearest', a: none(MASS), step: q(1, 'kg') }, plan)), ['absenceUnhandled@a'], 'round')
})

t('', 'obs 23: a group member whose set JSON omits rest does not prescribe rest (the predicate restOwnedByGroup uses)', () => {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip)
    if (!x || typeof x !== 'object') return x
    const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, strip(v)]))
    if (o['k'] === 'set' && o['rest'] === null) delete o['rest']
    return o
  }
  const ladder = P.stabLadder.def.plan
  eq(prescribesRest(strip(ladder) as Term), false, 'rest omitted')
  eq(prescribesRest(ladder), false, 'rest null')
  eq(prescribesRest(setOf({ reps: { b: 'exact', v: q(5, 'rep') } }, { rest: q(60, 's') })), true, 'rest given')
  eq(codes(programErrors(P.optStrengthEndurance.def)).filter((c) => c === 'restOwnedByGroup'), [], 'the corpus superset')
})

t('', 'obs 24: an example or handoff argument naming no parameter is unknownName', () => {
  const f = clone(P.juggernautBump.def) as FnDef
  f.examples[0]!.args['bogus'] = q(1, 'x')
  eq(brief(checkFn(f, reg)), ['unknownName@examples.0.args.bogus'], 'example arg')
  const m = clone(P.optMacro) as MacroDef
  m.phases[0]!.args['bogus'] = q(1, 'x')
  eq(brief(checkMacro(m, reg)), ['unknownName@phases.0.args.bogus'], 'handoff arg')
})

t('', 'obs 26: imports and macro phases may name only programs published before them (futureRef)', () => {
  const r = publishedLast('prog/linear-3x5@1')
  assert(brief(programErrors(P.gzclpT1Program.def, r)).includes('futureRef@imports.squatStart'), `import: ${brief(programErrors(P.gzclpT1Program.def, r))}`)
  const early = publish([P.optMacro, ...P.PUBLISHED, ...ER.PUBLISHED])
  assert(brief(checkMacro(P.optMacro, early)).includes('futureRef@phases.0.program'), `phase: ${brief(checkMacro(P.optMacro, early))}`)
  eq(brief(checkMacro(P.optMacro, reg)), [], 'in publication order')
})

t('', 'obs 27: frequency counts are literal positive integers', () => {
  for (const n of [0, 2.5, -1]) {
    const p = clone(P.legsFrequency.def)
    const f = p.frequency.find((x) => x.k === 'atLeast')!
    if (f.k === 'atLeast') f.n = n
    assert(brief(programErrors(p)).some((x) => x.startsWith('boundNotLiteral@frequency.')), `atLeast ${n}: ${brief(programErrors(p))}`)
  }
  const p = clone(P.legsFrequency.def)
  p.frequency.push({ k: 'atMost', n: 0, of: { s: 'any' }, withinDays: 7 })
  assert(brief(programErrors(p)).includes(`boundNotLiteral@frequency.${p.frequency.length - 1}.n`), `atMost 0: ${brief(programErrors(p))}`)
})

t('', 'obs 29: a handler key that is not an event is unknownName', () => {
  const s = clone(ER.c25k.def) as SchemeDef
  ;(s.on as Record<string, Term>)['bogus'] = s.on.session!
  assert(brief(checkScheme(s, reg)).includes('unknownName@on.bogus'), `slot: ${brief(checkScheme(s, reg))}`)
  const p = clone(P.rpMeso.def)
  ;(p.aggregate!.on as Record<string, Term>)['blockEnd'] = p.aggregate!.on.weekEnd!
  assert(brief(programErrors(p)).includes('unknownName@aggregate.on.blockEnd'), `aggregate: ${brief(programErrors(p))}`)
})

t('', 'obs 30: a program-scope peer read of the previous phase resolves nothing (only a macro handoff has one)', () => {
  const p = clone(P.fiveThreeOneBBB.def)
  p.slots['pressBbb']!.args['tm'] = { k: 'peer', slot: 'press', field: 'tm', of: 'prevPhase' }
  assert(brief(programErrors(p)).includes('unknownName@slots.pressBbb.args.tm'), `prevPhase: ${brief(programErrors(p))}`)
})

t('', 'obs 31: a non-empty list fits where a possibly-empty one is wanted, and not the reverse', () => {
  const agg = scope('aggregate')
  const into: Term = { k: 'tabulate', keys: { k: 'keys', of: 'slots' }, as: 'k' as never, body: q(0, 'set') }
  const among: Term = { k: 'list', items: [ref('slot', 'a'), ref('slot', 'b')], of: { t: 'ref', kind: 'slot' } }
  eq(brief(run({ k: 'allocate', n: q(2, 'set'), into, among, as: 's' as never, score: q(1, 'x'), cap: q(4, 'set'), max: 8 }, agg)), [], 'literal among')
  const wantNonEmpty: Ty = { t: 'list', of: ONE, nonEmpty: true }
  eq(codes(run({ k: 'range', n: 3 }, plan, { t: 'list', of: ONE, nonEmpty: false })), [], 'range where possibly-empty wanted')
  eq(codes(run({ k: 'list', items: [], of: ONE }, plan, wantNonEmpty)), ['unitMismatch'], 'empty where non-empty wanted')
})

done()
