/**
 * time.ts — the calendar clock: declarations, and a RUNNING slice of the
 * reconciliation that turns them into facts.
 *
 * Two clocks, never mixed. The PROGRESS clock (pos.week, pos.trainWeek,
 * pos.role, pos.slotSession) counts training that happened and drives what a
 * session contains. The CALENDAR clock counts local days since the instance's
 * anchor and drives expectations, adherence, spacing, gaps and windows. The
 * wall clock never enters the language: the boundary stamps a LocalDay once
 * and every calendar read evaluates against a stamped day (L12).
 *
 * "Missed" is a FACT, not a derivation: an expectation issued when its window
 * opened, closed unmet by a dayClosed event. Matching is by stamped day and
 * selector; a workout is never moved, relabelled or counted twice.
 */
import type { Term } from './algebra'
import type { MetricId } from './registry'
import type { ProgramDef } from './structure'

// ═══════════════════════════════════════════════════════════════════════════
// §1 Days
// ═══════════════════════════════════════════════════════════════════════════

/** A calendar day in the athlete's zone, 'YYYY-MM-DD'. Stamped by the client
 *  at the boundary (session START for a session); the server never computes
 *  it. The boundary refuses a stamp more than one day from the instant's UTC
 *  date, because UTC offsets span −12 to +14 hours. */
export type LocalDay = string & { readonly __localDay: true }
const DAY_MS = 86_400_000
/** The boundary's parse of a day stamp: a real proleptic-Gregorian date
 *  written YYYY-MM-DD (P3). 2026-02-30 is not normalized to 2 March; it is
 *  refused. */
export function parseLocalDay(s: string): LocalDay | { code: 'notALocalDay'; stamped: string } {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s) return { code: 'notALocalDay', stamped: s }
  return s as LocalDay
}
export function localDay(s: string): LocalDay {
  const d = parseLocalDay(s)
  if (typeof d !== 'string') throw new Error(`not a local day: ${s} (notALocalDay)`)
  return d
}
export const dayNum = (d: LocalDay) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
export const dayOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10) as LocalDay
export const addDays = (d: LocalDay, n: number) => dayOf(dayNum(d) + n)
export const weekday = (d: LocalDay) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(dayNum(d) * DAY_MS).getUTCDay()]!
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const dayText = (d: LocalDay) => `${weekday(d)} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`

// ═══════════════════════════════════════════════════════════════════════════
// §2 Selectors and the one calendar former
// ═══════════════════════════════════════════════════════════════════════════

/** Which occurrences a calendar read or a frequency counts. Static: slots,
 *  days, muscles and tags are declared, so feasibility is provable and the
 *  prose is unconditional. */
export type Selector =
  | { s: 'any' } //                                       "workout"
  | { s: 'slot'; slot: string } //                         "squat session"
  | { s: 'day'; day: string } //                           "Day A"
  | { s: 'muscle'; muscles: [string, ...string[]] } //     "legs (quads, hamstrings or glutes as the primary muscle)"
  | { s: 'tag'; tag: string } //                           "hard run"

/** The count, sum or max a bounded window reads. Sums and maxima range over
 *  registry metrics, so a window reads the same vocabulary a set targets. */
export type Measure = { m: 'count' } | { m: 'sum' | 'max'; metric: MetricId }

/** `cal`, the only calendar term former. `recent.days` is a LITERAL from 1 to
 *  MAX_WINDOW_DAYS, which keeps every window finite, loadable and stampable. */
export type CalQuery =
  | { q: 'day' } //                                         q[days]   days since the program's start day (0 on it)
  | { q: 'earlierToday' } //                                q[one]    sessions of this program already done today (0 for the first)
  | { q: 'gap'; of: Selector } //                           opt q[days] days since your last {sel}
  | { q: 'recent'; of: Selector; days: number; measure: Measure }
export const MAX_WINDOW_DAYS = 56
export const MAX_PERIOD_DAYS = 28

