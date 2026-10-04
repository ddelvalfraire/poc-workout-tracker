/**
 * describe-defs.ts — prose for definitions and declarations.
 *
 * Declarations get D1 the way formers do: DECL_DESCRIBERS is a mapped type
 * over Frequency['k'], Rotation['k'], Group['k'] and Drift, so a new
 * frequency form, rotation, group or drift mode without prose does not
 * compile. The calendar facts (a due verdict, an adherence row, an
 * amendment) render here too, from the declaration that produced them.
 *
 * Two clock vocabularies, never crossed: progress prose says "block week"
 * and "training week"; attendance prose says "7-day window (from your start
 * day)" and never a bare "week" for a tumbling window.
 */
import type { Term } from './algebra'
import { isLib, keyOf } from './checker'
import { cxOf, d, describe, finish, pad, phrase, selText, sentence, type Cx } from './describe'
import type { FactDecl } from './registry'
import type { Calendar, Group, MacroDef, Policy, ProgramDef, SchemeDef, SlotBinding, Use } from './structure'
import { addDays, dayNum, dayText, defaultFrequency, type Adherence, type CalendarSpec, type CalendarState, type Drift, type Due, type Frequency, type Rotation, derivedAdherence } from './time'
import { trimNumber as trim } from './units'

type Decl<K extends string, T extends { k: K }> = { [X in K]: (t: Extract<T, { k: X }>, cx: Cx) => string }
export interface DeclDescribers {
  frequency: Decl<Frequency['k'], Frequency>
  rotation: Decl<Rotation['k'], Rotation>
  group: Decl<Group['k'], Group>
  drift: Record<Drift, string>
}

const per = (f: Extract<Frequency, { k: 'atLeast' }>) =>
  f.per.k === 'day' ? 'each day' : f.per.k === 'week' ? 'in each 7-day window (from your start day)' : `in each ${f.per.n}-day window (from your start day)`
