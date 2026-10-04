/**
 * issue.ts — issuance: plan → immutable prescription (the sink), and the
 * live half of a prescription (open fields resolved from logged sets).
 *
 * issueSession = evaluate each slot's plan under the head → apply the plan
 * policies whose `when` holds, in the ONE order the checker verifies (role
 * sugar, allocation default, declared order), all of them or only the first
 * per the hit policy → apply the phase transform → L10 → the sink → the due
 * verdict → the stamp. `prescribe` (step.ts) reconciles first.
 *
 * THE SINK (R2 decisions):
 *  - a value below zero, or not finite, is silent `outOfDomain` (EC-32): a
 *    load of 0 is a legal bodyweight-only set, a negative one is not;
 *  - loads and distances quantize to the program's grid for that metric, to
 *    the NEAREST step, ties DOWN (the one quantization law, units.ts
 *    `nearestStep`: never prescribe more than computed; BV-26),
 *    in canonical units, so a 5 lb grid lands on lb multiples (BV-27);
 *  - an open field's planned value is sunk the same way, and so is every
 *    resolution, against the grids stamped on the issued fact.
 */
import type { Term, Unit } from './algebra'
import { keyOf } from './checker'
import type { Field, Head, IngestRefusal, IssuedBound, IssuedSession, IssuedSlot, IssuedStep, IssuedTarget, Logged, Resolution, SessionValue, Trace, Value } from './engine'
import { asQ, boundField, ctxOf, evaluate, type Ctx } from './evaluate'
import { evalProgram, hashOf, nextDay, planSlot, programCtx, roleOf, trainWeekOf, type Inputs, type Runtime } from './ports'
import type { Use } from './structure'
import { dueVerdict } from './time'
import { nearestStep } from './units'

const EPS = 1e-9
const STRIP_ROLES = new Set(['deload', 'taper', 'test'])

// ── the sink ────────────────────────────────────────────────────────────────

export type Grids = IssuedSession['stamp']['grids']
const quantize = (x: number, g: number | undefined) => (g && g > 0 ? nearestStep(x, g) : x)

export function sinkField(fd: Field, metric: string, grids: Grids): Field {
  if (fd.k === 'silent') return fd
  if (fd.k === 'open') return { ...fd, planned: sinkField(fd.planned, metric, grids) as Extract<Field, { k: 'fixed' | 'silent' }> }
  const b = fd.v
  const nums = b.b === 'open' ? [] : b.b === 'range' ? [b.min, b.max] : [b.v]
  const bad = nums.find((n) => !Number.isFinite(n) || n < -EPS)
  if (bad !== undefined) return { k: 'silent', cause: { k: 'outOfDomain', field: metric, value: bad } }
  const g = metric === 'load' ? grids.load : metric === 'distance' ? grids.distance : undefined
  const q = (n: number) => Math.max(0, quantize(n, g))
  const v: IssuedBound = b.b === 'open' ? b : b.b === 'range' ? { b: 'range', min: q(b.min), max: q(b.max) } : { b: b.b, v: q(b.v) }
  return { k: 'fixed', v }
}
const sinkTarget = (t: IssuedTarget, grids: Grids): IssuedTarget => ({
  ...t,
  metrics: Object.fromEntries(Object.entries(t.metrics).map(([m, fd]) => [m, sinkField(fd!, m, grids)])),
})

export function sinkSlot(rt: Runtime, slot: string, s: SessionValue, grids: Grids, trace: Trace): IssuedSlot {
  const ex = s.exercise
  const decl = ex.v === 'ref' ? rt.reg.vocab.exercises[ex.id] : undefined
  const exercise: IssuedSlot['exercise'] =
    ex.v === 'ref' && decl ? { id: ex.id, label: decl.label, logging: decl.logging } : { silent: ex.v === 'none' ? ex.cause : { k: 'missingKey', key: ex.v === 'ref' ? ex.id : 'exercise' } }
  const steps = s.steps.map((st): IssuedStep => ({ ...st, sets: st.sets.map((t) => sinkTarget(t, grids)) }))
  const intensifier = s.intensifier ? { ...s.intensifier, stages: s.intensifier.stages.map((t) => sinkTarget(t, grids)) } : null
  return { slot, exercise, steps, intensifier, trace }
}

