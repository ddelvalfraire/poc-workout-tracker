/**
 * issue.ts — issuance: plan → immutable prescription (the sink), and the
 * live half of a prescription (open fields resolved from logged sets).
 *
 * issueSession = evaluate each slot's plan under the head → apply the plan
 * policies whose `when` holds, in the ONE order the checker verifies (role
 * sugar, allocation default, declared order), all of them or only the first
 * per the hit policy → apply the phase transform → L10 → the sink → the due
 * verdict → the stamp. `prescribe` (step.ts) reconciles first. The issued
 * trace is the whole chain: each transform's trace takes the previous one as
 * the trace of its session argument, and when L10 or the sink changed a number
 * a last node carries the issued value and says what changed.
 *
 * THE SINK (semantics review round: direction-preserving):
 *  - a value below zero, or not finite, is silent `outOfDomain` (EC-32): a
 *    load of 0 is a legal bodyweight-only set, a negative one is not; so is a
 *    range whose min is above its max;
 *  - each metric with a grid quantizes to it in canonical units: loads and
 *    distances to the program's grid (a 5 lb grid lands on lb multiples,
 *    BV-27), and every metric of rep or set dimension to whole numbers;
 *  - the bound's direction decides how: `exact` to the NEAREST step, ties
 *    down (units.ts `nearestStep`); a floor (`atLeast`, a range's min) UP and
 *    a ceiling (`atMost`, a range's max) DOWN, so a bound may tighten and never
 *    loosens. A range left with no grid point inside is silent `outOfDomain`;
 *  - an open field's planned value is sunk the same way, and so is every
 *    resolution, against the grids stamped on the issued fact.
 */
import type { Term } from './algebra'
import { keyOf, type Registry } from './checker'
import type { Field, Head, IngestRefusal, IssuedBound, IssuedSession, IssuedSlot, IssuedStep, IssuedTarget, Logged, PerformedSet, Resolution, SessionValue, Trace, Value } from './engine'
import { asQ, boundField, cmpNum, ctxOf, evaluate, type Ctx } from './evaluate'
import { canonicalJson } from './canonical'
import { displayOf, evalProgram, hashOf, nextDay, planSlot, programCtx, roleOf, slotGridsOf, trainWeekOf, type Inputs, type Runtime } from './ports'
import type { Use } from './structure'
import { dueVerdict } from './time'
import { DIMS, dimEq, nearestStep, stepDown, stepUp, type Ties } from './units'
import { STRIP_DEFAULT } from './options'

/** L10's role list: the program's stripIntensifierOn, else the table's
 *  default (options.ts, the one copy). */
const stripRolesOf = (def: Pick<Runtime['def'], 'stripIntensifierOn'>): readonly string[] => def.stripIntensifierOn ?? STRIP_DEFAULT

// ── the sink ────────────────────────────────────────────────────────────────

/** Canonical quantization steps per metric. */
export type Grids = Readonly<Partial<Record<string, number>>>

/** The program's grids plus a whole-number grid for every metric of rep or
 *  set dimension: what the sink quantizes against. */
export function sinkGrids(reg: Pick<Registry, 'vocab'>, grids: Grids): Grids {
  const whole = Object.entries(reg.vocab.metrics)
    .filter(([, d]) => dimEq(DIMS[d.dim], DIMS.reps) || dimEq(DIMS[d.dim], DIMS.sets))
    .map(([m]) => [m, 1] as const)
  return { ...Object.fromEntries(whole), ...grids }
}

