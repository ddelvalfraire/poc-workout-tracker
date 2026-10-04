/**
 * demo.ts — runs the checker, the describer and the calendar slice over every
 * worked program. Run: tsx demo.ts > demo.out.txt
 */
import {
  add,
  and,
  byVerdict,
  days,
  exercise,
  exprOfTerm,
  fn,
  ge,
  gt,
  iff,
  kg,
  lb,
  known,
  known2,
  lvl,
  max,
  mins,
  mul,
  muscle,
  named,
  no,
  none,
  not,
  nth,
  num,
  or,
  orElse,
  pct,
  range,
  rate,
  reps,
  rir,
  rpe,
  sets,
  sub,
  table,
  tabulate,
  ty,
  type Cap,
  type Expr,
  type FnDef,
  type Q,
  type Term,
  type Upd,
} from './algebra'
import { calReads, checkFn, checkMacro, checkProgram, checkScheme, publish, writeSet } from './checkdefs'
import { cxOf, describe, phrase } from './describe'
import { explain } from './describe-run'
import { ctxOf, evaluate } from './evaluate'
import { evaluatorSection } from './demo-eval'
import { adherenceText, bindingArgs, describeMacroPhases, describeProgram, describeSlot, dueText, headline, macroHeadline, programCx, stackingText } from './describe-defs'
import type { TypeError } from './engine'
import * as ER from './endurance-rehab'
import * as P from './programs'
import { BASE_VOCAB, FACT_DECLS, METRIC_DECLS, type FactDecl, type MetricDecl, type Vocab } from './registry'
import { amrap, cal, deathBy, emom, exactly, fact, freq, kindOf, macro, per, phase, program, scheme, sel, session, set, setsBetween, swapExercise } from './structure'
import { activate, addDays, calendarSpecOf, completedFraction, dayNum, dayText, dueVerdict, feasibility, localDay, matches, occurrenceOf, reconcile, selKey, stepCalendar, weekday, type CalendarState, type Occurrence } from './time'
import type { MacroDef, Policy, ProgramDef, SchemeDef, StateDecl } from './structure'

const reg = publish([...P.PUBLISHED, ...ER.PUBLISHED])
const cx = cxOf(reg)
const show = (e: TypeError) => `${e.code} at ${e.path.join('.')}: ${e.message}`
const report = (label: string, errs: TypeError[]) => {
  console.log(`  ${errs.length === 0 ? 'OK     ' : 'REFUSED'} ${label}`)
  for (const e of errs) console.log(`          ${show(e)}`)
}
const reportProgram = (label: string, p: ProgramDef, r = reg) => report(label, checkProgram(p, r).flatMap((x) => x.errors))
/** Print a (possibly multi-line) description with every line under the prefix. */
const say = (prefix: string, l: string) => console.log(prefix + l.replace(/\n/g, `\n${prefix}`))
const h = (s: string) => console.log(`\n${'═'.repeat(78)}\n${s}\n${'═'.repeat(78)}`)
const clone = <T>(x: T): T => structuredClone(x)
const T = (e: { term: Term }) => e.term
type SessionIR = Extract<Term, { k: 'session' }>
type StepIR_ = Extract<SessionIR['steps'][number], { k: 'step' }>
type SetIR = Extract<Term, { k: 'set' }>
type PatchIR = Extract<Term, { k: 'patch' }>
const firstStep = (plan: Term) => (plan as SessionIR).steps[0] as StepIR_
/** A registry where one published scheme is replaced by an edited copy. */
const withScheme = (s: SchemeDef) => publish([...P.PUBLISHED, ...ER.PUBLISHED].map((x) => ('def' in x && x.def.kind === 'scheme' && x.def.ref.id === s.ref.id ? { def: s } : x)))
/** Rewrite every node a predicate picks, depth first (for raw-JSON edits). */
const edit = <X>(x: X, pick: (t: Term) => boolean, f: (t: Term) => Term): X => {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!v || typeof v !== 'object') return v
    const o = Object.fromEntries(Object.entries(v).map(([k, w]) => [k, walk(w)]))
    return typeof o['k'] === 'string' && pick(o as Term) ? f(o as Term) : o
  }
  return walk(x) as X
}
const commitField = (to: Term) => ({ to, mode: 'commit' as const })

// ── 1. The checker over every worked definition ──────────────────────────────
h('1. CHECK: every definition in publication order (IR checker)')
for (const f of reg.fns.values()) report(`fn ${f.ref.id}`, checkFn(f, reg))
report('scheme lib/apre-6rm (case b: no program binds it)', checkScheme(P.apreTopBackoff.def, reg))
report('scheme lib/juggernaut-realization (hard case)', checkScheme(P.juggernautRealization.def, reg))
report('scheme lib/531-jokers (stepWhile with self-reads, a count range)', checkScheme(P.w531Jokers.def, reg))
for (const p of reg.programs.values()) for (const r of checkProgram(p, reg)) report(r.at, r.errors)
for (const m of reg.macros.values()) report(`macro ${m.ref.id}`, checkMacro(m, reg))

// ── 2. The budget lint (D4) ──────────────────────────────────────────────────
h('2. BUDGET: an unnamed phrase over 4 operators is refused; naming is the fix')
const inlined = scheme({
  id: 'demo/juggernaut-inlined',
  version: 1,
  says: 'Juggernaut realization on {lift}, increment inlined',
  params: { lift: ty.exercise('weight_reps') },
  state: { tm: ty.opt(ty.q('mass')) },
  writableBy: { tm: ['session'] },
  nouns: { tm: 'training max' },
  init: () => ({ tm: none(ty.q('mass')) }),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('amrap', sets(1), set({ role: 'amrap', target: { reps: amrap(reps(10)), load: c.s.tm } })) }),
  on: { session: (c) => c.commit({ tm: orElse(known2(c.s.tm, c.ev.metric('amrap', 'reps'), (tm, r) => add(tm, mul(rate(2.5, 'kg', 'rep'), max(reps(0), sub(r, reps(10)))))), c.s.tm) }) },
})
report('inlined increment (orElse, plus, ×, never-below, minus: cost 5)', checkScheme(inlined.def, reg))
report('named increment (lib/juggernaut-bump is a name: cost 2)', checkScheme(P.juggernautRealization.def, reg))
/** Replace every `named(noun, e)` with its `e`: the definition as if the author had not named it. */
const unname = <X>(x: X, noun: string): X => edit(x, (t) => t.k === 'named' && t.noun === noun, (t) => (t as Extract<Term, { k: 'named' }>).e)
console.log('\n  The two calibration cases, with their names removed:')
for (const r of checkProgram(unname(P.rpMeso.def, 'the sets still to place'), reg)) if (r.errors.length) report(`RP allocation gap: ${r.at}`, r.errors)
const rp2 = unname(P.restPauseDc.def, 'the earned weight')
report('rest-pause bump, unnamed (scheme lib/rest-pause-dc)', checkScheme(rp2, withScheme(rp2)))

