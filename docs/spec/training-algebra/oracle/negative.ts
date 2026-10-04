/**
 * negative.ts — compile-time negatives. Each `@ts-expect-error` line MUST fail
 * to typecheck (tsc fails on an unused directive), and each fails on the line
 * below it for the reason its directive names (verify.sh strips the
 * directives and checks the error lines).
 *
 * The IR checker is the typing authority; the embedding is best-effort.
 * Every refusal here has an IR twin in demo.ts §3 (TS-refused ⇒ IR-refused).
 * The converse is demo.ts §3's converse corpus (IR-accepted ⇒ it typechecks
 * here, or it is a listed embedding gap). Rules the embedding does NOT carry,
 * so only the IR refuses them: the budget, frequency feasibility, group rest,
 * the EMOM count rule, a reduced metric's fact, publication order, imports,
 * macro shapes beyond peakOn, threshold ORDER, allocate's n against its
 * bound, a let's label being non-empty, the two clock sorts (`cal.count` and
 * `pos.slotSession` are both counts here), a swap's or reshape's logging
 * check, role double-encoding, an outcome rule's dead kind, policy order.
 */
import {
  add,
  allMuscles,
  allSlots,
  no,
  yes,
  allocate,
  asReps,
  byVerdict,
  days,
  exercise,
  fn,
  ge,
  iff,
  is,
  kg,
  known,
  list1,
  lt,
  lvl,
  match,
  mins,
  mul,
  none,
  nth,
  num,
  orElse,
  pct,
  rate,
  reps,
  rir,
  sets,
  slotRef,
  table,
  tabulate,
  ty,
  wk,
  type Expr,
  type PlanCap,
  type Q,
  type Ref,
  muscle,
} from './algebra'
import { aggQ, amrap, cal, ev, fact, macro, phase, pos, program, scheme, session, set, single } from './structure'
import { GZ_T1, optLoaded, optStabilization } from './programs'
import { localDay } from './time'

const BENCH = exercise('wger:192')

// ── Units, ordinals, absence, exhaustiveness, anchors ───────────────────────

// @ts-expect-error unit error: kg + reps
add(kg(5), reps(3))
// @ts-expect-error unit error: kg × kg is not a named dimension
mul(kg(5), kg(3))
// @ts-expect-error ordinals do not add: soreness + pump
add(lvl('soreness', 1), lvl('pump', 2))
// @ts-expect-error RIR is not a rep count until converted with asReps
add(reps(5), rir(2))
// @ts-expect-error absence must be handled: Opt<kg> where kg is required
mul(none(ty.q('mass')), pct(90))
// @ts-expect-error non-exhaustive match over a DECLARED enum: GZCLP stage 'retest' missing
match(GZ_T1.tag('5x3'), { '5x3': sets(1), '6x2': sets(1), '10x1': sets(1) })
// @ts-expect-error non-exhaustive table: pump level 3 missing
table(lvl('pump', 1), { 0: sets(1), 1: sets(1), 2: sets(1) })
// @ts-expect-error a table threshold is a LITERAL quantity, never a computed one
table(reps(5), [[add(reps(1), reps(1)), kg(1)]], kg(0))
// @ts-expect-error a rep count is not an effort target
set({ target: { reps: reps(5), effort: reps(2) } })
// @ts-expect-error a peak anchor admits only fixed-length phases
macro({ id: 'macro/bad-peak', version: 1, says: 'x', anchor: { k: 'peakOn', date: localDay('2027-03-01') }, drift: 'anchored', phases: [phase('Stab', optStabilization, { k: 'bounded', min: 4, max: 6, advanceWhen: () => no }, () => ({}))] })

// ── Capabilities and positions ──────────────────────────────────────────────

const host = (plan: () => Expr<import('./algebra').SessionT, PlanCap>) => scheme({ id: 'neg/host', version: 1, says: 'x', params: {}, state: {}, writableBy: {}, init: () => ({}), plan, on: {} })

