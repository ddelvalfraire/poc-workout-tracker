/**
 * laws.test.ts — the runtime laws as properties over the worked corpus:
 * handlers and the outcome channel, the progress clock, the ledger, issuance
 * and resolution, projection and macros, and L1–L13. Run: tsx laws.test.ts
 */
import { exercise, kg, lb, none, num as numE, pct, reps, rir, sets, ty, type Term } from './algebra'
import { macro, phase } from './structure'
import type { Event, FactReading, Head, IssuedSession, Logged, Value } from './engine'
import { asPrescribedSet, ctxOf, evaluate, sameValue } from './evaluate'
import * as ER from './endurance-rehab'
import { publish } from './checkdefs'
import { currentView, resolveLive, setsDue } from './issue'
import { eventPort, verdictOf } from './judge'
import { aggPort, entriesPerWeek, newReads, nextDay, runtimeOf, sessionsPerWeek, trainWeekOf } from './ports'
import * as P from './programs'
import { exampleProgram, project, projectMacro } from './project'
import { activate, exportsOf, ingest, ledgerOf, prescribe, replay, step } from './step'
import type { ProgramDef } from './structure'
import { addDays, dayNum, reconcile, type LocalDay as LocalDayT } from './time'
import { nearestStep } from './units'
import {
  D0, E1RM, asPrescribed, assert, close, closeOf, corpusFacts, day, eq, factsOf, fieldOf, issue, loadOf, logWith, near, num, q, readings, reg, repsShort, start, stateOf, suite, train, type Run,
} from './testkit'

const { t, done } = suite('laws')
const F = corpusFacts()
const lin = () => start(P.linear3x5.def, {}, F)
const nOf = (v: Value) => (v.v === 'q' ? v.n : NaN)
const pendingFields = (r: Run) => Object.values(r.ledger.head.pending).flatMap((p) => Object.keys(p.fields).map((f) => `${p.scope}.${f}`))
const T = (e: { term: Term }) => e.term

// ── handlers, patches, proposals ────────────────────────────────────────────

t('EC-137 EC-126 BV-62 EC-209', 'a hit commits the bump; a miss commits the streak; the transition carries the handler trace as its reason', () => {
  let r = train(lin(), 1, D0).run
  near(nOf(stateOf(r, 'squat', 'load')), 140 * 30 / 36 + 2.5, 'hit: +2.5')
  const tr = r.ledger.transitions[0]!
  assert(tr.fired.find((f) => f.scope === 'squat')!.reason?.node.k === 'match', 'reason is the byVerdict trace')
  r = train(r, 1, day('2026-10-07'), (i) => repsShort(i)).run
  near(nOf(stateOf(r, 'squat', 'misses')), 1, 'miss: streak 1')
})
t('BV-63 BV-65 EC-138 S2', 'at the stall the load drop is PROPOSED (state unchanged) and the streak reset COMMITTED, in one mixed patch', () => {
  let r = lin()
  r = train(r, 3, D0, (i) => repsShort(i)).run
  const load = nOf(stateOf(r, 'squat', 'load'))
  near(load, 140 * 30 / 36, 'load unchanged by the proposal')
  near(nOf(stateOf(r, 'squat', 'misses')), 0, 'streak reset committed')
  assert(pendingFields(r).includes('squat.load'), `pending: ${pendingFields(r)}`)
  const p = Object.values(r.ledger.head.pending).find((x) => x.scope === 'squat')!
  near(nOf(p.fields['load']!), load * 0.9, 'snapshot is 90%')
})
t('EC-141 EC-146', 'accepting a proposal applies its SNAPSHOT (never re-derived); the writer of record is the proposing handler', () => {
  let r = train(lin(), 3, D0, (i) => repsShort(i)).run
  const p = Object.values(r.ledger.head.pending).find((x) => x.scope === 'squat')!
  r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'proposalDecided', causeKey: 'decision:1', proposalKey: p.key, accepted: true }).ledger }
  near(nOf(stateOf(r, 'squat', 'load')), nOf(p.fields['load']!), 'applied')
  assert(!r.ledger.head.pending[p.key], 'removed')
  eq(r.ledger.transitions.at(-1)!.fired[0]!.on, 'decision', 'recorded as a decision on the proposing handler’s patch')
})
t('EC-142 BV-64', 'rejecting removes the proposal and changes nothing; in v3 the streak reset was committed, so the next miss counts from 1 (no instant re-proposal)', () => {
  let r = train(lin(), 3, D0, (i) => repsShort(i)).run
  const p = Object.values(r.ledger.head.pending).find((x) => x.scope === 'squat')!
  const before = stateOf(r, 'squat', 'load')
  r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'proposalDecided', causeKey: 'decision:2', proposalKey: p.key, accepted: false }).ledger }
  assert(sameValue(stateOf(r, 'squat', 'load'), before), 'unchanged')
  r = train(r, 1, day('2026-10-12'), (i) => repsShort(i)).run
  near(nOf(stateOf(r, 'squat', 'misses')), 1, 'streak 1')
  assert(!pendingFields(r).includes('squat.load'), 'no new proposal')
})
t('EC-143', 'a STALE proposal: proposed at the stall, then a hit moves the load, then accepting it is void (the newer progress stands)', () => {
  let r = train(lin(), 3, D0, (i) => repsShort(i)).run
  const p = Object.values(r.ledger.head.pending).find((x) => x.scope === 'squat')!
  r = train(r, 1, day('2026-10-12')).run
  const moved = stateOf(r, 'squat', 'load')
  r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'proposalDecided', causeKey: 'decision:3', proposalKey: p.key, accepted: true }).ledger }
  assert(sameValue(stateOf(r, 'squat', 'load'), moved), 'the hit stands')
  eq(r.ledger.transitions.at(-1)!.fired[0]!.patch['load']!.mode, 'void', 'recorded void')
})
t('EC-144', 'a second proposal on a pending field SUPERSEDES the first (one pending proposal per field)', () => {
  let r = train(lin(), 3, D0, (i) => repsShort(i)).run
  r = train(r, 3, day('2026-10-12'), (i) => repsShort(i)).run
  eq(pendingFields(r).filter((f) => f === 'squat.load').length, 1, 'one pending')
  assert(r.ledger.transitions.some((tr) => tr.emitted.some((x) => x.startsWith('superseded:'))), 'the supersession is recorded')
})
t('EC-145', 'deciding an unknown or already-decided proposal is a recorded no-op', () => {
  const r = lin()
  const x = ingest(r.rt, r.ledger, { k: 'proposalDecided', causeKey: 'decision:x', proposalKey: 'nope', accepted: true })
  assert(x.result.k === 'applied' && JSON.stringify(x.ledger.head.state) === JSON.stringify(r.ledger.head.state), 'no change')
})
t('EC-134 BV-71', '5/3/1: an AMRAP one short sets the flag; at the cycle end the handler reads the PRE-state flag, proposes the reset and commits the flag clear', () => {
  let r = start(P.fiveThreeOneBBB.def, {}, F)
  const short = (i: IssuedSession) => logWith(i, (_s, st, _k, tg) => (st.id === 's3' ? { ...asPrescribedSet(tg), values: { ...asPrescribedSet(tg).values, reps: 4 } } : asPrescribedSet(tg)))
  r = train(r, 4, D0, (i) => (i.day === 'squat' ? short(i) : asPrescribed(i))).run
  assert(stateOf(r, 'squat', 'missed').v === 'bool' && (stateOf(r, 'squat', 'missed') as { b: boolean }).b, 'flag set')
  r = train(r, 12, day('2026-10-13')).run
  assert(pendingFields(r).includes('squat.tm'), 'tm reset proposed')
  eq(stateOf(r, 'squat', 'missed'), { v: 'bool', b: false }, 'flag cleared (committed)')
  const press = nOf(stateOf(r, 'press', 'tm'))
  near(press, 60 * 0.9 + nOf(q(5, 'lb')), 'press: +5 lb at cycle end')
})
t('EC-135 L4', 'one event, many handlers: every order of the slots gives the same state, and no two writes touch one field', () => {
  const r = lin()
  const x = issue(r, D0, F)
  const logged = asPrescribed(x.issued)
  const a = step(x.run.rt, x.run.ledger.head, closeOf(x.issued, logged, D0, [], 'perm1'))
  const rev: IssuedSession = { ...x.issued, slots: [...x.issued.slots].reverse() }
  const b = step(x.run.rt, x.run.ledger.head, closeOf(rev, logged, D0, [], 'perm1'))
  assert(a.k === 'applied' && b.k === 'applied' && JSON.stringify(a.head.state.squat) === JSON.stringify(b.head.state.squat) && JSON.stringify(a.head.state.dead) === JSON.stringify(b.head.state.dead), 'order-independent')
  const writes = a.k === 'applied' ? a.transition.fired.filter((f) => f.causeKey === 'session:perm1').flatMap((f) => Object.keys(f.patch).map((k) => `${f.scope}.${k}`)) : []
  eq(new Set(writes).size, writes.length, 'disjoint')
})
t('EC-136', 'the aggregate reads PRE-state plans: RP’s unaccepted allocation is re-proposed identically next week', () => {
  const r = train(start(P.rpMeso.def), 4, D0).run
  const props = r.ledger.transitions.flatMap((tr) => tr.fired).filter((f) => f.scope === 'program' && f.patch['extra']?.mode === 'propose').map((f) => JSON.stringify(f.patch['extra']!.value))
  eq(props.length, 2, 'two week ends')
  eq(props[0], props[1], 'same proposal')
})
t('EC-139', 'keep is recorded: an unlogged session (unknown verdict) keeps every field and still writes a transition', () => {
  const r = lin()
  const x = issue(r, D0, F)
  const logged = logWith(x.issued, (_s, _st, i, tg) => (i === 0 ? asPrescribedSet(tg) : null))
  const y = close(x.run, x.issued, logged, D0)
  assert(y.result.k === 'applied', 'applied')
  eq(Object.keys(y.run.ledger.transitions.at(-1)!.fired.find((f) => f.scope === 'squat')!.patch), [], 'keep is the empty patch')
})
t('EC-155 S1', 'a partly logged session (2 of 3 sets) is UNKNOWN, never a miss: the streak does not move', () => {
  const x = issue(lin(), D0, F)
  const logged = logWith(x.issued, (_s, _st, i, tg) => (i < 2 ? asPrescribedSet(tg) : null))
  const y = close(x.run, x.issued, logged, D0)
  near(nOf(stateOf(y.run, 'squat', 'misses')), 0, 'no miss')
})
t('EC-177 BV-61 D3', 'a session closed with nothing logged is refused at ingest: no rule fires, nothing moves', () => {
  const x = issue(lin(), D0, F)
  const y = close(x.run, x.issued, logWith(x.issued, () => null), D0)
  eq(y.result.k === 'refused' && y.result.refusal.code, 'emptySession', 'refused')
  eq(y.run.ledger.head.seq, x.run.ledger.head.seq, 'ledger unchanged')
})

