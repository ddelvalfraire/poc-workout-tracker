/**
 * kit-verify.ts — verify step 8's two halves.
 *
 *   tsx kit-verify.ts tap <copy>     rewrite every OPS entry point in a scratch
 *                                    copy to call the recorder, and label tests
 *   tsx kit-verify.ts check <kit>    write ir-schema.json, validate every
 *                                    fixture against it, replay every fixture
 *                                    on the untouched oracle and diff it with
 *                                    the stored output, report schema coverage,
 *                                    and render SPEC.md and README.md
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Registry } from './checker'
import { GRANTS } from './checker'
import { BUDGET } from './engine'
import { decode, defFile, diff, encode, expand, OP_KIND, OPS, refTarget, registryOf, type EncodeHooks, type Fixture, type FixtureFile, type J, type Op, type RegistryFile } from './kit'
import { FORMERS, OP_SIGS, SCHEMA, validate, type Hit } from './kit-schema'
import { MAX_PERIOD_DAYS, MAX_WINDOW_DAYS } from './time'
import { UNITS } from './units'
import type { AnyDef } from './structure'

declare const process: { argv: string[]; exitCode?: number }
const [, , mode, dir] = process.argv
if (!dir) throw new Error('usage: tsx kit-verify.ts tap <copy> | check <kit>')
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as J
const jsons = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort()

// ── tap: the scratch copy's entry points call the recorder ──────────────────

function tap(copy: string) {
  const edit = (file: string, from: string | RegExp, to: string) => {
    const p = `${copy}/${file}`
    const src = readFileSync(p, 'utf8')
    const n = typeof from === 'string' ? src.split(from).length - 1 : (src.match(new RegExp(from.source, 'gm')) ?? []).length
    if (n !== 1) throw new Error(`tap: ${file} has ${n} matches for ${from}`)
    writeFileSync(p, src.replace(from, to))
  }
  const byFile = new Map<string, string[]>()
  for (const op of Object.keys(OPS)) {
    const i = op.indexOf('.')
    byFile.set(op.slice(0, i), [...(byFile.get(op.slice(0, i)) ?? []), op.slice(i + 1)])
  }
  for (const [mod, fns] of byFile) {
    for (const fn of fns) edit(`${mod}.ts`, new RegExp(`^export function ${fn}\\b`, 'm'), `function ${fn}__kit`)
    const p = `${copy}/${mod}.ts`
    writeFileSync(
      p,
      readFileSync(p, 'utf8') +
        fns.map((fn) => `\nexport function ${fn}(...a: any[]): any {\n  return (globalThis as any).__kitTap('${mod}.${fn}', ${fn}__kit, a)\n}\n`).join(''),
    )
  }
  edit('testkit.ts', 'export function suite(name: string) {', "export function suite(name: string) {\n  ;(globalThis as any).__kitTest?.(name, '', '(setup)')")
  edit('testkit.ts', '    try {\n      fn()', '    try {\n      ;(globalThis as any).__kitTest?.(name, ids, title)\n      fn()')
  edit('demo.ts', 'const report = (label: string, errs: TypeError[]) => {', 'const report = (label: string, errs: TypeError[]) => {\n  ;(globalThis as any).__kitLabel?.(label)')
  edit('demo.ts', 'const h = (s: string) => console.log(', "const h = (s: string) => void (globalThis as any).__kitTest?.('demo', '', s) || console.log(")
}

// ── check ───────────────────────────────────────────────────────────────────

interface Loaded {
  defsJ: Map<string, J>
  regsJ: Map<string, RegistryFile>
}
function load(kit: string): Loaded {
  const fx = `${kit}/fixtures`
  const defsJ = new Map<string, J>()
  for (const f of jsons(`${fx}/defs`)) {
    const j = read(`${fx}/defs/${f}`) as { ref: { id: string; version: number } }
    const key = `${j.ref.id}@${j.ref.version}`
    if (defFile(key) !== f) throw new Error(`check: ${f} holds ${key}`)
    defsJ.set(key, j as unknown as J)
  }
  const regsJ = new Map<string, RegistryFile>()
  for (const f of jsons(`${fx}/registries`)) regsJ.set(f.replace(/\.json$/, ''), read(`${fx}/registries/${f}`) as unknown as RegistryFile)
  return { defsJ, regsJ }
}

/** One replay environment: definitions shared, registries built once. */
function env(L: Loaded) {
  const defCache = new Map<string, AnyDef>()
  const defOf = (key: string): AnyDef => {
    const hit = defCache.get(key)
    if (hit) return hit
    const j = L.defsJ.get(key)
    if (!j) throw new Error(`no definition ${key}`)
    const d = decode(j, noHooks('a definition')) as AnyDef
    defCache.set(key, d)
    return d
  }
  const regCache = new Map<string, Registry>()
  const regIds = new WeakMap<Registry, string>()
  const regOf = (id: string): Registry => {
    const hit = regCache.get(id)
    if (hit) return hit
    const f = L.regsJ.get(id)
    if (!f) throw new Error(`no registry ${id}`)
    const r = registryOf(f, (j) => decode(j, { ...noHooks('a registry entry'), def: defOf }) as AnyDef)
    regCache.set(id, r)
    regIds.set(r, id)
    return r
  }
  const contentKey = new Map<string, string>([...L.defsJ].map(([k, j]) => [JSON.stringify(j), k]))
  const hooks: EncodeHooks = {
    def: (d) => contentKey.get(JSON.stringify(encode(d))) ?? null,
    registry: (r) => {
      const id = regIds.get(r)
      if (!id) throw new Error('an output names a registry the fixture did not pass')
      return id
    },
  }
  return { defOf, regOf, hooks }
}
const noHooks = (what: string) => ({
  def: (k: string): AnyDef => {
    throw new Error(`${what} cannot hold $def ${k}`)
  },
  registry: (k: string): Registry => {
    throw new Error(`${what} cannot hold $registry ${k}`)
  },
  fn: (k: string): never => {
    throw new Error(`${what} cannot hold $fn ${k}`)
  },
  ref: (k: string): never => {
    throw new Error(`${what} cannot hold $ref ${k}`)
  },
})

