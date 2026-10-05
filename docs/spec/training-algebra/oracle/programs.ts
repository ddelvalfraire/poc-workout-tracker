/**
 * programs.ts — the strength and hypertrophy worked programs, plus the
 * prelude they share. Every training method lives in a definitions file;
 * the engine knows none. endurance-rehab.ts holds the cardio and rehab ones.
 */
import {
  type Opt,
  type Ord,
  type Q,
  type SessionT,
  type TempoT,
  add,
  allMuscles,
  allocate,
  and,
  at,
  table,
  declareEnum,
  exercise,
  fn,
  foldOver,
  ge,
  iff,
  is,
  le,
  kg,
  known,
  known2,
  knownThen,
  letv,
  lt,
  lvl,
  match,
  byVerdict,
  max,
  min,
  named,
  mul,
  neg,
  no,
  nth,
  num,
  or,
  orElse,
  pct,
  rate,
  ratio,
  reps,
  rir,
  roundTo,
  schedule,
  allSlots,
  sets,
  sec,
  some,
  sub,
  tabulate,
  tag,
  ty,
  asReps,
  lb,
  list1,
  none,
  type Expr,
  type BindCap,
  type Ex,
} from './algebra'
import {
  amrap,
  capEffort,
  exportState,
  freq,
  importFrom,
  macro,
  per,
  phase,
  policy,
  program,
  proposed,
  range,
  reshape,
  scaleMetric,
  scaleSets,
  scheme,
  sel,
  session,
  set,
  setTempo,
  setsBetween,
  single,
  stripIntensifier,
  superset,
  circuit,
  technique,
  tempo,
  use,
  peerState,
  type PrevView,
  type WeeklyOpts,
} from './structure'
import { localDay } from './time'
import { DOUBLE_PROGRESSION_V1, GZCLP_T1_V1, W531_JOKERS_V1 } from './defs-v1'
import { GZCLP_T1_PROG_V1, LEGS_3X_V1, OPT_LOADED_V1, OPT_MACRO_V1, OPT_POWER_V1, OPT_STRENGTH_ENDURANCE_V1 } from './progs-v1'

// ═══════════════════════════════════════════════════════════════════════════
// Prelude: named, templated, example-checked functions (D2)
// ═══════════════════════════════════════════════════════════════════════════

/** Inverse Epley: w = e1RM × 30 / (30 + reps + RIR). With no division former
 *  it is a ratio, which is absent only if the denominator is zero. */
export const loadFor = fn<{ e1rm: Q<'mass'>; reps: Q<'reps'>; rir: Q<'effort'> }, Opt<Q<'mass'>>>({
  id: 'lib/load-for',
  version: 1,
  params: { e1rm: ty.q('mass'), reps: ty.q('reps'), rir: ty.q('effort') },
  result: ty.opt(ty.q('mass')),
  says: 'the load you could lift for {reps} with {rir}, given an estimated max of {e1rm}',
  examples: [{ args: { e1rm: kg(120), reps: reps(5), rir: rir(1) }, gives: some(kg(100)) }],
  body: (p) => known(ratio(reps(30), add(reps(30), add(p.reps, asReps(p.rir)))), (r) => mul(p.e1rm, r)),
})

/** THE HARD CASE (computed increment). Juggernaut's realization-week rule. */
export const juggernautBump = fn<{ amrap: Q<'reps'>; standard: Q<'reps'>; perRep: Q<'massPerRep'> }, Q<'mass'>>({
  id: 'lib/juggernaut-bump',
  version: 1,
  params: { amrap: ty.q('reps'), standard: ty.q('reps'), perRep: ty.q('massPerRep') },
  result: ty.q('mass'),
  says: '{perRep} for every rep past {standard} on the AMRAP set ({amrap})',
  examples: [
    { args: { amrap: reps(13), standard: reps(10), perRep: rate(2.5, 'kg', 'rep') }, gives: kg(7.5) },
    { args: { amrap: reps(8), standard: reps(10), perRep: rate(2.5, 'kg', 'rep') }, gives: kg(0) },
  ],
  body: (p) => mul(p.perRep, max(reps(0), sub(p.amrap, p.standard))),
})

export const juggernautRealization = scheme({
  id: 'lib/juggernaut-realization',
  version: 1,
  says: 'Juggernaut realization week on {lift}: an AMRAP at the training max; the training max then rises by {perRep} for every rep past {standard}',
  params: { lift: ty.exercise('weight_reps'), standard: ty.q('reps'), perRep: ty.q('massPerRep') },
  facts: ['e1rm'],
  state: { tm: ty.opt(ty.q('mass')) },
  writableBy: { tm: ['session', 'owner'] },
  nouns: { tm: 'training max' },
  init: (c) => ({ tm: known(c.fact('e1rm', c.p.lift), (e) => mul(e, pct(90))) }),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('amrap', sets(1), set({ role: 'amrap', target: { reps: amrap(c.p.standard), load: c.s.tm } })) }),
  on: {
    session: (c) =>
      c.commit({
        tm: orElse(
          known2(c.s.tm, c.ev.metric('amrap', 'reps'), (tm, r) => add(tm, juggernautBump({ amrap: r, standard: c.p.standard, perRep: c.p.perRep }))),
          c.s.tm,
        ),
      }),
  },
})

/** APRE's adjustment chart as a total table (renders as a table). */
export const apreAdjust = fn<{ reps: Q<'reps'>; small: Q<'mass'>; big: Q<'mass'> }, Q<'mass'>>({
  id: 'lib/apre-adjust',
  version: 1,
  params: { reps: ty.q('reps'), small: ty.q('mass'), big: ty.q('mass') },
  result: ty.q('mass'),
  says: 'the APRE adjustment for {reps} on the max set, in steps of {small} and {big}',
  examples: [
    { args: { reps: reps(9), small: lb(5), big: lb(10) }, gives: lb(5) },
    { args: { reps: reps(2), small: lb(5), big: lb(10) }, gives: lb(-10) },
  ],
  body: (p) =>
    table(
      p.reps,
      [
        [reps(2), neg(p.big)],
        [reps(4), neg(p.small)],
        [reps(7), kg(0)],
        [reps(12), p.small],
      ],
      p.big,
    ),
})

export const rpSetDelta = fn<{ soreness: Ord<'soreness'>; pump: Ord<'pump'> }, Q<'sets'>>({
  id: 'lib/rp-set-delta',
  version: 1,
  params: { soreness: ty.ord('soreness'), pump: ty.ord('pump') },
  result: ty.q('sets'),
  says: 'the sets to add next week given {soreness} and {pump}',
  examples: [{ args: { soreness: lvl('soreness', 0), pump: lvl('pump', 1) }, gives: sets(2) }],
  body: (p) => {
    const healedEarly = table(p.pump, { 0: sets(2), 1: sets(2), 2: sets(1), 3: sets(1) })
    const healedOnTime = table(p.pump, { 0: sets(1), 1: sets(1), 2: sets(1), 3: sets(0) })
    return table(p.soreness, { 0: healedEarly, 1: healedOnTime, 2: sets(0), 3: sets(0) })
  },
})