// ── the verdict and the event reads ─────────────────────────────────────────

const dp = () => start(P.optLoaded.def, { benchStart: { v: 'none', cause: { k: 'declaredNone' } } }, F)
t('EC-147', 'the verdict judges the ISSUED bounds: 10 reps in 8–12 meets the floor but misses the top', () => {
  const x = issue(dp(), D0, F)
  const ten = logWith(x.issued, (_s, _st, _i, tg) => ({ ...asPrescribedSet(tg), values: { ...asPrescribedSet(tg).values, reps: 10 } }))
  const src = (bound: 'floor' | 'top') => verdictOf({ reg, slots: x.issued.slots, performed: ten, facts: [], groupScores: {}, week: 0, primary: () => undefined }, 'working', bound)
  eq([src('floor'), src('top')], ['hit', 'missed'], 'floor vs top')
})
t('BV-46', 'zero judged sets is UNKNOWN, never a vacuous hit', () => eq(verdictOf({ reg, slots: [], performed: {}, facts: [], groupScores: {}, week: 0, primary: () => undefined }, 'working', 'floor'), 'unknown', 'empty'))
t('EC-106', 'warm-up and recovery sets are not judged: a short C25K walk is not a miss', () => {
  const r = start(ER.couchTo5k.def)
  const x = issue(r, D0)
  const l = logWith(x.issued, (_s, _st, _i, tg) => ({ ...asPrescribedSet(tg), values: tg.role === 'recovery' || tg.role === 'warmup' ? { duration: 1 } : asPrescribedSet(tg).values }))
  eq(verdictOf({ reg, slots: x.issued.slots, performed: l, facts: [], groupScores: {}, week: 0, primary: () => undefined }, 'working', 'floor'), 'hit', 'walks not judged')
})
t('EC-149 EC-150 EC-153', 'event reads: last/best/worst/count over logged sets; e1RM by Epley on the best set; trained(muscle)', () => {
  const x = issue(lin(), D0, F)
  const loads = [100, 110, 105]
  const l = logWith(x.issued, (s, _st, i, tg) => (s === 'squat' ? { values: { reps: 5, load: loads[i]! }, completed: true, stages: null } : asPrescribedSet(tg)))
  const port = eventPort({ reg, slots: x.issued.slots.filter((s) => s.slot === 'squat'), performed: l, facts: [], groupScores: {}, week: 0, primary: (s) => (s === 'squat' ? 'quads' : undefined) })
  eq(['last', 'best', 'worst', 'count'].map((p) => nOf(port({ q: 'metric', step: 'work' as never, metric: 'load', pick: p as 'last' }))), [105, 110, 100, 3], 'picks')
  near(nOf(port({ q: 'e1rm', step: 'work' as never })), 110 * (1 + 5 / 30), 'Epley')
  eq(port({ q: 'trained', muscle: 'quads' }), { v: 'bool', b: true }, 'trained')
})
t('EC-151', 'an event `prescribed` read: fixed → the bound; silent → absent with its cause; an unresolved open field → absent', () => {
  const x = issue(lin(), D0, F)
  const port = eventPort({ reg, slots: x.issued.slots, performed: {}, facts: [], groupScores: {}, week: 0, primary: () => undefined })
  near(nOf(port({ q: 'prescribed', step: 'work' as never, metric: 'reps', edge: 'floor' })), 5, 'fixed')
  const silent = issue(start(P.linear3x5.def), D0)
  const p2 = eventPort({ reg, slots: silent.issued.slots, performed: {}, facts: [], groupScores: {}, week: 0, primary: () => undefined })
  const v = p2({ q: 'prescribed', step: 'work' as never, metric: 'load', edge: 'floor' })
  assert(v.v === 'none' && v.cause.k === 'factUnknown', JSON.stringify(v))
})
t('EC-152 L12', 'post-session facts reach a handler only through the closing event’s snapshot: a pain flare proposes the drop', () => {
  const r = start(ER.achillesLoading.def)
  const x = issue(r, D0)
  const y = close(x.run, x.issued, asPrescribed(x.issued), D0, readings({ pain: { v: 'ord', scale: 'pain', level: 7 } }))
  assert(pendingFields(y.run).includes('drops.added'), 'flare proposed')
  const z = close(x.run, x.issued, asPrescribed(x.issued), D0, readings({ pain: { v: 'ord', scale: 'pain', level: 1 } }))
  near(nOf(stateOf(z.run, 'drops', 'added')), 2.5, 'pain-free hit: +2.5 kg')
})