// ═══════════════════════════════════════════════════════════════════════════
// §3 Declarations: rotation, frequency, drift, lifecycle
// ═══════════════════════════════════════════════════════════════════════════

export type DayOrRest = string | { rest: true }
export type Rotation =
  | { k: 'weekly'; days: string[] } //                       each listed day once per week, in order
  | { k: 'alternate'; days: string[]; perWeek: number } //   A/B/A, B/A/B …
  | { k: 'pattern'; days: [DayOrRest, ...DayOrRest[]] } //   a fixed day cycle with rest entries
  | { k: 'daily'; days: string[]; perDay: number } //        the same day, n times every day

/** Tumbling windows anchored at the instance's start day. */
export type Period = { k: 'day' } | { k: 'week' } | { k: 'days'; n: number }
export const periodDays = (p: Period) => (p.k === 'day' ? 1 : p.k === 'week' ? 7 : p.n)

/** One declaration sort, three consumers: checker feasibility, the due
 *  verdict at prescribe, and adherence at window close. Rolling `atLeast` is
 *  not a form: one missed session would violate up to n overlapping windows,
 *  so "missed" would stop being a countable fact. */
export type Frequency =
  | { k: 'atLeast'; n: number; of: Selector; per: Period }
  | { k: 'atMost'; n: number; of: Selector; withinDays: number }
  /** `gap` is a TERM of sort q[days] at the cadence position (CadenceCap), so
   *  state can drive spacing (Mentzer); `ceiling` is a literal clamp, so a
   *  runaway state can never make a program that is never due. */
  | { k: 'minGap'; of: Selector; gap: Term; ceiling: number }

export type Drift = 'slide' | 'anchored'
export type InstanceStatus = 'active' | 'paused' | 'lapsed' | 'completed' | 'abandoned'
export const DEFAULT_LAPSE_DAYS = 21

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'
export const WEEKDAYS: readonly Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** How `per week` adherence windows lie on the calendar (C3). The default
 *  tumbles 7-day windows from the instance's anchor; `calendarAligned` uses
 *  calendar weeks starting on the declared weekday. It never touches the
 *  progress clock, `per day`/`per days(n)` windows, or any `cal.*` read. */
export type AdherenceWeeks = 'fromAnchor' | { calendarAligned: { weekStart: Weekday } }

/** An empty `frequency` list derives from the rotation, so every program has
 *  adherence with no authoring. */
export function defaultFrequency(r: Rotation): Frequency[] {
  const any: Selector = { s: 'any' }
  switch (r.k) {
    case 'weekly':
      return [{ k: 'atLeast', n: r.days.length, of: any, per: { k: 'week' } }]
    case 'alternate':
      return [{ k: 'atLeast', n: r.perWeek, of: any, per: { k: 'week' } }]
    case 'pattern':
      return [{ k: 'atLeast', n: r.days.filter((x) => typeof x === 'string').length, of: any, per: { k: 'days', n: r.days.length } }]
    case 'daily':
      return [{ k: 'atLeast', n: r.perDay, of: any, per: { k: 'day' } }]
  }
}
export const effectiveFrequency = (declared: Frequency[], r: Rotation) => (declared.length ? declared : defaultFrequency(r))

// ═══════════════════════════════════════════════════════════════════════════
// §4 Feasibility (the checker's consumer)
// ═══════════════════════════════════════════════════════════════════════════

/** One key per selector MEANING: a muscle set is sorted, so "quads or glutes"
 *  and "glutes or quads" share their lastOn entry and their containment. */
export const selKey = (s: Selector) => JSON.stringify(s.s === 'muscle' ? { s: 'muscle', muscles: [...s.muscles].sort() } : s)
/** a's occurrences are all b's occurrences. Conservative: only `any` and
 *  equality (of canonical keys) are known containments, so an unprovable
 *  overlap is never refused. */
const within = (a: Selector, b: Selector) => b.s === 'any' || selKey(a) === selKey(b)

