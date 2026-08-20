/**
 * Codemod: lifts hardcoded JSX copy into messages/en.json and rewrites the
 * call sites to next-intl.
 *
 *   npx tsx scripts/i18n-extract.ts report
 *   npx tsx scripts/i18n-extract.ts apply "src/app/trophies/**\/*.tsx"
 *
 * Why a repo-owned script rather than a package: every off-the-shelf
 * extractor targets a different runtime. i18next-cli's `instrument` emits
 * i18next idioms (useTranslation/t) and has no notion of Server Components;
 * Lingui's extractor only reads its own macros; Paraglide compiles rather
 * than extracts. next-intl's API — useTranslations in sync components,
 * `await getTranslations` in async ones — has no extractor, and that
 * server/client split is exactly the part that must not be guessed.
 *
 * DESIGN RULE — this codemod does the mechanical majority and REFUSES the
 * rest. Anything where a wrong rewrite would be silent (text interleaved
 * with expressions, so the message needs ICU arguments; a literal outside a
 * component; a component it cannot classify) is left untouched and printed
 * as a skip. A codemod that guesses at interpolation produces plausible
 * broken copy, which is worse than copy it never touched.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  Project,
  Node,
  SyntaxKind,
  QuoteKind,
  IndentationText,
  type SourceFile,
  type JsxText,
} from 'ts-morph'

const ROOT = process.cwd()
const CATALOG = join(ROOT, 'messages', 'en.json')

/** Longest key we generate from a sentence — beyond this it stops reading like a key. */
const MAX_KEY_WORDS = 5

export interface Skip {
  file: string
  line: number
  text: string
  reason: string
}

/**
 * Namespace from the file's own name, falling back to its directory for
 * Next's structural filenames. Keeps namespaces short (Trophies, not
 * AppTrophiesPage) at the cost of possible collisions, which `apply`
 * reports rather than silently merging.
 */
export function namespaceFor(relativePath: string): string {
  const parts = relativePath.replace(/\.tsx?$/, '').split('/')
  const structural = new Set(['page', 'layout', 'template', 'index', 'route', 'default'])
  let name = parts[parts.length - 1]
  let i = parts.length - 2
  while (structural.has(name) && i >= 0) {
    name = parts[i]
    i -= 1
  }
  // Route groups (marketing) and dynamic segments [id] are not names.
  name = name.replace(/^[([]|[)\]]$/g, '')
  return pascalCase(name)
}

function pascalCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
}

/** camelCase key from the message itself, so keys read like the copy. */
export function keyFor(text: string): string {
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_KEY_WORDS)
  if (words.length === 0) return 'text'
  const [first, ...rest] = words
  return (
    first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')
  )
}

/** Collapses the whitespace JSX preserves across wrapped source lines. */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n += 1
  return `${base}${n}`
}

/**
 * The enclosing component and whether it is async — which decides
 * getTranslations (await, server-only) vs useTranslations (hook). Returns
 * null when the literal is not inside a function at all, e.g. a module-level
 * config array, which is a case for a human.
 */
function enclosingComponent(node: Node): { fn: Node; isAsync: boolean } | null {
  let current: Node | undefined = node.getParent()
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current) ||
      Node.isMethodDeclaration(current)
    ) {
      const body = current.getBody()
      // An arrow inside JSX (a .map callback) has an expression body, not a
      // block — keep walking to the function that owns the render.
      if (body && Node.isBlock(body)) {
        // isAsync(), never getText(): the node's text includes any leading
        // JSDoc, so a documented `async function` reads as starting with
        // "/**" and would be misclassified as sync — which puts a hook in an
        // async Server Component, and that throws at runtime.
        return { fn: current, isAsync: current.isAsync() }
      }
    }
    current = current.getParent()
  }
  return null
}

