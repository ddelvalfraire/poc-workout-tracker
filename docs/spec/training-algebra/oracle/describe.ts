/**
 * describe.ts — the definition describer over the real Term IR: the term
 * fold. Definitions and declarations render in describe-defs.ts; what the
 * engine produces (issued sessions, transitions, traces via `explain`) in
 * describe-run.ts. English strings stand in for Phrase trees.
 *
 * D1 is enforced here, not promised: DESCRIBERS is typed
 * `{ [K in Term['k']]: … }`, so a former without a describer does not
 * compile. Every noun comes from a declaration: units from their record,
 * metrics, facts and exercises from the registry, state from StateDecl.noun.
 *
 * Scope is never left to the reader's guess:
 *  - a conditional STATEMENT (an if, match or unknown-guard over patches or
 *    sessions) renders as a list, nested by indentation;
 *  - a conditional VALUE renders in parentheses;
 *  - and/or nested in each other say "either … or" / "both … and" in
 *    parentheses; a negated compound says "not both" / "neither … nor";
 *  - a fallback chain renders "whichever is known first: (1) …; (2) …".
 * Only LIBRARY definitions render their templates and bare nouns; a user
 * definition's `named` noun renders with its expansion beside it (D5).
 */
import { weeklyIsOpt, type BoundIR, type Lit, type PatchField, type RefKind, type StepIR, type SuccessRule, type Term } from './algebra'
import { canonicalJson } from './canonical'
import { isLib, type Registry } from './checker'
import type { MetricDecl } from './registry'
import type { Selector } from './time'
import { UNITS, qtyText, shown, trimNumber as trim } from './units'

export type Zoom = 'intent' | 'mechanism'

export interface Cx {
  zoom: Zoom
  reg: Registry
  /** Is the definition being described a library one (its nouns trusted)? */
  lib: boolean
  names: Map<string, string>
  sorts: Map<string, RefKind | null>
  params: Record<string, string>
  nouns: Record<string, string>
  flags: ReadonlySet<string>
  peer: (slot: string, field: string) => string
  programNouns: Record<string, string>
  /** The slot's declared verdict success rule (C1), for verdict reads that
   *  do not carry their own. */
  slotSuccess?: SuccessRule
  /** The program's calendar-aligned adherence week start (C3), for the
   *  frequency prose; absent under the anchor-tumbling default. */
  alignedWeeks?: string
  /** The enclosing definition's DEFAULTED params (C10): a range over them
   *  compacts like the literal it replaced (Y11); other param ranges keep
   *  their spelled-out form. */
  defaulted?: ReadonlySet<string>
}

export function cxOf(reg: Registry, over: Partial<Cx> = {}): Cx {
  return {
    zoom: 'intent',
    reg,
    lib: false,
    names: new Map(),
    sorts: new Map(),
    params: {},
    nouns: {},
    flags: new Set(),
    peer: (slot, field) => `the ${slot} slot's ${field}`,
    programNouns: {},
    ...over,
  }
}

// ── leaves ──────────────────────────────────────────────────────────────────

export function litText(l: Lit, cx: Cx): string {
  switch (l.k) {
    case 'q':
      return l.notation === 'rpe' ? `RPE ${trim(10 - l.v)}` : qtyText(shown(l.v, l.unit, l.per), l.unit, l.per)
    case 'bool':
      return l.v ? 'yes' : 'no'
    case 'ord':
      return `${l.scale} ${l.level}`
    case 'enum':
      return `“${l.tag}”`
    case 'ref':
      return l.kind === 'exercise' ? (cx.reg.vocab.exercises[l.id]?.label ?? `‹unknown exercise ${l.id}›`) : l.id
  }
}
const shownOf = (l: Lit) => (l.k === 'q' ? shown(l.v, l.unit, l.per) : NaN)

const KIND_NOUN: Record<RefKind, string> = { slot: 'exercise', exercise: 'exercise', muscle: 'muscle', day: 'day' }

/** A selector as a noun phrase, singular or plural. */
export function selText(s: Selector, plural = false): string {
  const p = (w: string) => (plural ? `${w}s` : w)
  switch (s.s) {
    case 'any':
      return p('workout')
    case 'slot':
      return p(`${s.slot} session`)
    case 'day':
      return p(`Day ${s.day} session`)
    case 'muscle':
      return `${p(`${s.muscles.length > 1 ? s.muscles.slice(0, -1).join(', ') + ' or ' + s.muscles[s.muscles.length - 1] : s.muscles[0]} session`)}`
    case 'tag':
      return p(`${s.tag} session`)
  }
}

// ── absence fallbacks: stated once per sentence ─────────────────────────────

