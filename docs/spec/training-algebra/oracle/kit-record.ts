/**
 * kit-record.ts — the fixture recorder. Loaded only inside the scratch copy
 * verify step 8 makes, where every OPS entry point is rewritten to call
 * `__kitTap` (kit-verify.ts `tap`). The suites then run unchanged, and each
 * TOP-LEVEL call of an entry point (one a test makes, not one the oracle makes
 * inside another) becomes a fixture: its arguments, the calls it made through
 * every function-valued argument (its world), and what it returned.
 */
import type { Registry } from './checker'
import * as ER from './endurance-rehab'
import { validate } from './kit-schema'
import { defFile, defKey, encode, expand, fnv, isDef, isRegistry, OP_KIND, registryData, type Call, type EncodeHooks, type Fixture, type J, type Op, type RegistryFile, type Source } from './kit'
import * as P from './programs'
import type { AnyDef } from './structure'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

type Fn = (...a: unknown[]) => unknown
interface G {
  __kitTap?: (op: Op, impl: Fn, args: unknown[]) => unknown
  __kitTest?: (suite: string, ids: string, title: string) => void
  __kitLabel?: (label: string) => void
}
const g = globalThis as unknown as G
/** The suites and the demo print as they run; the kit's own report goes to stderr. */
console.log = () => {}

/** At most this many fixtures of one of these operations per test: L1's 200
 *  random argument sets per library function, and the policy-composition
 *  sweeps, are sampled rather than exported whole. Every other call is kept. */
const CAP: Partial<Record<Op, number>> = { 'evaluate.evaluate': 24, 'issue.applyUse': 16 }
/** Outputs below this size are inlined rather than shared by `$ref`. */
const REF_MIN = 400

// ── the corpus definitions ──────────────────────────────────────────────────

const corpus = new Map<string, AnyDef>()
for (const x of [...P.PUBLISHED, ...ER.PUBLISHED] as readonly (AnyDef | { def: AnyDef })[]) {
  const d = 'kind' in x ? x : x.def
  corpus.set(defKey(d), d)
}
const corpusJson = new Map<string, string>([...corpus].map(([k, d]) => [JSON.stringify(encode(d)), k]))
const corpusDef = (k: string): J => encode(corpus.get(k)!)
const defIds = new WeakMap<object, string | null>()
const internDef = (d: AnyDef): string | null => {
  if (defIds.has(d)) return defIds.get(d)!
  const k = corpus.get(defKey(d)) === d ? defKey(d) : (corpusJson.get(JSON.stringify(encode(d))) ?? null)
  defIds.set(d, k)
  return k
}

// ── registries ──────────────────────────────────────────────────────────────

const registries = new Map<string, RegistryFile>()
const regIds = new WeakMap<Registry, string>()
const internRegistry = (r: Registry): string => {
  const hit = regIds.get(r)
  if (hit) return hit
  const data = registryData(r, (d) => (internDef(d) ? { $def: internDef(d)! } : encode(d)))
  const id = `reg-${fnv(JSON.stringify(data))}`
  registries.set(id, data)
  regIds.set(r, id)
  return id
}

// ── the current test ────────────────────────────────────────────────────────

type Kind = 'eval' | 'prose'
const kindOf = (op: Op): Kind => (OP_KIND[op] === 'prose' ? 'prose' : 'eval')
interface FileRec {
  source: Source
  lists: Record<Kind, Fixture[]>
  /** Plain encodings of stored outputs, for sharing by `$ref` within one written file. */
  shared: Record<Kind, Map<object, string>>
  counts: Map<string, number>
  pendingChecks: Fixture[]
}
const files: FileRec[] = []
const refusals: { source: Source; fixture: Fixture }[] = []
let current: FileRec | null = null
function enter(source: Source) {
  current = { source, lists: { eval: [], prose: [] }, shared: { eval: new Map(), prose: new Map() }, counts: new Map(), pendingChecks: [] }
  files.push(current)
}
g.__kitTest = (suite, ids, title) => enter({ suite, test: title, ids: ids.split(/\s+/).filter(Boolean) })
g.__kitLabel = (label) => {
  if (!current) return
  for (const f of current.pendingChecks) f.label = label
  current.pendingChecks = []
}

export const STATS = { recorded: 0, sampled: new Map<string, number>(), duplicates: 0, skipped: new Map<string, number>() }
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

// ── arming function-valued arguments ────────────────────────────────────────

interface Armed {
  ids: Map<Fn, string>
  calls: Map<string, Call[]>
  wrap: Map<Fn, Fn>
  failed: string | null
}
const fnFree = new WeakMap<object, boolean>()
function hasFn(x: unknown): boolean {
  if (typeof x === 'function') return true
  if (!x || typeof x !== 'object' || isRegistry(x)) return false
  const hit = fnFree.get(x)
  if (hit !== undefined) return !hit
  const vals = x instanceof Map ? [...x.values()] : x instanceof Set ? [...x] : Object.values(x)
  const r = vals.some(hasFn)
  fnFree.set(x, !r)
  return r
}
const plainHooks: EncodeHooks = { def: internDef, registry: internRegistry }
/** Replace every function inside `x` by a wrapper that records its calls;
 *  containers on the way are copied, everything else keeps its identity. */