// ── 3. IR negatives ─────────────────────────────────────────────────────────────
h('3. IR NEGATIVES: the rules over raw JSON (what MCP authoring hits)')
console.log('  The round-2 twins:')
const apre = clone(P.apreTopBackoff.def)
;(((apre.plan as SessionIR).steps[3] as StepIR_).target as SetIR).target['load'] = { b: 'exact', v: { k: 'orElse', a: { k: 'event', q: { q: 'metric', step: 'top' as never, metric: 'load', pick: 'last' } }, b: T(kg(100)) } }
report('event read in a set target (plan)', checkScheme(apre, reg))
const apre2 = clone(P.apreTopBackoff.def)
;(((apre2.plan as SessionIR).steps[1] as StepIR_).target as SetIR).target['load'] = { b: 'exact', v: { k: 'performed', step: 'top' as never, metric: 'load', pick: 'last' } }
report('ramp set reads the LATER top set', checkScheme(apre2, reg))
const rpSlot = clone(P.rpSlot.def)
firstStep(rpSlot.plan).count = { k: 'n', n: { k: 'agg', q: { q: 'weekly', metric: 'sets', by: { k: 'slot', of: { k: 'lit', lit: { k: 'ref', kind: 'slot', id: 'row' } } } } } }
report('aggregate read in a slot set count', checkScheme(rpSlot, reg))
const w531 = clone(P.w531.def)
;(w531.on.session as PatchIR).set['tm'] = commitField({ k: 'self', field: 'tm' })
report('5/3/1 session handler writes tm (writableBy: cycleEnd, owner)', checkScheme(w531, reg))
const bump = clone(P.juggernautBump.def) as FnDef
bump.body = { k: 'arith', op: '+', a: { k: 'param', name: 'perRep' }, b: { k: 'param', name: 'amrap' } }
report('kg/rep + reps in a definition body', checkFn(bump, reg))
const rpBound = JSON.parse(JSON.stringify(P.rpMeso.def).replace('"max":8', '"max":{"k":"lit","lit":{"k":"q","v":8,"unit":"set"}}')) as ProgramDef
reportProgram('allocate bound given as a term', rpBound)

console.log('\n  Metrics and facts:')
const iso = clone(ER.isoHold.def)
;(firstStep(iso.plan).target as SetIR).target['load'] = { b: 'exact', v: T(kg(10)) }
report('a load on a timed hold (metric not logged by its exercise)', checkScheme(iso, reg))
const easy = clone(ER.easyRun.def)
easy.facts = easy.facts.filter((f) => f !== 'avgHr')
report('a heart-rate target without the avgHr fact declared', checkScheme(easy, reg))
const easy2 = clone(ER.easyRun.def)
;(firstStep(easy2.plan).target as SetIR).target['hr'] = { b: 'exact', v: { k: 'lit', lit: { k: 'q', v: 2.5, unit: 'bpm' } } }
report('a heart rate targeted as one exact number', checkScheme(easy2, reg))
const borgEffort = clone(P.linearGated.def)
;(firstStep(borgEffort.plan).target as SetIR).target['effort'] = { b: 'exact', v: T(lvl('borg', 15)) }
report('borg is not RIR: a Borg rating as an effort target', checkScheme(borgEffort, reg))
const borgCmp = clone(ER.hrTempo.def)
borgCmp.on.session = { k: 'if', c: { k: 'orElse', a: { k: 'known', a: { k: 'fact', fact: 'borg', key: null }, as: 'b' as never, then: false, body: { k: 'cmp', op: '<', a: { k: 'var', name: 'b' as never }, b: T(rir(2)) } }, b: T(no) }, a: { k: 'patch', set: {} }, b: { k: 'patch', set: {} } }
report('borg is not RIR: a Borg rating compared with reps in reserve', checkScheme(borgCmp, reg))
const cardioCap = clone(ER.easyRun.def)
cardioCap.plan = { k: 'xform', op: 'capEffort', s: cardioCap.plan, arg: T(rir(3)), metric: null }
report('capEffort on a run (it logs no effort)', checkScheme(cardioCap, reg))
const slotPain = edit(clone(P.rpMeso.def), (t) => t.k === 'fact' && t.fact === 'jointPain', (t) => ({ ...(t as Extract<Term, { k: 'fact' }>), key: T(muscle('chest')) }))
reportProgram('a slot-keyed fact (joint pain) read by a muscle', slotPain)
const optCmp = clone(P.upperHypertrophy.def)
optCmp.policies[3]!.when = { k: 'cmp', op: '<=', a: { k: 'fact', fact: 'readiness', key: null }, b: T(lvl('readiness', 2)) }
reportProgram('a comparison on a fact that may be unknown', optCmp)

console.log('\n  Calendar reads and frequency:')
const calFn = clone(P.withTempo.def) as FnDef
calFn.body = { k: 'xform', op: 'scaleSets', s: { k: 'param', name: 's' }, arg: { k: 'cal', q: { q: 'day' } }, metric: null }
report('a calendar read in a definition body (a fn is a pure function)', checkFn(calFn, reg))
const calInit = clone(ER.c25k.def)
calInit.state['week']!.init = { k: 'cal', q: { q: 'day' } }
report('a calendar read in scheme init (no stamped day exists yet)', checkScheme(calInit, reg))
const longWindow = clone(ER.easyRun.def)
firstStep(longWindow.plan).count = { k: 'n', n: { k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 90, measure: { m: 'count' } } } }
report('a 90-day calendar window', checkScheme(longWindow, reg))
const hard4 = clone(ER.hrTempoBlock.def)
hard4.frequency = [{ k: 'atLeast', n: 4, of: { s: 'tag', tag: 'hard' }, per: { k: 'week' } }, hard4.frequency[1]!]
reportProgram('four hard runs a week, two days apart', hard4)
const legsCap = clone(P.legsFrequency.def)
legsCap.frequency = [...legsCap.frequency, { k: 'atMost', n: 2, of: { s: 'any' }, withinDays: 7 }]
reportProgram('legs three times a week, but at most two workouts in any 7 days', legsCap)
const timeCommit = clone(ER.c25k.def)
timeCommit.state['done']!.writableBy = ['session', 'owner', 'periodClosed']
timeCommit.on.periodClosed = { k: 'patch', set: { done: commitField(T(num(0))) } }
report('a periodClosed handler that commits (time alone never commits)', checkScheme(timeCommit, reg))

