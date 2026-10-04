/**
 * kit.ts — the language handoff kit's shared core: the canonical JSON codec,
 * the structural comparator, and the operation table that names every oracle
 * entry point a fixture can exercise.
 *
 * The codec is the one place runtime-only shapes become JSON. A Set is
 * `{"$set": [...]}`, a Map `{"$map": [[k, v], ...]}`, a non-finite number
 * `{"$num": "Infinity"}`, a function argument `{"$fn": id}` (its calls are
 * recorded in the fixture's `world`), a registry `{"$registry": id}`. Two
 * sharing forms are expanded before validation: `{"$def": key}` names a
 * corpus definition in fixtures/defs, and `{"$ref": "#i/ret/..."}` names the
 * stored output of an earlier fixture in the same file.
 */
import type { Registry } from './checker'
import { publish } from './checkdefs'
import { describe, phrase } from './describe'
import { adherenceText, bindingArgs, describeMacroPhases, describeProgram, describeSlot, dueText, headline, macroHeadline, stackingText } from './describe-defs'
import { explain, sessionText, transitionText, valueText } from './describe-run'
import { checkFn, checkMacro, checkProgram, checkScheme, writeSet } from './checkdefs'
import { top } from './checker'
import { evaluate } from './evaluate'
import { applyUse, currentView, resolveLive, setsDue, sinkField } from './issue'
import { verdictOf } from './judge'
import { project, projectMacro } from './project'
import { BASE_VOCAB, type Vocab } from './registry'
import { activate, exportsOf, ingest, prescribe, replay, step } from './step'
import type { AnyDef } from './structure'
import { activate as calActivate, calendarSpecOf, completedFraction, dueVerdict, feasibility, occurrenceOf, reconcile, stepCalendar } from './time'
import { applyXform } from './xform'

export type J = null | boolean | number | string | J[] | { [k: string]: J }
type Fn = (...a: never[]) => unknown

/**
 * Every oracle entry point a fixture can name, as `module.function`. The
 * recorder taps exactly these (verify step 8 rewrites them in a scratch copy),
 * and the verifier calls exactly these to replay a fixture.
 */
export const OPS = {
  'evaluate.evaluate': evaluate,
  'issue.sinkField': sinkField,
  'issue.applyUse': applyUse,
  'issue.currentView': currentView,
  'issue.resolveLive': resolveLive,
  'issue.setsDue': setsDue,
  'xform.applyXform': applyXform,
  'judge.verdictOf': verdictOf,
  'step.activate': activate,
  'step.step': step,
  'step.ingest': ingest,
  'step.replay': replay,
  'step.prescribe': prescribe,
  'step.exportsOf': exportsOf,
  'project.project': project,
  'project.projectMacro': projectMacro,
  'time.activate': calActivate,
  'time.reconcile': reconcile,
  'time.stepCalendar': stepCalendar,
  'time.dueVerdict': dueVerdict,
  'time.feasibility': feasibility,
  'time.occurrenceOf': occurrenceOf,
  'time.completedFraction': completedFraction,
  'time.calendarSpecOf': calendarSpecOf,
  'checker.top': top,
  'checkdefs.checkFn': checkFn,
  'checkdefs.checkScheme': checkScheme,
  'checkdefs.checkProgram': checkProgram,
  'checkdefs.checkMacro': checkMacro,
  'checkdefs.writeSet': writeSet,
  'describe.describe': describe,
  'describe.phrase': phrase,
  'describe-defs.describeProgram': describeProgram,
  'describe-defs.describeSlot': describeSlot,
  'describe-defs.describeMacroPhases': describeMacroPhases,
  'describe-defs.headline': headline,
  'describe-defs.macroHeadline': macroHeadline,
  'describe-defs.stackingText': stackingText,
  'describe-defs.dueText': dueText,
  'describe-defs.adherenceText': adherenceText,
  'describe-defs.bindingArgs': bindingArgs,
  'describe-run.sessionText': sessionText,
  'describe-run.valueText': valueText,
  'describe-run.explain': explain,
  'describe-run.transitionText': transitionText,
} as const satisfies Record<string, Fn>
export type Op = keyof typeof OPS

