/**
 * semantics.test.ts — the formers, one class at a time: what each evaluates
 * to on the equivalence classes and boundary values of the test plan
 * (scratchpad/corpus/test-plan.md). Run: tsx semantics.test.ts
 */
import {
  add, allocate, allSlots, asReps, at, exercise, fn, foldOver, iff, is, kg, known, known2, knownThen, lb, le, list1, lvl, max, min, mul, muscle, named, none, nth, num,
  orElse, pct, range, rate, ratio, reps, rir, roundTo, rpe, sets, slotRef, sub, sumOver, table, tabulate, tag, ty, letv, ge, lt, mins, sec, type Expr, type Q,
} from './algebra'
import type { Term } from './algebra'
import type { Field, IssuedTarget, SessionValue, Value } from './engine'
import { ctxOf, evaluate, sameValue } from './evaluate'
import { sinkField, sinkSlot } from './issue'
import { runtimeOf } from './ports'
import * as P from './programs'
import { technique, capEffort, range as between, scaleMetric, scaleSets, session, set, setTempo, stripIntensifier, swapExercise, reshape, tempo as tempoE } from './structure'
import { applyXform } from './xform'
import { q as q4 } from './algebra'
import { D0, assert, day, eq, ev, factsOf, near, num as n, q, reg, suite } from './testkit'
import { factPort, newReads } from './ports'
import { fact } from './structure'
import { explain, valueText } from './describe-run'

const { t, done } = suite('semantics')
const cause = (v: Value) => (v.v === 'none' ? v.cause.k : 'present')
const T = (e: { term: Term }) => e.term
const sess = (e: { term: Term }): SessionValue => {
  const v = ev(e)
  assert(v.v === 'session', 'a session')
  return v.s
}

// ── 1.1 sorts and units ─────────────────────────────────────────────────────

