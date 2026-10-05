/**
 * weekbasis.test.ts — the configurable weekly basis round (owner-directed):
 * the weekly aggregate read's `basis` and `roles` options. Modules are
 * imported as namespaces, as in semfix.test.ts, so a test that needs what the
 * pre-round oracle lacks fails alone; the fail-first run against
 * synthesis-semfix is ../weekly-basis-prefix.txt.
 * Run: tsx weekbasis.test.ts
 */
import type { Term, Ty } from './algebra'
import * as CK from './checker'
import * as DS from './describe'
import type { Head, TypeError, Value } from './engine'
import type { AggRead } from './evaluate'
import * as P from './programs'
import * as PO from './ports'
import * as TK from './testkit'
import { DIMS } from './units'

const { t, done } = TK.suite('weekbasis')
const assert: (ok: unknown, msg: string) => asserts ok = TK.assert
const { eq, near, reg, D0 } = TK
const RP = P.rpMeso.def
const chest = { k: 'muscle', id: 'chest' } as const
const codes = (es: readonly TypeError[]) => es.map((e) => `${e.code}@${e.path.join('.')}`)
const nOf = (v: Value): number => (v.v === 'q' ? v.n : NaN)

/** RP after `n` sessions as prescribed (two a week): its run and head. */
const rpAfter = (n: number) => TK.train(TK.start(RP), n, D0).run
/** The weekly read on that head, as the aggregate's handlers see it. */
const weekly = (head: Head, run: ReturnType<typeof rpAfter>, opts: Partial<Extract<AggRead, { q: 'weekly' }>> = {}): Value =>
  PO.aggPort(run.rt, head, { facts: TK.factsOf({}), today: D0, earlierToday: 0, reads: PO.newReads() })({ q: 'weekly', metric: 'sets', by: chest, ...opts })
const weekEndOf = (run: ReturnType<typeof rpAfter>, w: number) =>
  run.ledger.transitions.flatMap((tr) => tr.fired).find((f) => f.scope === 'program' && f.causeKey === `week:${RP.ref.id}:${w}`)

// ── the RP declaration: a deload weekEnd is a recorded keep ─────────────────

t('', 'RP declares its volume read (closing, accumulation weeks only): the deload weekEnd records a keep, the accumulation weekEnds still allocate', () => {
  const run = rpAfter(10)
  eq(RP.calendar.weeks[4], 'deload', 'block week 4 is the deload')
  const last = weekEndOf(run, 4)
  assert(last, 'the deload weekEnd ran the muscle plan')
  eq(last.skipped, undefined, 'it ran: the week was trained')
  eq(Object.keys(last.patch), [], 'keep: no target and no extra sets out of a deload week')
  assert(last.reason, 'the keep has a trace (the read was absent)')
  const first = weekEndOf(run, 0)
  eq(first?.patch['extra']?.mode, 'propose', 'week 0 still proposes its allocation')
  eq(P.RP_VOLUME_READ, { basis: 'closing', roles: ['accumulation'] }, 'the declared choice')
})

// ── roles: a filtered week is absence, never a zero ─────────────────────────

t('', 'roles: on a week whose role is not listed the read is absent (roleExcluded), where the default read sees the deload’s shrunken numbers', () => {
  const run = rpAfter(8)
  eq(run.ledger.head.progress.week, 4, 'pre-state of the deload week')
  const all = weekly(run.ledger.head, run)
  assert(all.v === 'q' && all.n > 0, `the default read measures the deload week: ${JSON.stringify(all)}`)
  eq(weekly(run.ledger.head, run, { roles: ['accumulation'] }), { v: 'none', cause: { k: 'roleExcluded', role: 'deload' } }, 'absent, with the role as its cause')
  eq(weekly(run.ledger.head, run, { roles: ['accumulation', 'deload'] }), all, 'a listed role reads as the default does')
})

t('', 'roles: on a listed week the filtered read equals the default one', () => {
  const run = rpAfter(6)
  eq(run.ledger.head.progress.week, 3, 'an accumulation week')
  eq(weekly(run.ledger.head, run, { roles: ['accumulation'] }), weekly(run.ledger.head, run), 'same value')
})

// ── basis: the coming week's plan ───────────────────────────────────────────

