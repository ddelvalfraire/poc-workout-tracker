// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { withIntl } from '../../../vitest.intl'
import { installMemoryLocalStorage } from '../../../vitest.storage'
import type { DrawerData } from '@/lib/home/drawer-status'
import { DRAWER_PERSIST_PREFIX, clearPersistedDrawer } from '@/lib/query-persister'

// Same stubs as nav-drawer.test.tsx — the mechanics are not under test here,
// the MOUNT-TIME fetch is, which a static render can never exercise (effects
// never run), so this suite mounts for real in jsdom.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/app/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('@/app/programs/actions', () => ({ startProgramDayAction: vi.fn() }))
vi.mock('vaul', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    Drawer: {
      Root: Passthrough,
      Portal: Passthrough,
      Trigger: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
      Overlay: () => null,
      Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Title: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    },
  }
})

import { NavDrawer } from './nav-drawer'

const emptyDrawer: DrawerData = {
  resume: null,
  upNext: null,
  program: null,
  recentCompletedAtTimes: [],
  lastCompleted: null,
  stats: null,
  goals: null,
  trophies: null,
  body: null,
  exercises: null,
  coach: false,
  recents: [],
  unit: 'kg',
}

const roots: Root[] = []

const USER = 'user_1'
const persistedKeyFor = (userId: string) =>
  `${DRAWER_PERSIST_PREFIX}-${JSON.stringify(['drawer', userId])}`

/** Mounts, then lets the query settle: the fetch resolves in microtasks, but
 *  the persister writes its snapshot through TanStack's notifyManager, which
 *  schedules on a macrotask — so one timer tick is part of "mounted". */
async function mountDrawer(client: QueryClient, userId = USER): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      withIntl(
        <QueryClientProvider client={client}>
          <NavDrawer userId={userId} />
        </QueryClientProvider>,
      ),
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function stubDrawerFetch() {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(emptyDrawer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // A fresh device per test: the persister reads window.localStorage at call
  // time, so installing the stand-in here is enough.
  installMemoryLocalStorage()
})

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('NavDrawer mount-time fetch (the caching contract)', () => {
  test('requests /api/drawer as soon as the drawer mounts — before any tap', async () => {
    const fetchSpy = stubDrawerFetch()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await mountDrawer(client)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('/api/drawer', expect.anything())
    expect(client.getQueryData(['drawer', USER])).toEqual(emptyDrawer)
  })

  test('a second instance on the same client (another page) serves the cache: no second request', async () => {
    const fetchSpy = stubDrawerFetch()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await mountDrawer(client)
    await mountDrawer(client)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('NavDrawer persisted snapshot (the launch-to-launch contract)', () => {
  test('a fetched snapshot lands in localStorage under the user’s key', async () => {
    stubDrawerFetch()
    await mountDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }))

    const raw = window.localStorage.getItem(persistedKeyFor(USER))
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).state.data).toEqual(emptyDrawer)
  })

  test('a fresh client (the next launch) restores it with NO request while it is fresh', async () => {
    const fetchSpy = stubDrawerFetch()
    await mountDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // A new QueryClient is exactly what a reload / PWA relaunch gets: empty
    // memory, the same window.localStorage.
    const relaunched = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await mountDrawer(relaunched)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(relaunched.getQueryData(['drawer', USER])).toEqual(emptyDrawer)
  })

  test('another account’s snapshot on the device is pruned before this user’s drawer restores', async () => {
    window.localStorage.setItem(persistedKeyFor('user_other'), '{"state":{"data":{}}}')
    stubDrawerFetch()

    await mountDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }))

    expect(window.localStorage.getItem(persistedKeyFor('user_other'))).toBeNull()
    expect(window.localStorage.getItem(persistedKeyFor(USER))).not.toBeNull()
  })

  test('clearPersistedDrawer (sign-out / deletion) leaves nothing behind', async () => {
    stubDrawerFetch()
    await mountDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
    expect(window.localStorage.getItem(persistedKeyFor(USER))).not.toBeNull()

    clearPersistedDrawer()

    expect(window.localStorage.getItem(persistedKeyFor(USER))).toBeNull()
  })
})
