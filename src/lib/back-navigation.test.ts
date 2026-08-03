import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  canGoBack,
  markReplace,
  navigateBack,
  recordPathname,
  reconcilePopstate,
  type BackRouter,
} from './back-navigation'

/** Minimal per-test window: Map-backed sessionStorage + optional Navigation
 *  API. The module reads window at call time, so stubbing the global is the
 *  whole harness — no jsdom needed. */
function stubWindow(options: { navigationCanGoBack?: boolean; storageThrows?: boolean } = {}) {
  const store = new Map<string, string>()
  const sessionStorage = options.storageThrows
    ? {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      }
    : {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      }
  vi.stubGlobal('window', {
    sessionStorage,
    navigation:
      options.navigationCanGoBack === undefined
        ? undefined
        : { canGoBack: options.navigationCanGoBack },
  })
  return { store }
}

function makeRouter() {
  const back = vi.fn<() => void>()
  const replace = vi.fn<(href: string) => void>()
  const router: BackRouter = { back, replace }
  return { router, back, replace }
}

function stack(store: Map<string, string>): string[] {
  return JSON.parse(store.get('nav:stack') ?? '[]') as string[]
}

beforeEach(() => {
  stubWindow()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recordPathname', () => {
  test('cold entry initializes a depth-1 stack and cannot go back', () => {
    recordPathname('/workout/abc')
    expect(canGoBack()).toBe(false)
  })

  test('pushes accumulate depth in order', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/programs')
    recordPathname('/programs/1')
    expect(stack(store)).toEqual(['/', '/programs', '/programs/1'])
    expect(canGoBack()).toBe(true)
  })

  test('same-pathname re-record is a no-op (reload, replace-to-same)', () => {
    const { store } = stubWindow()
    recordPathname('/programs')
    recordPathname('/programs')
    expect(stack(store)).toEqual(['/programs'])
  })

  test('markReplace turns the next record into a top replacement', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/workout/new')
    markReplace()
    recordPathname('/workout/abc')
    expect(stack(store)).toEqual(['/', '/workout/abc'])
  })

  test('markReplace is consumed by exactly one record', () => {
    const { store } = stubWindow()
    recordPathname('/')
    markReplace()
    recordPathname('/a')
    recordPathname('/b')
    // '/' was depth-1 so the replace rewrote the top; '/b' is a plain push.
    expect(stack(store)).toEqual(['/a', '/b'])
  })
})

describe('reconcilePopstate', () => {
  test('pop to the previous entry shrinks the stack', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/programs')
    recordPathname('/programs/1')
    reconcilePopstate('/programs')
    expect(stack(store)).toEqual(['/', '/programs'])
    // The router's subsequent usePathname effect re-records the same path.
    recordPathname('/programs')
    expect(stack(store)).toEqual(['/', '/programs'])
  })

  test('same-pathname popstate (overlay entry consumed) is a no-op', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/body')
    reconcilePopstate('/body')
    expect(stack(store)).toEqual(['/', '/body'])
  })

  test('forward-swipe after a pop restores the entry from the forward list', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/programs')
    reconcilePopstate('/') // pop
    reconcilePopstate('/programs') // forward
    expect(stack(store)).toEqual(['/', '/programs'])
  })

  test('a stale forward target after new travel resets to depth 1', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/programs')
    reconcilePopstate('/') // pop → forward holds /programs
    recordPathname('/')
    recordPathname('/history') // real forward travel elsewhere
    reconcilePopstate('/programs') // stale forward target → unknown jump
    expect(stack(store)).toEqual(['/programs'])
    expect(canGoBack()).toBe(false)
  })

  test('unknown multi-step jump resets to the safe depth-1 state', () => {
    const { store } = stubWindow()
    recordPathname('/')
    recordPathname('/a')
    recordPathname('/b')
    reconcilePopstate('/') // history.go(-2): not the adjacent entry
    expect(stack(store)).toEqual(['/'])
    expect(canGoBack()).toBe(false)
  })
})

describe('canGoBack', () => {
  test('false at depth 1, true at depth 2', () => {
    recordPathname('/')
    expect(canGoBack()).toBe(false)
    recordPathname('/settings')
    expect(canGoBack()).toBe(true)
  })

  test('Navigation API canGoBack=false vetoes a deep stack (over-count guard)', () => {
    stubWindow({ navigationCanGoBack: false })
    recordPathname('/')
    recordPathname('/settings')
    expect(canGoBack()).toBe(false)
  })

  test('Navigation API canGoBack=true does NOT override a depth-1 stack — the previous entry may be pre-app', () => {
    stubWindow({ navigationCanGoBack: true })
    recordPathname('/workout/abc')
    expect(canGoBack()).toBe(false)
  })

  test('denied sessionStorage fails closed', () => {
    stubWindow({ storageThrows: true })
    recordPathname('/')
    recordPathname('/settings')
    expect(canGoBack()).toBe(false)
  })
})

describe('navigateBack', () => {
  test('pops when the app owns the previous entry', () => {
    recordPathname('/')
    recordPathname('/settings')
    const { router, back, replace } = makeRouter()
    navigateBack(router, '/')
    expect(back).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })

  test('replaces to the fallback on cold entry and marks the replace', () => {
    const { store } = stubWindow()
    recordPathname('/workout/abc')
    const { router, back, replace } = makeRouter()
    navigateBack(router, '/history')
    expect(back).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/history')
    // The pending-replace mark keeps the tracker honest when the router
    // fires the pathname change for the fallback.
    recordPathname('/history')
    expect(stack(store)).toEqual(['/history'])
  })

  test('replaces (not pops) when storage is denied — the safe branch', () => {
    stubWindow({ storageThrows: true })
    recordPathname('/')
    recordPathname('/settings')
    const { router, back, replace } = makeRouter()
    navigateBack(router, '/')
    expect(back).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/')
  })
})