t('', 'upcoming, an ordinary week: the read measures next week’s plan through the same pipeline (the deload policy halves it)', () => {
  const wk3 = rpAfter(6)
  const wk4 = rpAfter(8)
  const closing3 = nOf(weekly(wk3.ledger.head, wk3))
  const upcoming3 = nOf(weekly(wk3.ledger.head, wk3, { basis: 'upcoming' }))
  near(upcoming3, nOf(weekly(wk4.ledger.head, wk4)), 'what week 4 closing measures (its extras were proposed, never accepted, so state is unchanged)')
  assert(upcoming3 < closing3, `the deload plans fewer sets: ${upcoming3} vs ${closing3}`)
  const wk1 = rpAfter(2)
  near(nOf(weekly(TK.start(RP).ledger.head, TK.start(RP), { basis: 'upcoming' })), nOf(weekly(wk1.ledger.head, wk1)), 'week 0 upcoming is week 1 closing')
})

t('', 'upcoming, the final week of a once calendar: typed absence (noUpcomingWeek); with roles, the coming week’s role is the gate', () => {
  const wk4 = rpAfter(8)
  eq(weekly(wk4.ledger.head, wk4, { basis: 'upcoming' }), { v: 'none', cause: { k: 'noUpcomingWeek' } }, 'no week after the last')
  const wk3 = rpAfter(6)
  eq(weekly(wk3.ledger.head, wk3, { basis: 'upcoming', roles: ['accumulation'] }), { v: 'none', cause: { k: 'roleExcluded', role: 'deload' } }, 'the coming week is the deload')
})

// ── the checker ─────────────────────────────────────────────────────────────

const agg = (opts: Record<string, unknown>): Term => ({ k: 'agg', q: { q: 'weekly', metric: 'sets', by: { k: 'muscle', of: { k: 'lit', lit: { k: 'ref', kind: 'muscle', id: 'chest' } } }, ...opts } as never })
const SETS: Ty = { t: 'q', dim: DIMS.sets }
const check = (term: Term, position: 'aggregate' | 'plan' = 'aggregate') => {
  const out: TypeError[] = []
  const r = CK.top(term, CK.baseScope(reg, position, {}, { id: 'demo/weekbasis', seq: reg.seq.size }), [], null, out)
  return { ty: r?.ty ?? null, errors: codes(out) }
}

t('', 'the checker: a non-default option makes the read Opt; defaults (omitted or explicit) stay plain', () => {
  eq(check(agg({})).ty, SETS, 'default')
  eq(check(agg({ basis: 'closing', roles: 'all' })).ty, SETS, 'explicit defaults')
  eq(check(agg({ roles: ['accumulation'] })).ty, { t: 'opt', of: SETS }, 'roles list')
  eq(check(agg({ basis: 'upcoming' })).ty, { t: 'opt', of: SETS }, 'upcoming')
  const out: TypeError[] = []
  CK.top({ k: 'arith', op: '-', a: { k: 'lit', lit: { k: 'q', v: 10, unit: 'set' } }, b: agg({ roles: ['accumulation'] }) }, CK.baseScope(reg, 'aggregate', {}, { id: 'demo/weekbasis', seq: reg.seq.size }), [], null, out)
  assert(codes(out).some((c) => c.startsWith('absenceUnhandled')), `arithmetic over a filtered read must handle absence: ${codes(out)}`)
})

t('', 'the checker: unknown role and basis names are unknownName at the option; an empty roles list is literalDomain; the capability is unchanged', () => {
  eq(check(agg({ roles: ['accumulation', 'delaod'] })).errors, ['unknownName@q.roles.1'], 'a misspelt role')
  eq(check(agg({ basis: 'next' })).errors, ['unknownName@q.basis'], 'an unknown basis')
  eq(check(agg({ roles: [] })).errors, ['literalDomain@q.roles'], 'no roles at all')
  assert(check(agg({ basis: 'upcoming' }), 'plan').errors.some((c) => c.startsWith('capabilityEscape')), 'still an aggregate-only read')
})

// ── the describer ───────────────────────────────────────────────────────────

t('', 'the describer states a declared choice and says nothing for the defaults', () => {
  const cx = DS.cxOf(reg)
  eq(DS.describe(agg({}), cx), 'The sets chest already gets each week.', 'default, unchanged')
  eq(DS.describe(agg({ basis: 'closing', roles: 'all' }), cx), 'The sets chest already gets each week.', 'explicit defaults, no clutter')
  eq(DS.describe(agg({ roles: ['accumulation'] }), cx), 'The sets chest is now planned to get in the week just closing, accumulation weeks only.', 'closing, filtered (honest: a re-plan under today’s state, not what the week got)')
  eq(DS.describe(agg({ basis: 'upcoming' }), cx), 'The sets chest is now planned to get in the coming week.', 'upcoming (honest: today’s values, no pending boundary bump)')
  assert(DS.describe(RP.aggregate!.on.weekEnd!, cx).includes('now planned to get in the week just closing, accumulation weeks only'), 'RP’s weekEnd prose states its declaration')
})

done()
