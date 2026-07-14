import { describe, test, expect } from 'vitest'
import { RECOVERY_SCRIPT } from './chunk-recovery'

/**
 * Executes the EXACT string shipped inside the inline <script> with stubbed
 * globals — the script must stay pre-boot-safe (no imports, no React), so the
 * only honest way to test it is to run the artifact itself.
 */
class FakeScriptElement {
  src: string
  constructor(src: string) {
    this.src = src
  }
}

class FakeLinkElement {
  href: string
  constructor(href: string) {
    this.href = href
  }
}

interface Harness {
  fire: (type: 'error' | 'unhandledrejection', event: object) => void
  reloads: () => number
  store: Map<string, string>
  advance: (ms: number) => void
}

function runScript(opts?: {
  getThrows?: boolean
  setThrows?: boolean
  offline?: boolean
}): Harness {
  const listeners: Record<string, ((event: object) => void)[]> = {}
  let reloadCount = 0
  let now = 1_000_000
  const store = new Map<string, string>()

  const windowStub = {
    addEventListener: (type: string, fn: (event: object) => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
  }
  const sessionStorageStub = {
    getItem: (key: string): string | null => {
      if (opts?.getThrows) throw new Error('storage unavailable')
      return store.get(key) ?? null
    },
    setItem: (key: string, value: string): void => {
      if (opts?.setThrows) throw new Error('storage unavailable')
      store.set(key, value)
    },
  }
  const locationStub = { reload: () => reloadCount++ }
  const dateStub = { now: () => now }
  const navigatorStub = { onLine: !opts?.offline }

  new Function(
    'window',
    'sessionStorage',
    'location',
    'Date',
    'HTMLScriptElement',
    'HTMLLinkElement',
    'navigator',
    RECOVERY_SCRIPT,
  )(
    windowStub,
    sessionStorageStub,
    locationStub,
    dateStub,
    FakeScriptElement,
    FakeLinkElement,
    navigatorStub,
  )

  return {
    fire: (type, event) => (listeners[type] ?? []).forEach((fn) => fn(event)),
    reloads: () => reloadCount,
    store,
    advance: (ms) => {
      now += ms
    },
  }
}

const staleScriptError = { target: new FakeScriptElement('https://app.example/_next/static/chunks/abc.js') }
const chunkRejection = { reason: { name: 'ChunkLoadError' } }

describe('RECOVERY_SCRIPT', () => {
  test('reloads once for a failed /_next script and stamps the window', () => {
    const h = runScript()

    h.fire('error', staleScriptError)

    expect(h.reloads()).toBe(1)
    expect(h.store.get('chunk-reload-at')).toBe('1000000')
  })

  test('reloads for a ChunkLoadError unhandled rejection', () => {
    const h = runScript()

    h.fire('unhandledrejection', chunkRejection)

    expect(h.reloads()).toBe(1)
  })

  test('ignores unrelated script failures and rejections', () => {
    const h = runScript()

    h.fire('error', { target: new FakeScriptElement('https://cdn.example/other.js') })
    h.fire('error', { target: {} })
    h.fire('unhandledrejection', { reason: new Error('boom') })
    h.fire('unhandledrejection', { reason: null })
    h.fire('unhandledrejection', {})

    expect(h.reloads()).toBe(0)
  })

  test('rate-limits to one reload per window, then allows another', () => {
    const h = runScript()

    h.fire('error', staleScriptError)
    h.advance(29_999)
    h.fire('error', staleScriptError)
    expect(h.reloads()).toBe(1)

    h.advance(2)
    h.fire('error', staleScriptError)
    expect(h.reloads()).toBe(2)
  })

  test('reloads for a failed /_next stylesheet link', () => {
    const h = runScript()

    h.fire('error', {
      target: new FakeLinkElement('https://app.example/_next/static/css/abc.css'),
    })

    expect(h.reloads()).toBe(1)
  })

  test('ignores non-/_next link failures', () => {
    const h = runScript()

    h.fire('error', { target: new FakeLinkElement('https://cdn.example/font.css') })

    expect(h.reloads()).toBe(0)
  })

  test('reloads for native dynamic-import failure messages (Safari/Firefox wording)', () => {
    // Safari rejects native import() with a TypeError, never ChunkLoadError.
    const h = runScript()

    h.fire('unhandledrejection', {
      reason: { name: 'TypeError', message: 'Importing a module script failed.' },
    })
    h.advance(30_001)
    h.fire('unhandledrejection', {
      reason: { name: 'TypeError', message: 'error loading dynamically imported module' },
    })

    expect(h.reloads()).toBe(2)
  })

  test('does NOT reload for generic failed fetches (offline API calls are not skew)', () => {
    const h = runScript()

    h.fire('unhandledrejection', {
      reason: { name: 'TypeError', message: 'Failed to fetch' },
    })

    expect(h.reloads()).toBe(0)
  })

  test('never reloads while offline — the reload would land on the offline page', () => {
    const h = runScript({ offline: true })

    h.fire('error', staleScriptError)

    expect(h.reloads()).toBe(0)
  })

  test('reloads ONCE per page lifetime when sessionStorage reads throw', () => {
    // No storage → no cross-reload rate limit; the in-memory flag still
    // guarantees a single recovery attempt per page instead of none.
    const h = runScript({ getThrows: true })

    h.fire('error', staleScriptError)
    h.fire('error', staleScriptError)

    expect(h.reloads()).toBe(1)
  })

  test('reloads ONCE per page lifetime when sessionStorage writes throw', () => {
    const h = runScript({ setThrows: true })

    h.fire('error', staleScriptError)
    h.fire('error', staleScriptError)

    expect(h.reloads()).toBe(1)
  })
})
