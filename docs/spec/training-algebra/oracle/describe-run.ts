/**
 * describe-run.ts — prose for what the engine PRODUCES: issued sessions,
 * fields (fixed, silent with the cause, open with the planned value), the
 * absence causes, transitions, and `explain`, which renders a trace.
 *
 * D1 again: BOUND_TEXT, FIELD_TEXT and ABSENCE_TEXT are mapped types over
 * their unions, so a new bound shape, field kind or absence cause without
 * prose does not compile. Every number printed here is read off the issued
 * fact or the trace; conformance.ts checks it, number by number.
 */
import type { Term } from './algebra'
import { isLib, keyOf, type Registry } from './checker'
import type { Absence, Field, IssuedBound, IssuedSession, IssuedSlot, IssuedStep, IssuedTarget, Trace, Transition, Value } from './engine'
import { litText } from './describe'
import { cxOf } from './describe'
import { dayText } from './time'
import { DIMS, UNITS, dimName, qtyText, shown, trimNumber as trim, unitFor, type Unit } from './units'

type Display = Partial<Record<string, Unit>>
const DEFAULT_UNIT: Record<string, Unit> = { reps: 'rep', load: 'kg', effort: 'rir', pace: 'minPerKm', hr: 'bpm', rom: 'deg' }

/** The unit a metric's canonical number displays in. */
export function unitOf(reg: Registry, metric: string, n: number, display: Display): Unit {
  const u = display[metric] ?? DEFAULT_UNIT[metric]
  if (u) return u
  if (metric === 'duration') return Math.abs(n) >= 60 ? 'min' : 's'
  if (metric === 'distance') return Math.abs(n) >= 1000 ? 'km' : 'm'
  const d = reg.vocab.metrics[metric]
  return (d && unitFor(DIMS[d.dim])) || 'x'
}
export const numText = (reg: Registry, metric: string, n: number, display: Display) => {
  const u = unitOf(reg, metric, n, display)
  return UNITS[u].prose(shown(n, u))
}

const BOUND_TEXT: { [K in IssuedBound['b']]: (b: Extract<IssuedBound, { b: K }>, m: string, reg: Registry, d: Display) => string } = {
  exact: (b, m, reg, d) => numText(reg, m, b.v, d),
  range: (b, m, reg, d) => {
    const u = unitOf(reg, m, b.max, d)
    return `${trim(shown(b.min, u))}–${UNITS[u].prose(shown(b.max, u))}`
  },
  atLeast: (b, m, reg, d) => (m === 'reps' ? `as many reps as possible (at least ${numText(reg, m, b.v, d)})` : `at least ${numText(reg, m, b.v, d)}`),
  atMost: (b, m, reg, d) => `at most ${numText(reg, m, b.v, d)}`,
  open: (_b, m, reg) => reg.vocab.metrics[m]?.open ?? `${m} recorded`,
}
/** The same lead rule as the definition describer: "pace at most 4:45 per
 *  km", never "at at most". */
export function boundText(b: IssuedBound, m: string, reg: Registry, d: Display): string {
  const decl = reg.vocab.metrics[m]
  const body = (BOUND_TEXT[b.b] as (x: IssuedBound, m: string, r: Registry, d: Display) => string)(b, m, reg, d)
  if (b.b === 'open' || !decl?.lead || (m === 'reps' && b.b === 'atLeast')) return body
  if ((b.b === 'atLeast' || b.b === 'atMost') && decl.lead === 'at') return `${decl.noun} ${body}`
  return `${decl.lead} ${body}`
}

export const ABSENCE_TEXT: { [K in Absence['k']]: (a: Extract<Absence, { k: K }>, reg: Registry) => string } = {
  factUnknown: (a, reg) => `${reg.vocab.facts[a.fact]?.noun ?? a.fact}${a.key ? ` for ${reg.vocab.exercises[a.key]?.label ?? a.key}` : ''} is unknown`,
  factStale: (a, reg) => `${reg.vocab.facts[a.fact]?.noun ?? a.fact} is older than ${a.maxAgeDays} days (read on ${dayText(a.observedOn)})`,
  stateUnset: (a) => `your ${a.noun ?? a.field} is not set yet`,
  declaredNone: () => 'nothing was given',
  notPerformed: (a) => `“${a.step}” is not logged yet`,
  notTargeted: (a) => `“${a.step}” has no ${a.metric} target`,
  emptyPick: () => 'nothing qualified',
  missingKey: (a) => `there is no entry for ${a.key}`,
  zeroDenominator: () => 'it would divide by zero',
  noPriorSession: () => 'there is no earlier session',
  outOfDomain: (a) => `it came out at ${trim(a.value)}, which is not a usable ${a.field}`,
  ownerCleared: (a) => `you cleared ${a.field}`,
  roleExcluded: (a) => `this is ${/^[aeiou]/.test(a.role) ? 'an' : 'a'} ${a.role} week, which the weekly read leaves out`,
  noUpcomingWeek: () => 'the program has no week after this one',
  outsideFormulaDomain: (a) => `${trim(a.reps)} effective reps is more than the ${a.formula.charAt(0).toUpperCase()}${a.formula.slice(1)} estimate covers`,
}
export const absenceText = (a: Absence, reg: Registry) => (ABSENCE_TEXT[a.k] as (x: Absence, r: Registry) => string)(a, reg)