export const sfrScore = fn<{ pump: Ord<'pump'>; joint: Ord<'jointPain'> }, Q<'one'>>({
  id: 'lib/sfr-score',
  version: 1,
  params: { pump: ty.ord('pump'), joint: ty.ord('jointPain') },
  result: ty.q('one'),
  says: 'the stimulus-to-fatigue score from {pump} and {joint}',
  examples: [{ args: { pump: lvl('pump', 3), joint: lvl('jointPain', 0) }, gives: num(3) }],
  body: (p) => {
    const painFree = table(p.pump, { 0: num(0), 1: num(1), 2: num(2), 3: num(3) })
    const mildPain = table(p.pump, { 0: num(-1), 1: num(0), 2: num(1), 3: num(2) })
    return table(p.joint, { 0: painFree, 1: mildPain, 2: num(-5), 3: num(-9) })
  },
})

/** A deload as a session→session function. Metric-aware: load scales by
 *  `load`, timed work by `timed` (100% leaves holds and runs untouched), and
 *  the intensifier goes. */
export const deloadStd = fn<{ s: SessionT; load: Q<'one'>; timed: Q<'one'>; volume: Q<'one'>; rir: Q<'effort'> }, SessionT>({
  id: 'lib/deload',
  version: 1,
  params: { s: ty.session(), load: ty.q('one'), timed: ty.q('one'), volume: ty.q('one'), rir: ty.q('effort') },
  result: ty.session(),
  says: 'deload {s}: {load} of the load, {timed} of any timed work, {volume} of the sets, at least {rir}, and no intensifier',
  examples: [
    {
      args: {
        s: session({ exercise: exercise('ex:demo'), steps: (b) => void b.step('w', sets(4), set({ target: { reps: reps(8), load: kg(100) } })) }),
        load: pct(90),
        timed: pct(100),
        volume: pct(50),
        rir: rir(3),
      },
      gives: session({ exercise: exercise('ex:demo'), steps: (b) => void b.step('w', sets(2), set({ target: { reps: reps(8), load: kg(90), effort: rir(3) } })) }),
    },
  ],
  body: (p) => stripIntensifier(capEffort(scaleSets(scaleMetric(scaleMetric(p.s, 'load', p.load), 'duration', p.timed), p.volume), p.rir)),
})

export const withTempo = fn<{ s: SessionT; t: TempoT }, SessionT>({
  id: 'lib/with-tempo',
  version: 1,
  params: { s: ty.session(), t: ty.tempo() },
  result: ty.session(),
  says: '{s}, every rep at tempo {t}',
  examples: [
    {
      args: { s: session({ exercise: exercise('ex:demo'), steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(5) } })) }), t: tempo(4, 2, 1, 0) },
      gives: session({ exercise: exercise('ex:demo'), steps: (b) => void b.step('w', sets(1), set({ target: { reps: reps(5) }, tempo: tempo(4, 2, 1, 0) })) }),
    },
  ],
  body: (p) => setTempo(p.s, p.t),
})

const SQUAT = exercise('wger:111')
const BENCH = exercise('wger:192')
const DEAD = exercise('wger:105')
const PRESS = exercise('wger:119')

// ═══════════════════════════════════════════════════════════════════════════
// (a) Gated linear progression (D8: the library default is performance-gated)
// ═══════════════════════════════════════════════════════════════════════════

export const linearGated = scheme({
  id: 'lib/linear-gated',
  version: 1,
  says: '{sets} of {reps} on {lift}; add {inc} after every session where all sets hit; after {stalls} misses in a row, propose dropping to {backoff} of the weight',
  params: { lift: ty.exercise('weight_reps'), sets: ty.q('sets'), reps: ty.q('reps'), inc: ty.q('mass'), backoff: ty.q('one'), stalls: ty.q('one') },
  facts: ['e1rm'],
  state: { load: ty.opt(ty.q('mass')), misses: ty.q('one') },
  writableBy: { load: ['session', 'owner'], misses: ['session'] },
  nouns: { load: 'working weight', misses: 'missed sessions in a row' },
  init: (c) => ({
    load: knownThen(c.fact('e1rm', c.p.lift), (e) => loadFor({ e1rm: e, reps: c.p.reps, rir: rir(1) })),
    misses: num(0),
  }),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('work', c.p.sets, set({ target: { reps: c.p.reps, load: c.s.load } })) }),
  on: {
    // An UNLOGGED set is neither hit nor miss: silence keeps everything.
    session: (c) =>
      byVerdict(c.ev.verdict(), {
        hit: c.commit({ load: orElse(known(c.s.load, (l) => add(l, c.p.inc)), c.ev.metric('work', 'load', 'best')), misses: num(0) }),
        missed: iff(
          ge(add(c.s.misses, num(1)), c.p.stalls),
          c.patch({ load: proposed(known(c.s.load, (l) => mul(l, c.p.backoff))), misses: num(0) }),
          c.commit({ misses: add(c.s.misses, num(1)) }),
        ),
        unknown: c.keep,
      }),
  },
  examples: [
    {
      args: { lift: SQUAT, sets: sets(3), reps: reps(5), inc: kg(2.5), backoff: pct(90), stalls: num(3) },
      facts: { e1rm: kg(120) },
      assume: 'asPrescribed',
      afterSessions: 3,
      expect: { load: some(kg(107.5)), misses: num(0) },
    },
  ],
})

export const linear3x5 = program({
  id: 'prog/linear-3x5',
  version: 1,
  says: 'Three full-body sessions a week, alternating A and B, each lift gated 3×5',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  grids: { load: kg(2.5) },
  muscles: ['quads', 'chest', 'back', 'shoulders'],
  slots: () => ({
    squat: linearGated.bind({ lift: SQUAT, sets: sets(3), reps: reps(5), inc: kg(2.5), backoff: pct(90), stalls: num(3) }, { muscles: { quads: 1 } }),
    bench: linearGated.bind({ lift: BENCH, sets: sets(3), reps: reps(5), inc: kg(1.25), backoff: pct(90), stalls: num(3) }, { muscles: { chest: 1 } }),
    press: linearGated.bind({ lift: PRESS, sets: sets(3), reps: reps(5), inc: kg(1.25), backoff: pct(90), stalls: num(3) }, { muscles: { shoulders: 1 } }),
    dead: linearGated.bind({ lift: DEAD, sets: sets(1), reps: reps(5), inc: kg(5), backoff: pct(90), stalls: num(3) }, { muscles: { back: 1 } }),
  }),
  days: { A: [single('squat'), single('bench'), single('dead')], B: [single('squat'), single('press'), single('dead')] },
  rotation: { k: 'alternate', days: ['A', 'B'], perWeek: 3 },
  exports: { squatLoad: exportState('squat', 'load', ty.opt(ty.q('mass'))) },
})

// ═══════════════════════════════════════════════════════════════════════════
// (b) Top set + back-offs with APRE same-session adjustment
// ═══════════════════════════════════════════════════════════════════════════

