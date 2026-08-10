import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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

import { NavDrawer } from './nav-drawer'

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
  test('renders one ghost per status slot: 6 surface rows + the hero context line', () => {
    const html = renderToStaticMarkup(<NavDrawer />)
    const ghosts = html.match(/animate-ghost-in/g) ?? []
    // Programs, Stats, Goals, Trophies, Body, Exercises (no Coach row before
    // data), plus the ACT hero's context line.
    expect(ghosts).toHaveLength(7)
  })

  test('ghosts sit in the status line’s exact h-4 line box (zero-shift contract)', () => {
    const html = renderToStaticMarkup(<NavDrawer />)
    // Surface rows: mt-0.5 + h-4 mirrors the real status span's mt-0.5 +
    // text-xs line height, so arrival never changes row height.
    expect(html).toContain('mt-0.5 flex h-4 items-center')
    // Hero context ghost holds the text-xs line box inside the volt button.
    expect(html).toContain('flex h-4 items-center justify-center')
  })

  test('no invitation copy, no Recent section, and no arrival motion while pending', () => {
    const html = renderToStaticMarkup(<NavDrawer />)
    // Invitations are a resolved-empty state, never a loading state.
    expect(html).not.toContain('Start a plan')
    expect(html).not.toContain('Recent')
    // The arrival rise-in wraps status content only once data exists; while
    // pending only the row <li>s carry rise-in (one per surface row).
    expect(html.match(/animate-rise-in/g) ?? []).toHaveLength(6)
  })

  test('hero pending variant still renders the quick-log CTA label (no copy change)', () => {
    const html = renderToStaticMarkup(<NavDrawer />)
    expect(html).toContain('Start Workout')
    // The "Quick log" context is withheld until data confirms the variant.
    expect(html).not.toContain('Quick log')
  })
})