/** Which fixture directory an operation's fixtures land in. */
export const OP_KIND: { [K in Op]: 'eval' | 'check' | 'prose' } = {
  'evaluate.evaluate': 'eval',
  'issue.sinkField': 'eval',
  'issue.applyUse': 'eval',
  'issue.currentView': 'eval',
  'issue.resolveLive': 'eval',
  'issue.setsDue': 'eval',
  'xform.applyXform': 'eval',
  'judge.verdictOf': 'eval',
  'step.activate': 'eval',
  'step.step': 'eval',
  'step.ingest': 'eval',
  'step.replay': 'eval',
  'step.prescribe': 'eval',
  'step.exportsOf': 'eval',
  'project.project': 'eval',
  'project.projectMacro': 'eval',
  'time.activate': 'eval',
  'time.reconcile': 'eval',
  'time.stepCalendar': 'eval',
  'time.dueVerdict': 'eval',
  'time.feasibility': 'eval',
  'time.occurrenceOf': 'eval',
  'time.completedFraction': 'eval',
  'time.calendarSpecOf': 'eval',
  'checker.top': 'check',
  'checkdefs.checkFn': 'check',
  'checkdefs.checkScheme': 'check',
  'checkdefs.checkProgram': 'check',
  'checkdefs.checkMacro': 'check',
  'checkdefs.writeSet': 'eval',
  'describe.describe': 'prose',
  'describe.phrase': 'prose',
  'describe-defs.describeProgram': 'prose',
  'describe-defs.describeSlot': 'prose',
  'describe-defs.describeMacroPhases': 'prose',
  'describe-defs.headline': 'prose',
  'describe-defs.macroHeadline': 'prose',
  'describe-defs.stackingText': 'prose',
  'describe-defs.dueText': 'prose',
  'describe-defs.adherenceText': 'prose',
  'describe-defs.bindingArgs': 'prose',
  'describe-run.sessionText': 'prose',
  'describe-run.valueText': 'prose',
  'describe-run.explain': 'prose',
  'describe-run.transitionText': 'prose',
}

// ── fixtures ────────────────────────────────────────────────────────────────

export interface Source {
  suite: string
  test: string
  ids: string[]
}
/** One recorded call of a function-valued argument. */
export interface Call {
  args: J[]
  ret: J
}
export type Expected = { ret: J; mutated?: Record<string, J> } | { throws: string }
export interface Fixture {
  op: Op
  args: J[]
  /** The recorded calls of every `$fn` argument, by id. */
  world: Record<string, Call[]>
  expected: Expected
  /** A refusal's first code and path, for the {input, expectedCode, expectedPath} reading. */
  expectedCode?: string
  expectedPath?: (string | number)[]
  label?: string
  /** A refusal whose input does not parse as IR: why (see RefusalUnparsed). */
  inputSchemaErrors?: string[]
  zoom?: string
  locale?: string
}
export interface FixtureFile {
  source: Source
  fixtures: Fixture[]
}
export interface RegistryFile {
  /** Publication order: a corpus key, or an inline definition. */
  entries: J[]
  vocab: 'base' | J
}

// ── the codec ───────────────────────────────────────────────────────────────

export const isRegistry = (x: unknown): x is Registry => !!x && typeof x === 'object' && (x as Registry).fns instanceof Map && (x as Registry).seq instanceof Map && 'vocab' in x
export const isDef = (x: unknown): x is AnyDef => {
  const o = x as { kind?: unknown; ref?: { id?: unknown } } | null
  return !!o && typeof o === 'object' && ['fn', 'scheme', 'program', 'macro'].includes(o.kind as string) && typeof o.ref?.id === 'string'
}
export const defKey = (d: AnyDef) => `${d.ref.id}@${d.ref.version}`
export const defFile = (key: string) => `${key.replace(/\//g, '.')}.json`

export interface EncodeHooks {
  /** A corpus definition's key when `o` equals it, else null. */
  def?(o: AnyDef): string | null
  registry?(r: Registry): string
  fn?(f: Fn): string
  /** A sharing reference to an earlier stored output, else null. */
  ref?(o: object): string | null
  /** Called after each object or array is encoded, children first, with its
   *  path segments from the root of the encoded value. */
  visit?(o: object, j: J, segs: readonly string[]): void
}

