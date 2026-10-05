/**
 * step.ts — transitions: activation, the pure `step` over every ingestible
 * event, the ledger (`ingest`, `replay`), `prescribe`, and `exportsOf`.
 *
 * ONE CLOSURE, ONE TRANSITION. A sessionClosed runs every slot's session
 * handler and the aggregate's against the SAME pre-state (L4), lands their
 * patches through the outcome policies, then advances the progress clock;
 * when that closes a block week it emits weekEnd (and cycleEnd or blockEnd)
 * under their own causeKeys IN THE SAME transition (L11), each boundary
 * reading the state the previous one left. A slot boundary handler with no
 * session of that slot in its window records keep(untrained) and does not run.
 *
 * THE OUTCOME CHANNEL. A committed field an outcome policy demotes lands as a
 * proposal (every demoting policy recorded); `volumeKeep` turns a volume
 * decrease into keep. A proposal snapshots its values AND the values its
 * fields had then: accepting it applies the snapshot only if no proposed
 * field has moved since (else it is void, EC-143); a newer proposal on one of
 * its fields supersedes it (EC-144); deciding an unknown proposal is a
 * recorded no-op (EC-145). The writer of record is the proposing handler,
 * and acceptance re-checks it (EC-146): a field that handler and the owner
 * can no longer write (a rebind changed its writers) voids the proposal,
 * recorded as `unwritable:key`; the owner's acceptance counts as an owner write.
 */
import type { Lit, Term } from './algebra'
import { keyOf } from './checker'
import type { Event, FactSource, Fired, Head, IngestRefusal, IngestResult, IssuedSession, Logged, Proposal, Transition, Value } from './engine'
import { canonicalJson } from './canonical'
import { evaluate, none, qv, sameValue } from './evaluate'
import { issueSession, currentView } from './issue'
import { eventPort, type EventSource } from './judge'
import { entriesPerWeek, newReads, noFacts, programCtx, roleOf, schemeOf, slotCtx, slotParams, snapshotSource, type Inputs, type Reads, type Runtime } from './ports'
import { kindOf, type SlotEventKind, type StateDecl } from './structure'
import { activate as activateCalendar, addDays, completedFraction, dayNum, dayOf, derivedAdherence, occurrenceOf, parseLocalDay, pauseStatus, reconcile, stepCalendar, type LocalDay } from './time'
import { DIMS } from './units'

// ── activation ──────────────────────────────────────────────────────────────

/** A new instance: every slot's state from its init (params and facts read
 *  at activation), the aggregate's from the program params, the calendar
 *  opened on the activation day. A `none` init is `stateUnset` for that field.
 *  The boundary refuses an empty list for a non-empty list parameter (F1).
 *  Slot inits are order-independent (P5): a binding argument may read a
 *  peer's state, so every slot is initialized against the state of the
 *  previous pass, all at once, until a pass changes nothing (at most one
 *  pass per slot, plus one). */
