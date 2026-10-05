/**
 * differential.ts — prose against evaluation, over the whole worked corpus.
 * Three checks, each a number-by-number comparison:
 *
 *  A. Definition prose vs the trace. Every literal the EVALUATOR reads while
 *     running a program (outside a library body, whose template is its prose)
 *     must show its number in that program's description; and every number
 *     the description prints must come from the definition (a literal, or a
 *     literal structural field), never be invented.
 *  B. Issued prose vs the issued fact. Every number a prescription's prose
 *     prints is a count, bound, rest, tempo or cluster of that fact, and every
 *     one of those appears.
 *  C. Composed policy prose vs the evaluator. Where the description states
 *     what co-firing transformers do TOGETHER, applying them in order through
 *     the evaluator must give exactly that, for every set count 1–12.
 */
import type { Lit, Term } from './algebra'
import { isLib, keyOf } from './checker'
import { cxOf, describe, litText } from './describe'
import { bindingArgs, compose, describeProgram, describeSlot, normal, programCx as describeCtx, stackingText } from './describe-defs'
import { numText, sessionText, valueText } from './describe-run'
import type { Fired, IssuedSession, SessionValue, Trace, Value } from './engine'
import * as ER from './endurance-rehab'
import { ctxOf, evaluate, nodesOf } from './evaluate'
import { applyUse } from './issue'
import * as P from './programs'
import { project, projectMacro } from './project'
import type { ProgramDef } from './structure'
import { effectiveFrequency, periodDays } from './time'
import { D0, assert, corpusFacts, day, eq, q, readings, reg, start, suite } from './testkit'

const { t, done } = suite('differential')
const cx = cxOf(reg)
const tokens = (s: string): string[] => [...s.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w])/g)].map((m) => String(Number(m[0])))

// ── the corpus run, traces kept ─────────────────────────────────────────────

interface Ran {
  def: ProgramDef
  issued: IssuedSession[]
  traces: Trace[]
  fired: Fired[]
}
const paramsOf = (def: ProgramDef): Record<string, Value> =>
  Object.fromEntries(Object.entries(def.params).map(([k, ty]) => [k, ty.t === 'opt' ? ({ v: 'none', cause: { k: 'declaredNone' } } as Value) : q(0, 'x')]))
const WEEKS: Record<string, number> = { 'prog/531-bbb': 5, 'prog/rp-upper-meso': 5, 'prog/upper-hypertrophy-dc': 5, 'prog/hr-tempo-block': 4 }
const post = readings({ formQuality: { v: 'ord', scale: 'formQuality', level: 2 }, pain: { v: 'ord', scale: 'pain', level: 1 }, borg: { v: 'ord', scale: 'borg', level: 13 } })
const RUNS: Ran[] = [...reg.programs.values()].map((def) => {
  const r = start(def, paramsOf(def), corpusFacts())
  const p = project(r.rt, r.ledger, WEEKS[def.ref.id] ?? 2, { k: 'asPrescribed' }, corpusFacts(), D0, 400, post)
  const issued = p.weeks.flatMap((w) => w.sessions)
  // The binding arguments are evaluated at every prescribe (ports.slotParams): their traces count as read.
  const bindCx = ctxOf(reg, { params: r.ledger.head.params, ports: { peer: () => ({ v: 'none', cause: { k: 'declaredNone' } }) } })
  const bindings = Object.values(def.slots).flatMap((b) => Object.values(b.args).map((x) => evaluate(x, bindCx)))
  const traces = [...bindings, ...issued.flatMap((i) => i.slots.map((s) => s.trace)), ...p.ledger.transitions.flatMap((tr) => tr.fired.flatMap((f) => (f.reason ? [f.reason] : [])))]
  return { def, issued, traces, fired: p.ledger.transitions.flatMap((tr) => tr.fired) }
})
for (const m of [P.optMacro, ER.achillesReturn]) for (const ph of projectMacro(reg, m, { k: 'asPrescribed' }, corpusFacts(m.anchor.date), 30, readings({ formQuality: { v: 'ord', scale: 'formQuality', level: 2 } }, m.anchor.date))) void ph

const visit = (tr: Trace, out: Set<Term>) => {
  out.add(tr.node)
  for (const k of tr.kids) visit(k, out)
}

// ── A. definition prose vs the trace ────────────────────────────────────────

const libBodyLits = new Set<Term>([...reg.fns.values()].filter((f) => isLib(f.ref.id)).flatMap((f) => [...nodesOf(f.body)].filter((n) => n.k === 'lit')))
const schemesOf = (def: ProgramDef) => [...new Set(Object.values(def.slots).map((b) => keyOf(b.scheme)))].map((k) => reg.schemes.get(k)!)
/** The description a reader of this program gets: the program, then every
 *  slot's scheme as bound there (its plan, its handlers). */
