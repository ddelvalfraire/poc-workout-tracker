/**
 * Generates src/lib/legal-content.generated.ts from docs/legal/*.md — the
 * same source→generated→check pipeline as the design tokens (build-tokens):
 * docs/legal is the single source of truth; the generated module is what the
 * app imports (repo files outside the import graph are not traced into the
 * serverless bundle, so a runtime fs read would 404 in production).
 *
 *   npm run legal          # regenerate
 *   npm run legal:check    # CI/pre-merge drift guard (exit 1 on stale)
 *
 * The HTML draft-banner comments in the sources (attorney notes) are
 * stripped: they are authoring metadata, not content users accept. The
 * sha256 is computed over the STRIPPED content — the exact text shown — and
 * matches what upsertConsentDocument stores, so ledger versions and page
 * content can never silently diverge.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = join(ROOT, 'src/lib/legal-content.generated.ts')

const SOURCES = [
  { key: 'tos', file: 'docs/legal/terms-of-service.md' },
  { key: 'privacy', file: 'docs/legal/privacy-policy.md' },
  { key: 'healthNotice', file: 'docs/legal/consumer-health-data-privacy-policy.md' },
  { key: 'analyticsNotice', file: 'docs/legal/analytics-notice.md' },
] as const

function stripDraftComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '').trimStart()
}

function generate(): string {
  const entries = SOURCES.map(({ key, file }) => {
    const raw = readFileSync(join(ROOT, file), 'utf8')
    const content = stripDraftComments(raw)
    const sha256 = createHash('sha256').update(content).digest('hex')
    return { key, file, content, sha256 }
  })

  const body = entries
    .map(
      ({ key, file, content, sha256 }) =>
        `/** Generated from ${file} — sha256 ${sha256} */\n` +
        `export const ${key} = {\n` +
        `  contentMd: ${JSON.stringify(content)},\n` +
        `  sha256: ${JSON.stringify(sha256)},\n` +
        `} as const\n`,
    )
    .join('\n')

  return (
    `// GENERATED FILE — do not edit. Source: docs/legal/*.md; run \`npm run legal\`.\n` +
    `// The sha256 values are over the stripped content exactly as rendered —\n` +
    `// they match what the consent ledger stores via upsertConsentDocument.\n\n` +
    body
  )
}

const output = generate()
const isCheck = process.argv.includes('--check')

if (isCheck) {
  const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : ''
  if (current !== output) {
    console.error('legal content drift: docs/legal changed — run `npm run legal` and commit')
    process.exit(1)
  }
  console.log('legal content: in sync')
} else {
  writeFileSync(OUT_PATH, output)
  console.log(`wrote ${OUT_PATH}`)
}
