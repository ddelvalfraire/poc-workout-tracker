/**
 * ports.ts — how a program instance's world reaches the evaluator: the
 * runtime (program, registry, calendar), the progress position, and the
 * ports each position grants (state, peers, program fields, facts with
 * staleness, stamped calendar reads, aggregates over planned volume).
 *
 * Every port is a pure function of the head and the stamped inputs, and the
 * fact and calendar ports RECORD what they read, with values, so the issued
 * fact and the transition carry their reads (L12, amendment C).
 */
import type { Term } from './algebra'
import { enumsWith, keyOf, type Registry } from './checker'
import type { FactReading, FactSource, Head, IssuedStep, Trace, Value } from './engine'
import { ctxOf, evaluate, nodesOf, none, qv, type AggRead, type Ctx, type Ports } from './evaluate'
import type { ProgramDef, SchemeDef, Use, WeekRole } from './structure'
import { calendarSpecOf, dayNum, matches, selKey, type CalQuery, type CalendarSpec, type CalendarState, type LocalDay, type Rotation, type Selector } from './time'
import { DIMS } from './units'
import { isJudged } from './xform'

/** Every term a program evaluates: its slots' schemes, policies, aggregate. */
function programTerms(p: ProgramDef, reg: Registry): Term[] {
  const schemes = Object.values(p.slots).flatMap((b) => reg.schemes.get(keyOf(b.scheme)) ?? [])
  return [...schemes.flatMap((s) => [s.plan, ...Object.values(s.on)]), ...p.policies.map((x) => x.when), ...Object.values(p.aggregate?.on ?? {})].filter((t): t is Term => !!t)
}
/** The selectors a program reads through cal.gap / cal.recent: what the
 *  calendar must keep a last day for (Elaborated.reads.selectors). */
export function calReads(p: ProgramDef, reg: Registry): Selector[] {
  return programTerms(p, reg).flatMap((t) => [...nodesOf(t)].flatMap((n) => (n.k === 'cal' && (n.q.q === 'gap' || n.q.q === 'recent') ? [n.q.of] : [])))
}

export interface Runtime {
  reg: Registry
  def: ProgramDef
  spec: CalendarSpec
  /** A macro phase's transform, applied after every policy (prescribe's contract). */
  phaseTransform: Use | null
  phase: string | null
}
export function runtimeOf(reg: Registry, def: ProgramDef, inst: { id: string; anchor: LocalDay; activatedOn: LocalDay }, phase: { label: string; transform: Use | null } | null = null): Runtime {
  return { reg, def, spec: calendarSpecOf(def, calReads(def, reg), inst.id, inst.anchor, inst.activatedOn), phaseTransform: phase?.transform ?? null, phase: phase?.label ?? null }
}

/** FNV-1a over the definition's JSON: the stamp's program hash until the
 *  content-addressed elaboration lands. */