export function activate(rt: Runtime, params: Record<string, Value>, facts: FactSource): Head {
  for (const [name, ty] of Object.entries(rt.def.params)) {
    const v = params[name]
    if (ty.t === 'list' && ty.nonEmpty && v?.v === 'list' && !v.items.length) throw new Error(`activate: parameter ${name} must be a non-empty list (the boundary refuses an empty one)`)
  }
  const today = rt.spec.activatedOn
  const unset = (field: string, v: Value, noun: string): Value => (v.v === 'none' && v.cause.k === 'declaredNone' ? none({ k: 'stateUnset', field, noun }) : v)
  let head: Head = {
    seq: 0,
    state: {},
    params,
    bindings: Object.fromEntries(Object.entries(rt.def.slots).map(([k, b]) => [k, { scheme: b.scheme, args: b.args }])),
    pending: {},
    progress: { week: 0, slotSessions: {}, weekEntries: 0, sessions: 0, weekSlots: [], cycleSlots: [] },
    status: 'active',
    calendar: activateCalendar(rt.spec),
    // The activation overrides are DURABLE: recorded on the instance, so a
    // replay that rebuilds the runtime from this head sees the same calendar
    // spec and window geometry without the activation call (Y9).
    instance: { id: rt.spec.instance, anchor: rt.spec.anchor, activatedOn: rt.spec.activatedOn, ...(rt.overrides ? { overrides: rt.overrides } : {}), predecessor: null },
  }
  const inp: Inputs = { facts, today, earlierToday: 0, reads: newReads() }
  const slots = Object.keys(rt.def.slots)
  for (let pass = 0; pass <= slots.length; pass++) {
    const prev = head
    const state = Object.fromEntries(
      slots.map((slot) => {
        const s = schemeOf(rt, prev, slot)
        const cx = slotCtx(rt, prev, slot, inp, slotParams(rt, prev, slot, inp))
        return [slot, Object.fromEntries(Object.entries(s.state).map(([f, d]) => [f, unset(f, evaluate(d.init, cx).value, d.noun)]))]
      }),
    )
    head = { ...head, state }
    if (pass > 0 && canonicalJson(state) === canonicalJson(prev.state)) break
  }
  if (rt.def.aggregate) {
    const cx = programCtx(rt, head, inp)
    head = { ...head, state: { ...head.state, program: Object.fromEntries(Object.entries(rt.def.aggregate.state).map(([f, d]) => [f, unset(f, evaluate(d.init, cx).value, d.noun)])) } }
  }
  return head
}

// ── handlers and the outcome channel ────────────────────────────────────────

const declOf = (rt: Runtime, head: Head, scope: string, field: string): StateDecl | undefined =>
  scope === 'program' ? rt.def.aggregate?.state[field] : schemeOf(rt, head, scope).state[field]

function runHandler(rt: Runtime, head: Head, scope: string, on: SlotEventKind, src: EventSource, inp: Inputs, causeKey: string): Fired | null {
  const term = scope === 'program' ? rt.def.aggregate?.on[on as 'session'] : schemeOf(rt, head, scope).on[on]
  if (!term) return null
  const base = scope === 'program' ? programCtx(rt, head, inp) : slotCtx(rt, head, scope, inp)
  const trace = evaluate(term, { ...base, ports: { ...base.ports, event: eventPort(src) } })
  const v = trace.value
  if (v.v !== 'patch') throw new Error(`step: ${scope}.${on} did not yield a patch`)
  for (const f of Object.keys(v.fields)) {
    const d = declOf(rt, head, scope, f)
    if (!d || !(d.writableBy as string[]).includes(on)) throw new Error(`step: ${scope}.${f} is not writable by ${on} (L3; the checker refuses this statically)`)
  }
  const patch = Object.fromEntries(Object.entries(v.fields).map(([f, x]) => [f, { value: x.value, mode: x.mode as Fired['patch'][string]['mode'], demotedBy: [] as number[] }]))
  return { scope, on, causeKey, patch, reason: trace }
}

const nums = (v: Value | undefined): Map<string, number> => {
  if (!v) return new Map()
  if (v.v === 'q') return new Map([['', v.n]])
  if (v.v === 'map') return new Map(v.entries.flatMap(([k, x]) => (x.v === 'q' ? [[k, x.n] as [string, number]] : [])))
  return new Map()
}
/** Which way a field moved: per entry for a map. An increase or decrease is
 *  between two PRESENT numbers (F18): unset → value and value → absent (or a
 *  map entry appearing or disappearing) move neither way, though they are a
 *  change (`any`). */
export function moved(before: Value | undefined, after: Value): { up: boolean; down: boolean; any: boolean } {
  const [a, b] = [nums(before), nums(after)]
  let up = false
  let down = false
  for (const [k, x] of a) {
    const y = b.get(k)
    if (y === undefined) continue
    if (y > x + 1e-9) up = true
    if (y < x - 1e-9) down = true
  }
  return { up, down, any: up || down || !before || !sameValue(before, after) }
}

/** Outcome policies at the sink of a transition, their `when` read against
 *  the event's stamped snapshot (L12). */
