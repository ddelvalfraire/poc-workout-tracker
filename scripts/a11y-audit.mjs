/**
 * Accessibility ratchet for the component catalog.
 *
 *   npm run a11y          audit every story, fail on anything not in the baseline
 *   npm run a11y:update   rewrite the baseline (only ever to REMOVE entries)
 *
 * Every story is rendered in a real browser and checked with axe. A real
 * browser matters: colour-contrast needs actual layout and computed styles, so
 * a jsdom-based check would silently pass the contrast failures this catches.
 *
 * The baseline holds the violations that already existed in shipped components
 * when this landed. New ones fail. The baseline is a debt ledger, not a
 * permission slip — `a11y:update` should only ever shrink it.
 *
 * Serves `storybook-static/` itself over Node's http, so the only prerequisite
 * is `npm run build-storybook`.
 *
 * KNOWN LIMIT: each story is audited in its INITIAL rendered state. A story
 * whose content only appears after its play function runs — NavDrawer's
 * `Opened`, which clicks the trigger to mount a portal — is audited closed, so
 * the opened content is not in this ledger. Storybook's a11y panel does check
 * it interactively. Closing this properly means waiting on the story's
 * play-completed phase, which is worth doing if more play-driven stories land.
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { createRequire } from 'node:module'

import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core')

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'storybook-static')
const BASELINE = join(ROOT, 'scripts/a11y-baseline.json')
const UPDATE = process.argv.includes('--update')

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ico': 'image/x-icon', '.map': 'application/json',
}

if (!existsSync(STATIC_DIR)) {
  console.error('No storybook-static/. Run `npm run build-storybook` first.')
  process.exit(1)
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  // normalize() collapses ../ so a crafted URL cannot escape the static dir.
  const rel = normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[/\\])+/, '')
  const file = join(STATIC_DIR, rel)
  if (!file.startsWith(STATIC_DIR) || !existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

await new Promise((resolve) => server.listen(0, resolve))
const BASE = `http://localhost:${server.address().port}`

const index = JSON.parse(readFileSync(join(STATIC_DIR, 'index.json'), 'utf8'))
const stories = Object.values(index.entries).filter((e) => e.type === 'story')

const browser = await chromium.launch()
const page = await browser.newPage()
const found = {}

for (const story of stories) {
  await page.goto(`${BASE}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
    waitUntil: 'networkidle',
  })
  await page.addScriptTag({ path: AXE_PATH })
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector('#storybook-root'), {
      resultTypes: ['violations'],
    })
    return result.violations.map((v) => v.id)
  })
  if (violations.length) found[story.id] = [...new Set(violations)].sort()
}

await browser.close()
server.close()

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(found, null, 2) + '\n')
  const total = Object.values(found).flat().length
  console.log(`baseline written: ${Object.keys(found).length} stories, ${total} violations`)
  process.exit(0)
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

const regressions = []
for (const [id, rules] of Object.entries(found)) {
  const allowed = baseline[id] ?? []
  for (const rule of rules) if (!allowed.includes(rule)) regressions.push(`${id} — ${rule}`)
}
// Anything fixed should leave the ledger, or the ratchet stops ratcheting.
const stale = []
for (const [id, rules] of Object.entries(baseline)) {
  for (const rule of rules) if (!(found[id] ?? []).includes(rule)) stale.push(`${id} — ${rule}`)
}

const known = Object.values(baseline).flat().length
console.log(`${stories.length} stories audited — ${known} known violations in the baseline`)

if (regressions.length) {
  console.error(`\n${regressions.length} NEW violation(s):`)
  regressions.forEach((r) => console.error('  ' + r))
}
if (stale.length) {
  console.error(`\n${stale.length} baseline entr(ies) no longer reproduce — remove them:`)
  stale.forEach((r) => console.error('  ' + r))
  console.error('\n  npm run a11y:update')
}
process.exit(regressions.length || stale.length ? 1 : 0)
