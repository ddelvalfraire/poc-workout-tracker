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
import type { E1rmFormula, SuccessRule } from './algebra'
import type { MetricDecl } from './registry'
import type { FactReading, IssuedBound, IssuedSlot, IssuedStep, Logged, PerformedSet, Value } from './engine'
import { assistedLoad, cmpNum, edgeOf, none, performedRead, qv, type EventRead, type Ports } from './evaluate'
import { latestReading } from './ports'
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
  /** Per-slot verdict success rules (C1), from the program's slot metas.
   *  Present only when some slot declares one, so a default source is
   *  byte-identical. A read-level rule still wins. */
  success?: Record<string, SuccessRule>
  /** The program's e1RM declaration (C2); present only when declared. */
  e1rm?: { formula: E1rmFormula; maxReps?: number }
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

const loggingOf = (slot: IssuedSlot) => ('id' in slot.exercise ? slot.exercise.logging : null)

/** One judged set's metric bars, as three counters. Under `repsAgg` the
 *  reps floor side (exact, a range's edge, atLeast) is pulled out into the
 *  totals instead of being judged per set; an atMost reps ceiling is still a
 *  per-set bar. */
interface Tally {
  missed: boolean
  unknown: boolean
  judged: number
}
const repsFloorOf = (b: IssuedBound, edge: 'floor' | 'top'): number | null =>
  b.b === 'exact' || b.b === 'atLeast' ? b.v : b.b === 'range' ? (edge === 'floor' ? b.min : b.max) : null

export function verdictOf(src: EventSource, steps: string[] | 'working', edge: 'floor' | 'top', success?: SuccessRule): Verdict {
  const all: Tally = { missed: false, unknown: false, judged: 0 }
  for (const slot of src.slots) {
    const rule = success ?? src.success?.[slot.slot]
    const repsAgg = rule === 'totalReps'
    const atLeastSets = typeof rule === 'object' ? rule.atLeastSets : null
    // totalReps (C1): the summed logged reps of the slot's judged sets
    // against the summed reps floor, decidable early in both directions: the
    // logged sum alone can already hit, and a miss needs every expected set
    // logged (an unlogged set could still add reps).
    let repsRequired = 0
    let repsLogged = 0
    let repsBars = 0
    let repsOpen = false
    let repsAllLogged = true
    // atLeastSets n (C1): per set, every bar must hit; the slot hits when n
    // sets did, misses when too few can still hit, and is unknown between.
    let setsHit = 0
    let setsMissed = 0
    let setsUnknown = 0
    let setsJudged = 0
    for (const st of slot.steps) {
      if (steps !== 'working' && !steps.includes(st.id)) continue
      const logged = loggedOf(src, slot.slot, st)
      const expected = st.count.k === 'n' ? st.count.n : st.count.k === 'range' ? st.count.min : logged.length
      for (let i = 0; i < expected; i++) {
        const target = st.sets[i]
        if (!target || (steps === 'working' && !isJudged(target))) continue
        const set = logged[i]
        const one: Tally = { missed: false, unknown: false, judged: 0 }
        for (const [m, fd] of Object.entries(target.metrics)) {
          if (!fd || m === 'effort') continue
          if (fd.k === 'silent' || (fd.k === 'fixed' && fd.v.b === 'open')) continue
          if (repsAgg && m === 'reps' && fd.k === 'fixed' && repsFloorOf(fd.v, edge) !== null) {
            repsBars++
            repsRequired += repsFloorOf(fd.v, edge)!
            const r = set?.values['reps']
            if (typeof r === 'number') repsLogged += r
            else repsAllLogged = false
            // Only the floor side aggregates; an atMost reps ceiling has no
            // floor and stays a per-set bar below.
            continue
          }
          if (repsAgg && m === 'reps' && fd.k === 'open') {
            // An unresolved reps field has no knowable floor: the total is undecidable.
            repsOpen = true
            repsBars++
            continue
          }
          one.judged++
          if (fd.k === 'open' || !set) {
            one.unknown = true
            continue
          }
          const f = fd
          const decl = src.reg.vocab.metrics[m]
          const x = set.values[m] ?? (decl?.measuredBy ? factNumber(src, decl.measuredBy) : undefined)
          if (x === undefined) one.unknown = true
          else if (!judgeValue(x, f.v, decl, edge, assistedLoad(m, loggingOf(slot)))) one.missed = true
        }
        if (atLeastSets !== null) {
          const anyBar = one.judged > 0
          if (anyBar) setsJudged++
          if (anyBar && one.missed) setsMissed++
          else if (anyBar && one.unknown) setsUnknown++
          else if (anyBar) setsHit++
          continue
        }
        all.judged += one.judged
        all.missed ||= one.missed
        all.unknown ||= one.unknown
      }
    }
    if (repsAgg && repsBars > 0) {
      all.judged++
      if (!repsOpen && cmpNum(repsLogged, repsRequired) >= 0) void 0
      else if (!repsOpen && repsAllLogged) all.missed = true
      else all.unknown = true
    }
    if (atLeastSets !== null && setsJudged > 0) {
      all.judged++
      if (setsHit >= atLeastSets) void 0
      else if (setsHit + setsUnknown < atLeastSets) all.missed = true
      else all.unknown = true
    }
  }
  return all.missed ? 'missed' : all.unknown || all.judged === 0 ? 'unknown' : 'hit'
}