export const apreTopBackoff = scheme({
  id: 'lib/apre-6rm',
  version: 1,
  says: 'APRE 6RM on {lift}: two ramp sets, a max-reps top set at your 6RM, then {backoffs} of back-offs whose load is adjusted by how the top set went (steps {small}/{big}), at {keep} of it',
  params: { lift: ty.exercise('weight_reps'), small: ty.q('mass'), big: ty.q('mass'), backoffs: ty.q('sets'), keep: ty.q('one') },
  facts: ['e1rm'],
  state: { rm: ty.opt(ty.q('mass')) },
  writableBy: { rm: ['session', 'owner'] },
  nouns: { rm: '6RM' },
  init: (c) => ({ rm: knownThen(c.fact('e1rm', c.p.lift), (e) => loadFor({ e1rm: e, reps: reps(6), rir: rir(0) })) }),
  plan: (c) =>
    session({
      exercise: c.p.lift,
      steps: (b) => {
        b.step('ramp1', sets(1), set({ role: 'warmup', target: { reps: reps(12), load: known(c.s.rm, (r) => mul(r, pct(50))) } }))
        b.step('ramp2', sets(1), set({ role: 'warmup', target: { reps: reps(6), load: known(c.s.rm, (r) => mul(r, pct(75))) } }))
        const top = b.step('top', sets(1), set({ role: 'amrap', target: { reps: amrap(reps(6)), load: c.s.rm } }))
        b.step(
          'backoff',
          c.p.backoffs,
          set({ role: 'backoff', target: { reps: reps(6), load: known2(top.read('load'), top.read('reps'), (l, r) => mul(add(l, apreAdjust({ reps: r, small: c.p.small, big: c.p.big })), c.p.keep)) } }),
        )
      },
    }),
  on: {
    session: (c) =>
      c.commit({
        rm: orElse(
          known2(c.ev.metric('top', 'load'), c.ev.metric('top', 'reps'), (l, r) => add(l, apreAdjust({ reps: r, small: c.p.small, big: c.p.big }))),
          c.s.rm,
        ),
      }),
  },
})

/** The slot-grid regression program (U3, promoted to the corpus in Z12 so
 *  the prose-vs-evaluation differential sees slot grids): a kg default grid
 *  with an lb slot grid and the increments CROSSED. */
export const mixedUnits = program({
  id: 'prog/mixed-units',
  version: 1,
  says: 'Mixed units: a kg default grid with an lb slot grid, increments crossed',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  grids: { load: kg(2.5) },
  muscles: ['quads', 'chest'],
  slots: () => ({
    machine: linearGated.bind({ lift: SQUAT, sets: sets(3), reps: reps(5), inc: lb(5), backoff: pct(90), stalls: num(3) }, { muscles: { quads: 1 } }),
    barbell: linearGated.bind({ lift: BENCH, sets: sets(3), reps: reps(5), inc: kg(2.5), backoff: pct(90), stalls: num(3) }, { muscles: { chest: 1 }, grids: { load: lb(5) } }),
  }),
  days: { A: [single('machine'), single('barbell')] },
  rotation: { k: 'alternate', days: ['A'], perWeek: 2 },
})

// ═══════════════════════════════════════════════════════════════════════════
// (c) 5/3/1 with Boring But Big at 50% of the main lift's TM
// ═══════════════════════════════════════════════════════════════════════════

const wavePct = (a: number, b: number, c: number) => schedule('trainWeek', 'cycle', pct(a), pct(b), pct(c))
const waveReps = (a: number, b: number, c: number) => schedule('trainWeek', 'cycle', reps(a), reps(b), reps(c))

export const w531 = scheme({
  id: 'lib/531',
  version: 1,
  says: "Wendler 5/3/1 on {lift}: three waves off a training max that starts at {tmPct} of your estimated max, AMRAP last set, deload week; after each cycle's deload add {inc}, or propose a reset to {reset} of TM if any AMRAP fell short",
  params: { lift: ty.exercise('weight_reps'), inc: ty.q('mass'), tmPct: ty.q('one'), reset: ty.q('one') },
  facts: ['e1rm'],
  state: { tm: ty.opt(ty.q('mass')), missed: ty.bool() },
  // The TM changes ONLY at cycleEnd (or by the owner), and cycleEnd fires only
  // when training closed the cycle (L11): an untrained cycle keeps the TM.
  writableBy: { tm: ['cycleEnd', 'owner'], missed: ['session', 'cycleEnd'] },
  nouns: { tm: 'training max', missed: 'an AMRAP fell short this cycle' },
  init: (c) => ({ tm: known(c.fact('e1rm', c.p.lift), (e) => mul(e, c.p.tmPct)), missed: no }),
  plan: (c) => {
    const at_ = (p: ReturnType<typeof wavePct>) => known(c.s.tm, (t) => mul(t, p))
    const main = session({
      exercise: c.p.lift,
      steps: (b) => {
        b.step('s1', sets(1), set({ target: { reps: waveReps(5, 3, 5), load: at_(wavePct(65, 70, 75)) } }))
        b.step('s2', sets(1), set({ target: { reps: waveReps(5, 3, 3), load: at_(wavePct(75, 80, 85)) } }))
        b.step('s3', sets(1), set({ role: 'amrap', target: { reps: amrap(waveReps(5, 3, 1)), load: at_(wavePct(85, 90, 95)) } }))
      },
    })
    const deload = session({
      exercise: c.p.lift,
      steps: (b) => {
        b.step('d1', sets(1), set({ target: { reps: reps(5), load: known(c.s.tm, (t) => mul(t, pct(40))) } }))
        b.step('d2', sets(1), set({ target: { reps: reps(5), load: known(c.s.tm, (t) => mul(t, pct(50))) } }))
        b.step('d3', sets(1), set({ target: { reps: reps(5), load: known(c.s.tm, (t) => mul(t, pct(60))) } }))
      },
    })
    return iff(is(c.pos.role, tag('weekRole', 'deload')), deload, main)
  },
  on: {
    session: (c) => c.commit({ missed: or(c.s.missed, orElse(known2(c.ev.metric('s3', 'reps'), c.ev.prescribed('s3', 'reps'), (r, target) => lt(r, target)), no)) }),
    cycleEnd: (c) => iff(c.s.missed, c.patch({ tm: proposed(known(c.s.tm, (t) => mul(t, c.p.reset))), missed: no }), c.commit({ tm: known(c.s.tm, (t) => add(t, c.p.inc)) })),
  },
})

/** 5/3/1 with Jokers and First Set Last. Jokers are PRE-tested: none at all
 *  unless the top set made its reps, then singles 5% heavier each time, at
 *  most three. FSL is a count range: the athlete picks 3 to 5 sets, and volume
 *  accounting reads the floor. */
export const w531Jokers = scheme({
  id: 'lib/531-jokers',
  // @2: the configurability round's promotion (C10). @1 is the pre-round
  // body, restored and republished unchanged (defs-v1.ts): a published
  // version is immutable (Y3).
  version: 2,
  says: '5/3/1 on {lift} off {tm}, with up to three jokers when the top set makes its reps, then 3–5 sets of 5 at the first-set weight',
  params: { lift: ty.exercise('weight_reps'), tm: ty.opt(ty.q('mass')), jokerStep: ty.q('one') },
  // C10: each joker's jump over the last single is a coaching default.
  defaults: { jokerStep: pct(105) },
  labels: { jokerStep: 'Joker step' },
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) =>
    session({
      exercise: c.p.lift,
      steps: (b) => {
        const first = b.step('s1', sets(1), set({ target: { reps: waveReps(5, 3, 5), load: known(c.p.tm, (t) => mul(t, wavePct(65, 70, 75))) } }))
        b.step('s2', sets(1), set({ target: { reps: waveReps(5, 3, 3), load: known(c.p.tm, (t) => mul(t, wavePct(75, 80, 85))) } }))
        const top = b.step('s3', sets(1), set({ role: 'amrap', target: { reps: amrap(waveReps(5, 3, 1)), load: known(c.p.tm, (t) => mul(t, wavePct(85, 90, 95))) } }))
        b.stepWhile(
          'joker',
          () => orElse(known2(top.read('reps'), top.prescribed('reps'), (r, want) => ge(r, want)), no),
          3,
          (self) => set({ target: { reps: reps(1), load: orElse(known(self.read('load'), (l) => mul(l, c.p.jokerStep)), known(top.read('load'), (l) => mul(l, c.p.jokerStep))) } }),
        )
        b.step('fsl', setsBetween(sets(3), sets(5)), set({ role: 'backoff', target: { reps: reps(5), load: first.prescribed('load') } }))
      },
    }),
  on: {},
})