function demote(rt: Runtime, head: Head, fired: Fired[], inp: Inputs): void {
  const cx = programCtx(rt, head, inp)
  let matched = false
  rt.def.policies.forEach((pol, i) => {
    if (!pol.outcome || (rt.def.hitPolicy === 'first' && matched)) return
    const w = evaluate(pol.when, cx).value
    if (!(w.v === 'bool' && w.b)) return
    matched = true
    for (const f of fired)
      for (const [field, p] of Object.entries(f.patch)) {
        if (p.mode !== 'commit' && p.mode !== 'propose') continue
        const d = declOf(rt, head, f.scope, field)
        if (!d || !pol.outcome.demote.kinds.includes(kindOf(d.ty))) continue
        const m = moved(head.state[f.scope]?.[field], p.value)
        if (pol.outcome.volumeKeep && kindOf(d.ty) === 'volume' && m.down) {
          f.patch[field] = { value: head.state[f.scope]?.[field] ?? p.value, mode: 'keep', demotedBy: [...p.demotedBy, i] }
          continue
        }
        const hit = pol.outcome.demote.direction === 'any' ? m.any : pol.outcome.demote.direction === 'increase' ? m.up : m.down
        if (hit && p.mode === 'commit') f.patch[field] = { ...p, mode: 'propose', demotedBy: [...p.demotedBy, i] }
      }
  })
}

/** Land a batch of fired handlers (one event's): commits into the state,
 *  proposals into the pending set (superseding older ones on their fields). */
function land(head: Head, fired: Fired[], emitted: string[]): Head {
  let state = head.state
  for (const f of fired)
    for (const [field, p] of Object.entries(f.patch)) if (p.mode === 'commit') state = { ...state, [f.scope]: { ...state[f.scope], [field]: p.value } }
  let pending = head.pending
  for (const f of fired) {
    const asks = Object.entries(f.patch).filter(([, p]) => p.mode === 'propose')
    if (!asks.length) continue
    for (const [k, old] of Object.entries(pending))
      if (old.scope === f.scope && asks.some(([field]) => field in old.fields)) {
        const { [k]: _gone, ...rest } = pending
        pending = rest
        emitted.push(`superseded:${k}`)
      }
    const key = `proposal:${f.causeKey}:${f.scope}`
    const fields = Object.fromEntries(asks.map(([field, p]) => [field, p.value]))
    const base = Object.fromEntries(asks.map(([field]) => [field, state[f.scope]?.[field] ?? none({ k: 'stateUnset', field })]))
    if (f.on === 'owner' || f.on === 'decision') throw new Error(`step: ${f.on} cannot propose`)
    const prop: Proposal = { key, scope: f.scope, on: f.on, fields, base, seq: head.seq + 1, causeKey: f.causeKey }
    pending = { ...pending, [key]: prop }
  }
  return { ...head, state, pending }
}

// ── the progress clock ──────────────────────────────────────────────────────

const boundarySource = (rt: Runtime, head: Head): EventSource => {
  // The declared judgment options (C1, C2) ride on the source only when a
  // program declares them, so a default source is byte-identical.
  const success = Object.fromEntries(Object.entries(rt.def.slots).flatMap(([k, b]) => (b.meta.success ? [[k, b.meta.success] as const] : [])))
  return {
    reg: rt.reg,
    slots: [],
    performed: {},
    facts: [],
    groupScores: {},
    week: head.progress.week,
    primary: (s) => Object.entries(rt.def.slots[s]?.meta.muscles ?? {}).find(([, c]) => c === 1)?.[0],
    ...(Object.keys(success).length ? { success } : {}),
    ...(rt.def.e1rm ? { e1rm: rt.def.e1rm } : {}),
  }
}

/** Close the current block week: weekEnd, then cycleEnd (a cycling
 *  calendar's last week) or blockEnd (a once calendar's last week). */