console.log('\n  Structure: groups, muscles, policies, phases, publication:')
const restLadder = clone(P.stabLadder.def)
;(firstStep(restLadder.plan).target as SetIR).rest = T(mins(1))
reportProgram('a circuit member with its own rest', P.optStabilization.def, withScheme(restLadder))
const flexible = scheme({
  id: 'demo/flexible',
  version: 1,
  says: '{lift}, two to four sets',
  params: { lift: ty.exercise('bodyweight_reps') },
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) => session({ exercise: c.p.lift, steps: (b) => void b.step('w', setsBetween(sets(2), sets(4)), set({ target: { reps: reps(10) } })) }),
  on: {},
})
const emomProg = (death: boolean) =>
  program({
    id: `demo/emom-${death ? 'death-by' : 'plain'}`,
    version: 1,
    says: 'x',
    params: {},
    calendar: { weeks: ['train'], repeat: 'cycle' },
    muscles: ['chest'],
    slots: () => ({ burpee: flexible.bind({ lift: exercise('burpee') }, { muscles: { chest: 1 } }) }),
    days: { A: [death ? deathBy(mins(1), 30, 'burpee') : emom(mins(1), 'burpee')] },
    rotation: { k: 'weekly', days: ['A'] },
  }).def
const emomReg = publish([...P.PUBLISHED, ...ER.PUBLISHED, flexible])
reportProgram('an EMOM member with a variable set count', emomProg(false), emomReg)
reportProgram('the same EMOM declared death-by (bounded by its rounds)', emomProg(true), emomReg)
const noPrimary = clone(P.optPower.def)
noPrimary.slots['pass']!.meta.muscles = { chest: 0.5 }
reportProgram('a slot with no primary muscle (the EC-218 shape)', noPrimary)
const badPolicy = clone(P.rpMeso.def)
delete badPolicy.policies[0]!.plan!.args['rir']
badPolicy.policies[0]!.plan!.args['load'] = T(rir(4))
reportProgram('a deload policy missing an argument and mistyping another', badPolicy)
const badImport = clone(P.gzclpT1Program.def)
badImport.imports['squatStart'] = { from: P.linear3x5.def.ref, export: 'benchLoad' }
reportProgram('an import naming an export the predecessor does not publish', badImport)
const peak = macro({ id: 'demo/peak', version: 1, says: 'x', anchor: { k: 'peakOn', date: localDay('2027-03-06') }, drift: 'anchored', phases: [phase('Block', P.optLoaded, { k: 'fixed' }, () => ({ benchStart: none(ty.q('mass')) }))] })
report('peakOn under slide drift', checkMacro({ ...peak, drift: 'slide' }, reg))
const inverted = clone(P.optMacro)
;(inverted.phases[0]!.length as { min: number }).min = 7
report('a bounded phase with min 7 > max 6', checkMacro(inverted, reg))
const openFirst = clone(P.optMacro)
openFirst.phases = [openFirst.phases[4]!, ...openFirst.phases.slice(1, 4)]
report('an open phase that is not last', checkMacro(openFirst, reg).filter((e) => e.code !== 'unknownName'))
const fixedCycle: MacroDef = { ...clone(ER.achillesReturn), phases: [{ ...clone(ER.achillesReturn.phases[0]!), length: { k: 'fixed' } }] }
report('a fixed phase over a cycling calendar', checkMacro(fixedCycle, reg))
const selfCall = clone(P.juggernautBump.def) as FnDef
selfCall.body = { k: 'app', def: selfCall.ref, args: { amrap: { k: 'param', name: 'amrap' }, standard: { k: 'param', name: 'standard' }, perRep: { k: 'param', name: 'perRep' } } }
report('a definition that calls itself', checkFn(selfCall, publish([selfCall])))
const fA = fn<{ x: Q<'one'> }, Q<'one'>>({ id: 'demo/ping', version: 1, params: { x: ty.q('one') }, result: ty.q('one'), says: '{x}', examples: [{ args: { x: num(1) }, gives: num(1) }], body: (p) => p.x })
const fB = fn<{ x: Q<'one'> }, Q<'one'>>({ id: 'demo/pong', version: 1, params: { x: ty.q('one') }, result: ty.q('one'), says: '{x}', examples: [{ args: { x: num(1) }, gives: num(1) }], body: (p) => fA({ x: p.x }) })
const pingCallsPong = { ...fA.def, body: { k: 'app', def: fB.def.ref, args: { x: { k: 'param', name: 'x' } } } } as FnDef
const mutual = publish([pingCallsPong, fB])
report('mutual recursion: ping (published first) calls pong', checkFn(pingCallsPong, mutual))
report('mutual recursion: pong calls ping (published before it)', checkFn(fB.def, mutual))
const asRepsPlan = clone(P.linearGated.def)
;(firstStep(asRepsPlan.plan).target as SetIR).target['reps'] = { b: 'exact', v: { k: 'asReps', a: T(rir(2)) } }
report('asReps outside a library body', checkScheme(asRepsPlan, reg))
const gz = clone(P.gzclpT1.def)
delete (gz.plan as Extract<Term, { k: 'match' }>).cases['retest']
report('GZCLP plan missing its declared stage “retest”', checkScheme(gz, reg))
const divide = clone(P.juggernautBump.def) as FnDef
divide.body = { k: 'arith', op: '/' as never, a: { k: 'param', name: 'perRep' }, b: { k: 'param', name: 'amrap' } }
report('division (not a former in v1)', checkFn(divide, reg))

console.log('\n  Verdicts and outcomes (S1, S2):')
const lg = P.linearGated.def
const verdictTerm: Term = { k: 'event', q: { q: 'verdict', steps: 'working', bound: 'floor' } }
const lgMatch = lg.on.session as Extract<Term, { k: 'match' }>
const punisher = clone(lg)
punisher.on.session = { k: 'if', c: { k: 'cmp', op: '==', a: verdictTerm, b: { k: 'lit', lit: { k: 'enum', name: 'verdict', tag: 'hit' } } }, a: lgMatch.cases['hit']!, b: { k: 'patch', set: { misses: commitField({ k: 'arith', op: '+', a: { k: 'self', field: 'misses' }, b: T(num(1)) }) } } }
report('the two-way silence punisher: if verdict == hit … otherwise count a miss', checkScheme(punisher, reg))
const twoArms = clone(lg)
delete (twoArms.on.session as Extract<Term, { k: 'match' }>).cases['unknown']
report('a verdict match with no unknown arm', checkScheme(twoArms, reg))
const oldHit = clone(lg)
oldHit.on.session = { k: 'if', c: { k: 'event', q: { q: 'hitAll', steps: 'working', bound: 'floor' } as never }, a: lgMatch.cases['hit']!, b: { k: 'patch', set: {} } }
report('the v2 two-valued hitAll read', checkScheme(oldHit, reg))
const both = clone(P.juggernautRealization.def)
both.on.session = { k: 'both', a: both.on.session!, b: { k: 'patch', set: { tm: commitField(T(kg(50))) } } } as never
report('both(commit tm, commit tm = 50 kg): the v2 outcome pair', checkScheme(both, reg))
const iterate = clone(P.juggernautRealization.def)
;(iterate.on.session as PatchIR).set['tm']!.to = { k: 'iterate', times: T(num(10)), max: 3, init: { k: 'self', field: 'tm' }, acc: 'a', step: { k: 'var', name: 'a' } } as never
report('iterate (cut: fold over range covers it)', checkScheme(iterate, reg))
console.log("  (A patch is a record: `{ tm: …, tm: … }` cannot be written, so one handler never writes a field twice.)")

