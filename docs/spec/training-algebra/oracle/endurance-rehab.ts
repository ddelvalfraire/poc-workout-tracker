/**
 * endurance-rehab.ts — the cardio and rehab worked programs: Couch to 5K
 * (repeat blocks, recovery steps, a week repeated on a miss), an HR-zone
 * tempo block (heart-rate targets judged from a reduced fact, a pace unit),
 * and a pain-gated Achilles return (a 0–10 pain fact on two clocks, a
 * proposed regression, a criteria phase that proposes at its max and has a
 * calendar time floor).
 */
import { add, and, byVerdict, days, exercise, ge, gt, iff, kg, known, le, list1, lt, lvl, max, min, mins, mul, no, nth, num, orElse, pct, q, reps, sec, sets, sub, ty, yes, type Expr, type Ex, type Opt, type PlanCap, type Q, type SessionT } from './algebra'
import { atMost, exportState, freq, macro, per, phase, program, range, scaleSets, scheme, sel, session, set, single, tempo, type StepBuilder } from './structure'
import { localDay } from './time'

// ═══════════════════════════════════════════════════════════════════════════
// (i) Couch to 5K (NHS): a ladder of nine week-sessions
// ═══════════════════════════════════════════════════════════════════════════

const RUN = exercise('run')
type Steps = StepBuilder<PlanCap, 'duration' | 'distance' | 'pace' | 'hr'>
const run = (m: number) => set({ target: { duration: mins(m) } })
/** A walk is a STEP with its own target, not rest: it is logged and judged. */
const walk = (m: number) => set({ role: 'recovery', target: { duration: mins(m) } })

const week = (body: (b: Steps) => void): Expr<SessionT, PlanCap> =>
  session({
    exercise: RUN,
    steps: (b) => {
      b.step('warmup', sets(1), set({ role: 'warmup', target: { duration: mins(5) } }))
      body(b)
      b.step('cooldown', sets(1), walk(5))
    },
  })
const intervals = (n: number, on: number, off: number) => (b: Steps) =>
  b.repeat('intervals', n, (r) => {
    r.step('run', sets(1), run(on))
    r.step('walk', sets(1), walk(off))
  })
/** Weeks 5 and 6 vary by day in the NHS plan; each rung here is its first day. */
const C25K_WEEKS: [Expr<SessionT, PlanCap>, ...Expr<SessionT, PlanCap>[]] = [
  week(intervals(8, 1, 1.5)),
  week(intervals(6, 1.5, 2)),
  week((b) =>
    b.repeat('intervals', 2, (r) => {
      r.step('short', sets(1), run(1.5))
      r.step('walk1', sets(1), walk(1.5))
      r.step('long', sets(1), run(3))
      r.step('walk2', sets(1), walk(3))
    }),
  ),
  week((b) => {
    b.step('run1', sets(1), run(3))
    b.step('walk1', sets(1), walk(1.5))
    b.step('run2', sets(1), run(5))
    b.step('walk2', sets(1), walk(2.5))
    b.step('run3', sets(1), run(3))
    b.step('walk3', sets(1), walk(1.5))
    b.step('run4', sets(1), run(5))
  }),
  week(intervals(3, 5, 3)),
  week(intervals(2, 10, 3)),
  week((b) => void b.step('run', sets(1), run(25))),
  week((b) => void b.step('run', sets(1), run(28))),
  week((b) => void b.step('run', sets(1), run(30))),
]

export const c25k = scheme({
  id: 'lib/c25k',
  version: 1,
  says: 'Couch to 5K: nine weeks of run/walk sessions, three a week; move to the next week after three sessions with every run completed, and repeat the week if you have to stop a run',
  params: {},
  state: { week: ty.q('one'), done: ty.q('one') },
  writableBy: { week: ['session', 'owner'], done: ['session', 'owner'] },
  nouns: { week: 'programme week', done: 'completed sessions this week' },
  init: () => ({ week: num(0), done: num(0) }),
  plan: (c) => nth(list1(ty.session(), ...C25K_WEEKS), c.s.week, 'hold'),
  on: {
    session: (c) =>
      byVerdict(c.ev.verdict(), {
        hit: iff(ge(add(c.s.done, num(1)), num(3)), c.commit({ week: min(add(c.s.week, num(1)), num(8)), done: num(0) }), c.commit({ done: add(c.s.done, num(1)) })),
        missed: c.commit({ done: num(0) }),
        unknown: c.keep,
      }),
  },
})

