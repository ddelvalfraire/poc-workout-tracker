/**
 * options.ts — THE one table of declared options (configurability fix round).
 *
 * Every program-level option has exactly one row here: its engine default,
 * its canonical spelling (what the TS embedding emits), its checker (typed
 * refusals, including the one-form law: a spelling that means the default is
 * refused, never silently accepted as a second form), and its program-line
 * prose. checkdefs, the describers, the embedding, the sink, the judge and
 * the kit schema all consult this table, so an option cannot drift between
 * surfaces: one meaning, one form, one phrase.
 *
 * Canonical spellings for set-valued options: `stripIntensifierOn` lists
 * each role once, in the order of its first appearance in the program's
 * calendar; any other spelling (a duplicate, another order, the default set)
 * is refused, and the embedding normalizes to the same form.
 */
import type { E1rmFormula, SuccessRule, Term, Ty } from './algebra'
import { canonicalJson } from './canonical'
import { ENUM_VALUES } from './registry'
import type { Registry } from './checker'
import type { TypeError } from './engine'
import type { ProgramDef } from './structure'
import { WEEKDAYS } from './time'

type Path = (string | number)[]

/** Every node of a term, depth first (local: options must not import the evaluator). */
function* nodesOf(t: unknown): Generator<Term> {
  if (!t || typeof t !== 'object') return
  const n = t as Term
  if (typeof n.k === 'string') yield n
  for (const v of Object.values(n)) if (v && typeof v === 'object') yield* nodesOf(v)
}

// ── the defaults, each stated once ──────────────────────────────────────────

export const DEFAULT_E1RM_FORMULA: E1rmFormula = 'epley'
/** The estimator family (C2) with its INVERSE (Y7): both directions on
 *  effective reps r = logged reps + logged RIR (X6), operation order pinned
 *  per formula (P4). A formula's own domain edge: Brzycki estimates nothing
 *  at 37 or more effective reps, and its inverse is undefined there too. */
export const E1RM_FORMULAS: Record<E1rmFormula, { domainMax: number | null; of: (w: number, r: number) => number; inverse: (e: number, r: number) => number }> = {
  epley: { domainMax: null, of: (w, r) => w * (1 + r / 30), inverse: (e, r) => e / (1 + r / 30) },
  brzycki: { domainMax: 36, of: (w, r) => (w * 36) / (37 - r), inverse: (e, r) => (e * (37 - r)) / 36 },
  lombardi: { domainMax: null, of: (w, r) => w * Math.pow(r, 0.1), inverse: (e, r) => e / Math.pow(r, 0.1) },
  mayhew: { domainMax: null, of: (w, r) => (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * r)), inverse: (e, r) => (e * (52.2 + 41.9 * Math.exp(-0.055 * r))) / 100 },
}
export const E1RM_FORMULA_NAMES = Object.keys(E1RM_FORMULAS) as E1rmFormula[]

/** L10's default strip set (C5). */
export const STRIP_DEFAULT: readonly string[] = ['deload', 'taper', 'test']
/** Planned-volume technique weights (C4). */
export const VOLUME_DEFAULTS = { stage: 0.5, cluster: 1 } as const

const err = (out: TypeError[], e: TypeError) => void out.push(e)
const oneForm = (out: TypeError[], path: Path, field: string, what: string) =>
  err(out, { code: 'literalDomain', former: 'program', field, value: String(what), path, message: `${what} spells the default: omit it (one form per meaning)` })