function proseOf(def: ProgramDef): string[] {
  const lines = describeProgram(def, cx)
  for (const [slot, b] of Object.entries(def.slots)) lines.push(...describeSlot(reg.schemes.get(keyOf(b.scheme))!, bindingArgs(def, b, cx), describeCtx(def, cx), def.calendar).map((l) => `${slot}: ${l}`))
  return lines
}
const litNumbers = (l: Lit) => tokens(litText(l, cx))
/** The plan's own trace inside an issued slot's trace (issue.ts issueSlot):
 *  past the sink's note node, and down each policy or phase transform to the
 *  trace of the session it was given. The policies' numbers are theirs, not
 *  the plan's. */
function planTrace(t: Trace): Trace {
  if (t.note && t.kids.length === 1 && t.kids[0]!.node === t.node) return planTrace(t.kids[0]!)
  if (t.node.k === 'app') {
    const at = Object.values(t.node.args).findIndex((a) => a.k === 'var' && a.name === '__session')
    if (at >= 0) return planTrace(t.kids[at]!)
  }
  return t
}
/** Every number the definition itself carries: its literals as displayed,
 *  and its literal structural fields (a loop bound, a window, a tempo). */
function ownNumbers(def: ProgramDef): Set<string> {
  const out = new Set<string>()
  const roots: unknown[] = [def, ...schemesOf(def)]
  const fns = new Set<string>()
  for (const r of roots)
    for (const n of nodesOf(r)) {
      if (n.k === 'lit') litNumbers(n.lit).forEach((x) => out.add(x))
      if (n.k === 'app') fns.add(keyOf(n.def))
      if (n.k === 'range') out.add(String(n.n - 1))
    }
  const walk = (x: unknown) => {
    if (typeof x === 'number') out.add(String(x))
    else if (x && typeof x === 'object') for (const v of Object.values(x)) if (!(v && typeof v === 'object' && 'k' in v && (v as { k: string }).k === 'lit')) walk(v)
  }
  roots.forEach(walk)
  for (const k of fns) {
    const f = reg.fns.get(k)
    if (f && !isLib(f.ref.id)) for (const n of nodesOf(f.body)) if (n.k === 'lit') litNumbers(n.lit).forEach((x) => out.add(x))
    // A library template is reviewed prose (D5): its own words may carry numbers.
    if (f && isLib(f.ref.id)) tokens(f.says.replace(/\{\w+\}/g, '')).forEach((x) => out.add(x))
  }
  for (const sc of schemesOf(def)) if (isLib(sc.ref.id)) tokens(sc.says.replace(/\{\w+\}/g, '')).forEach((x) => out.add(x))
  // The vocabulary's own numbers (a fact's staleness limit) and the frequency
  // the rotation implies are declarations too.
  for (const f of new Set([...def.facts, ...schemesOf(def).flatMap((x) => x.facts)])) {
    const m = reg.vocab.facts[f]?.maxAgeDays
    if (m) out.add(String(m))
  }
  for (const f of effectiveFrequency(def.frequency, def.rotation)) {
    if (f.k === 'atLeast') [f.n, periodDays(f.per)].forEach((x) => out.add(String(x)))
    if (f.k === 'atMost') [f.n, f.withinDays].forEach((x) => out.add(String(x)))
  }
  return out
}
/** Patterns the describer prints that are positions, not quantities. */
const STRUCTURAL = [/#\d+/g, /rule \d+/g, /\(from 0[,)]/g, /\(\d+\) /g, /\d+-day window/g, /from your start day/g]
const strip = (s: string) => STRUCTURAL.reduce((a, r) => a.replace(r, ''), s)

for (const run of RUNS) {
  t('A L8', `A. ${run.def.ref.id}: every literal the evaluator read shows its number in the description`, () => {
    const prose = new Set(tokens(proseOf(run.def).join('\n')))
    const visited = new Set<Term>()
    run.traces.forEach((tr) => visit(tr, visited))
    const missing: string[] = []
    let read = 0
    for (const n of visited) {
      if (n.k !== 'lit' || libBodyLits.has(n) || n.lit.k === 'bool' || n.lit.k === 'enum' || n.lit.k === 'ref') continue
      // "1 set of" is elided before a target with no rep count ("a 15 min warm-up").
      if (n.lit.k === 'q' && n.lit.unit === 'set' && n.lit.v === 1) continue
      read++
      for (const x of litNumbers(n.lit)) if (!prose.has(x)) missing.push(`${litText(n.lit, cx)}`)
    }
    assert(read >= 2, `only ${read} literals read: the check would be vacuous`)
    eq([...new Set(missing)], [], 'numbers the evaluator used but the prose never states')
  })
  t('A L8', `A. ${run.def.ref.id}: every number the description prints comes from the definition`, () => {
    const own = ownNumbers(run.def)
    // Line 0 is the generated headline (structural counts); the "Together"
    // lines state COMPOSED numbers, which check C holds to the evaluator.
    const lines = proseOf(run.def).slice(1).filter((l) => !/^ {4}When .*: (the rules stack|only the first)/.test(l))
    const invented = [...new Set(lines.flatMap((l) => tokens(strip(l))).filter((x) => !own.has(x)))]
    eq(invented, [], 'numbers the prose prints that the definition does not carry')
  })
}

/** Term by term: a handler's or plan's own trace, against that term's own
 *  description. Every literal and every parameter VALUE it read (outside a
 *  library body) shows its number there; collisions with numbers elsewhere in
 *  the program cannot hide an omission at this grain. */
function termNumbersRead(tr: Trace, out: string[], args: Record<string, Term>) {
  const n = tr.node
  if (n.k === 'lit' && !libBodyLits.has(n) && n.lit.k === 'q' && !(n.lit.unit === 'set' && n.lit.v === 1)) out.push(...litNumbers(n.lit))
  // A parameter bound to a literal reads that number; one bound to a live read (BBB's TM) reads state.
  if (n.k === 'param' && args[n.name]?.k === 'lit' && tr.value.v === 'q' && !(tr.value.unit === 'set' && tr.value.n === 1)) out.push(...tokens(valueText(tr.value, reg)))
  const lib = n.k === 'app' && isLib(n.def.id)
  tr.kids.forEach((k, i) => (lib && i === tr.kids.length - 1 ? undefined : termNumbersRead(k, out, args)))
}
for (const run of RUNS)
  t('A L8 D3', `A. ${run.def.ref.id}: term by term, each plan and handler states every number its own evaluation read`, () => {
    const bad: string[] = []
    const pc = describeCtx(run.def, cx)
    const proseFor = new Map<string, string>()
    const describeTerm = (slot: string, which: string, term: Term) => {
      const key = `${slot}:${which}`
      if (!proseFor.has(key)) {
        const sch = reg.schemes.get(keyOf(run.def.slots[slot]!.scheme))!
        const nouns = Object.fromEntries(Object.entries(sch.state).map(([k, v]) => [k, v.noun]))
        const flags = new Set(Object.entries(sch.state).filter(([, v]) => v.ty.t === 'bool').map(([k]) => k))
        proseFor.set(key, describe(term, { ...pc, lib: isLib(sch.ref.id), params: bindingArgs(run.def, run.def.slots[slot]!, cx), nouns, flags, defaulted: new Set(Object.keys(sch.defaults ?? {})) }))
      }
      return proseFor.get(key)!
    }
    for (const i of run.issued)
      for (const sl of i.slots) {
        const sch = reg.schemes.get(keyOf(run.def.slots[sl.slot]!.scheme))!
        const said = new Set(tokens(describeTerm(sl.slot, 'plan', sch.plan)))
        const read: string[] = []
        termNumbersRead(planTrace(sl.trace), read, run.def.slots[sl.slot]!.args)
        for (const x of read) if (!said.has(x)) bad.push(`${sl.slot} plan read ${x}`)
      }
    for (const f of run.fired) {
      if (!f.reason || f.scope === 'program' || f.on === 'owner' || f.on === 'decision') continue
      const sch = reg.schemes.get(keyOf(run.def.slots[f.scope]!.scheme))!
      const said = new Set(tokens(describeTerm(f.scope, f.on, sch.on[f.on]!)))
      const read: string[] = []
      termNumbersRead(f.reason, read, run.def.slots[f.scope]!.args)
      for (const x of read) if (!said.has(x)) bad.push(`${f.scope} ${f.on} handler read ${x}`)
    }
    eq([...new Set(bad)], [], 'numbers read but not stated by the term that read them')
  })

// ── B. issued prose vs the issued fact ──────────────────────────────────────

/** mm:ss reads as one number (minutes), on both sides of the comparison. */
const clocks = (s: string) => s.replace(/(\d+):(\d\d)/g, (_, m, ss) => `${Number(m) + Number(ss) / 60}`)
function factNumbers(s: IssuedSession): Set<string> {
  const out = new Set<string>()
  const add = (txt: string) => tokens(clocks(txt)).forEach((x) => out.add(x))
  for (const sl of s.slots) {
    const blocks = new Set<string>()
    for (const st of sl.steps) {
      const c = st.count
      if (c.k === 'n') {
        if (c.n !== 1) add(String(c.n))
      } else if (c.k === 'range') add(`${c.min} ${c.max}`)
      else add(`${c.max} ${c.planned}`)
      if (st.block) blocks.add(`${st.block.id}:${st.block.iteration}`)
      for (const tg of [...st.sets, ...(sl.intensifier?.stages ?? [])]) {
        for (const [m, f] of Object.entries(tg.metrics)) {
          const fx = f?.k === 'open' ? f.planned : f
          if (fx?.k !== 'fixed' || fx.v.b === 'open') continue
          const b = fx.v
          for (const v of b.b === 'range' ? [b.min, b.max] : [b.v]) add(numText(reg, m, v, s.stamp.display))
        }
        if (tg.restSec !== null) add(tg.restSec >= 60 ? `${tg.restSec / 60}` : `${tg.restSec}`)
        if (tg.tempo) add(tg.tempo.join(' '))
        if (tg.cluster) add(`${tg.cluster.per} ${tg.cluster.intraRestSec}`)
      }
    }
    if (blocks.size) add(String(new Set([...blocks].map((b) => b.split(':')[1])).size))
  }
  return out
}
for (const run of RUNS)
  t('B EC-187 L6', `B. ${run.def.ref.id}: every number in each issued session’s prose is a number of that fact, and every one appears`, () => {
    const bad: string[] = []
    for (const s of run.issued) {
      const said = new Set(tokens(clocks(sessionText(s, reg).slice(1).join('\n'))))
      const fact = factNumbers(s)
      for (const x of said) if (!fact.has(x)) bad.push(`said ${x} (${s.issueKey})`)
      for (const x of fact) if (!said.has(x)) bad.push(`omitted ${x} (${s.issueKey})`)
    }
    eq([...new Set(bad)].slice(0, 6), [], 'divergence')
  })

// ── C. composed policy prose vs the evaluator ───────────────────────────────

t('C S3', 'C. every stated combination of co-firing plan policies is what the evaluator does, for 1–12 sets', () => {
  let checked = 0
  for (const def of reg.programs.values()) {
    const pols = def.policies.filter((p) => p.plan)
    if (pols.length < 2) continue
    const pc = describeCtx(def, cx)
    const said = stackingText(def, pc).join('\n')
    for (let mask = 3; mask < 1 << pols.length; mask++) {
      const combo = pols.filter((_, i) => mask & (1 << i))
      if (combo.length < 2) continue
      const ns = combo.map((p) => normal(p.plan!, pc))
      if (!ns.every((x) => !!x)) continue
      const claim = compose(ns as NonNullable<(typeof ns)[number]>[])
      for (let k = 1; k <= 12; k++) {
        const probe: SessionValue = {
          exercise: { v: 'ref', kind: 'exercise', id: 'wger:97' },
          steps: [{ id: 'w' as never, key: 'w', count: { k: 'n', n: k }, sets: Array.from({ length: k }, () => ({ role: 'working', metrics: { reps: { k: 'fixed', v: { b: 'exact', v: 8 } }, load: { k: 'fixed', v: { b: 'exact', v: 100 } }, effort: { k: 'fixed', v: { b: 'exact', v: 1 } } }, restSec: null, tempo: null, cluster: null })), block: null, live: null }],
          intensifier: { kind: 'rest-pause', stages: [] },
        }
        const out = combo.reduce((s, p) => applyUse(p.plan!, s, ctxOf(reg)), probe)
        const n = out.steps[0]!.count.k === 'n' ? out.steps[0]!.count.n : NaN
        const want = claim.sets.reduce((a, f) => (a === 0 ? 0 : Math.max(1, Math.floor(a * f + 1e-9))), k)
        eq(n, want, `${def.ref.id}: sets from ${k}`)
        const ld = out.steps[0]!.sets[0]!.metrics['load']!
        assert(ld.k === 'fixed' && ld.v.b === 'exact' && Math.abs(ld.v.v - 100 * (claim.scale['load'] ?? 1)) < 1e-9, `${def.ref.id}: load`)
        const ef = out.steps[0]!.sets[0]!.metrics['effort']!
        assert(ef.k === 'fixed' && ef.v.b === 'exact' && ef.v.v === Math.max(1, claim.effort ?? 1), `${def.ref.id}: effort`)
        eq(out.intensifier === null, claim.strip, `${def.ref.id}: strip`)
        checked++
      }
      assert(said.length > 0, 'the combination is described')
    }
  }
  assert(checked >= 12 * 4, `${checked} probes`)
})

void day
done()