type Section = 'defs' | 'registries' | 'eval' | 'refusals' | 'prose'
interface Report {
  files: Record<Section, number>
  fixtures: Record<Section, number>
  byOp: Map<string, number>
  invalid: string[]
  mismatched: string[]
  hits: Record<Section, Hit[]>
  evaluated: Set<string>
  codes: Set<string>
  unparsed: string[]
  refusalOps: Set<string>
}

function replay(E: ReturnType<typeof env>, fx: Fixture, outputs: readonly (J | undefined)[], decoded: Map<string, unknown>): string | null {
  const consumed = new Map<string, number>()
  const stub = (id: string) => (...args: unknown[]) => {
    const calls = fx.world[id] ?? []
    const key = JSON.stringify(args.map((a) => encode(a, E.hooks)))
    const from = consumed.get(`${id}:${key}`) ?? 0
    let at = calls.findIndex((c, i) => i >= from && JSON.stringify(c.args) === key)
    if (at < 0) at = calls.findIndex((c) => JSON.stringify(c.args) === key)
    if (at < 0) throw new Error(`unrecorded call ${id}(${key.slice(0, 160)})`)
    consumed.set(`${id}:${key}`, at + 1)
    return decode(calls[at]!.ret, { ...noHooks('a recorded call'), def: E.defOf, registry: E.regOf })
  }
  const outHooks = {
    ...noHooks('an output'),
    def: E.defOf,
    registry: E.regOf,
    ref: (r: string): unknown => {
      if (!decoded.has(r)) decoded.set(r, decode(refTarget(r, outputs), outHooks))
      return decoded.get(r)
    },
  }
  const hooks = { ...outHooks, fn: stub }
  const args = fx.args.map((a) => decode(a, hooks))
  const f = OPS[fx.op] as unknown as (...a: unknown[]) => unknown
  let ret: unknown
  try {
    ret = f(...args)
  } catch (e) {
    if ('throws' in fx.expected) return (e as Error).message === fx.expected.throws ? null : `threw "${(e as Error).message}", want "${fx.expected.throws}"`
    return `threw: ${(e as Error).message}`
  }
  if ('throws' in fx.expected) return `returned, want a throw "${fx.expected.throws}"`
  const keepDefs = (k: string): J => ({ $def: k })
  const refs = (r: string) => refTarget(r, outputs)
  const d = diff(encode(ret, E.hooks), expand(fx.expected.ret, keepDefs, refs), true)
  if (d) return `ret ${d}`
  for (const [i, want] of Object.entries(fx.expected.mutated ?? {})) {
    const got = encode(args[Number(i)], { ...E.hooks, fn: () => 'fn' })
    const dm = diff(stripFns(got), stripFns(expand(want, keepDefs, refs)), true)
    if (dm) return `argument ${i} after the call: ${dm}`
  }
  return null
}
const stripFns = (j: J): J =>
  j === null || typeof j !== 'object' ? j : Array.isArray(j) ? j.map(stripFns) : '$fn' in j && Object.keys(j).length === 1 ? null : Object.fromEntries(Object.entries(j).map(([k, v]) => [k, stripFns(v)]))