console.log('\n  Clock sorts (S5):')
const squatPlan = (load: Term): Term => ({ ...clone(P.linearGated.def.plan as SessionIR), steps: [{ ...firstStep(P.linearGated.def.plan), target: { ...(firstStep(P.linearGated.def.plan).target as SetIR), target: { reps: { b: 'exact', v: T(reps(5)) }, load: { b: 'exact', v: load } } } }] })
const calLoad = clone(lg)
calLoad.plan = squatPlan({ k: 'arith', op: '+', a: T(kg(100)), b: { k: 'arith', op: '*', a: { k: 'lit', lit: { k: 'q', v: 0.25, unit: 'kg', per: 'd' } }, b: { k: 'cal', q: { q: 'day' } } } })
report('load = 100 kg + 0.25 kg per day × the days since you started', checkScheme(calLoad, reg))
const daysToWeeks = clone(ER.c25k.def)
daysToWeeks.plan = { ...(daysToWeeks.plan as Extract<Term, { k: 'nth' }>), i: { k: 'arith', op: '*', a: { k: 'cal', q: { q: 'day' } }, b: { k: 'lit', lit: { k: 'q', v: 1 / 7, unit: 'wk', per: 'd' } } } }
report('the C25K rung indexed by days × (1/7 week per day)', checkScheme(daysToWeeks, reg))
const calIndex = clone(ER.c25k.def)
calIndex.plan = { ...(calIndex.plan as Extract<Term, { k: 'nth' }>), i: { k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 28, measure: { m: 'count' } } } }
report('the C25K rung indexed by how many workouts you did in the last 28 days', checkScheme(calIndex, reg))
const clockCmp = clone(ER.c25k.def)
clockCmp.plan = { k: 'if', c: { k: 'cmp', op: '>', a: { k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 28, measure: { m: 'count' } } }, b: { k: 'pos', field: 'slotSession' } }, a: clockCmp.plan, b: clockCmp.plan }
report('sessions in the last 28 days > the sessions of this exercise done (calendar vs progress)', checkScheme(clockCmp, reg))
const launder = clone(ER.c25k.def)
;((launder.on.session as Extract<Term, { k: 'match' }>).cases['missed'] as PatchIR).set['done'] = commitField({ k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 7, measure: { m: 'count' } } })
report('a calendar count committed into state (then read by the plan as a plain count)', checkScheme(launder, reg))
const launderOrElse = clone(ER.c25k.def)
;((launderOrElse.on.session as Extract<Term, { k: 'match' }>).cases['missed'] as PatchIR).set['done'] = commitField({ k: 'orElse', a: { k: 'none', of: { t: 'q', dim: {} } }, b: { k: 'cal', q: { q: 'recent', of: { s: 'any' }, days: 7, measure: { m: 'count' } } } })
report('a calendar count laundered through orElse (an absent count, else the sessions of the last 7 days) and committed into state', checkScheme(launderOrElse, reg))

console.log('\n  Logging (S5):')
const swap = clone(lg)
swap.plan = T(swapExercise(exprOfTerm(lg.plan), exercise('plank')))
report('swapExercise(squat 3×5 at the working weight → plank)', checkScheme(swap, reg))
const reshapePlank = clone(ER.isoHold.def)
reshapePlank.plan = { k: 'xform', op: 'reshape', s: reshapePlank.plan, arg: T(set({ target: { load: kg(20) } })), metric: null }
report('reshape a plank session with a 20 kg load', checkScheme(reshapePlank, reg))
const scalePace = clone(lg)
scalePace.plan = { k: 'xform', op: 'scaleMetric', s: lg.plan, arg: T(pct(90)), metric: 'pace' }
report('scaleMetric(pace, 90%) on a squat session', checkScheme(scalePace, reg))
const ladderLoad = clone(P.stabLadder.def)
;(firstStep(ladderLoad.plan).target as SetIR).target['load'] = { b: 'exact', v: T(kg(20)) }
report('a load on a ladder whose rungs log bodyweight and loaded (the v2 IR accepted it)', checkScheme(ladderLoad, reg))
const ghost = clone(lg)
;(ghost.plan as SessionIR).exercise = { k: 'lit', lit: { k: 'ref', kind: 'exercise', id: 'wger:nope' } }
report('an exercise id the registry does not know', checkScheme(ghost, reg))

console.log('\n  Tables, lets, allocation (S4, S7):')
const levels = clone(P.rpSetDelta.def) as FnDef
;(levels.body as Extract<Term, { k: 'table' }>).rows.pop()
report('a soreness table missing level 3', checkFn(levels, reg))
const apreUnsorted = clone(P.apreAdjust.def) as FnDef
const apreTable = apreUnsorted.body as Extract<Term, { k: 'table' }>
apreTable.rows = [apreTable.rows[1]!, apreTable.rows[0]!, ...apreTable.rows.slice(2)]
report('APRE thresholds out of order (up to 4, then up to 2)', checkFn(apreUnsorted, reg))
const apreDead = clone(P.apreAdjust.def) as FnDef
;(apreDead.body as Extract<Term, { k: 'table' }>).rows.splice(1, 0, { when: reps(2).lit, then: T(kg(9)) })
report('APRE with a dead row (a second “up to 2 reps”)', checkFn(apreDead, reg))
const apreTerm = clone(P.apreAdjust.def) as FnDef
;(apreTerm.body as Extract<Term, { k: 'table' }>).rows[0]!.when = { k: 'param', name: 'reps' } as never
report('a threshold given as a term', checkFn(apreTerm, reg))
const overflow = clone(P.apreAdjust.def) as FnDef
;(overflow.body as Extract<Term, { k: 'table' }>).overflow = 'cycle'
report('a threshold table with a clock overflow', checkFn(overflow, reg))
const unlabeled = edit(clone(P.rpMeso.def), (t) => t.k === 'let', (t) => ({ ...(t as Extract<Term, { k: 'let' }>), label: '' }))
reportProgram('a let with no label', unlabeled)
const overAsk = edit(clone(P.rpMeso.def), (t) => t.k === 'allocate', (t) => ({ ...(t as Extract<Term, { k: 'allocate' }>), n: T(sets(12)) }))
reportProgram('allocate 12 sets with a bound of 8', overAsk)