t('EC-01 EC-19', 'kg + lb is one canonical sum that displays in the first operand’s unit', () => {
  const v = ev(add(kg(100), lb(5)))
  near(n(v), 102.26796185, 'canonical kg')
  eq(valueText(v, reg), '102.268 kg', 'display')
})
t('EC-03 BV-67 BV-68', 'kg per rep × reps is a mass (Juggernaut 13 → 7.5 kg, 10 → 0, 8 → 0)', () => {
  for (const [amrap, want] of [[13, 7.5], [10, 0], [8, 0]] as const) near(n(ev(P.juggernautBump({ amrap: reps(amrap), standard: reps(10), perRep: rate(2.5, 'kg', 'rep') }))), want, `AMRAP ${amrap}`)
})
t('EC-05 EC-10 BV-55 BV-56', 'inverse Epley: e1RM 120 at 5 reps RIR 1 is 100 kg; at 6 reps RIR 0 it is 102.857 kg (RIR 0 counts 0 reps)', () => {
  near(n(ev(P.loadFor({ e1rm: kg(120), reps: reps(5), rir: rir(1) }))), 100, 'RIR 1')
  near(n(ev(P.loadFor({ e1rm: kg(120), reps: reps(6), rir: rir(0) }))), 120 * 30 / 36, 'RIR 0')
  near(n(ev(asReps(rir(3)))), 3, 'asReps(3 RIR)')
})
t('EC-06', 'a ratio over zero is absent (zeroDenominator); there is no other division', () => eq(cause(ev(ratio(reps(5), reps(0)))), 'zeroDenominator', 'cause'))
t('EC-12 EC-14', 'comparison: quantities, ordinals of one scale, enum equality', () => {
  eq(ev(ge(kg(100), lb(220))), { v: 'bool', b: true }, '100 kg ≥ 220 lb')
  eq(ev(le(lvl('pain', 2), lvl('pain', 5))), { v: 'bool', b: true }, 'pain 2 ≤ 5')
  eq(ev(is(tag('weekRole', 'deload'), tag('weekRole', 'train'))), { v: 'bool', b: false }, 'deload ≠ train')
})
t('EC-17 BV-25 BV-76', 'round: nearest ties go DOWN (the one quantization law); down and up modes; the OPT handoff 101 kg × 115% lands on 115 kg', () => {
  near(n(ev(roundTo(kg(101.25), kg(2.5)))), 100, 'tie down')
  near(n(ev(roundTo(kg(101.2), kg(2.5), 'down'))), 100, 'down')
  near(n(ev(roundTo(kg(100.1), kg(2.5), 'up'))), 102.5, 'up')
  near(n(ev(roundTo(mul(kg(100), pct(115)), kg(2.5)))), 115, '100 kg handoff')
  near(n(ev(roundTo(mul(kg(101), pct(115)), kg(2.5)))), 115, '101 kg handoff (116.15 → 115)')
})
t('BV-23 BV-24', 'round with an evaluated step of 0 or below leaves its operand unrounded, and the trace says so', () => {
  const tr = evaluate(T(roundTo(kg(101), sub(kg(1), kg(1)))), ctxOf(reg))
  near(n(tr.value), 101, 'unrounded')
  assert(tr.note?.includes('not positive'), `note: ${tr.note}`)
  near(n(ev(roundTo(kg(101), sub(kg(1), kg(3))))), 101, 'negative step')
})
t('EC-20 BV-52 BV-53', 'RPE is input notation: rpe 10 is 0 in reserve, rpe 6.5 is 3.5, and it reads back as RPE', () => {
  near(n(ev(rpe(10))), 0, 'rpe 10')
  near(n(ev(rpe(6.5))), 3.5, 'rpe 6.5')
  eq(valueText(ev(rpe(8)), reg), 'RPE 8', 'reads back')
})
t('BV-54 EC-32', 'the sink: an effort below zero (rpe 11) is silent outOfDomain; a negative or non-finite load too; 0 kg is a legal load', () => {
  const s = (v: number, m: string) => sinkField({ k: 'fixed', v: { b: 'exact', v } }, m, {})
  eq(s(10 - 11, 'effort'), { k: 'silent', cause: { k: 'outOfDomain', field: 'effort', value: -1 } }, 'rpe 11')
  eq(s(-4.5, 'load').k, 'silent', 'negative load')
  eq(s(Infinity, 'reps').k, 'silent', 'infinite reps')
  eq(s(0, 'load'), { k: 'fixed', v: { b: 'exact', v: 0 } }, '0 kg')
})
t('BV-26 BV-27 EC-178', 'the sink quantizes to the nearest grid step, ties DOWN, in canonical units (a 5 lb grid lands on lb)', () => {
  const kgGrid = { load: 2.5 }
  eq(sinkField({ k: 'fixed', v: { b: 'exact', v: 101.25 } }, 'load', kgGrid), { k: 'fixed', v: { b: 'exact', v: 100 } }, '101.25 on 2.5 → 100 (tie down)')
  eq(sinkField({ k: 'fixed', v: { b: 'exact', v: 101.3 } }, 'load', kgGrid), { k: 'fixed', v: { b: 'exact', v: 102.5 } }, '101.3 → 102.5')
  const lbGrid = { load: n(q(5, 'lb')) }
  const f = sinkField({ k: 'fixed', v: { b: 'exact', v: 65 } }, 'load', lbGrid)
  assert(f.k === 'fixed' && f.v.b === 'exact', 'fixed')
  near(f.v.v / n(q(1, 'lb')), 145, '65 kg → 145 lb')
})
t('BV-25 BV-26', 'ONE quantization law: round(nearest) and the sink agree at every exact tie, and the pinned formulation decides the boundary', () => {
  const sink = (x: number, g: number) => {
    const f = sinkField({ k: 'fixed', v: { b: 'exact', v: x } }, 'load', { load: g })
    return f.k === 'fixed' && f.v.b === 'exact' ? f.v.v : NaN
  }
  const rnd = (x: number, g: number) => n(ev(roundTo(kg(x), kg(g))))
  eq([rnd(101.25, 2.5), sink(101.25, 2.5)], [100, 100], '101.25 on a 2.5 grid: both 100')
  eq(n(ev(roundTo(reps(7.5), reps(1)))), 7, 'a half-rep tie rounds down: 7.5 reps → 7')
  eq(n(ev(roundTo(reps(8.5), reps(1)))), 8, '8.5 reps → 8')
  eq(rnd(-101.25, 2.5), -102.5, 'ties go toward −∞ for a negative operand')
  const lbTie = n(q(102.5, 'lb'))
  near(sink(lbTie, n(q(5, 'lb'))) / n(q(1, 'lb')), 100, 'a lb tie in canonical kg: 102.5 lb on a 5 lb grid → 100 lb')
  const off = (b: number) => 2.5 * (40.5 + b)
  eq([rnd(off(3e-10), 2.5), sink(off(3e-10), 2.5)], [100, 100], 'within half a billionth of a step of the half: a tie, down')
  eq([rnd(off(8e-10), 2.5), sink(off(8e-10), 2.5)], [102.5, 102.5], 'past half a billionth: nearest, up')
  eq([rnd(off(-8e-10), 2.5), sink(off(-8e-10), 2.5)], [100, 100], 'just below the half: nearest, down')
})
t('BV-28', 'APRE: a top set of 20 lb for 2 reps adjusts by −10 lb, ×90% = 9 lb; on a heavier miss the load can go to 0 or below and is then silent', () => {
  const adj = (r: number) => n(ev(P.apreAdjust({ reps: reps(r), small: lb(5), big: lb(10) })))
  near((n(q(20, 'lb')) + adj(2)) * 0.9 / n(q(1, 'lb')), 9, '9 lb')
  eq(sinkField({ k: 'fixed', v: { b: 'exact', v: (n(q(5, 'lb')) + adj(2)) * 0.9 } }, 'load', {}).k, 'silent', '5 lb − 10 lb is out of domain')
})

