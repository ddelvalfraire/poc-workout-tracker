import { describe, it, expect, vi } from 'vitest'
import { HOME_SECTION_REGISTRY } from '@/lib/home/registry'
import { renderHomeSections, type HomeSectionContext } from './home-sections'

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

  it('DEFAULT-layout parity: every default section spans the full row and the grid adds no vertical spacing', () => {
    // The parity contract: a user with no stored doc gets all-md sections,
    // each col-span-2 in a grid-cols-2 container — i.e. full-width stacked,
    // exactly the pre-bento home. gap-x only: vertical rhythm stays owned by
    // each section's own mt-* margins.
    const sections = HOME_SECTION_REGISTRY.map((s) => ({
      kind: s.kind,
      size: s.defaultSize,
      hidden: false,
    }))
    const { container, wrappers } = wrappersOf(
      renderHomeSections(sections, ctx, stubRenderers()),
    )
    expect(container.props.className).toBe('grid grid-cols-2 gap-x-3')
    for (const wrapper of wrappers) {
      expect(wrapper.props.className).toBe('col-span-2')
    }
  })

  it('maps sizes to spans: sm half-width, md and lg full-width (narrow-column web mapping)', () => {
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
      'col-span-2',
    ])
  })
})
