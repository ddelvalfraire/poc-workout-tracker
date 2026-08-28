import { describe, expect, test, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { applyPreset, HOME_PRESETS, type HomePresetId } from '@/lib/home/presets'

/** The chip copy, derived from the preset table rather than hand-listed, so a
 *  new preset fails here instead of being silently untested. */
const LABELS: Record<HomePresetId, string> = {
  cut: 'Cut',
  bulk: 'Bulk',
  powerlifting: 'Powerlifting',
  hypertrophy: 'Hypertrophy',
  conditioning: 'Conditioning',
  consistency: 'Consistency',
  volume: 'Volume',
}

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
  { id: 'momentum', kind: 'momentum', shape: 'micro', hidden: false },
  { id: 'today-recap', kind: 'today-recap', shape: 'wide', hidden: true },
  { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
]

describe('HomeLayoutEditor (grid preview)', () => {
  test('leads with the locked Status bar — labeled, lock icon, no button', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    // Scoped to the bar itself rather than to everything above the grid: the
    // preset chips legitimately sit above it, and they are very much buttons.
    const statusBar = html.slice(html.indexOf('aria-label="Status'), html.indexOf('grid-cols-2'))
    expect(statusBar).toContain('aria-label="Status — always shown, always first"')
    expect(statusBar).toContain('<svg') // the Lock icon
    expect(statusBar).not.toContain('<button') // present but non-interactive
  })

  test("renders home's 2-col flow with SIZE_SPAN parity: sm half-width, md/lg full-width", () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('grid grid-cols-2 gap-x-3')
    // One sm tile → exactly one half-width wrapper; the other three span full.
    expect(html.match(/col-span-1/g)).toHaveLength(1)
    expect(html.match(/col-span-2/g)).toHaveLength(2)
  })

  test('every tile is a schematic button (title + bg-muted bars, aria shape state)', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('aria-label="Momentum — Small. Edit section"')
    expect(html).toContain('aria-label="Unfinished — Wide. Edit section"')
    expect(html).toContain('bg-muted')
  })

  test('a hidden section renders dimmed IN PLACE, announced hidden', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('aria-label="Today — hidden. Edit section"')
    expect(html).toContain('opacity-40')
    // In place: Today's tile sits between Momentum's and Unfinished's.
    expect(html.indexOf('Today — hidden')).toBeGreaterThan(html.indexOf('Momentum — Small'))
    expect(html.indexOf('Today — hidden')).toBeLessThan(html.indexOf('Unfinished'))
  })

  test('no sheet before a tile is tapped, and Reset stays', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(html).not.toContain('<dialog')
    expect(html).toContain('Reset to default')
  })

  test('offers every named layout as a chip', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    for (const preset of HOME_PRESETS) {
      expect(html).toContain(`>${LABELS[preset.id]}</button>`)
    }
  })

  test('marks the chip pressed only while the layout still IS that preset', () => {
    const applied = applyPreset('cut')
    const onCut = renderStaticIntl(<HomeLayoutEditor initialSections={applied} />)
    expect(onCut).toContain('aria-pressed="true"')
    // An arbitrary layout is nobody's preset, so no chip claims it.
    const custom = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(custom).not.toContain('aria-pressed="true"')
  })

  test('says nothing about the derived read when there is none', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} signal={null} />)
    expect(html).not.toContain('What we read from your training')
    expect(html).not.toContain('>Use</button>')
  })

  test('reports the derived read passively, with its evidence and a Use action', () => {
    const html = renderStaticIntl(
      <HomeLayoutEditor
        initialSections={sections}
        signal={{
          preset: 'hypertrophy',
          medianWorkingReps: 11,
          muscleGroupCount: 7,
          windowWeeks: 8,
        }}
      />,
    )
    expect(html).toContain('What we read from your training')
    expect(html).toContain('Median 11 reps')
    expect(html).toContain('7 muscle groups')
    // It offers; it never applies itself. And it says where it did NOT look.
    expect(html).toContain('>Use</button>')
    expect(html).toContain('never from what you tap on this screen')
  })

  test('does not suggest the layout you are already on', () => {
    const html = renderStaticIntl(
      <HomeLayoutEditor
        initialSections={applyPreset('cut')}
        signal={{ preset: 'cut', medianWorkingReps: 8, muscleGroupCount: 6, windowWeeks: 8 }}
      />,
    )
    expect(html).not.toContain('What we read from your training')
  })

  test('offers the gallery, but does not open it until asked', () => {
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(html).toContain('Add a widget')
    expect(html).not.toContain('<dialog')
  })

  test('server render is the STATIC grid — no drag attributes before the dnd chunk loads', () => {
    // The dnd grid arrives via a post-hydration dynamic import (effects never
    // run in a static render): no-JS users and the loading window get the
    // complete Phase 2 editor, and home-adjacent bundles stay dnd-free.
    const html = renderStaticIntl(<HomeLayoutEditor initialSections={sections} />)
    expect(html).not.toContain('aria-roledescription')
    expect(html).not.toContain('draggable')
  })
})