export function sinkField(fd: Field, metric: string, grids: Grids, ties: Ties = 'down'): Field {
  if (fd.k === 'silent') return fd
  if (fd.k === 'open') return { ...fd, planned: sinkField(fd.planned, metric, grids, ties) as Extract<Field, { k: 'fixed' | 'silent' }> }
  const b = fd.v
  const outOf = (value: number): Field => ({ k: 'silent', cause: { k: 'outOfDomain', field: metric, value } })
  const nums = b.b === 'open' ? [] : b.b === 'range' ? [b.min, b.max] : [b.v]
  const bad = nums.find((n) => !Number.isFinite(n) || n < -1e-9)
  if (bad !== undefined) return outOf(bad)
  if (b.b === 'range' && cmpNum(b.min, b.max) > 0) return outOf(b.min)
  const g = grids[metric]
  const by = (f: (x: number, s: number) => number) => (x: number) => Math.max(0, g !== undefined && g > 0 ? f(x, g) : x)
  // The ties direction applies to exact bounds only (C6): floors and
  // ceilings are already directional.
  const [near, up, down] = [by((x, st) => nearestStep(x, st, ties)), by(stepUp), by(stepDown)]
  switch (b.b) {
    case 'open':
      return fd
    case 'exact':
      return { k: 'fixed', v: { b: 'exact', v: near(b.v) } }
    case 'atLeast':
      return { k: 'fixed', v: { b: 'atLeast', v: up(b.v) } }
    case 'atMost':
      return { k: 'fixed', v: { b: 'atMost', v: down(b.v) } }
    case 'range': {
      const [min, max] = [up(b.min), down(b.max)]
      return cmpNum(min, max) > 0 ? outOf(b.min) : { k: 'fixed', v: { b: 'range', min, max } }
    }
  }
}
// The default direction is OMITTED at the call, so a recorded default call
// keeps its pre-round shape (the fixtures are the contract).
const sink1 = (fd: Field, m: string, grids: Grids, ties: Ties): Field => (ties === 'up' ? sinkField(fd, m, grids, ties) : sinkField(fd, m, grids))
const sinkTarget = (t: IssuedTarget, grids: Grids, ties: Ties): IssuedTarget => ({
  ...t,
  metrics: Object.fromEntries(Object.entries(t.metrics).map(([m, fd]) => [m, sink1(fd!, m, grids, ties)])),
})

export function sinkSlot(rt: Pick<Runtime, 'reg'>, slot: string, s: SessionValue, grids: Grids, trace: Trace, ties: Ties = 'down'): IssuedSlot {
  const ex = s.exercise
  const decl = ex.v === 'ref' ? rt.reg.vocab.exercises[ex.id] : undefined
  const exercise: IssuedSlot['exercise'] =
    ex.v === 'ref' && decl ? { id: ex.id, label: decl.label, logging: decl.logging } : { silent: ex.v === 'none' ? ex.cause : { k: 'missingKey', key: ex.v === 'ref' ? ex.id : 'exercise' } }
  const g = sinkGrids(rt.reg, grids)
  const steps = s.steps.map((st): IssuedStep => ({ ...st, sets: st.sets.map((t) => sinkTarget(t, g, ties)) }))
  const intensifier = s.intensifier ? { ...s.intensifier, stages: s.intensifier.stages.map((t) => sinkTarget(t, g, ties)) } : null
  return { slot, exercise, steps, intensifier, trace }
}

export function gridsOf(rt: Runtime): IssuedSession['stamp']['grids'] {
  const g: IssuedSession['stamp']['grids'] = {}
  for (const m of ['load', 'distance'] as const) {
    const t = rt.def.grids[m]
    if (t) g[m] = asQ(evaluate(t, ctxOf(rt.reg)).value).n
  }
  return g
}

export { displayOf }

/** Apply a session→session Use (a policy's plan, a phase transform), traced:
 *  the trace of the session argument is `prev`, so a chain of transforms
 *  explains the session it ends with. */
export function applyUseTraced(u: Use, prev: Trace, cx: Ctx): Trace {
  const hole = '__session'
  const s = prev.value
  const app: Extract<Term, { k: 'app' }> = { k: 'app', def: u.def, args: { ...u.args, [u.hole]: { k: 'var', name: hole as never } } }
  const r = evaluate(app, { ...cx, vars: new Map([...cx.vars, [hole, s]]) })
  if (r.value.v !== 'session') throw new Error(`issue: ${keyOf(u.def)} did not return a session`)
  const at = Object.keys(app.args).indexOf(u.hole)
  return { ...r, kids: r.kids.map((k, i) => (i === at ? prev : k)) }
}
export function applyUse(u: Use, s: SessionValue, cx: Ctx): SessionValue {
  const r = applyUseTraced(u, { node: { k: 'var', name: '__session' as never }, value: { v: 'session', s }, kids: [] }, cx).value
  return (r as Extract<Value, { v: 'session' }>).s
}

// ── issuance ────────────────────────────────────────────────────────────────

/** The plan policies whose `when` holds now, in the one application order. */
export function firedPolicies(rt: Runtime, head: Head, inp: Inputs): number[] {
  const fired: number[] = []
  for (const [i, pol] of rt.def.policies.entries()) {
    if (!pol.plan || (rt.def.hitPolicy === 'first' && fired.length)) continue
    const w = evalProgram(rt, head, pol.when, inp).value
    if (w.v === 'bool' && w.b) fired.push(i)
  }
  return fired
}