function hasTranslatorDeclared(fn: Node): boolean {
  const body = fn.getFirstDescendantByKind(SyntaxKind.Block)
  if (!body) return false
  return body
    .getStatements()
    .some((s) => /const\s+t\s*=\s*(await\s+)?(getTranslations|useTranslations)\(/.test(s.getText()))
}

function ensureImport(file: SourceFile, moduleSpecifier: string, named: string): void {
  const existing = file.getImportDeclaration((d) => d.getModuleSpecifierValue() === moduleSpecifier)
  if (existing) {
    if (!existing.getNamedImports().some((n) => n.getName() === named)) {
      existing.addNamedImport(named)
    }
    return
  }
  file.addImportDeclaration({ moduleSpecifier, namedImports: [named] })
}

export interface ApplyResult {
  file: string
  extracted: Record<string, string>
  skips: Skip[]
}

/**
 * The repo has no formatter, so files carry their own conventions — some use
 * semicolons and double quotes, others neither. An inserted import in the
 * wrong style is a review distraction in every single file, so match what is
 * already there rather than imposing one house style.
 */
function fileUsesSemicolons(file: SourceFile): boolean {
  const imports = file.getImportDeclarations()
  if (imports.length === 0) return true
  return imports.filter((d) => d.getText().trimEnd().endsWith(';')).length > imports.length / 2
}

export function extractFromFile(file: SourceFile, namespace: string): ApplyResult {
  const relPath = relative(ROOT, file.getFilePath())
  const semicolons = fileUsesSemicolons(file)
  const extracted: Record<string, string> = {}
  const skips: Skip[] = []
  const taken = new Set<string>()
  const componentsNeedingTranslator = new Map<Node, boolean>()

  /** JsxText nodes carrying real copy, in document order. */
  const translatable = (): JsxText[] =>
    (file.getDescendantsOfKind(SyntaxKind.JsxText) as JsxText[]).filter(
      (n) => normalizeText(n.getText()) !== '',
    )

  // Pass 1 — decide. Nothing is mutated here, so every node position stays
  // valid while we classify.
  const keys: string[] = []
  for (const node of translatable()) {
    const text = normalizeText(node.getText())
    const line = node.getStartLineNumber()

    // Text sitting beside an expression means the real message has
    // arguments — "{count} sets left" is one ICU string, not a fragment.
    // Rewriting only the literal half would strand the sentence.
    const siblings = node.getParent()?.getChildrenOfKind(SyntaxKind.JsxExpression) ?? []
    if (siblings.length > 0) {
      skips.push({ file: relPath, line, text, reason: 'interpolated — needs an ICU message' })
      keys.push('')
      continue
    }

    const component = enclosingComponent(node)
    if (!component) {
      skips.push({ file: relPath, line, text, reason: 'not inside a component' })
      keys.push('')
      continue
    }

    const key = uniqueKey(keyFor(text), taken)
    taken.add(key)
    extracted[key] = text
    keys.push(key)
    componentsNeedingTranslator.set(component.fn, component.isAsync)
  }

  const suffix = semicolons ? ';' : ''
  for (const [fn, isAsync] of componentsNeedingTranslator) {
    if (hasTranslatorDeclared(fn)) continue
    const body = fn.getFirstDescendantByKind(SyntaxKind.Block)
    if (!body) continue
    if (isAsync) {
      body.insertStatements(0, `const t = await getTranslations('${namespace}')${suffix}`)
      ensureImport(file, 'next-intl/server', 'getTranslations')
    } else {
      body.insertStatements(0, `const t = useTranslations('${namespace}')${suffix}`)
      ensureImport(file, 'next-intl', 'useTranslations')
    }
  }

  if (!semicolons) {
    // ts-morph always terminates generated imports; strip it back on files
    // that don't use semicolons.
    for (const decl of file.getImportDeclarations()) {
      const spec = decl.getModuleSpecifierValue()
      if (spec === 'next-intl' || spec === 'next-intl/server') {
        decl.replaceWithText(decl.getText().replace(/;$/, ''))
      }
    }
  }

  // Pass 3 — swap the copy for the call, by exact text span rather than by
  // node. replaceWithText() re-indents what it inserts, which drags the
  // closing tag rightwards and turns a one-line change into a noisy hunk.
  // Applied back-to-front so each edit leaves earlier offsets untouched.
  // Statement/import insertion above ran first and cannot add or remove JSX
  // text, so re-querying here yields the same nodes in the same order.
  // Spans are read up front as plain offsets: replaceText re-parses the file
  // and forgets every existing node, so holding node references across the
  // loop throws. Numbers survive, and editing back-to-front means each edit
  // only shifts offsets we have already used.
  const spans = translatable().map((node, i) => {
    const raw = node.getText()
    const start = node.getStart()
    return {
      key: keys[i],
      start: start + (raw.length - raw.trimStart().length),
      end: start + raw.trimEnd().length,
    }
  })

  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const { key, start, end } = spans[i]
    if (key === '') continue
    file.replaceText([start, end], `{t('${key}')}`)
  }

  return { file: relPath, extracted, skips }
}