// ── the progress clock and the calendar ─────────────────────────────────────

t('EC-156 EC-158 EC-159', 'trainWeek counts the weeks before that are not deload or taper (a test week counts); in a deload week it is the next train index', () => {
  const def = { ...P.linear3x5.def, calendar: { weeks: ['train', 'test', 'deload', 'train', 'taper', 'train'], repeat: 'once', drift: 'slide' } } as ProgramDef
  eq([0, 1, 2, 3, 4, 5].map((w) => trainWeekOf(def, w)), [0, 1, 2, 2, 3, 3], 'trainWeek')
})
t('EC-165 BV-37', 'rotations: alternate A/B 3 a week runs A B A then B A B; weekly runs its list in order', () => {
  const r = P.linear3x5.def.rotation
  eq([0, 1, 2, 3, 4, 5].map((k) => nextDay(r, k, k % 3)), ['A', 'B', 'A', 'B', 'A', 'B'], 'alternate')
  eq([0, 1, 2, 3].map((k) => nextDay(ER.hrTempoBlock.def.rotation, k, k)), ['T', 'E', 'E', 'L'], 'weekly')
  eq(entriesPerWeek({ k: 'daily', days: ['D'], perDay: 2 }), 14, 'daily twice')
})
t('BV-29 BV-30 BV-31 BV-32 BV-33 EC-160', '5/3/1 over a cycle: week 0 5×65/75/85%, week 2 5/3/1 at 75/85/95%, the deload 40/50/60% with BBB at 3 sets, and week 4 issued on the post-cycleEnd TM', () => {
  let r = start(P.fiveThreeOneBBB.def, {}, F)
  const tm0 = nOf(stateOf(r, 'squat', 'tm'))
  const all = train(r, 16, D0)
  r = all.run
  const sq = all.issued.filter((i) => i.day === 'squat')
  const grid = nOf(q(5, 'lb'))
  const onGrid = (x: number) => nearestStep(x, grid)
  const loads = (i: IssuedSession) => [0, 1, 2].map((s) => loadOf(i, 'squat', s) ?? NaN)
  const want = (ps: number[]) => ps.map((p) => onGrid((tm0 * p) / 100))
  eq(loads(sq[0]!), want([65, 75, 85]), 'week 0 (on the 5 lb grid)')
  eq(loads(sq[2]!), want([75, 85, 95]), 'week 2')
  eq(loads(sq[3]!), want([40, 50, 60]), 'deload')
  eq((sq[3]!.slots.find((s) => s.slot === 'squatBbb')!.steps[0]!.count as { n: number }).n, 3, 'BBB 5 × 60% = 3 sets')
  assert(r.ledger.transitions.some((tr) => tr.emitted.includes(`cycle:${P.fiveThreeOneBBB.def.ref.id}:0`)), 'cycleEnd emitted once with its causeKey')
  const x = issue(r, day('2026-11-02'), F, 'squat')
  near(nOf(stateOf(r, 'squat', 'tm')), tm0 + nOf(q(10, 'lb')), 'TM +10 lb')
  near((loadOf(x.issued, 'squat', 0) ?? 0) / (tm0 + nOf(q(10, 'lb'))), 0.65, 'week 4 row 0 on the NEW TM', 0.02)
})
t('BV-35', 'RP’s effort wave holds at its last row in the deload week (RIR 0), then the deload’s capEffort lifts it to 4', () => {
  const all = train(start(P.rpMeso.def), 10, D0)
  const dl = all.issued[8]!
  eq(dl.stamp.position.role, 'deload', 'week 4 is the deload')
  eq(fieldOf(dl, 'flatDb', 'effort'), { k: 'fixed', v: { b: 'exact', v: 4 } }, 'RIR 4')
})
t('EC-161 BV-36', 'a once calendar ends in blockEnd (no cycleEnd) and then refuses to prescribe (programComplete)', () => {
  const r = train(start(P.rpMeso.def), 10, D0).run
  eq(r.ledger.head.status, 'completed', 'completed')
  assert(r.ledger.transitions.some((tr) => tr.emitted.includes(`block:${P.rpMeso.def.ref.id}`)) && !r.ledger.transitions.some((tr) => tr.emitted.some((e) => e.startsWith('cycle:'))), 'blockEnd only')
  const p = prescribe(r.rt, r.ledger, 'upperA', factsOf({}), day('2026-11-20'))
  eq(p.issued, { code: 'programComplete' }, 'refused')
})
t('EC-162 EC-164 BV-77 L10 EC-114', 'the deload-week policy transforms only deload weeks, and L10 strips the intensifier there and only there', () => {
  const all = train(start(P.upperHypertrophy.def), 8, D0)
  const wk = (w: number) => all.issued.find((i) => i.stamp.position.week === w)!
  assert(wk(0).slots[0]!.intensifier !== null, 'train week keeps the rest-pause')
  eq(wk(3).slots[0]!.intensifier, null, 'deload strips it')
  eq((wk(3).slots[1]!.steps[0]!.count as { n: number }).n, 2, 'row 4 × 50% = 2 sets')
  eq(wk(3).stamp.policies, [0], 'the role policy applied')
})
t('EC-163', 'policies apply before the phase transform: a deload week under a tempo phase gets both, the transform last', () => {
  const rt = runtimeOf(reg, P.rpMeso.def, { id: 'phase', anchor: D0, activatedOn: D0 }, { label: 'p', transform: { def: P.withTempo.def.ref, hole: 's', args: { t: { k: 'tempo', ecc: 3, pause: 0, con: 1, top: 0 } } } })
  let r: Run = { rt, ledger: ledgerOf(activate(rt, {}, F)) }
  const all = train(r, 9, D0)
  r = all.run
  const dl = all.issued[8]!
  eq(dl.stamp.policies, [0], 'deload policy')
  eq(dl.stamp.phaseTransform, P.withTempo.def.ref, 'phase transform stamped')
  eq(dl.slots[0]!.steps[0]!.sets[0]!.tempo, [3, 0, 1, 0], 'tempo set')
})
t('EC-166 L11', 'thirty days with no training advance nothing: the block week, the TM and every slot state are unchanged', () => {
  const r = start(P.fiveThreeOneBBB.def, {}, F)
  const p = prescribe(r.rt, r.ledger, 'press', F, day('2026-11-04'))
  eq(p.ledger.head.progress.week, 0, 'still week 0')
  eq(JSON.stringify(p.ledger.head.state), JSON.stringify(r.ledger.head.state), 'state unchanged')
  eq(p.ledger.transitions.length, 30, 'thirty dayClosed facts')
})
t('L11', 'a slot with no session in its window records keep(untrained) at the boundary: an untrained press keeps its TM at the cycle end', () => {
  let r = start(P.fiveThreeOneBBB.def, {}, F)
  const tm = stateOf(r, 'press', 'tm')
  for (let k = 0; k < 16; k++) {
    const today = addDays(D0, k * 2)
    const x = issue(r, today, F)
    r = x.issued.day === 'press' ? { ...x.run, ledger: ingest(x.run.rt, x.run.ledger, { k: 'skip', causeKey: `skip:p${k}`, slot: 'press' }).ledger } : close(x.run, x.issued, asPrescribed(x.issued), today).run
  }
  assert(sameValue(stateOf(r, 'press', 'tm'), tm), 'press TM unchanged')
  assert(r.ledger.transitions.flatMap((tr) => tr.fired).some((f) => f.scope === 'press' && f.on === 'cycleEnd' && f.skipped === 'untrained'), 'keep(untrained) recorded')
  assert(!sameValue(stateOf(r, 'squat', 'tm'), stateOf(start(P.fiveThreeOneBBB.def, {}, F), 'squat', 'tm')), 'the trained squat moved')
})
t('L11 anchored', 'anchored drift closes the block week on the calendar: seven days with no training close week 0, and its boundary handlers keep (untrained)', () => {
  const def: ProgramDef = { ...P.fiveThreeOneBBB.def, calendar: { ...P.fiveThreeOneBBB.def.calendar, drift: 'anchored' } }
  const r = start(def, {}, F)
  const p = prescribe(r.rt, r.ledger, 'press', F, day('2026-10-13'))
  eq(p.ledger.head.progress.week, 1, 'week 0 closed on 11 October')
  eq(JSON.stringify(p.ledger.head.state), JSON.stringify(r.ledger.head.state), 'nothing committed')
})
t('L13', 'time alone never commits: a reconciliation that closes windows and writes adherence leaves every state field as it was', () => {
  const r = train(start(P.legsFrequency.def, {}, F), 3, D0).run
  const p = prescribe(r.rt, r.ledger, 'A', F, day('2026-11-30'))
  eq(JSON.stringify(p.ledger.head.state), JSON.stringify(r.ledger.head.state), 'no state moved')
  assert(p.ledger.head.calendar.adherence.length > 3, 'adherence written')
})