/** One slot as it would be issued: the plan, the fired policies, the phase
 *  transform, L10, the sink. The trace is the whole chain. */
export function issueSlot(rt: Runtime, head: Head, slot: string, inp: Inputs, fired: readonly number[]): IssuedSlot {
  const role = roleOf(rt.def, head.progress.week) ?? 'train'
  let trace = planSlot(rt, head, slot, inp)
  if (trace.value.v !== 'session') throw new Error(`prescribe: ${slot}'s plan is not a session`)
  const pcx = programCtx(rt, head, inp)
  for (const i of fired) trace = applyUseTraced(rt.def.policies[i]!.plan!, trace, pcx)
  if (rt.phaseTransform) trace = applyUseTraced(rt.phaseTransform, trace, pcx)
  const s = (trace.value as Extract<Value, { v: 'session' }>).s
  const strip = stripRolesOf(rt.def).includes(role) && s.intensifier !== null
  // U2: the slot's own grids win over the program's for this slot's sink; the
  // grid is never converted, so the issued value lands on the DECLARED unit's
  // multiples and displays in it.
  const out = sinkSlot(rt, slot, strip ? { ...s, intensifier: null } : s, { ...gridsOf(rt), ...slotGridsOf(rt, slot)?.grids }, trace, rt.def.ties ?? 'down')
  const issued: SessionValue = { exercise: s.exercise, steps: out.steps, intensifier: out.intensifier }
  const changed = sinkChanges(s, issued)
  if (!strip && !changed.length) return out
  const note = [...(strip ? [`L10: a ${role} week drops the intensifier`] : []), ...(changed.length ? [`the sink: ${changed.join('; ')}`] : [])].join('; ')
  return { ...out, trace: { node: trace.node, value: { v: 'session', s: issued }, kids: [trace], note } }
}
const boundText = (f: Field | undefined): string => (!f ? 'none' : f.k === 'silent' ? `silent (${f.cause.k})` : f.k === 'open' ? `open, planned ${boundText(f.planned)}` : canonicalJson(f.v))
function sinkChanges(before: SessionValue, after: SessionValue): string[] {
  const out: string[] = []
  before.steps.forEach((st, si) =>
    st.sets.forEach((t, i) => {
      for (const [m, fd] of Object.entries(t.metrics)) {
        const [a, b] = [boundText(fd), boundText(after.steps[si]?.sets[i]?.metrics[m])]
        if (a !== b) out.push(`${st.key}[${i}].${m} ${a} → ${b}`)
      }
    }),
  )
  return out
}

/** Issue a prescription on an already-reconciled head. Refuses past the end
 *  of a `once` calendar (programComplete) and on an abandoned instance. */
export function issueSession(rt: Runtime, head: Head, day: string, inp: Inputs): IssuedSession | IngestRefusal {
  if (head.status === 'abandoned') return { code: 'instanceClosed', status: head.status }
  const role = roleOf(rt.def, head.progress.week)
  if (head.status === 'completed' || role === null) return { code: 'programComplete' }
  const groups = rt.def.days[day]
  if (!groups) throw new Error(`prescribe: the program has no day ${day} (the shell must name a declared day)`)
  const fired = firedPolicies(rt, head, inp)
  const slots = groups.flatMap((g) => (g.k === 'single' ? [g.slot] : g.slots))
  const issued = slots.map((slot) => issueSlot(rt, head, slot, inp, fired))
  // U2: the per-slot grid stamp, present only when a slot of this session
  // declares its own grids; resolution reads it, never re-deriving.
  const slotGrids: NonNullable<IssuedSession['stamp']['slotGrids']> = {}
  for (const slot of slots) {
    const sg = slotGridsOf(rt, slot)
    if (sg) slotGrids[slot] = sg
  }
  const gapDays = (rule: number) => {
    const f = rt.spec.frequency[rule]
    if (!f || f.k !== 'minGap') return 0
    return asQ(evalProgram(rt, head, f.gap, inp).value).n
  }
  const due = dueVerdict(rt.spec, head.calendar, inp.today, gapDays)
  const position = { week: head.progress.week, trainWeek: trainWeekOf(rt.def, head.progress.week), role, slotSessions: { ...head.progress.slotSessions }, phase: rt.phase }
  return {
    // The state seq makes two issues at one rotation position distinct facts (F22).
    issueKey: `${rt.spec.instance}:${head.progress.sessions}:${day}:${head.seq}`,
    day,
    defaultDay: nextDay(rt.def.rotation, head.progress.sessions, head.progress.weekEntries),
    slots: issued,
    due,
    stamp: {
      programHash: hashOf(rt.def),
      stateSeq: head.seq,
      position,
      issuedOn: inp.today,
      factsRead: [...inp.reads.facts],
      calReads: [...inp.reads.cal],
      hitPolicy: rt.def.hitPolicy,
      policies: fired,
      phaseTransform: rt.phaseTransform?.def ?? null,
      grids: gridsOf(rt),
      ...(Object.keys(slotGrids).length ? { slotGrids } : {}),
      ...(rt.def.ties === 'up' ? { ties: 'up' as const } : {}),
      ...(rt.def.e1rm ? { e1rm: rt.def.e1rm } : {}),
      display: displayOf(rt),
    },
  }
}

