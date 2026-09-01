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
// The footer's SignOutButton calls a `'use server'` module; stub it so the
// drawer renders without pulling the server action graph into jsdom.
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

import type { DrawerData } from '@/lib/home/drawer-status'
import { NavDrawer, planDrawerOpen, statusArrival } from './nav-drawer'

/** Static render with the Query provider NavDrawer's useQuery now requires;
 *  queries stay disabled — this suite asserts the pending markup contract. */
function renderDrawer(): string {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NavDrawer userId="user_1" />
    </QueryClientProvider>,
  )
}

/** The resolved-empty account: every section null → each row shows its
 *  invitation, the hero shows Quick log. */
const warmDrawerData: DrawerData = {
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

/** Warm-cache render: a REAL QueryClient preseeded with ['drawer'] data, the
 *  state a reopen (or another page's drawer) finds. useQuery must serve it
 *  synchronously — no fetch, no ghosts. */
function renderDrawerWarm(): string {
  const client = new QueryClient()
  client.setQueryData(['drawer', 'user_1'], warmDrawerData)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NavDrawer userId="user_1" />
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
  test('renders one ghost per status slot: 9 surface rows + the hero’s two lines', () => {
    const html = renderDrawer()
    const ghosts = html.match(/animate-ghost-in/g) ?? []
    // Programs, Templates, Stats, History, Goals, Trophies, Body, Exercises,
    // Notes (no Coach row before data), plus the ACT hero's title + context.
    expect(ghosts).toHaveLength(11)
  })

  test('ghosts sit in the status line’s exact h-4 line box (zero-shift contract)', () => {
    const html = renderDrawer()
    // Surface rows: mt-0.5 + h-4 mirrors the real status span's mt-0.5 +
    // text-xs line height, so arrival never changes row height.
    expect(html).toContain('mt-0.5 flex h-4 items-center')
    // The hero ghost fills the same min-h-17 box every resolved variant does.
    expect(html).toContain('min-h-17')
  })

  test('withholds every CTA until the data has earned one', () => {
    const html = renderDrawer()
    // A "Start Workout" shown before the facts arrive is a false promise to a
    // user who already trained today or has nothing scheduled.
    expect(html).not.toContain('Start Workout')
    expect(html).not.toContain('Resume')
    expect(html).not.toContain('Quick log')
    expect(html).not.toContain('Done for today')
    expect(html).not.toContain('bg-primary text-primary-foreground')
  })

  test('no invitation copy, no Recent section, and no arrival motion while pending', () => {
    const html = renderDrawer()
    // Invitations are a resolved-empty state, never a loading state.
    expect(html).not.toContain('Start a plan')
    expect(html).not.toContain('Recent')
    // The arrival rise-in wraps status content only once data exists; while
    // pending only the row <li>s carry rise-in (one per surface row).
    expect(html.match(/animate-rise-in/g) ?? []).toHaveLength(9)
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

/** A fully populated account — every status line has a fact to state, so this
 *  is where the drawer's descriptors (lib/drawer-status.ts) get RENDERED
 *  through the real catalog. `weekdays: []` keeps the up-next line
 *  anchor-free, and the recent workout is stamped now, so both are
 *  independent of the clock the suite happens to run on. */
const fullDrawerData: DrawerData = {
  ...warmDrawerData,
  upNext: { dayId: 'd1', dayName: 'Legs', week: 3, weekdays: [] },
  program: { id: 'p1', name: 'Upper/Lower Hybrid', week: 3, mesocycleWeeks: 7, blockComplete: false },
  stats: { weekSets: 42, daySets: [1, 2, 3, 4, 5, 6, 7] },
  trophies: { earned: 12, newestLabel: '315 Squat Club' },
  body: { weightKg: 83.9, deltaKg: -0.9, checkInDue: true, daysSinceLast: 8 },
  exercises: { lastPrLabel: '315 Squat Club', loggedCount: 24 },
  recents: [{ id: 'w1', name: 'Push A', startedAtMs: Date.now(), volumeKg: 3663 }],
  unit: 'lb',
}

function renderDrawerWith(data: DrawerData): string {
  const client = new QueryClient()
  client.setQueryData(['drawer', 'user_1'], data)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NavDrawer userId="user_1" />
    </QueryClientProvider>,
  )
}

function renderDrawerFull(): string {
  return renderDrawerWith(fullDrawerData)
}

/** The volt skin — the one class pair every primary button carries. Its
 *  presence IS the "bright green CTA" the hero may only show when there is
 *  a workout to resume or start. */
const VOLT = 'bg-primary text-primary-foreground'

describe('NavDrawer hero (home’s seven-state brain over the drawer payload)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  test('program due (unscheduled = always due): the volt Start with its context', () => {
    const html = renderDrawerFull()
    expect(html).toContain(VOLT)
    expect(html).toContain('Start Workout')
    expect(html).toContain('Legs · Week 3')
  })

  test('live session: the volt Resume, even with a program day pending', () => {
    const html = renderDrawerWith({
      ...fullDrawerData,
      resume: { key: 'new', name: 'Push A' },
      upNext: null,
    })
    expect(html).toContain(VOLT)
    expect(html).toContain('Resume')
    expect(html).not.toContain('Start Workout')
  })

  test('trained today: quiet "Done for today." with the receipt and a muted Log more door', () => {
    const html = renderDrawerWith({
      ...fullDrawerData,
      recentCompletedAtTimes: [Date.now()],
      lastCompleted: { id: 'w1', name: 'Push A', completedAtMs: Date.now(), volumeKg: 3663 },
    })
    expect(html).toContain('Done for today.')
    expect(html).toContain('Push A · 8,076 lb')
    expect(html).toContain('Log more')
    expect(html).toContain('href="/workout/new"')
    // The day's work is done: no volt, no Start — a green CTA here would be a
    // promise the data does not back.
    expect(html).not.toContain(VOLT)
    expect(html).not.toContain('Start Workout')
  })

  test('rest day (scheduled for another day): quiet "Rest day." naming the next day', () => {
    const notToday = (new Date().getDay() + 2) % 7
    const html = renderDrawerWith({
      ...fullDrawerData,
      upNext: { dayId: 'd1', dayName: 'Legs', week: 3, weekdays: [notToday] },
      lastCompleted: { id: 'w0', name: 'Push A', completedAtMs: Date.now() - DAY_MS, volumeKg: 3663 },
    })
    expect(html).toContain('Rest day.')
    expect(html).toContain('Next: Legs · ')
    expect(html).toContain('Quick log')
    expect(html).not.toContain(VOLT)
    expect(html).not.toContain('Start Workout')
  })

  test('block complete: quiet "Block complete." with the block length and a See results door', () => {
    const html = renderDrawerWith({
      ...fullDrawerData,
      upNext: null,
      program: { ...fullDrawerData.program!, blockComplete: true },
      lastCompleted: { id: 'w0', name: 'Legs', completedAtMs: Date.now() - DAY_MS, volumeKg: 3663 },
    })
    expect(html).toContain('Block complete.')
    expect(html).toContain('Upper/Lower Hybrid · 7 weeks')
    expect(html).toContain('See results')
    expect(html).toContain('href="/programs/p1/stats"')
    expect(html).not.toContain(VOLT)
  })

  test('drifting with a program: the volt Start is the way back in (home parity)', () => {
    const notToday = (new Date().getDay() + 2) % 7
    const html = renderDrawerWith({
      ...fullDrawerData,
      upNext: { dayId: 'd1', dayName: 'Legs', week: 3, weekdays: [notToday] },
      lastCompleted: { id: 'w0', name: 'Push A', completedAtMs: Date.now() - 6 * DAY_MS, volumeKg: 3663 },
    })
    expect(html).toContain(VOLT)
    expect(html).toContain('Start Workout')
  })

  test('every hero variant renders inside the same box geometry (zero-shift contract)', () => {
    for (const html of [
      renderDrawer(),
      renderDrawerFull(),
      renderDrawerWith({
        ...fullDrawerData,
        recentCompletedAtTimes: [Date.now()],
        lastCompleted: { id: 'w1', name: 'Push A', completedAtMs: Date.now(), volumeKg: 3663 },
      }),
    ]) {
      expect(html).toContain('min-h-17')
    }
  })
})