/** The snapshot's reading of an unkeyed fact: the latest observation (F19). */
const factNumber = (src: EventSource, fact: string): number | undefined => {
  const r = latestReading(src.facts, fact, null)
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

/** The estimator family (C2), each on effective reps r = logged reps plus
 *  logged reps in reserve (X6: one RIR rule across every formula) and
 *  effective load w. Operation order is pinned per formula (P4). A formula's
 *  own domain edge: Brzycki estimates nothing at 37 or more effective reps. */
const FORMULAS: Record<E1rmFormula, { domainMax: number | null; of: (w: number, r: number) => number }> = {
  epley: { domainMax: null, of: (w, r) => w * (1 + r / 30) },
  brzycki: { domainMax: 36, of: (w, r) => (w * 36) / (37 - r) },
  lombardi: { domainMax: null, of: (w, r) => w * Math.pow(r, 0.1) },
  mayhew: { domainMax: null, of: (w, r) => (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * r)) },
}

/** The declared estimator over the best set, on EFFECTIVE load: an added
 *  load counts with bodyweight, an assisted one against it (bodyweight from
 *  the snapshot). Where the logged load IS the lifted load (weight_reps), a
 *  set without one is skipped, and no qualifying set is absent (F6): an
 *  unlogged load is not a load of 0. Only where 0 genuinely means none
 *  (added load on a weighted bodyweight set, assistance on an assisted one)
 *  does a missing load read 0; a bodyweight set has no load.
 *  A logged effort (reps in reserve) counts as reps the formula would have
 *  seen (asReps), so the Epley estimate and lib/load-for's inverse are ONE
 *  rule and a round trip agrees (X6); an unlogged effort adds nothing.
 *  The formula is the read's override, else the program's declaration, else
 *  Epley; a qualifying set whose effective reps lie outside the formula's
 *  domain, or above the declared maxReps, makes the read absent with
 *  outsideFormulaDomain, never a silently skipped set (C2). */
function e1rm(src: EventSource, id: string, formula?: E1rmFormula): Value {
  const hit = stepOf(src, id)
  if (!hit) return none({ k: 'notPerformed', step: id })
  const name = formula ?? src.e1rm?.formula ?? 'epley'
  const f = FORMULAS[name]
  const maxReps = src.e1rm?.maxReps ?? null
  const logging = loggingOf(hit.slot)
  const bw = factNumber(src, 'bodyweight')
  const loadIsLifted = logging !== 'weighted_bodyweight' && logging !== 'assisted_bodyweight' && logging !== 'bodyweight_reps'
  let best: number | null = null
  for (const s of loggedOf(src, hit.slot.slot, hit.st)) {
    const r = s.values['reps']
    if (r === undefined || r <= 0) continue
    if (loadIsLifted && s.values['load'] === undefined) continue
    const l = s.values['load'] ?? 0
    if ((logging === 'weighted_bodyweight' || logging === 'assisted_bodyweight' || logging === 'bodyweight_reps') && bw === undefined) return none({ k: 'factUnknown', fact: 'bodyweight', key: null })
    const w = logging === 'weighted_bodyweight' ? bw! + l : logging === 'assisted_bodyweight' ? bw! - l : logging === 'bodyweight_reps' ? bw! : l
    const reff = r + (s.values['effort'] ?? 0)
    if ((f.domainMax !== null && reff > f.domainMax) || (maxReps !== null && reff > maxReps)) return none({ k: 'outsideFormulaDomain', formula: name, reps: reff })
    const e = f.of(w, reff)
    if (best === null || e > best) best = e
  }
  return best === null ? none({ k: 'notPerformed', step: id }) : qv(best, DIMS.mass, 'kg')
}

export function eventPort(src: EventSource): Ports['event'] {
  return (q: EventRead): Value => {
    switch (q.q) {
      case 'verdict':
        return { v: 'enum', name: 'verdict', tag: q.success === undefined ? verdictOf(src, q.steps, q.bound) : verdictOf(src, q.steps, q.bound, q.success) }
      case 'metric': {
        const hit = stepOf(src, q.step)
        const logged = hit ? loggedOf(src, hit.slot.slot, hit.st) : []
        return performedRead(logged, q.step, q.metric, q.pick, src, !!hit && assistedLoad(q.metric, loggingOf(hit.slot)))
      }
      case 'e1rm':
        return e1rm(src, q.step, q.formula)
      case 'prescribed': {
        const hit = stepOf(src, q.step)
        return hit && hit.st.sets.length ? edgeOf(hit.st.sets[0]!.metrics[q.metric], q.edge, q.step, q.metric, true, src) : none({ k: 'notPerformed', step: q.step })
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