export function gridsOf(rt: Runtime): Grids {
  const g: Grids = {}
  for (const m of ['load', 'distance'] as const) {
    const t = rt.def.grids[m]
    if (t) g[m] = asQ(evaluate(t, ctxOf(rt.reg)).value).n
  }
  return g
}

/** The unit each gridded metric displays in: its grid literal's unit. */
export function displayOf(rt: Runtime): Partial<Record<string, Unit>> {
  const out: Partial<Record<string, Unit>> = {}
  for (const [m, t] of Object.entries(rt.def.grids)) if (t && t.k === 'lit' && t.lit.k === 'q') out[m] = t.lit.unit
  return out
}

/** Apply a session→session Use (a policy's plan, a phase transform). */
export function applyUse(u: Use, s: SessionValue, cx: Ctx): SessionValue {
  const hole = '__session'
  const r = evaluate({ k: 'app', def: u.def, args: { ...u.args, [u.hole]: { k: 'var', name: hole as never } } }, { ...cx, vars: new Map([...cx.vars, [hole, { v: 'session', s }]]) })
  if (r.value.v !== 'session') throw new Error(`issue: ${keyOf(u.def)} did not return a session`)
  return r.value.s
}

// ── issuance ────────────────────────────────────────────────────────────────

/** Issue a prescription on an already-reconciled head. Refuses past the end
 *  of a `once` calendar (programComplete) and on an abandoned instance. */
export function issueSession(rt: Runtime, head: Head, day: string, inp: Inputs): IssuedSession | IngestRefusal {
  if (head.status === 'abandoned') return { code: 'instanceClosed', status: head.status }
  const role = roleOf(rt.def, head.progress.week)
  if (head.status === 'completed' || role === null) return { code: 'programComplete' }
  const groups = rt.def.days[day]
  if (!groups) throw new Error(`prescribe: the program has no day ${day} (the shell must name a declared day)`)
  const grids = gridsOf(rt)
  const pcx = programCtx(rt, head, inp)
  const fired: number[] = []
  for (const [i, pol] of rt.def.policies.entries()) {
    if (!pol.plan || (rt.def.hitPolicy === 'first' && fired.length)) continue
    const w = evalProgram(rt, head, pol.when, inp).value
    if (w.v === 'bool' && w.b) fired.push(i)
  }
  const slots = groups.flatMap((g) => (g.k === 'single' ? [g.slot] : g.slots))
  const issued = slots.map((slot) => {
    const trace = planSlot(rt, head, slot, inp)
    if (trace.value.v !== 'session') throw new Error(`prescribe: ${slot}'s plan is not a session`)
    let s = trace.value.s
    for (const i of fired) s = applyUse(rt.def.policies[i]!.plan!, s, pcx)
    if (rt.phaseTransform) s = applyUse(rt.phaseTransform, s, pcx)
    if (STRIP_ROLES.has(role)) s = { ...s, intensifier: null }
    return sinkSlot(rt, slot, s, grids, trace)
  })
  const gapDays = (rule: number) => {
    const f = rt.spec.frequency[rule]
    if (!f || f.k !== 'minGap') return 0
    return asQ(evalProgram(rt, head, f.gap, inp).value).n
  }
  const due = dueVerdict(rt.spec, head.calendar, inp.today, gapDays)
  const position = { week: head.progress.week, trainWeek: trainWeekOf(rt.def, head.progress.week), role, slotSessions: { ...head.progress.slotSessions }, phase: rt.phase }
  return {
    issueKey: `${rt.spec.instance}:${head.progress.sessions}:${day}`,
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
      grids,
      display: displayOf(rt),
    },
  }
}

// ── the live half: resolutions and the current view ─────────────────────────

const latestKey = (slot: IssuedSlot, id: string) => [...slot.steps].reverse().find((s) => s.id === id)