function arm(x: unknown, a: Armed, at: string): unknown {
  if (typeof x === 'function') {
    const f = x as Fn
    const seen = a.wrap.get(f)
    if (seen) return seen
    const calls: Call[] = []
    const w: Fn = function (this: unknown, ...args: unknown[]) {
      const r = f.apply(this, args)
      try {
        calls.push({ args: args.map((v) => encode(v, plainHooks)), ret: encode(r, plainHooks) })
      } catch (e) {
        a.failed = `a call of ${at} cannot be encoded: ${(e as Error).message}`
      }
      return r
    }
    a.wrap.set(f, w)
    a.ids.set(w, at)
    a.calls.set(at, calls)
    return w
  }
  if (!hasFn(x)) return x
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [k, arm(v, a, `${at}.${String(k)}`)]))
  if (Array.isArray(x)) return x.map((v, i) => arm(v, a, `${at}[${i}]`))
  return Object.fromEntries(Object.entries(x as object).map(([k, v]) => [k, arm(v, a, `${at}.${k}`)]))
}

// ── the tap ─────────────────────────────────────────────────────────────────

const refusalOf = (op: Op, ret: unknown, args: unknown[]): { code: string; path: (string | number)[] } | null => {
  const first = (es: { code: string; path: (string | number)[] }[]) => (es.length ? { code: es[0]!.code, path: es[0]!.path } : null)
  if (op === 'checker.top') return first(args[4] as { code: string; path: (string | number)[] }[])
  if (OP_KIND[op] === 'check' && Array.isArray(ret)) {
    if (op === 'checkdefs.checkProgram') return first((ret as { errors: { code: string; path: (string | number)[] }[] }[]).flatMap((x) => x.errors))
    return first(ret as { code: string; path: (string | number)[] }[])
  }
  const r = ret as { result?: { k: string; refusal?: { code: string } }; k?: string; refusal?: { code: string }; issued?: { code?: string }; code?: string } | null
  if (!r || typeof r !== 'object') return null
  if (r.result?.k === 'refused') return { code: r.result.refusal!.code, path: [] }
  if (r.k === 'refused') return { code: r.refusal!.code, path: [] }
  if (typeof r.issued?.code === 'string') return { code: r.issued.code, path: [] }
  return null
}

