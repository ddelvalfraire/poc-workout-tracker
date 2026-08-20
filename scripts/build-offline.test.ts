import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from './build-offline'

/**
 * The offline page is the one screen a user sees when everything else has
 * failed, so the generator has to be boring: no lost markup, no duplicated
 * blocks on a second run, and readable copy even if the picker never runs.
 */
const EN = { title: 'Offline', heading: 'You are offline', body: 'Body copy.', retry: 'Retry' }
const ES = { title: 'Sin conexión', heading: 'Sin conexión', body: 'Texto.', retry: 'Reintentar' }

const base = readFileSync(join(process.cwd(), 'public', 'offline.html'), 'utf8')

describe('offline page generator', () => {
  it('writes the default locale into the markup itself', () => {
    // No JavaScript required to read the page — the picker only upgrades it.
    const html = render(base, EN, { en: EN })

    expect(html).toContain('<h1>You are offline</h1>')
    expect(html).toContain('<title>Offline</title>')
  })

  it('embeds every locale that has a catalog', () => {
    const html = render(base, EN, { en: EN, es: ES })

    expect(html).toContain('Reintentar')
    expect(html).toContain('Sin conexi')
  })

  it('is idempotent — a second run does not stack another copy block', () => {
    // The generator rewrites a file it previously generated, so a naive
    // append would duplicate the payload on every build.
    const once = render(base, EN, { en: EN })
    const twice = render(once, EN, { en: EN })

    expect(twice).toBe(once)
    expect(twice.match(/id="offline-copy"/g)).toHaveLength(1)
  })

  it('keeps the self-heal script that recovers from a false offline', () => {
    // That script is why a post-deploy reload racing a woken radio does not
    // strand the user on this page; losing it to a regex would be silent.
    const html = render(base, EN, { en: EN })

    expect(html).toContain('Self-heal')
  })

  it('escapes characters that would break the markup', () => {
    const html = render(base, { ...EN, heading: 'Fish & <chips>' }, { en: EN })

    expect(html).toContain('Fish &amp; &lt;chips&gt;')
  })
})