const lower = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`
const list = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''))
const pctText = (x: number) => `${trim(x * 100)}%`
/** "Label: text", or "Label:" over an indented list when the text is one. */
const labelled = (label: string, text: string, by: string) => (text.startsWith('\n') ? `${label}:${pad(text, by)}` : `${label}: ${pad(text, by)}`)

export const DECL_DESCRIBERS: DeclDescribers = {
  frequency: {
    atLeast: (f) => (f.of.s === 'any' ? `Train at least ${f.n} ${f.n === 1 ? 'time' : 'times'} ${per(f)}` : `Do at least ${f.n} ${selText(f.of, f.n !== 1)} ${per(f)}`),
    atMost: (f) => `Do no more than ${f.n} ${selText(f.of, f.n !== 1)} in any ${f.withinDays} days`,
    // The ceiling bounds a TERM gap (state-driven spacing); a literal gap needs no clause.
    minGap: (f, cx) => `Leave at least ${d(f.gap, cx)} between ${selText(f.of, true)}${f.gap.k === 'lit' ? '' : ` (never more than ${f.ceiling} days)`}`,
  },
  rotation: {
    weekly: (r) => `Each training week: ${r.days.map((x) => `Day ${x}`).join(', then ')}`,
    alternate: (r) => `Alternate ${r.days.map((x) => `Day ${x}`).join(' / ')}, ${r.perWeek} sessions per training week`,
    pattern: (r) => `A ${r.days.length}-day cycle: ${r.days.map((x) => (typeof x === 'string' ? `Day ${x}` : 'rest')).join(', ')}`,
    daily: (r) => `Do ${list(r.days.map((x) => `Day ${x}`))} ${r.perDay === 1 ? 'once' : r.perDay === 2 ? 'twice' : `${r.perDay} times`} every day`,
  },
  group: {
    single: (g) => g.slot,
    superset: (g, cx) => `superset ${list(g.slots)}: rest ${d(g.between, cx)} between them, then ${d(g.after, cx)}`,
    circuit: (g, cx) => `a circuit of ${list(g.slots)}, resting ${d(g.restBetweenRounds, cx)} between rounds${g.score ? `, scored by ${g.score === 'time' ? 'time to finish' : 'rounds'}` : ''}`,
    emom: (g, cx) => `every ${d(g.every, cx)}, one set each of ${list(g.slots)}${g.untilFail ? `, adding a rep each round until you fail (at most ${g.untilFail.max} rounds)` : ''}`,
    amrapFor: (g, cx) => `as many rounds as possible of ${list(g.slots)} in ${d(g.cap, cx)}`,
  },
  drift: {
    slide: 'If you miss a session the plan waits: the next session is still the one you missed.',
    anchored: "The plan follows the calendar: a block week you don't finish closes on schedule and its remaining sessions are skipped.",
  },
}
export function freqText(f: Frequency, cx: Cx): string {
  return (DECL_DESCRIBERS.frequency[f.k] as (x: Frequency, c: Cx) => string)(f, cx)
}
const rotText = (r: Rotation, cx: Cx) => (DECL_DESCRIBERS.rotation[r.k] as (x: Rotation, c: Cx) => string)(r, cx)
const groupText = (g: Group, cx: Cx) => (DECL_DESCRIBERS.group[g.k] as (x: Group, c: Cx) => string)(g, cx)

/** A fact as the slot description lists it: its noun, how it is observed, and
 *  when it goes stale. */
export function factLine(f: FactDecl): string {
  const when = { standing: 'kept on file', preSession: 'checked in before the session', duringSession: 'recorded during the session', postSession: 'rated after the session' }[f.observed]
  const reducer = f.grain.g === 'reducer' ? `, ${f.grain.reducer}` : ''
  return `${f.noun} (${when}${reducer}${f.maxAgeDays ? `; ignored once older than ${f.maxAgeDays === 1 ? 'a day' : `${f.maxAgeDays} days`}` : ''})`
}

/** When each handler fires. The cycle-end clause is read off the calendar
 *  the slot runs in, never assumed. */
function whenText(ev: string, calendar: Calendar | null): string {
  const last = calendar?.weeks[calendar.weeks.length - 1]
  return {
    session: 'After each session',
    weekEnd: 'At the end of each block week',
    cycleEnd: `After each cycle${last && last !== 'train' ? ` (after its ${last} week)` : ''}`,
    blockEnd: 'At the end of the block',
    periodClosed: 'When an attendance window closes',
  }[ev] ?? ev
}

/** A scheme as bound in a slot: its template (library only, D5), its facts,
 *  its state, its plan and handlers. */
export function describeSlot(s: SchemeDef, args: Record<string, string>, cx: Cx, calendar: Calendar | null = null): string[] {
  const nouns = Object.fromEntries(Object.entries(s.state).map(([k, v]) => [k, v.noun]))
  const flags = new Set(Object.entries(s.state).filter(([, v]) => v.ty.t === 'bool').map(([k]) => k))
  const c: Cx = { ...cx, lib: isLib(s.ref.id), params: args, nouns, flags }
  const lines = isLib(s.ref.id) ? [s.says.replace(/\{(\w+)\}/g, (_, k: string) => args[k] ?? `{${k}}`)] : []
  if (s.facts.length) lines.push(`  Reads ${s.facts.map((f) => factLine(cx.reg.vocab.facts[f]!)).join('; ')}.`)
  for (const v of Object.values(s.state)) lines.push(`  Starts with ${v.ty.t === 'bool' ? `“${v.noun}”` : v.noun} = ${phrase(v.init, c)}; written by ${v.writableBy.join(', ') || 'nothing'}.`)
  lines.push(`  ${labelled('Plan', describe(s.plan, c), '    ')}`)
  for (const [ev, h] of Object.entries(s.on)) if (h) lines.push(`  ${labelled(whenText(ev, calendar), describe(h, c), '    ')}`)
  return lines
}

export function programCx(p: ProgramDef, cx: Cx): Cx {
  return {
    ...cx,
    lib: isLib(p.ref.id),
    // A program param reads as what fills it: an import names its source.
    params: Object.fromEntries(Object.keys(p.params).map((k) => [k, p.imports[k] ? `the ${p.imports[k]!.export} handed on by ${p.imports[k]!.from.id}` : `the ${k} handed on by the previous phase`])),
    peer: (slot, field) => {
      const b = p.slots[slot]
      const s = b && cx.reg.schemes.get(keyOf(b.scheme))
      return `the ${slot} slot's ${s?.state[field]?.noun ?? field}`
    },
    programNouns: Object.fromEntries(Object.entries(p.aggregate?.state ?? {}).map(([k, v]) => [k, v.noun])),
    // Program-level terms (policies, the aggregate) read the aggregate's state.
    nouns: Object.fromEntries(Object.entries(p.aggregate?.state ?? {}).map(([k, v]) => [k, v.noun])),
  }
}
export function bindingArgs(p: ProgramDef, b: SlotBinding, cx: Cx): Record<string, string> {
  return Object.fromEntries(Object.entries(b.args).map(([k, v]) => [k, phrase(v, programCx(p, cx))]))
}

