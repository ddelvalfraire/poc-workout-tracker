/**
 * demo-eval.ts — demo §8: the evaluator on the worked corpus. Real numbers
 * for six programs' first two weeks under asPrescribed (one per worked
 * family), the transitions they cause, worked traces, live resolution, and
 * two macros run forward. Every number printed here is one the differential
 * (differential.ts) holds to the issued facts and the definitions' prose.
 */
import { exercise, kg, lb, pct, reps, rir, sets, type Term } from './algebra'
import type { Registry } from './checker'
import { explain, sessionText, transitionText, valueText } from './describe-run'
import type { Logged, Value } from './engine'
import { ctxOf, evaluate } from './evaluate'
import * as ER from './endurance-rehab'
import { currentView, resolveLive } from './issue'
import { runtimeOf } from './ports'
import * as P from './programs'
import { exampleProgram, project, projectMacro } from './project'
import { activate, ledgerOf, prescribe } from './step'
import type { ProgramDef } from './structure'
import { dayText, localDay, type LocalDay } from './time'
import { canon, litDim, type Unit } from './units'

const q = (n: number, unit: Unit): Value => ({ v: 'q', n: canon(n, unit), dim: litDim(unit), unit })
const D0 = localDay('2026-10-05')
const E1RM: Record<string, number> = { 'wger:111': 140, 'wger:192': 100, 'wger:105': 180, 'wger:119': 60, 'wger:97': 70, 'wger:314': 60, 'wger:122': 30, 'wger:212': 90, 'wger:158': 80, 'wger:507': 140, 'wger:hip-thrust': 160 }
const facts = (on: LocalDay) => ({
  get: (f: string, k: string | null) => (f === 'e1rm' && k && E1RM[k] !== undefined ? { fact: f, key: k, value: q(E1RM[k], 'kg'), observedOn: on } : null),
})

export function evaluatorSection(reg: Registry, h: (s: string) => void, say: (prefix: string, l: string) => void): void {
  h('8. EVALUATOR: six worked programs, their first two block weeks under asPrescribed')
  console.log('  Estimated maxes on file (kg): squat 140, bench 100, deadlift 180, press 60, the DB and cable lifts 30–90. Activated Monday 5 October.')
  console.log('  Every set is logged at the floor of its bound (asPrescribed); the session prose is generated from the issued fact.')
  const families: [string, ProgramDef][] = [
    ['strength canon', P.fiveThreeOneBBB.def],
    ['hypertrophy (RP)', P.rpMeso.def],
    ['techniques and policies', P.upperHypertrophy.def],
    ['cardio', ER.couchTo5k.def],
    ['frequency and adherence', P.legsFrequency.def],
    ['pain-gated rehab', ER.achillesLoading.def],
  ]
  const nouns = (def: ProgramDef) => (scope: string, field: string) =>
    scope === 'program' ? (def.aggregate?.state[field]?.noun ?? field) : `${scope} ${reg.schemes.get(`${def.slots[scope]!.scheme.id}@${def.slots[scope]!.scheme.version}`)?.state[field]?.noun ?? field}`
  for (const [family, def] of families) {
    const rt = runtimeOf(reg, def, { id: def.ref.id, anchor: D0, activatedOn: D0 })
    const head = activate(rt, {}, facts(D0))
    const post = def.ref.id === 'prog/achilles-loading' ? [{ fact: 'pain', key: null, value: { v: 'ord', scale: 'pain', level: 1 } as Value, observedOn: D0 }] : []
    const p = project(rt, ledgerOf(head), 2, { k: 'asPrescribed' }, facts(D0), D0, def.ref.id === 'prog/achilles-loading' ? 6 : 400, post)
    console.log(`\n  ${def.ref.id} (${family})${post.length ? ', pain rated 1/10 after each session, first three days' : ''}:`)
    for (const w of p.weeks) for (const s of w.sessions) for (const l of sessionText(s, reg)) say('    ', l)
    const lines = p.changes.flatMap((t) => transitionText(t, reg, nouns(def)))
    const shown = lines.slice(0, 8)
    console.log('    What changed:')
    for (const l of shown) say('      ', l)
    if (lines.length > shown.length) console.log(`      … and ${lines.length - shown.length} more`)
  }

  h('8b. EVALUATOR: traces, live resolution, and macros run forward')
  const tr = (t: Term) => explain(evaluate(t, ctxOf(reg)), reg)
  console.log(`  Inverse Epley: ${tr(P.loadFor({ e1rm: kg(120), reps: reps(5), rir: rir(1) }).term)}`)
  console.log(`  APRE chart, 9 reps: ${tr(P.apreAdjust({ reps: reps(9), small: lb(5), big: lb(10) }).term)}`)
  const apreDef: ProgramDef = { ...exampleProgram(P.apreTopBackoff.def, { lift: exercise('wger:192').term, small: lb(5).term, big: lb(10).term, backoffs: sets(2).term, keep: pct(90).term }), grids: { load: lb(5).term } }
  const rt = runtimeOf(reg, apreDef, { id: 'apre', anchor: D0, activatedOn: D0 })
  const r = prescribe(rt, ledgerOf(activate(rt, {}, facts(D0))), 'A', facts(D0), D0)
  if (!('code' in r.issued)) {
    const issued = r.issued
    console.log('  APRE on bench, issued (the back-offs are OPEN: they read the top set):')
    for (const l of sessionText(issued, reg)) say('    ', l)
    const logged: Logged = { x: { top: [{ values: { reps: 9, load: issued.slots[0]!.steps[2]!.sets[0]!.metrics['load']!.k === 'fixed' ? (issued.slots[0]!.steps[2]!.sets[0]!.metrics['load'] as { v: { v: number } }).v.v : 0 }, completed: true, stages: null }] } }
    const rows = resolveLive({ reg }, issued, logged, [])
    console.log(`  The top set logged at 9 reps resolves ${rows.length} back-off loads (the issued fact is untouched):`)
    say('    ', sessionText({ ...issued, slots: currentView(issued, rows) }, reg).slice(1).join('\n'))
    console.log(`    worked, before the 5 lb grid: ${rows[0] ? explain(rows[0].trace.kids[rows[0].trace.kids.length - 1]!, reg) : ''}`)
  }
  for (const [m, post] of [
    [P.optMacro, [{ fact: 'formQuality', key: null, value: { v: 'ord', scale: 'formQuality', level: 2 } as Value, observedOn: P.optMacro.anchor.date }]],
    [ER.achillesReturn, []],
  ] as const) {
    console.log(`\n  ${m.ref.id}, asPrescribed${post.length ? ', form rated solid after each session' : ', no morning-pain check-ins'}:`)
    for (const ph of projectMacro(reg, m, { k: 'asPrescribed' }, facts(m.anchor.date), 40, post)) {
      const ended = { completed: 'its calendar ran out', criteria: 'its gate held', max: 'it reached its maximum', askedAtMax: 'it reached its maximum and ASKS you before moving on', open: 'it is open-ended' }[ph.ended]
      const params = Object.entries(ph.params).map(([k, v]) => `${k} = ${valueText(v, reg)}`).join('; ')
      console.log(`    ${ph.label}: ${ph.weeks} block weeks from ${dayText(ph.startsOn)}; ended because ${ended}${params ? `; handed ${params}` : ''}.`)
    }
  }
}