function closeWeek(rt: Runtime, head: Head, inp: Inputs, fired: Fired[], emitted: string[]): Head {
  const w = head.progress.week
  const inst = rt.spec.instance
  const boundary = (h: Head, on: SlotEventKind, causeKey: string, window: string[]): Head => {
    emitted.push(causeKey)
    const src = boundarySource(rt, h)
    const batch: Fired[] = []
    for (const slot of Object.keys(rt.def.slots)) {
      if (!schemeOf(rt, h, slot).on[on]) continue
      if (!window.includes(slot)) {
        batch.push({ scope: slot, on, causeKey, patch: {}, reason: null, skipped: 'untrained' })
        continue
      }
      const f = runHandler(rt, h, slot, on, src, inp, causeKey)
      if (f) batch.push(f)
    }
    if (rt.def.aggregate?.on[on as 'weekEnd']) {
      if (window.length) {
        const f = runHandler(rt, h, 'program', on, src, inp, causeKey)
        if (f) batch.push(f)
      } else batch.push({ scope: 'program', on, causeKey, patch: {}, reason: null, skipped: 'untrained' })
    }
    demote(rt, h, batch, inp)
    fired.push(...batch)
    return land(h, batch, emitted)
  }
  let h = boundary(head, 'weekEnd', `week:${inst}:${w}`, head.progress.weekSlots)
  const len = rt.def.calendar.weeks.length
  const cycleSlots = h.progress.cycleSlots
  h = { ...h, progress: { ...h.progress, week: w + 1, weekEntries: 0, weekSlots: [] } }
  if ((w + 1) % len === 0) {
    if (rt.def.calendar.repeat === 'cycle') {
      h = boundary(h, 'cycleEnd', `cycle:${inst}:${(w + 1) / len - 1}`, cycleSlots)
      h = { ...h, progress: { ...h.progress, cycleSlots: [] } }
    } else {
      h = boundary(h, 'blockEnd', `block:${inst}`, cycleSlots)
      h = { ...h, status: 'completed' }
    }
  }
  return h
}

/** An entry of the rotation closed (a session or an owner skip): under
 *  slide drift the week closes when every entry of it has. */
function entryClosed(rt: Runtime, head: Head, slots: string[], inp: Inputs, fired: Fired[], emitted: string[]): Head {
  const p = head.progress
  const add = (xs: string[]) => [...new Set([...xs, ...slots])]
  const slotSessions = { ...p.slotSessions }
  for (const s of slots) slotSessions[s] = (slotSessions[s] ?? 0) + 1
  const h: Head = { ...head, progress: { ...p, slotSessions, sessions: p.sessions + 1, weekEntries: p.weekEntries + 1, weekSlots: add(p.weekSlots), cycleSlots: add(p.cycleSlots) } }
  if (rt.def.calendar.drift === 'slide' && h.progress.weekEntries >= entriesPerWeek(rt.def.rotation)) return closeWeek(rt, h, inp, fired, emitted)
  return h
}

// ── step ────────────────────────────────────────────────────────────────────

const eventDays = (e: Event): string[] =>
  e.k === 'dayClosed' ? [e.day] : e.k === 'pause' ? [e.from, ...(e.until ? [e.until] : [])] : e.k === 'resume' || e.k === 'abandon' ? [e.on] : e.k === 'sessionClosed' ? [e.facts.localDay] : []

/** The head mirrors the calendar's pause (F16): `paused` while a pause covers
 *  the open day. Completed and abandoned are terminal and never change here. */
const withStatus = (h: Head): Head =>
  h.status === 'active' && h.calendar.status === 'paused' ? { ...h, status: 'paused' } : h.status === 'paused' && h.calendar.status !== 'paused' ? { ...h, status: 'active' } : h

const loggedCount = (l: Logged) => Object.values(l).reduce((a, s) => a + Object.values(s).reduce((b, x) => b + x.length, 0), 0)

export type StepResult = { k: 'applied'; head: Head; transition: Transition } | { k: 'refused'; refusal: IngestRefusal }