// ── policies: each rule, then what co-firing rules do TOGETHER ──────────────

const roleOf = (w: Term) => (w.k === 'cmp' && w.a.k === 'pos' && w.a.field === 'role' && w.b.k === 'lit' && w.b.lit.k === 'enum' ? w.b.lit.tag : null)
const always = (w: Term) => w.k === 'lit' && w.lit.k === 'bool' && w.lit.v
const condText = (pol: Policy, cx: Cx) => {
  const role = roleOf(pol.when)
  return role ? `this is a ${role} week` : finish(d(pol.when, cx))
}

/** A session→session Use as a normal form, when its body is a chain of
 *  scaling, capping and stripping over literal arguments: what lets two
 *  co-firing deloads be stated as ONE composed result. */
export interface XNorm {
  scale: Record<string, number>
  /** Each scaleSets factor in application order: the evaluator rounds down
   *  after EACH one, so they compose as one factor only when that is exact. */
  sets: number[]
  effort: number | null
  strip: boolean
}
export function normal(u: Use, cx: Cx): XNorm | null {
  const f = cx.reg.fns.get(keyOf(u.def))
  if (!f) return null
  const n: XNorm = { scale: {}, sets: [], effort: null, strip: false }
  const num = (t: Term | null): number | null => {
    const x = t?.k === 'param' ? u.args[t.name] : t
    return x?.k === 'lit' && x.lit.k === 'q' ? x.lit.v : null
  }
  let t: Term = f.body
  while (t.k === 'xform') {
    const v = num(t.arg)
    if (t.op === 'stripIntensifier') n.strip = true
    else if (v === null) return null
    else if (t.op === 'scaleMetric' && t.metric) n.scale[t.metric] = (n.scale[t.metric] ?? 1) * v
    else if (t.op === 'scaleSets') n.sets.unshift(v)
    else if (t.op === 'capEffort') n.effort = Math.max(n.effort ?? 0, v)
    else return null
    t = t.s
  }
  return t.k === 'param' && t.name === u.hole ? n : null
}
export const compose = (xs: XNorm[]): XNorm =>
  xs.reduce((a, b) => ({
    scale: Object.fromEntries([...new Set([...Object.keys(a.scale), ...Object.keys(b.scale)])].map((m) => [m, (a.scale[m] ?? 1) * (b.scale[m] ?? 1)])),
    sets: [...a.sets, ...b.sets],
    effort: a.effort === null ? b.effort : b.effort === null ? a.effort : Math.max(a.effort, b.effort),
    strip: a.strip || b.strip,
  }))
