/**
 * coverage.test.ts — calls that exist to mint handoff fixtures for IR branches
 * and formers no other suite reaches (README "Schema coverage"), so the second
 * implementation has no unproven arm. Each test still asserts the oracle's
 * answer. Everything runs over corpus definitions; the one program edit
 * (amrapFor, a pattern rotation, a days period, a day selector) is the
 * smallest change of a corpus program that reaches those branches.
 * Run: tsx coverage.test.ts
 */
import type { Term, Ty } from './algebra'
import { checkProgram } from './checkdefs'
import { describe, cxOf } from './describe'
import { describeProgram, describeSlot } from './describe-defs'
import type { Value } from './engine'
import { ctxOf, evaluate, type EventRead } from './evaluate'
import * as ER from './endurance-rehab'
import * as P from './programs'
import { ingest } from './step'
import type { CalQuery } from './time'
import { assert, D0, day, eq, issue, num, q, reg, start, suite, asPrescribed, close, closeOf } from './testkit'

const { t, done } = suite('coverage')
const clone = <X>(x: X): X => structuredClone(x)
const ONE: Ty = { t: 'q', dim: {} }
const lit = (v: number, unit: string): Term => ({ k: 'lit', lit: { k: 'q', v, unit: unit as never } })
const v = (name: string): Term => ({ k: 'var', name: name as never })
const cmp = (op: '<' | '>' | '==' | '>=', a: Term, b: Term): Term => ({ k: 'cmp', op, a, b })
const calQ = (c: Value): Value => ({ ...c, clock: 'calendar' } as Value)
/** Evaluate with the given ports; the trace's node kinds, depth first. */
const kinds = (x: { node: Term; kids: unknown[] }): string[] => [x.node.k, ...x.kids.flatMap((k) => kinds(k as typeof x))]

t('', 'count, logic and not, evaluated: how many of 1, 2, 3 are above 1 and not 3 (one)', () => {
  const xs: Term = { k: 'list', items: [lit(1, 'x'), lit(2, 'x'), lit(3, 'x')], of: ONE }
  const where: Term = { k: 'logic', op: 'and', a: cmp('>', v('x'), lit(1, 'x')), b: { k: 'not', a: cmp('==', v('x'), lit(3, 'x')) } }
  const tr = evaluate({ k: 'count', xs, as: 'x' as never, where }, ctxOf(reg))
  eq(num(tr.value), 1, 'count')
  const or = evaluate({ k: 'logic', op: 'or', a: { k: 'lit', lit: { k: 'bool', v: false } }, b: { k: 'not', a: { k: 'lit', lit: { k: 'bool', v: false } } } }, ctxOf(reg))
  eq(or.value, { v: 'bool', b: true }, 'or')
  for (const k of ['count', 'logic', 'not']) assert(kinds(tr as never).includes(k), `${k} in the trace`)
})

t('', 'some, evaluated: some(5 kg) orElse 0 kg is 5 kg, and known over it binds the value', () => {
  const s: Term = { k: 'some', a: lit(5, 'kg') }
  eq(num(evaluate({ k: 'orElse', a: s, b: lit(0, 'kg') }, ctxOf(reg)).value), 5, 'orElse')
  const tr = evaluate({ k: 'known', a: s, as: 'w' as never, then: false, body: { k: 'arith', op: '*', a: v('w'), b: lit(2, 'x') } }, ctxOf(reg))
  assert(kinds(tr as never).includes('some'), 'some in the trace')
})

t('', 'cal, every query and measure, evaluated through the calendar port: earlierToday, gap of a day, recent sum and max', () => {
  const answers = (cq: CalQuery): Value => {
    if (cq.q === 'earlierToday') return calQ(q(1, 'x'))
    if (cq.q === 'gap') return cq.of.s === 'day' && cq.of.day === 'A' ? calQ(q(3, 'd')) : { v: 'none', cause: { k: 'declaredNone' } }
    if (cq.q === 'recent' && cq.measure.m === 'sum') return calQ(q(42, 'km'))
    if (cq.q === 'recent' && cq.measure.m === 'max') return calQ(q(160, 'bpm'))
    return calQ(q(0, 'd'))
  }
  const cx = ctxOf(reg, { ports: { cal: answers } })
  eq(evaluate(cmp('>', { k: 'cal', q: { q: 'earlierToday' } }, lit(0, 'x')), cx).value, { v: 'bool', b: true }, 'a second session today')
  const gap: Term = { k: 'orElse', a: { k: 'cal', q: { q: 'gap', of: { s: 'day', day: 'A' } } }, b: lit(99, 'd') }
  eq(evaluate(cmp('>=', gap, lit(3, 'd')), cx).value, { v: 'bool', b: true }, 'three days since Day A')
  const sum: Term = { k: 'cal', q: { q: 'recent', of: { s: 'tag', tag: 'run' }, days: 7, measure: { m: 'sum', metric: 'distance' } } }
  eq(evaluate(cmp('>', sum, lit(40, 'km')), cx).value, { v: 'bool', b: true }, 'weekly distance')
  const max: Term = { k: 'orElse', a: { k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 14, measure: { m: 'max', metric: 'hr' } } }, b: lit(0, 'bpm') }
  const tr = evaluate(cmp('<', max, lit(170, 'bpm')), cx)
  eq(tr.value, { v: 'bool', b: true }, 'peak heart rate')
  assert(kinds(tr as never).includes('cal'), 'cal in the trace')
})