export const bbb = scheme({
  id: 'lib/bbb',
  version: 1,
  says: 'Boring But Big: 5×10 on {lift} at {frac} of {tm}; three sets in deload weeks',
  params: { lift: ty.exercise('weight_reps'), tm: ty.opt(ty.q('mass')), frac: ty.q('one') },
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) => {
    const work = session({ exercise: c.p.lift, steps: (b) => void b.step('bbb', sets(5), set({ role: 'backoff', target: { reps: reps(10), load: known(c.p.tm, (t) => mul(t, c.p.frac)) } })) })
    return iff(is(c.pos.role, tag('weekRole', 'deload')), scaleSets(work, pct(60)), work)
  },
  on: {},
})

export const fiveThreeOneBBB = program({
  id: 'prog/531-bbb',
  version: 1,
  says: '5/3/1 Boring But Big: four days, a main lift then 5×10 at 50% of that lift’s TM',
  params: {},
  calendar: { weeks: ['train', 'train', 'train', 'deload'], repeat: 'cycle' },
  grids: { load: lb(5) },
  muscles: ['quads', 'chest', 'back', 'shoulders'],
  slots: () => {
    const main = (lift: Expr<Ex<'weight_reps'>>, inc: number, m: string) => w531.bind({ lift, inc: lb(inc), tmPct: pct(90), reset: pct(90) }, { muscles: { [m]: 1 } })
    const big = (lift: Expr<Ex<'weight_reps'>>, slot: string, m: string) => bbb.bind({ lift, tm: peerState(slot, 'tm', ty.opt(ty.q('mass'))), frac: pct(50) }, { muscles: { [m]: 1 } })
    return {
      press: main(PRESS, 5, 'shoulders'),
      dead: main(DEAD, 10, 'back'),
      bench: main(BENCH, 5, 'chest'),
      squat: main(SQUAT, 10, 'quads'),
      pressBbb: big(PRESS, 'press', 'shoulders'),
      deadBbb: big(DEAD, 'dead', 'back'),
      benchBbb: big(BENCH, 'bench', 'chest'),
      squatBbb: big(SQUAT, 'squat', 'quads'),
    }
  },
  days: {
    press: [single('press'), single('pressBbb')],
    dead: [single('dead'), single('deadBbb')],
    bench: [single('bench'), single('benchBbb')],
    squat: [single('squat'), single('squatBbb')],
  },
  rotation: { k: 'weekly', days: ['press', 'dead', 'bench', 'squat'] },
})

// ═══════════════════════════════════════════════════════════════════════════
// (d) GZCLP T1 with stage resets: its stages are an enum it DECLARES
// ═══════════════════════════════════════════════════════════════════════════

export const GZ_T1 = declareEnum('gzT1', ['5x3', '6x2', '10x1', 'retest'])

export const gzclpT1 = scheme({
  id: 'lib/gzclp-t1',
  // @2: the configurability round's C1 correction (the method's totalReps
  // rule); @1 is the pre-round body, restored in defs-v1.ts (Y3).
  version: 2,
  says: 'GZCLP T1 on {lift}: 5×3+, then 6×2+, then 10×1+ on failure, adding {inc} on success, counting total reps across all sets; after failing 10×1, test a 5RM and restart 5×3+ at {resetPct} of it; starts at {start} when a previous program hands one on',
  params: { lift: ty.exercise('weight_reps'), inc: ty.q('mass'), resetPct: ty.q('one'), start: ty.opt(ty.q('mass')) },
  facts: ['e1rm'],
  enums: [GZ_T1],
  state: { stage: GZ_T1.ty, load: ty.opt(ty.q('mass')) },
  writableBy: { stage: ['session', 'owner'], load: ['session', 'owner'] },
  nouns: { stage: 'stage', load: 'working weight' },
  init: (c) => ({
    stage: GZ_T1.tag('5x3'),
    load: orElse(c.p.start, knownThen(c.fact('e1rm', c.p.lift), (e) => known(loadFor({ e1rm: e, reps: reps(5), rir: rir(0) }), (l) => mul(l, c.p.resetPct)))),
  }),
  plan: (c) => {
    const waves = (n: number, r: number) =>
      session({
        exercise: c.p.lift,
        steps: (b) => {
          b.step('work', sets(n - 1), set({ target: { reps: reps(r), load: c.s.load } }))
          b.step('last', sets(1), set({ role: 'amrap', target: { reps: amrap(reps(r)), load: c.s.load } }))
        },
      })
    return match(c.s.stage, {
      '5x3': waves(5, 3),
      '6x2': waves(6, 2),
      '10x1': waves(10, 1),
      retest: session({ exercise: c.p.lift, steps: (b) => void b.step('test', sets(1), set({ role: 'test', target: { reps: reps(5), effort: rir(0) } })) }),
    })
  },
  on: {
    session: (c) => {
      // The method's published success rule: the base volume as TOTAL reps
      // across the sets (15 for 5×3+), not every set at its own floor (C1).
      const progress = (next: '6x2' | '10x1' | 'retest') =>
        byVerdict(c.ev.verdict(undefined, 'floor', 'totalReps'), { hit: c.commit({ load: known(c.s.load, (l) => add(l, c.p.inc)) }), missed: c.commit({ stage: GZ_T1.tag(next) }), unknown: c.keep })
      return match(c.s.stage, {
        '5x3': progress('6x2'),
        '6x2': progress('10x1'),
        '10x1': progress('retest'),
        retest: orElse(
          known(c.ev.metric('test', 'load', 'best'), (l) => c.commit({ stage: GZ_T1.tag('5x3'), load: some(mul(l, c.p.resetPct)) })),
          c.keep,
        ),
      })
    },
  },
})

export const gzclpT1Program = program({
  id: 'prog/gzclp-t1',
  // @2: the interrogation repair round's rebinding (Z1) — the slots moved
  // to the @2 schemes, so the program republishes; @1 is the pre-cfgfix
  // body, restored in progs-v1.ts.
  version: 2,
  says: 'GZCLP T1 lifts on an A/B rotation, three days a week',
  params: { squatStart: ty.opt(ty.q('mass')) },
  calendar: { weeks: ['train'], repeat: 'cycle' },
  grids: { load: kg(2.5) },
  muscles: ['quads', 'chest', 'back', 'shoulders'],
  slots: (p) => ({
    squat: gzclpT1.bind({ lift: SQUAT, inc: kg(5), resetPct: pct(85), start: p.squatStart }, { muscles: { quads: 1 } }),
    bench: gzclpT1.bind({ lift: BENCH, inc: kg(2.5), resetPct: pct(85), start: none(ty.q('mass')) }, { muscles: { chest: 1 } }),
    dead: gzclpT1.bind({ lift: DEAD, inc: kg(5), resetPct: pct(85), start: none(ty.q('mass')) }, { muscles: { back: 1 } }),
    press: gzclpT1.bind({ lift: PRESS, inc: kg(2.5), resetPct: pct(85), start: none(ty.q('mass')) }, { muscles: { shoulders: 1 } }),
  }),
  days: { A1: [single('squat')], B1: [single('press')], A2: [single('bench')], B2: [single('dead')] },
  rotation: { k: 'alternate', days: ['A1', 'B1', 'A2', 'B2'], perWeek: 3 },
  // The predecessor seed channel: a linear block's final squat weight seeds the T1 squat.
  imports: { squatStart: importFrom(linear3x5, 'squatLoad') },
})