host(() =>
  session({
    exercise: BENCH,
    steps: (b) => {
      const top = b.step('top', sets(1), set({ role: 'amrap', target: { reps: amrap(reps(5)), load: kg(100) } }))
      // Positive control: a set TARGET may read the earlier step (APRE). Compiles.
      b.step('backoff', sets(2), set({ target: { reps: reps(5), load: orElse(known(top.read('load'), (l) => mul(l, pct(90))), kg(90)) } }))
      // @ts-expect-error a set COUNT is a plan position: it may not read a performed set
      b.step('more', orElse(known(top.read('reps'), () => sets(2)), sets(1)), set({ target: { reps: reps(5) } }))
      // @ts-expect-error an event read (the closing session's facts) is not available in a plan
      b.step('w', sets(3), set({ target: { reps: reps(5), load: orElse(ev.metric('top', 'load'), kg(100)) } }))
      // @ts-expect-error an aggregate read (program structure) is program scope only, not slot scope
      b.step('agg', aggQ.setsFor(slotRef('bench'), 'slot'), set({ target: { reps: reps(5) } }))
      // @ts-expect-error a post-session fact is about the closing session: a plan may not read it
      b.step('pump', iff(orElse(known(fact('pump', muscle('chest')), (p) => ge(p, lvl('pump', 2))), no), sets(3), sets(2)), set({ target: { reps: reps(5) } }))
      // Positive control: a pre-session fact and the calendar ARE plan reads, as conditions. Compiles.
      b.step('fresh', iff(orElse(known(fact('readiness'), (r) => ge(r, lvl('readiness', 3))), no), sets(3), sets(2)), set({ target: { reps: iff(ge(cal.day, days(14)), reps(8), reps(5)) } }))
    },
  }),
)

scheme({
  id: 'neg/writable',
  version: 1,
  says: 'x',
  params: {},
  state: { tm: ty.opt(ty.q('mass')), missed: ty.bool() },
  writableBy: { tm: ['cycleEnd', 'owner'], missed: ['session', 'cycleEnd', 'periodClosed'] },
  init: () => ({ tm: none(ty.q('mass')), missed: no }),
  plan: () => session({ exercise: BENCH, steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(5) } })) }),
  on: {
    // Positive control: all three arms, silence decided explicitly. Compiles.
    session: (c) => c.commit({ missed: byVerdict(c.ev.verdict(), { hit: no, missed: yes, unknown: c.s.missed }) }),
    cycleEnd: (c) => c.commit({ tm: known(c.s.tm, (t) => add(t, kg(5))) }),
    // @ts-expect-error writableBy: tm is not writable at weekEnd (only cycleEnd and owner edits)
    weekEnd: (c) => c.commit({ tm: known(c.s.tm, (t) => add(t, kg(5))) }),
    // @ts-expect-error a calendar-caused handler has no commit: time alone never commits (L13)
    periodClosed: (c) => c.commit({ missed: no }),
  },
})

scheme({
  id: 'neg/verdict',
  version: 1,
  says: 'x',
  params: {},
  state: { n: ty.q('one') },
  writableBy: { n: ['session', 'periodClosed'] },
  init: () => ({ n: num(0) }),
  plan: () => session({ exercise: BENCH, steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(5) } })) }),
  on: {
    session: (c) =>
      iff(
        // @ts-expect-error the silence punisher: a verdict is matched, never compared, so `unknown` cannot fall into the miss branch
        is(c.ev.verdict(), c.ev.verdict()),
        c.commit({ n: num(0) }),
        c.commit({ n: add(c.s.n, num(1)) }),
      ),
    // @ts-expect-error a verdict match has three arms: what silence (unknown) does must be written down
    weekEnd: (c) => byVerdict(c.ev.verdict(), { hit: c.keep, missed: c.keep }),
    // @ts-expect-error a calendar-caused handler has no mixed patch either: it may only propose or keep (L13)
    periodClosed: (c) => c.patch({ n: num(0) }),
  },
})

scheme({
  id: 'neg/old-verdict',
  version: 1,
  says: 'x',
  params: {},
  state: { n: ty.q('one') },
  writableBy: { n: ['session'] },
  // @ts-expect-error a state field's kind is DERIVED from its sort: there is no label to set (or to lie with)
  kinds: { n: 'flag' },
  init: () => ({ n: num(0) }),
  plan: () => session({ exercise: BENCH, steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(5) } })) }),
  on: {
    // @ts-expect-error the two-valued hitAll is gone: a session is judged hit, missed or unknown
    session: (c) => iff(c.ev.hitAll(), c.keep, c.keep),
  },
})

scheme({
  id: 'neg/init-clock',
  version: 1,
  says: 'x',
  params: {},
  state: { rung: ty.q('one'), start: ty.q('one') },
  writableBy: { rung: ['session'], start: ['session'] },
  init: () => ({
    // @ts-expect-error init grants only params and facts: the progress clock is not known yet
    rung: pos.slotSession,
    // @ts-expect-error init grants no calendar read: there is no stamped day before the first prescribe
    start: iff(ge(cal.day, days(3)), num(1), num(0)),
  }),
  plan: () => session({ exercise: BENCH, steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(5) } })) }),
  on: {},
})

fn<{ x: Q<'one'> }, Q<'one'>>({
  id: 'neg/impure-fn',
  version: 1,
  params: { x: ty.q('one') },
  result: ty.q('one'),
  says: '{x}',
  examples: [{ args: { x: num(1) }, gives: num(1) }],
  // @ts-expect-error a named definition's body reads only its parameters (no clock, no state)
  body: (p) => add(p.x, pos.slotSession),
})