t('', 'event reads e1rm, trained and groupScore, evaluated through the event port', () => {
  const answers = (e: EventRead): Value =>
    e.q === 'e1rm' ? q(142.5, 'kg') : e.q === 'trained' ? { v: 'bool', b: e.muscle === 'chest' } : e.q === 'groupScore' ? q(7, 'x') : { v: 'none', cause: { k: 'declaredNone' } }
  const cx = ctxOf(reg, { ports: { event: answers } })
  eq(num(evaluate({ k: 'orElse', a: { k: 'event', q: { q: 'e1rm', step: 'top' as never } }, b: lit(0, 'kg') }, cx).value), 142.5, 'e1rm')
  eq(evaluate({ k: 'event', q: { q: 'trained', muscle: { k: 'lit', lit: { k: 'ref', kind: 'muscle', id: 'chest' } } } }, cx).value, { v: 'bool', b: true }, 'trained chest')
  eq(num(evaluate({ k: 'orElse', a: { k: 'event', q: { q: 'groupScore', score: 'rounds' } }, b: lit(0, 'x') }, cx).value), 7, 'rounds')
})

/** OPT stabilization with its circuit as an AMRAP, a 3-day pattern rotation
 *  with a rest day, Day A at least twice per 5 days, and at most once a day. */
const amrapPattern = (() => {
  const p = clone(P.optStabilization.def)
  p.days = { A: [{ k: 'amrapFor', slots: ['pushStab', 'squatStab'], cap: { k: 'lit', lit: { k: 'q', v: 10, unit: 'min' } }, score: 'rounds' }] }
  p.rotation = { k: 'pattern', days: ['A', { rest: true }, 'A'] }
  p.frequency = [
    { k: 'atLeast', n: 2, of: { s: 'day', day: 'A' }, per: { k: 'days', n: 5 } },
    { k: 'atMost', n: 1, of: { s: 'any' }, withinDays: 1 },
  ]
  return p
})()

t('', 'an AMRAP group, a pattern rotation and a period of days: checked, activated, prescribed and closed', () => {
  eq(checkProgram(amrapPattern, reg).flatMap((r) => r.errors.map((e) => e.code)), [], 'accepted')
  let run = start(amrapPattern)
  const first = issue(run, D0)
  eq([first.issued.day, first.issued.slots.map((s) => s.slot)], ['A', ['pushStab', 'squatStab']], 'Day A, the AMRAP members in group order')
  run = close(first.run, first.issued, asPrescribed(first.issued), D0).run
  const second = issue(run, day('2026-10-07'))
  eq(second.issued.day, 'A', 'the rest entry is skipped: Day A again')
})

t('', 'instanceClosed: an abandoned instance refuses a skip and a session', () => {
  const run = start(ER.couchTo5k.def)
  const first = issue(run, D0)
  const abandoned = ingest(first.run.rt, first.run.ledger, { k: 'abandon', causeKey: 'abandon:a', on: D0 })
  eq(abandoned.result.k, 'applied', 'abandon applies')
  const closed = { k: 'refused', refusal: { code: 'instanceClosed', status: 'abandoned' } }
  eq(ingest(run.rt, abandoned.ledger, { k: 'skip', causeKey: 'skip:a', slot: 'run' }).result, closed as never, 'skip refused')
  eq(ingest(run.rt, abandoned.ledger, closeOf(first.issued, asPrescribed(first.issued), D0)).result, closed as never, 'session refused')
})

t('', 'prose at the mechanism zoom over corpus definitions: two programs, two slots, two library bodies', () => {
  const mech = cxOf(reg, { zoom: 'mechanism' })
  const intent = cxOf(reg)
  for (const p of [P.fiveThreeOneBBB.def, ER.couchTo5k.def]) assert(describeProgram(p, mech).length > 0, `${p.ref.id} described`)
  for (const s of [P.juggernautRealization.def, P.restPauseDc.def]) assert(describeSlot(s, {}, mech).length > 0, `${s.ref.id} described`)
  const libCx = (zoom: 'intent' | 'mechanism') => cxOf(reg, { zoom, lib: true })
  for (const f of [P.juggernautBump.def, P.rpWeeklyTarget.def]) {
    const m = describe(f.body, libCx('mechanism'))
    assert(m.length > 0 && m === describe(f.body, libCx('mechanism')), `${f.ref.id} mechanism`)
  }
  const handler = P.juggernautRealization.def.on.session!
  assert(describe(handler, mech) !== describe(handler, intent), 'mechanism expands what intent names')
})

done()