/** The evaluator's set-count rule (xform.ts): round down, never below 1. */
const scaleCount = (n: number, f: number) => (n === 0 ? 0 : Math.max(1, Math.floor(n * f + 1e-9)))
/** Do these factors, each rounded down in turn, equal their product rounded
 *  down once, for every set count a session can have (1–64)? */
export const factorsCommute = (fs: number[]) => {
  const prod = fs.reduce((a, b) => a * b, 1)
  for (let n = 1; n <= 64; n++) if (fs.reduce(scaleCount, n) !== scaleCount(n, prod)) return false
  return true
}
function setsText(fs: number[]): string[] {
  const live = fs.filter((f) => Math.abs(f - 1) > 1e-9)
  if (!live.length) return []
  if (live.length === 1 || factorsCommute(live)) return [`${pctText(live.reduce((a, b) => a * b, 1))} of the sets`]
  return [`${live.map(pctText).join(', then ')} of the sets (each rounded down)`]
}
function normText(n: XNorm, cx: Cx): string {
  const parts = [
    ...Object.entries(n.scale).filter(([, v]) => Math.abs(v - 1) > 1e-9).map(([m, v]) => `${pctText(v)} of the ${cx.reg.vocab.metrics[m]?.noun ?? m}`),
    ...setsText(n.sets),
    ...(n.effort !== null ? [`at least ${trim(n.effort)} in reserve`] : []),
    ...(n.strip ? ['no intensifier'] : []),
  ]
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'the session unchanged')
}
function useText(u: Use, cx: Cx): string {
  const f = cx.reg.fns.get(keyOf(u.def))
  const args: Record<string, string> = { ...Object.fromEntries(Object.entries(u.args).map(([k, v]) => [k, phrase(v, cx)])), [u.hole]: 'each session' }
  return f && isLib(f.ref.id) ? f.says.replace(/\{(\w+)\}/g, (_, k: string) => args[k] ?? `{${k}}`) : f ? phrase(f.body, { ...cx, params: args }) : u.def.id
}
const outcomeText = (o: NonNullable<Policy['outcome']>) =>
  `${o.demote.direction === 'any' ? 'any change to' : `any ${o.demote.direction} in`} your ${list(o.demote.kinds.map((k) => (k === 'load' ? 'working loads' : k === 'volume' ? 'set counts' : 'other fields')))} is proposed for your OK instead of applied${o.volumeKeep ? ', and set counts are not cut' : ''}`

/** One policy on its own: "In deload weeks: …", "Always: …", "When …: …". */
export function policyText(pol: Policy, cx: Cx): string {
  const role = roleOf(pol.when)
  const head = role ? `In ${role} block weeks` : always(pol.when) ? 'Always' : `When ${finish(d(pol.when, cx))}`
  const parts = [...(pol.plan ? [useText(pol.plan, cx)] : []), ...(pol.outcome ? [outcomeText(pol.outcome)] : [])]
  return `${head}: ${parts.join('; ')}.`
}

/** Every subset (of two or more) of a channel's policies that can hold at
 *  once, stated as ONE result. Two role policies on different roles are the
 *  only provably exclusive pair; anything else may co-fire. */
export function stackingText(p: ProgramDef, cx: Cx): string[] {
  const out: string[] = []
  const exclusive = (a: Policy, b: Policy) => !!roleOf(a.when) && !!roleOf(b.when) && roleOf(a.when) !== roleOf(b.when)
  for (const channel of ['plan', 'outcome'] as const) {
    const pols = p.policies.map((x, i) => [x, i] as const).filter(([x]) => x[channel])
    const combos: (typeof pols)[] = []
    for (let mask = 1; mask < 1 << pols.length; mask++) {
      const c = pols.filter((_, i) => mask & (1 << i))
      if (c.length > 1 && c.every(([a], i) => c.slice(i + 1).every(([b]) => !exclusive(a, b)))) combos.push(c)
    }
    for (const c of combos) {
      const head = `When ${c.filter(([x]) => !always(x.when)).map(([x]) => condText(x, cx)).join(' and ') || 'always'}`
      if (p.hitPolicy === 'first') {
        out.push(`${head}: only the first of these rules applies (rule ${c[0]![1] + 1}).`)
        continue
      }
      if (channel === 'outcome') {
        out.push(`${head}: ${list(c.map(([x]) => outcomeText(x.outcome!)))}.`)
        continue
      }
      const ns = c.map(([x]) => normal(x.plan!, cx))
      out.push(
        ns.every((n): n is XNorm => !!n)
          ? `${head}: the rules stack, so each session is ${normText(compose(ns), cx)}.`
          : `${head}: ${c.map(([x]) => useText(x.plan!, cx)).join(', and then ')}.`,
      )
    }
  }
  return out
}