export const couchTo5k = program({
  id: 'prog/c25k',
  version: 1,
  says: 'Couch to 5K: three runs a week with a rest day between, progressing by completed sessions, not by the calendar',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  muscles: ['legs'],
  slots: () => ({ run: c25k.bind({}, { muscles: { legs: 1 } }) }),
  days: { R: [single('run')] },
  rotation: { k: 'weekly', days: ['R', 'R', 'R'] },
  frequency: () => [freq.atLeast(3, sel.any(), per.week()), freq.minGap(sel.any(), days(2), 2)],
  exports: { weekReached: exportState('run', 'week', ty.q('one')) },
})

// ═══════════════════════════════════════════════════════════════════════════
// (j) HR-zone tempo: heart rate judged from the HR trace, a pace in min/km
// ═══════════════════════════════════════════════════════════════════════════

const ROAD = exercise('road-run')
const ofLthr = (c: { fact: (f: 'lthr') => Expr<Opt<Q<'heartRate'>>, 'fact'> }, p: number) => known(c.fact('lthr'), (l) => mul(l, pct(p)))

export const hrTempo = scheme({
  id: 'lib/hr-tempo',
  version: 1,
  says: 'A tempo run on {run}: easy warm-up, then a tempo block at no slower than {pace} with heart rate held at 85–89% of threshold, growing by {grow} each time you hold it without a very hard Borg rating, up to {cap}',
  params: { run: ty.exercise('cardio'), pace: ty.q('pace'), grow: ty.q('time'), cap: ty.q('time'), start: ty.q('time') },
  // C10: the starting tempo-block length is a coaching default.
  defaults: { start: mins(20) },
  facts: ['lthr', 'avgHr', 'borg'],
  state: { block: ty.q('time') },
  writableBy: { block: ['session', 'owner'] },
  nouns: { block: 'tempo block' },
  init: (c) => ({ block: c.p.start }),
  plan: (c) =>
    session({
      exercise: c.p.run,
      steps: (b) => {
        b.step('warmup', sets(1), set({ role: 'warmup', target: { duration: mins(15), hr: atMost(ofLthr(c, 80)) } }))
        b.step('tempo', sets(1), set({ target: { duration: c.s.block, pace: atMost(c.p.pace), hr: range(ofLthr(c, 85), ofLthr(c, 89)) } }))
        b.step('cooldown', sets(1), set({ role: 'recovery', target: { duration: mins(10) } }))
      },
    }),
  on: {
    session: (c) =>
      byVerdict(c.ev.verdict(['tempo']), {
        hit: iff(orElse(known(c.fact('borg'), (r) => lt(r, lvl('borg', 17))), yes), c.commit({ block: min(add(c.s.block, c.p.grow), c.p.cap) }), c.keep),
        missed: c.keep,
        unknown: c.keep,
      }),
  },
})

export const easyRun = scheme({
  id: 'lib/easy-run',
  version: 1,
  says: '{minutes} easy on {run}, heart rate under 75% of threshold',
  params: { run: ty.exercise('cardio'), minutes: ty.q('time') },
  facts: ['lthr', 'avgHr'],
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) => session({ exercise: c.p.run, steps: (b) => void b.step('easy', sets(1), set({ target: { duration: c.p.minutes, hr: atMost(ofLthr(c, 75)) } })) }),
  on: {},
})

export const hrTempoBlock = program({
  id: 'prog/hr-tempo-block',
  version: 1,
  says: 'A threshold block: one tempo run, two easy runs and a long run each week, hard runs at least two days apart',
  params: {},
  calendar: { weeks: ['train', 'train', 'train', 'deload'], repeat: 'cycle' },
  muscles: ['legs'],
  slots: () => ({
    tempo: hrTempo.bind({ run: ROAD, pace: q(4.75, 'minPerKm'), grow: mins(5), cap: mins(40) }, { muscles: { legs: 1 }, tags: ['hard'] }),
    easy: easyRun.bind({ run: ROAD, minutes: mins(45) }, { muscles: { legs: 1 } }),
    long: easyRun.bind({ run: ROAD, minutes: mins(80) }, { muscles: { legs: 1 }, tags: ['hard'] }),
  }),
  days: { T: [single('tempo')], E: [single('easy')], L: [single('long')] },
  rotation: { k: 'weekly', days: ['T', 'E', 'E', 'L'] },
  frequency: () => [freq.atLeast(4, sel.any(), per.week()), freq.minGap(sel.tag('hard'), days(2), 2)],
})

// ═══════════════════════════════════════════════════════════════════════════
// (k) Pain-gated Achilles return: isometrics, then pain-monitored loading
// ═══════════════════════════════════════════════════════════════════════════

const CALF_HOLD = exercise('calf-iso')
const HEEL_DROP = exercise('heel-drop')