describe('NavDrawer history row', () => {
  // Home no longer renders a history section, so this row is the only way to
  // reach the full log. If it goes, the route is orphaned.
  test('links to /history and states the newest session as its status', () => {
    const html = renderDrawerFull()
    expect(html).toContain('href="/history"')
    expect(html).toContain('History')
    expect(html).toContain('Push A')
  })

  test('falls back to its invitation when nothing has been logged', () => {
    const html = renderDrawerWarm()
    expect(html).toContain('href="/history"')
    expect(html).toContain('Every session you have finished')
  })
})

describe('NavDrawer status lines (descriptors rendered through the real catalog)', () => {
  test('every row states its fact in words, not in key paths', () => {
    const html = renderDrawerFull()
    expect(html).toContain('Upper/Lower Hybrid · Wk 3/7')
    expect(html).toContain('42 sets this week')
    expect(html).toContain('12 earned · newest: 315 Squat Club')
    expect(html).toContain('185 lb ↘ · check-in due')
    expect(html).toContain('Last PR: 315 Squat Club')
    expect(html).toContain('Legs · Week 3')
    expect(html).toContain('Today · 8,076 lb')
  })

  test('resolves every key it references', () => {
    expect(renderDrawerFull()).not.toMatch(/NavDrawer\.[a-zA-Z.]+/)
    expect(renderDrawerWarm()).not.toMatch(/NavDrawer\.[a-zA-Z.]+/)
  })
})

describe('planDrawerOpen (open/reopen contract — the drawer wires this verbatim)', () => {
  test('open while the mount-time fetch is still in flight: ghosts, and NO second request', () => {
    expect(planDrawerOpen({ hasData: false, isStale: true, isFetching: true })).toEqual({
      openedPending: true,
      refetchInBackground: false,
    })
  })

  test('open with a fresh warm cache: serve it as-is — no refetch, no arrival replay', () => {
    expect(planDrawerOpen({ hasData: true, isStale: false, isFetching: false })).toEqual({
      openedPending: false,
      refetchInBackground: false,
    })
  })

  test('open past staleTime: background refetch while cached rows stay rendered', () => {
    expect(planDrawerOpen({ hasData: true, isStale: true, isFetching: false })).toEqual({
      openedPending: false, // data still rendered → no ghosts, no arrival replay
      refetchInBackground: true,
    })
  })

  test('open after a failed cold fetch: ghosts again and a recovery refetch', () => {
    expect(planDrawerOpen({ hasData: false, isStale: true, isFetching: false })).toEqual({
      openedPending: true,
      refetchInBackground: true,
    })
  })

  test('a revalidation already running past staleTime is left alone', () => {
    expect(planDrawerOpen({ hasData: true, isStale: true, isFetching: true })).toEqual({
      openedPending: false,
      refetchInBackground: false,
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
