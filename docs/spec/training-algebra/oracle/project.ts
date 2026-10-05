/**
 * project.ts — projection (L9) and the scheme examples it runs.
 *
 * A projection prescribes, synthesizes what was logged under an assumption,
 * and steps, on a COPY of the ledger: it never writes (the input ledger is
 * returned untouched; a property test checks it). Every projected week is
 * tagged `projected` and the assumption that produced it.
 *
 * Assumptions (R2 decisions):
 *  - asPrescribed: every set logged at the floor of its bound (an AMRAP at its
 *    minimum, a range at its bottom, a zone at its bottom); facts neutral.
 *  - allMiss: every judged set falls short: one rep short where reps are
 *    targeted, otherwise 10% short of the bar; loads logged as prescribed.
 *  - repeatLast: each step repeats the last logged values for its slot; with
 *    no history it falls back to asPrescribed and SAYS so (EC-192).
 *  - asScheduled: asPrescribed values, sessions laid on nominal rotation days.
 *  - script: the scripted (week, day) outcomes; an unscripted session is
 *    asPrescribed (EC-193).
 * A session the synthesis cannot log anything for (every field silent) is
 * recorded as an owner skip, never as a phantom session (D3).
 */
import type { Term } from './algebra'
import { keyOf, type Registry } from './checker'
import type { Assume, ClosedFacts, FactReading, FactSource, Field, Head, IssuedSession, IssuedStep, IssuedTarget, Logged, PerformedSet, Projection, Resolution, Transition, Value } from './engine'
import { asPrescribedSet, ctxOf, evaluate, none, sameValue } from './evaluate'
import { currentView, resolveLive, setsDue } from './issue'
import { calPort, entriesPerWeek, factPort, newReads, nextDay, roleOf, runtimeOf, type Runtime } from './ports'
import { activate, ingest, ledgerOf, prescribe, type Ledger } from './step'
import { reconcile } from './time'
import type { MacroDef, ProgramDef, SchemeDef, SchemeExample } from './structure'
import { addDays, localDay, type LocalDay } from './time'
import { isJudged } from './xform'

const shortBy = (rt: Runtime, t: IssuedTarget, set: PerformedSet): PerformedSet => {
  if (!isJudged(t)) return set
  const values = { ...set.values }
  if ('reps' in values) values['reps'] = Math.max(0, values['reps']! - 1)
  else
    for (const m of Object.keys(values)) {
      if (m === 'load' || m === 'effort') continue
      const higher = (rt.reg.vocab.metrics[m]?.better ?? 'higher') === 'higher'
      values[m] = values[m]! * (higher ? 0.9 : 1.1)
    }
  return { ...set, values }
}

/** What would be logged for one issued session, set by set, resolving open
 *  fields from the sets synthesized before them and running until/while
 *  steps against their own conditions. */
export function synthesize(rt: Runtime, issued: IssuedSession, how: 'hit' | 'miss' | 'repeat', last: Logged, amrapReps?: number): { logged: Logged; resolutions: Resolution[] } {
  const logged: Logged = {}
  let resolutions: Resolution[] = []
  for (const sl of issued.slots) {
    const mine: Record<string, PerformedSet[]> = (logged[sl.slot] = {})
    for (const st of sl.steps) {
      mine[st.key] = []
      const target = (i: number): IssuedTarget => {
        resolutions = [...resolutions, ...resolveLive(rt, issued, logged, resolutions)]
        return currentView(issued, resolutions).find((v) => v.slot === sl.slot)!.steps.find((x) => x.key === st.key)!.sets[i]!
      }
      const due = (): number => {
        const view = currentView(issued, resolutions).find((v) => v.slot === sl.slot)!
        return st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.min : setsDue(rt, view, view.steps.find((x) => x.key === st.key)!, mine, issued.stamp)
      }
      for (let i = 0; i < st.sets.length && i < due(); i++) {
        const t = target(i)
        const prev = last[sl.slot]?.[st.key]?.[i]
        let set = how === 'repeat' && prev ? prev : asPrescribedSet(t)
        if (how === 'miss') set = shortBy(rt, t, set)
        if (amrapReps !== undefined && t.role === 'amrap') set = { ...set, values: { ...set.values, reps: amrapReps } }
        mine[st.key]!.push(set)
      }
    }
  }
  resolutions = [...resolutions, ...resolveLive(rt, issued, logged, resolutions)]
  return { logged, resolutions }
}