export function step(rt: Runtime, head: Head, e: Event): StepResult {
  const reads: Reads = newReads()
  const fired: Fired[] = []
  const emitted: string[] = []
  const done = (h: Head): StepResult => {
    const after = { ...h, seq: head.seq + 1 }
    return { k: 'applied', head: after, transition: { seq: after.seq, causeKey: e.causeKey, emitted, fired, factsRead: reads.facts, calReads: reads.cal, before: head.state, after: after.state } }
  }
  const refuse = (refusal: IngestRefusal): StepResult => ({ k: 'refused', refusal })
  if (head.status === 'abandoned' && e.k !== 'proposalDecided') return refuse({ code: 'instanceClosed', status: 'abandoned' })
  // The boundary's day law (P3): every day an event carries is a real date.
  for (const d of eventDays(e)) {
    const p = parseLocalDay(d)
    if (typeof p !== 'string') return refuse(p)
  }

  switch (e.k) {
    case 'sessionClosed': {
      const cf = e.facts
      if (loggedCount(cf.performed) === 0) return refuse({ code: 'emptySession', workoutId: cf.workoutId })
      if (head.status === 'completed') return refuse({ code: 'programComplete' })
      const inp: Inputs = { facts: snapshotSource(cf.facts), today: cf.localDay, earlierToday: cf.earlierToday, reads }
      const views = currentView(cf.issued, cf.resolutions)
      const src = (slots: typeof views): EventSource => ({ ...boundarySource(rt, head), slots, performed: cf.performed, facts: cf.facts, groupScores: cf.groupScores })
      // A slot with no logged set in this session was not trained (F15): its
      // handler records keep(untrained), and it does not advance (L11).
      const trained = (slot: string) => Object.values(cf.performed[slot] ?? {}).some((x) => x.length > 0)
      const batch: Fired[] = []
      for (const v of views) {
        if (!trained(v.slot)) {
          if (schemeOf(rt, head, v.slot).on.session) batch.push({ scope: v.slot, on: 'session', causeKey: e.causeKey, patch: {}, reason: null, skipped: 'untrained' })
          continue
        }
        const f = runHandler(rt, head, v.slot, 'session', src([v]), inp, e.causeKey)
        if (f) batch.push(f)
      }
      if (rt.def.aggregate?.on.session) {
        const f = runHandler(rt, head, 'program', 'session', src(views), inp, e.causeKey)
        if (f) batch.push(f)
      }
      demote(rt, head, batch, inp)
      fired.push(...batch)
      let h = land(head, batch, emitted)
      const slots = views.map((v) => v.slot).filter(trained)
      const totals: Record<string, { sum: number; max: number }> = {}
      for (const s of Object.values(cf.performed))
        for (const sets of Object.values(s))
          for (const x of sets)
            for (const [m, n] of Object.entries(x.values)) {
              if (typeof n !== 'number') continue
              const t = (totals[m] ??= { sum: 0, max: -Infinity })
              t.sum += n
              t.max = Math.max(t.max, n)
            }
      const occ = occurrenceOf({ workoutId: cf.workoutId, localDay: cf.localDay, day: cf.issued.day, slots, startedEarly: cf.startedEarly, loggedSets: loggedCount(cf.performed), totals }, rt.spec)
      if ('refused' in occ) return refuse({ code: 'emptySession', workoutId: cf.workoutId })
      h = { ...h, calendar: stepCalendar(rt.spec, h.calendar, { k: 'sessionClosed', causeKey: e.causeKey, occurrence: occ, adHoc: false }) }
      return done(entryClosed(rt, h, slots, inp, fired, emitted))
    }
    case 'skip': {
      if (head.status === 'completed') return refuse({ code: 'programComplete' })
      const inp: Inputs = { facts: noFacts, today: head.calendar.reconciledThrough, earlierToday: 0, reads }
      return done(entryClosed(rt, head, [], inp, fired, emitted))
    }
    case 'dayClosed': {
      // One per-day loop, so a batched catch-up is indistinguishable from
      // day-by-day delivery (L5, X2): each newly closed day in order closes
      // the day, fires THAT day's periodClosed handlers against its post-close
      // state, then runs the anchored week-close check against the same state.
      let h: Head = head
      for (let n = dayNum(head.calendar.reconciledThrough) + 1; n <= dayNum(e.day); n++) {
        const day = dayOf(n)
        const inp: Inputs = { facts: noFacts, today: addDays(day, 1), earlierToday: 0, reads }
        const before = h.calendar.adherence.length
        h = withStatus({ ...h, calendar: stepCalendar(rt.spec, h.calendar, { k: 'dayClosed', causeKey: `day:${rt.spec.instance}:${day}`, day }) })
        for (const a of h.calendar.adherence.slice(before)) {
          const causeKey = `period:${a.key.slice('adhere:'.length)}`
          emitted.push(causeKey)
          const src = boundarySource(rt, h)
          const batch = [...Object.keys(rt.def.slots).map((s) => runHandler(rt, h, s, 'periodClosed', src, inp, causeKey)), rt.def.aggregate?.on.periodClosed ? runHandler(rt, h, 'program', 'periodClosed', src, inp, causeKey) : null].filter((f): f is Fired => !!f)
          for (const f of batch) for (const p of Object.values(f.patch)) if (p.mode === 'commit') throw new Error('step: a periodClosed handler committed (L13; the checker refuses this)')
          fired.push(...batch)
          h = land(h, batch, emitted)
        }
        // Anchored drift (F10): the day `anchor + 7k + 6` (k ≥ 0) closes block
        // week k; a day before the anchor closes nothing.
        if (rt.def.calendar.drift === 'anchored') {
          const k = n - dayNum(rt.spec.anchor)
          if (k >= 0 && (k + 1) % 7 === 0 && h.status === 'active') h = closeWeek(rt, h, inp, fired, emitted)
        }
      }
      return done(h)
    }
    case 'pause':
      if (head.status === 'completed') return refuse({ code: 'programComplete' })
      return done(withStatus({ ...head, calendar: stepCalendar(rt.spec, head.calendar, e) }))
    case 'resume': {
      if (head.status === 'completed') return refuse({ code: 'programComplete' })
      const pauses = head.calendar.pauses.map((p) => (p.until === null ? { ...p, until: addDays(e.on, -1) } : p))
      const calendar = { ...head.calendar, pauses }
      return done(withStatus({ ...head, calendar: { ...calendar, status: pauseStatus(calendar, addDays(head.calendar.reconciledThrough, 1)) } }))
    }
    case 'abandon':
      if (head.status === 'completed') return refuse({ code: 'programComplete' })
      return done({ ...head, status: 'abandoned', calendar: { ...head.calendar, status: 'abandoned' } })
    case 'ownerEdit': {
      const patch: Fired['patch'] = {}
      for (const [field, lit] of Object.entries(e.patch)) {
        const d = declOf(rt, head, e.scope, field)
        if (!d || !d.writableBy.includes('owner') || (lit === null && d.ty.t !== 'opt')) return refuse({ code: 'notOwnerWritable', scope: e.scope, field })
        const value = lit === null ? none({ k: 'ownerCleared', field }) : evaluate({ k: 'lit', lit: lit as Lit }, { reg: rt.reg, params: {}, ports: {}, vars: new Map(), enums: {} }).value
        patch[field] = { value, mode: 'commit', demotedBy: [] }
      }
      const f: Fired = { scope: e.scope, on: 'owner', causeKey: e.causeKey, patch, reason: null }
      fired.push(f)
      return done(land(head, [f], emitted))
    }
    case 'proposalDecided': {
      const p = head.pending[e.proposalKey]
      if (!p) return done(head)
      const { [e.proposalKey]: _decided, ...pending } = head.pending
      const unwritable = Object.keys(p.fields).some((f) => {
        const by: readonly string[] = declOf(rt, head, p.scope, f)?.writableBy ?? []
        return !by.includes(p.on) && !by.includes('owner')
      })
      const stale = Object.keys(p.fields).some((f) => !sameValue(head.state[p.scope]?.[f] ?? none({ k: 'stateUnset', field: f }), p.base[f]!))
      const mode = !e.accepted ? 'keep' : unwritable || stale ? 'void' : 'commit'
      const f: Fired = { scope: p.scope, on: 'decision', causeKey: e.causeKey, patch: Object.fromEntries(Object.entries(p.fields).map(([k, v]) => [k, { value: v, mode, demotedBy: [] }])), reason: null }
      fired.push(f)
      if (e.accepted && unwritable) emitted.push(`unwritable:${p.key}`)
      else if (e.accepted && stale) emitted.push(`stale:${p.key}`)
      return done(land({ ...head, pending }, [f], emitted))
    }
    case 'rebind': {
      const old = schemeOf(rt, head, e.slot)
      const next = rt.reg.schemes.get(keyOf(e.to))
      if (!next) throw new Error(`step: rebind to unpublished ${keyOf(e.to)}`)
      const fields = [...new Set([...Object.keys(old.state), ...Object.keys(next.state)])].filter((f) => JSON.stringify(old.state[f]?.ty) !== JSON.stringify(next.state[f]?.ty))
      if (fields.length) return refuse({ code: 'rebindNeedsMigration', slot: e.slot, fields })
      return done({ ...head, bindings: { ...head.bindings, [e.slot]: { scheme: e.to, args: e.args } } })
    }
  }
}