export function hashOf(x: unknown): string {
  let h = 0x811c9dc5
  for (const ch of JSON.stringify(x)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ── the progress clock ──────────────────────────────────────────────────────

/** The role of a block week; null past the end of a `once` calendar. */
export function roleOf(def: ProgramDef, week: number): WeekRole | null {
  const ws = def.calendar.weeks
  if (def.calendar.repeat === 'once' && week >= ws.length) return null
  return ws[week % ws.length]!
}
/** trainWeek: the block weeks before this one whose role is not deload or
 *  taper, across cycles (a test week counts). During a deload it is the next
 *  train index (EC-158, EC-159). */
export function trainWeekOf(def: ProgramDef, week: number): number {
  let n = 0
  for (let w = 0; w < week; w++) {
    const r = def.calendar.weeks[w % def.calendar.weeks.length]!
    if (r !== 'deload' && r !== 'taper') n++
  }
  return n
}
/** Rotation entries that close one block week. */
export function entriesPerWeek(r: Rotation): number {
  switch (r.k) {
    case 'weekly':
      return r.days.length
    case 'alternate':
      return r.perWeek
    case 'pattern':
      return r.days.filter((x) => typeof x === 'string').length
    case 'daily':
      return r.perDay * 7
  }
}
/** The day the shell proposes by default: the rotation's next unmet entry. */
export function nextDay(r: Rotation, sessions: number, weekEntries: number): string {
  switch (r.k) {
    case 'weekly':
      return r.days[weekEntries % r.days.length]!
    case 'alternate':
      return r.days[sessions % r.days.length]!
    case 'pattern': {
      const ds = r.days.filter((x): x is string => typeof x === 'string')
      return ds[sessions % ds.length]!
    }
    case 'daily':
      return r.days[Math.floor(sessions / r.perDay) % r.days.length]!
  }
}
/** How many times a week a slot is trained under the rotation (fractional
 *  for an alternation): what weekly planned volume multiplies by. */
export function sessionsPerWeek(def: ProgramDef, slot: string): number {
  const r = def.rotation
  const has = (d: string) => (def.days[d] ?? []).filter((g) => (g.k === 'single' ? g.slot === slot : g.slots.includes(slot))).length
  const days: string[] = r.k === 'pattern' ? r.days.filter((x): x is string => typeof x === 'string') : r.days
  const perEntry = days.reduce((a, d) => a + has(d), 0) / days.length
  return perEntry * (r.k === 'pattern' ? (days.length * 7) / r.days.length : entriesPerWeek(r))
}

// ── facts and the calendar, recorded as read ────────────────────────────────

export interface Reads {
  facts: FactReading[]
  cal: { q: CalQuery; value: Value }[]
}
export const newReads = (): Reads => ({ facts: [], cal: [] })

export const snapshotSource = (readings: readonly FactReading[]): FactSource => ({
  get: (fact, key) => readings.find((r) => r.fact === fact && r.key === key) ?? null,
})
export const noFacts: FactSource = { get: () => null }

/** A fact read: unknown is silence; older than its maxAgeDays is silence
 *  too (never the last known value); either way the read is recorded. */
export function factPort(reg: Registry, src: FactSource, today: LocalDay, reads: Reads): Ports['fact'] {
  return (fact, key) => {
    const r = src.get(fact, key)
    if (!r) return none({ k: 'factUnknown', fact, key })
    if (!reads.facts.some((x) => x.fact === r.fact && x.key === r.key)) reads.facts.push(r)
    const max = reg.vocab.facts[fact]?.maxAgeDays
    if (max !== null && max !== undefined && dayNum(today) - dayNum(r.observedOn) > max) return none({ k: 'factStale', fact, observedOn: r.observedOn, maxAgeDays: max })
    return r.value
  }
}

/** Calendar reads against a stamped day. A window counts the days
 *  (today − N, today]; a gap is absent before the first matching session. */
export function calPort(spec: CalendarSpec, st: CalendarState, today: LocalDay, earlierToday: number, reads: Reads): Ports['cal'] {
  return (q) => {
    const value = ((): Value => {
      switch (q.q) {
        case 'day':
          return qv(dayNum(today) - dayNum(spec.anchor), DIMS.days, 'd', { clock: 'calendar' })
        case 'earlierToday':
          return qv(earlierToday, {}, 'x', { clock: 'calendar' })
        case 'gap': {
          const tracked = st.lastOn[selKey(q.of)]
          const occ = st.occurrences.filter((o) => matches(o, q.of, spec) && dayNum(o.localDay) <= dayNum(today)).map((o) => dayNum(o.localDay))
          const last = tracked ? dayNum(tracked) : occ.length ? Math.max(...occ) : null
          return last === null ? none({ k: 'noPriorSession' }) : qv(dayNum(today) - last, DIMS.days, 'd', { clock: 'calendar' })
        }
        case 'recent': {
          const inWin = st.occurrences.filter((o) => matches(o, q.of, spec) && dayNum(today) - dayNum(o.localDay) < q.days && dayNum(o.localDay) <= dayNum(today))
          if (q.measure.m === 'count') return qv(inWin.length, {}, 'x', { clock: 'calendar' })
          const metric = q.measure.metric
          const xs = inWin.map((o) => o.totals?.[metric]).filter((x): x is { sum: number; max: number } => !!x)
          if (q.measure.m === 'sum') return qv(xs.reduce((a, x) => a + x.sum, 0), {}, null, { clock: 'calendar' })
          return xs.length ? qv(Math.max(...xs.map((x) => x.max)), {}, null, { clock: 'calendar' }) : none({ k: 'noPriorSession' })
        }
      }
    })()
    reads.cal.push({ q, value })
    return value
  }
}

// ── scopes: what a slot and the program see ─────────────────────────────────

export function schemeOf(rt: Runtime, head: Head, slot: string): SchemeDef {
  const b = head.bindings[slot]
  const s = b && rt.reg.schemes.get(keyOf(b.scheme))
  if (!s) throw new Error(`runtime: slot ${slot} has no published scheme`)
  return s
}

export interface Inputs {
  facts: FactSource
  today: LocalDay
  earlierToday: number
  reads: Reads
  /** The previous phase's terminal state, for a macro handoff. */
  prevPhase?: Head['state']
}

const posPort = (rt: Runtime, head: Head, slot: string | null): Ports['pos'] => (field) => {
  const w = head.progress.week
  switch (field) {
    case 'week':
      return qv(w, DIMS.weeks, 'wk', { clock: 'progress' })
    case 'trainWeek':
      return qv(trainWeekOf(rt.def, w), DIMS.weeks, 'wk', { clock: 'progress' })
    case 'role':
      return { v: 'enum', name: 'weekRole', tag: roleOf(rt.def, w) ?? 'train' }
    case 'slotSession':
      return qv(slot ? (head.progress.slotSessions[slot] ?? 0) : 0, {}, 'x', { clock: 'progress' })
  }
}
const peerPort = (head: Head, prev?: Head['state']): Ports['peer'] => (slot, field, of) => {
  const v = (of === 'prevPhase' ? prev : head.state)?.[slot]?.[field]
  return v ?? none({ k: 'stateUnset', field: `${slot}.${field}` })
}
const keysPort = (rt: Runtime): Ports['keys'] => (of) =>
  of === 'slots' ? Object.keys(rt.def.slots).map((id) => ({ v: 'ref', kind: 'slot', id })) : rt.def.muscles.map((id) => ({ v: 'ref', kind: 'muscle', id }))

/** A slot's parameters: its binding's arguments, evaluated at the bind
 *  position (program params and peers' LIVE state: BBB's TM). */
export function slotParams(rt: Runtime, head: Head, slot: string, inp: Inputs): Record<string, Value> {
  const b = head.bindings[slot]!
  const cx = ctxOf(rt.reg, { params: head.params, ports: { peer: peerPort(head, inp.prevPhase) } })
  return Object.fromEntries(Object.entries(b.args).map(([k, t]) => [k, evaluate(t, cx).value]))
}

/** The plan / handler context of one slot. */
export function slotCtx(rt: Runtime, head: Head, slot: string, inp: Inputs, params = slotParams(rt, head, slot, inp)): Ctx {
  const s = schemeOf(rt, head, slot)
  const ports: Partial<Ports> = {
    self: (f) => head.state[slot]?.[f] ?? none({ k: 'stateUnset', field: f }),
    peer: peerPort(head, inp.prevPhase),
    program: (f) => {
      const v = head.state['program']?.[f]
      if (!v) return none({ k: 'stateUnset', field: f })
      if (v.v !== 'map') return v
      return v.entries.find(([k]) => k === slot)?.[1] ?? none({ k: 'missingKey', key: slot })
    },
    fact: factPort(rt.reg, inp.facts, inp.today, inp.reads),
    pos: posPort(rt, head, slot),
    cal: calPort(rt.spec, head.calendar, inp.today, inp.earlierToday, inp.reads),
    keys: keysPort(rt),
  }
  return ctxOf(rt.reg, { params, ports, enums: enumsWith(s.enums) })
}

/** The program-scope context: policies, frequency gaps and the aggregate
 *  read program params and the aggregate's own state. */
export function programCtx(rt: Runtime, head: Head, inp: Inputs): Ctx {
  const ports: Partial<Ports> = {
    self: (f) => head.state['program']?.[f] ?? none({ k: 'stateUnset', field: f }),
    peer: peerPort(head, inp.prevPhase),
    fact: factPort(rt.reg, inp.facts, inp.today, inp.reads),
    pos: posPort(rt, head, null),
    cal: calPort(rt.spec, head.calendar, inp.today, inp.earlierToday, inp.reads),
    keys: keysPort(rt),
    agg: aggPort(rt, head, inp),
  }
  return ctxOf(rt.reg, { params: head.params, ports, enums: enumsWith(rt.def.enums) })
}

/** Evaluate a slot's plan under the head: the session it would issue now. */
export function planSlot(rt: Runtime, head: Head, slot: string, inp: Inputs): Trace {
  return evaluate(schemeOf(rt, head, slot).plan, slotCtx(rt, head, slot, inp))
}

// ── aggregates over the program's plans, under the pre-state ────────────────

const primaryOf = (def: ProgramDef, slot: string) => Object.entries(def.slots[slot]?.meta.muscles ?? {}).find(([, c]) => c === 1)?.[0]

/** Working sets one session of a step list plans, technique-weighted: an
 *  intensifier's stages count 0.5 each (the final set is already a set). */
export function plannedSets(steps: IssuedStep[], intensifierStages: number): number {
  const sets = steps.reduce((a, st) => a + st.sets.slice(0, st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.min : st.count.planned).filter(isJudged).length, 0)
  return sets + 0.5 * intensifierStages
}

export function aggPort(rt: Runtime, head: Head, inp: Inputs): Ports['agg'] {
  const memo = new Map<string, Value>()
  const weeklyOf = (slot: string, metric: string): number => {
    const t = planSlot(rt, head, slot, { ...inp, reads: newReads() })
    if (t.value.v !== 'session') return 0
    const s = t.value.s
    const perSession =
      metric === 'sets'
        ? plannedSets(s.steps, s.intensifier?.stages.length ?? 0)
        : s.steps.flatMap((st) => st.sets.filter(isJudged)).reduce((a, x) => {
            const f = x.metrics[metric]
            const fx = f?.k === 'open' ? f.planned : f
            return a + (fx?.k === 'fixed' && fx.v.b !== 'open' ? (fx.v.b === 'range' ? fx.v.min : fx.v.v) : 0)
          }, 0)
    return perSession * sessionsPerWeek(rt.def, slot)
  }
  return (q: AggRead) => {
    const k = JSON.stringify(q)
    const hit = memo.get(k)
    if (hit) return hit
    const slots = Object.keys(rt.def.slots)
    let v: Value
    if (q.q === 'slotsFor') v = { v: 'list', items: slots.filter((s) => primaryOf(rt.def, s) === q.muscle).map((id) => ({ v: 'ref', kind: 'slot', id })) }
    else {
      const unit = q.metric === 'sets' ? 'set' : null
      const dim = q.metric === 'sets' ? DIMS.sets : {}
      const by = q.by
      const total =
        by.k === 'slot'
          ? weeklyOf(by.id, q.metric)
          : by.k === 'muscle'
            ? slots.reduce((a, s) => a + (rt.def.slots[s]!.meta.muscles[by.id] ?? 0) * weeklyOf(s, q.metric), 0)
            : slots.filter((s) => rt.def.slots[s]!.meta.tags?.includes((by as { tag: string }).tag)).reduce((a, s) => a + weeklyOf(s, q.metric), 0)
      v = qv(total, dim, unit)
    }
    memo.set(k, v)
    return v
  }
}

/** Evaluate a term in the program scope (a policy `when`, a cadence gap). */
export function evalProgram(rt: Runtime, head: Head, t: Term, inp: Inputs): Trace {
  return evaluate(t, programCtx(rt, head, inp))
}