function loadCatalog(): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(CATALOG, 'utf8'))
}

function saveCatalog(catalog: Record<string, Record<string, string>>): void {
  const sorted = Object.fromEntries(
    Object.entries(catalog)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ns, messages]) => [
        ns,
        Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  )
  writeFileSync(CATALOG, `${JSON.stringify(sorted, null, 2)}\n`)
}

function main(): void {
  const [mode, pattern] = process.argv.slice(2)
  const project = new Project({
    tsConfigFilePath: join(ROOT, 'tsconfig.json'),
    manipulationSettings: {
      quoteKind: QuoteKind.Single,
      indentationText: IndentationText.TwoSpaces,
    },
  })

  const globs = pattern ? [pattern] : ['src/**/*.tsx']
  const files = project
    .getSourceFiles(globs)
    .filter((f) => !/\.(test|stories)\.tsx$/.test(f.getFilePath()))

  if (mode === 'report') {
    let total = 0
    const rows: Array<[string, number]> = []
    for (const file of files) {
      const count = (file.getDescendantsOfKind(SyntaxKind.JsxText) as JsxText[]).filter(
        (n) => normalizeText(n.getText()) !== '',
      ).length
      if (count > 0) rows.push([relative(ROOT, file.getFilePath()), count])
      total += count
    }
    rows.sort((a, b) => b[1] - a[1])
    for (const [path, count] of rows) console.log(String(count).padStart(4), path)
    console.log(`\n${total} literals across ${rows.length} files`)
    return
  }

  if (mode !== 'apply') {
    console.error('usage: i18n-extract.ts <report|apply> [glob]')
    process.exit(1)
  }

  const catalog = loadCatalog()
  const allSkips: Skip[] = []
  let changed = 0
  let messages = 0

  for (const file of files) {
    const namespace = namespaceFor(relative(ROOT, file.getFilePath()))
    const result = extractFromFile(file, namespace)
    allSkips.push(...result.skips)
    const count = Object.keys(result.extracted).length
    if (count === 0) continue

    const existing = catalog[namespace] ?? {}
    for (const [key, value] of Object.entries(result.extracted)) {
      if (existing[key] !== undefined && existing[key] !== value) {
        allSkips.push({
          file: result.file,
          line: 0,
          text: value,
          reason: `key collision: ${namespace}.${key} already means "${existing[key]}"`,
        })
        continue
      }
      existing[key] = value
      messages += 1
    }
    catalog[namespace] = existing
    file.saveSync()
    changed += 1
    console.log(`${result.file} → ${namespace} (${count})`)
  }

  saveCatalog(catalog)
  console.log(`\n${messages} messages from ${changed} files`)

  if (allSkips.length > 0) {
    console.log(`\n${allSkips.length} left for a human:`)
    for (const skip of allSkips) {
      console.log(`  ${skip.file}:${skip.line}  ${skip.reason}\n      "${skip.text}"`)
    }
  }
}

// Only run when invoked directly, so the helpers stay unit-testable.
if (process.argv[1]?.endsWith('i18n-extract.ts')) {
  main()
}