const FB = ['\u0001', '\u0002'] as const
const CLOCK = ['\u0003', '\u0004'] as const
const fallback = (v: string) => `${FB[0]}${v}${FB[1]}`
const clockNote = (v: string) => `${CLOCK[0]}${v}${CLOCK[1]}`
const tokens = (open: string, close: string) => new RegExp(`${open}([^${close}]*)${close}`, 'g')
export function finish(s: string): string {
  const counts = new Map<string, number>()
  for (const m of s.matchAll(tokens(...FB))) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1)
  const clocks = new Set([...s.matchAll(tokens(...CLOCK))].map((m) => m[1]!))
  let out = s.replace(tokens(...FB), (_, v: string) => ((counts.get(v) ?? 0) > 1 ? '' : ` (${v} if unknown)`)).replace(tokens(...CLOCK), '')
  for (const [v, n] of counts) if (n > 1) out += ` (anything unknown counts as ${v})`
  for (const c of clocks) out += ` (slashed values step ${c})`
  return out
}
export const upper = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`
export const sentence = (s: string) => {
  const t = finish(s)
  return `${upper(t)}${/[.!?:]$/.test(t) ? '' : '.'}`
}
/** Indent every continuation line of a multi-line rendering. */
export const pad = (s: string, by: string) => s.replace(/\n/g, `\n${by}`)

// ── statements: conditionals over patches and sessions render as lists ─────

/** Statement-sorted, read off the syntax: what renders as a list. */
function isStmt(t: Term, cx: Cx): boolean {
  switch (t.k) {
    case 'patch':
    case 'session':
    case 'xform':
      return true
    case 'if':
      return isStmt(t.a, cx)
    case 'match':
      return Object.values(t.cases).some((c) => isStmt(c, cx))
    case 'known':
    case 'let':
      return isStmt(t.body, cx)
    case 'orElse':
      return isStmt(t.a, cx)
    case 'named':
      return isStmt(t.e, cx)
    case 'nth':
      return t.xs.k === 'list' && t.xs.of.t === 'dom'
    case 'app':
      return cx.reg.fns.get(`${t.def.id}@${t.def.version}`)?.result.t === 'dom'
    default:
      return false
  }
}
/** A list of arms, one per line; a nested list indents under its arm. */
function block(arms: [string, string][]): string {
  return arms.map(([h, b]) => `\n- ${h}:${b.startsWith('\n') ? pad(b, '  ') : ` ${b}`}`).join('')
}
const isVerdict = (t: Term) => t.k === 'event' && t.q.q === 'verdict'
/** The declared success rule's phrase (C1); empty for the allSets default,
 *  stated when a READ spells 'allSets' to override a slot rule (Y8). */
export const successText = (su: SuccessRule | 'allSets' | undefined): string =>
  su === undefined ? '' : su === 'allSets' ? ' (every set at its own bar)' : su === 'totalReps' ? ' (counting total reps across all sets)' : ` (at least ${su.atLeastSets} sets must fully hit)`
function verdictArms(on: Term, cx: Cx): Record<string, string> {
  const q = on.k === 'event' && on.q.q === 'verdict' ? on.q : null
  const what = !q || q.steps === 'working' ? 'working set' : `set of ${q.steps.map((s) => `“${s}”`).join(' and ')}`
  // An explicit 'allSets' on the read overrides the slot rule back to the
  // per-set arms (Y8).
  const su0 = q?.success ?? (q ? cx.slotSuccess : undefined)
  const su = su0 === 'allSets' ? undefined : su0
  const edge = q?.bound === 'top' ? 'the top of its range' : 'its target'
  if (su === 'totalReps')
    return {
      hit: `the ${what}s totalled their target reps (and every other bound was met)`,
      missed: `the total reps fell short with every set logged, or a set missed another bound`,
      unknown: 'nothing decided it: something went unlogged',
    }
  if (su && typeof su === 'object')
    return {
      hit: `at least ${su.atLeastSets} ${what}s fully reached ${edge}`,
      missed: `too few ${what}s could still reach it`,
      unknown: 'nothing decided it: something went unlogged',
    }
  return {
    hit: `every ${what} reached ${edge}`,
    missed: `a ${what} fell short`,
    unknown: 'nothing fell short but something went unlogged',
  }
}

// ── the fold ────────────────────────────────────────────────────────────────

function elemKind(t: Term, cx: Cx): RefKind | null {
  switch (t.k) {
    case 'keys':
      return t.of === 'slots' ? 'slot' : t.of === 'muscles' ? 'muscle' : null
    case 'agg':
      return t.q.q === 'slotsFor' ? 'slot' : null
    case 'list':
      return t.of.t === 'ref' ? t.of.kind : null
    case 'var':
      return cx.sorts.get(t.name) ?? null
    default:
      return null
  }
}
const nounOf = (k: RefKind | null) => (k ? KIND_NOUN[k] : 'item')

export function d(t: Term, cx: Cx): string {
  return (DESCRIBERS[t.k] as (n: Term, c: Cx) => string)(t, cx)
}
/** An operand: compound arithmetic and conditional values in parentheses. */
const op = (t: Term, cx: Cx) => (t.k === 'arith' || (t.k === 'orElse' && t.b.k !== 'lit') ? `(${d(t, cx)})` : d(t, cx))
const bindName = (cx: Cx, v: string, phrase: string, kind: RefKind | null = null): Cx => ({
  ...cx,
  names: new Map([...cx.names, [v, phrase]]),
  sorts: new Map([...cx.sorts, [v, kind]]),
})
const isLitPct = (t: Term) => t.k === 'lit' && t.lit.k === 'q' && t.lit.unit === 'pct'
const metric = (cx: Cx, m: string): MetricDecl | undefined => cx.reg.vocab.metrics[m]
const mNoun = (cx: Cx, m: string) => metric(cx, m)?.noun ?? m

const CLOCK_NOUN = { week: 'block week', trainWeek: 'training week' } as const
/** A positional table on the progress clock as slashed values: "65/70/75%". */
function positional(t: Extract<Term, { k: 'table' }>, cx: Cx): { compact: string; clock: string } {
  const field = t.key.k === 'pos' && (t.key.field === 'week' || t.key.field === 'trainWeek') ? t.key.field : 'week'
  const clock = clockNote(`by ${CLOCK_NOUN[field]}, ${t.overflow === 'cycle' ? 'repeating' : 'then holding the last'}`)
  const lits = t.rows.map((r) => (r.then.k === 'lit' && r.then.lit.k === 'q' && !r.then.lit.per ? r.then.lit : null))
  const unit = lits[0]?.unit
  if (unit && lits.every((l) => l && l.unit === unit) && UNITS[unit].symbol !== '' && unit !== 'min' && unit !== 'minPerKm' && unit !== 'minPerMi')
    return { compact: `${lits.map((l) => trim(shownOf(l!))).join('/')}${UNITS[unit].symbol}`, clock }
  return { compact: t.rows.map((r) => d(r.then, cx)).join(' / '), clock }
}

/** `known(x, v => v × p%)`: a percentage of x, when x is known. */
function pctOf(t: Term, cx: Cx): { base: string; n: number } | null {
  if (t.k !== 'known' || t.body.k !== 'arith' || t.body.op !== '*' || t.body.a.k !== 'var' || t.body.a.name !== t.as) return null
  const b = t.body.b
  return b.k === 'lit' && b.lit.k === 'q' && b.lit.unit === 'pct' ? { base: d(t.a, cx), n: shownOf(b.lit) } : null
}

/** A bound as prose: "8–12 reps", "at least 5 reps", "85–89% of your threshold". */
function boundText(m: string, b: BoundIR, cx: Cx): string {
  const decl = metric(cx, m)
  const lead = decl?.lead ? `${decl.lead} ` : ''
  switch (b.b) {
    case 'exact':
      return `${lead}${d(b.v, cx)}`
    case 'range': {
      const [a, z] = [b.min, b.max]
      const [pa, pz] = [pctOf(a, cx), pctOf(z, cx)]
      if (pa && pz && pa.base === pz.base) return `${lead}${trim(pa.n)}–${trim(pz.n)}% of ${pa.base}`
      const same = a.k === 'lit' && z.k === 'lit' && a.lit.k === 'q' && z.lit.k === 'q' && a.lit.unit === z.lit.unit && !a.lit.per
      if (same) return `${lead}${trim(shownOf((a as Extract<Term, { k: 'lit' }>).lit))}–${litText((z as Extract<Term, { k: 'lit' }>).lit, cx)}`
      // A range whose edges are literals THROUGH a DEFAULTED parameter (a
      // promoted C10 constant) compacts the same way (Y11): "8–12 reps",
      // exactly as the pre-promotion literal spelled it. A non-defaulted
      // param range keeps its spelled-out form, as it always had.
      const viaDefault = (x: Term) => x.k === 'lit' || (x.k === 'param' && !!cx.defaulted?.has(x.name))
      if (viaDefault(a) && viaDefault(z)) {
        const [ra, rz] = [d(a, cx), d(z, cx)]
        const m = /^(\d+(?:\.\d+)?) (.+)$/.exec(ra)
        const n = /^(\d+(?:\.\d+)?) (.+)$/.exec(rz)
        if (m && n && m[2] === n[2]) return `${lead}${m[1]}–${rz}`
      }
      return `${lead}${d(a, cx)} to ${d(z, cx)}`
    }
    case 'atLeast':
      return m === 'reps' ? `as many reps as possible (at least ${d(b.v, cx)})` : `${decl?.lead === 'at' ? `${decl.noun} ` : lead}at least ${d(b.v, cx)}`
    case 'atMost':
      return `${decl?.lead === 'at' ? `${decl.noun} ` : lead}at most ${d(b.v, cx)}`
    case 'open':
      return decl?.open ?? `${m} recorded`
  }
}

const ROLE: Record<string, string> = { warmup: 'warm-up ', backoff: 'back-off ', test: 'test ', recovery: 'recovery ', working: '', amrap: '' }
function stepText(s: Extract<StepIR, { k: 'step' }>, cx: Cx): string {
  const target = d(s.target, cx)
  const c = s.count
  const one = c.k === 'n' && c.n.k === 'lit' && c.n.lit.k === 'q' && c.n.lit.v === 1
  const counted = s.target.k === 'set' && 'reps' in s.target.target
  if (c.k === 'n') return one && !counted ? target : `${d(c.n, cx)} of ${target}`
  if (c.k === 'range') return `${d(c.min, cx)} to ${d(c.max, cx)} (your choice) of ${target}`
  if (c.k === 'until') return `sets until ${d(c.stop, cx)} (at most ${c.max}) of ${target}`
  return `while ${d(c.go, cx)}, up to ${c.max} more sets of ${target}`
}

const EVENT: { [Q in Extract<Term, { k: 'event' }>['q']['q']]: (q: Extract<Extract<Term, { k: 'event' }>['q'], { q: Q }>, cx: Cx) => string } = {
  verdict: (q, cx) => `how ${q.steps === 'working' ? 'the working sets' : q.steps.map((s) => `“${s}”`).join(' and ')} went${successText(q.success ?? cx.slotSuccess)}`,
  metric: (q, cx) =>
    q.pick === 'count'
      ? `how many sets you logged on “${q.step}”`
      : q.pick === 'sum'
        ? `the total ${mNoun(cx, q.metric)} you logged on “${q.step}”`
        : `the ${q.pick === 'last' ? '' : `${q.pick} `}${mNoun(cx, q.metric)} you logged on “${q.step}”`,
  e1rm: (q) => `the max estimated from “${q.step}”${q.formula && q.formula !== 'epley' ? ` (${q.formula.charAt(0).toUpperCase()}${q.formula.slice(1)})` : ''}`,
  prescribed: (q, cx) => `the ${q.edge === 'top' ? 'top of the ' : ''}${mNoun(cx, q.metric)} prescribed for “${q.step}”`,
  stages: (q) => (q.pick === 'count' ? `how many mini-sets you did on “${q.step}”` : q.pick === 'sum' ? `the reps across every mini-set of “${q.step}”` : `the reps on the last mini-set of “${q.step}”`),
  trained: (q, cx) => `this session trained ${d(q.muscle, cx)}`,
  week: () => 'the block week just closed',
  groupScore: (q) => (q.score === 'time' ? 'your time for the whole group' : 'the rounds you completed'),
}

/** Each field says how it lands: commits first, then what is proposed. */
function patchText(set: Record<string, PatchField>, cx: Cx): string {
  const one = ([f, { to: v }]: [string, PatchField]) => {
    const noun = cx.nouns[f] ?? f
    if (v.k === 'arith' && (v.op === '+' || v.op === '-') && v.a.k === 'self' && v.a.field === f) return finish(`${v.op === '+' ? 'raise' : 'lower'} ${noun} by ${d(v.b, cx)}`)
    if (cx.flags.has(f)) return v.k === 'lit' && v.lit.k === 'bool' ? `${v.lit.v ? 'note that' : 'reset the note that'} ${noun}` : finish(`note whether ${noun}: ${d(v, cx)}`)
    return finish(`set ${noun} to ${d(v, cx)}`)
  }
  const fields = Object.entries(set)
  if (!fields.length) return 'leave everything as is'
  const commits = fields.filter(([, f]) => f.mode === 'commit').map(one)
  const asks = fields.filter(([, f]) => f.mode === 'propose').map(one)
  return [...commits, ...(asks.length ? [`${commits.length ? 'and ' : ''}propose, for your OK: ${asks.join('; ')}`] : [])].join('; ')
}

export function calText(q: Extract<Term, { k: 'cal' }>['q'], cx: Cx): string {
  switch (q.q) {
    case 'day':
      return 'the days since you started the program'
    case 'earlierToday':
      return 'how many sessions of this program you already did today'
    case 'gap':
      return `the days since your last ${selText(q.of)}`
    case 'recent':
      return q.measure.m === 'count'
        ? `how many ${selText(q.of, true)} you did in the last ${q.days} days`
        : q.measure.m === 'sum'
          ? `your total ${mNoun(cx, q.measure.metric)} over ${selText(q.of, true)} in the last ${q.days} days`
          : `your ${metric(cx, q.measure.metric)?.better === 'lower' ? 'best' : 'longest'} ${mNoun(cx, q.measure.metric)} in a ${selText(q.of)} over the last ${q.days} days`
  }
}

/** A chain of fallbacks, flattened: orElse(orElse(a, b), c) and orElse(a, orElse(b, c)) mean the same. */
const chain = (t: Term): Term[] => (t.k === 'orElse' && t.b.k !== 'lit' ? [...chain(t.a), ...chain(t.b)] : [t])
const logicChild = (parent: 'and' | 'or', x: Term, cx: Cx) =>
  x.k === 'logic' && x.op !== parent ? `(${x.op === 'or' ? 'either' : 'both'} ${d(x, cx)})` : d(x, cx)

export const DESCRIBERS: { [K in Term['k']]: (n: Extract<Term, { k: K }>, cx: Cx) => string } = {
  lit: (t, cx) => litText(t.lit, cx),
  var: (t, cx) => cx.names.get(t.name) ?? t.name,
  let: (t, cx) => {
    const body = d(t.body, bindName(cx, t.name, t.label))
    return `${sentence(`${t.label} is ${d(t.value, cx)}`)}${body.startsWith('\n') ? ` Then:${body}` : ` ${upper(body)}`}`
  },
  named: (t, cx) => (cx.lib ? (cx.zoom === 'intent' ? t.noun : `${t.noun} [= ${d(t.e, cx)}]`) : `${t.noun} [${d(t.e, cx)}]`),
  if: (t, cx) => {
    if (!isStmt(t, cx)) return `(if ${d(t.c, cx)}: ${d(t.a, cx)}; otherwise: ${d(t.b, cx)})`
    const arms: [string, string][] = [[`if ${finish(d(t.c, cx))}`, d(t.a, cx)]]
    let rest = t.b
    while (rest.k === 'if') {
      arms.push([`otherwise, if ${finish(d(rest.c, cx))}`, d(rest.a, cx)])
      rest = rest.b
    }
    return block([...arms, ['otherwise', d(rest, cx)]])
  },
  match: (t, cx) => {
    const verdict = isVerdict(t.on)
    const head = verdict ? verdictArms(t.on, cx) : null
    const arms = Object.entries(t.cases).map(([k, v]): [string, string] => [head ? `if ${head[k] ?? k}` : `if ${d(t.on, cx)} is “${k}”`, d(v, cx)])
    if (isStmt(t, cx)) return block(arms)
    return `(${arms.map(([h, v]) => `${h}: ${v}`).join('; ')})`
  },
  arith: (t, cx) => {
    if (t.op === '*' && t.b.k === 'lit' && t.b.lit.k === 'q' && t.b.lit.unit === 'x' && t.b.lit.v === -1) return `minus ${op(t.a, cx)}`
    if (t.op === '*' && isLitPct(t.b)) return `${d(t.b, cx)} of ${op(t.a, cx)}`
    if (t.op === '*' && t.b.k === 'table' && t.b.rows.every((r) => r.when === null)) {
      const s = positional(t.b, cx)
      return `${s.compact} of ${op(t.a, cx)}${s.clock}`
    }
    if (t.op === '*') {
      const b = d(t.b, cx)
      return /^\d+(\.\d+)?%$/.test(b) ? `${b} of ${op(t.a, cx)}` : `${op(t.a, cx)} × ${op(t.b, cx)}`
    }
    if (t.op === '-') return `${op(t.a, cx)} minus ${op(t.b, cx)}`
    if (t.op === '+') return `${op(t.a, cx)} plus ${op(t.b, cx)}`
    if (t.op === 'max' && t.a.k === 'lit') return `${op(t.b, cx)}, never below ${d(t.a, cx)}`
    if (t.op === 'max') return `the greater of ${op(t.a, cx)} and ${op(t.b, cx)}`
    return `${op(t.a, cx)}, capped at ${op(t.b, cx)}`
  },
  ratio: (t, cx) => `${op(t.a, cx)} as a fraction of ${op(t.b, cx)}`,
  cmp: (t, cx) => {
    if (t.a.k === 'pos' && t.a.field === 'role' && t.b.k === 'lit' && t.b.lit.k === 'enum') return `this is a ${t.b.lit.tag} week`
    if (t.a.k === 'fact' && t.b.k === 'lit' && t.b.lit.k === 'enum') return `${d(t.a, cx)} is ${t.b.lit.tag}`
    const word = { '<': 'is below', '<=': 'is at most', '==': 'is', '>=': 'is at least', '>': 'is above' }[t.op]
    return `${d(t.a, cx)} ${word} ${d(t.b, cx)}`
  },
  logic: (t, cx) => `${logicChild(t.op, t.a, cx)} ${t.op} ${logicChild(t.op, t.b, cx)}`,
  not: (t, cx) =>
    t.a.k === 'logic'
      ? t.a.op === 'or'
        ? `neither ${logicChild('or', t.a.a, cx)} nor ${logicChild('or', t.a.b, cx)}`
        : `not both ${logicChild('and', t.a.a, cx)} and ${logicChild('and', t.a.b, cx)}`
      : t.a.k === 'cmp'
        ? `not (${d(t.a, cx)})`
        : `not ${d(t.a, cx)}`,
  round: (t, cx) => `${d(t.a, cx)}, rounded ${t.mode === 'nearest' ? 'to the nearest' : t.mode} ${d(t.step, cx)}`,
  some: (t, cx) => d(t.a, cx),
  none: () => 'nothing',
  known: (t, cx) => d(t.body, bindName(cx, t.as, d(t.a, cx))),
  orElse: (t, cx) => {
    if (t.b.k === 'lit') return `${d(t.a, cx)}${fallback(d(t.b, cx))}`
    if (isStmt(t, cx)) {
      const subject = t.a.k === 'known' ? d(t.a.a, cx) : 'anything this reads'
      return block([[`if ${subject} is unknown`, d(t.b, cx)], ['otherwise', d(t.a, cx)]])
    }
    return `whichever is known first: ${chain(t).map((x, i) => `(${i + 1}) ${d(x, cx)}`).join('; ')}`
  },
  asReps: (t, cx) => `${d(t.a, cx)} (counted as reps)`,
  list: (t, cx) => t.items.map((x) => d(x, cx)).join(', then '),
  nth: (t, cx) =>
    t.xs.k === 'list' && t.xs.of.t === 'dom'
      ? `the entry at position ${d(t.i, cx)} (from 0, ${t.overflow === 'hold' ? 'holding at the last' : 'cycling'}) of: ${t.xs.items.map((x, i) => `#${i} ${d(x, cx)}`).join('; ')}`
      : `the ${nounOf(elemKind(t.xs, cx))} at position ${d(t.i, cx)} (from 0) of [${d(t.xs, cx)}] (${t.overflow === 'hold' ? 'holding at the last' : 'cycling'})`,
  fold: (t, cx) => {
    const k = elemKind(t.xs, cx)
    const acc = t.init.k === 'self' ? `the ${cx.nouns[t.init.field] ?? t.init.field} so far` : 'the running result'
    const inner = bindName(bindName(cx, t.acc, acc), t.x, `the ${nounOf(k)}`, k)
    return `starting from ${d(t.init, cx)}, for each ${nounOf(k)} in turn: ${d(t.step, inner)}`
  },
  tabulate: (t, cx) => {
    if (t.keys.k === 'range') return `for i = 0 … ${t.keys.n - 1}: ${d(t.body, bindName(cx, t.as, 'i'))}`
    const k = elemKind(t.keys, cx)
    return `for each ${nounOf(k)}, ${d(t.body, bindName(cx, t.as, `that ${nounOf(k)}`, k))}`
  },
  at: (t, cx) => `${d(t.m, cx)} for ${d(t.key, cx)}`,
  keys: (t) => (t.of === 'muscles' ? 'every muscle' : t.of === 'slots' ? 'every exercise' : `every ${t.of.slice(5)}`),
  range: (t) => `0 … ${t.n - 1}`,
  sum: (t, cx) => {
    const k = elemKind(t.xs, cx)
    return `the total over ${d(t.xs, cx)} of ${d(t.body, bindName(cx, t.as, `that ${nounOf(k)}`, k))}`
  },
  count: (t, cx) => {
    const k = elemKind(t.xs, cx)
    return `how many of ${d(t.xs, cx)} satisfy: ${d(t.where, bindName(cx, t.as, `the ${nounOf(k)}`, k))}`
  },
  pick: (t, cx) => {
    const k = elemKind(t.xs, cx)
    const inner = bindName(cx, t.as, `the ${nounOf(k)}`, k)
    return `the ${nounOf(k)} among ${d(t.xs, cx)}${t.where ? ` where ${d(t.where, inner)}` : ''} with the ${t.mode === 'max' ? 'highest' : 'lowest'} ${d(t.score, inner)}`
  },
  allocate: (t, cx) => {
    const k = elemKind(t.among, cx) ?? 'slot'
    const inner = bindName(cx, t.as, `that ${nounOf(k)}`, k)
    return `hand out ${d(t.n, cx)}, one set at a time and at most ${t.max} in all, each to whichever of ${d(t.among, cx)} ranks highest by ${d(t.score, inner)}, at most ${d(t.cap, inner)} extra per ${nounOf(k)}`
  },
  table: (t, cx) => {
    const key = d(t.key, cx)
    if (t.rows.every((r) => r.when === null)) {
      const s = positional(t, cx)
      return `${s.compact}${s.clock}`
    }
    const rows = t.rows.map((r) => {
      const w = r.when
      const head = w === null ? '' : typeof w === 'object' ? `up to ${litText(w, cx)}` : String(w)
      return `${head} → ${d(r.then, cx)}`
    })
    const rest = t.otherwise ? `; ${t.rows.some((r) => typeof r.when === 'object' && r.when) ? 'more' : 'any other'} → ${d(t.otherwise, cx)}` : ''
    return `(by ${key}: ${rows.join('; ')}${rest})`
  },
  app: (t, cx) => {
    const f = cx.reg.fns.get(`${t.def.id}@${t.def.version}`)
    if (!f) return `‹unpublished ${t.def.id}›`
    const args = Object.fromEntries(Object.entries(t.args).map(([k, v]) => [k, d(v, cx)]))
    // A defaulted parameter the call omits reads as its default (C10).
    for (const [k, dt] of Object.entries(f.defaults ?? {})) if (!(k in args)) args[k] = d(dt, cx)
    const lib = isLib(t.def.id)
    const body = () => d(f.body, { ...cx, zoom: 'intent', lib, params: args, names: new Map(cx.names), defaulted: new Set(Object.keys(f.defaults ?? {})) })
    // D5: a user definition's template does not render; its mechanism does.
    if (!lib) return body()
    const filled = fillTemplate(f.says, args, overrideKeys(f.says, f.defaults ?? {}, t.args), f.labels ?? {})
    return cx.zoom === 'intent' ? filled : `${filled} [= ${body()}]`
  },
  param: (t, cx) => cx.params[t.name] ?? `{${t.name}}`,
  self: (t, cx) => (cx.flags.has(t.field) ? (cx.nouns[t.field] ?? t.field) : `your ${cx.nouns[t.field] ?? t.field}`),
  peer: (t, cx) => (t.of === 'prevPhase' ? `${cx.peer(t.slot, t.field)} at the end of the previous phase` : cx.peer(t.slot, t.field)),
  program: (t, cx) => (cx.programNouns[t.field] ? `the ${cx.programNouns[t.field]} the program keeps for this exercise` : `the program's ${t.field}`),
  fact: (t, cx) => `${cx.reg.vocab.facts[t.fact]?.noun ?? t.fact}${t.key ? ` for ${d(t.key, cx)}` : ''}`,
  pos: (t) => ({ week: 'the block week', trainWeek: 'the training week', role: "this block week's role", slotSession: 'the sessions of this exercise done so far' })[t.field],
  cal: (t, cx) => calText(t.q, cx),
  performed: (t, cx) =>
    t.pick === 'count'
      ? `the sets logged so far on “${t.step}”`
      : t.pick === 'sum'
        ? `the ${mNoun(cx, t.metric)} so far on “${t.step}”`
        : `the ${t.pick === 'last' ? '' : `${t.pick} `}${mNoun(cx, t.metric)} you actually did on “${t.step}”`,
  prescribed: (t, cx) => `the ${t.edge === 'top' ? 'top of the ' : ''}${mNoun(cx, t.metric)} prescribed for “${t.step}”`,
  event: (t, cx) => (EVENT[t.q.q] as (q: typeof t.q, c: Cx) => string)(t.q, cx),
  agg: (t, cx) => {
    const q = t.q
    if (q.q === 'slotsFor') return `the exercises that train ${d(q.muscle, cx)} directly`
    if (!weeklyIsOpt(q)) {
      if (q.by.k === 'tag') return `the weekly ${mNoun(cx, q.metric)} planned for ${q.by.tag} sessions`
      return q.by.k === 'muscle' ? `the sets ${d(q.by.of, cx)} already gets each week` : `the sets planned for ${d(q.by.of, cx)}`
    }
    // Honest prose (D1, D2): both bases re-plan under TODAY'S state ("now
    // planned"), so the closing read never claims to be what the week got,
    // and the upcoming read never claims to see a pending boundary bump.
    const when = q.basis === 'upcoming' ? 'in the coming week' : 'in the week just closing'
    const what =
      q.by.k === 'tag'
        ? `the ${mNoun(cx, q.metric)} now planned for ${q.by.tag} sessions ${when}`
        : q.by.k === 'muscle'
          ? `the sets ${d(q.by.of, cx)} is now planned to get ${when}`
          : `the sets now planned for ${d(q.by.of, cx)} ${when}`
    return Array.isArray(q.roles) ? `${what}, ${q.roles.join(' and ')} weeks only` : what
  },
  set: (t, cx) => {
    const parts = Object.entries(t.target).map(([m, b]) => boundText(m, b, cx))
    if (t.cluster) parts.push(`in clusters of ${d(t.cluster.per, cx)} with ${d(t.cluster.intraRest, cx)} between`)
    if (t.rest) parts.push(`resting ${d(t.rest, cx)}`)
    if (t.tempo) parts.push(`at tempo ${d(t.tempo, cx)}`)
    // A rep target leads ("5 reps at 100 kg"); timed and cardio targets list ("20 min, pace at most …").
    return `${ROLE[t.role] ?? ''}${parts.join('reps' in t.target ? ' ' : ', ')}`
  },
  session: (t, cx) => {
    const steps = t.steps.map((s) => (s.k === 'step' ? stepText(s, cx) : `${s.n} times: (${s.body.map((b) => stepText(b, cx)).join(', then ')})`))
    return `${d(t.exercise, cx)}: ${steps.join('; ')}${t.intensifier ? `; finish with ${d(t.intensifier, cx)}` : ''}`
  },
  xform: (t, cx) => {
    const s = d(t.s, cx)
    const a = t.arg ? d(t.arg, cx) : ''
    return {
      scaleMetric: `${s}, at ${a} of the ${t.metric ? mNoun(cx, t.metric) : 'target'}`,
      scaleSets: `${s}, with ${a} of the sets${t.allowZero ? ' (a line may drop to no sets)' : ''}`,
      capEffort: `${s}, keeping at least ${a}`,
      setTempo: `${s}, at tempo ${a}`,
      reshape: `${s}, reshaped to ${a}`,
      stripIntensifier: `${s}, without its intensifier`,
      swapExercise: `${s}, swapped to ${a}`,
      addSets: `${s}, plus ${a} on the last working step`,
    }[t.op]
  },
  technique: (t, cx) => `a ${t.kind} (${t.stages.map((s) => d(s, cx)).join(', then ')})`,
  tempo: (t) => `${t.ecc}-${t.pause}-${t.con}-${t.top}`,
  patch: (t, cx) => patchText(t.set, cx),
}