// ── 1.2 absence ─────────────────────────────────────────────────────────────

const factCx = (m: Record<string, Value>, today = D0, on = D0) => ctxOf(reg, { ports: { fact: factPort(reg, factsOf(m, on), today, newReads()) } })
t('EC-21 EC-22 EC-26 EC-27', 'known runs its body on a present value; an absent one carries its cause through; orElse falls back to a value or to another option', () => {
  const e1 = fact('e1rm', exercise('wger:111'))
  near(n(evaluate(T(orElse(known(e1, (x) => mul(x, pct(90))), kg(0))), factCx({ e1rm: q(100, 'kg') })).value), 90, 'present')
  eq(cause(evaluate(T(known(e1, (x) => mul(x, pct(90)))), factCx({})).value), 'factUnknown', 'absent: the fact is named')
  near(n(evaluate(T(orElse(known(e1, (x) => mul(x, pct(90))), kg(0))), factCx({})).value), 0, 'fallback value')
  eq(cause(evaluate(T(orElse(e1, none(ty.q('mass')))), factCx({})).value), 'declaredNone', 'fallback option')
})
t('EC-25', 'known2 with one side absent is absent with THAT side’s cause; with both absent, the first operand’s', () => {
  const a = fact('e1rm', exercise('wger:111'))
  const b = ratio(reps(1), reps(0))
  eq(cause(evaluate(T(known2(a, b, (x) => x)), factCx({ e1rm: q(100, 'kg') })).value), 'zeroDenominator', 'second absent')
  eq(cause(evaluate(T(known2(a, b, (x) => x)), factCx({})).value), 'factUnknown', 'both absent: the first')
})
t('L7 EC-22', 'a stale fact is silence (factStale), never the last known value', () => {
  const v = evaluate(T(fact('e1rm', exercise('wger:111'))), factCx({ e1rm: q(100, 'kg') }, day('2026-12-31'), D0)).value
  assert(v.v === 'none' && v.cause.k === 'factStale' && v.cause.maxAgeDays === 56, JSON.stringify(v))
})

// ── 1.3 control and naming ──────────────────────────────────────────────────

t('EC-34 EC-35 EC-38', 'let and named are the identity on their value; match picks the declared tag’s arm', () => {
  near(n(ev(letv('half', mul(kg(100), pct(50)), (h) => add(h, kg(1))))), 51, 'let')
  near(n(ev(named('the bump', add(kg(1), kg(2))))), 3, 'named')
  eq(evaluate(T(P.GZ_T1.tag('6x2')), ctxOf(reg)).value, { v: 'enum', name: 'gzT1', tag: '6x2' }, 'a declared tag evaluates')
})

// ── 1.4 finite collections ──────────────────────────────────────────────────

