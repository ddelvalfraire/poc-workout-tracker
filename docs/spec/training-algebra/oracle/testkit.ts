/**
 * testkit.ts — the plain-tsx test harness (no framework) and the builders the
 * law and conformance suites share. Every test names the test-plan rows it
 * covers, so the disposition (dispose.ts) is generated from what RAN.
 */
import type { Term } from './algebra'
import { publish } from './checkdefs'
import type { Registry } from './checker'
import type { ClosedFacts, Event, FactReading, FactSource, IssuedSession, IssuedStep, IssuedTarget, Logged, PerformedSet, Resolution, Value } from './engine'
import { asPrescribedSet, ctxOf, evaluate, qv } from './evaluate'
import * as ER from './endurance-rehab'
import { resolveLive } from './issue'
import { nextDay, noFacts, runtimeOf, type Runtime } from './ports'
import * as P from './programs'
import { activate, ingest, ledgerOf, prescribe, type Ledger } from './step'
import type { ProgramDef } from './structure'
import { localDay, type LocalDay } from './time'
import { canon, litDim, type Unit } from './units'

// ── the harness ─────────────────────────────────────────────────────────────

/** The one Node global the suites touch (the package builds with no @types). */
declare const process: { env: Record<string, string | undefined>; exitCode?: number }

export interface Result {
  suite: string
  ids: string[]
  name: string
  ok: boolean
  error?: string
}
export const RESULTS: Result[] = []
const quiet = process.env['QUIET'] === '1'

export function suite(name: string) {
  const t = (ids: string, title: string, fn: () => void) => {
    try {
      fn()
      RESULTS.push({ suite: name, ids: ids.split(/\s+/).filter(Boolean), name: title, ok: true })
      if (!quiet) console.log(`  ok    ${title}`)
    } catch (e) {
      const msg = (e as Error).message
      RESULTS.push({ suite: name, ids: ids.split(/\s+/).filter(Boolean), name: title, ok: false, error: msg })
      console.log(`  FAIL  ${title}\n        ${msg.split('\n').join('\n        ')}`)
    }
  }
  const done = () => {
    const mine = RESULTS.filter((r) => r.suite === name)
    const failed = mine.filter((r) => !r.ok).length
    if (!quiet || failed) console.log(`${name}: ${mine.length - failed} passed, ${failed} failed`)
    if (failed) process.exitCode = 1
    return { passed: mine.length - failed, failed }
  }
  return { t, done }
}