// ── the ledger (L5) ─────────────────────────────────────────────────────────

const someEvents = (): { run: Run; events: Event[] } => {
  const r0 = lin()
  let r = r0
  const events: Event[] = []
  for (let k = 0; k < 5; k++) {
    const today = addDays(D0, 2 * k)
    const p = prescribe(r.rt, r.ledger, nextDay(r.rt.def.rotation, r.ledger.head.progress.sessions, r.ledger.head.progress.weekEntries), F, today)
    events.push(...p.ledger.events.slice(r.ledger.events.length))
    if ('code' in p.issued) throw new Error('refused')
    const e = closeOf(p.issued, k === 3 ? repsShort(p.issued) : asPrescribed(p.issued), today, [], `L5-${k}`)
    events.push(e)
    r = { ...r, ledger: ingest(r.rt, p.ledger, e).ledger }
  }
  return { run: r, events }
}
t('EC-167 EC-168 BV-78 L5', 'a new causeKey applies (seq + 1); the same causeKey again, twice or thrice, is a no-op', () => {
  const { run, events } = someEvents()
  const e = events.at(-1)!
  const again = ingest(run.rt, run.ledger, e)
  const thrice = ingest(run.rt, again.ledger, e)
  eq([again.result.k, thrice.result.k], ['already', 'already'], 'already')
  eq(thrice.ledger.head.seq, run.ledger.head.seq, 'one transition')
})
t('EC-169', 'a duplicate causeKey with a DIFFERENT payload is still a no-op: the first wins', () => {
  const { run, events } = someEvents()
  const e = events.at(-1)! as Extract<Event, { k: 'sessionClosed' }>
  const forged = { ...e, facts: { ...e.facts, performed: {} } }
  eq(ingest(run.rt, run.ledger, forged).result.k, 'already', 'first wins')
})
t('EC-170 EC-172 L5', 'replaying the ledger from the activation head reproduces the live head exactly (the head is derived, never authoritative)', () => {
  const { run, events } = someEvents()
  const re = replay(run.rt, activate(run.rt, {}, F), events)
  eq(JSON.stringify(re.head), JSON.stringify(run.ledger.head), 'replay = live')
})
t('EC-173', 'a crash between two catch-up days resumes: re-running prescribe applies only the days not yet applied', () => {
  const r = lin()
  const evs = reconcile(r.rt.spec, r.ledger.head.calendar, day('2026-10-20'))
  let half = r.ledger
  for (const e of evs.slice(0, 6)) half = ingest(r.rt, half, e).ledger
  const resumed = prescribe(r.rt, half, 'A', F, day('2026-10-20')).ledger
  const straight = prescribe(r.rt, r.ledger, 'A', F, day('2026-10-20')).ledger
  eq(JSON.stringify(resumed.head), JSON.stringify(straight.head), 'same head')
  eq(resumed.events.length, evs.length, 'each day once')
})
t('EC-171 D9', 'a late session applies when it arrives and appends an adherence amendment; it never edits a closed window or a later transition', () => {
  let r = train(start(P.legsFrequency.def, {}, F), 2, D0).run
  r = { ...r, ledger: prescribe(r.rt, r.ledger, 'C', F, day('2026-10-20')).ledger }
  const before = JSON.stringify(r.ledger.head.calendar.adherence)
  const old = r.ledger.transitions.map((tr) => JSON.stringify(tr))
  const x = issue(r, day('2026-10-20'), F, 'C')
  const late = closeOf(x.issued, asPrescribed(x.issued), day('2026-10-09'), [], 'late')
  r = { ...x.run, ledger: ingest(x.run.rt, x.run.ledger, late).ledger }
  eq(JSON.stringify(r.ledger.head.calendar.adherence), before, 'adherence rows untouched')
  assert(r.ledger.head.calendar.amendments.length > 0, 'amendment appended')
  eq(r.ledger.transitions.slice(0, old.length).map((tr) => JSON.stringify(tr)), old, 'history untouched')
})
t('EC-174 EC-175', 'rebind: the same state schema is an identity migration; a different one is refused (no record sort to write a migration in)', () => {
  const r = lin()
  const same = ingest(r.rt, r.ledger, { k: 'rebind', causeKey: 'rebind:1', slot: 'squat', to: P.linearGated.def.ref, args: r.ledger.head.bindings['squat']!.args })
  eq(same.result.k, 'applied', 'identity')
  const other = ingest(r.rt, r.ledger, { k: 'rebind', causeKey: 'rebind:2', slot: 'squat', to: P.doubleProg.def.ref, args: {} })
  assert(other.result.k === 'refused' && other.result.refusal.code === 'rebindNeedsMigration', JSON.stringify(other.result))
})
t('EC-176', 'a session issued before a rebind and closed after it runs the CURRENT binding’s handler against the issued snapshot', () => {
  const r = lin()
  const x = issue(r, D0, F)
  const rb = ingest(x.run.rt, x.run.ledger, { k: 'rebind', causeKey: 'rebind:3', slot: 'squat', to: P.linearGated.def.ref, args: { ...r.ledger.head.bindings['squat']!.args, inc: T(kg(5)) } })
  const y = ingest(x.run.rt, rb.ledger, closeOf(x.issued, asPrescribed(x.issued), D0))
  near(nOf(y.ledger.head.state['squat']!['load']!), 140 * 30 / 36 + 5, 'the new binding’s +5 kg')
})
t('EC-129 EC-130 EC-131 EC-133 L3', 'owner edits: allowed where writableBy lists owner; refused elsewhere; null clears an optional field', () => {
  const r = lin()
  const ok = ingest(r.rt, r.ledger, { k: 'ownerEdit', causeKey: 'edit:1', scope: 'squat', patch: { load: { k: 'q', v: 120, unit: 'kg' } } })
  near(nOf(ok.ledger.head.state['squat']!['load']!), 120, 'applied')
  const no = ingest(r.rt, r.ledger, { k: 'ownerEdit', causeKey: 'edit:2', scope: 'squat', patch: { misses: { k: 'q', v: 0, unit: 'x' } } })
  eq(no.result.k === 'refused' && no.result.refusal.code, 'notOwnerWritable', 'misses is session-only')
  const clear = ingest(r.rt, r.ledger, { k: 'ownerEdit', causeKey: 'edit:3', scope: 'squat', patch: { load: null } })
  eq(clear.ledger.head.state['squat']!['load']!, { v: 'none', cause: { k: 'ownerCleared', field: 'load' } }, 'cleared')
  const rp = start(P.rpMeso.def)
  const extra = ingest(rp.rt, rp.ledger, { k: 'ownerEdit', causeKey: 'edit:4', scope: 'program', patch: { extra: { k: 'q', v: 1, unit: 'set' } } })
  eq(extra.result.k, 'refused', 'RP extra is weekEnd-only')
})