// ── the boundary: what the logger hands the engine ──────────────────────────

/** A set as the logger records it, before the boundary. */
export interface RawSet {
  values: PerformedSet['values']
  completed: boolean
  stages: PerformedSet['stages']
}
/** The boundary contract (F14): a set the athlete did not complete is not a
 *  performed set. It is dropped here, and the flag never enters the engine. */
export function boundaryLogged(raw: Record<string, Record<string, readonly RawSet[]>>): Logged {
  return Object.fromEntries(Object.entries(raw).map(([slot, steps]) => [slot, Object.fromEntries(Object.entries(steps).map(([k, sets]) => [k, sets.filter((s) => s.completed).map((s) => ({ values: s.values, stages: s.stages }))]))]))
}

// ── the live half: resolutions and the current view ─────────────────────────

/** The step a read of `id` names from step `at` of a slot: the step itself
 *  (an until/while self-read), else the latest step with that id declared
 *  BEFORE it. In a repeat block that is the current iteration's row, exactly
 *  as the telescope saw it when planning (F5). */
export function visibleStep(slot: Pick<IssuedSlot, 'steps'>, at: number, id: string): IssuedStep | undefined {
  const here = slot.steps[at]
  if (here && here.id === id) return here
  for (let i = Math.min(at, slot.steps.length) - 1; i >= 0; i--) if (slot.steps[i]!.id === id) return slot.steps[i]
  return undefined
}

const cellOf = (r: Pick<Resolution, 'slot' | 'step' | 'index' | 'metric'>) => `${r.slot}:${r.step}:${r.index}:${r.metric}`

/** The latest resolution of each cell of one issue, by seq. */
function latestRows(issueKey: string, resolutions: readonly Resolution[]): Map<string, Resolution> {
  const latest = new Map<string, Resolution>()
  for (const r of resolutions) {
    if (r.issueKey !== issueKey) continue
    const cur = latest.get(cellOf(r))
    if (!cur || r.seq > cur.seq) latest.set(cellOf(r), r)
  }
  return latest
}

/** The issued fact with every open field replaced by its latest resolution
 *  (by seq, never by array position). */
export function currentView(issued: IssuedSession, resolutions: readonly Resolution[]): IssuedSlot[] {
  const latest = latestRows(issued.issueKey, resolutions)
  return issued.slots.map((sl) => ({
    ...sl,
    steps: sl.steps.map((st) => ({
      ...st,
      sets: st.sets.map((t, i) => ({
        ...t,
        metrics: Object.fromEntries(Object.entries(t.metrics).map(([m, fd]) => [m, fd?.k === 'open' ? (latest.get(`${sl.slot}:${st.key}:${i}:${m}`)?.value ?? fd) : fd])),
      })),
    })),
  }))
}

/** A live context for one step of a slot: the logged sets and current
 *  targets of the steps it can see. `own.before` limits a step's self-read to
 *  the sets before index i. */
function liveCtx(rt: Pick<Runtime, 'reg'>, view: IssuedSlot, at: number, logged: Record<string, PerformedSet[]>, frame: import('./engine').Frame, own: { id: string; key: string; before: number } | null, display: IssuedSession['stamp']['display'] = {}, ties: Ties = 'down', e1rm?: IssuedSession['stamp']['e1rm']): Ctx {
  return ctxOf(rt.reg, {
    frame,
    display,
    ...(ties === 'up' ? { ties: 'up' as const } : {}),
    ...(e1rm ? { e1rm: e1rm as NonNullable<Ctx['e1rm']> } : {}),
    logging: 'id' in view.exercise ? view.exercise.logging : null,
    ports: {
      performed: (id) => (own && own.id === id ? (logged[own.key] ?? []).slice(0, own.before) : (logged[visibleStep(view, at, id)?.key ?? id] ?? [])),
      prescribed: (id) => visibleStep(view, at, id)?.sets ?? null,
    },
  })
}