const traceNodes = (j: J, out: Set<string>) => {
  if (j === null || typeof j !== 'object') return
  if (Array.isArray(j)) return j.forEach((x) => traceNodes(x, out))
  const o = j as Record<string, J>
  if ('node' in o && 'value' in o && 'kids' in o) {
    const k = (o['node'] as { k?: J } | null)?.k
    if (typeof k === 'string') out.add(k)
  }
  for (const v of Object.values(o)) traceNodes(v, out)
}

function check(kit: string): Report {
  writeFileSync(`${kit}/ir-schema.json`, `${JSON.stringify(SCHEMA, null, 1)}\n`)
  const L = load(kit)
  const E = env(L)
  const R: Report = {
    files: { defs: 0, registries: 0, eval: 0, refusals: 0, prose: 0 },
    fixtures: { defs: 0, registries: 0, eval: 0, refusals: 0, prose: 0 },
    byOp: new Map(),
    invalid: [],
    mismatched: [],
    hits: { defs: [], registries: [], eval: [], refusals: [], prose: [] },
    evaluated: new Set(),
    codes: new Set(),
    unparsed: [],
    refusalOps: new Set(),
  }
  const defsOf = (k: string) => {
    const j = L.defsJ.get(k)
    if (!j) throw new Error(`no definition ${k}`)
    return j
  }
  const bad = (where: string, errs: string[]) => errs.length && R.invalid.push(`${where}: ${errs.join(' | ')}`)
  /** A fixture validates strictly, or it says why its input does not parse
   *  and the strict schema agrees it does not. */
  const holds = (where: string, x: Fixture, strict: string, loose: string, hits: Hit[]) => {
    if (!x.inputSchemaErrors) return bad(where, validate(strict, x as unknown as J, hits))
    bad(where, validate(loose, x as unknown as J, hits))
    const { inputSchemaErrors: _e, ...rest } = x
    if (!validate(strict, rest as unknown as J, [], 1).length) R.invalid.push(`${where}: inputSchemaErrors is stale (the input parses)`)
  }
  for (const [k, j] of L.defsJ) {
    R.files.defs++
    R.fixtures.defs++
    bad(`defs/${defFile(k)}`, validate('AnyDef', j, R.hits.defs))
  }
  for (const [id, f] of L.regsJ) {
    R.files.registries++
    R.fixtures.registries++
    bad(`registries/${id}`, validate('RegistryFile', expand(f as unknown as J, defsOf, (r) => r), R.hits.registries))
  }
  for (const sec of ['eval', 'prose'] as const)
    for (const name of jsons(`${kit}/fixtures/${sec}`)) {
      const file = read(`${kit}/fixtures/${sec}/${name}`) as unknown as FixtureFile
      R.files[sec]++
      const outputs = file.fixtures.map((f) => ('ret' in f.expected ? (f.expected as unknown as J) : undefined))
      const full = expand(file as unknown as J, defsOf, (r) => refTarget(r, outputs)) as unknown as FixtureFile
      bad(`${sec}/${name} source`, validate('Source', full.source as unknown as J, []))
      full.fixtures.forEach((x, i) => holds(`${sec}/${name} #${i}`, x, 'FixtureStrict', 'FixtureUnparsed', R.hits[sec]))
      const decoded = new Map<string, unknown>()
      file.fixtures.forEach((fx, i) => {
        R.fixtures[sec]++
        R.byOp.set(fx.op, (R.byOp.get(fx.op) ?? 0) + 1)
        if (sec === 'eval' && 'ret' in fx.expected) traceNodes(fx.expected.ret, R.evaluated)
        const d = replay(E, fx, outputs, decoded)
        if (d) R.mismatched.push(`${sec}/${name} #${i} ${fx.op}: ${d}`)
      })
    }
  for (const name of jsons(`${kit}/fixtures/refusals`)) {
    const fx = read(`${kit}/fixtures/refusals/${name}`) as unknown as Fixture & { source: unknown }
    R.files.refusals++
    R.fixtures.refusals++
    R.codes.add(fx.expectedCode!)
    R.refusalOps.add(fx.op)
    holds(`refusals/${name}`, expand(fx as unknown as J, defsOf, (r) => r) as unknown as Fixture, 'RefusalFixture', 'RefusalUnparsed', R.hits.refusals)
    if (fx.inputSchemaErrors) R.unparsed.push(`${fx.expectedCode}: ${fx.label ?? name}`)
    const d = replay(E, fx, [], new Map())
    if (d) R.mismatched.push(`refusals/${name} ${fx.op}: ${d}`)
  }
  return R
}

