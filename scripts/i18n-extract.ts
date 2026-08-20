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
  const structural = new Set(['page', 'layout', 'template', 'index', 'route', 'default'])
  const isDynamic = (part: string) => part.startsWith('[') || part.startsWith('(')

  const parts = relativePath
    .replace(/\.tsx?$/, '')
    .split('/')
    .filter((part) => part !== 'src' && part !== 'app' && part !== 'components')

  // Walk back past Next's structural filenames AND past dynamic segments.
  // [id] is not a name: programs/[id]/page.tsx and workout/[id]/page.tsx both
  // used to land on "Id", and this repo has four such routes plus two on
  // "Token" — a collision that silently merged two pages' copy.
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]
    if (structural.has(part) || isDynamic(part)) continue
    return pascalCase(part)
  }
  return pascalCase(parts[parts.length - 1] ?? 'app')
}

function pascalCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
}

/**
 * A key from the string's ROLE in the markup, never from its text.
 *
 * Content-derived keys drift: reword the copy and the key becomes a lie,
 * while translators read the key as context and existing translations lose
 * their link to it. See docs/I18N-KEYS.md.
 *
 * The tag only narrows the role — <p> is a description, <button> is an
 * action — so `apply` prints every generated key for renaming. This is a
 * starting point for a human, not a finished name.
 */
const ROLE_BY_TAG: Record<string, string> = {
  h1: 'title',
  h2: 'title',
  h3: 'title',
  h4: 'title',
  h5: 'title',
  h6: 'title',
  p: 'description',
  button: 'action',
  summary: 'summary',
  label: 'label',
  li: 'item',
  legend: 'legend',
  caption: 'caption',
  figcaption: 'caption',
  th: 'columnHeader',
  td: 'cell',
  a: 'linkLabel',
  option: 'option',
  strong: 'emphasis',
  em: 'emphasis',
}

export function keyForRole(tagName: string | undefined): string {
  if (tagName === undefined) return 'text'
  const lower = tagName.toLowerCase()
  if (ROLE_BY_TAG[lower] !== undefined) return ROLE_BY_TAG[lower]
  // A component wrapper names the role better than a bare span: EmptyWords
  // is an empty state, SectionTitle is a title.
  if (/^[A-Z]/.test(tagName)) {
    const words = tagName.split(/(?=[A-Z])/).filter(Boolean)
    const head = words[0].toLowerCase()
    return head === 'empty' ? 'empty' : head
  }
  return 'label'
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

/** Components are PascalCase by convention; callbacks and handlers are not. */
function isComponentName(name: string | undefined): boolean {
  return name !== undefined && /^[A-Z]/.test(name)
}

/**
 * The name a function is bound to, whether declared or assigned to a const.
 */
function boundName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn)) return fn.getName()
  const parent = fn.getParent()
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName()
  return undefined
}

/**
 * The enclosing COMPONENT — not merely the nearest function with a block.
 *
 * A `.map()` callback written as `(x) => { return <li/> }` has a block body
 * and encloses the JSX, so "nearest block" put the hook inside the loop:
 * a hook called once per array item, which React throws on as soon as the
 * list length changes. Event handlers had the same problem in reverse — the
 * translator landed in `onClick` while the component's own JSX still
 * referenced `t`.
 *
 * A component is a function bound to a PascalCase name, or an anonymous
 * `export default function`. Callbacks and handlers are neither, so we walk
 * past them to the function that actually renders.
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
      const named = isComponentName(boundName(current))
      const isDefaultExport = Node.isFunctionDeclaration(current) && current.isDefaultExport()

      if (body && Node.isBlock(body) && (named || isDefaultExport)) {
        // isAsync(), never getText(): a node's text includes any leading
        // JSDoc, so a documented `async function` reads as starting with
        // "/**" and would be misclassified as sync — putting a hook in an
        // async Server Component, which throws at runtime.
        return { fn: current, isAsync: current.isAsync() }
      }
    }
    current = current.getParent()
  }
  return null
}

/**
 * An existing `const t = useTranslations('X')` in this component's OWN top
 * level, and the namespace it is bound to.
 *
 * Reads declarations off the AST rather than regexing statement text: a
 * statement's text includes any nested function body, so a handler that had
 * already been given a translator made its parent component look declared,
 * and the parent's own `t` was never inserted.
 */
function existingTranslator(fn: Node): { declared: boolean; namespace: string | null } {
  const body = fn.getFirstDescendantByKind(SyntaxKind.Block)
  if (!body) return { declared: false, namespace: null }

  for (const statement of body.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue
    for (const decl of statement.getDeclarations()) {
      if (decl.getName() !== 't') continue
      const init = decl.getInitializer()
      if (!init) continue
      const call = Node.isAwaitExpression(init) ? init.getExpression() : init
      if (!Node.isCallExpression(call)) continue
      const callee = call.getExpression().getText()
      if (callee !== 'useTranslations' && callee !== 'getTranslations') continue
      const arg = call.getArguments()[0]
      const namespace =
        arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : null
      return { declared: true, namespace }
    }
  }
  return { declared: false, namespace: null }
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

    // A component that already calls useTranslations('Other') has `t` bound
    // to THAT namespace. Writing this key under the file's namespace would
    // compile and type-check, then miss at runtime — next-intl resolves
    // t('key') against 'Other', where the key does not exist. Refuse rather
    // than emit a MISSING_MESSAGE nobody sees until the page is opened.
    const bound = existingTranslator(component.fn)
    if (bound.declared && bound.namespace !== null && bound.namespace !== namespace) {
      skips.push({
        file: relPath,
        line,
        text,
        reason: `component is already bound to namespace '${bound.namespace}'`,
      })
      keys.push('')
      continue
    }

    const parent = node.getParent()
    const tagName =
      parent && (Node.isJsxElement(parent) ? parent.getOpeningElement().getTagNameNode().getText() : undefined)
    const key = uniqueKey(keyForRole(tagName), taken)
    taken.add(key)
    extracted[key] = text
    keys.push(key)
    componentsNeedingTranslator.set(component.fn, component.isAsync)
  }

  const suffix = semicolons ? ';' : ''
  for (const [fn, isAsync] of componentsNeedingTranslator) {
    if (existingTranslator(fn).declared) continue
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

    // Merge FIRST, save only if every key landed. The old order saved the
    // rewritten JSX and then dropped colliding keys, so the file called
    // t('key') for a message the catalog never received — rendering the
    // other file's sentence, with no error anywhere.
    const existing = catalog[namespace] ?? {}
    const collisions = Object.entries(result.extracted).filter(
      ([key, value]) => existing[key] !== undefined && existing[key] !== value,
    )
    if (collisions.length > 0) {
      for (const [key, value] of collisions) {
        allSkips.push({
          file: result.file,
          line: 0,
          text: value,
          reason: `key collision: ${namespace}.${key} already means "${existing[key]}" — file left untouched`,
        })
      }
      continue
    }

    for (const [key, value] of Object.entries(result.extracted)) {
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
  if (messages > 0) {
    console.log(
      '\nGenerated keys name the ROLE of each string, not its text — they are a\n' +
        'starting point. Rename each to what it means before committing, and keep\n' +
        'call sites in step. See docs/I18N-KEYS.md.',
    )
  }

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