const WRAPPERS = ['$set', '$map', '$num', '$fn', '$registry', '$def', '$ref']

export function encode(x: unknown, h: EncodeHooks = {}, at = '$', segs: readonly string[] = []): J {
  if (x === null) return null
  switch (typeof x) {
    case 'string':
    case 'boolean':
      return x
    case 'number':
      return Number.isFinite(x) ? (Object.is(x, -0) ? 0 : x) : { $num: String(x) }
    case 'function':
      if (!h.fn) throw new Error(`codec: a function at ${at} and no fn hook`)
      return { $fn: h.fn(x as Fn) }
    case 'undefined':
      throw new Error(`codec: undefined at ${at}`)
    case 'object':
      break
    default:
      throw new Error(`codec: cannot encode a ${typeof x} at ${at}`)
  }
  const o = x as object
  const kid = (v: unknown, a: string, s: string) => encode(v, h, a, h.visit ? [...segs, s] : segs)
  if (isRegistry(o)) {
    if (!h.registry) throw new Error(`codec: a registry at ${at} and no registry hook`)
    return { $registry: h.registry(o) }
  }
  if (o instanceof Set) return { $set: [...o].map((v, i) => encode(v, h, `${at}{${i}}`)) }
  if (o instanceof Map) return { $map: [...o].map(([k, v], i) => [encode(k, h, `${at}<${i}>`), encode(v, h, `${at}<${i}>`)]) }
  const r = h.ref?.(o)
  if (r) return { $ref: r }
  let out: J
  if (Array.isArray(o)) out = o.map((v, i) => kid(v, `${at}[${i}]`, String(i)))
  else {
    if (Object.getPrototypeOf(o) !== Object.prototype && Object.getPrototypeOf(o) !== null) throw new Error(`codec: a ${o.constructor?.name} at ${at}`)
    const k = h.def && isDef(o) ? h.def(o) : null
    if (k) return { $def: k }
    const rec: { [k: string]: J } = {}
    for (const [k2, v] of Object.entries(o)) if (v !== undefined) rec[k2] = kid(v, `${at}.${k2}`, k2)
    const keys = Object.keys(rec)
    if (keys.length === 1 && WRAPPERS.includes(keys[0]!)) throw new Error(`codec: data at ${at} looks like a ${keys[0]} wrapper`)
    out = rec
  }
  h.visit?.(o, out, segs)
  return out
}

export interface DecodeHooks {
  def(key: string): AnyDef
  registry(id: string): Registry
  fn(id: string): Fn
  ref(r: string): unknown
}
const wrapper = (j: { [k: string]: J }): string | null => {
  const ks = Object.keys(j)
  return ks.length === 1 && WRAPPERS.includes(ks[0]!) ? ks[0]! : null
}
export function decode(j: J, h: DecodeHooks): unknown {
  if (j === null || typeof j !== 'object') return j
  if (Array.isArray(j)) return j.map((x) => decode(x, h))
  const w = wrapper(j)
  const v = w ? j[w]! : null
  switch (w) {
    case '$set':
      return new Set((v as J[]).map((x) => decode(x, h)))
    case '$map':
      return new Map((v as [J, J][]).map(([a, b]) => [decode(a, h), decode(b, h)]))
    case '$num':
      return Number(v)
    case '$fn':
      return h.fn(v as string)
    case '$registry':
      return h.registry(v as string)
    case '$def':
      return h.def(v as string)
    case '$ref':
      return h.ref(v as string)
  }
  return Object.fromEntries(Object.entries(j).map(([k, x]) => [k, decode(x, h)]))
}

/** Expand the two sharing forms, so a fixture validates as plain canonical JSON. */
export function expand(j: J, defs: (key: string) => J, ref: (r: string) => J): J {
  if (j === null || typeof j !== 'object') return j
  if (Array.isArray(j)) return j.map((x) => expand(x, defs, ref))
  const w = wrapper(j)
  if (w === '$def') return defs(j[w] as string)
  if (w === '$ref') return expand(ref(j[w] as string), defs, ref)
  return Object.fromEntries(Object.entries(j).map(([k, x]) => [k, expand(x, defs, ref)]))
}

/** Walk a `$ref` path ("#3/ret/ledger/head") inside the stored outputs of a
 *  file. A segment escapes `~` as `~0` and `/` as `~1` (RFC 6901). */