/** The canonical order of a week-role list: first appearance in the calendar. */
export function canonicalStrip(roles: readonly string[], calendarWeeks: readonly string[]): string[] {
  const order = [...new Set(calendarWeeks)]
  return [...new Set(roles)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** The shared success-rule judgment (C1): the slot meta and the verdict read
 *  use this ONE check. `allowAllSets` admits the read-level 'allSets'
 *  override (Y8: the read wins in both directions); the slot meta refuses it
 *  (omitted IS allSets there, one form per meaning). */
export function checkSuccessRule(su: unknown, at: Path, out: TypeError[], opts: { allowAllSets: boolean; former: string }): void {
  if (su === undefined || su === 'totalReps') return
  if (su === 'allSets') {
    if (!opts.allowAllSets) err(out, { code: 'unknownName', name: 'allSets', path: at, message: `no verdict success rule allSets here: omit it (allSets is the default; a READ may spell it to override a slot rule)` })
    return
  }
  if (!su || typeof su !== 'object' || !('atLeastSets' in su)) {
    err(out, { code: 'unknownName', name: String(su), path: at, message: `no verdict success rule ${String(su)} (totalReps, or {atLeastSets: n}; omit it for allSets)` })
    return
  }
  const n = (su as { atLeastSets: unknown }).atLeastSets
  if (!(typeof n === 'number' && Number.isInteger(n) && n >= 1))
    err(out, { code: 'literalDomain', former: opts.former, field: 'success', value: n as number, path: at, message: `atLeastSets is a whole number of sets from 1, got ${n}` })
}

// ── the program options table ───────────────────────────────────────────────

export interface OptCx {
  reg: Registry
  def: ProgramDef
}

export interface ProgramOptionSpec {
  key: 'e1rm' | 'adherenceWeeks' | 'volumeWeights' | 'stripIntensifierOn' | 'ties' | 'staleness'
  /** Typed refusals for a declared value: domain, malformed JSON (Y10), and
   *  the one-form law (an explicit default is refused, Y4). */
  check(v: unknown, cx: OptCx, out: TypeError[]): void
  /** The program-description line(s) for a checked, declared value. */
  describe(v: never, def: ProgramDef, reg: Registry): string[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const trim = (n: number) => String(Number(n.toFixed(3)))
const pctText = (x: number) => `${trim(x * 100)}%`
const list = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''))

/** Does any term the program can evaluate read ev.e1rm or call lib/load-for
 *  (directly, or through a published fn it calls)? The Y7 unread posture:
 *  a declared estimator nothing consumes is dead config, refused like a
 *  staleness override for an unread fact (C8). */
function e1rmConsumed(cx: OptCx): boolean {
  const seen = new Set<string>()
  const consumes = (t: Term | undefined | null): boolean => {
    if (!t) return false
    for (const n of nodesOf(t)) {
      if (n.k === 'event' && n.q.q === 'e1rm') return true
      if (n.k === 'app') {
        if (n.def.id === 'lib/load-for') return true
        const k = `${n.def.id}@${n.def.version}`
        if (!seen.has(k)) {
          seen.add(k)
          if (consumes(cx.reg.fns.get(k)?.body)) return true
        }
      }
    }
    return false
  }
  const terms: (Term | undefined | null)[] = []
  for (const b of Object.values(cx.def.slots)) {
    const s = cx.reg.schemes.get(`${b.scheme.id}@${b.scheme.version}`)
    if (!s) continue
    terms.push(s.plan, ...Object.values(s.on), ...Object.values(s.state).map((d) => d.init), ...Object.values(b.args))
  }
  terms.push(...cx.def.policies.map((p) => p.when), ...Object.values(cx.def.aggregate?.on ?? {}), ...Object.values(cx.def.aggregate?.state ?? {}).map((d) => d.init))
  return terms.some(consumes)
}

export const PROGRAM_OPTIONS: readonly ProgramOptionSpec[] = [
  {
    key: 'e1rm',
    check(v, cx, out) {
      if (!isObj(v)) return err(out, { code: 'unknownName', name: String(v), path: ['e1rm'], message: `e1rm is {formula, maxReps?}, got ${v === null ? 'null' : typeof v}` })
      const formula = v['formula']
      if (!E1RM_FORMULA_NAMES.includes(formula as E1rmFormula))
        return err(out, { code: 'unknownName', name: String(formula), path: ['e1rm', 'formula'], message: `no e1RM formula ${String(formula)} (${E1RM_FORMULA_NAMES.join(', ')})` })
      const maxReps = v['maxReps']
      if (maxReps !== undefined) {
        if (!(typeof maxReps === 'number' && Number.isInteger(maxReps) && maxReps >= 1))
          return err(out, { code: 'literalDomain', former: 'program', field: 'e1rm.maxReps', value: maxReps as number, path: ['e1rm', 'maxReps'], message: `maxReps is a whole number of reps from 1, got ${maxReps}` })
        const dm = E1RM_FORMULAS[formula as E1rmFormula].domainMax
        if (dm !== null && maxReps > dm)
          return err(out, { code: 'literalDomain', former: 'program', field: 'e1rm.maxReps', value: maxReps, path: ['e1rm', 'maxReps'], message: `maxReps ${maxReps} is beyond the ${String(formula)} domain (${dm}): the cap could never bind` })
      }
      if (formula === DEFAULT_E1RM_FORMULA && maxReps === undefined) return oneForm(out, ['e1rm'], 'e1rm', `{formula: 'epley'} alone`)
      if (!e1rmConsumed(cx))
        err(out, { code: 'literalDomain', former: 'program', field: 'e1rm', value: String(formula), path: ['e1rm'], message: `the program declares an estimator but never reads ev.e1rm and never calls lib/load-for: dead config (the C8 unread posture)` })
    },
    describe(v: ProgramDef['e1rm'] & object) {
      const name = `${v.formula.charAt(0).toUpperCase()}${v.formula.slice(1)}`
      return [`  Estimated one-rep maxes use the ${name} formula${v.maxReps !== undefined ? `, from sets of at most ${v.maxReps} effective reps` : ''}.`]
    },
  },
  {
    key: 'adherenceWeeks',
    check(v, _cx, out) {
      if (v === 'fromAnchor') return oneForm(out, ['adherenceWeeks'], 'adherenceWeeks', `'fromAnchor'`)
      const ws = isObj(v) && isObj(v['calendarAligned']) ? v['calendarAligned']['weekStart'] : undefined
      if (!(WEEKDAYS as readonly string[]).includes(ws as string))
        err(out, { code: 'unknownName', name: String(ws), path: ['adherenceWeeks', 'calendarAligned', 'weekStart'], message: `no weekday ${String(ws)}` })
    },
    describe() {
      // Stated through the frequency prose (describe-defs `per`), not as its own line.
      return []
    },
  },
  {
    key: 'volumeWeights',
    check(v, _cx, out) {
      if (!isObj(v)) return err(out, { code: 'unknownName', name: String(v), path: ['volumeWeights'], message: `volumeWeights is {stage?, cluster?}, got ${v === null ? 'null' : typeof v}` })
      const keys = Object.keys(v)
      if (!keys.length) return oneForm(out, ['volumeWeights'], 'volumeWeights', '{}')
      let allDefault = true
      for (const k of keys) {
        const x = v[k]
        if (!(k in VOLUME_DEFAULTS)) {
          err(out, { code: 'unknownName', name: k, path: ['volumeWeights', k], message: `no volume weight ${k} (stage, cluster)` })
          allDefault = false
          continue
        }
        if (!(typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1)) {
          err(out, { code: 'literalDomain', former: 'program', field: `volumeWeights.${k}`, value: x as number, path: ['volumeWeights', k], message: `a volume weight lies in (0, 1], got ${x}` })
          allDefault = false
          continue
        }
        if (x !== VOLUME_DEFAULTS[k as keyof typeof VOLUME_DEFAULTS]) allDefault = false
      }
      if (allDefault) oneForm(out, ['volumeWeights'], 'volumeWeights', 'every entry at its default')
    },
    describe(v: NonNullable<ProgramDef['volumeWeights']>) {
      const parts = [
        ...(v.stage !== undefined ? [`an intensifier stage counts as ${pctText(v.stage)} of a set`] : []),
        ...(v.cluster !== undefined ? [`a clustered set counts as ${pctText(v.cluster)} of a set`] : []),
      ]
      // Guard (Y11): a declared-but-empty record is refused at check; a
      // surface fed an unchecked one must not render "Volume counting: ."
      return parts.length ? [`  Volume counting: ${parts.join('; ')}.`] : []
    },
  },
  {
    key: 'stripIntensifierOn',
    check(v, cx, out) {
      if (!Array.isArray(v)) return err(out, { code: 'unknownName', name: String(v), path: ['stripIntensifierOn'], message: `stripIntensifierOn is a list of week roles, got ${v === null ? 'null' : typeof v}` })
      const cal = [...new Set(cx.def.calendar.weeks)]
      let clean = true
      v.forEach((r, i) => {
        if (!(ENUM_VALUES.weekRole as readonly string[]).includes(r)) {
          err(out, { code: 'unknownName', name: String(r), path: ['stripIntensifierOn', i], message: `no week role ${String(r)}` })
          clean = false
        } else if (!cal.includes(r)) {
          err(out, { code: 'literalDomain', former: 'program', field: 'stripIntensifierOn', value: r, path: ['stripIntensifierOn', i], message: `${r} is not a week of this program's calendar (${cal.join(', ')}): the rule could never fire` })
          clean = false
        }
        if (v.indexOf(r) !== i) {
          err(out, { code: 'literalDomain', former: 'program', field: 'stripIntensifierOn', value: String(r), path: ['stripIntensifierOn', i], message: `${String(r)} is listed twice: a role list is a set, spelled once per role` })
          clean = false
        }
      })
      if (!clean) return
      const canon = canonicalStrip(v, cx.def.calendar.weeks)
      if ([...v].sort().join() === [...STRIP_DEFAULT].sort().join()) return oneForm(out, ['stripIntensifierOn'], 'stripIntensifierOn', 'the default role set')
      if (v.join() !== canon.join())
        err(out, { code: 'literalDomain', former: 'program', field: 'stripIntensifierOn', value: v.join(','), path: ['stripIntensifierOn'], message: `the canonical spelling lists roles in calendar order (${canon.join(', ')}): one form per meaning` })
    },
    describe(v: NonNullable<ProgramDef['stripIntensifierOn']>) {
      return [`  ${v.length ? `Intensifiers are dropped in ${list(v.map((r) => `${r}`))} weeks` : 'No week role drops the intensifier'}.`]
    },
  },
  {
    key: 'ties',
    check(v, _cx, out) {
      if (v === 'down') return oneForm(out, ['ties'], 'ties', `'down'`)
      if (v !== 'up') err(out, { code: 'unknownName', name: String(v), path: ['ties'], message: `no tie direction ${String(v)} (the IR writes 'up'; down is the default and is omitted)` })
    },
    describe() {
      // Stated once on the grid sentence (describe-defs), beside the grids it directs.
      return []
    },
  },
  {
    key: 'staleness',
    check(v, cx, out) {
      if (!isObj(v)) return err(out, { code: 'unknownName', name: String(v), path: ['staleness'], message: `staleness is a record of fact key to days, got ${v === null ? 'null' : typeof v}` })
      const entries = Object.entries(v)
      if (!entries.length) return oneForm(out, ['staleness'], 'staleness', '{}')
      const readable = new Set([...cx.def.facts, ...Object.values(cx.def.slots).flatMap((b) => cx.reg.schemes.get(`${b.scheme.id}@${b.scheme.version}`)?.facts ?? [])])
      let allDefault = true
      for (const [fact, days] of entries) {
        const decl = cx.reg.vocab.facts[fact]
        if (!decl) {
          err(out, { code: 'unknownName', name: fact, path: ['staleness', fact], message: `no fact ${fact}` })
          allDefault = false
          continue
        }
        if (!readable.has(fact)) {
          err(out, { code: 'undeclaredFact', fact, path: ['staleness', fact], message: `a staleness override for ${fact}, which neither the program nor any bound scheme reads` })
          allDefault = false
        }
        if (!(typeof days === 'number' && Number.isInteger(days) && days >= 1)) {
          err(out, { code: 'literalDomain', former: 'program', field: 'staleness', value: days as number, path: ['staleness', fact], message: `staleness is a whole number of days from 1, got ${days}` })
          allDefault = false
          continue
        }
        if (days !== decl.maxAgeDays) allDefault = false
      }
      if (allDefault) oneForm(out, ['staleness'], 'staleness', `every entry at the registry's maxAgeDays`)
    },
    describe(v: NonNullable<ProgramDef['staleness']>, def, reg) {
      // The Reads line covers facts the program declares; the rest get their
      // own Freshness line so a declared rule is never mute (C8).
      const extra = Object.entries(v).filter(([f]) => !def.facts.includes(f))
      if (!extra.length) return []
      return [`  Freshness: ${extra.map(([f, days]) => `${reg.vocab.facts[f]?.noun ?? f} is ignored once older than ${days === 1 ? 'a day' : `${days} days`}`).join('; ')} (this program's rule).`]
    },
  },
]

/** The description lines of every declared option, in table order. */
export function describeOptions(def: ProgramDef, reg: Registry): string[] {
  return PROGRAM_OPTIONS.flatMap((o) => (def[o.key] !== undefined ? o.describe(def[o.key] as never, def, reg) : []))
}

/** U2: the slot-grid judgment, beside the other option checks so the one-form
 *  law has one home. Shape first (Y10: a malformed record is a typed refusal,
 *  never a crash), then the one-form law: a slot grid that SPELLS the
 *  program's own grid for that metric is refused — the default (the program's
 *  grids) is omission. Two grids mean the same only when step AND display
 *  unit agree (the display unit IS the grid's unit, U-L2), so a 2.26796185 kg
 *  slot grid on a 5 lb program grid is a different grid, not the default.
 *  The dimension check (unitMismatch) stays with the program-grid check in
 *  checkdefs; this table must not import the evaluator. */
export function checkSlotGrids(v: unknown, slot: string, programGrids: ProgramDef['grids'], out: TypeError[]): void {
  const at: Path = ['slots', slot, 'meta', 'grids']
  if (!isObj(v)) return err(out, { code: 'unknownName', name: String(v), path: at, message: `a slot's grids is {load?, distance?}, got ${v === null ? 'null' : typeof v}` })
  const entries = Object.entries(v)
  if (!entries.length) return err(out, { code: 'literalDomain', former: 'program', field: 'meta.grids', value: '{}', path: at, message: `{} spells the program's grids: omit it (one form per meaning)` })
  for (const [m, g] of entries) {
    if (m !== 'load' && m !== 'distance') {
      err(out, { code: 'unknownName', name: m, path: [...at, m], message: `no grid metric ${m} (load, distance)` })
      continue
    }
    if (!isObj(g) || typeof (g as { k?: unknown }).k !== 'string') {
      err(out, { code: 'unknownName', name: String(g), path: [...at, m], message: `a grid is a quantity term, got ${g === null ? 'null' : typeof g}` })
      continue
    }
    const p = programGrids[m]
    if (!p) continue
    const [sl, pl] = [g as Term, p]
    const sameLit = sl.k === 'lit' && pl.k === 'lit' && sl.lit.k === 'q' && pl.lit.k === 'q' && sl.lit.v === pl.lit.v && sl.lit.unit === pl.lit.unit && sl.lit.per === pl.lit.per
    if (sameLit || canonicalJson(sl) === canonicalJson(pl))
      err(out, { code: 'literalDomain', former: 'program', field: 'meta.grids', value: m, path: [...at, m], message: `the ${m} grid spells the program's own grid: omit it (one form per meaning; a slot grid exists to differ)` })
  }
}

/** The type each defaulted-param label must describe; labels are prose, so
 *  only existence is checked (a label for a non-default is unknownName). */
export function checkLabels(labels: Record<string, string> | undefined, defaults: Record<string, Term> | undefined, out: TypeError[]): void {
  for (const k of Object.keys(labels ?? {}))
    if (!(k in (defaults ?? {}))) err(out, { code: 'unknownName', name: k, path: ['labels', k], message: `a label for ${k}, which has no default (labels name defaulted params in the "(with …)" append)` })
}

export type { Ty }
