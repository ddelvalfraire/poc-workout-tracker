import { describe, it, expect, test, vi } from 'vitest'
import { HOME_SECTION_REGISTRY, SHAPE_UNITS, type HomeSectionShape } from '@/lib/home/registry'
import { renderStaticIntl } from '../../vitest.intl'
import type { WorkoutSummary } from '@/db/workouts'
import { HomeBento, type HomeBentoItem } from '@/components/home/home-bento'
import {
  bodySizeForShape,
  renderHomeSections,
  type HomeSectionContext,
} from './home-sections'

/**
 * Wire-level tests for the kind → renderer mapping. Renderers are stubbed
 * (the real ones are async RSCs), so these assert the map's CONTRACT: hidden
 * sections' renderers are never invoked, unknown kinds are skipped silently,
 * and visible sections render in layout order.
 */

const ctx = { userId: 'user_123', nowMs: 0 } as unknown as HomeSectionContext

/** Neutral placeholders. They must render something NON-EMPTY: a renderer
 *  that returns nothing is dropped before packing (its own test below), which
 *  would silently empty the grid these structural tests measure. */
function stubRenderers() {
  return Object.fromEntries(
    HOME_SECTION_REGISTRY.map((s) => [s.kind, vi.fn(() => s.kind)]),
  )
}

/**
 * `renderHomeSections` returns the bento SHELL element, which owns the
 * geometry; the span wrappers are one level inside it. `HomeBento` is a pure
 * function of its props with no hooks, so calling it directly is the cheapest
 * way to see the placements without a renderer — these tests are about which
 * items reach the shell, not about how a browser lays them out (that is
 * components/home/home-bento.stories.tsx, which needs real layout).
 */
function wrappersOf(rendered: ReturnType<typeof renderHomeSections>) {
  const shell = rendered as React.ReactElement<{ items: HomeBentoItem[] }>
  const container = HomeBento(shell.props) as React.ReactElement<{
    className: string
    children: (React.ReactElement<{ style: Record<string, string> }> | null)[]
  }>
  return {
    container,
    items: shell.props.items,
    wrappers: container.props.children.filter((c) => c !== null),
  }
}

