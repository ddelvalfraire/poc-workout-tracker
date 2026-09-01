// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { withIntl } from '../../../vitest.intl'
import type { DrawerData } from '@/lib/home/drawer-status'

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

async function mountDrawer(client: QueryClient): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      withIntl(
        <QueryClientProvider client={client}>
          <NavDrawer />
        </QueryClientProvider>,
      ),
    )
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
    expect(client.getQueryData(['drawer'])).toEqual(emptyDrawer)
  })

  test('a second instance on the same client (another page) serves the cache: no second request', async () => {
    const fetchSpy = stubDrawerFetch()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await mountDrawer(client)
    await mountDrawer(client)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