console.log('\n  Policies and kinds (S3, S6, S9):')
const bbbDeload = clone(P.fiveThreeOneBBB.def)
bbbDeload.slots = { squat: bbbDeload.slots['squat']!, squatBbb: bbbDeload.slots['squatBbb']! }
bbbDeload.days = { squat: bbbDeload.days['squat']! }
bbbDeload.rotation = { k: 'weekly', days: ['squat'] }
bbbDeload.policies = [{ ...clone(P.rpMeso.def.policies[0]!), origin: 'role' }]
reportProgram('5/3/1 squat + BBB under a program that ALSO deloads deload weeks', bbbDeload)
const c25kCut = clone(ER.couchTo5k.def)
c25kCut.facts = ['dietPhase']
c25kCut.policies = [clone(P.upperHypertrophy.def.policies[2]!)]
reportProgram('the cut law on Couch to 5K (no load field anywhere)', c25kCut)
const reordered = clone(P.rpMeso.def)
reordered.policies = [...reordered.policies].reverse() as Policy[]
reportProgram('the allocation default listed before the deload-week rule', reordered)
const mislabeled = clone(P.w531.def)
;(mislabeled.state['tm'] as StateDecl & { kind?: string }).kind = 'flag'
report(`a mass field labelled kind 'flag' in JSON: the label is ignored, its kind is ${kindOf(mislabeled.state['tm']!.ty)}, the cut law reaches it`, checkScheme(mislabeled, reg))

console.log('\n  The ingest refusal (runtime, time.ts):')
const legsSpec = calendarSpecOf(P.legsFrequency.def, calReads(P.legsFrequency.def, reg), 'i', localDay('2026-10-05'), localDay('2026-10-05'))
const empty = occurrenceOf({ workoutId: 'w17', localDay: localDay('2026-10-17'), day: 'A', slots: ['squat', 'bench'], startedEarly: false, loggedSets: 0 }, legsSpec)
console.log(`  ${'refused' in empty ? 'REFUSED' : 'OK     '} a session closed with zero logged sets`)
if ('refused' in empty) console.log(`          ${empty.refused}: ${empty.workoutId} is a non-event; no rule fires, no streak moves, no window counts it, no gap resets`)

// ── 3c. The converse corpus: what the IR accepts that was authored as JSON ──
h('3c. CONVERSE: every IR-accepted JSON construct has a TS twin or is a listed embedding gap')
const zoneFn: FnDef = { ...clone(P.withTempo.def), ref: { id: 'demo/zone-minutes' as never, version: 1 }, params: {}, result: { t: 'map', key: 'enum:hrZone', of: { t: 'q', dim: { time: 1 } } }, says: 'x', body: { k: 'tabulate', keys: { k: 'keys', of: 'enum:hrZone' }, as: 'z' as never, body: T(mins(10)) }, examples: [{ args: {}, gives: { k: 'tabulate', keys: { k: 'keys', of: 'enum:hrZone' }, as: 'z' as never, body: T(mins(10)) } }] }
report('tabulate over an enum (minutes per heart-rate zone). Gap: the embedding has no enum key list; author it as JSON', checkFn(zoneFn, publish([zoneFn])))
const roleTable = clone(P.bbb.def)
const roleIf = roleTable.plan as Extract<Term, { k: 'if' }>
roleTable.plan = { k: 'table', key: { k: 'pos', field: 'role' }, rows: ['train', 'deload', 'test', 'taper', 'intro', 'accumulation', 'intensification', 'realization'].map((r) => ({ when: r, then: r === 'deload' ? roleIf.a : roleIf.b })), otherwise: null, overflow: null }
report('a table keyed by an enum (the week role). TS twin: match (programs.ts lib/gzclp-t1)', checkScheme(roleTable, reg))
const calThreshold = scheme({
  id: 'demo/after-day-14',
  version: 1,
  says: 'x',
  params: {},
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: () => session({ exercise: exercise('calf-iso'), steps: (b) => void b.step('w', table(cal.day, [[days(13), sets(3)]], sets(5)), set({ target: { duration: mins(1) } })) }),
  on: {},
})
report('a threshold table on the calendar day (a condition, not a magnitude). TS twin: this definition', checkScheme(calThreshold.def, reg))
console.log('  Also IR-accepted and JSON-only: the §7 sweet-spot scheme with the `power` metric. Gap: the embedding')
console.log('  types metrics from a static interface, so an extension needs that entry too (the drift risk).')

// ── 4. Analysis ─────────────────────────────────────────────────────────────────
h('4. ANALYSIS: writeSet against writableBy ("when does the TM change?")')
for (const [field, decl] of Object.entries(P.w531.def.state)) {
  const writes = writeSet(P.w531.def).filter((w) => w.field === field)
  console.log(`  5/3/1 ${decl.noun} (${kindOf(decl.ty)}): declared writable by ${decl.writableBy.join(', ')}; written by ${writes.map((w) => `${w.on} (${w.mode})`).join(', ')}`)
}
for (const [field, decl] of Object.entries(P.rpMeso.def.aggregate!.state)) {
  const writes = writeSet(P.rpMeso.def).filter((w) => w.field === field)
  console.log(`  RP ${decl.noun} (${kindOf(decl.ty)}): declared writable by ${decl.writableBy.join(', ')}; written by ${writes.map((w) => `${w.on} (${w.mode})`).join(', ')}; lands as a proposal by policy (D4)`)
}

// ── 5. Prose ──────────────────────────────────────────────────────────────────
h('5a. PROSE: the computed Juggernaut increment (handler, two zooms, two traces)')
const juggCx = { ...cx, lib: true, params: { lift: 'Barbell Back Squat', standard: '10 reps', perRep: '2.5 kg per rep' }, nouns: { tm: 'training max' } }
console.log(`  intent:    ${describe(P.juggernautRealization.def.on.session!, juggCx)}`)
console.log(`  mechanism: ${describe(P.juggernautRealization.def.on.session!, { ...juggCx, zoom: 'mechanism' })}`)
// The evaluator's own trace, explained (R2): these lines are byte-identical to the v3 arithmetic-only tracer they replace.
const trace = (t: Term) => explain(evaluate(t, ctxOf(reg)), reg)
for (const amrapReps of [13, 8]) console.log(`  trace (AMRAP ${amrapReps}): ${trace(P.juggernautBump({ amrap: reps(amrapReps), standard: reps(10), perRep: rate(2.5, 'kg', 'rep') }).term)}`)
console.log(`  trace (mixed units, one canonical sum): ${trace(add(kg(100), lb(5)).term)}`)
console.log(`  RPE is input notation: rpe(8) is stored as ${JSON.stringify(rpe(8).lit)} and reads back as ${describe(rpe(8).term, cx)}`)
const userBump = fn<{ load: Q<'mass'> }, Q<'mass'>>({
  id: 'user/bump',
  version: 1,
  params: { load: ty.q('mass') },
  result: ty.q('mass'),
  says: 'a small bump on {load}',
  examples: [{ args: { load: kg(100) }, gives: kg(105) }],
  body: (p) => mul(p.load, pct(105)),
})
console.log(`  D5: user/bump's template says “${userBump.def.says}”; a call site renders its mechanism instead: ${describe(userBump({ load: kg(100) }).term, cxOf(publish([userBump])))}`)