const ladder = list1(ty.q('one'), num(10), num(20), num(30))
t('EC-45 BV-38 BV-39', 'nth: hold stops at the last element; cycle wraps; position len−1 is the last', () => {
  near(n(ev(nth(ladder, num(2), 'hold'))), 30, 'len−1')
  near(n(ev(nth(ladder, num(3), 'hold'))), 30, 'len, hold')
  near(n(ev(nth(ladder, num(3), 'cycle'))), 10, 'len, cycle')
})
t('BV-40', 'nth with an EVALUATED negative or fractional index: floored; hold clamps to 0, cycle takes the true modulus (−1 → last)', () => {
  near(n(ev(nth(ladder, sub(num(0), num(1)), 'hold'))), 10, '−1 hold')
  near(n(ev(nth(ladder, sub(num(0), num(1)), 'cycle'))), 30, '−1 cycle')
  near(n(ev(nth(ladder, add(num(1), pct(50)), 'hold'))), 20, '1.5 floors to 1')
})
t('EC-46 EC-55 EC-56', 'fold, sum and count over finite lists; an empty sum is 0', () => {
  near(n(ev(foldOver(ladder, num(0), (acc, x) => add(acc, x)))), 60, 'fold')
  near(n(ev(sumOver(ladder, (x) => mul(x, num(2))))), 120, 'sum')
  near(n(ev(sumOver(tabulate(range(1), () => num(1)) as never as Expr<never>, () => num(0)))), 0, 'sum of zeros')
})
const prog = (def = P.rpMeso.def) => runtimeOf(reg, def, { id: 'x', anchor: D0, activatedOn: D0 })
const keysCx = () => ctxOf(reg, { ports: { keys: (of) => (of === 'slots' ? Object.keys(prog().def.slots) : prog().def.muscles).map((id) => ({ v: 'ref', kind: of === 'slots' ? 'slot' : 'muscle', id })) } })
t('EC-49 EC-51 EC-54', 'tabulate over the program’s slots (declaration order) is a map; at reads a key, absent on a missing one', () => {
  const m = evaluate(T(tabulate(allSlots, () => sets(1))), keysCx()).value
  assert(m.v === 'map', 'a map')
  eq(m.entries.map(([k]) => k), ['flatDb', 'inclineDb', 'cableFlyA', 'cableFlyB', 'row', 'pulldown'], 'declaration order')
  near(n(evaluate(T(orElse(at(tabulate(allSlots, () => sets(2)), slotRef('row')), sets(0))), keysCx()).value), 2, 'present key')
  eq(cause(evaluate(T(at(tabulate(allSlots, () => sets(2)), slotRef('nope'))), keysCx()).value), 'missingKey', 'missing key')
})
t('EC-57', 'pick: the best score wins, ties keep declaration order, an empty filter is absent (emptyPick)', () => {
  const pk = (mode: 'max' | 'min', where: Term | null): Term => ({ k: 'pick', mode, xs: T(ladder), as: 'x' as never, where, score: { k: 'lit', lit: { k: 'q', v: 1, unit: 'x' } } })
  near(n(ev(pk('max', null))), 10, 'tie keeps the first')
  const none_ = ev({ ...pk('max', { k: 'lit', lit: { k: 'bool', v: false } }) } as Term)
  eq(cause(none_), 'emptyPick', 'filtered out')
})

// ── 1.5 allocation ──────────────────────────────────────────────────────────