// ── the ledger ──────────────────────────────────────────────────────────────

/** The ledger: a set of applied causeKeys, the events in INGESTION order,
 *  their transitions, and the head they fold to (L5). */
export interface Ledger {
  head: Head
  keys: ReadonlySet<string>
  events: readonly Event[]
  transitions: readonly Transition[]
}
export const ledgerOf = (head: Head): Ledger => ({ head, keys: new Set(), events: [], transitions: [] })

export function ingest(rt: Runtime, l: Ledger, e: Event): { ledger: Ledger; result: IngestResult } {
  if (l.keys.has(e.causeKey)) return { ledger: l, result: { k: 'already', seq: l.transitions.find((t) => t.causeKey === e.causeKey)?.seq ?? l.head.seq } }
  const r = step(rt, l.head, e)
  if (r.k === 'refused') return { ledger: l, result: { k: 'refused', refusal: r.refusal } }
  return { ledger: { head: r.head, keys: new Set([...l.keys, e.causeKey]), events: [...l.events, e], transitions: [...l.transitions, r.transition] }, result: { k: 'applied', head: r.head, transition: r.transition } }
}

/** State = fold of the ledger in ingestion order. */
export function replay(rt: Runtime, initial: Head, events: readonly Event[]): Ledger {
  return events.reduce((l, e) => ingest(rt, l, e).ledger, ledgerOf(initial))
}