/** The literal spacing a minGap can demand at worst: its literal gap, or its
 *  ceiling when the gap is a term. */
export function worstGap(f: Extract<Frequency, { k: 'minGap' }>): number {
  const g = f.gap
  return g.k === 'lit' && g.lit.k === 'q' ? Math.min(g.lit.v, f.ceiling) : f.ceiling
}

export type Infeasible = { a: number; b: number | null; why: string }

/**
 * Searches one cyclic hyper-period for an arrangement satisfying each
 * atLeast together with each cap on an overlapping selector, and names the
 * first conflicting pair. A cyclic schedule is the honest reading of "every
 * week": the gap from the last session of one window to the first of the next
 * counts. Pairwise, and only where the expectation's selector lies inside the
 * cap's; a conflict needing three declarations at once is not searched.
 */
export function feasibility(fs: Frequency[], perDayMax: number): Infeasible | null {
  for (const [i, f] of fs.entries()) {
    if (f.k !== 'atLeast') continue
    const L = periodDays(f.per)
    if (f.n > L * perDayMax) return { a: i, b: null, why: `${f.n} sessions need more than ${L} days at ${perDayMax} a day` }
    for (const [j, g] of fs.entries()) {
      if (g.k === 'atLeast' || !within(f.of, g.of)) continue
      if (g.k === 'minGap') {
        const gap = worstGap(g)
        // n sessions g days apart fit a cyclic L-day window iff n·g ≤ L.
        if (gap > 0 && f.n * gap > L) return { a: i, b: j, why: `${f.n} sessions every ${L} days cannot stay ${gap} days apart (${f.n} × ${gap} > ${L})` }
      } else if (!cyclicFits(f.n, L, g.n, g.withinDays, perDayMax)) {
        return { a: i, b: j, why: `${f.n} sessions every ${L} days cannot fit ${g.n} in any ${g.withinDays} days` }
      }
    }
  }
  return null
}

/** Exhaustive search over a cyclic schedule of period L (counts per day),
 *  pruned by the rolling cap. L ≤ MAX_PERIOD_DAYS keeps it bounded. */