const alloc = (nUnits: Expr<Q<'sets'>>, scores: Record<string, number>, caps: Record<string, number>, maxU: number, into: Record<string, number> = {}) => {
  const slots = Object.keys(scores)
  const cx = ctxOf(reg, { ports: { keys: () => slots.map((id) => ({ v: 'ref', kind: 'slot', id })) } })
  const intoT = tabulate(allSlots, (s) => (Object.keys(into).length ? table(s, Object.fromEntries(Object.entries(into).map(([k, v]) => [k, sets(v)])), sets(0)) : sets(0)))
  const tr = evaluate(
    T(allocate({ n: nUnits, into: intoT, among: allSlots, score: (s) => table(s, Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, num(v)])), num(0)), cap: (s) => table(s, Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, sets(v)])), sets(0)), max: maxU })),
    cx,
  )
  const v = tr.value
  assert(v.v === 'map', 'a map')
  return { given: Object.fromEntries(v.entries.map(([k, x]) => [k, n(x) - (into[k] ?? 0)])), note: tr.note ?? '' }
}
t('EC-63', 'allocate: each unit goes to the best-scored candidate still under its cap', () => eq(alloc(sets(5), { a: 3, b: 1 }, { a: 3, b: 4 }, 8).given, { a: 3, b: 2 }, 'a fills to its cap, then b'))
t('EC-64 EC-65 BV-16', 'allocate: no candidates, or every one at its cap, drops every unit and says so', () => {
  const r = alloc(sets(3), { a: 1 }, { a: 0 }, 8)
  eq(r.given, { a: 0 }, 'nothing placed')
  assert(r.note.includes('3 could not be placed'), r.note)
})
t('EC-66 BV-17', 'allocate: a score tie goes to the first candidate in declaration order', () => eq(alloc(sets(1), { a: 3, b: 3 }, { a: 4, b: 4 }, 8).given, { a: 1, b: 0 }, 'tie'))
t('EC-67 BV-08 BV-09', 'allocate: at most `max` units; the rest are reported as over the bound', () => {
  const r = alloc(sets(3), { a: 1 }, { a: 9 }, 1)
  eq(r.given, { a: 1 }, 'max 1')
  assert(r.note.includes('2 over the bound of 1'), r.note)
  eq(alloc(sets(8), { a: 1 }, { a: 9 }, 8).given, { a: 8 }, 'n = max')
  assert(alloc(sets(9), { a: 1 }, { a: 9 }, 8).note.includes('1 over the bound'), 'n = max + 1')
})
t('EC-69', 'allocate: a candidate missing from `into` starts at 0 (into is a total accumulator)', () => eq(alloc(sets(2), { a: 1 }, { a: 4 }, 8, {}).given, { a: 2 }, 'missing → 0'))
t('EC-70 BV-18', 'allocate: a negative score still ranks (a score orders, a cap gates), so a lone −9 candidate is still given sets', () => eq(alloc(sets(2), { a: -9 }, { a: 4 }, 8).given, { a: 2 }, '−9 eligible'))
t('EC-71 BV-14', 'allocate: n is floored; the fraction is dropped and reported', () => {
  const r = alloc(add(sets(1), mul(sets(1), pct(50))), { a: 1 }, { a: 4 }, 8)
  eq(r.given, { a: 1 }, '1.5 → 1')
  assert(r.note.includes('fraction of 0.5'), r.note)
})
t('BV-11 BV-12 BV-13', 'allocate: n 0 or negative places nothing and removes nothing; the RP gap max(0, gap) of −3 is 0', () => {
  eq(alloc(sets(0), { a: 1 }, { a: 4 }, 8, { a: 2 }).given, { a: 0 }, 'n 0')
  eq(alloc(sub(sets(0), sets(3)), { a: 1 }, { a: 4 }, 8, { a: 2 }).given, { a: 0 }, 'n −3')
  eq(alloc(max(sets(0), sub(sets(0), sets(3))), { a: 1 }, { a: 4 }, 8, { a: 2 }).given, { a: 0 }, 'clamped')
})
t('BV-15', 'allocate: a candidate at cap − 1 takes one more; at the cap it takes none', () => {
  eq(alloc(sets(2), { a: 2, b: 1 }, { a: 1, b: 4 }, 8).given, { a: 1, b: 1 }, 'cap 1')
})

// ── 1.6 tables ──────────────────────────────────────────────────────────────

t('EC-73 EC-74 BV-69', 'APRE thresholds are inclusive upper bounds: 0,2→−big; 3,4→−small; 5,7→0; 8,12→+small; 13→+big', () => {
  const adj = (r: number) => n(ev(P.apreAdjust({ reps: reps(r), small: lb(5), big: lb(10) }))) / n(q(1, 'lb'))
  eq([0, 2, 3, 4, 5, 7, 8, 12, 13].map((r) => Math.round(adj(r))), [-10, -10, -5, -5, 0, 0, 5, 5, 10], 'chart')
})
t('EC-77 BV-59 BV-60', 'ordinal tables: RP set delta soreness 0 × pump 0–3 is 2/2/1/1; soreness 1 pump 3 is 0; soreness 2 or 3 is 0', () => {
  const d = (so: 0 | 1 | 2 | 3, pu: 0 | 1 | 2 | 3) => n(ev(P.rpSetDelta({ soreness: lvl('soreness', so), pump: lvl('pump', pu) })))
  eq([0, 1, 2, 3].map((pu) => d(0, pu as 0)), [2, 2, 1, 1], 'soreness 0')
  eq([d(1, 3), d(2, 0), d(3, 3)], [0, 0, 0], 'the rest')
})
t('EC-157 BV-34', 'positional tables on the progress clock: hold stays on the last row, cycle wraps (trainWeek 3 on a 3-row wave is row 0)', () => {
  const pos = (w: number) => ctxOf(reg, { ports: { pos: () => q(w, 'wk') } })
  const wave = (o: 'hold' | 'cycle'): Term => ({ k: 'table', key: { k: 'pos', field: 'trainWeek' }, rows: [65, 70, 75].map((x) => ({ when: null, then: T(pct(x)) })), otherwise: null, overflow: o })
  near(n(evaluate(wave('cycle'), pos(3)).value), 0.65, 'cycle')
  near(n(evaluate(wave('hold'), pos(3)).value), 0.75, 'hold')
})
t('BV-19 BV-20 BV-21 BV-22', 'clamps compose in order (no clamp former): lo = hi gives lo; lo > hi gives hi; RP caps at MRV, even downward', () => {
  near(n(ev(min(max(sets(9), sets(5)), sets(5)))), 5, 'lo = hi')
  near(n(ev(min(max(sets(4), sets(5)), sets(3)))), 3, 'lo > hi')
  near(n(ev(P.rpWeeklyTarget({ now: sets(21), soreness: lvl('soreness', 0), pump: lvl('pump', 0), mrv: sets(22) } as never))), 22, 'capped')
  near(n(ev(P.rpWeeklyTarget({ now: sets(25), soreness: lvl('soreness', 3), pump: lvl('pump', 0), mrv: sets(22) } as never))), 22, 'the min REDUCES an owner-raised 25')
})