/** Reconcile through `today` (dayClosed events, each its own ledger entry),
 *  then issue on the reconciled head. The day is the shell's proposal. */
export function prescribe(rt: Runtime, l: Ledger, day: string, facts: FactSource, today: LocalDay): { ledger: Ledger; issued: IssuedSession | IngestRefusal } {
  let ledger = l
  for (const e of reconcile(rt.spec, l.head.calendar, today)) ledger = ingest(rt, ledger, e).ledger
  const earlierToday = ledger.head.calendar.occurrences.filter((o) => o.localDay === today).length
  return { ledger, issued: issueSession(rt, ledger.head, day, { facts, today, earlierToday, reads: newReads() }) }
}

// ── exports ─────────────────────────────────────────────────────────────────

/** The typed exports a run publishes for its successor: declared slot state
 *  plus the lifecycle exports every instance has. */
export function exportsOf(rt: Runtime, head: Head): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (const [name, x] of Object.entries(rt.def.exports)) out[name] = head.state[x.slot]?.[x.field] ?? none({ k: 'stateUnset', field: `${x.slot}.${x.field}` })
  const st = head.calendar
  out['completedFraction'] = qv(completedFraction(st), {}, 'pct')
  out['missedTotal'] = qv(st.adherence.reduce((a, x) => a + derivedAdherence(st, x.key).missed, 0), {}, 'x')
  out['finalWeek'] = qv(head.progress.week, DIMS.weeks, 'wk', { clock: 'progress' })
  out['status'] = { v: 'enum', name: 'instanceStatus', tag: head.status }
  return out
}

export { roleOf }
export type { Term }