// ── coverage and the rendered documents ─────────────────────────────────────

/** Every union branch and enumeration value the schema declares. */
function declared(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [name, s] of Object.entries(SCHEMA.$defs)) {
    const x = s as { 'x-union'?: string; 'x-disc'?: string; 'x-enum'?: string; oneOf?: unknown[]; enum?: unknown[] }
    if (x['x-enum']) out.set(x['x-enum'], (x.enum ?? []).map(String))
    if (x['x-union'] && x['x-union'] !== 'Op') {
      const tags = (x.oneOf ?? []).flatMap((b) => {
        const r = (b as { $ref?: string }).$ref
        const bb = (r ? SCHEMA.$defs[r.replace('#/$defs/', '')] : b) as { properties?: Record<string, { const?: string; enum?: string[] }> }
        const p = bb.properties?.[x['x-disc']!]
        return p?.const !== undefined ? [p.const] : (p?.enum ?? [])
      })
      out.set(name, tags)
    }
  }
  return out
}
const COVERED_KINDS = ['Term', 'AnyDef', 'Lit', 'Ty', 'BoundIR', 'Count', 'StepIR', 'Selector', 'Measure', 'CalQuery', 'EventQuery', 'AggQuery', 'Group', 'Rotation', 'Period', 'Frequency', 'Length', 'ExportDecl', 'XformOp', 'TypeError', 'IngestRefusal']
function coverage(R: Report) {
  const all = declared()
  const seen = (secs: Section[]) => {
    const m = new Map<string, Set<string>>()
    for (const s of secs) for (const [k, t] of R.hits[s]) (m.get(k) ?? m.set(k, new Set()).get(k)!).add(t)
    return m
  }
  const any = seen(['defs', 'registries', 'eval', 'refusals', 'prose'])
  const inDefs = seen(['defs'])
  const rows = COVERED_KINDS.map((k) => {
    const tags = all.get(k) ?? []
    const missAny = tags.filter((t) => !any.get(k)?.has(t))
    const missDefs = tags.filter((t) => !inDefs.get(k)?.has(t))
    return { k, n: tags.length, missAny, missDefs }
  })
  const notEvaluated = FORMERS.filter((f) => !R.evaluated.has(f))
  return { rows, notEvaluated }
}

