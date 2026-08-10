import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Same static-render recipe as back-link.test.tsx: the drawer's interactive
// mechanics (vaul, history, fetch) are stubbed so the test can assert the
// MARKUP contract of the pending state — ghosts hold every status slot until
// /api/drawer resolves. The data-arrival swap is exercised by the arrival
// classes asserted here plus the geometry contract (ghost line box === the
// status line's text-xs line box).
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@clerk/nextjs', () => ({ UserButton: () => null }))
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

import type { DrawerData } from '@/lib/drawer-status'
import { NavDrawer, planDrawerOpen, statusArrival } from './nav-drawer'

/** Static render with the Query provider NavDrawer's useQuery now requires;
 *  queries stay disabled — this suite asserts the pending markup contract. */
function renderDrawer(): string {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NavDrawer />
    </QueryClientProvider>,
  )
}

/** The resolved-empty account: every section null → each row shows its
 *  invitation, the hero shows Quick log. */
const warmDrawerData: DrawerData = {
  resume: null,
  upNext: null,
  program: null,
  stats: null,
  goals: null,
  trophies: null,
  body: null,
  exercises: null,
  coach: false,
  recents: [],
  unit: 'kg',
}

/** Warm-cache render: a REAL QueryClient preseeded with ['drawer'] data, the
 *  state a reopen (or another page's drawer) finds. useQuery must serve it
 *  synchronously — no fetch, no ghosts. */
function renderDrawerWarm(): string {
  const client = new QueryClient()
  client.setQueryData(['drawer'], warmDrawerData)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NavDrawer />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // useHistoryDismissable constructs its controller from window at render
  // time; the node environment needs a minimal stand-in.
  vi.stubGlobal('window', {
    history: { state: null, pushState: () => {}, back: () => {} },
    location: { href: 'http://localhost/' },
    addEventListener: () => {},
    removeEventListener: () => {},
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NavDrawer pending state (data === null)', () => {
  test('renders one ghost per status slot: 7 surface rows + the hero context line', () => {
    const html = renderDrawer()
    const ghosts = html.match(/animate-ghost-in/g) ?? []
    // Programs, Templates, Stats, Goals, Trophies, Body, Exercises (no Coach
    // row before data), plus the ACT hero's context line.
    expect(ghosts).toHaveLength(8)
  })

  test('ghosts sit in the status line’s exact h-4 line box (zero-shift contract)', () => {
    const html = renderDrawer()
    // Surface rows: mt-0.5 + h-4 mirrors the real status span's mt-0.5 +
    // text-xs line height, so arrival never changes row height.
    expect(html).toContain('mt-0.5 flex h-4 items-center')
    // Hero context ghost holds the text-xs line box inside the volt button.
    expect(html).toContain('flex h-4 items-center justify-center')
  })

  test('no invitation copy, no Recent section, and no arrival motion while pending', () => {
    const html = renderDrawer()
    // Invitations are a resolved-empty state, never a loading state.
    expect(html).not.toContain('Start a plan')
    expect(html).not.toContain('Recent')
    // The arrival rise-in wraps status content only once data exists; while
    // pending only the row <li>s carry rise-in (one per surface row).
    expect(html.match(/animate-rise-in/g) ?? []).toHaveLength(7)
  })

  test('hero pending variant still renders the quick-log CTA label (no copy change)', () => {
    const html = renderDrawer()
    expect(html).toContain('Start Workout')
    // The "Quick log" context is withheld until data confirms the variant.
    expect(html).not.toContain('Quick log')
  })
})

describe('NavDrawer warm cache (real QueryClient, preseeded [drawer] data)', () => {
  test('renders data synchronously from the cache: no ghosts anywhere', () => {
    const html = renderDrawerWarm()
    expect(html.match(/animate-ghost-in/g) ?? []).toHaveLength(0)
  })

  test('resolved-empty rows show invitations and the hero its Quick log context', () => {
    const html = renderDrawerWarm()
    expect(html).toContain('Start a plan') // Programs invitation, not a ghost
    expect(html).toContain('Quick log') // hero context resolved instantly
  })
})

describe('planDrawerOpen (open/reopen contract — the drawer wires this verbatim)', () => {
  test('first open with a cold cache: enable the query, ghosts + arrival for this open', () => {
    expect(planDrawerOpen({ hasOpened: false, hasData: false, isStale: false })).toEqual({
      openedPending: true,
      enableQuery: true,
      refetchInBackground: false,
    })
  })

  test('reopen with a fresh warm cache: serve it as-is — no refetch, no arrival replay', () => {
    expect(planDrawerOpen({ hasOpened: true, hasData: true, isStale: false })).toEqual({
      openedPending: false,
      enableQuery: false,
      refetchInBackground: false,
    })
  })

  test('reopen past staleTime: background refetch while cached rows stay rendered', () => {
    expect(planDrawerOpen({ hasOpened: true, hasData: true, isStale: true })).toEqual({
      openedPending: false, // data still rendered → no ghosts, no arrival replay
      enableQuery: false,
      refetchInBackground: true,
    })
  })

  test('reopen after a failed first load: ghosts again and a recovery refetch', () => {
    expect(planDrawerOpen({ hasOpened: true, hasData: false, isStale: true })).toEqual({
      openedPending: true,
      enableQuery: false,
      refetchInBackground: true,
    })
  })
})

describe('statusArrival (arrival-animation keying)', () => {
  test('data landing during this open: rise-in with the row-staggered delay', () => {
    expect(statusArrival(true, 2)).toEqual({
      className: 'block motion-safe:animate-rise-in',
      style: { animationDelay: '50ms', animationFillMode: 'backwards' },
    })
  })

  test('cached reopen: static block — no animation classes, no delay to replay', () => {
    expect(statusArrival(false, 2)).toEqual({ className: 'block' })
  })
})