// ── issuance and resolution (L6) ────────────────────────────────────────────

const apre = () => {
  const def = exampleProgram(P.apreTopBackoff.def, { lift: T(exercise('wger:192')), small: T(lb(5)), big: T(lb(10)), backoffs: T(sets(2)), keep: T(pct(90)) })
  return start({ ...def, grids: { load: T(lb(5)) } }, {}, F, 'apre', D0, { ...reg, schemes: new Map([...reg.schemes]) })
}
t('EC-107 EC-180 BV-70', 'APRE: the back-offs read the top set, so they issue OPEN with a planned value (adjust(6 reps) = 0, × 90%)', () => {
  const x = issue(apre(), D0, F)
  const f = fieldOf(x.issued, 'x', 'load', 3)!
  assert(f.k === 'open' && f.dependsOn.includes('top'), JSON.stringify(f).slice(0, 200))
  const rm = loadOf(x.issued, 'x', 2)!
  near(f.planned.k === 'fixed' && f.planned.v.b === 'exact' ? f.planned.v.v : NaN, Math.round((rm * 0.9) / nOf(q(5, 'lb'))) * nOf(q(5, 'lb')), 'planned', 0.03)
})
t('EC-183 EC-184 EC-185 EC-187', 'resolution: nothing until the top set is logged; then one row per open field; re-running adds nothing; the current view shows it', () => {
  const x = issue(apre(), D0, F)
  eq(resolveLive({ reg }, x.issued, {}, []).length, 0, 'not logged: stays open')
  const top = nOf(q(185, 'lb'))
  const logged: Logged = { x: { top: [{ values: { reps: 9, load: top }, completed: true, stages: null }] } }
  const rows = resolveLive({ reg }, x.issued, logged, [])
  eq(rows.length, 2, 'two back-off sets')
  eq(resolveLive({ reg }, x.issued, logged, rows).length, 0, 'idempotent')
  const v = currentView(x.issued, rows)[0]!.steps[3]!.sets[0]!.metrics['load']!
  assert(v.k === 'fixed' && v.v.b === 'exact', JSON.stringify(v))
  near(v.v.v / nOf(q(1, 'lb')), 170, '(185 + 5) × 90% = 171 → 170 lb on the 5 lb grid')
  assert(x.issued.slots[0]!.steps[3]!.sets[0]!.metrics['load']!.k === 'open', 'the issued fact is untouched')
})
t('EC-186', 'an EDITED dependency yields a new, superseding resolution; the old row stays', () => {
  const x = issue(apre(), D0, F)
  const lg = (r: number): Logged => ({ x: { top: [{ values: { reps: r, load: nOf(q(185, 'lb')) }, completed: true, stages: null }] } })
  const first = resolveLive({ reg }, x.issued, lg(9), [])
  const second = resolveLive({ reg }, x.issued, lg(3), first)
  eq(second.length, 2, 'superseding rows')
  const v = currentView(x.issued, [...first, ...second])[0]!.steps[3]!.sets[0]!.metrics['load']!
  near(v.k === 'fixed' && v.v.b === 'exact' ? v.v.v / nOf(q(1, 'lb')) : NaN, 160, '(185 − 5) × 90% = 162 → 160 lb')
})
t('BV-42 BV-43 BV-44 BV-45 EC-112', 'Jokers (pre-tested while): none unless the top set made its reps; each 5% above the last; FSL is a 3–5 count range', () => {
  const def = exampleProgram(P.w531Jokers.def, { lift: T(exercise('wger:111')), tm: T(kg(100)) })
  const run = start({ ...def, grids: { load: T(kg(2.5)) } }, {}, F, 'jk')
  const x = issue(run, D0, F)
  const jk = x.issued.slots[0]!.steps.find((s) => s.id === 'joker')!
  eq(jk.count, { k: 'while', max: 3, planned: 3 }, 'planned: 3 jokers when the top set goes as prescribed')
  const view = currentView(x.issued, [])[0]!
  const made: Logged['x'] = { s3: [{ values: { reps: 5, load: 85 }, completed: true, stages: null }] }
  const missed: Logged['x'] = { s3: [{ values: { reps: 4, load: 85 }, completed: true, stages: null }] }
  eq(setsDue({ reg }, view, jk, missed), 0, 'top set short: no jokers')
  eq(setsDue({ reg }, view, jk, made), 1, 'top set made: one joker due')
  const res = resolveLive({ reg }, x.issued, { x: { ...made, joker: [{ values: { reps: 1, load: 90 }, completed: true, stages: null }] } }, [])
  const j1 = res.find((r) => r.step === 'joker' && r.index === 1)!
  near(j1.value.k === 'fixed' && j1.value.v.b === 'exact' ? j1.value.v.v : NaN, 95, '90 × 105% = 94.5 → 95 (nearest)')
  eq(x.issued.slots[0]!.steps.find((s) => s.id === 'fsl')!.count, { k: 'range', min: 3, max: 5 }, 'FSL range')
})
t('EC-181 EC-182 EC-188 EC-189', 'prescribe is deterministic on the same ledger; repeated days get distinct issue keys; the stamp lists only the facts actually read', () => {
  const r = start(ER.couchTo5k.def)
  const a = prescribe(r.rt, r.ledger, 'R', F, D0)
  const b = prescribe(r.rt, r.ledger, 'R', F, D0)
  eq(JSON.stringify(a.issued), JSON.stringify(b.issued), 'deterministic')
  const all = train(r, 3, D0)
  eq(new Set(all.issued.map((i) => i.issueKey)).size, 3, 'distinct keys for R, R, R')
  const w = issue(start(P.fiveThreeOneBBB.def, {}, F), D0, F)
  eq(w.issued.stamp.factsRead, [], '5/3/1 reads e1RM only at init, never at issue')
  eq(Object.keys(w.issued.stamp).sort(), ['calReads', 'display', 'factsRead', 'grids', 'hitPolicy', 'issuedOn', 'phaseTransform', 'policies', 'position', 'programHash', 'stateSeq'], 'stamp fields')
})
t('L6', 'issued facts are immutable: a frozen prescription survives closing, resolving and later events untouched', () => {
  const deepFreeze = <X>(o: X): X => {
    if (o && typeof o === 'object') {
      Object.freeze(o)
      for (const v of Object.values(o)) deepFreeze(v)
    }
    return o
  }
  const x = issue(apre(), D0, F)
  const frozen = deepFreeze(x.issued)
  const logged: Logged = { x: { top: [{ values: { reps: 9, load: 80 }, completed: true, stages: null }] } }
  const y = close(x.run, frozen, { ...logged, x: { ...logged.x, ramp1: [asPrescribedSet(frozen.slots[0]!.steps[0]!.sets[0]!)] } }, D0)
  assert(y.result.k === 'applied', 'applied over a frozen fact')
})