// ── 1.9 domain formers and the transformers ─────────────────────────────────

const bench = (load: number, nSets = 4) => session({ exercise: exercise('wger:192'), steps: (b) => void b.step('w', sets(nSets), set({ target: { reps: reps(8), load: kg(load) } })) })
const loadIn = (s: SessionValue, i = 0) => {
  const f = s.steps[0]!.sets[i]!.metrics['load']
  return f?.k === 'fixed' && f.v.b === 'exact' ? f.v.v : NaN
}
t('EC-116 BV-48 BV-49 BV-50', 'scaleSets rounds down and never below 1 (1 × 50% = 1, 5 × 60% = 3, 3 × 50% = 1); an empty line stays empty', () => {
  const c = (k: number, f: number) => (sess(scaleSets(bench(100, k), pct(f))).steps[0]!.count as { n: number }).n
  eq([c(1, 50), c(5, 60), c(3, 50)], [1, 3, 1], 'counts')
  eq(applyXform('scaleSets', { exercise: { v: 'ref', kind: 'exercise', id: 'wger:192' }, steps: [{ ...sess(bench(100, 1)).steps[0]!, count: { k: 'n', n: 0 }, sets: [] }], intensifier: null }, q(50, 'pct'), null, null).steps[0]!.count, { k: 'n', n: 0 }, 'empty stays empty')
})
t('BV-51', 'capEffort: an absent effort becomes the floor; 1 rises to 4; 5 stays 5', () => {
  const withEffort = (e: number | null) =>
    e === null
      ? session({ exercise: exercise('wger:192'), steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(8) } })) })
      : session({ exercise: exercise('wger:192'), steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(8), effort: rir(e) } })) })
  const eff = (e: number | null) => (sess(capEffort(withEffort(e), rir(4))).steps[0]!.sets[0]!.metrics['effort'] as Extract<Field, { k: 'fixed' }>).v
  eq([eff(null), eff(1), eff(5)], [{ b: 'exact', v: 4 }, { b: 'exact', v: 4 }, { b: 'exact', v: 5 }], 'floors')
})
t('EC-116 EC-119', 'every transformer: scaleMetric, setTempo, reshape, stripIntensifier, swapExercise, addSets', () => {
  near(loadIn(sess(scaleMetric(bench(100), 'load', pct(90)))), 90, 'scaleMetric')
  eq(sess(setTempo(bench(100), tempoE(3, 1, 1, 0))).steps[0]!.sets[0]!.tempo, [3, 1, 1, 0], 'setTempo')
  eq(sess(reshape(bench(100), set({ target: { reps: between(reps(1), reps(5)) } }))).steps[0]!.sets[0]!.metrics['reps'], { k: 'fixed', v: { b: 'range', min: 1, max: 5 } }, 'reshape')
  const rp = session({ exercise: exercise('wger:97'), intensifier: technique('rest-pause', set({ target: { reps: reps(3) } })), steps: (b) => void b.step('w', sets(2), set({ target: { reps: reps(8) } })) })
  assert(sess(rp).intensifier !== null, 'has an intensifier')
  eq(sess(stripIntensifier(rp)).intensifier, null, 'strip')
  eq(sess(swapExercise(bench(100), exercise('wger:97'))).exercise, { v: 'ref', kind: 'exercise', id: 'wger:97' }, 'swap')
  eq(applyXform('addSets', sess(bench(100, 3)), q(2, 'set'), null, null).steps[0]!.count, { k: 'n', n: 5 }, 'addSets')
})
t('EC-118', 'a transformer over a silent field leaves it silent with its cause', () => {
  const silent: Field = { k: 'silent', cause: { k: 'factUnknown', fact: 'e1rm', key: 'wger:192' } }
  const s0 = sess(bench(100))
  const s: SessionValue = { ...s0, steps: [{ ...s0.steps[0]!, sets: s0.steps[0]!.sets.map((x) => ({ ...x, metrics: { ...x.metrics, load: silent } })) }] }
  eq(applyXform('scaleMetric', s, q(90, 'pct'), 'load', null).steps[0]!.sets[0]!.metrics['load'], silent, 'silent stays silent')
})
t('EC-31 EC-179', 'a silent exercise issues the slot with its steps and the cause, never a default exercise', () => {
  const s0 = sess(bench(100))
  const sl = sinkSlot(prog(P.linear3x5.def), 'squat', { ...s0, exercise: { v: 'none', cause: { k: 'factUnknown', fact: 'e1rm', key: null } } }, {}, { node: { k: 'lit', lit: { k: 'bool', v: true } }, value: { v: 'bool', b: true }, kids: [] })
  assert('silent' in sl.exercise && sl.steps.length === 1, JSON.stringify(sl.exercise))
})
t('EC-101 EC-103', 'bounds issue as fields of their kind: exact, range, atLeast (AMRAP), a timed duration, an open distance', () => {
  const s = sess(session({ exercise: exercise('run'), steps: (b) => void b.step('r', sets(1), set({ target: { duration: mins(20), distance: { b: 'open' } as never } })) }))
  eq(s.steps[0]!.sets[0]!.metrics, { duration: { k: 'fixed', v: { b: 'exact', v: 1200 } }, distance: { k: 'fixed', v: { b: 'open' } } }, 'timed + open')
})