const FIELD_TEXT: { [K in Field['k']]: (f: Extract<Field, { k: K }>, m: string, reg: Registry, d: Display) => string } = {
  fixed: (f, m, reg, d) => boundText(f.v, m, reg, d),
  silent: (f, m, reg) => `no ${reg.vocab.metrics[m]?.noun ?? m} (${absenceText(f.cause, reg)})`,
  open: (f, m, reg, d) => `${reg.vocab.metrics[m]?.noun ?? m} set from how ${f.dependsOn.map((s) => `“${s}”`).join(' and ')} goes (planned: ${fieldText(f.planned, m, reg, d)})`,
}
export const fieldText = (f: Field, m: string, reg: Registry, d: Display) => (FIELD_TEXT[f.k] as (x: Field, m: string, r: Registry, d: Display) => string)(f, m, reg, d)

const ROLE: Record<string, string> = { warmup: 'warm-up ', backoff: 'back-off ', test: 'test ', recovery: 'recovery ', working: '', amrap: '' }
export function targetText(t: IssuedTarget, reg: Registry, d: Display): string {
  const ms = Object.entries(t.metrics).sort(([a], [b]) => (a === 'reps' ? -1 : b === 'reps' ? 1 : 0))
  const parts = ms.map(([m, f]) => fieldText(f!, m, reg, d))
  if (t.cluster) parts.push(`in clusters of ${UNITS.rep.prose(t.cluster.per)} with ${UNITS.s.prose(t.cluster.intraRestSec)} between`)
  if (t.restSec !== null) parts.push(`resting ${t.restSec >= 60 ? UNITS.min.prose(t.restSec / 60) : UNITS.s.prose(t.restSec)}`)
  if (t.tempo) parts.push(`at tempo ${t.tempo.join('-')}`)
  return `${ROLE[t.role] ?? ''}${parts.join(' ')}`
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export function stepText(st: IssuedStep, reg: Registry, d: Display): string {
  const texts = st.sets.map((t) => targetText(t, reg, d))
  const same = texts.every((x) => x === texts[0])
  const c = st.count
  if (c.k === 'n') return c.n === 0 ? 'no sets' : c.n === 1 ? texts[0]! : same ? `${plural(c.n, 'set')} of ${texts[0]}` : texts.slice(0, c.n).join(', then ')
  if (c.k === 'range') return `${c.min}–${plural(c.max, 'set')} (your choice) of ${texts[0]}`
  return `up to ${plural(c.max, 'set')} (${c.planned} if it goes as planned): ${same ? texts[0] : texts.join(', then ')}`
}

export function slotText(sl: IssuedSlot, reg: Registry, d: Display): string {
  const head = 'id' in sl.exercise ? sl.exercise.label : `no exercise (${absenceText(sl.exercise.silent, reg)})`
  const parts: string[] = []
  for (let i = 0; i < sl.steps.length; ) {
    const st = sl.steps[i]!
    if (!st.block) {
      parts.push(stepText(st, reg, d))
      i++
      continue
    }
    const run = sl.steps.slice(i).filter((x, j, xs) => x.block?.id === st.block!.id && (j === 0 || xs[j - 1]!.block?.id === st.block!.id))
    const body = run.filter((x) => x.block!.iteration === 0).map((x) => stepText(x, reg, d)).join(', then ')
    const iterations = new Set(run.map((x) => x.block!.iteration)).size
    parts.push(`${iterations} times: (${body})`)
    i += run.length
  }
  const fin = sl.intensifier ? `; finish with a ${sl.intensifier.kind} (${sl.intensifier.stages.map((t) => targetText(t, reg, d)).join(', then ')})` : ''
  return `${head}: ${parts.join('; ')}${fin}`
}

/** The viewer's display units (C11), a PROJECTION-layer choice: every
 *  mass-dimension metric renders in the viewer's unit, converted
 *  display-exactly from the canonical value (the locale's at-most-three-
 *  decimals rule states the rounding). The issued numbers and the grids stay
 *  program facts in the grid's declared unit; nothing is re-quantized. */
export interface ViewerUnits {
  mass?: 'kg' | 'lb'
}
export function viewerDisplay(reg: Registry, display: Display, viewer: ViewerUnits | undefined): Display {
  if (!viewer?.mass) return display
  const massMetrics = Object.entries(reg.vocab.metrics).filter(([, d]) => d.dim === 'mass').map(([m]) => m)
  return { ...display, ...Object.fromEntries(massMetrics.map((m) => [m, viewer.mass])) }
}
export function sessionText(s: IssuedSession, reg: Registry, viewer?: ViewerUnits): string[] {
  const p = s.stamp.position
  const moved = s.day !== s.defaultDay ? ` (the rotation suggested Day ${s.defaultDay})` : ''
  const display = viewerDisplay(reg, s.stamp.display, viewer)
  return [`Day ${s.day}, ${dayText(s.stamp.issuedOn)}, block week ${p.week} (${p.role})${moved}:`, ...s.slots.map((sl) => `  ${slotText(sl, reg, display)}`)]
}

// ── values and traces ───────────────────────────────────────────────────────

export function valueText(v: Value, reg: Registry): string {
  switch (v.v) {
    case 'q':
      return v.notation === 'rpe' ? `RPE ${trim(10 - v.n)}` : v.unit ? qtyText(shown(v.n, v.unit, v.per), v.unit, v.per) : `${trim(v.n)}${Object.keys(v.dim).length ? ` ${dimName(v.dim)}` : ''}`
    case 'bool':
      return v.b ? 'yes' : 'no'
    case 'ord':
      return `${v.scale} ${v.level}`
    case 'enum':
      return `“${v.tag}”`
    case 'ref':
      return v.kind === 'exercise' ? (reg.vocab.exercises[v.id]?.label ?? v.id) : v.id
    case 'none':
      return `unknown (${absenceText(v.cause, reg)})`
    case 'list':
      return `[${v.items.map((x) => valueText(x, reg)).join(', ')}]`
    case 'map':
      return `{${v.entries.map(([k, x]) => `${k}: ${valueText(x, reg)}`).join(', ')}}`
    case 'set':
      return targetText(v.t, reg, {})
    case 'session':
      return `a session of ${valueText(v.s.exercise, reg)}`
    case 'technique':
      return `a ${v.t.kind}`
    case 'tempo':
      return v.t.join('-')
    case 'patch':
      return Object.keys(v.fields).length ? Object.entries(v.fields).map(([f, x]) => `${x.mode} ${f} = ${valueText(x.value, reg)}`).join('; ') : 'keep'
  }
}

const PASS = new Set<Term['k']>(['known', 'orElse', 'named', 'let', 'some', 'if', 'match', 'table'])
/** A trace as a worked explanation: arithmetic shows its operands, a library
 *  call shows its filled template and then its working, a read shows its
 *  value, and a conditional or fallback shows the branch it took. */
export function explain(t: Trace, reg: Registry): string {
  const n = t.node
  const v = valueText(t.value, reg)
  if (n.k === 'lit') return litText(n.lit, cxOf(reg))
  if (n.k === 'arith') {
    const [a, b] = t.kids.map((k) => explain(k, reg))
    const shownOp = n.op === 'max' ? `max(${a}, ${b})` : n.op === 'min' ? `min(${a}, ${b})` : `${a} ${{ '*': '×', '-': '−', '+': '+' }[n.op]} ${b}`
    return `${v} (${shownOp})`
  }
  if (n.k === 'ratio') return `${v} (${explain(t.kids[0]!, reg)} as a fraction of ${explain(t.kids[1]!, reg)})`
  if (n.k === 'round') return `${v} (${explain(t.kids[0]!, reg)} rounded ${n.mode === 'nearest' ? 'to the nearest' : n.mode} ${explain(t.kids[1]!, reg)}${t.note ? `; ${t.note}` : ''})`
  if (n.k === 'app') {
    const f = reg.fns.get(keyOf(n.def))
    const inside = explain(t.kids[t.kids.length - 1]!, reg)
    if (!f || !isLib(f.ref.id)) return `${v}; worked: ${inside}`
    const args = Object.fromEntries(Object.keys(n.args).map((k, i) => [k, valueText(t.kids[i]!.value, reg)]))
    return `${v}: ${f.says.replace(/\{(\w+)\}/g, (_, k: string) => args[k] ?? `{${k}}`)}; worked: ${inside}`
  }
  if (PASS.has(n.k) && t.kids.length) return explain(t.kids[t.kids.length - 1]!, reg)
  return t.note ? `${v} (${t.note})` : v
}

/** A transition, field by field: what landed, how, and why it did not. */
export function transitionText(tr: Transition, reg: Registry, nouns: (scope: string, field: string) => string): string[] {
  const out: string[] = []
  for (const f of tr.fired) {
    if (f.skipped) {
      out.push(`${f.scope} ${f.on}: no session of it in that window, so nothing changes (untrained)`)
      continue
    }
    const fields = Object.entries(f.patch)
    if (!fields.length) continue
    const word = { commit: 'set', propose: 'proposed', keep: 'kept', void: 'not applied (it moved since it was proposed)' }
    out.push(`${f.scope} ${f.on}: ${fields.map(([k, p]) => `${word[p.mode]} ${nouns(f.scope, k)} ${p.mode === 'void' ? '' : `= ${valueText(p.value, reg)}`}${p.demotedBy.length ? ` (by rule ${p.demotedBy.map((i) => i + 1).join(', ')})` : ''}`.trim()).join('; ')}`)
  }
  return out
}
