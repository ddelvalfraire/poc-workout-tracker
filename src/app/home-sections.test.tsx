import { describe, it, expect, test, vi } from 'vitest'
import { HOME_SECTION_REGISTRY } from '@/lib/home/registry'
import { renderStaticIntl } from '../../vitest.intl'
import type { WorkoutSummary } from '@/db/workouts'
import { renderHomeSections, type HomeSectionContext } from './home-sections'

// The md/lg history rows render HistoryList's guarded Repeat control, which
// calls useRouter — outside the app router that throws before any copy is
// produced.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

/**
 * Wire-level tests for the kind → renderer mapping. Renderers are stubbed
 * (the real ones are async RSCs), so these assert the map's CONTRACT: hidden
 * sections' renderers are never invoked, unknown kinds are skipped silently,
 * and visible sections render in layout order.
 */

const ctx = { userId: 'user_123', nowMs: 0 } as unknown as HomeSectionContext

function stubRenderers() {
  return Object.fromEntries(
    HOME_SECTION_REGISTRY.map((s) => [s.kind, vi.fn(() => null)]),
  )
}

/** The grid container is a single React element; its children are the
 *  per-section span wrappers (nulls for skipped kinds filtered out here). */
function wrappersOf(rendered: ReturnType<typeof renderHomeSections>) {
  const container = rendered as React.ReactElement<{
    className: string
    children: (React.ReactElement<{ className: string }> | null)[]
  }>
  return {
    container,
    wrappers: container.props.children.filter((c) => c !== null),
  }
}

describe('renderHomeSections', () => {
  it('invokes every visible renderer in layout order', () => {
    const renderers = stubRenderers()
    renderHomeSections(
      [
        { kind: 'history', size: 'md', hidden: false },
        { kind: 'momentum', size: 'md', hidden: false },
        { kind: 'today-recap', size: 'md', hidden: false },
        { kind: 'unfinished', size: 'md', hidden: false },
      ],
      ctx,
      renderers,
    )
    for (const kind of Object.keys(renderers)) {
      expect(renderers[kind]).toHaveBeenCalledTimes(1)
      expect(renderers[kind]).toHaveBeenCalledWith(ctx, 'md')
    }
  })

  it('NEVER invokes a hidden section renderer (visible-only queries, by construction)', () => {
    const renderers = stubRenderers()
    renderHomeSections(
      [
        { kind: 'momentum', size: 'md', hidden: true },
        { kind: 'history', size: 'md', hidden: false },
      ],
      ctx,
      renderers,
    )
    expect(renderers['momentum']).not.toHaveBeenCalled()
    expect(renderers['history']).toHaveBeenCalledTimes(1)
  })

  it('silently skips unknown kinds (no renderer, no error)', () => {
    const renderers = stubRenderers()
    expect(() =>
      renderHomeSections(
        [
          { kind: 'from-the-future', size: 'md', hidden: false },
          { kind: 'history', size: 'md', hidden: false },
        ],
        ctx,
        renderers,
      ),
    ).not.toThrow()
    expect(renderers['history']).toHaveBeenCalledTimes(1)
  })

  it('the default renderer map covers every registry kind', () => {
    // The map is module-private; prove coverage by rendering the default map
    // with a full context and asserting nothing is skipped: every section
    // produces a non-null wrapper element.
    const sections = HOME_SECTION_REGISTRY.map((s) => ({
      kind: s.kind,
      size: s.defaultSize,
      hidden: false,
    }))
    const { wrappers } = wrappersOf(
      renderHomeSections(sections, {
        userId: 'user_123',
        nowMs: 0,
        unit: 'lb',
        recentCompleted: [],
        completed: [],
        unfinished: [],
        guardSession: null,
      }),
    )
    expect(wrappers).toHaveLength(HOME_SECTION_REGISTRY.length)
  })

  it('DEFAULT-layout parity: every default section spans the full phone row and the grid adds no vertical spacing', () => {
    // The parity contract holds on the PHONE column: a user with no stored
    // doc gets sections that each span the full 2-col base grid — full-width
    // stacked, exactly the pre-bento home. The md: classes are desktop-only
    // additions and never touch the base rendering. gap-x only: vertical
    // rhythm stays owned by each section's own mt-* margins.
    const sections = HOME_SECTION_REGISTRY.map((s) => ({
      kind: s.kind,
      size: s.defaultSize,
      hidden: false,
    }))
    const { container, wrappers } = wrappersOf(
      renderHomeSections(sections, ctx, stubRenderers()),
    )
    expect(container.props.className).toBe('grid grid-cols-2 gap-x-3 md:grid-cols-4 md:gap-x-6')
    for (const wrapper of wrappers) {
      // Base span first, then (only) md: desktop modifiers — the phone
      // rendering is always the plain col-span-2 full row.
      expect(wrapper.props.className).toMatch(/^col-span-2( md:col-span-4)?$/)
    }
  })

  it('maps sizes to spans: phone 2-col base plus the literal 4-unit desktop row (sm=1, md=2, lg=4)', () => {
    const { wrappers } = wrappersOf(
      renderHomeSections(
        [
          { kind: 'momentum', size: 'sm', hidden: false },
          { kind: 'today-recap', size: 'sm', hidden: false },
          { kind: 'unfinished', size: 'md', hidden: false },
          { kind: 'history', size: 'lg', hidden: false },
        ],
        ctx,
        stubRenderers(),
      ),
    )
    expect(wrappers.map((w) => w.props.className)).toEqual([
      'col-span-1',
      'col-span-1',
      'col-span-2',
      'col-span-2 md:col-span-4',
    ])
  })
})