describe('renderHomeSections', () => {
  it('invokes every visible renderer in layout order', () => {
    const renderers = stubRenderers()
    renderHomeSections(
      HOME_SECTION_REGISTRY.map((s) => ({
        id: s.kind,
        kind: s.kind,
        shape: s.defaultShape,
        hidden: false,
      })),
      ctx,
      renderers,
    )
    for (const kind of Object.keys(renderers)) {
      expect(renderers[kind]).toHaveBeenCalledTimes(1)
    }
  })

  it('NEVER invokes a hidden section renderer (visible-only queries, by construction)', () => {
    const renderers = stubRenderers()
    renderHomeSections(
      [
        { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: true },
        { id: 'today-recap', kind: 'today-recap', shape: 'wide', hidden: false },
      ],
      ctx,
      renderers,
    )
    expect(renderers['momentum']).not.toHaveBeenCalled()
    expect(renderers['today-recap']).toHaveBeenCalledTimes(1)
  })

  it('silently skips unknown kinds (no renderer, no error)', () => {
    const renderers = stubRenderers()
    expect(() =>
      renderHomeSections(
        [
          { id: 'from-the-future', kind: 'from-the-future', shape: 'wide', hidden: false },
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: false },
        ],
        ctx,
        renderers,
      ),
    ).not.toThrow()
    expect(renderers['momentum']).toHaveBeenCalledTimes(1)
  })

  it('the default renderer map covers every registry kind', () => {
    // The map is module-private; prove coverage by rendering the default map
    // with a full context and asserting nothing is skipped: every section
    // produces a non-null wrapper element.
    const sections = HOME_SECTION_REGISTRY.map((s) => ({
      id: s.kind,
      kind: s.kind,
      shape: s.defaultShape,
      hidden: false,
    }))
    const { wrappers } = wrappersOf(
      renderHomeSections(sections, {
        userId: 'user_123',
        nowMs: 0,
        unit: 'lb',
        recentCompleted: [],
        // Unfinished renders nothing when there is nothing unfinished, and a
        // dropped section is indistinguishable from a missing renderer here —
        // so give it a row to render.
        unfinished: [workout({ completedAt: null })],
      }),
    )
    expect(wrappers).toHaveLength(HOME_SECTION_REGISTRY.length)
  })

  it('places every default section at its own registry shape', () => {
    // The default layout is the registry in order at each kind's default
    // shape. It is no longer a uniform full-width stack: a `micro` default
    // (cardio) is half-width, which is the bento appearing without anyone
    // having customised anything.
    const sections = HOME_SECTION_REGISTRY.map((s) => ({
      id: s.kind,
      kind: s.kind,
      shape: s.defaultShape,
      hidden: false,
    }))
    const { wrappers } = wrappersOf(renderHomeSections(sections, ctx, stubRenderers()))
    const spans = wrappers.map((w) => w.props.style['--c2'])
    HOME_SECTION_REGISTRY.forEach((meta, i) => {
      // Column count comes from SHAPE_UNITS, the single source — restating
      // which shapes are narrow would be a second copy to drift.
      expect(spans[i]).toContain(`span ${SHAPE_UNITS[meta.defaultShape].cols}`)
    })
  })

  it('packs shapes two-dimensionally: a tall cell keeps its column while the next fills beside it', () => {
    const { wrappers } = wrappersOf(
      renderHomeSections(
        [
          { id: 'momentum', kind: 'momentum', shape: 'block', hidden: false },
          { id: 'today-recap', kind: 'today-recap', shape: 'micro', hidden: false },
          { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
        ],
        ctx,
        stubRenderers(),
      ),
    )
    expect(wrappers.map((w) => [w.props.style['--r2'], w.props.style['--c2']])).toEqual([
      // block: both phone columns, two rows
      ['1 / span 2', '1 / span 2'],
      // micro: first free cell after it — row 3, column 1
      ['3 / span 1', '1 / span 1'],
      // wide needs both columns, so it starts a new row rather than
      // squeezing into the gap beside the micro
      ['4 / span 1', '1 / span 2'],
    ])
    // The same list packs tighter on the 4-column grid: the micro sits
    // beside the block instead of below it.
    expect(wrappers.map((w) => w.props.style['--c4'])).toEqual([
      '1 / span 2',
      '3 / span 1',
      '3 / span 2',
    ])
  })

  it('a hidden section reserves no space in the grid', () => {
    const { wrappers } = wrappersOf(
      renderHomeSections(
        [
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: true },
          { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
        ],
        ctx,
        stubRenderers(),
      ),
    )
    expect(wrappers).toHaveLength(1)
    expect(wrappers[0].props.style['--r2']).toBe('1 / span 1')
  })

  /**
   * A section that renders NOTHING must not reserve a cell. The wrapper is
   * not invisible when it is empty: the cell shell paints a closing hairline,
   * so an empty section leaves a stray rule floating in a gap the packer
   * still routed every later cell around.
   */
  it('a section that renders nothing reserves no space in the grid', () => {
    const renderers = { ...stubRenderers(), unfinished: () => null }
    const { wrappers } = wrappersOf(
      renderHomeSections(
        [
          // Renders nothing — must be dropped entirely, not left as a hole.
          { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: false },
        ],
        ctx,
        renderers,
      ),
    )
    expect(wrappers).toHaveLength(1)
    // And the survivor is packed as if the empty one had never been there —
    // it takes the first row, not the second.
    expect(wrappers[0].props.style['--r2']).toBe('1 / span 1')
  })

  /**
   * A tile's body variant follows the tile's HEIGHT, not one named shape.
   * `wide` and `micro` are both one row tall, so both need the compact body;
   * picking on `micro` alone put the full multi-row list inside a one-row
   * `wide` tile, where it could only ever be clipped.
   */
  it('asks for the compact body in every one-row shape, and the full one above', () => {
    expect(bodySizeForShape('micro')).toBe('sm')
    expect(bodySizeForShape('wide')).toBe('sm')
    expect(bodySizeForShape('tall')).toBe('md')
    expect(bodySizeForShape('block')).toBe('md')
    expect(bodySizeForShape('hero')).toBe('md')
  })

  /** The motivating case: Unfinished is a list of stale sessions, and an
   *  account with none of them must not pay a cell for the empty list. */
  it('renders no cell for Unfinished when there is nothing unfinished', () => {
    const { wrappers } = wrappersOf(
      renderHomeSections(
        [{ id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false }],
        { ...ctx, unfinished: [], recentCompleted: [], unit: 'kg' },
      ),
    )
    expect(wrappers).toHaveLength(0)
  })

})

/**
 * Copy contract of the two sections this file owns. Both used to build their
 * meta lines by template literal with a `=== 1 ? '' : 's'` tail, which is
 * untranslatable anywhere with more than two plural forms — so each count is
 * asserted at one AND at many, separately.
 *
 * Only `unfinished` is rendered here: the other two renderers are
 * MomentumPanel (an async RSC that reads the database) and TodayRecap (which
 * renders nothing until it has mounted and can see the user's calendar day).
 */