// ═══════════════════════════════════════════════════════════════════════════
// (e) RP hypertrophy mesocycle: per-muscle weekly volume, feedback-driven
//     set additions, allocated to the exercise with the best SFR
// ═══════════════════════════════════════════════════════════════════════════

export const rpSlot = scheme({
  id: 'lib/rp-slot',
  version: 1,
  says: '{base} of {lift} for {lo} to {hi} plus any sets the muscle plan adds, reps in reserve stepping 3→0 across the block; add {inc} once every set reaches {hi}',
  params: { lift: ty.exercise('weight_reps'), base: ty.q('sets'), lo: ty.q('reps'), hi: ty.q('reps'), inc: ty.q('mass') },
  state: { load: ty.opt(ty.q('mass')) },
  writableBy: { load: ['session', 'owner'] },
  nouns: { load: 'working weight' },
  init: () => ({ load: none(ty.q('mass')) }),
  plan: (c) =>
    session({
      exercise: c.p.lift,
      steps: (b) =>
        void b.step(
          'work',
          add(c.p.base, orElse(c.fromProgram('extra', ty.q('sets')), sets(0))),
          set({ target: { reps: range(c.p.lo, c.p.hi), load: c.s.load, effort: schedule('trainWeek', 'hold', rir(3), rir(2), rir(1), rir(0)) } }),
        ),
    }),
  on: {
    session: (c) => c.commit({ load: orElse(known(c.s.load, (l) => byVerdict(c.ev.verdict(undefined, 'top'), { hit: add(l, c.p.inc), missed: l, unknown: l })), c.ev.metric('work', 'load', 'best')) }),
  },
})

export const rpWeeklyTarget = fn<{ now: Q<'sets'>; soreness: Opt<Ord<'soreness'>>; pump: Opt<Ord<'pump'>>; mrv: Q<'sets'> }, Q<'sets'>>({
  id: 'lib/rp-weekly-target',
  version: 1,
  params: { now: ty.q('sets'), soreness: ty.opt(ty.ord('soreness')), pump: ty.opt(ty.ord('pump')), mrv: ty.q('sets') },
  result: ty.q('sets'),
  says: '{now} plus the sets earned given {soreness} and {pump}, capped at {mrv}',
  examples: [
    { args: { now: sets(10), soreness: some(lvl('soreness', 0)), pump: some(lvl('pump', 1)), mrv: sets(22) }, gives: sets(12) },
    { args: { now: sets(21), soreness: some(lvl('soreness', 0)), pump: some(lvl('pump', 0)), mrv: sets(22) }, gives: sets(22) },
    { args: { now: sets(10), soreness: none(ty.ord('soreness')), pump: some(lvl('pump', 0)), mrv: sets(22) }, gives: sets(10) },
  ],
  body: (p) => min(add(p.now, orElse(known2(p.soreness, p.pump, (so, pu) => rpSetDelta({ soreness: so, pump: pu })), sets(0))), p.mrv),
})

export const sfrOrNeutral = fn<{ pump: Opt<Ord<'pump'>>; joint: Opt<Ord<'jointPain'>> }, Q<'one'>>({
  id: 'lib/sfr-or-neutral',
  version: 1,
  params: { pump: ty.opt(ty.ord('pump')), joint: ty.opt(ty.ord('jointPain')) },
  result: ty.q('one'),
  says: 'the stimulus-to-fatigue score from {pump} and {joint} (0 if either is unrated)',
  examples: [{ args: { pump: some(lvl('pump', 3)), joint: none(ty.ord('jointPain')) }, gives: num(0) }],
  body: (p) => orElse(known2(p.pump, p.joint, (pu, jp) => sfrScore({ pump: pu, joint: jp })), num(0)),
})

const MEV = { chest: 10, back: 12 }
const MRV = { chest: 22, back: 25 }
/** RP's volume read, declared: the week just closing (as now planned under
 *  the handler's pre-state), counted only when it is a progressing week. A
 *  deload week's halved sets are not a measure of what the muscle gets, so
 *  that weekEnd reads absence and keeps (no allocation, no new targets)
 *  instead of allocating against the deload's numbers. */
export const RP_VOLUME_READ = { basis: 'closing', roles: ['accumulation'] } as const satisfies WeeklyOpts