/** The issued fact with every open field replaced by its latest resolution. */
export function currentView(issued: IssuedSession, resolutions: readonly Resolution[]): IssuedSlot[] {
  const latest = new Map<string, Resolution>()
  for (const r of resolutions) if (r.issueKey === issued.issueKey) latest.set(`${r.slot}:${r.step}:${r.index}:${r.metric}`, r)
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

/** A live context for one slot of an issued fact: earlier steps' logged sets
 *  and their current targets. `own` limits a step's self-read to the sets
 *  before index i. */
function liveCtx(rt: Pick<Runtime, 'reg'>, view: IssuedSlot, logged: Record<string, import('./engine').PerformedSet[]>, frame: import('./engine').Frame, own: { id: string; key: string; before: number } | null, display: IssuedSession['stamp']['display'] = {}): Ctx {
  return ctxOf(rt.reg, {
    frame,
    display,
    ports: {
      performed: (id) => (own && own.id === id ? (logged[own.key] ?? []).slice(0, own.before) : (logged[latestKey(view, id)?.key ?? id] ?? [])),
      prescribed: (id) => latestKey(view, id)?.sets ?? null,
    },
  })
}

/** Resolve every open field whose dependencies are logged. Appends only:
 *  a field already resolved from the same dependency values yields no row
 *  (idempotent, EC-185); an EDITED dependency yields a superseding row. */
export function resolveLive(rt: Pick<Runtime, 'reg'>, issued: IssuedSession, logged: Logged, already: readonly Resolution[]): Resolution[] {
  const out: Resolution[] = []
  const have = new Set(already.map((r) => r.key))
  for (const sl of issued.slots) {
    const view = currentView(issued, [...already, ...out]).find((x) => x.slot === sl.slot)!
    const mine = logged[sl.slot] ?? {}
    for (const st of sl.steps)
      st.sets.forEach((t, i) => {
        for (const [m, fd] of Object.entries(t.metrics)) {
          if (fd?.k !== 'open') continue
          const ready = fd.dependsOn.every((d) => (d === st.id ? (mine[st.key]?.length ?? 0) >= i : (mine[latestKey(view, d)?.key ?? d]?.length ?? 0) > 0))
          if (!ready) continue
          const cx = liveCtx(rt, view, mine, fd.frame, { id: st.id, key: st.key, before: i }, issued.stamp.display)
          const kids: Trace[] = []
          const value = sinkField(boundField(fd.bound, cx, kids), m, issued.stamp.grids) as Extract<Field, { k: 'fixed' | 'silent' }>
          const deps = fd.dependsOn.map((d) => (d === st.id ? (mine[st.key] ?? []).slice(0, i) : mine[latestKey(view, d)?.key ?? d]))
          const key = `${issued.issueKey}:${sl.slot}:${st.key}:${i}:${m}@${hashOf(deps)}`
          if (have.has(key)) continue
          have.add(key)
          const trace: Trace = { node: { k: 'set', role: t.role, target: { [m]: fd.bound }, rest: null, tempo: null, cluster: null } as Term, value: { v: 'set', t: { ...t, metrics: { [m]: value } } }, kids }
          out.push({ key, issueKey: issued.issueKey, slot: sl.slot, step: st.key, index: i, metric: m, value, trace })
        }
      })
  }
  return out
}

/** How many sets of an until/while step are due now, from what was logged:
 *  `while` asks its condition before each set, `until` after each one. */
export function setsDue(rt: Pick<Runtime, 'reg'>, view: IssuedSlot, st: IssuedStep, logged: Record<string, import('./engine').PerformedSet[]>): number {
  if (!st.live || (st.count.k !== 'until' && st.count.k !== 'while')) return st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.max : 0
  const done = logged[st.key]?.length ?? 0
  const cond = (before: number): boolean => {
    const v: Value = evaluate(st.live!.cond, liveCtx(rt, view, logged, st.live!.frame, { id: st.id, key: st.key, before })).value
    return v.v === 'bool' && v.b
  }
  if (st.count.k === 'while') return done < st.count.max && cond(done) ? done + 1 : done
  if (done === 0) return 1
  return cond(done) ? done : Math.min(st.count.max, done + 1)
}
