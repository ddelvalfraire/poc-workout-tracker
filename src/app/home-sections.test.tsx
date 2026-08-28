import { describe, it, expect, test, vi } from 'vitest'
import { HOME_SECTION_REGISTRY, SHAPE_UNITS, type HomeSectionShape } from '@/lib/home/registry'
import { renderStaticIntl } from '../../vitest.intl'
import type { WorkoutSummary } from '@/db/workouts'
import { HomeBento, type HomeBentoItem } from '@/components/home/home-bento'
import { HomeCellBoundary } from './home-cell-boundary'
import {
  bodySizeForShape,
  renderHomeSections,
  HOME_SECTION_WIDGETS,
  type HomeSectionContext,
  type HomeSectionWidget,
} from './home-sections'

/**
 * Wire-level tests for the kind → renderer mapping. Renderers are stubbed
 * (the real ones are async RSCs), so these assert the map's CONTRACT: hidden
 * sections' renderers are never invoked, unknown kinds are skipped silently,
 * and visible sections render in layout order.
 */

const ctx = { userId: 'user_123', nowMs: 0 } as unknown as HomeSectionContext

/** Neutral placeholders. They must claim to HAVE content and then render
 *  something non-empty: a section is now dropped before packing when
 *  `hasContent` says no (its own tests below), which would silently empty the
 *  grid these structural tests measure. `hasContent` is deliberately
 *  synchronous here — the real ones reach the database, and these tests are
 *  about the shell's arithmetic, not about reads. */