function workout(over: Partial<WorkoutSummary> = {}): WorkoutSummary {
  return {
    id: 'w1',
    name: 'Push A',
    startedAt: new Date('2026-03-04T10:00:00Z'),
    completedAt: new Date('2026-03-04T11:00:00Z'),
    exerciseCount: 2,
    setCount: 3,
    completedSetCount: 1,
    volumeKg: 1000,
    ...over,
  }
}

function renderSection(
  kind: 'unfinished',
  shape: HomeSectionShape,
  workouts: WorkoutSummary[],
): string {
  return renderStaticIntl(
    renderHomeSections([{ id: kind, kind, shape, hidden: false }], {
      userId: 'user_123',
      nowMs: Date.parse('2026-03-05T09:00:00Z'),
      unit: 'kg',
      recentCompleted: [],
      unfinished: workouts,
    }),
  )
}

describe('HomeSections copy', () => {
  test('names the unfinished section and its resume affordance', () => {
    const html = renderSection('unfinished', 'block', [workout({ completedAt: null })])

    expect(html).toContain('Unfinished')
    expect(html).toContain('Resume')
    expect(html).toContain('Push A')
  })

  test('reads the singular set form on a session with one set logged', () => {
    const html = renderSection('unfinished', 'block', [
      workout({ completedAt: null, completedSetCount: 1 }),
    ])

    expect(html).toContain('started · 1 set logged')
    expect(html).not.toContain('sets logged')
  })

  test('reads the plural set form on a session with several sets logged', () => {
    const html = renderSection('unfinished', 'block', [
      workout({ completedAt: null, completedSetCount: 4 }),
    ])

    expect(html).toContain('started · 4 sets logged')
  })

  test('falls back to the untitled-workout name', () => {
    const html = renderSection('unfinished', 'block', [workout({ completedAt: null, name: null })])

    expect(html).toContain('Workout')
  })

  test('resolves every key it references', () => {
    const unfinished = renderSection('unfinished', 'block', [workout({ completedAt: null })])

    expect(unfinished).not.toMatch(/HomeSections\.[a-zA-Z.]+/)
  })
})

/**
 * The one-row form.
 *
 * `wide` is Unfinished's default and, at one row tall, has room for a heading
 * and a list of nothing — the list body could only ever be clipped there. The
 * compact form is a QUEUE HEAD instead: it names the session you stalled on,
 * says how far in you got, and resuming is the tile itself. Handle it and the
 * next one takes its place, which is why showing only one is not a teaser row
 * ([[home-status-design]] bans those) — there is no dead end and nothing to
 * tap through to. The full log lives at /history.
 */
describe('Unfinished, in a one-row tile', () => {
  test('names the stalled session and how far in it stopped', () => {
    const html = renderSection('unfinished', 'wide', [
      workout({ completedAt: null, completedSetCount: 12 }),
    ])

    expect(html).toContain('Unfinished')
    expect(html).toContain('12')
    expect(html).toContain('sets in')
    expect(html).toContain('Push A')
  })

  test('reads the singular unit on a session with one set logged', () => {
    const html = renderSection('unfinished', 'wide', [
      workout({ completedAt: null, completedSetCount: 1 }),
    ])

    expect(html).toContain('set in')
    expect(html).not.toContain('sets in')
  })

  /** The whole tile resumes it. A compact tile that only DESCRIBES the stalled
   *  session, leaving the action somewhere else, is the teaser row. */
  test('is itself the resume link, not a pointer to one', () => {
    const html = renderSection('unfinished', 'wide', [workout({ completedAt: null, id: 'w9' })])

    expect(html).toContain('href="/workout/w9/edit"')
  })

  /** Newest first: the queue head is the session you most recently walked away
   *  from, not the oldest one still lying around. */
  test('shows the most recently started session when several are stalled', () => {
    const html = renderSection('unfinished', 'wide', [
      workout({ completedAt: null, id: 'old', name: 'Legs A', startedAt: new Date('2026-03-01T10:00:00Z') }),
      workout({ completedAt: null, id: 'new', name: 'Pull B', startedAt: new Date('2026-03-04T10:00:00Z') }),
    ])

    expect(html).toContain('Pull B')
    expect(html).toContain('href="/workout/new/edit"')
    expect(html).not.toContain('Legs A')
  })

  test('falls back to the untitled-workout name', () => {
    const html = renderSection('unfinished', 'wide', [workout({ completedAt: null, name: null })])

    expect(html).toContain('Workout')
  })

  test('resolves every key it references', () => {
    const html = renderSection('unfinished', 'wide', [workout({ completedAt: null })])

    expect(html).not.toMatch(/HomeSections\.[a-zA-Z.]+/)
  })
})