function cyclicFits(n: number, L: number, cap: number, W: number, perDayMax: number): boolean {
  const xs = new Array<number>(L).fill(0)
  // A window ending at d, clipped at day 0, is a subset of a cyclic window: prune on it.
  const prefixOk = (d: number) => xs.slice(Math.max(0, d - W + 1), d + 1).reduce((a, b) => a + b, 0) <= cap
  const cyclicOk = () => xs.every((_, s) => Array.from({ length: W }, (_, k) => xs[(s + k) % L]!).reduce((a, b) => a + b, 0) <= cap)
  const go = (d: number, placed: number): boolean => {
    if (placed >= n) return cyclicOk()
    if (d >= L || placed + (L - d) * perDayMax < n) return false
    for (let c = Math.min(perDayMax, n - placed); c >= 0; c--) {
      xs[d] = c
      if (prefixOk(d) && go(d + 1, placed + c)) return true
    }
    xs[d] = 0
    return false
  }
  return go(0, 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 Occurrences, expectations, adherence (the running reconciliation slice)
// ═══════════════════════════════════════════════════════════════════════════

/** What a selector can see of a session: its slots' declared muscles (primary
 *  only) and tags, and the day it instantiated. */
export interface SlotView {
  primary: string
  tags: readonly string[]
}
export interface CalendarSpec {
  instance: string
  anchor: LocalDay
  activatedOn: LocalDay
  frequency: Frequency[]
  slots: Readonly<Record<string, SlotView>>
  lapseAfterDays: number
  /** Present only when weekly windows are calendar-aligned (C3); omitted is
   *  the anchor-tumbling default, so a default spec is byte-identical. */
  adherenceWeeks?: Extract<AdherenceWeeks, { calendarAligned: unknown }>
  /** Every selector whose last day is kept: `any`, each frequency's, and
   *  every one a term of the program reads through `cal.gap`/`cal.recent`. */
  tracked: readonly Selector[]
}

/** Instance-level overrides at activation (the CalendarSpec seam): a lapse
 *  threshold and the week alignment may be set per instance; everything else
 *  stays the program's declaration. */
export interface SpecOverrides {
  lapseAfterDays?: number
  adherenceWeeks?: AdherenceWeeks
}

/** The calendar view of a program instance: its effective frequency, what
 *  each slot shows a selector (its one primary muscle, its static tags), and
 *  the selectors to track. `reads` is the program's elaborated calendar reads
 *  (checkdefs.ts `calReads`), so a read of an untracked selector cannot be
 *  built. */
export function calendarSpecOf(p: ProgramDef, reads: readonly Selector[], instance: string, anchor: LocalDay, activatedOn: LocalDay, overrides: SpecOverrides = {}): CalendarSpec | import('./engine').IngestRefusal {
  const slots = Object.fromEntries(
    Object.entries(p.slots).map(([k, b]) => [k, { primary: Object.entries(b.meta.muscles).find(([, c]) => c === 1)?.[0] ?? '', tags: b.meta.tags ?? [] }]),
  )
  const frequency = effectiveFrequency(p.frequency, p.rotation)
  const all: Selector[] = [{ s: 'any' }, ...frequency.map((f) => f.of), ...reads]
  const tracked = [...new Map(all.map((x) => [selKey(x), x])).values()]
  // Bad overrides are TYPED refusals, never thrown (Y9); an override that
  // spells the program's own value is a second form of the same meaning and
  // is refused too (Y4's one-form law at the activation boundary).
  const lapse = overrides.lapseAfterDays ?? p.lapseAfterDays
  if (!(Number.isInteger(lapse) && lapse >= 1)) return { code: 'badOverride', option: 'lapseAfterDays', value: lapse }
  if (overrides.lapseAfterDays !== undefined && overrides.lapseAfterDays === p.lapseAfterDays) return { code: 'badOverride', option: 'lapseAfterDays', value: `${lapse} (the program's own value: omit the override)` }
  const aw = overrides.adherenceWeeks ?? p.adherenceWeeks ?? 'fromAnchor'
  if (aw !== 'fromAnchor' && !WEEKDAYS.includes(aw.calendarAligned?.weekStart)) return { code: 'badOverride', option: 'adherenceWeeks.calendarAligned.weekStart', value: String(aw.calendarAligned?.weekStart) }
  if (overrides.adherenceWeeks !== undefined && JSON.stringify(overrides.adherenceWeeks) === JSON.stringify(p.adherenceWeeks ?? 'fromAnchor'))
    return { code: 'badOverride', option: 'adherenceWeeks', value: `${JSON.stringify(overrides.adherenceWeeks)} (the program's own value: omit the override)` }
  return { instance, anchor, activatedOn, frequency, slots, lapseAfterDays: lapse, ...(aw === 'fromAnchor' ? {} : { adherenceWeeks: aw }), tracked }
}

/** `calendarSpecOf`, asserted: for callers that pass no overrides, where a
 *  refusal is impossible. */
export function calendarSpec(p: ProgramDef, reads: readonly Selector[], instance: string, anchor: LocalDay, activatedOn: LocalDay): CalendarSpec {
  const spec = calendarSpecOf(p, reads, instance, anchor, activatedOn)
  if ('code' in spec) throw new Error(`calendarSpecOf refused with no overrides: ${JSON.stringify(spec)}`)
  return spec
}

/** A session that closed with at least one logged set. Only sessions
 *  instantiated from the program are occurrences of it for adherence; ad-hoc
 *  workouts still count for `cal.gap`, because detraining is physiological. */
export interface Occurrence {
  workoutId: string
  localDay: LocalDay
  day: string | null //  the program day it instantiated; null for ad-hoc
  slots: readonly string[]
  muscles: readonly string[] // primary muscles trained (ad-hoc sessions carry theirs)
  startedEarly: boolean
  /** Per metric, the session's logged total and its largest single value:
   *  what a `cal.recent` sum or max reads. */
  totals?: Readonly<Record<string, { sum: number; max: number }>>
}
export type Refused = { refused: 'emptySession'; workoutId: string }

/** The EC-177 ingest refusal. An empty close is a typed non-event: no rule
 *  fires, no streak moves, no expectation counts it, and no gap resets. */
export function occurrenceOf(close: Omit<Occurrence, 'muscles'> & { loggedSets: number }, spec: CalendarSpec): Occurrence | Refused {
  if (close.loggedSets === 0) return { refused: 'emptySession', workoutId: close.workoutId }
  const muscles = close.slots.map((s) => spec.slots[s]?.primary).filter((m): m is string => !!m)
  return { workoutId: close.workoutId, localDay: close.localDay, day: close.day, slots: close.slots, muscles, startedEarly: close.startedEarly, ...(close.totals ? { totals: close.totals } : {}) }
}

export function matches(o: Occurrence, sel: Selector, spec: CalendarSpec): boolean {
  switch (sel.s) {
    case 'any':
      return true
    case 'slot':
      return o.slots.includes(sel.slot)
    case 'day':
      return o.day === sel.day
    case 'muscle':
      return o.muscles.some((m) => sel.muscles.includes(m))
    case 'tag':
      return o.slots.some((s) => spec.slots[s]?.tags.includes(sel.tag))
  }
}

/** Issued when its window OPENS, snapshotting the plan of attendance then:
 *  a schedule edit mid-window changes the next window, never this one. */
export interface Expectation {
  key: `expect:${string}:${number}:${number}` //  instance : rule : window
  rule: number
  window: { from: LocalDay; through: LocalDay }
  n: number
  of: Selector
  status: 'issued' | 'void' //                   void: the window touched a pause or a lapse
}
/** Written by the dayClosed that ends the window. Immutable: a late session
 *  appends an amendment and never edits this row. */
export interface Adherence {
  key: `adhere:${string}:${number}:${number}`
  expectation: Expectation['key']
  met: { workoutId: string; localDay: LocalDay }[]
  missed: number
  void: boolean
}
export interface AdherenceAmendment {
  key: `amend:${string}`
  adherence: Adherence['key']
  workoutId: string
  localDay: LocalDay
}

export type CalEvent =
  | { k: 'dayClosed'; causeKey: `day:${string}:${LocalDay}`; day: LocalDay }
  | { k: 'sessionClosed'; causeKey: `session:${string}`; occurrence: Occurrence; adHoc: boolean }
  | { k: 'pause'; causeKey: `pause:${string}`; from: LocalDay; until: LocalDay | null }

export interface CalendarState {
  reconciledThrough: LocalDay //            the last day closed
  seen: ReadonlySet<string> //              causeKeys applied (L5)
  status: InstanceStatus
  occurrences: readonly Occurrence[] //     program sessions, ingestion order
  lastOn: Readonly<Record<string, LocalDay>> // per tracked selector key, ad-hoc included: feeds cal.gap in O(1)
  pauses: readonly { from: LocalDay; until: LocalDay | null }[]
  expectations: readonly Expectation[]
  adherence: readonly Adherence[]
  amendments: readonly AdherenceAmendment[]
}

/** The day a calendar-aligned week containing `n` starts: the latest day at
 *  or before it whose weekday is the declared week start. dayNum 0 is a
 *  Thursday (1970-01-01), so Monday ≡ 4 (mod 7). */
const alignedStart = (n: number, weekStart: Weekday) => {
  const idx = (WEEKDAYS.indexOf(weekStart) + 4) % 7
  return n - ((((n - idx) % 7) + 7) % 7)
}
/** A frequency window: tumbling from the anchor, except that `per week`
 *  windows under a calendarAligned declaration (C3) are calendar weeks from
 *  the declared week start; `w` then counts aligned weeks from the anchor's. */
const windowOf = (spec: CalendarSpec, per: Period, day: LocalDay) => {
  const L = periodDays(per)
  if (per.k === 'week' && spec.adherenceWeeks) {
    const start = spec.adherenceWeeks.calendarAligned.weekStart
    const from = alignedStart(dayNum(day), start)
    const w = (from - alignedStart(dayNum(spec.anchor), start)) / 7
    return { w, from: dayOf(from), through: dayOf(from + 6) }
  }
  const w = Math.floor((dayNum(day) - dayNum(spec.anchor)) / L)
  const from = dayNum(spec.anchor) + w * L
  return { w, from: dayOf(from), through: dayOf(from + L - 1) }
}
/** A pause covers the days from..until; a resume on its first day leaves it
 *  covering none (zero length), which voids and stops nothing (F16). */
const covers = (p: CalendarState['pauses'][number], day: number) => dayNum(p.from) <= day && (p.until === null || dayNum(p.until) >= day)
const paused = (st: Pick<CalendarState, 'pauses'>, from: LocalDay, through: LocalDay) =>
  st.pauses.some((p) => (p.until === null || dayNum(p.until) >= dayNum(p.from)) && dayNum(p.from) <= dayNum(through) && (p.until === null || dayNum(p.until) >= dayNum(from)))
/** Days in (after, through] not covered by a pause: what the lapse clock counts. */
const unpausedDays = (st: Pick<CalendarState, 'pauses'>, after: number, through: number) => {
  let n = 0
  for (let x = after + 1; x <= through; x++) if (!st.pauses.some((p) => covers(p, x))) n++
  return n
}
/** Is the instance paused on this day? */
export const pausedOn = (st: Pick<CalendarState, 'pauses'>, day: LocalDay) => st.pauses.some((p) => covers(p, dayNum(day)))
/** The status the pauses give an instance on its open day (the day after
 *  reconciledThrough): paused while a pause covers it, so a pause from today
 *  takes effect at its event, a future one on its first day, and a bounded
 *  one ends by itself; a resume (which bounds the open pause) makes it active
 *  again (F16). A paused instance never lapses; completed and abandoned are
 *  terminal. */
export const pauseStatus = (st: Pick<CalendarState, 'pauses' | 'status'>, day: LocalDay): InstanceStatus =>
  (st.status === 'active' || st.status === 'lapsed') && pausedOn(st, day) ? 'paused' : st.status === 'paused' && !pausedOn(st, day) ? 'active' : st.status

/** Issue the expectations of every window that starts on `day`. Never for a
 *  window starting before activation: starting a program back-fills nothing. */
function open(spec: CalendarSpec, st: CalendarState, day: LocalDay): Expectation[] {
  if (dayNum(day) < dayNum(spec.activatedOn)) return []
  const out: Expectation[] = []
  for (const [i, f] of spec.frequency.entries()) {
    if (f.k !== 'atLeast') continue
    const win = windowOf(spec, f.per, day)
    if (win.from !== day) continue
    const voided = st.status === 'lapsed' || paused(st, win.from, win.through)
    out.push({ key: `expect:${spec.instance}:${i}:${win.w}`, rule: i, window: { from: win.from, through: win.through }, n: f.n, of: f.of, status: voided ? 'void' : 'issued' })
  }
  return out
}

/** The calendar at activation: the windows that start on the activation day. */
export function activate(spec: CalendarSpec): CalendarState {
  const st: CalendarState = {
    reconciledThrough: addDays(spec.activatedOn, -1),
    seen: new Set(),
    status: 'active',
    occurrences: [],
    lastOn: {},
    pauses: [],
    expectations: [],
    adherence: [],
    amendments: [],
  }
  return { ...st, expectations: open(spec, st, spec.activatedOn) }
}

/** The dayClosed events for (reconciledThrough, today). Pure; a duplicate
 *  causeKey is a no-op on apply, so running it twice appends nothing and a
 *  crash mid-catch-up resumes at the next day. Today itself is still open. */
export function reconcile(spec: CalendarSpec, st: CalendarState, today: LocalDay): Extract<CalEvent, { k: 'dayClosed' }>[] {
  const out: Extract<CalEvent, { k: 'dayClosed' }>[] = []
  for (let n = dayNum(st.reconciledThrough) + 1; n < dayNum(today); n++) out.push({ k: 'dayClosed', causeKey: `day:${spec.instance}:${dayOf(n)}`, day: dayOf(n) })
  return out
}

/** One event into the calendar state. Idempotent by causeKey (L5). */
export function stepCalendar(spec: CalendarSpec, st: CalendarState, e: CalEvent): CalendarState {
  if (st.seen.has(e.causeKey)) return st
  const seen = new Set([...st.seen, e.causeKey])
  switch (e.k) {
    case 'pause': {
      const next = { ...st, seen, pauses: [...st.pauses, { from: e.from, until: e.until }] }
      return { ...next, status: pauseStatus(next, addDays(st.reconciledThrough, 1)) }
    }
    case 'sessionClosed': {
      const o = e.occurrence
      const lastOn = { ...st.lastOn }
      // A late log can only extend a gap's knowledge, never move it backwards.
      for (const x of spec.tracked) {
        const prev = lastOn[selKey(x)]
        if (matches(o, x, spec) && (!prev || dayNum(o.localDay) > dayNum(prev))) lastOn[selKey(x)] = o.localDay
      }
      if (e.adHoc) return { ...st, seen, lastOn }
      // A late session lands in an already-closed window: append, never edit.
      const amendments = [...st.amendments]
      for (const a of st.adherence) {
        const x = st.expectations.find((y) => y.key === a.expectation)!
        if (!a.void && dayNum(o.localDay) >= dayNum(x.window.from) && dayNum(o.localDay) <= dayNum(x.window.through) && matches(o, x.of, spec))
          amendments.push({ key: `amend:${a.key}:${o.workoutId}`, adherence: a.key, workoutId: o.workoutId, localDay: o.localDay })
      }
      return { ...st, seen, lastOn, status: st.status === 'lapsed' ? 'active' : st.status, occurrences: [...st.occurrences, o], amendments }
    }
    case 'dayClosed': {
      // Monotonic (F8): a day at or before reconciledThrough closes nothing
      // again; a day past the next one closes every day up to it in order, so
      // a skipped day cannot orphan a window. The ledger keeps one causeKey per
      // day, so the skipped day's own event, arriving later, is a no-op.
      let next: CalendarState = { ...st, seen }
      for (let n = dayNum(st.reconciledThrough) + 1; n <= dayNum(e.day); n++) next = closeDay(spec, next, dayOf(n))
      return next
    }
  }
}

/** Close one day: 1. close every window ending that day (adherence);
 *  2. (periodClosed handlers run in step.ts: propose|keep only, L13);
 *  3. open the windows starting the next day; 4. lapse. The lapse clock does
 *  not run while paused, and counts the UNPAUSED days since the latest
 *  session on or before the day (never the latest ingested, F8), or since
 *  activation. */
function closeDay(spec: CalendarSpec, st: CalendarState, day: LocalDay): CalendarState {
  const closing = st.expectations.filter((x) => x.window.through === day)
  const adherence = [...st.adherence]
  for (const x of closing) {
    const met = st.occurrences
      .filter((o) => dayNum(o.localDay) >= dayNum(x.window.from) && dayNum(o.localDay) <= dayNum(x.window.through) && matches(o, x.of, spec))
      .map((o) => ({ workoutId: o.workoutId, localDay: o.localDay }))
    const isVoid = x.status === 'void' || paused(st, x.window.from, x.window.through)
    adherence.push({ key: `adhere:${x.key.slice('expect:'.length)}` as Adherence['key'], expectation: x.key, met, missed: isVoid ? 0 : Math.max(0, x.n - met.length), void: isVoid })
  }
  const d = dayNum(day)
  const last = st.occurrences.reduce((a, o) => (dayNum(o.localDay) <= d ? Math.max(a, dayNum(o.localDay)) : a), dayNum(spec.activatedOn))
  // The pause is resolved for the open day FIRST, then the lapse clock is
  // read, so the day a pause ends the status is already consistent: a pause
  // cannot launder a lapsed instance into one `active` day (X5).
  const base = pauseStatus(st, addDays(day, 1))
  const lapsed = base === 'active' && unpausedDays(st, last, d) >= spec.lapseAfterDays
  const next: CalendarState = { ...st, adherence, reconciledThrough: day, status: lapsed ? 'lapsed' : base }
  return { ...next, expectations: [...st.expectations, ...open(spec, next, addDays(day, 1))] }
}

/** Derived adherence = the fact folded with its amendments. Never a
 *  re-derivation from today's schedule. */
export function derivedAdherence(st: CalendarState, key: Adherence['key']): { met: number; expected: number; missed: number; void: boolean } {
  const a = st.adherence.find((x) => x.key === key)!
  const x = st.expectations.find((y) => y.key === a.expectation)!
  const met = a.met.length + st.amendments.filter((m) => m.adherence === key).length
  return { met, expected: x.n, missed: a.void ? 0 : Math.max(0, x.n - met), void: a.void }
}

/** Met over expected across non-void windows: the export `completedFraction`. */
export function completedFraction(st: CalendarState): number {
  let met = 0
  let expected = 0
  for (const a of st.adherence) {
    const d = derivedAdherence(st, a.key)
    if (d.void) continue
    met += Math.min(d.met, d.expected)
    expected += d.expected
  }
  return expected === 0 ? 1 : met / expected
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 The due verdict (prescribe's consumer)
// ═══════════════════════════════════════════════════════════════════════════

/** Part of the immutable issued fact. Soft: an early session can still be
 *  started (the occurrence records startedEarly). The app is not a jailer.
 *  `notBefore`: blocked through the whole search horizon, so the only honest
 *  statement is a lower bound, never an invented due date. */
export type Due = { k: 'due' } | { k: 'early'; dueOn: LocalDay; rule: number } | { k: 'notBefore'; day: LocalDay; rule: number }

/** `gapDays(rule)` is the cadence term already evaluated at prescribe and
 *  stamped; it is clamped to the rule's ceiling here. */
export function dueVerdict(spec: CalendarSpec, st: CalendarState, today: LocalDay, gapDays: (rule: number) => number): Due {
  const caps = spec.frequency.map((f, i) => [f, i] as const).filter(([f]) => f.k !== 'atLeast')
  const holdsOn = (day: LocalDay): number | null => {
    for (const [f, i] of caps) {
      if (f.k === 'minGap') {
        const last = st.lastOn[selKey(f.of)]
        if (last && dayNum(day) - dayNum(last) < Math.min(gapDays(i), f.ceiling)) return i
      } else if (f.k === 'atMost') {
        const recent = st.occurrences.filter((o) => matches(o, f.of, spec) && dayNum(day) - dayNum(o.localDay) < f.withinDays).length
        if (recent + 1 > f.n) return i
      }
    }
    return null
  }
  const blocking = holdsOn(today)
  if (blocking === null) return { k: 'due' }
  const horizon = Math.max(...caps.map(([f]) => (f.k === 'minGap' ? f.ceiling : f.k === 'atMost' ? f.withinDays : 0)))
  for (let n = 1; n <= horizon; n++) if (holdsOn(addDays(today, n)) === null) return { k: 'early', dueOn: addDays(today, n), rule: blocking }
  return { k: 'notBefore', day: addDays(today, horizon + 1), rule: blocking }
}