/** A schema as a short sort name for the operation table. */
function sortText(s: Record<string, unknown>): string {
  if (typeof s['$ref'] === 'string') return (s['$ref'] as string).replace('#/$defs/', '')
  if (s['anyOf']) return (s['anyOf'] as Record<string, unknown>[]).map(sortText).join(' \\| ')
  if (s['const'] !== undefined) return JSON.stringify(s['const'])
  if (s['enum']) return (s['enum'] as unknown[]).map((x) => JSON.stringify(x)).join(' \\| ')
  if (s['type'] === 'array') return `${s['items'] && s['items'] !== false ? sortText(s['items'] as Record<string, unknown>) : 'tuple'}[]`
  if (s['type'] === 'object' && s['properties']) return `{${Object.keys(s['properties'] as object).join(', ')}}`
  if (s['type'] === 'object') return `record of ${sortText((s['additionalProperties'] ?? {}) as Record<string, unknown>)}`
  if (typeof s['type'] === 'string') return s['type'] as string
  return 'any'
}
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

function render(kit: string, R: Report, cov: ReturnType<typeof coverage>) {
  const manifest = read(`${kit}/fixtures/manifest.json`) as Record<string, J>
  const opRows = (Object.keys(OPS) as Op[]).map((op) => [
    `\`${op}\``,
    OP_KIND[op],
    OP_SIGS[op].args.map((a) => ('$opt' in a && a.$opt ? `${sortText(a.$opt as Record<string, unknown>)}?` : sortText(a as Record<string, unknown>))).join(', '),
    sortText(OP_SIGS[op].ret as Record<string, unknown>),
    String(R.byOp.get(op) ?? 0) + (op.startsWith('checkdefs.check') ? ' (+ refusals)' : ''),
  ])
  const grants = Object.entries(GRANTS).map(([p, caps]) => [p, (caps as readonly string[]).join(', ') || '(none)'])
  const units = Object.entries(UNITS).map(([u, d]) => [`\`${u}\``, d.dim, String(d.scale), d.prose(1), d.prose(2.5)])
  const covRows = cov.rows.map((r) => [r.k, String(r.n), r.missAny.join(', ') || '—', r.missDefs.join(', ') || '—'])
  const here = (f: string) => new URL(f, import.meta.url)
  const rationale = readFileSync(here('./rationale.md'), 'utf8')
  const between = (text: string, from: string, to: string) => {
    const a = text.indexOf(from)
    const b = text.indexOf(to, a + from.length)
    if (a < 0 || b < 0) throw new Error(`render: cannot find ${from} … ${to}`)
    return text.slice(a, b).trim()
  }
  const engineSrc = readFileSync(here('./engine.ts'), 'utf8')
  const lawsEngine = between(engineSrc, ' * LAWS', ' */')
    .split('\n')
    .map((l) => l.replace(/^ \* ?/, ''))
    .join('\n')
  const branches = (name: string) => (SCHEMA.$defs[name] as { oneOf: { properties: Record<string, { const?: string }> }[] }).oneOf
  const fieldsOf = (b: { properties: Record<string, unknown> }, skip: string[]) => Object.keys(b.properties).filter((k) => !skip.includes(k))
  const codeRows = (name: string, disc: string, skip: string[]) =>
    branches(name).map((b) => [`\`${b.properties[disc]!.const}\``, fieldsOf(b, [disc, ...skip]).map((f) => `\`${f}\``).join(', ') || '—'])
  const allCodes = [...branches('TypeError'), ...branches('IngestRefusal')].map((b) => b.properties['code']!.const!)
  const fill = (tpl: string) =>
    tpl
      .replace('{{TYPING}}', readFileSync(here('./kit-spec-typing.md'), 'utf8').trim().replace(/^## Typing\n+/, ''))
      .replace('{{REFUSAL_CODES}}', table(['code', 'fields'], codeRows('TypeError', 'code', ['path', 'message'])))
      .replace('{{INGEST_CODES}}', table(['code', 'fields'], codeRows('IngestRefusal', 'code', [])))
      .replace('{{ABSENCES}}', table(['cause', 'fields'], codeRows('Absence', 'k', [])))
      .replace('{{LAWS_ENGINE}}', '```\n' + lawsEngine + '\n```')
      .replace('{{LAWS_RATIONALE}}', between(rationale, '## Laws', '## Refusals').replace(/^## Laws\n+/, ''))
      .replace('{{R2_DECISIONS}}', between(rationale, '**R2 law decisions.**', '**Divergences found'))
      .replace('{{FORMER_COUNT}}', String(FORMERS.length))
      .replace('{{FORMERS}}', FORMERS.map((f) => `\`${f}\``).join(', '))
      .replace('{{GRANTS}}', table(['position', 'granted capabilities'], grants))
      .replace('{{UNITS}}', table(['unit', 'dimension', 'scale (canonical = n × scale)', 'prose(1)', 'prose(2.5)'], units))
      .replace('{{OPS}}', table(['operation', 'directory', 'arguments', 'returns', 'fixtures'], opRows))
      .replace('{{BUDGET}}', String(BUDGET))
      .replace('{{MAX_WINDOW_DAYS}}', String(MAX_WINDOW_DAYS))
      .replace('{{MAX_PERIOD_DAYS}}', String(MAX_PERIOD_DAYS))
      .replace(
        '{{COUNTS}}',
        table(
          ['directory', 'files', 'fixtures'],
          (['defs', 'registries', 'eval', 'refusals', 'prose'] as Section[]).map((s) => [`fixtures/${s}`, String(R.files[s]), String(R.fixtures[s])]),
        ),
      )
      .replace('{{COVERAGE}}', table(['union', 'branches', 'not exercised by any fixture', 'not in any corpus definition'], covRows))
      .replace('{{NOT_EVALUATED}}', cov.notEvaluated.map((f) => `\`${f}\``).join(', ') || 'none')
      .replace('{{CODES_COVERED}}', String(R.codes.size))
      .replace('{{CODES_MISSING}}', allCodes.filter((c) => !R.codes.has(c)).map((c) => `\`${c}\``).join(', ') || 'none')
      .replace('{{UNPARSED}}', R.unparsed.length ? '\n\n' + R.unparsed.map((u) => `- ${u}`).join('\n') : 'none')
      .replace('{{MANIFEST}}', '```json\n' + JSON.stringify({ capPerTestAndOp: manifest['capPerTestAndOp'], sampledOut: manifest['sampledOut'], duplicatesDropped: manifest['duplicatesDropped'], notExported: manifest['notExported'] }, null, 1) + '\n```')
  writeFileSync(`${kit}/SPEC.md`, fill(readFileSync(here('./kit-spec.md'), 'utf8')))
  writeFileSync(`${kit}/README.md`, fill(readFileSync(here('./kit-readme.md'), 'utf8')))
}

if (mode === 'tap') tap(dir)
else if (mode === 'check') {
  const R = check(dir)
  const cov = coverage(R)
  render(dir, R, cov)
  const total = R.fixtures.eval + R.fixtures.refusals + R.fixtures.prose
  for (const op of Object.keys(OPS) as Op[]) if (!R.byOp.get(op) && !R.refusalOps.has(op)) R.invalid.push(`OPS lists ${op}, but no fixture exercises it: drop it or add the test`)
  for (const x of R.invalid.slice(0, 20)) console.log(`  INVALID ${x}`)
  for (const x of R.mismatched.slice(0, 20)) console.log(`  MISMATCH ${x}`)
  if (R.invalid.length || R.mismatched.length) {
    console.log(`kit: ${R.invalid.length} invalid, ${R.mismatched.length} mismatched`)
    process.exitCode = 1
  } else
    console.log(
      `8. handoff kit: ${R.fixtures.defs} definitions, ${R.fixtures.registries} registries, ${R.fixtures.eval} eval / ${R.fixtures.refusals} refusal / ${R.fixtures.prose} prose fixtures; all ${total + R.fixtures.defs + R.fixtures.registries} validate against ir-schema.json and the ${total} replays match the oracle`,
    )
} else throw new Error(`kit-verify: unknown mode ${mode}`)