export function assert(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg)
}
export function eq<T>(got: T, want: T, msg: string) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g !== w) throw new Error(`${msg}: got ${g}, want ${w}`)
}
export const near = (got: number, want: number, msg: string, tol = 1e-6) => assert(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${msg}: got ${got}, want ${want}`)

// ── the corpus ──────────────────────────────────────────────────────────────

export const reg: Registry = publish([...P.PUBLISHED, ...ER.PUBLISHED])
export const D0 = localDay('2026-10-05') // a Monday
export const day = (s: string) => localDay(s)

export const q = (n: number, unit: Unit): Value => qv(canon(n, unit), litDim(unit), unit)
export const num = (v: Value): number => {
  if (v.v !== 'q') throw new Error(`expected a quantity, got ${JSON.stringify(v)}`)
  return v.n
}
export const ev = (t: Term | { term: Term }, over: Parameters<typeof ctxOf>[1] = {}): Value => evaluate('term' in t ? t.term : t, ctxOf(reg, over)).value

/** A fact source from a record: fact → value, or fact → (key → value). */
export function factsOf(m: Record<string, Value | Record<string, Value>>, on: LocalDay = D0): FactSource {
  return {
    get: (fact, key) => {
      const x = m[fact]
      if (!x) return null
      const v = 'v' in x ? (x as Value) : key !== null ? (x as Record<string, Value>)[key] : undefined
      return v ? { fact, key, value: v, observedOn: on } : null
    },
  }
}
export const readings = (m: Record<string, Value>, on: LocalDay = D0): FactReading[] => Object.entries(m).map(([fact, value]) => ({ fact, key: null, value, observedOn: on }))

export const E1RM: Record<string, Value> = Object.fromEntries(
  Object.entries({ 'wger:111': 140, 'wger:192': 100, 'wger:105': 180, 'wger:119': 60, 'wger:97': 70, 'wger:314': 60, 'wger:122': 30, 'wger:212': 90, 'wger:158': 80, 'wger:507': 140, 'wger:hip-thrust': 160 }).map(([k, n]) => [k, q(n, 'kg')]),
)
export const corpusFacts = (on: LocalDay = D0) => factsOf({ e1rm: E1RM, lthr: q(170, 'bpm') }, on)

export interface Run {
  rt: Runtime
  ledger: Ledger
}
export function start(def: ProgramDef, params: Record<string, Value> = {}, facts: FactSource = noFacts, id: string = def.ref.id, on: LocalDay = D0, r: Registry = reg): Run {
  const rt = runtimeOf(r, def, { id, anchor: on, activatedOn: on })
  return { rt, ledger: ledgerOf(activate(rt, params, facts)) }
}
export function issue(run: Run, today: LocalDay, facts: FactSource = noFacts, dayName?: string): { run: Run; issued: IssuedSession } {
  const d = dayName ?? nextDayOf(run)
  const r = prescribe(run.rt, run.ledger, d, facts, today)
  if ('code' in r.issued) throw new Error(`prescribe refused: ${r.issued.code}`)
  return { run: { ...run, ledger: r.ledger }, issued: r.issued }
}
export const nextDayOf = (run: Run) => nextDay(run.rt.def.rotation, run.ledger.head.progress.sessions, run.ledger.head.progress.weekEntries)

/** Logged sets for an issued session: `f` decides each set (null: unlogged). */
export function logWith(issued: IssuedSession, f: (slot: string, st: IssuedStep, i: number, t: IssuedTarget) => PerformedSet | null): Logged {
  const out: Logged = {}
  for (const sl of issued.slots) {
    out[sl.slot] = {}
    for (const st of sl.steps) {
      const n = st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.min : st.count.planned
      const sets: PerformedSet[] = []
      for (let i = 0; i < n && i < st.sets.length; i++) {
        const s = f(sl.slot, st, i, st.sets[i]!)
        if (s) sets.push(s)
      }
      out[sl.slot]![st.key] = sets
    }
  }
  return out
}
export const asPrescribed = (issued: IssuedSession) => logWith(issued, (_s, _st, _i, t) => asPrescribedSet(t))
export const repsShort = (issued: IssuedSession, by = 1) =>
  logWith(issued, (_s, _st, _i, t) => {
    const p = asPrescribedSet(t)
    return 'reps' in p.values ? { ...p, values: { ...p.values, reps: Math.max(0, p.values['reps']! - by) } } : p
  })

/** Live logging of one issued session, as the logger does it: each log of
 *  the sets so far resolves against EVERY row resolved before it, so a
 *  supersession, a revert and an intra-pass dependency are what the suites
 *  see (H1). `rows` is the issue's resolution log so far. */
export function liveLog(issued: IssuedSession, r: Pick<Runtime, 'reg'> = { reg }) {
  let rows: Resolution[] = []
  return {
    log(logged: Logged): Resolution[] {
      const add = resolveLive(r, issued, logged, rows)
      rows = [...rows, ...add]
      return add
    },
    rows: () => rows,
  }
}

let wid = 0
/** A sessionClosed for an issued session. `resolutions` is the live log so
 *  far (liveLog); the close resolves the final logged sets against it. */
export function closeOf(issued: IssuedSession, logged: Logged, today: LocalDay, facts: FactReading[] = [], workoutId = `w${++wid}`, resolutions: readonly Resolution[] = []): Event {
  const all = [...resolutions, ...resolveLive({ reg }, issued, logged, resolutions)]
  const cf: ClosedFacts = { workoutId, issued, resolutions: all, performed: logged, facts: [...issued.stamp.factsRead, ...facts], groupScores: {}, localDay: today, earlierToday: 0, startedEarly: false }
  return { k: 'sessionClosed', causeKey: `session:${workoutId}`, facts: cf }
}
export function close(run: Run, issued: IssuedSession, logged: Logged, today: LocalDay, facts: FactReading[] = []) {
  const r = ingest(run.rt, run.ledger, closeOf(issued, logged, today, facts))
  return { run: { ...run, ledger: r.ledger }, result: r.result }
}
/** Train n sessions, one every `every` days from `from`, each logged by `how`. */
export function train(run: Run, n: number, from: LocalDay, how: (i: IssuedSession) => Logged = asPrescribed, facts: FactSource = noFacts, every = 2, post: FactReading[] = []): { run: Run; issued: IssuedSession[] } {
  const out: IssuedSession[] = []
  let r = run
  for (let k = 0; k < n; k++) {
    const today = localDay(new Date(Date.parse(`${from}T00:00:00Z`) + k * every * 86_400_000).toISOString().slice(0, 10))
    const x = issue(r, today, facts)
    out.push(x.issued)
    r = close(x.run, x.issued, how(x.issued), today, post).run
  }
  return { run: r, issued: out }
}
export const stateOf = (run: Run, scope: string, field: string): Value => run.ledger.head.state[scope]?.[field] ?? { v: 'none', cause: { k: 'declaredNone' } }
export const loadOf = (issued: IssuedSession, slot: string, step = 0, set = 0): number | null => {
  const f = issued.slots.find((s) => s.slot === slot)?.steps[step]?.sets[set]?.metrics['load']
  return f?.k === 'fixed' && f.v.b === 'exact' ? f.v.v : null
}
export const fieldOf = (issued: IssuedSession, slot: string, metric: string, step = 0, set = 0) => issued.slots.find((s) => s.slot === slot)?.steps[step]?.sets[set]?.metrics[metric]