const seenFixtures = new Set<string>()
let depth = 0
g.__kitTap = (op, impl, args) => {
  if (depth > 0 || !current) return impl(...args)
  const file = current
  depth++
  try {
    const n = file.counts.get(op) ?? 0
    if (n >= (CAP[op] ?? Infinity)) {
      bump(STATS.sampled, op)
      return impl(...args)
    }
    const a: Armed = { ids: new Map(), calls: new Map(), wrap: new Map(), failed: null }
    const armed = args.map((x, i) => arm(x, a, `arg${i}`))
    const fnHook = (f: (...x: never[]) => unknown) => {
      const id = a.ids.get(f as Fn)
      if (!id) throw new Error('an unarmed function')
      return id
    }
    const shared = file.shared[kindOf(op)]
    const refHook = (o: object) => shared.get(o) ?? null
    let pre: J[]
    let stored: J[]
    try {
      pre = armed.map((x) => encode(x, { ...plainHooks, fn: fnHook }))
      stored = armed.map((x) => encode(x, { ...plainHooks, fn: fnHook, ref: refHook }))
    } catch (e) {
      bump(STATS.skipped, `${op}: ${(e as Error).message.replace(/ at .*$/, '')}`)
      return impl(...args)
    }
    let ret: unknown
    let threw: unknown = null
    let didThrow = false
    try {
      ret = impl(...armed)
    } catch (e) {
      threw = e
      didThrow = true
    }
    if (a.failed) {
      bump(STATS.skipped, `${op}: ${a.failed}`)
    } else {
      try {
        const world = Object.fromEntries(a.calls)
        const key = fnv(op + JSON.stringify(pre) + JSON.stringify(world))
        if (seenFixtures.has(key)) STATS.duplicates++
        else {
          seenFixtures.add(key)
          const list = file.lists[kindOf(op)]
          const i = list.length
          const mutated = didThrow ? {} : Object.fromEntries(armed.flatMap((x, k) => {
            const p = encode(x, { ...plainHooks, fn: fnHook })
            return JSON.stringify(p) === JSON.stringify(pre[k]) ? [] : [[String(k), p]]
          }))
          const withMut = (e: { ret: J }): Fixture['expected'] => (Object.keys(mutated).length ? { ...e, mutated } : e)
          const sizes = new WeakMap<object, number>()
          const size = (j: J): number => (j === null || typeof j !== 'object' ? String(j).length + 2 : (sizes.get(j) ?? 2))
          const visit = (o: object, j: J, segs: readonly string[]) => {
            const n = Array.isArray(j) ? j.reduce((t: number, x) => t + size(x) + 1, 2) : Object.entries(j as Record<string, J>).reduce((t, [k, x]) => t + k.length + 4 + size(x), 2)
            sizes.set(j as object, n)
            if (n >= REF_MIN && !shared.has(o)) shared.set(o, ['#' + i, 'ret', ...segs.map((x) => x.replaceAll('~', '~0').replaceAll('/', '~1'))].join('/'))
          }
          const expected: Fixture['expected'] = didThrow ? { throws: (threw as Error).message } : withMut({ ret: encode(ret, { ...plainHooks, ref: refHook, visit }) })
          const fx: Fixture = { op, args: stored, world, expected }
          const cx = armed.find((x) => !!x && typeof x === 'object' && 'zoom' in (x as object)) as { zoom?: string } | undefined
          if (OP_KIND[op] === 'prose') Object.assign(fx, { ...(cx?.zoom ? { zoom: cx.zoom } : {}), locale: 'en-GB (oracle)' })
          const refused = didThrow ? null : refusalOf(op, ret, armed)
          const plainExpected: Fixture['expected'] = didThrow ? expected : withMut({ ret: encode(ret, plainHooks) })
          if (OP_KIND[op] === 'check') {
            // Authoring JSON need not parse as IR; say so on the fixture, and the verifier holds it to that.
            const errs = validate('FixtureStrict', expand({ op, args: pre, world, expected: plainExpected } as unknown as J, corpusDef, (r) => r), [], 3)
            if (errs.length) fx.inputSchemaErrors = errs
          }
          if (refused) {
            const own: Fixture = { op, args: pre, world, expected: plainExpected, expectedCode: refused.code, expectedPath: refused.path }
            if (fx.inputSchemaErrors) own.inputSchemaErrors = fx.inputSchemaErrors
            refusals.push({ source: file.source, fixture: own })
            file.pendingChecks.push(own)
          }
          if (!(refused && OP_KIND[op] === 'check')) {
            list.push(fx)
            if (OP_KIND[op] === 'check') file.pendingChecks.push(fx)
          } else for (const [o, r] of [...shared]) if (r.startsWith(`#${i}/`)) shared.delete(o)
          file.counts.set(op, n + 1)
          STATS.recorded++
        }
      } catch (e) {
        bump(STATS.skipped, `${op}: ${(e as Error).message.replace(/ at .*$/, '')}`)
      }
    }
    if (didThrow) throw threw
    return ret
  } finally {
    depth--
  }
}

// ── writing the kit ─────────────────────────────────────────────────────────

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
const pretty = (x: unknown) => `${JSON.stringify(x, null, 1)}\n`

export function writeKit(out: string) {
  const fx = `${out}/fixtures`
  rmSync(fx, { recursive: true, force: true })
  for (const d of ['defs', 'registries', 'eval', 'refusals', 'prose']) mkdirSync(`${fx}/${d}`, { recursive: true })
  for (const [k, d] of corpus) writeFileSync(`${fx}/defs/${defFile(k)}`, pretty(encode(d)))
  for (const [id, r] of registries) writeFileSync(`${fx}/registries/${id}.json`, pretty(r))
  const counts = { eval: 0, prose: 0, refusals: refusals.length }
  const names = new Map<string, number>()
  const nameOf = (dir: string, s: Source, label?: string) => {
    const base = `${slug(s.suite)}.${slug(label ?? s.test) || 'setup'}`
    const k = (names.get(`${dir}/${base}`) ?? 0) + 1
    names.set(`${dir}/${base}`, k)
    return k === 1 ? base : `${base}.${k}`
  }
  for (const f of files)
    for (const kind of ['eval', 'prose'] as const) {
      const list = f.lists[kind]
      if (!list.length) continue
      writeFileSync(`${fx}/${kind}/${nameOf(kind, f.source)}.json`, `{"source": ${JSON.stringify(f.source)}, "fixtures": [\n${list.map((x) => JSON.stringify(x)).join(',\n')}\n]}\n`)
      counts[kind] += list.length
    }
  for (const r of refusals) writeFileSync(`${fx}/refusals/${nameOf('refusals', r.source, r.fixture.label ?? r.fixture.expectedCode)}.json`, JSON.stringify({ source: r.source, ...r.fixture }) + '\n')
  const manifest = {
    generatedBy: 'synthesis/kit-gen.ts (verify.sh step 8)',
    corpusDefs: corpus.size,
    registries: registries.size,
    fixtures: counts,
    capPerTestAndOp: CAP,
    sampledOut: Object.fromEntries(STATS.sampled),
    duplicatesDropped: STATS.duplicates,
    notExported: Object.fromEntries(STATS.skipped),
  }
  writeFileSync(`${out}/fixtures/manifest.json`, pretty(manifest))
  return manifest
}