/** A term as a phrase to embed (a template hole, an argument). */
export function phrase(t: Term, cx: Cx): string {
  return finish(d(t, cx))
}

/** Fill a library template's holes and append the non-default arguments for
 *  hole-less defaulted params, so a declared override is never mute (C10).
 *  The append names each param by its declared display LABEL (Y11), never
 *  the internal identifier. */
export function fillTemplate(says: string, args: Record<string, string>, overrides: readonly string[], labels: Record<string, string> = {}): string {
  const filled = says.replace(/\{(\w+)\}/g, (_, k: string) => args[k] ?? `{${k}}`)
  return overrides.length ? `${filled} (with ${overrides.map((k) => `${labels[k] ?? k} = ${args[k]}`).join(', ')})` : filled
}
/** The defaulted, hole-less params a call overrides with a NON-default term;
 *  an argument spelling the default renders nothing, one prose form. */
export function overrideKeys(says: string, defaults: Record<string, Term>, args: Record<string, Term>): string[] {
  const holes = new Set([...says.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))
  return Object.keys(defaults).filter((k) => !holes.has(k) && k in args && canonicalJson(args[k]) !== canonicalJson(defaults[k]))
}

/** A whole term as finished prose. A conditional statement is a list: each
 *  arm is its own sentence, so a fallback is stated on the arm it belongs to. */
export function describe(t: Term, cx: Cx): string {
  const main = d(t, cx)
  if (!main.includes('\n')) return sentence(main)
  const [head, ...lines] = main.split('\n')
  const arms = lines.map((l) => {
    const m = /^(\s*- [^:]*:)\s?(.*)$/.exec(l)
    return m ? (m[2] ? `${m[1]} ${sentence(m[2])}` : m[1]!) : l
  })
  return [head!.trim() ? sentence(head!) : '', ...arms].join('\n')
}