const loggedSets = (l: Logged) => Object.values(l).reduce((a, s) => a + Object.values(s).reduce((b, x) => b + x.length, 0), 0)

/** The nominal day of the j-th projected session: entries spread evenly over
 *  the week from the projection's first day. */
const nominal = (rt: Runtime, start: LocalDay, j: number) => addDays(start, Math.floor((j * 7) / entriesPerWeek(rt.def.rotation)))

/** L9 in the types (F23): a projected value carries the assumption that
 *  produced it, so it cannot be mistaken for an issued fact or the live ledger. */
export type Projected<T> = T & { readonly projected: true; readonly assume: Assume['k'] }
const tag = <T extends object>(x: T, assume: Assume): Projected<T> => ({ ...x, projected: true, assume: assume.k })

export function project(rt: Runtime, l: Ledger, untilWeek: number, assume: Assume, facts: FactSource, start: LocalDay, maxSessions = 400, sessionFacts: readonly FactReading[] = []): Omit<Projection, 'weeks'> & { weeks: (Omit<Projection['weeks'][number], 'sessions'> & { sessions: Projected<IssuedSession>[] })[]; ledger: Projected<Ledger> } {
  let ledger = l
  const weeks = new Map<number, Projection['weeks'][number]>()
  const changes: Transition[] = []
  const fallbacks: string[] = []
  let last: Logged = {}
  for (let j = 0; j < maxSessions && ledger.head.status === 'active' && ledger.head.progress.week < untilWeek; j++) {
    const day0 = nominal(rt, start, j)
    // Reconcile first, as prescribe does, and re-check the bounds: under
    // anchored drift the calendar alone can close the last week asked for
    // (F10), and then nothing more is issued.
    for (const e of reconcile(rt.spec, ledger.head.calendar, day0)) ledger = ingest(rt, ledger, e).ledger
    if (ledger.head.status !== 'active' || ledger.head.progress.week >= untilWeek) break
    const day = nextDay(rt.def.rotation, ledger.head.progress.sessions, ledger.head.progress.weekEntries)
    const today = day0
    const r = prescribe(rt, ledger, day, facts, today)
    ledger = r.ledger
    if ('code' in r.issued) break
    const issued = r.issued
    const week = issued.stamp.position.week
    const scripted = assume.k === 'script' ? assume.outcomes.find((o) => o.week === week && o.day === day) : undefined
    const how = assume.k === 'allMiss' || (scripted && !scripted.hit) ? 'miss' : assume.k === 'repeatLast' ? 'repeat' : 'hit'
    if (how === 'repeat' && !Object.keys(last).length) fallbacks.push(`week ${week} ${day}: no earlier session to repeat, so asPrescribed`)
    const { logged, resolutions } = synthesize(rt, issued, how, last, scripted?.amrapReps)
    const w = weeks.get(week) ?? { week, role: issued.stamp.position.role, sessions: [], endsOn: null, projected: true as const }
    w.sessions.push(issued)
    w.endsOn = today
    weeks.set(week, w)
    const before = ledger.transitions.length
    if (!loggedSets(logged)) {
      ledger = ingest(rt, ledger, { k: 'skip', causeKey: `skip:proj:${rt.spec.instance}:${ledger.head.progress.sessions}`, slot: issued.slots[0]?.slot ?? '' }).ledger
      fallbacks.push(`week ${week} ${day}: nothing could be logged (every field silent), recorded as a skip`)
    } else {
      const id = `proj:${rt.spec.instance}:${ledger.head.progress.sessions}`
      const cf: ClosedFacts = { workoutId: id, issued, resolutions, performed: logged, facts: [...issued.stamp.factsRead, ...sessionFacts], groupScores: {}, localDay: today, earlierToday: 0, startedEarly: false }
      ledger = ingest(rt, ledger, { k: 'sessionClosed', causeKey: `session:${id}`, facts: cf }).ledger
      for (const [s, steps] of Object.entries(logged)) last = { ...last, [s]: steps }
    }
    changes.push(...ledger.transitions.slice(before).filter((t) => t.fired.length))
  }
  return { assume, weeks: [...weeks.values()].map((w) => ({ ...w, sessions: w.sessions.map((x) => tag(x, assume)) })), changes, fallbacks, ledger: tag(ledger, assume) }
}