/** Resolve every open field whose dependencies are logged. Appends only.
 *  A cell whose LATEST row was computed from the same dependency values gets
 *  no row (idempotent, EC-185); any other value of the dependencies gets a
 *  new row with the next seq that supersedes, including a revert to values an
 *  older row saw (F3). The view is re-read after every row, so a field that
 *  reads a field resolved in this same call sees its new value (F4). */
export function resolveLive(rt: Pick<Runtime, 'reg'>, issued: IssuedSession, logged: Logged, already: readonly Resolution[]): Resolution[] {
  const out: Resolution[] = []
  const latest = latestRows(issued.issueKey, already)
  let seq = already.reduce((a, r) => Math.max(a, r.seq), 0)
  // Resolution quantizes against the STAMPED ties, never re-deriving (C6).
  const ties: Ties = issued.stamp.ties ?? 'down'
  for (const sl of issued.slots) {
    // The STAMPED per-slot grid wins (U2), like ties: never re-derived.
    const sg = issued.stamp.slotGrids?.[sl.slot]
    const grids = sinkGrids(rt.reg, { ...issued.stamp.grids, ...sg?.grids })
    const display = { ...issued.stamp.display, ...sg?.display }
    const mine = logged[sl.slot] ?? {}
    sl.steps.forEach((st, at) =>
      st.sets.forEach((t, i) => {
        for (const [m, fd] of Object.entries(t.metrics)) {
          if (fd?.k !== 'open') continue
          const view = currentView(issued, [...already, ...out]).find((x) => x.slot === sl.slot)!
          const depSets = (d: string) => (d === st.id ? (mine[st.key] ?? []).slice(0, i) : (mine[visibleStep(view, at, d)?.key ?? d] ?? []))
          const ready = fd.dependsOn.every((d) => (d === st.id ? (mine[st.key]?.length ?? 0) >= i : depSets(d).length > 0))
          if (!ready) continue
          const key = `${issued.issueKey}:${sl.slot}:${st.key}:${i}:${m}@${hashOf(fd.dependsOn.map(depSets))}`
          const cell = `${sl.slot}:${st.key}:${i}:${m}`
          if (latest.get(cell)?.key === key) continue
          const cx = liveCtx(rt, view, at, mine, fd.frame, { id: st.id, key: st.key, before: i }, display, ties, issued.stamp.e1rm)
          const kids: Trace[] = []
          const value = sink1(boundField(fd.bound, cx, kids), m, grids, ties) as Extract<Field, { k: 'fixed' | 'silent' }>
          const trace: Trace = { node: { k: 'set', role: t.role, target: { [m]: fd.bound }, rest: null, tempo: null, cluster: null } as Term, value: { v: 'set', t: { ...t, metrics: { [m]: value } } }, kids }
          const row: Resolution = { key, seq: ++seq, issueKey: issued.issueKey, slot: sl.slot, step: st.key, index: i, metric: m, value, trace }
          latest.set(cell, row)
          out.push(row)
        }
      }),
    )
  }
  return out
}

/** How many sets of an until/while step are due now, from what was logged:
 *  `while` asks its condition before each set, `until` after each one. */
export function setsDue(rt: Pick<Runtime, 'reg'>, view: IssuedSlot, st: IssuedStep, logged: Record<string, PerformedSet[]>, stamp?: Pick<IssuedSession['stamp'], 'display' | 'ties' | 'e1rm' | 'slotGrids'>): number {
  if (!st.live || (st.count.k !== 'until' && st.count.k !== 'while')) return st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.max : 0
  const at = Math.max(0, view.steps.findIndex((x) => x.key === st.key))
  const done = logged[st.key]?.length ?? 0
  // The slot's stamped display wins for its own condition reads (U2).
  const display = { ...(stamp?.display ?? {}), ...stamp?.slotGrids?.[view.slot]?.display }
  const cond = (before: number): boolean => {
    const v: Value = evaluate(st.live!.cond, liveCtx(rt, view, at, logged, st.live!.frame, { id: st.id, key: st.key, before }, display, stamp?.ties ?? 'down', stamp?.e1rm)).value
    return v.v === 'bool' && v.b
  }
  if (st.count.k === 'while') return done < st.count.max && cond(done) ? done + 1 : done
  if (done === 0) return 1
  return cond(done) ? done : Math.min(st.count.max, done + 1)
}

