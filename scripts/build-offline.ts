/**
 * Writes public/offline.html's copy from the message catalog.
 *
 *   npx tsx scripts/build-offline.ts          # write
 *   npx tsx scripts/build-offline.ts --check  # fail if stale (CI)
 *
 * The service worker precaches this file and serves it with no React, no
 * request and no translator, so next-intl cannot reach it at runtime. Left
 * alone it becomes a second source of truth for copy — which is exactly what
 * it was: four English strings nothing guarded, in the one screen a user sees
 * when everything else has failed.
 *
 * Generating it keeps one catalog and makes the strings visible to a
 * translator. Serving a per-LOCALE offline page is a separate change: the
 * worker precaches a single URL, and picking among several means touching the
 * precache manifest, which is load-bearing (see src/app/sw.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import messages from '../messages/en.json'

const FILE = join(process.cwd(), 'public', 'offline.html')

/** JSON holds real characters; HTML wants entities for the risky ones. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/’/g, '&rsquo;')
    .replace(/—/g, '&mdash;')
}

export function render(html: string, copy: Record<string, string>): string {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(copy.title)}</title>`)
    .replace(/<h1>[^<]*<\/h1>/, `<h1>${escapeHtml(copy.heading)}</h1>`)
    .replace(/<p>[^<]*<\/p>/, `<p>${escapeHtml(copy.body)}</p>`)
    .replace(
      /(<button type="button" onclick="location\.reload\(\)">)[^<]*(<\/button>)/,
      `$1${escapeHtml(copy.retry)}$2`,
    )
}

function main(): void {
  const copy = messages.Offline as unknown as Record<string, string>
  const current = readFileSync(FILE, 'utf8')
  const next = render(current, copy)

  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('public/offline.html is stale — run `npm run offline`.')
      process.exit(1)
    }
    console.log('offline.html matches the catalog')
    return
  }
  writeFileSync(FILE, next)
  console.log('wrote public/offline.html')
}

if (process.argv[1]?.endsWith('build-offline.ts')) main()