// ── macros: phases in sequence, each seeded only by its handoff ──────────────

export interface PhaseRun {
  label: string
  program: string
  weeks: number
  startsOn: LocalDay
  /** How the phase ended: its once calendar ran out, its gate held, it hit
   *  its max (advancing, or asking the owner), or it is open and still going. */
  ended: 'completed' | 'criteria' | 'max' | 'askedAtMax' | 'open'
  /** The values this phase was seeded with, evaluated from the previous
   *  phase's PROJECTED terminal state. */
  handoff: Projected<{ values: Record<string, Value> }>
  final: Projected<Ledger>
  projection: Projection['weeks']
}

/** Run a macro forward. Each phase is a NEW instance: its state starts from
 *  its own init, its params from the handoff (which reads only the previous
 *  phase's terminal state, EC-238); a bounded phase checks its gate at each
 *  week end from `min` weeks, and at `max` advances or asks (`atMax`). */
export function projectMacro(reg: Registry, m: MacroDef, assume: Assume, facts: FactSource, totalWeeks: number, sessionFacts: readonly FactReading[] = []): PhaseRun[] {
  const runs: PhaseRun[] = []
  // peakOn lays the calendar out BACKWARDS from the date: every phase is
  // fixed (checked), so the start is the date less the phases' weeks (EC-232).
  const fixedWeeks = m.phases.reduce((a, ph) => a + (reg.programs.get(keyOf(ph.program))?.calendar.weeks.length ?? 0), 0)
  let start = m.anchor.k === 'peakOn' ? addDays(m.anchor.date, -7 * fixedWeeks) : m.anchor.date
  let prev: Head['state'] | null = null
  let weeks = 0
  for (const [i, ph] of m.phases.entries()) {
    const prog = reg.programs.get(keyOf(ph.program))
    if (!prog || weeks >= totalWeeks) break
    const handoff = ctxOf(reg, { ports: { peer: (slot, field, of) => (of === 'prevPhase' ? (prev?.[slot]?.[field] ?? none({ k: 'stateUnset', field: `${slot}.${field}` })) : none({ k: 'stateUnset', field })) } })
    const params = Object.fromEntries(Object.entries(ph.args).map(([k, t]) => [k, evaluate(t, handoff).value]))
    const rt0 = runtimeOf(reg, prog, { id: `${m.ref.id}#${i}`, anchor: start, activatedOn: start }, { label: ph.label, transform: ph.transform })
    if ('code' in rt0) throw new Error(`project: refused ${JSON.stringify(rt0)} (no overrides were given)`)
    const rt = rt0
    let ledger = ledgerOf(activate(rt, params, facts))
    const L = ph.length
    const cap = L.k === 'fixed' ? prog.calendar.weeks.length : L.k === 'bounded' ? L.max : totalWeeks - weeks
    let ended: PhaseRun['ended'] = L.k === 'open' ? 'open' : 'max'
    const projected: Projection['weeks'] = []
    for (let w = 0; w < cap && weeks + w < totalWeeks; w++) {
      const p = project(rt, ledger, ledger.head.progress.week + 1, assume, facts, addDays(start, 7 * w), 400, sessionFacts)
      ledger = p.ledger
      projected.push(...p.weeks)
      if (ledger.head.status === 'completed') {
        ended = 'completed'
        break
      }
      if (L.k === 'bounded' && w + 1 >= L.min) {
        const gate = ctxOf(reg, {
          ports: {
            peer: (slot, field, of) => (of === 'current' ? (ledger.head.state[slot]?.[field] ?? none({ k: 'stateUnset', field })) : none({ k: 'stateUnset', field })),
            fact: factPort(reg, facts, addDays(start, 7 * (w + 1)), newReads()),
            cal: calPort(rt.spec, ledger.head.calendar, addDays(start, 7 * (w + 1)), 0, newReads()),
          },
        })
        const v = evaluate(L.advanceWhen, gate).value
        if (v.v === 'bool' && v.b) {
          ended = 'criteria'
          break
        }
        if (w + 1 === L.max) ended = L.atMax === 'advance' ? 'max' : 'askedAtMax'
      }
    }
    const ran = projected.length
    runs.push({ label: ph.label, program: prog.ref.id, weeks: ran, startsOn: start, ended, handoff: tag({ values: params }, assume), final: tag(ledger, assume), projection: projected })
    weeks += ran
    start = addDays(start, 7 * ran)
    prev = ledger.head.state
    if (ended === 'askedAtMax' || ended === 'open') break
  }
  return runs
}

