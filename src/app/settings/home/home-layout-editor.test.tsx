import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ResolvedHomeSection } from '@/lib/home/layout'

// The editor only touches the router and the server action inside handlers,
// so a static server render with both stubbed covers the markup contract —
// the back-link.test.tsx pattern.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/app/actions', () => ({
  setHomeLayoutAction: vi.fn(),
}))

import { HomeLayoutEditor } from './home-layout-editor'

const sections: ResolvedHomeSection[] = [
  { kind: 'momentum', size: 'sm', hidden: false },
  { kind: 'today-recap', size: 'md', hidden: true },
  { kind: 'unfinished', size: 'md', hidden: false },
  { kind: 'history', size: 'lg', hidden: false },
]

describe('HomeLayoutEditor (grid preview)', () => {
  test('leads with the locked Status bar — labeled, lock icon, no button', () => {
    const html = renderToStaticMarkup(<HomeLayoutEditor initialSections={sections} />)
    const statusBar = html.slice(0, html.indexOf('grid-cols-2'))
    expect(statusBar).toContain('aria-label="Status — always shown, always first"')
    expect(statusBar).toContain('<svg') // the Lock icon
    expect(statusBar).not.toContain('<button') // present but non-interactive
  })

  test("renders home's 2-col flow with SIZE_SPAN parity: sm half-width, md/lg full-width", () => {
    const html = renderToStaticMarkup(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('grid grid-cols-2 gap-x-3')
    // One sm tile → exactly one half-width wrapper; the other three span full.
    expect(html.match(/col-span-1/g)).toHaveLength(1)
    expect(html.match(/col-span-2/g)).toHaveLength(3)
  })

  test('every tile is a schematic button (title + bg-muted bars, aria size state)', () => {
    const html = renderToStaticMarkup(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('aria-label="Momentum — Small. Edit section"')
    expect(html).toContain('aria-label="History — Large. Edit section"')
    expect(html).toContain('bg-muted')
  })

  test('a hidden section renders dimmed IN PLACE, announced hidden', () => {
    const html = renderToStaticMarkup(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('aria-label="Today — hidden. Edit section"')
    expect(html).toContain('opacity-40')
    // In place: Today's tile sits between Momentum's and Unfinished's.
    expect(html.indexOf('Today — hidden')).toBeGreaterThan(html.indexOf('Momentum — Small'))
    expect(html.indexOf('Today — hidden')).toBeLessThan(html.indexOf('Unfinished'))
  })

  test('no sheet before a tile is tapped, and Reset stays', () => {
    const html = renderToStaticMarkup(<HomeLayoutEditor initialSections={sections} />)
    expect(html).not.toContain('<dialog')
    expect(html).toContain('Reset to default')
  })

  test('server render is the STATIC grid — no drag attributes before the dnd chunk loads', () => {
    // The dnd grid arrives via a post-hydration dynamic import (effects never
    // run in a static render): no-JS users and the loading window get the
    // complete Phase 2 editor, and home-adjacent bundles stay dnd-free.
    const html = renderToStaticMarkup(<HomeLayoutEditor initialSections={sections} />)
    expect(html).not.toContain('aria-roledescription')
    expect(html).not.toContain('draggable')
  })
})