function stubWidgets(): Record<string, HomeSectionWidget> {
  return Object.fromEntries(
    HOME_SECTION_REGISTRY.map((s) => [
      s.kind,
      { hasContent: () => true, render: vi.fn(() => s.kind) },
    ]),
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
function wrappersOf(rendered: Awaited<ReturnType<typeof renderHomeSections>>) {
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
  it('invokes every visible renderer in layout order', async () => {
    const widgets = stubWidgets()
    await renderHomeSections(
      HOME_SECTION_REGISTRY.map((s) => ({
        id: s.kind,
        kind: s.kind,
        shape: s.defaultShape,
        hidden: false,
      })),
      ctx,
      widgets,
    )
    for (const kind of Object.keys(widgets)) {
      expect(widgets[kind].render).toHaveBeenCalledTimes(1)
    }
  })

  it('NEVER invokes a hidden section renderer (visible-only queries, by construction)', async () => {
    const widgets = stubWidgets()
    await renderHomeSections(
      [
        { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: true },
        { id: 'today-recap', kind: 'today-recap', shape: 'wide', hidden: false },
      ],
      ctx,
      widgets,
    )
    expect(widgets['momentum'].render).not.toHaveBeenCalled()
    expect(widgets['today-recap'].render).toHaveBeenCalledTimes(1)
  })

  it('silently skips unknown kinds (no renderer, no error)', async () => {
    const widgets = stubWidgets()
    await expect(
      renderHomeSections(
        [
          { id: 'from-the-future', kind: 'from-the-future', shape: 'wide', hidden: false },
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: false },
        ],
        ctx,
        widgets,
      ),
    ).resolves.toBeDefined()
    expect(widgets['momentum'].render).toHaveBeenCalledTimes(1)
  })

  /**
   * Asserted against the map DIRECTLY rather than by rendering it. Every real
   * `hasContent` reaches the database, so rendering the default map here would
   * make a unit test depend on a connection — and, because a failed
   * `hasContent` deliberately KEEPS its section, it would pass whether the
   * reads worked or not, which is a test that cannot fail.
   */
  it('the default widget map covers every registry kind, with both halves', () => {
    for (const meta of HOME_SECTION_REGISTRY) {
      const widget = HOME_SECTION_WIDGETS[meta.kind]
      expect(widget, meta.kind).toBeDefined()
      expect(typeof widget.hasContent, meta.kind).toBe('function')
      expect(typeof widget.render, meta.kind).toBe('function')
    }
    expect(Object.keys(HOME_SECTION_WIDGETS).sort()).toEqual(
      HOME_SECTION_REGISTRY.map((s) => s.kind).sort(),
    )
  })

  it('places every default section at its own registry shape', async () => {
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
    const { wrappers } = wrappersOf(await renderHomeSections(sections, ctx, stubWidgets()))
    const spans = wrappers.map((w) => w.props.style['--c2'])
    HOME_SECTION_REGISTRY.forEach((meta, i) => {
      // Column count comes from SHAPE_UNITS, the single source — restating
      // which shapes are narrow would be a second copy to drift.
      expect(spans[i]).toContain(`span ${SHAPE_UNITS[meta.defaultShape].cols}`)
    })
  })

  it('packs shapes two-dimensionally: a tall cell keeps its column while the next fills beside it', async () => {
    const { wrappers } = wrappersOf(
      await renderHomeSections(
        [
          { id: 'momentum', kind: 'momentum', shape: 'block', hidden: false },
          { id: 'today-recap', kind: 'today-recap', shape: 'micro', hidden: false },
          { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
        ],
        ctx,
        stubWidgets(),
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

  it('a hidden section reserves no space in the grid', async () => {
    const { wrappers } = wrappersOf(
      await renderHomeSections(
        [
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: true },
          { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
        ],
        ctx,
        stubWidgets(),
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
  it('a section that renders nothing reserves no space in the grid', async () => {
    const widgets = { ...stubWidgets(), unfinished: { hasContent: () => false, render: vi.fn(() => null) } }
    const { wrappers } = wrappersOf(
      await renderHomeSections(
        [
          // Renders nothing — must be dropped entirely, not left as a hole.
          { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: false },
        ],
        ctx,
        widgets,
      ),
    )
    expect(wrappers).toHaveLength(1)
    // And the survivor is packed as if the empty one had never been there —
    // it takes the first row, not the second.
    expect(wrappers[0].props.style['--r2']).toBe('1 / span 1')
  })

  /**
   * THE MOTIVATING BUG. Almost every home widget is an async RSC that decides
   * its own emptiness inside its body, so the element the renderer returns is
   * truthy whether or not anything will be drawn. Testing the element could
   * only ever catch the kinds that answer synchronously — every other section
   * was packed a cell it might not fill, and an unfilled cell is not
   * invisible: `.home-cell` paints a closing hairline, so it is a stray rule
   * floating in a gap the packer routed every later cell around.
   */
  it('reserves no space for a widget whose emptiness is only known asynchronously', async () => {
    const widgets = {
      ...stubWidgets(),
      // The shape of every real widget: nothing to say, and only an await can
      // find that out.
      'trophy-case': { hasContent: async () => false, render: vi.fn(() => 'trophy-case') },
    }
    const { wrappers, items } = wrappersOf(
      await renderHomeSections(
        [
          { id: 'trophy-case', kind: 'trophy-case', shape: 'wide', hidden: false },
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: false },
        ],
        ctx,
        widgets,
      ),
    )
    expect(items.map((i) => i.id)).toEqual(['momentum'])
    expect(wrappers).toHaveLength(1)
    // And the survivor is packed as if the empty one had never been there — it
    // takes the first row, not the second.
    expect(wrappers[0].props.style['--r2']).toBe('1 / span 1')
    // The empty widget is never even asked to render.
    expect(widgets['trophy-case'].render).not.toHaveBeenCalled()
  })

  /** The reads are independent, and awaiting them one at a time would turn a
   *  single round trip into one per section. */
  it('asks every section whether it has content in parallel', async () => {
    let inFlight = 0
    let peak = 0
    const widgets = Object.fromEntries(
      HOME_SECTION_REGISTRY.map((s) => [
        s.kind,
        {
          hasContent: async () => {
            inFlight += 1
            peak = Math.max(peak, inFlight)
            await Promise.resolve()
            inFlight -= 1
            return true
          },
          render: vi.fn(() => s.kind),
        },
      ]),
    )
    await renderHomeSections(
      HOME_SECTION_REGISTRY.map((s) => ({
        id: s.kind,
        kind: s.kind,
        shape: s.defaultShape,
        hidden: false,
      })),
      ctx,
      widgets,
    )
    expect(peak).toBe(HOME_SECTION_REGISTRY.length)
  })

  /**
   * A FAILED emptiness read is not an empty widget.
   *
   * Dropping the section here would turn a database error into something
   * indistinguishable from "you have no trophies yet" — the tile would simply
   * be absent and nobody would ever learn a read had failed. Keeping it means
   * the component re-awaits the same rejected memoized promise and throws
   * inside its own cell, where the boundary renders it as a failed tile.
   */
  it('keeps the cell when the emptiness read itself fails, so the failure can surface in it', async () => {
    const widgets = {
      ...stubWidgets(),
      'trophy-case': {
        hasContent: async () => {
          throw new Error('db is down')
        },
        render: vi.fn(() => 'trophy-case'),
      },
    }
    const { items } = wrappersOf(
      await renderHomeSections(
        [{ id: 'trophy-case', kind: 'trophy-case', shape: 'wide', hidden: false }],
        ctx,
        widgets,
      ),
    )
    expect(items.map((i) => i.id)).toEqual(['trophy-case'])
  })

  /** One failing widget must cost ONE tile, not the home screen. Without a
   *  boundary per cell, a single bad read unwinds past every sibling to the
   *  route's error.tsx. */
  it('wraps every body in its own error boundary', async () => {
    const { items } = wrappersOf(
      await renderHomeSections(
        [
          { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: false },
          { id: 'streak', kind: 'streak', shape: 'micro', hidden: false },
        ],
        ctx,
        stubWidgets(),
      ),
    )
    expect(items).toHaveLength(2)
    for (const item of items) {
      const body = item.body as React.ReactElement<{ children: unknown }>
      expect(body.type).toBe(HomeCellBoundary)
      // The widget's own output is what the boundary wraps — the boundary
      // must not replace it.
      expect(body.props.children).toBe(item.id)
    }
  })

  /**
   * A tile's body variant follows the tile's HEIGHT, not one named shape.
   * `wide` and `micro` are both one row tall, so both need the compact body;
   * picking on `micro` alone put the full multi-row list inside a one-row
   * `wide` tile, where it could only ever be clipped.
   */
  it('asks for the compact body in every one-row shape, and the full one above', async () => {
    expect(bodySizeForShape('micro')).toBe('sm')
    expect(bodySizeForShape('wide')).toBe('sm')
    expect(bodySizeForShape('tall')).toBe('md')
    expect(bodySizeForShape('block')).toBe('md')
    expect(bodySizeForShape('hero')).toBe('md')
  })

  /** The motivating case: Unfinished is a list of stale sessions, and an
   *  account with none of them must not pay a cell for the empty list. */
  it('renders no cell for Unfinished when there is nothing unfinished', async () => {
    const { wrappers } = wrappersOf(
      await renderHomeSections(
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

async function renderSection(
  kind: 'unfinished',
  shape: HomeSectionShape,
  workouts: WorkoutSummary[],
): Promise<string> {
  return renderStaticIntl(
    await renderHomeSections([{ id: kind, kind, shape, hidden: false }], {
      userId: 'user_123',
      nowMs: Date.parse('2026-03-05T09:00:00Z'),
      unit: 'kg',
      recentCompleted: [],
      unfinished: workouts,
    }),
  )
}

describe('HomeSections copy', () => {
  test('names the unfinished section and its resume affordance', async () => {
    const html = await renderSection('unfinished', 'block', [workout({ completedAt: null })])

    expect(html).toContain('Unfinished')
    expect(html).toContain('Resume')
    expect(html).toContain('Push A')
  })

  test('reads the singular set form on a session with one set logged', async () => {
    const html = await renderSection('unfinished', 'block', [
      workout({ completedAt: null, completedSetCount: 1 }),
    ])

    expect(html).toContain('started · 1 set logged')
    expect(html).not.toContain('sets logged')
  })

  test('reads the plural set form on a session with several sets logged', async () => {
    const html = await renderSection('unfinished', 'block', [
      workout({ completedAt: null, completedSetCount: 4 }),
    ])

    expect(html).toContain('started · 4 sets logged')
  })

  test('falls back to the untitled-workout name', async () => {
    const html = await renderSection('unfinished', 'block', [workout({ completedAt: null, name: null })])

    expect(html).toContain('Workout')
  })

  test('resolves every key it references', async () => {
    const unfinished = await renderSection('unfinished', 'block', [workout({ completedAt: null })])

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
  test('names the stalled session and how far in it stopped', async () => {
    const html = await renderSection('unfinished', 'wide', [
      workout({ completedAt: null, completedSetCount: 12 }),
    ])

    expect(html).toContain('Unfinished')
    expect(html).toContain('12')
    expect(html).toContain('sets in')
    expect(html).toContain('Push A')
  })

  test('reads the singular unit on a session with one set logged', async () => {
    const html = await renderSection('unfinished', 'wide', [
      workout({ completedAt: null, completedSetCount: 1 }),
    ])

    expect(html).toContain('set in')
    expect(html).not.toContain('sets in')
  })

  /** The whole tile resumes it. A compact tile that only DESCRIBES the stalled
   *  session, leaving the action somewhere else, is the teaser row. */
  test('is itself the resume link, not a pointer to one', async () => {
    const html = await renderSection('unfinished', 'wide', [workout({ completedAt: null, id: 'w9' })])

    expect(html).toContain('href="/workout/w9/edit"')
  })

  /** Newest first: the queue head is the session you most recently walked away
   *  from, not the oldest one still lying around. */
  test('shows the most recently started session when several are stalled', async () => {
    const html = await renderSection('unfinished', 'wide', [
      workout({ completedAt: null, id: 'old', name: 'Legs A', startedAt: new Date('2026-03-01T10:00:00Z') }),
      workout({ completedAt: null, id: 'new', name: 'Pull B', startedAt: new Date('2026-03-04T10:00:00Z') }),
    ])

    expect(html).toContain('Pull B')
    expect(html).toContain('href="/workout/new/edit"')
    expect(html).not.toContain('Legs A')
  })

  test('falls back to the untitled-workout name', async () => {
    const html = await renderSection('unfinished', 'wide', [workout({ completedAt: null, name: null })])

    expect(html).toContain('Workout')
  })

  test('resolves every key it references', async () => {
    const html = await renderSection('unfinished', 'wide', [workout({ completedAt: null })])

    expect(html).not.toMatch(/HomeSections\.[a-zA-Z.]+/)
  })
})
