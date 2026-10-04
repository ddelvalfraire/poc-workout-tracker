/**
 * judge.ts — the event reads: how a closed session is judged against the
 * targets it was ISSUED (the snapshot, with its live resolutions), never
 * against today's plan.
 *
 * THE VERDICT (three-valued, metric by metric):
 *   missed   some logged value violates its bound;
 *   hit      every judged bound was logged and met;
 *   unknown  otherwise: something unlogged and nothing violated, OR no bound
 *            was judged at all (zero working sets never counts as a hit, BV-46).
 * Which sets: `working` judges every set whose role is not warm-up or
 * recovery (EC-106); an explicit step list judges every set of those steps.
 * A fixed-count step judges its n sets (a range its floor; an unlogged one
 * is unknown); an until/while step judges the sets you logged (the count was
 * yours to decide).
 * Which bounds: effort is a DOSE instruction, not an outcome, so it is never
 * judged; an open bound is logged, not targeted; a SILENT field was never a
 * bar (no load could be computed, so you chose one), so it is not judged
 * either, which is what lets a self-anchoring rule read the load you logged;
 * an open FIELD judges against its resolution, and an unresolved one is unknown.
 * Which way: a metric's `better` decides (pace and heart rate are better
 * lower; an assisted load is better lower). A range on a lower-is-better
 * metric is a ZONE (inside it is met); on a higher-is-better metric its floor
 * (or top) edge is the bar. A metric measured by a reduced fact (heart rate)
 * is read from the session's fact snapshot when the set did not log it.
 */
import type { MetricDecl } from './registry'
import type { FactReading, IssuedBound, IssuedSlot, IssuedStep, Logged, PerformedSet, Value } from './engine'
import { cmpNum, edgeOf, none, performedRead, qv, type EventRead, type Ports } from './evaluate'
import type { Registry } from './checker'
import { isJudged } from './xform'
import { DIMS } from './units'

export interface EventSource {
  reg: Registry
  /** The issued slots this handler judges (one for a slot handler, all for
   *  the program's aggregate), merged with their resolutions (currentView). */
  slots: IssuedSlot[]
  performed: Logged
  facts: readonly FactReading[]
  groupScores: Record<string, { time?: number; rounds?: number }>
  week: number
  primary: (slot: string) => string | undefined
}

type Verdict = 'hit' | 'missed' | 'unknown'
const loggedOf = (src: EventSource, slot: string, st: IssuedStep): PerformedSet[] => src.performed[slot]?.[st.key] ?? []

function judgeValue(x: number, b: IssuedBound, decl: MetricDecl | undefined, edge: 'floor' | 'top', assisted: boolean): boolean {
  const higher = (decl?.better ?? 'higher') === 'higher' !== assisted
  const ge = (a: number, z: number) => cmpNum(a, z) >= 0
  const le = (a: number, z: number) => cmpNum(a, z) <= 0
  switch (b.b) {
    case 'exact':
      return higher ? ge(x, b.v) : le(x, b.v)
    case 'range':
      return higher ? ge(x, edge === 'floor' ? b.min : b.max) : ge(x, b.min) && le(x, b.max)
    case 'atLeast':
      return ge(x, b.v)
    case 'atMost':
      return le(x, b.v)
    case 'open':
      return true
  }
}

const isAssisted = (src: EventSource, slot: IssuedSlot) => 'id' in slot.exercise && slot.exercise.logging === 'assisted_bodyweight'

export function verdictOf(src: EventSource, steps: string[] | 'working', edge: 'floor' | 'top'): Verdict {
  let missed = false
  let unknown = false
  let judged = 0
  for (const slot of src.slots)
    for (const st of slot.steps) {
      if (steps !== 'working' && !steps.includes(st.id)) continue
      const logged = loggedOf(src, slot.slot, st)
      const expected = st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.min : logged.length
      for (let i = 0; i < expected; i++) {
        const target = st.sets[i]
        if (!target || (steps === 'working' && !isJudged(target))) continue
        const set = logged[i]
        for (const [m, fd] of Object.entries(target.metrics)) {
          if (!fd || m === 'effort') continue
          if (fd.k === 'silent' || (fd.k === 'fixed' && fd.v.b === 'open')) continue
          judged++
          if (fd.k === 'open' || !set) {
            unknown = true
            continue
          }
          const f = fd
          const decl = src.reg.vocab.metrics[m]
          const x = set.values[m] ?? (decl?.measuredBy ? factNumber(src, decl.measuredBy) : undefined)
          if (x === undefined) unknown = true
          else if (!judgeValue(x, f.v, decl, edge, m === 'load' && isAssisted(src, slot))) missed = true
        }
      }
    }
  return missed ? 'missed' : unknown || judged === 0 ? 'unknown' : 'hit'
}