/** A generated headline for a user program: what it is made of, from its
 *  declarations. Only a library program's own words are shown (D5). */
export function headline(p: ProgramDef): string {
  if (isLib(p.ref.id)) return `${p.says}.`
  const runs: string[] = []
  for (const r of p.calendar.weeks) {
    const prev = runs[runs.length - 1]
    const m = prev && /^(\w+)(?: ×(\d+))?$/.exec(prev)
    if (m && m[1] === r) runs[runs.length - 1] = `${r} ×${Number(m[2] ?? 1) + 1}`
    else runs.push(r)
  }
  const days = Object.keys(p.days)
  const slots = Object.keys(p.slots).length
  return `${days.length} training ${days.length === 1 ? 'day' : 'days'} (${list(days)}) holding ${slots} ${slots === 1 ? 'exercise' : 'exercises'}, over block weeks ${runs.join(', ')}${p.calendar.repeat === 'cycle' ? ', repeating' : ', once'}.`
}
export function macroHeadline(m: MacroDef): string {
  return `${m.phases.length} phases (${m.phases.map((x) => x.label).join(', then ')}), ${m.anchor.k === 'peakOn' ? 'peaking on' : 'starting'} ${dayText(m.anchor.date)}.`
}

export function describeProgram(p: ProgramDef, cx: Cx): string[] {
  const pc = programCx(p, cx)
  const grids = Object.entries(p.grids).map(([m, g]) => `${m === 'load' ? 'loads' : 'distances'} on a ${phrase(g as Term, pc)} grid`)
  const lines = [
    headline(p),
    `  Block weeks: ${p.calendar.weeks.join(', ')}${p.calendar.repeat === 'cycle' ? ', repeating' : ', once'}. ${DECL_DESCRIBERS.drift[p.calendar.drift]}${grids.length ? ` ${sentence(grids.join('; '))}` : ''}`,
    `  Rotation: ${rotText(p.rotation, pc)}.`,
  ]
  const freqs = p.frequency.length ? p.frequency : defaultFrequency(p.rotation)
  lines.push(`  Attendance${p.frequency.length ? '' : ' (from the rotation)'}: ${freqs.map((f, i) => (i ? lower(freqText(f, pc)) : freqText(f, pc))).join('; ')}. If you don't train for ${p.lapseAfterDays} days, attendance stops counting until your next session.`)
  if (p.facts.length) lines.push(`  Reads ${p.facts.map((f) => factLine(cx.reg.vocab.facts[f]!)).join('; ')}.`)
  for (const pol of p.policies) lines.push(`  ${policyText(pol, pc)}`)
  const stack = stackingText(p, pc)
  if (stack.length) lines.push(`  Together (${p.hitPolicy === 'first' ? 'only the first matching rule applies' : 'every matching rule applies, in the order listed'}):`, ...stack.map((x) => `    ${x}`))
  for (const [day, groups] of Object.entries(p.days)) if (groups.some((g) => g.k !== 'single')) lines.push(`  Day ${day}: ${groups.map((g) => groupText(g, pc)).join('; ')}.`)
  for (const [slot, b] of Object.entries(p.slots)) {
    const s = cx.reg.schemes.get(keyOf(b.scheme))
    if (!s) continue
    const args = bindingArgs(p, b, cx)
    if (isLib(s.ref.id)) lines.push(`  ${slot}: ${s.says.replace(/\{(\w+)\}/g, (_, k: string) => args[k] ?? `{${k}}`)}.`)
    else lines.push(`  ${labelled(slot, describe(s.plan, { ...pc, params: args }), '    ')}`)
  }
  for (const [ev, h] of Object.entries(p.aggregate?.on ?? {})) if (h) lines.push(`  ${labelled(`${whenText(ev, p.calendar)} (muscle plan)`, describe(h, pc), '    ')}`)
  for (const [name, e] of Object.entries(p.exports)) lines.push(`  Hands on ${name}: ${pc.peer(e.slot, e.field)} when the program ends.`)
  for (const [param, imp] of Object.entries(p.imports)) lines.push(`  Starts ${param} from the previous run of ${imp.from.id}'s ${imp.export}, if there was one.`)
  return lines
}