h('5b. PROSE: RP allocation, the muscle-scope weekEnd handler')
const rpCx = { ...programCx(P.rpMeso.def, cx), nouns: { target: 'weekly set target', extra: 'weekly extra sets' } }
console.log(`  intent:    ${describe(P.rpMeso.def.aggregate!.on.weekEnd!, rpCx)}`)

h('5c. PROSE: the 5/3/1 scheme as bound to the squat slot (its waves are one positional table)')
for (const l of describeSlot(P.w531.def, bindingArgs(P.fiveThreeOneBBB.def, P.fiveThreeOneBBB.def.slots['squat']!, cx), cx, P.fiveThreeOneBBB.def.calendar)) say('  ', l)
for (const l of describeSlot(P.bbb.def, bindingArgs(P.fiveThreeOneBBB.def, P.fiveThreeOneBBB.def.slots['squatBbb']!, cx), programCx(P.fiveThreeOneBBB.def, cx))) say('  ', l)
console.log('  Jokers and First Set Last (pre-tested loop, self-reads, a count range):')
for (const l of describeSlot(P.w531Jokers.def, { lift: 'Barbell Back Squat', tm: 'your training max' }, cx).slice(1)) say('  ', l)

h('5d. PROSE: the strength and hypertrophy programs at intent zoom')
for (const p of [P.linear3x5, P.fiveThreeOneBBB, P.gzclpT1Program, P.rpMeso, P.optStabilization, P.optStrengthEndurance]) {
  console.log('')
  for (const l of describeProgram(p.def, cx)) say('  ', l)
}
console.log('\n  (b) APRE (a scheme; shown bound to bench; its chart is one threshold table):')
for (const l of describeSlot(P.apreTopBackoff.def, { lift: 'Barbell Bench Press', small: '5 lb', big: '10 lb', backoffs: '2 sets', keep: '90%' }, cx)) say('    ', l)
console.log(`    The chart itself: ${describe(P.apreAdjust.def.body, cxOf(reg, { lib: true, params: { reps: 'the top-set reps', small: '5 lb', big: '10 lb' } }))}`)
console.log(`\n  (f) ${macroHeadline(P.optMacro)}`)
for (const l of describeMacroPhases(P.optMacro, cx)) say('    ', l)

h('5e. PROSE: Couch to 5K (repeat blocks, recovery steps, a week repeated on a miss)')
for (const l of describeProgram(ER.couchTo5k.def, cx)) say('  ', l)
for (const l of describeSlot(ER.c25k.def, {}, programCx(ER.couchTo5k.def, cx))) say('  ', l)

h('5f. PROSE: an HR-zone tempo block (heart rate from the HR trace, pace in min/km)')
for (const l of describeProgram(ER.hrTempoBlock.def, cx)) say('  ', l)
for (const l of describeSlot(ER.hrTempo.def, bindingArgs(ER.hrTempoBlock.def, ER.hrTempoBlock.def.slots['tempo']!, cx), cx)) say('  ', l)

h('5g. PROSE: a pain-gated Achilles return (pain on two clocks, a proposed regression, a time floor)')
console.log(`  ${macroHeadline(ER.achillesReturn)}`)
for (const l of describeMacroPhases(ER.achillesReturn, cx)) say('    ', l)
for (const p of [ER.achillesIsometric, ER.achillesLoading]) for (const l of describeProgram(p.def, cx)) say('  ', l)
for (const l of describeSlot(ER.painGated.def, bindingArgs(ER.achillesLoading.def, ER.achillesLoading.def.slots['drops']!, cx), cx)) say('  ', l)

h('5h. PROSE: a technique-bearing hypertrophy program (intensifier, stage read, deload strip, policies)')
for (const l of describeProgram(P.upperHypertrophy.def, cx)) say('  ', l)
for (const l of describeSlot(P.restPauseDc.def, bindingArgs(P.upperHypertrophy.def, P.upperHypertrophy.def.slots['press']!, cx), cx)) say('  ', l)
for (const l of describeSlot(P.clusterStrength.def, bindingArgs(P.upperHypertrophy.def, P.upperHypertrophy.def.slots['row']!, cx), cx)) say('  ', l)

h('5i. PROSE: policy stacking, composed (S3)')
console.log('  The default hit policy (all in order): co-firing deloads are stated as ONE result, not two sentences:')
for (const l of stackingText(P.upperHypertrophy.def, programCx(P.upperHypertrophy.def, cx))) say('    ', l)
console.log('  The same program declaring `hitPolicy: first`:')
for (const l of stackingText({ ...P.upperHypertrophy.def, hitPolicy: 'first' }, programCx(P.upperHypertrophy.def, cx))) say('    ', l)

h('5j. PROSE: the four scope ambiguities of the v2 describer, each pair now distinct')
const self = (f: string) => exprOfTerm<Q<'one'>>({ k: 'self', field: f })
const A = ge(self('misses'), num(3))
const B = ge(self('rung'), num(2))
const C = ge(self('solid'), num(1))
const nouns = { misses: 'misses', rung: 'rung', solid: 'solid sessions', x: 'x' }
const pc = cxOf(reg, { nouns })
const pX = (n: number) => exprOfTerm<Upd<{ x: Q<'one'> }>>({ k: 'patch', set: { x: commitField(T(num(n))) } })
const pair = (label: string, l: Expr<unknown, Cap>, r: Expr<unknown, Cap>) => {
  const [dl, dr] = [describe(l.term, pc), describe(r.term, pc)]
  console.log(`  ${label}${dl === dr ? '  (STILL IDENTICAL)' : ''}`)
  for (const [tag, x] of [['left: ', dl], ['right:', dr]]) console.log(`    ${tag} ${pad(x!.replace(/^\n/, ''))}`)
}
const pad = (s: string) => s.replace(/\n/g, '\n           ')
pair('1. and over or, against or over and:', and(or(A, B), C), or(A, and(B, C)))
pair('2. a conditional nested in the THEN arm, against an else-if chain (statements):', iff(A, iff(B, pX(1), pX(2)), pX(3)), iff(A, pX(1), iff(B, pX(2), pX(3))))
pair('2b. the same two shapes as values:', iff(A, iff(B, kg(5), kg(6)), kg(7)), iff(A, kg(5), iff(B, kg(6), kg(7))))
pair('3. not over and, against and over not:', not(and(A, B)), and(not(A), B))
const pain = fact('pain')
pair(
  '4. an unknown-guard around a conditional, against one inside its last arm:',
  orElse(known(pain, (p) => iff(gt(p, lvl('pain', 5)), pX(1), pX(2))), pX(0)),
  known(pain, (p) => iff(gt(p, lvl('pain', 5)), pX(1), orElse(known(pain, () => pX(2)), pX(0)))),
)