export const isoHold = scheme({
  id: 'lib/iso-hold',
  version: 1,
  says: '{sets} of {hold} holds on {lift}, resting 2 min between holds, for pain relief',
  params: { lift: ty.exercise('timed'), sets: ty.q('sets'), hold: ty.q('time') },
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('hold', c.p.sets, set({ target: { duration: c.p.hold }, rest: mins(2) })) }),
  on: {},
})

/** Silbernagel's three clocks: pain DURING the session gates the next
 *  progression, pain the NEXT MORNING gates the next session, and a flare
 *  only ever PROPOSES a regression (medical: the clinician's call). */
export const painGated = scheme({
  id: 'lib/pain-gated-loading',
  version: 1,
  says: '3×15 straight-knee and 3×15 bent-knee {lift}s; add {inc} after a session done in full with pain at 2/10 or less; above 5/10, propose taking {inc} off; a bad morning cuts each exercise to two sets',
  params: { lift: ty.exercise('weighted_bodyweight'), inc: ty.q('mass'), morningGate: ty.ord('pain') },
  // C10: the “bad morning” cutoff is a coaching default; the in-session
  // 2/10 and 5/10 gates are the method's published numbers and stay literal.
  defaults: { morningGate: lvl('pain', 4) },
  facts: ['pain', 'morningPain'],
  state: { added: ty.q('mass'), flares: ty.q('one') },
  writableBy: { added: ['session', 'owner'], flares: ['session'] },
  nouns: { added: 'added load', flares: 'flare-ups in a row' },
  init: () => ({ added: kg(0), flares: num(0) }),
  plan: (c) => {
    const drops = session({
      exercise: c.p.lift,
      steps: (b) => {
        b.step('straight', sets(3), set({ target: { reps: reps(15), load: c.s.added }, tempo: tempo(3, 0, 1, 0) }))
        b.step('bent', sets(3), set({ target: { reps: reps(15), load: c.s.added }, tempo: tempo(3, 0, 1, 0) }))
      },
    })
    return iff(orElse(known(c.fact('morningPain'), (p) => gt(p, c.p.morningGate)), no), scaleSets(drops, pct(67)), drops)
  },
  on: {
    session: (c) =>
      orElse(
        known(c.fact('pain'), (p) =>
          iff(
            gt(p, lvl('pain', 5)),
            c.propose({ added: max(kg(0), sub(c.s.added, c.p.inc)), flares: add(c.s.flares, num(1)) }),
            byVerdict(c.ev.verdict(), {
              hit: iff(le(p, lvl('pain', 2)), c.commit({ added: add(c.s.added, c.p.inc), flares: num(0) }), c.commit({ flares: num(0) })),
              missed: c.commit({ flares: num(0) }),
              unknown: c.keep,
            }),
          ),
        ),
        c.keep,
      ),
  },
})

export const achillesIsometric = program({
  id: 'prog/achilles-isometric',
  version: 1,
  says: 'Achilles pain modulation: daily isometric calf holds',
  params: {},
  facts: ['morningPain'],
  calendar: { weeks: ['train'], repeat: 'cycle' },
  muscles: ['calves'],
  slots: () => ({ iso: isoHold.bind({ lift: CALF_HOLD, sets: sets(5), hold: sec(45) }, { muscles: { calves: 1 } }) }),
  days: { I: [single('iso')] },
  rotation: { k: 'daily', days: ['I'], perDay: 1 },
})

export const achillesLoading = program({
  id: 'prog/achilles-loading',
  version: 1,
  says: 'Achilles loading: pain-monitored eccentric heel drops, twice a day',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  grids: { load: kg(1) },
  muscles: ['calves'],
  slots: () => ({ drops: painGated.bind({ lift: HEEL_DROP, inc: kg(2.5) }, { muscles: { calves: 1 } }) }),
  days: { D: [single('drops')] },
  rotation: { k: 'daily', days: ['D'], perDay: 2 },
})

export const achillesReturn = macro({
  id: 'macro/achilles-return',
  version: 1,
  says: 'Achilles return: isometrics until morning pain settles (no earlier than two weeks after the start), then pain-monitored loading',
  anchor: { k: 'startOn', date: localDay('2026-09-14') },
  drift: 'slide',
  phases: [
    phase(
      'Pain modulation',
      achillesIsometric,
      { k: 'bounded', min: 2, max: 6, advanceWhen: (cur) => and(orElse(known(cur.fact('morningPain'), (p) => le(p, lvl('pain', 2))), no), ge(cur.cal.day, days(14))) },
      () => ({}),
    ),
    phase('Progressive loading', achillesLoading, { k: 'open' }, () => ({})),
  ],
})

export const PUBLISHED = [c25k, couchTo5k, hrTempo, easyRun, hrTempoBlock, isoHold, painGated, achillesIsometric, achillesLoading, achillesReturn] as const
export type { Ex }
