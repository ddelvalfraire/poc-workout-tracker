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
 * translator.
 *
 * It is also per-LOCALE without a second URL. The obvious approach — one file
 * per locale — means the worker choosing between them, which means touching
 * the precache manifest, and that is load-bearing (see src/app/sw.ts): the
 * rule is that the worker caches this page and nothing else. So every
 * locale's copy is embedded in the one file and a few lines of inline script
 * pick at display time from the same NEXT_LOCALE cookie the app sets. The
 * markup still ships the default locale's words, so the page reads correctly
 * with no JavaScript at all.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import messages from '../messages/en.json'

const FILE = join(process.cwd(), 'public', 'offline.html')
const CATALOGS = join(process.cwd(), 'messages')

/** Every locale that has a catalog, default first. */
function localeCopy(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const file of readdirSync(CATALOGS).filter((f) => f.endsWith('.json')).sort()) {
    const locale = file.replace(/\.json$/, '')
    const catalog = JSON.parse(readFileSync(join(CATALOGS, file), 'utf8'))
    if (catalog.Offline) out[locale] = catalog.Offline
  }
  return out
}

/** JSON holds real characters; HTML wants entities for the risky ones. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/’/g, '&rsquo;')
    .replace(/—/g, '&mdash;')
}

const COPY_SCRIPT_START = '<script id="offline-copy" type="application/json">'

export function render(
  html: string,
  copy: Record<string, string>,
  byLocale: Record<string, Record<string, string>> = {},
): string {
  // `<` escaped, not just quoted: JSON.stringify leaves `/` alone, so a
  // message containing `</script>` would close this block early and turn
  // whatever follows into executable script. Unreachable while the catalog is
  // ours and English-only — and exactly the assumption that stops holding the
  // day translations arrive from outside.
  const payload = `${COPY_SCRIPT_START}${JSON.stringify(byLocale).replace(/</g, '\\u003c')}</script>`
  const picker = `<script>
      // Same NEXT_LOCALE cookie the app sets. No network, no framework — this
      // page exists precisely because neither is available.
      ;(function () {
        try {
          var copy = JSON.parse(document.getElementById('offline-copy').textContent)
          var m = document.cookie.match(/(?:^|; )NEXT_LOCALE=([^;]+)/)
          var want = m ? decodeURIComponent(m[1]) : (navigator.language || '').slice(0, 2)
          var t = copy[want]
          if (!t) return
          document.documentElement.lang = want
          document.title = t.title
          document.querySelector('h1').textContent = t.heading
          document.querySelector('main p').textContent = t.body
          document.querySelector('main button').textContent = t.retry
        } catch (e) {}
      })()
    </script>`
  const withCopy = html.includes(COPY_SCRIPT_START)
    ? html.replace(new RegExp(`${COPY_SCRIPT_START}.*?</script>\\s*<script>[\\s\\S]*?</script>`), `${payload}\n    ${picker}`)
    : html.replace('</main>', `</main>\n    ${payload}\n    ${picker}`)
  return withCopy
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
  const next = render(current, copy, localeCopy())

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