h('5k. PROSE: nouns and labels that cannot lie (S7)')
const cutLie = named('a 10% cut', mul(exprOfTerm<Q<'mass'>>({ k: 'self', field: 'tm' }), pct(110)))
console.log(`  In a user definition:    ${describe(cutLie.term, cxOf(reg, { nouns: { tm: 'training max' } }))}`)
console.log(`  In a library definition: ${describe(cutLie.term, cxOf(reg, { lib: true, nouns: { tm: 'training max' } }))} (library nouns pass review, like templates)`)
console.log(`  An exercise renders its registry label: ${describe(exercise('wger:105').term, cx)} (there is no label to supply)`)
console.log(`  A user program's own words do not render. prog/c25k says “${ER.couchTo5k.def.says}”; it is described as:`)
console.log(`    ${headline(ER.couchTo5k.def)}`)

h('5l. PROSE: a 12-week wave from range(n), not 12 hand-typed rows (S9)')
const wave = scheme({
  id: 'demo/linear-wave',
  version: 1,
  says: 'x',
  params: { lift: ty.exercise('weight_reps') },
  state: { tm: ty.opt(ty.q('mass')) },
  writableBy: { tm: ['owner'] },
  nouns: { tm: 'training max' },
  init: () => ({ tm: none(ty.q('mass')) }),
  plan: (c) =>
    session({
      exercise: c.p.lift,
      steps: (b) => void b.step('w', sets(3), set({ target: { reps: reps(5), load: known(c.s.tm, (t) => mul(t, named('the wave', nth(tabulate(range(12), (i) => add(pct(65), mul(i, pct(2.5)))), c.pos.week, 'hold')))) } })),
    }),
  on: {},
})
report('demo/linear-wave', checkScheme(wave.def, reg))
console.log(`  ${describe(wave.def.plan, cxOf(reg, { params: { lift: 'Barbell Back Squat' }, nouns: { tm: 'training max' } }))}`)

// ── 6. Time: frequency and the missed-workout derivation ─────────────────────
h('6. TIME: "legs 3x a week" and "missed one workout last week", run by the calendar slice')
const legs = P.legsFrequency.def
for (const l of describeProgram(legs, cx).slice(0, 4)) say('  ', l)
const legsSel = sel.muscle('quads', 'hamstrings', 'glutes')
console.log(`  Live read for the home surface: ${phrase(cal.count(legsSel, 7).term, cx)}.`)
const ingest = (st: CalendarState, o: Occurrence, adHoc = false) => stepCalendar(legsSpec, st, { k: 'sessionClosed', causeKey: `session:${o.workoutId}`, occurrence: o, adHoc })
const occ = (id: string, d: string, day: 'A' | 'B' | 'C' | null, slots: string[]) => {
  const o = occurrenceOf({ workoutId: id, localDay: localDay(d), day, slots, startedEarly: false, loggedSets: 6 }, legsSpec)
  if ('refused' in o) throw new Error('unexpected refusal')
  return o
}
const closeThrough = (st: CalendarState, today: string) => {
  const evs = reconcile(legsSpec, st, localDay(today))
  return { st: evs.reduce((s, e) => stepCalendar(legsSpec, s, e), st), n: evs.length }
}
console.log(`\n  Anchor ${dayText(legsSpec.anchor)} (a ${weekday(legsSpec.anchor)}), activated the same day; drift slide.`)
let st = activate(legsSpec)
console.log(`  Activation issues ${st.expectations.length} expectations for the first 7-day window (${st.expectations.map((x) => x.key).join(', ')}).`)
st = ingest(st, occ('w5', '2026-10-05', 'A', ['squat', 'bench']))
st = ingest(st, occ('w7', '2026-10-07', 'B', ['rdl', 'row']))
st = ingest(st, occ('w9', '2026-10-09', 'C', ['thrust', 'bench']))
st = ingest(st, occ('w12', '2026-10-12', 'A', ['squat', 'bench']))
st = ingest(st, occ('w15', '2026-10-15', 'B', ['rdl', 'row']))
console.log(`  Logged: Day A on ${dayText(localDay('2026-10-05'))}, B on the 7th, C on the 9th; then A on the 12th and B on the 15th.`)
const emptyClose = occurrenceOf({ workoutId: 'w17e', localDay: localDay('2026-10-17'), day: 'C', slots: ['thrust', 'bench'], startedEarly: false, loggedSets: 0 }, legsSpec)
console.log(`  Saturday 17th: Day C opened and finished with nothing logged → ${'refused' in emptyClose ? emptyClose.refused : 'ingested'}; it never reaches the calendar.`)
st = ingest(st, { workoutId: 'adhoc17', localDay: localDay('2026-10-17'), day: null, slots: [], muscles: ['quads'], startedEarly: false }, true)
console.log('  Saturday 17th: an ad-hoc squat session outside the program → counts for days-since-legs (detraining is physiological), never for attendance.')
const legsKey = selKey(legsSel)
console.log(`  Days since your last legs session, read on Sunday 18th: ${dayNum(localDay('2026-10-18')) - dayNum(st.lastOn[legsKey]!)} (the ad-hoc squat on the 17th).`)
const r19 = closeThrough(st, '2026-10-19')
st = r19.st
console.log(`\n  Monday 19th, first prescribe: reconcile emits ${r19.n} dayClosed events (6 to 18 October) and applies them in order.`)
const again = closeThrough(st, '2026-10-19')
console.log(`  Reconcile again on the 19th: ${again.n} events; the state is ${again.st === st ? 'unchanged' : 'CHANGED'} (L5).`)
console.log(`  Replaying a dayClosed already applied: ${stepCalendar(legsSpec, st, { k: 'dayClosed', causeKey: `day:i:${localDay('2026-10-18')}`, day: localDay('2026-10-18') }) === st ? 'no-op' : 'APPLIED TWICE'}.`)
for (const a of st.adherence) console.log(`    ${adherenceText(st, a, legsSpec)}`)
console.log('  "Missed one workout last week" is the second window above: an expectation issued on the 11th, closed unmet on the 18th. No TM moved: the progress clock still points at Day C (slide).')
st = ingest(st, occ('w18', '2026-10-18', 'C', ['thrust', 'bench']))
console.log('\n  Day C, logged offline on Sunday 18th, syncs on the 19th: an amendment is appended; the adherence row is never edited.')
for (const a of st.adherence.slice(-2)) console.log(`    ${adherenceText(st, a, legsSpec)}`)
const recentLegs = st.occurrences.filter((o) => matches(o, legsSel, legsSpec) && dayNum(localDay('2026-10-19')) - dayNum(o.localDay) < 7).length
console.log(`  The live read on the 19th: ${recentLegs} legs sessions in the last 7 days (rolling, stamped when read; misses come only from the tumbling windows).`)
console.log(`  completedFraction (an export of every instance): ${completedFraction(st).toFixed(2)}.`)
const pausedSt = closeThrough(stepCalendar(legsSpec, st, { k: 'pause', causeKey: 'pause:p1', from: localDay('2026-10-28'), until: localDay('2026-10-30') }), '2026-11-02').st
console.log('\n  A pause from 28 to 30 October voids the window it touches (no proration); nothing else was logged:')
for (const a of pausedSt.adherence.slice(-4)) console.log(`    ${adherenceText(pausedSt, a, legsSpec)}`)