export const rpMeso = program({
  id: 'prog/rp-upper-meso',
  version: 1,
  says: 'A 4+1 week hypertrophy block: each muscle starts at MEV and gains sets weekly from soreness and pump feedback, up to MRV; new sets go to the exercise with the best stimulus-to-fatigue',
  params: {},
  facts: ['soreness', 'pump', 'jointPain'],
  calendar: { weeks: ['accumulation', 'accumulation', 'accumulation', 'accumulation', 'deload'], repeat: 'once' },
  grids: { load: kg(2) },
  muscles: ['chest', 'back'],
  slots: () => ({
    flatDb: rpSlot.bind({ lift: exercise('wger:97'), base: sets(2), lo: reps(8), hi: reps(12), inc: kg(2) }, { muscles: { chest: 1 } }),
    inclineDb: rpSlot.bind({ lift: exercise('wger:314'), base: sets(2), lo: reps(8), hi: reps(12), inc: kg(2) }, { muscles: { chest: 1 } }),
    // The fly is trained on both days as two slots, one per day: an extra set
    // the muscle plan gives a slot is one WEEKLY set only if the slot is
    // trained once a week (EC-136, the weekly-allocation law).
    cableFlyA: rpSlot.bind({ lift: exercise('wger:122'), base: sets(1), lo: reps(12), hi: reps(20), inc: kg(2.5) }, { muscles: { chest: 1 } }),
    cableFlyB: rpSlot.bind({ lift: exercise('wger:122'), base: sets(1), lo: reps(12), hi: reps(20), inc: kg(2.5) }, { muscles: { chest: 1 } }),
    row: rpSlot.bind({ lift: exercise('wger:212'), base: sets(3), lo: reps(8), hi: reps(12), inc: kg(2.5) }, { muscles: { back: 1 } }),
    pulldown: rpSlot.bind({ lift: exercise('wger:158'), base: sets(3), lo: reps(10), hi: reps(15), inc: kg(2.5) }, { muscles: { back: 1 } }),
  }),
  days: {
    upperA: [single('flatDb'), single('row'), single('cableFlyA')],
    upperB: [single('inclineDb'), single('pulldown'), single('cableFlyB')],
  },
  rotation: { k: 'weekly', days: ['upperA', 'upperB'] },
  roles: { deload: use(deloadStd, { load: pct(90), timed: pct(100), volume: pct(50), rir: rir(4) }) },
  aggregate: {
    state: { target: ty.map('muscle', ty.q('sets')), extra: ty.map('slot', ty.q('sets')) },
    writableBy: { target: ['weekEnd', 'owner'], extra: ['weekEnd'] },
    nouns: { target: 'weekly set target', extra: 'weekly extra sets' },
    init: () => ({ target: tabulate(allMuscles, (m) => table(m, { chest: sets(MEV.chest), back: sets(MEV.back) }, sets(0))), extra: tabulate(allSlots, () => sets(0)) }),
    on: {
      weekEnd: (c) =>
          letv(
            "next week's target",
            tabulate(allMuscles, (m) => rpWeeklyTarget({ now: orElse(at(c.s.target, m), sets(0)), soreness: c.fact('soreness', m), pump: c.fact('pump', m), mrv: table(m, { chest: sets(MRV.chest), back: sets(MRV.back) }, sets(0)) })),
            (target) =>
              letv(
                'the reallocation',
                // Derived, not synced: the gap is target − what the plans already
                // issue, so a set the allocator could not place is retried next week.
                foldOver(allMuscles, some(c.s.extra), (acc, m) =>
                  knownThen(acc, (into) =>
                    known(c.setsFor(m, 'muscle', RP_VOLUME_READ), (planned) =>
                      allocate({
                        n: named('the sets still to place', max(sets(0), sub(orElse(at(target, m), sets(0)), planned))),
                        into,
                        among: c.slotsFor(m),
                        score: (s) => sfrOrNeutral({ pump: c.fact('pump', m), joint: c.fact('jointPain', s) }),
                        cap: () => sets(4),
                        max: 8,
                      }),
                    ),
                  ),
                ),
                (extra) => orElse(known(extra, (e) => c.commit({ target, extra: e })), c.keep),
              ),
          ),
    },
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// (f) NASM OPT macrocycle: phases, tempo, proprioceptive ladders, handoff
// ═══════════════════════════════════════════════════════════════════════════

/** A proprioceptive ladder: the progression changes the MOVEMENT. Its rungs
 *  log differently (bodyweight and loaded), so a target may name only what
 *  every rung logs: reps. Rest belongs to the circuit or superset it sits in. */
export const stabLadder = scheme({
  id: 'lib/stab-ladder',
  version: 1,
  says: '{sets} of {lo} to {hi} at a slow tempo, on the current rung of {ladder}, starting from {start}; climb a rung after {need} sessions in a row with every set done and solid form, up to rung {top}',
  params: { ladder: ty.list1(ty.exercise('bodyweight_reps', 'weight_reps')), start: ty.q('one'), top: ty.q('one'), need: ty.q('one'), sets: ty.q('sets'), lo: ty.q('reps'), hi: ty.q('reps') },
  facts: ['formQuality'],
  state: { rung: ty.q('one'), solid: ty.q('one') },
  writableBy: { rung: ['session', 'owner'], solid: ['session'] },
  nouns: { rung: 'rung', solid: 'solid sessions in a row' },
  init: (c) => ({ rung: c.p.start, solid: num(0) }),
  plan: (c) => session({ exercise: nth(c.p.ladder, c.s.rung, 'hold'), steps: (b) => void b.step('work', c.p.sets, set({ target: { reps: range(c.p.lo, c.p.hi) }, tempo: tempo(4, 2, 1, 0) })) }),
  on: {
    session: (c) =>
      byVerdict(c.ev.verdict(), {
        hit: iff(
          orElse(known(c.fact('formQuality'), (f) => ge(f, lvl('formQuality', 2))), no),
          iff(ge(add(c.s.solid, num(1)), c.p.need), c.commit({ rung: min(add(c.s.rung, num(1)), c.p.top), solid: num(0) }), c.commit({ solid: add(c.s.solid, num(1)) })),
          c.commit({ solid: num(0) }),
        ),
        missed: c.commit({ solid: num(0) }),
        unknown: c.keep,
      }),
  },
})

export const doubleProg = scheme({
  id: 'lib/double-progression',
  // @2: the configurability round's promotion (C10); @1 restored in defs-v1.ts (Y3).
  version: 2,
  says: '{sets} of {lift} in the phase rep range, starting at {start}; add {inc} once every set reaches the top of the range',
  params: { lift: ty.exercise('weight_reps'), sets: ty.q('sets'), inc: ty.q('mass'), start: ty.opt(ty.q('mass')), lo: ty.q('reps'), hi: ty.q('reps') },
  // C10: the base 8-12 range is a coaching choice, now a declared default.
  defaults: { lo: reps(8), hi: reps(12) },
  labels: { lo: 'rep-range floor', hi: 'rep-range top' },
  facts: ['e1rm'],
  state: { load: ty.opt(ty.q('mass')) },
  writableBy: { load: ['session', 'owner'] },
  nouns: { load: 'working weight' },
  init: (c) => ({ load: orElse(c.p.start, knownThen(c.fact('e1rm', c.p.lift), (e) => loadFor({ e1rm: e, reps: c.p.hi, rir: rir(2) }))) }),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('work', c.p.sets, set({ target: { reps: range(c.p.lo, c.p.hi), load: c.s.load } })) }),
  on: {
    session: (c) => c.commit({ load: orElse(known(c.s.load, (l) => byVerdict(c.ev.verdict(undefined, 'top'), { hit: add(l, c.p.inc), missed: l, unknown: l })), c.ev.metric('work', 'load', 'best')) }),
  },
})

export const fixedWork = scheme({
  id: 'lib/fixed-work',
  version: 1,
  says: '{sets} of {reps} of {lift}, unloaded, as explosively as possible',
  params: { lift: ty.exercise('bodyweight_reps'), sets: ty.q('sets'), reps: ty.q('reps') },
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('work', c.p.sets, set({ target: { reps: c.p.reps }, tempo: tempo(0, 0, 0, 0) })) }),
  on: {},
})

export const repShape = fn<{ s: SessionT; lo: Q<'reps'>; hi: Q<'reps'>; t: TempoT }, SessionT>({
  id: 'lib/rep-shape',
  version: 1,
  params: { s: ty.session(), lo: ty.q('reps'), hi: ty.q('reps'), t: ty.tempo() },
  result: ty.session(),
  says: '{s}, reshaped to {lo} to {hi} at tempo {t}',
  examples: [
    {
      args: { s: session({ exercise: BENCH, steps: (b) => void b.step('w', sets(3), set({ target: { reps: range(reps(8), reps(12)) } })) }), lo: reps(1), hi: reps(5), t: tempo(1, 0, 1, 0) },
      gives: session({ exercise: BENCH, steps: (b) => void b.step('w', sets(3), set({ target: { reps: range(reps(1), reps(5)) }, tempo: tempo(1, 0, 1, 0) })) }),
    },
  ],
  body: (p) => setTempo(reshape(p.s, set({ target: { reps: range(p.lo, p.hi) } })), p.t),
})

const PUSH_LADDER = [
  exercise('wger:ball-push-up'),
  exercise('wger:sa-ball-db-press'),
  exercise('wger:sl-cable-press'),
] as const
const SQUAT_LADDER = [
  exercise('wger:ball-wall-squat'),
  exercise('wger:sl-squat'),
  exercise('wger:sl-squat-pad'),
] as const
type Rung = Expr<Ex<'bodyweight_reps' | 'weight_reps'>>
const listOf = (xs: readonly [Rung, ...Rung[]]) => list1(ty.exercise('bodyweight_reps', 'weight_reps'), xs[0], ...xs.slice(1))
const pushLadder = (start: Expr<Q<'one'>, BindCap>) =>
  stabLadder.bind({ ladder: listOf(PUSH_LADDER), start, top: num(2), need: num(2), sets: sets(2), lo: reps(12), hi: reps(20) }, { muscles: { chest: 1 } })