// ── initial state ───────────────────────────────────────────────────────────

t('EC-120 EC-121 EC-122 EC-123 EC-124 BV-57 BV-58 L7 EC-29', 'init: from a param, a literal, the e1RM (present → loadFor; absent → silent with the cause), or none (self-anchoring at the first logged best load)', () => {
  near(nOf(stateOf(start(P.optStabilization.def), 'pushStab', 'rung')), 0, 'param')
  near(nOf(stateOf(lin(), 'squat', 'misses')), 0, 'literal')
  near(nOf(stateOf(lin(), 'squat', 'load')), 140 * 30 / 36, 'e1RM present')
  const bare = start(P.linear3x5.def)
  const v = stateOf(bare, 'squat', 'load')
  assert(v.v === 'none' && v.cause.k === 'factUnknown', JSON.stringify(v))
  const x = issue(bare, D0)
  eq(fieldOf(x.issued, 'squat', 'load'), { k: 'silent', cause: { k: 'factUnknown', fact: 'e1rm', key: 'wger:111' } }, 'silent target names the cause')
  const anchored = close(x.run, x.issued, logWith(x.issued, (_s, _st, _i, tg) => ({ ...asPrescribedSet(tg), values: { reps: 5, load: 100 } })), D0)
  near(nOf(stateOf(anchored.run, 'squat', 'load')), 100, 'self-anchors at the best logged load (BV-57)')
  const nothing = close(x.run, x.issued, logWith(x.issued, (_s, _st, _i, tg) => asPrescribedSet(tg)), D0)
  eq(stateOf(nothing.run, 'squat', 'load').v, 'none', 'no load logged: stays absent (BV-58)')
})

// ── projection (L9) and macros ──────────────────────────────────────────────

t('EC-190 EC-194 L9', 'projection: asPrescribed issues and steps on a COPY; the input ledger is byte-identical afterwards; every week is tagged projected', () => {
  const r = lin()
  const before = JSON.stringify(r.ledger)
  const p = project(r.rt, r.ledger, 2, { k: 'asPrescribed' }, F, D0)
  eq(JSON.stringify(r.ledger), before, 'never writes')
  eq(p.weeks.map((w) => w.projected), [true, true], 'tagged')
  near(nOf(p.ledger.head.state['squat']!['load']!), 140 * 30 / 36 + 6 * 2.5, '6 hits')
})
t('EC-191', 'projection under allMiss: linear proposes the drop after `stalls` sessions', () => {
  const p = project(lin().rt, lin().ledger, 2, { k: 'allMiss' }, F, D0)
  assert(Object.values(p.ledger.head.pending).some((x) => x.scope === 'squat'), 'proposal pending')
})
t('EC-192 EC-193', 'repeatLast with no history falls back to asPrescribed and SAYS so; an unscripted session is asPrescribed', () => {
  const p = project(lin().rt, lin().ledger, 1, { k: 'repeatLast' }, F, D0)
  assert(p.fallbacks.some((f) => f.includes('no earlier session')), p.fallbacks.join('; '))
  const s = project(lin().rt, lin().ledger, 1, { k: 'script', outcomes: [{ week: 0, day: 'A', hit: false }] }, F, D0)
  near(nOf(s.ledger.head.state['squat']!['misses']!), 1, 'the scripted A misses; B (unscripted) hits')
})
t('L9 asScheduled', 'asScheduled lays sessions on nominal days, so a projection answers "when does this block end"', () => {
  const p = project(start(P.rpMeso.def).rt, start(P.rpMeso.def).ledger, 99, { k: 'asScheduled' }, F, D0)
  eq(p.weeks.length, 5, 'five block weeks')
  eq(p.weeks.at(-1)!.endsOn, day('2026-11-05'), 'ends Thursday 5 November')
})
t('EC-195 EC-225 EC-227 EC-228 EC-233 EC-238 BV-73 BV-74', 'a macro: the bounded stabilization phase advances at the first week end ≥ min where its gate holds; each phase starts from its own init plus the handoff', () => {
  const D = day('2026-11-02')
  const runs = projectMacro(reg, P.optMacro, { k: 'asPrescribed' }, corpusFacts(D), 40, readings({ formQuality: { v: 'ord', scale: 'formQuality', level: 2 } }, D))
  eq(runs[0]!.ended, 'criteria', 'stabilization ended by its gate')
  eq(runs[0]!.weeks, 4, 'at min (the rungs topped out by week 2: BV-73 stays, BV-74 advances)')
  near(nOf(runs[1]!.params['rung']!), 2, 'handoff: the rung reached')
  eq(Object.keys(runs[1]!.final.head.state).sort(), ['bench', 'pushStab'], 'only its own slots: nothing crosses but the handoff')
})
t('BV-75 D12', 'a criteria-gated phase whose gate never holds stops at max and ASKS (atMax propose): the Achilles isometrics never time out into loading', () => {
  const runs = projectMacro(reg, ER.achillesReturn, { k: 'asPrescribed' }, corpusFacts(day('2026-09-14')), 40)
  eq(runs.map((r) => [r.weeks, r.ended]), [[6, 'askedAtMax']], 'asks at 6 weeks')
})
t('EC-234', 'a handoff whose source is absent flows as absence: benchStart none → the next phase seeds from the e1RM', () => {
  const runs = projectMacro(reg, P.optMacro, { k: 'asPrescribed' }, corpusFacts(day('2026-11-02')), 40, readings({ formQuality: { v: 'ord', scale: 'formQuality', level: 2 } }, day('2026-11-02')))
  eq(runs[1]!.params['benchStart']!.v, 'none', 'absent handoff')
  assert(runs[1]!.final.head.state['bench']!['load']!.v === 'q', 'seeded from the e1RM instead')
})