fn<{ x: Q<'one'> }, Q<'one'>>({
  id: 'neg/calendar-fn',
  version: 1,
  params: { x: ty.q('one') },
  result: ty.q('one'),
  says: '{x}',
  examples: [{ args: { x: num(1) }, gives: num(1) }],
  // @ts-expect-error a named definition may not read the calendar: pass the read in at a plan position
  body: (p) => iff(ge(cal.day, days(1)), p.x, p.x),
})

program({
  id: 'neg/alloc-bound',
  version: 1,
  says: 'x',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  slots: () => ({}),
  days: { A: [single('a')] },
  rotation: { k: 'weekly', days: ['A'] },
  aggregate: {
    state: { extra: ty.map('slot', ty.q('sets')) },
    writableBy: { extra: ['weekEnd'] },
    init: () => ({ extra: tabulate(allSlots, () => sets(0)) }),
    on: {
      weekEnd: (c) =>
        c.commit({
          // @ts-expect-error allocate's loop bound is a literal, never a term (here: a set count)
          extra: allocate({ n: sets(2), into: c.s.extra, among: c.slotsFor(muscle('chest')), score: () => num(1), cap: () => sets(4), max: sets(8) }),
        }),
    },
  },
})

let leaked: Expr<Ref<'muscle'>, 'elem'> | undefined
tabulate(allMuscles, (m) => {
  leaked = m
  return sets(1)
})
host(() =>
  session({
    exercise: BENCH,
    steps: (b) =>
      // @ts-expect-error a binder variable carries `elem`, which no position grants: it cannot escape its binder
      void b.step('w', table(leaked!, { chest: sets(2) }, sets(1)), set({ target: { reps: reps(5) } })),
  }),
)

// ── Metrics, clocks, references ─────────────────────────────────────────────

const PLANK = exercise('plank')
const RUN = exercise('run')
host(() =>
  session({
    exercise: PLANK,
    // @ts-expect-error a load on a timed hold: its logging type logs duration and range of motion only
    steps: (b) => void b.step('w', sets(3), set({ target: { duration: mins(1), load: kg(10) } })),
  }),
)
host(() =>
  session({
    exercise: RUN,
    // @ts-expect-error reps on a run: a cardio exercise logs duration, distance, pace and heart rate
    steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(10) } })),
  }),
)
const MIXED = list1(ty.exercise('bodyweight_reps', 'weight_reps'), exercise('push-up'), BENCH)
host(() =>
  session({
    exercise: nth(MIXED, num(0), 'hold'),
    // @ts-expect-error a ladder mixing bodyweight and loaded rungs may target only what EVERY rung logs: no load
    steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(8), load: kg(20) } })),
  }),
)
// @ts-expect-error an exercise is its registry id: an author-supplied label (that could lie) does not exist
exercise('wger:105', 'Barbell Back Squat')
// @ts-expect-error an exercise id the registry does not know
exercise('wger:nope')
// @ts-expect-error borg is not RIR: a Borg rating is not an effort target
set({ target: { reps: reps(5), effort: lvl('borg', 15) } })
// @ts-expect-error borg is not RIR: a Borg rating does not compare with reps in reserve
lt(lvl('borg', 15), rir(2))
// @ts-expect-error the calendar and progress clocks never mix: days + weeks
add(days(2), wk(1))
// @ts-expect-error no rate is per day or per week: it would turn the passing of time into load
rate(0.25, 'kg', 'd')
// @ts-expect-error a calendar day cannot index a progression: positions follow the progress clock
nth(list1(ty.q('sets'), sets(3), sets(4)), cal.day, 'hold')
// @ts-expect-error rest inside a session is seconds, never calendar days
set({ target: { reps: reps(5) }, rest: days(2) })
// @ts-expect-error asReps takes parameters and literals only: it belongs to a definition body
asReps(null! as Expr<Q<'effort'>, 'state'>)
// @ts-expect-error a peakOn macro needs anchored drift: the meet does not move when training slips
macro({ id: 'macro/bad-drift', version: 1, says: 'x', anchor: { k: 'peakOn', date: localDay('2027-03-01') }, drift: 'slide', phases: [phase('Block', optLoaded, { k: 'fixed' }, () => ({ benchStart: none(ty.q('mass')) }))] })
// @ts-expect-error recursion is unrepresentable in the embedding: a definition cannot name itself in its own body
const selfRef = fn<{ x: Q<'one'> }, Q<'one'>>({ id: 'neg/self', version: 1, params: { x: ty.q('one') }, result: ty.q('one'), says: '{x}', examples: [{ args: { x: num(1) }, gives: num(1) }], body: (p) => selfRef({ x: p.x }) })