const factNumber = (src: EventSource, fact: string): number | undefined => {
  const r = src.facts.find((x) => x.fact === fact && x.key === null)
  return r && r.value.v === 'q' ? r.value.n : undefined
}

/** The latest issued step with this id, across the judged slots. */
function stepOf(src: EventSource, id: string): { slot: IssuedSlot; st: IssuedStep } | null {
  for (const slot of [...src.slots].reverse()) {
    const st = [...slot.steps].reverse().find((x) => x.id === id)
    if (st) return { slot, st }
  }
  return null
}

/** Epley over the best set, on EFFECTIVE load: an added load counts with
 *  bodyweight, an assisted one against it (bodyweight from the snapshot). */
function e1rm(src: EventSource, id: string): Value {
  const hit = stepOf(src, id)
  if (!hit) return none({ k: 'notPerformed', step: id })
  const logging = 'id' in hit.slot.exercise ? hit.slot.exercise.logging : null
  const bw = factNumber(src, 'bodyweight')
  let best: number | null = null
  for (const s of loggedOf(src, hit.slot.slot, hit.st)) {
    const r = s.values['reps']
    const l = s.values['load'] ?? 0
    if (r === undefined || r <= 0) continue
    if ((logging === 'weighted_bodyweight' || logging === 'assisted_bodyweight' || logging === 'bodyweight_reps') && bw === undefined) return none({ k: 'factUnknown', fact: 'bodyweight', key: null })
    const w = logging === 'weighted_bodyweight' ? bw! + l : logging === 'assisted_bodyweight' ? bw! - l : logging === 'bodyweight_reps' ? bw! : l
    const e = w * (1 + r / 30)
    if (best === null || e > best) best = e
  }
  return best === null ? none({ k: 'notPerformed', step: id }) : qv(best, DIMS.mass, 'kg')
}

export function eventPort(src: EventSource): Ports['event'] {
  return (q: EventRead): Value => {
    switch (q.q) {
      case 'verdict':
        return { v: 'enum', name: 'verdict', tag: verdictOf(src, q.steps, q.bound) }
      case 'metric': {
        const hit = stepOf(src, q.step)
        const logged = hit ? loggedOf(src, hit.slot.slot, hit.st) : []
        return performedRead(logged, q.step, q.metric, q.pick, src, q.metric === 'load' && !!hit && isAssisted(src, hit.slot))
      }
      case 'e1rm':
        return e1rm(src, q.step)
      case 'prescribed': {
        const hit = stepOf(src, q.step)
        return hit && hit.st.sets.length ? edgeOf(hit.st.sets[0]!.metrics[q.metric], q.edge, q.step, q.metric, true) : none({ k: 'notPerformed', step: q.step })
      }
      case 'stages': {
        const hit = stepOf(src, q.step)
        const logged = hit ? loggedOf(src, hit.slot.slot, hit.st) : []
        const stages = logged[logged.length - 1]?.stages
        if (q.pick === 'count') return qv(stages?.length ?? 0, {}, 'x')
        if (!stages?.length) return none({ k: 'notPerformed', step: q.step })
        return qv(q.pick === 'sum' ? stages.reduce((a, s) => a + s.reps, 0) : stages[stages.length - 1]!.reps, DIMS.reps, 'rep')
      }
      case 'trained':
        return { v: 'bool', b: src.slots.some((s) => src.primary(s.slot) === q.muscle && s.steps.some((st) => loggedOf(src, s.slot, st).length > 0)) }
      case 'week':
        return qv(src.week, DIMS.weeks, 'wk', { clock: 'progress' })
      case 'groupScore': {
        const g = src.slots.map((s) => src.groupScores[s.slot]?.[q.score]).find((x) => x !== undefined)
        return g === undefined ? none({ k: 'notPerformed', step: 'group' }) : qv(g, q.score === 'time' ? DIMS.time : {}, q.score === 'time' ? 's' : 'x')
      }
    }
  }
}