t('EC-117', 'a transformer over an OPEN field wraps its term: a 90% load deload over APRE’s back-offs scales both the planned value and the live resolution', () => {
  const base = apre()
  const def: ProgramDef = { ...base.rt.def, policies: [{ when: { k: 'lit', lit: { k: 'bool', v: true } }, plan: { def: P.deloadStd.def.ref, hole: 's', args: { load: T(pct(90)), timed: T(pct(100)), volume: T(pct(100)), rir: T(rir(0)) } }, outcome: null, origin: 'declared' }] }
  const x = issue(start(def, {}, F, 'apre-dl'), D0, F)
  const f = fieldOf(x.issued, 'x', 'load', 3)!
  assert(f.k === 'open' && JSON.stringify(f.bound).includes('"op":"*"'), 'the open term is wrapped')
  const top = nOf(q(185, 'lb'))
  const rows = resolveLive({ reg }, x.issued, { x: { top: [{ values: { reps: 9, load: top }, completed: true, stages: null }] } }, [])
  const v = rows.find((r) => r.step === 'backoff' && r.index === 0)!.value
  near(v.k === 'fixed' && v.v.b === 'exact' ? v.v.v / nOf(q(1, 'lb')) : NaN, 155, '(185 + 5) × 90% × 90% = 153.9 → 155 lb')
})
t('EC-220 EC-C11', 'groups: a superset issues its members in order, and the group score is an event read', () => {
  const x = issue(start(P.optPower.def, { benchStart: { v: 'none', cause: { k: 'declaredNone' } } }, F), D0, F)
  eq(x.issued.slots.map((s) => s.slot), ['bench', 'pass'], 'member order')
  const port = eventPort({ reg, slots: x.issued.slots, performed: {}, facts: [], groupScores: { bench: { time: 600 } }, week: 0, primary: () => undefined })
  near(nOf(port({ q: 'groupScore', score: 'time' })), 600, 'group time')
})
t('BV-41 EC-C09', 'the stabilization ladder at its top rung: the climb condition met caps at the top and resets the streak', () => {
  let r = start(P.optStabilization.def)
  r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'ownerEdit', causeKey: 'edit:rung', scope: 'pushStab', patch: { rung: { k: 'q', v: 2, unit: 'x' } } }).ledger }
  r = train(r, 2, D0, asPrescribed, F, 2, readings({ formQuality: { v: 'ord', scale: 'formQuality', level: 2 } })).run
  near(nOf(stateOf(r, 'pushStab', 'rung')), 2, 'held at the top')
  near(nOf(stateOf(r, 'pushStab', 'solid')), 0, 'streak reset')
})
t('BV-66 EC-218', 'a two-muscle slot counts 0.5 toward its secondary muscle’s weekly sets and is never a candidate for it (slotsFor reads primaries)', () => {
  const r = start(P.optPower.def, { benchStart: { v: 'none', cause: { k: 'declaredNone' } } }, F)
  const agg = aggPort(r.rt, r.ledger.head, { facts: F, today: D0, earlierToday: 0, reads: newReads() })
  near(nOf(agg({ q: 'weekly', metric: 'sets', by: { k: 'muscle', id: 'shoulders' } })), 0.5 * 4 * 2, 'pass: 4 sets × 2 sessions × 0.5')
  eq(agg({ q: 'slotsFor', muscle: 'shoulders' }), { v: 'list', items: [] }, 'no primary there')
})
t('BV-72', 'GZCLP at the retest stage with no test load logged keeps everything, and the retest is prescribed again', () => {
  let r = start(P.gzclpT1Program.def, { squatStart: { v: 'none', cause: { k: 'declaredNone' } } }, F)
  r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'ownerEdit', causeKey: 'edit:stage', scope: 'squat', patch: { stage: { k: 'enum', name: 'gzT1', tag: 'retest' } } }).ledger }
  const x = issue(r, D0, F, 'A1')
  eq(x.issued.slots[0]!.steps[0]!.id, 'test', 'the retest is issued')
  const y = close(x.run, x.issued, logWith(x.issued, () => ({ values: { reps: 5 }, completed: true, stages: null })), D0)
  eq(stateOf(y.run, 'squat', 'stage'), { v: 'enum', name: 'gzT1', tag: 'retest' }, 'kept')
  eq(issue(y.run, day('2026-10-07'), F, 'A1').issued.slots[0]!.steps[0]!.id, 'test', 'retest again')
})
t('EC-C03 EC-C04', 'heart-rate zones and timed sets are judged like any metric: a tempo run inside its zone grows the block; one above the ceiling holds it', () => {
  const r = start(ER.hrTempoBlock.def, {}, F)
  const x = issue(r, D0, F, 'T')
  near(nOf(stateOf(close(x.run, x.issued, asPrescribed(x.issued), D0).run, 'tempo', 'block')), 25 * 60, 'in the zone: 20 → 25 min')
  const hot = logWith(x.issued, (_s, _st, _i, tg) => ({ ...asPrescribedSet(tg), values: { ...asPrescribedSet(tg).values, ...('hr' in tg.metrics ? { hr: nOf(q(165, 'bpm')) } : {}) } }))
  near(nOf(stateOf(close(x.run, x.issued, hot, D0).run, 'tempo', 'block')), 20 * 60, 'over the ceiling: held')
})
t('EC-232', 'a peakOn macro lays its fixed phases out BACKWARDS from the date', () => {
  const peak = macro({ id: 'demo/peak', version: 1, says: 'x', anchor: { k: 'peakOn', date: day('2027-03-06') }, drift: 'anchored', phases: [phase('Block', P.optLoaded, { k: 'fixed' }, () => ({ benchStart: none(ty.q('mass')) }))] })
  const runs = projectMacro(reg, peak, { k: 'asPrescribed' }, corpusFacts(day('2027-02-06')), 10)
  eq(runs[0]!.startsOn, day('2027-02-06'), 'four weeks before the meet')
})

// ── L1, L2, L7, L12: properties over the whole corpus ───────────────────────

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
t('L1', 'totality: every library function evaluates on 200 random argument sets (zeros, negatives, huge values) without throwing', () => {
  const r = rng(7)
  const pickQ = () => [0, -1, 1e9, 2.5, r() * 300][Math.floor(r() * 5)]!
  let runs = 0
  for (const f of reg.fns.values()) {
    if (Object.values(f.params).some((p) => p.t === 'dom')) continue
    for (let k = 0; k < 200; k++) {
      const args = Object.fromEntries(
        Object.entries(f.params).map(([p, ty]) => {
          const base = ty.t === 'opt' ? ty.of : ty
          if (ty.t === 'opt' && r() < 0.3) return [p, { k: 'none', of: base } as Term]
          if (base.t === 'ord') return [p, { k: 'lit', lit: { k: 'ord', scale: base.scale, level: base.scale === 'readiness' ? 1 + Math.floor(r() * 5) : Math.floor(r() * 4) } } as Term]
          return [p, { k: 'lit', lit: { k: 'q', v: pickQ(), unit: 'x' } } as Term]
        }),
      )
      const v = evaluate({ k: 'app', def: f.ref, args }, ctxOf(reg)).value
      assert(v.v === 'none' || v.v !== 'q' || Number.isFinite(v.n) || Math.abs(v.n) === Infinity, `${f.ref.id}`)
      runs++
    }
  }
  assert(runs > 1000, `${runs} runs`)
})
t('L2', 'determinism: two projections of every worked program are identical, value for value', () => {
  for (const def of reg.programs.values()) {
    const params = Object.fromEntries(Object.entries(def.params).map(([k, ty]) => [k, ty.t === 'opt' ? ({ v: 'none', cause: { k: 'declaredNone' } } as Value) : q(0, 'x')]))
    const a = project(start(def, params, F).rt, start(def, params, F).ledger, 2, { k: 'asPrescribed' }, F, D0)
    const b = project(start(def, params, F).rt, start(def, params, F).ledger, 2, { k: 'asPrescribed' }, F, D0)
    eq(JSON.stringify(a.ledger.head), JSON.stringify(b.ledger.head), def.ref.id)
  }
})
t('L7 E1 E2 E3', 'silence propagates and never corrupts: an unknown fact issues silent targets (E1), a deload over them keeps them silent (E2), and a handler over them keeps state (E3)', () => {
  const r = start(P.upperHypertrophy.def)
  const all = train(r, 8, D0, (i) => asPrescribed(i))
  const dl = all.issued.find((i) => i.stamp.position.role === 'deload')!
  eq(fieldOf(dl, 'press', 'load')?.k, 'silent', 'E1+E2: silent through the deload')
  eq(stateOf(all.run, 'press', 'load').v, 'none', 'E3: nothing invented')
})
t('L12', 'replay never reads the live world: replaying with no fact source at all reproduces the head (facts ride on the events)', () => {
  const r = start(ER.achillesLoading.def)
  const x = issue(r, D0)
  const e = closeOf(x.issued, asPrescribed(x.issued), D0, readings({ pain: { v: 'ord', scale: 'pain', level: 1 } }))
  const live = ingest(x.run.rt, x.run.ledger, e).ledger
  const re = replay(r.rt, activate(r.rt, {}, factsOf({})), [...x.run.ledger.events, e])
  eq(JSON.stringify(re.head.state), JSON.stringify(live.head.state), 'same state')
  assert(live.transitions.at(-1)!.factsRead.some((f) => f.fact === 'pain'), 'the read is stamped with its value')
})
t('L8 EC-197', 'every former the corpus uses renders and evaluates: every worked program projects two weeks without throwing', () => {
  for (const def of reg.programs.values()) {
    const params = Object.fromEntries(Object.entries(def.params).map(([k, ty]) => [k, ty.t === 'opt' ? ({ v: 'none', cause: { k: 'declaredNone' } } as Value) : q(0, 'x')]))
    project(start(def, params, F).rt, start(def, params, F).ledger, 2, { k: 'asPrescribed' }, F, D0)
  }
})
t('exports E', 'exports: declared slot state plus the lifecycle exports every instance has', () => {
  const r = train(lin(), 3, D0).run
  const x = exportsOf(r.rt, r.ledger.head)
  eq(Object.keys(x).sort(), ['completedFraction', 'finalWeek', 'missedTotal', 'squatLoad', 'status'], 'names')
  near(nOf(x['finalWeek']!), 1, 'one block week closed')
})