export const optStabilization = program({
  id: 'prog/opt-stabilization',
  version: 1,
  says: 'OPT Phase 1: stabilization endurance circuits on proprioceptive ladders',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  muscles: ['chest', 'quads'],
  slots: () => ({
    pushStab: pushLadder(num(0)),
    squatStab: stabLadder.bind({ ladder: listOf(SQUAT_LADDER), start: num(0), top: num(2), need: num(2), sets: sets(2), lo: reps(12), hi: reps(20) }, { muscles: { quads: 1 } }),
  }),
  days: { A: [circuit(['pushStab', 'squatStab'], sec(90))] },
  rotation: { k: 'weekly', days: ['A', 'A', 'A'] },
})

export const optStrengthEndurance = program({
  id: 'prog/opt-strength-endurance',
  // @2: the interrogation repair round's rebinding (Z1) — the slots moved
  // to the @2 schemes, so the program republishes; @1 is the pre-cfgfix
  // body, restored in progs-v1.ts.
  version: 2,
  says: 'OPT Phase 2: a strength lift supersetted with its stabilization partner',
  params: { benchStart: ty.opt(ty.q('mass')), rung: ty.q('one') },
  calendar: { weeks: ['train', 'train', 'train', 'train'], repeat: 'once' },
  grids: { load: kg(2.5) },
  muscles: ['chest'],
  slots: (p) => ({
    bench: doubleProg.bind({ lift: BENCH, sets: sets(3), inc: kg(2.5), start: p.benchStart }, { muscles: { chest: 1 } }),
    pushStab: pushLadder(p.rung),
  }),
  days: { A: [superset('bench', 'pushStab', { between: sec(0), after: sec(60) })] },
  rotation: { k: 'weekly', days: ['A', 'A', 'A'] },
})

export const optLoaded = program({
  id: 'prog/opt-loaded',
  // @2: the interrogation repair round's rebinding (Z1) — the slots moved
  // to the @2 schemes, so the program republishes; @1 is the pre-cfgfix
  // body, restored in progs-v1.ts.
  version: 2,
  says: 'OPT loaded phase: one main lift per session, character set by the phase',
  params: { benchStart: ty.opt(ty.q('mass')) },
  calendar: { weeks: ['train', 'train', 'train', 'train'], repeat: 'once' },
  grids: { load: kg(2.5) },
  muscles: ['chest'],
  slots: (p) => ({ bench: doubleProg.bind({ lift: BENCH, sets: sets(4), inc: kg(2.5), start: p.benchStart }, { muscles: { chest: 1 } }) }),
  days: { A: [single('bench')] },
  rotation: { k: 'weekly', days: ['A', 'A', 'A'] },
})

export const optPower = program({
  id: 'prog/opt-power',
  // @2: the interrogation repair round's rebinding (Z1) — the slots moved
  // to the @2 schemes, so the program republishes; @1 is the pre-cfgfix
  // body, restored in progs-v1.ts.
  version: 2,
  says: 'OPT Phase 5: heavy strength set supersetted with an explosive partner',
  params: { benchStart: ty.opt(ty.q('mass')) },
  calendar: { weeks: ['train', 'train', 'train', 'train'], repeat: 'once' },
  grids: { load: kg(2.5) },
  muscles: ['chest', 'shoulders'],
  slots: (p) => ({
    bench: doubleProg.bind({ lift: BENCH, sets: sets(4), inc: kg(2.5), start: p.benchStart }, { muscles: { chest: 1 } }),
    // EC-218: this slot had no primary muscle and was never allocated to.
    pass: fixedWork.bind({ lift: exercise('wger:mb-chest-pass'), sets: sets(4), reps: reps(10) }, { muscles: { chest: 1, shoulders: 0.5 } }),
  }),
  days: { A: [superset('bench', 'pass', { between: sec(0), after: sec(120) })] },
  rotation: { k: 'weekly', days: ['A', 'A'] },
})

const prevBench = (prev: PrevView) => prev.state('bench', 'load', ty.opt(ty.q('mass')))

export const optMacro = macro({
  id: 'macro/opt-16wk',
  // @2: its phases bind the @2 programs (Z1); @1 restored in progs-v1.ts.
  version: 2,
  says: 'NASM OPT: stabilization until the ladders are climbed (4–6 weeks), then strength endurance, hypertrophy, maximal strength and power, each phase seeded from the last',
  anchor: { k: 'startOn', date: localDay('2026-11-02') },
  drift: 'slide',
  phases: [
    phase('Stabilization endurance', optStabilization, {
      k: 'bounded',
      min: 4,
      max: 6,
      advanceWhen: (cur) => and(ge(cur.state('pushStab', 'rung', ty.q('one')), num(2)), ge(cur.state('squatStab', 'rung', ty.q('one')), num(2))),
    }, () => ({})),
    phase('Strength endurance', optStrengthEndurance, { k: 'fixed' }, (prev) => ({ benchStart: none(ty.q('mass')), rung: prev.state('pushStab', 'rung', ty.q('one')) }), use(withTempo, { t: tempo(2, 0, 2, 0) })),
    phase('Hypertrophy', optLoaded, { k: 'fixed' }, (prev) => ({ benchStart: prevBench(prev) }), use(repShape, { lo: reps(6), hi: reps(12), t: tempo(2, 0, 2, 0) })),
    phase('Maximal strength', optLoaded, { k: 'fixed' }, (prev) => ({ benchStart: known(prevBench(prev), (l) => roundTo(mul(l, pct(115)), kg(2.5))) }), use(repShape, { lo: reps(1), hi: reps(5), t: tempo(1, 0, 1, 0) })),
    phase('Power', optPower, { k: 'open' }, (prev) => ({ benchStart: prevBench(prev) }), use(repShape, { lo: reps(1), hi: reps(5), t: tempo(1, 0, 1, 0) })),
  ],
})

// ═══════════════════════════════════════════════════════════════════════════
// (g) A technique-bearing hypertrophy scheme: rest-pause canonical (D11)
// ═══════════════════════════════════════════════════════════════════════════

/** DC-style rest-pause: the intensifier is ONE technique on the final set (the
 *  dose law); the handler reads its stage outcomes through the event, so the
 *  set counts once for volume and a deload strips it. */
export const restPauseDc = scheme({
  id: 'lib/rest-pause-dc',
  version: 1,
  says: '{sets} of {lo} to {hi} on {lift}, the last set extended rest-pause; add {inc} once the rest-pause set totals {total}',
  params: { lift: ty.exercise('weight_reps'), sets: ty.q('sets'), lo: ty.q('reps'), hi: ty.q('reps'), total: ty.q('reps'), inc: ty.q('mass') },
  state: { load: ty.opt(ty.q('mass')) },
  writableBy: { load: ['session', 'owner'] },
  nouns: { load: 'working weight' },
  init: () => ({ load: none(ty.q('mass')) }),
  plan: (c) =>
    session({
      exercise: c.p.lift,
      intensifier: technique('rest-pause', set({ target: { reps: amrap(reps(3)) }, rest: sec(15) }), set({ target: { reps: amrap(reps(2)) }, rest: sec(15) })),
      steps: (b) => void b.step('work', c.p.sets, set({ target: { reps: range(c.p.lo, c.p.hi), load: c.s.load } })),
    }),
  on: {
    session: (c) =>
      c.commit({
        load: orElse(
          // Unnamed this costs 5: the budget forced the name, as it did RP's gap.
          orElse(known2(c.s.load, c.ev.stageReps('work', 'sum'), (l, total) => named('the earned weight', iff(ge(total, c.p.total), add(l, c.p.inc), l))), c.s.load),
          c.ev.metric('work', 'load', 'best'),
        ),
      }),
  },
})