// ── scheme examples: a scheme run alone, as a one-slot program ───────────────

const EXAMPLE_DAY = localDay('2026-01-05')
export const exampleProgram = (s: SchemeDef, args: Record<string, Term>): ProgramDef => ({
  kind: 'program',
  ref: { id: `example/${s.ref.id}` as never, version: s.ref.version },
  says: '',
  params: {},
  facts: s.facts,
  enums: {},
  calendar: { weeks: ['train'], repeat: 'cycle', drift: 'slide' },
  grids: {},
  muscles: ['m'],
  slots: { x: { scheme: s.ref, args, meta: { muscles: { m: 1 } } } },
  days: { A: [{ k: 'single', slot: 'x' }] },
  rotation: { k: 'weekly', days: ['A'] },
  frequency: [],
  lapseAfterDays: 21,
  hitPolicy: 'allInOrder',
  policies: [],
  aggregate: null,
  exports: {},
  imports: {},
})

/** Project a scheme forward `afterSessions` sessions under its example's
 *  assumption and compare the state it reaches with the expected values. */
export function runSchemeExample(reg: Registry, s: SchemeDef, ex: SchemeExample): { ok: boolean; got: Record<string, Value>; want: Record<string, Value> } {
  const cx = ctxOf(reg)
  const readings: FactReading[] = Object.entries(ex.facts).map(([fact, t]) => ({ fact, key: null, value: evaluate(t, cx).value, observedOn: EXAMPLE_DAY }))
  const facts: FactSource = { get: (fact) => readings.find((r) => r.fact === fact) ?? null }
  const withS: Registry = { ...reg, schemes: new Map([...reg.schemes, [keyOf(s.ref), s]]) }
  const rt0 = runtimeOf(withS, exampleProgram(s, ex.args), { id: 'example', anchor: EXAMPLE_DAY, activatedOn: EXAMPLE_DAY })
  if ('code' in rt0) throw new Error(`runSchemeExample: refused ${JSON.stringify(rt0)} (no overrides were given)`)
  const rt = rt0
  const head = activate(rt, {}, facts)
  const p = project(rt, ledgerOf(head), Infinity, ex.assume === 'allMiss' ? { k: 'allMiss' } : { k: 'asPrescribed' }, facts, EXAMPLE_DAY, ex.afterSessions)
  const got = p.ledger.head.state['x'] ?? {}
  const want = Object.fromEntries(Object.entries(ex.expect).map(([f, t]) => [f, evaluate(t, cx).value]))
  return { ok: Object.entries(want).every(([f, v]) => got[f] !== undefined && sameValue(got[f]!, v)), got, want }
}

export { roleOf }
export type { Field, IssuedStep }