export function describeMacroPhases(m: MacroDef, cx: Cx): string[] {
  return m.phases.map((ph) => {
    const prog = cx.reg.programs.get(keyOf(ph.program))!
    const pc = programCx(prog, cx)
    const len =
      ph.length.k === 'bounded'
        ? `${ph.length.min}–${ph.length.max} block weeks, advancing when ${phrase(ph.length.advanceWhen, pc)}${ph.length.atMax === 'propose' ? `; at ${ph.length.max} block weeks it asks you before moving on` : ''}`
        : ph.length.k
    const args = Object.entries(ph.args).map(([k, v]) => `${k} = ${phrase(v, pc)}`)
    return `${ph.label} (${ph.program.id}, ${len})${args.length ? `; handoff: ${args.join('; ')}` : ''}`
  })
}

// ── calendar facts ──────────────────────────────────────────────────────────

/** "Rest today. Your next workout is due Wednesday: …", or, when the search
 *  horizon ran out, only the lower bound it proved. */
export function dueText(due: Due, spec: CalendarSpec, gap: (rule: number) => string, cx: Cx): string {
  if (due.k === 'due') return 'Due today.'
  const f = spec.frequency[due.rule]!
  const why =
    f.k === 'minGap' ? `at least ${gap(due.rule)} between ${selText(f.of, true)}` : f.k === 'atMost' ? `no more than ${f.n} ${selText(f.of, f.n !== 1)} in any ${f.withinDays} days` : ''
  if (due.k === 'notBefore') return `Rest today. Your next ${selText(f.of)} is not before ${dayText(due.day)}: ${why}.`
  return `Rest today. Your next ${selText(f.of)} is due ${dayText(due.dueOn)}: ${why}.`
}

/** "7-day window 2 (Monday 12 October to Sunday 18 October): 2 of 3 workouts (1 missed)." */
export function adherenceText(st: CalendarState, a: Adherence, spec: CalendarSpec): string {
  const x = st.expectations.find((e) => e.key === a.expectation)!
  const r = derivedAdherence(st, a.key)
  const f = spec.frequency[x.rule] as Extract<Frequency, { k: 'atLeast' }>
  const len = dayNum(x.window.through) - dayNum(x.window.from) + 1
  const unit = f.per.k === 'day' ? dayText(x.window.from) : `${len}-day window ${Math.floor((dayNum(x.window.from) - dayNum(spec.anchor)) / len) + 1} (${dayText(x.window.from)} to ${dayText(x.window.through)})`
  if (r.void) return `${unit}: paused or lapsed, so it does not count.`
  const amended = st.amendments.filter((m) => m.adherence === a.key)
  const late = amended.length ? ` ${amended.map((m) => `The workout on ${dayText(m.localDay)} was logged late and now counts.`).join(' ')}` : ''
  return `${unit}: ${r.met} of ${r.expected} ${selText(x.of, true)}${r.missed ? ` (${r.missed} missed)` : ''}.${late}`
}

export { cxOf, sentence, addDays }