/** Clusters on EVERY set: the set field, not an intensifier. */
export const clusterStrength = scheme({
  id: 'lib/cluster-strength',
  version: 1,
  says: '{sets} of 6 on {lift} in clusters of 2 with short rests; add {inc} once every set is done',
  params: { lift: ty.exercise('weight_reps'), sets: ty.q('sets'), inc: ty.q('mass') },
  state: { load: ty.opt(ty.q('mass')) },
  writableBy: { load: ['session', 'owner'] },
  nouns: { load: 'working weight' },
  init: () => ({ load: none(ty.q('mass')) }),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('work', c.p.sets, set({ target: { reps: reps(6), load: c.s.load }, cluster: { per: reps(2), intraRest: sec(20) } })) }),
  on: { session: (c) => c.commit({ load: orElse(known(c.s.load, (l) => byVerdict(c.ev.verdict(), { hit: add(l, c.p.inc), missed: l, unknown: l })), c.ev.metric('work', 'load', 'best')) }) },
})

export const upperHypertrophy = program({
  id: 'prog/upper-hypertrophy-dc',
  version: 1,
  says: 'Upper hypertrophy with a rest-pause press and clustered rows, three weeks on and a deload, with the cut and readiness laws',
  params: {},
  facts: ['dietPhase', 'readiness'],
  calendar: { weeks: ['train', 'train', 'train', 'deload'], repeat: 'cycle' },
  grids: { load: kg(2.5) },
  muscles: ['chest', 'back'],
  slots: () => ({
    press: restPauseDc.bind({ lift: exercise('wger:97'), sets: sets(2), lo: reps(8), hi: reps(12), total: reps(20), inc: kg(2) }, { muscles: { chest: 1 } }),
    row: clusterStrength.bind({ lift: exercise('wger:212'), sets: sets(4), inc: kg(2.5) }, { muscles: { back: 1 } }),
  }),
  days: { A: [single('press'), single('row')] },
  rotation: { k: 'weekly', days: ['A', 'A'] },
  roles: { deload: use(deloadStd, { load: pct(90), timed: pct(100), volume: pct(50), rir: rir(4) }) },
  aggregate: {
    state: { stalled: ty.q('one') },
    writableBy: { stalled: ['session', 'owner'] },
    nouns: { stalled: 'sessions in a row with a missed set' },
    init: () => ({ stalled: num(0) }),
    on: { session: (c) => c.commit({ stalled: byVerdict(c.ev.verdict(), { hit: num(0), missed: add(c.s.stalled, num(1)), unknown: c.s.stalled }) }) },
  },
  policies: (c) => [
    // Reactive deload: the policy reads program state, not the calendar.
    policy({ when: ge(c.s.stalled, num(3)), plan: use(deloadStd, { load: pct(90), timed: pct(100), volume: pct(50), rir: rir(4) }) }),
    // The cut law: verdict math stays phase-blind; a load decrease lands as a proposal.
    policy({ when: is(orElse(c.fact('dietPhase'), tag('dietPhase', 'maintain')), tag('dietPhase', 'cut')), outcome: { demote: { kinds: ['load'], direction: 'decrease' }, volumeKeep: true } }),
    // Readiness day-down: a poor check-in lightens today, and changes nothing else.
    policy({ when: orElse(known(c.fact('readiness'), (r) => le(r, lvl('readiness', 2))), no), plan: use(deloadStd, { load: pct(90), timed: pct(100), volume: pct(100), rir: rir(3) }) }),
  ],
})

// ═══════════════════════════════════════════════════════════════════════════
// (h) Frequency: legs three times a week, and the adherence it produces
// ═══════════════════════════════════════════════════════════════════════════

export const legsFrequency = program({
  id: 'prog/legs-3x',
  // @2: the interrogation repair round's rebinding (Z1) — the slots moved
  // to the @2 schemes, so the program republishes; @1 is the pre-cfgfix
  // body, restored in progs-v1.ts.
  version: 2,
  says: 'A three-day split that trains a leg muscle every session, with attendance counted for legs and for workouts',
  params: {},
  calendar: { weeks: ['train'], repeat: 'cycle' },
  grids: { load: kg(2.5) },
  muscles: ['quads', 'hamstrings', 'glutes', 'chest', 'back'],
  slots: () => ({
    squat: linearGated.bind({ lift: SQUAT, sets: sets(3), reps: reps(5), inc: kg(2.5), backoff: pct(90), stalls: num(3) }, { muscles: { quads: 1 } }),
    rdl: doubleProg.bind({ lift: exercise('wger:507'), sets: sets(3), inc: kg(2.5), start: none(ty.q('mass')) }, { muscles: { hamstrings: 1, glutes: 0.5 } }),
    thrust: doubleProg.bind({ lift: exercise('wger:hip-thrust'), sets: sets(3), inc: kg(5), start: none(ty.q('mass')) }, { muscles: { glutes: 1, hamstrings: 0.5 } }),
    bench: linearGated.bind({ lift: BENCH, sets: sets(3), reps: reps(5), inc: kg(1.25), backoff: pct(90), stalls: num(3) }, { muscles: { chest: 1 } }),
    row: doubleProg.bind({ lift: exercise('wger:212'), sets: sets(3), inc: kg(2.5), start: none(ty.q('mass')) }, { muscles: { back: 1 } }),
  }),
  days: { A: [single('squat'), single('bench')], B: [single('rdl'), single('row')], C: [single('thrust'), single('bench')] },
  rotation: { k: 'weekly', days: ['A', 'B', 'C'] },
  frequency: () => [freq.atLeast(3, sel.muscle('quads', 'hamstrings', 'glutes'), per.week()), freq.atLeast(3, sel.any(), per.week())],
})

/** Publication order: what each definition may call or bind. */
export const PUBLISHED = [
  loadFor,
  juggernautBump,
  juggernautRealization,
  apreAdjust,
  rpSetDelta,
  sfrScore,
  deloadStd,
  withTempo,
  linearGated,
  linear3x5,
  mixedUnits,
  apreTopBackoff,
  w531,
  bbb,
  fiveThreeOneBBB,
  GZCLP_T1_V1,
  gzclpT1,
  GZCLP_T1_PROG_V1,
  gzclpT1Program,
  rpSlot,
  rpWeeklyTarget,
  sfrOrNeutral,
  rpMeso,
  stabLadder,
  DOUBLE_PROGRESSION_V1,
  doubleProg,
  fixedWork,
  repShape,
  optStabilization,
  OPT_STRENGTH_ENDURANCE_V1,
  optStrengthEndurance,
  OPT_LOADED_V1,
  optLoaded,
  OPT_POWER_V1,
  optPower,
  OPT_MACRO_V1,
  optMacro,
  W531_JOKERS_V1,
  w531Jokers,
  restPauseDc,
  clusterStrength,
  upperHypertrophy,
  LEGS_3X_V1,
  legsFrequency,
] as const