/**
 * Copy contract of the two sections this file owns. Both used to build their
 * meta lines by template literal with a `=== 1 ? '' : 's'` tail, which is
 * untranslatable anywhere with more than two plural forms — so each count is
 * asserted at one AND at many, separately.
 *
 * Only `unfinished` and `history` are rendered: the other two renderers are
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
  kind: 'unfinished' | 'history',
  size: 'sm' | 'md' | 'lg',
  workouts: WorkoutSummary[],
): string {
  return renderStaticIntl(
    renderHomeSections([{ kind, size, hidden: false }], {
      userId: 'user_123',
      nowMs: Date.parse('2026-03-05T09:00:00Z'),
      unit: 'kg',
      recentCompleted: [],
      completed: kind === 'history' ? workouts : [],
      unfinished: kind === 'unfinished' ? workouts : [],
      guardSession: null,
    }),
  )
}

describe('HomeSections copy', () => {
  test('names the unfinished section and its resume affordance', () => {
    const html = renderSection('unfinished', 'md', [workout({ completedAt: null })])

    expect(html).toContain('Unfinished')
    expect(html).toContain('Resume')
    expect(html).toContain('Push A')
  })

  test('reads the singular set form on a session with one set logged', () => {
    const html = renderSection('unfinished', 'md', [
      workout({ completedAt: null, completedSetCount: 1 }),
    ])

    expect(html).toContain('started · 1 set logged')
    expect(html).not.toContain('sets logged')
  })

  test('reads the plural set form on a session with several sets logged', () => {
    const html = renderSection('unfinished', 'md', [
      workout({ completedAt: null, completedSetCount: 4 }),
    ])

    expect(html).toContain('started · 4 sets logged')
  })

  test('falls back to the untitled-workout name', () => {
    const html = renderSection('unfinished', 'md', [workout({ completedAt: null, name: null })])

    expect(html).toContain('Workout')
  })

  test('reads the singular workout form in the compact history line', () => {
    const html = renderSection('history', 'sm', [workout()])

    expect(html).toContain('1 workout')
    expect(html).not.toContain('1 workouts')
  })

  test('reads the plural workout form in the compact history line', () => {
    const html = renderSection('history', 'sm', [
      workout(),
      workout({ id: 'w2' }),
      workout({ id: 'w3' }),
    ])

    expect(html).toContain('3 workouts')
  })

  test('offers the full log only once the size’s slice leaves rows unseen', () => {
    const many = Array.from({ length: 6 }, (_, i) => workout({ id: `w${i}` }))

    expect(renderSection('history', 'md', many)).toContain('All history')
    expect(renderSection('history', 'md', [workout()])).not.toContain('All history')
  })

  test('resolves every key it references', () => {
    const unfinished = renderSection('unfinished', 'md', [workout({ completedAt: null })])
    const history = renderSection('history', 'sm', [workout()])

    expect(unfinished).not.toMatch(/HomeSections\.[a-zA-Z.]+/)
    expect(history).not.toMatch(/HomeSections\.[a-zA-Z.]+/)
  })
})