t('EC-115 D11', 'every technique kind is one intensifier on the final set: its stages are sets, and each kind has prose', () => {
  for (const kind of ['drop-set', 'rest-pause', 'myo-reps'] as const) {
    const s = sess(session({ exercise: exercise('wger:97'), intensifier: technique(kind, set({ target: { reps: reps(4) } }), set({ target: { reps: reps(3) } })), steps: (b) => void b.step('w', sets(2), set({ target: { reps: reps(8) } })) }))
    eq([s.intensifier?.kind, s.intensifier?.stages.length], [kind, 2], kind)
    assert(valueText({ v: 'technique', t: s.intensifier! }, reg).includes(kind), 'prose')
  }
})

t('R2-carried', 'pace × distance is a duration and reads in minutes (4:45 per km over 5 km is 23:45 min), not 1425 s', () => {
  eq(valueText(ev(mul(q4(4.75, 'minPerKm'), q4(5, 'km'))), reg), '23:45 min', 'derived duration')
  eq(valueText(ev(mul(q4(4.75, 'minPerKm'), q4(100, 'm'))), reg), '28.5 s', 'under a minute stays in seconds')
})

// ── traces ──────────────────────────────────────────────────────────────────

t('EC-205 D3', 'explain cuts at a library call: the filled template, then the working', () => {
  const tr = evaluate(T(P.juggernautBump({ amrap: reps(13), standard: reps(10), perRep: rate(2.5, 'kg', 'rep') })), ctxOf(reg))
  eq(explain(tr, reg), '7.5 kg: 2.5 kg per rep for every rep past 10 reps on the AMRAP set (13 reps); worked: 7.5 kg (2.5 kg per rep × 3 reps (max(0 reps, 3 reps (13 reps − 10 reps))))', 'trace')
})
t('L2', 'evaluate is a pure function of (term, context): two runs give identical traces', () => {
  const x = evaluate(T(P.loadFor({ e1rm: kg(120), reps: reps(5), rir: rir(1) })), ctxOf(reg))
  const y = evaluate(T(P.loadFor({ e1rm: kg(120), reps: reps(5), rir: rir(1) })), ctxOf(reg))
  assert(sameValue(x.value, y.value) && JSON.stringify(x) === JSON.stringify(y), 'identical')
})

void lt
void sec
void iff
void fn
void muscle
done()