console.log('\n  Late logs only extend what the calendar knows (S8):')
const runSpec = calendarSpecOf(ER.couchTo5k.def, calReads(ER.couchTo5k.def, reg), 'r', localDay('2026-10-05'), localDay('2026-10-05'))
const run = (id: string, d: string) => ({ k: 'sessionClosed' as const, causeKey: `session:${id}` as const, occurrence: { workoutId: id, localDay: localDay(d), day: 'R', slots: ['run'], muscles: ['legs'], startedEarly: false }, adHoc: false })
let late = stepCalendar(runSpec, activate(runSpec), run('r9', '2026-10-09'))
late = stepCalendar(runSpec, late, run('r7', '2026-10-07'))
console.log(`  A run on Friday 9th, then Wednesday 7th's run syncs late: the last workout is still ${dayText(late.lastOn[selKey(sel.any())]!)} (v2 moved it back to the 7th).`)
const tempoGap = clone(ER.hrTempo.def)
tempoGap.plan = { k: 'if', c: T(orElse(known(cal.gap(sel.slot('tempo')), (g) => ge(g, days(7))), no)), a: tempoGap.plan, b: tempoGap.plan }
const gapReg = withScheme(tempoGap)
const gapSpec = calendarSpecOf(ER.hrTempoBlock.def, calReads(ER.hrTempoBlock.def, gapReg), 't', localDay('2026-10-05'), localDay('2026-10-05'))
console.log(`  A tempo plan that reads "days since your last tempo session": the calendar tracks ${gapSpec.tracked.map((s) => selKey(s)).join(', ')}.`)

console.log('\n  The due verdict (prescribe, soft):')
let rst = activate(runSpec)
rst = stepCalendar(runSpec, rst, run('r19', '2026-10-19'))
const due = dueVerdict(runSpec, rst, localDay('2026-10-20'), () => 2)
console.log(`  C25K, last run Monday 19th, opening the app Tuesday 20th: ${dueText(due, runSpec, () => '2 days', cx)}`)
console.log(`  The same on Wednesday 21st: ${dueText(dueVerdict(runSpec, rst, addDays(localDay('2026-10-20'), 1), () => 2), runSpec, () => '2 days', cx)}`)
const ahead = stepCalendar(runSpec, activate(runSpec), run('r21', '2026-10-21'))
console.log(`  A run stamped Wednesday 21st by a client a day ahead, prescribing on Tuesday 20th: ${dueText(dueVerdict(runSpec, ahead, localDay('2026-10-20'), () => 2), runSpec, () => '2 days', cx)}`)
console.log('  (the 2-day search horizon ran out; v2 printed an invented due day, Thursday 22nd, which was still blocked)')
console.log('\n  Feasibility, against the time memo §4.4 (which says four hard runs a week, 2 days apart, fit):')
for (const n of [3, 4]) {
  const bad = feasibility([freq.atLeast(n, sel.tag('hard'), per.week()), freq.minGap(sel.tag('hard'), days(2), 2)], 1)
  console.log(`    ${n} hard runs a week: ${bad ? `infeasible (${bad.why}); 0, 2, 4, 6 fits ONE week, but day 6 to the next week's day 0 is 1 day` : 'feasible'}.`)
}

// ── 7. The one-entry extension proof ─────────────────────────────────────────
h('7. EXTENSION: one metric (power) and one fact (hrv), each a single registry entry')
const power: MetricDecl = { dim: 'power', shapes: ['exact', 'range', 'atLeast', 'atMost', 'open'], loggedBy: { cardio: 'plain' }, better: 'higher', noun: 'power', lead: 'at', open: 'power recorded' }
const hrv: FactDecl = { key: 'none', ty: { t: 'q', dim: {} }, observed: 'preSession', maxAgeDays: 1, grain: { g: 'instant' }, noun: 'your morning HRV score' }
const EXT: Vocab = { ...BASE_VOCAB, metrics: { ...METRIC_DECLS, power }, facts: { ...FACT_DECLS, hrv } }
console.log('  The whole diff surface (nothing else in the package changes):')
console.log(`    registry.ts METRIC_DECLS  + power: ${JSON.stringify(power)}`)
console.log(`    registry.ts FACT_DECLS    + hrv:   ${JSON.stringify(hrv)}`)
const sweetSpot = scheme({
  id: 'ext/sweet-spot',
  version: 1,
  says: '3 × 12 min sweet-spot intervals on {bike}',
  params: { bike: ty.exercise('cardio') },
  facts: ['ftp'],
  state: {},
  writableBy: {},
  init: () => ({}),
  plan: (c) => session({ exercise: c.p.bike, steps: (b) => void b.step('ss', sets(3), set({ target: { duration: exactly(mins(12)) }, rest: mins(3) })) }),
  on: {},
}).def
const ssPlan = sweetSpot.plan as SessionIR
;(firstStep(ssPlan).target as SetIR).target['power'] = {
  b: 'range',
  min: known(fact('ftp'), (f) => mul(f, pct(88))).term,
  max: known(fact('ftp'), (f) => mul(f, pct(94))).term,
}
sweetSpot.facts = ['ftp', 'hrv']
sweetSpot.plan = {
  k: 'if',
  c: { k: 'orElse', a: { k: 'known', a: { k: 'fact', fact: 'hrv', key: null }, as: 'h' as never, then: false, body: { k: 'cmp', op: '<', a: { k: 'var', name: 'h' as never }, b: T(num(40)) } }, b: T(no) },
  a: { k: 'xform', op: 'scaleMetric', s: ssPlan, arg: T(pct(90)), metric: 'power' },
  b: ssPlan,
}
const extReg = { ...publish([...P.PUBLISHED, ...ER.PUBLISHED], EXT) }
report('the sweet-spot scheme against the BASE vocabulary', checkScheme(sweetSpot, reg))
report('the same scheme against the extended vocabulary', checkScheme(sweetSpot, extReg))
console.log(`  Generated prose, no describer touched:${describe(sweetSpot.plan, cxOf(extReg, { params: { bike: 'Indoor Bike' } })).replace(/\n/g, '\n    ')}`)

evaluatorSection(reg, h, say)