void numE
void dayNum
void E1RM
void ({} as Head)
void ({} as FactReading)
// ── the ratification round (2026-10-04) ────────────────────────────────────
// These sessions carry their own workout ids so the rest of the kit's
// recorded fixtures keep theirs.
const trainAs = (run: Run, ids: string[], from: LocalDayT, how: (i: IssuedSession) => Logged = asPrescribed, every = 2, post: FactReading[] = []) => {
  const out: IssuedSession[] = []
  let r = run
  ids.forEach((id, k) => {
    const today = addDays(from, k * every)
    const x = issue(r, today, factsOf({}))
    out.push(x.issued)
    r = { ...x.run, ledger: ingest(x.run.rt, x.run.ledger, closeOf(x.issued, how(x.issued), today, post, id)).ledger }
  })
  return { run: r, issued: out }
}
t('EC-146', 'accepting re-checks writability: a proposal whose field its proposer may no longer write expires unapplied, with the reason recorded; an owner-writable field stays acceptable', () => {
  const variant = (version: number, writableBy: string[]) => {
    const v = JSON.parse(JSON.stringify(P.linearGated.def)) as typeof P.linearGated.def
    ;(v as { ref: { id: string; version: number } }).ref = { ...v.ref, version }
    ;(v.state['load'] as { writableBy: string[] }).writableBy = writableBy
    return v
  }
  const sealed = variant(90, ['cycleEnd'])
  const ownerOnly = variant(91, ['owner'])
  const r2 = publish([...P.PUBLISHED, ...ER.PUBLISHED, sealed, ownerOnly])
  const decide = (to: typeof sealed) => {
    let r = trainAs(start(P.linear3x5.def, {}, F, 'ec146', D0, r2), [`ec146-${to.ref.version}-1`, `ec146-${to.ref.version}-2`, `ec146-${to.ref.version}-3`], D0, (i) => repsShort(i)).run
    const p = Object.values(r.ledger.head.pending).find((x) => x.scope === 'squat')!
    const before = stateOf(r, 'squat', 'load')
    r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'rebind', causeKey: `rebind:${to.ref.version}`, slot: 'squat', to: to.ref, args: r.ledger.head.bindings['squat']!.args }).ledger }
    const x = ingest(r.rt, r.ledger, { k: 'proposalDecided', causeKey: 'decision:146', proposalKey: p.key, accepted: true })
    return { p, before, x }
  }
  const gone = decide(sealed)
  assert(gone.x.result.k === 'applied', 'the decision is recorded')
  assert(sameValue(gone.x.ledger.head.state['squat']!['load']!, gone.before), 'never applied: the load is unchanged')
  assert(!gone.x.ledger.head.pending[gone.p.key], 'the proposal is gone')
  const tr = gone.x.ledger.transitions.at(-1)!
  eq(tr.fired[0]!.patch['load']!.mode, 'void', 'recorded void')
  eq(tr.emitted, [`unwritable:${gone.p.key}`], 'the reason is recorded')
  const kept = decide(ownerOnly)
  near(nOf(kept.x.ledger.head.state['squat']!['load']!), nOf(kept.p.fields['load']!), 'owner acceptance counts as an owner write: applied')
})
t('EC-136', 'RP: the weekly gap buys WEEKLY sets: after allocation a muscle’s issued week equals its target, even when the cable fly (trained twice a week) wins', () => {
  const ord = (scale: string, level: number) => ({ v: 'ord', scale, level }) as Value
  const said = (fact: string, key: string, value: Value): FactReading => ({ fact, key, value, observedOn: day('2026-10-08') })
  const post = [said('soreness', 'chest', ord('soreness', 0)), said('pump', 'chest', ord('pump', 1)), said('jointPain', 'flatDb', ord('jointPain', 2)), said('jointPain', 'inclineDb', ord('jointPain', 2))]
  let r = trainAs(start(P.rpMeso.def), ['rp-a1', 'rp-b1'], D0, asPrescribed, 3, post).run
  const p = Object.values(r.ledger.head.pending).find((x) => x.scope === 'program' && 'extra' in x.fields)
  assert(p, 'the allocation is proposed')
  r = { ...r, ledger: ingest(r.rt, r.ledger, { k: 'proposalDecided', causeKey: 'decision:rp', proposalKey: p.key, accepted: true }).ledger }
  const target = stateOf(r, 'program', 'target')
  const chestTarget = target.v === 'map' ? nOf(target.entries.find(([k]) => k === 'chest')![1]) : NaN
  near(chestTarget, 12, 'MEV 10 + 2 earned')
  const fly = Object.keys(r.rt.def.slots).filter((s) => JSON.stringify(r.rt.def.slots[s]!.args).includes('wger:122'))
  const extra = stateOf(r, 'program', 'extra')
  assert(extra.v === 'map' && extra.entries.some(([k, v]) => fly.includes(k) && nOf(v) > 0), `the fly won sets: ${JSON.stringify(extra)}`)
  const chest = Object.keys(r.rt.def.slots).filter((s) => r.rt.def.slots[s]!.meta.muscles['chest'] === 1)
  const week = trainAs(r, ['rp-a2', 'rp-b2'], day('2026-10-12'), asPrescribed, 3).issued
  const issuedChest = week.flatMap((i) => i.slots).filter((sl) => chest.includes(sl.slot)).reduce((a, sl) => a + sl.steps.reduce((b, st) => b + (st.count.k === 'n' ? st.count.n : NaN), 0), 0)
  eq(issuedChest, 12, 'chest sets issued across week 1')
})
t('EC-136', 'every allocation candidate of a worked program is trained once a week, so a per-slot extra is a weekly set', () => {
  for (const def of [P.rpMeso.def]) {
    const r = start(def)
    for (const m of def.muscles) {
      const among = aggPort(r.rt, r.ledger.head, { facts: F, today: D0, earlierToday: 0, reads: newReads() })({ q: 'slotsFor', muscle: m })
      for (const s of among.v === 'list' ? among.items : []) eq([s.v === 'ref' && s.id, sessionsPerWeek(def, s.v === 'ref' ? s.id : '')], [s.v === 'ref' && s.id, 1], `${def.ref.id} ${m}`)
    }
  }
})
done()