export function refTarget(r: string, outputs: readonly (J | undefined)[]): J {
  const [head, ...path] = r.split('/')
  let x: J | undefined = outputs[Number(head!.slice(1))]
  for (const seg of path) {
    const p = seg.replaceAll('~1', '/').replaceAll('~0', '~')
    if (p === 'ret' && x && typeof x === 'object' && !Array.isArray(x) && 'ret' in x) x = (x as { ret: J }).ret
    else x = Array.isArray(x) ? x[Number(p)] : x && typeof x === 'object' ? (x as { [k: string]: J })[p] : undefined
  }
  if (x === undefined) throw new Error(`codec: dangling ${r}`)
  return x
}

// ── the comparator ──────────────────────────────────────────────────────────

const EPS = 1e-9
const sameNum = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b))
/** Fields whose exact value the conformance protocol does not require
 *  (hashing is open, refusal and error messages are informative). The TS
 *  replay compares them too (`strict`). */
const HASHED = /@[0-9a-f]{8}$/
export function diff(a: J, b: J, strict: boolean, at = '$'): string | null {
  if (typeof a === 'number' && typeof b === 'number') return sameNum(a, b) ? null : `${at}: ${a} ≠ ${b}`
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : `${at}: ${JSON.stringify(a)?.slice(0, 120)} ≠ ${JSON.stringify(b)?.slice(0, 120)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: length ${a.length} ≠ ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i]!, b[i]!, strict, `${at}[${i}]`)
      if (d) return d
    }
    return null
  }
  const oa = a as { [k: string]: J }
  const ob = b as { [k: string]: J }
  if (wrapper(oa) === '$set' && wrapper(ob) === '$set') {
    const sa = (oa['$set'] as J[]).map((x) => JSON.stringify(x)).sort()
    const sb = (ob['$set'] as J[]).map((x) => JSON.stringify(x)).sort()
    return sa.join('\n') === sb.join('\n') ? null : `${at}: sets differ`
  }
  const ka = Object.keys(oa).sort()
  const kb = Object.keys(ob).sort()
  if (ka.join() !== kb.join()) return `${at}: keys {${ka.join(',')}} ≠ {${kb.join(',')}}`
  for (const k of ka) {
    const x = oa[k]!
    const y = ob[k]!
    if (!strict && (k === 'programHash' || k === 'message')) continue
    if (!strict && typeof x === 'string' && typeof y === 'string' && HASHED.test(x) && HASHED.test(y)) {
      if (x.slice(0, -9) !== y.slice(0, -9)) return `${at}.${k}: ${x} ≠ ${y}`
      continue
    }
    const d = diff(x, y, strict, `${at}.${k}`)
    if (d) return d
  }
  return null
}

// ── registries ──────────────────────────────────────────────────────────────

/** A registry as data: its publication log in order, and its vocabulary. */
export function registryData(r: Registry, def: (d: AnyDef) => J): RegistryFile {
  const all = new Map<string, AnyDef>([...r.fns, ...r.schemes, ...r.programs, ...r.macros])
  if (all.size !== r.seq.size || [...all.keys()].some((k) => !r.seq.has(k))) throw new Error('codec: a registry whose definitions and publication order disagree')
  const entries = [...r.seq.entries()].sort((x, y) => x[1] - y[1]).map(([k]) => def(all.get(k)!))
  return { entries, vocab: r.vocab === BASE_VOCAB ? 'base' : encode(r.vocab) }
}
export function registryOf(f: RegistryFile, def: (j: J) => AnyDef): Registry {
  return publish(
    f.entries.map((e) => def(e)),
    f.vocab === 'base' ? BASE_VOCAB : (decode(f.vocab, NO_HOOKS) as Vocab),
  )
}
const NO_HOOKS: DecodeHooks = {
  def: () => {
    throw new Error('codec: no def hook')
  },
  registry: () => {
    throw new Error('codec: no registry hook')
  },
  fn: () => {
    throw new Error('codec: no fn hook')
  },
  ref: () => {
    throw new Error('codec: no ref hook')
  },
}

/** FNV-1a over a string's UTF-16 code units, as ports.ts hashOf does over JSON. */
export function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
