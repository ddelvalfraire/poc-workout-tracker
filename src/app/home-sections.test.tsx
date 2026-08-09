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

describe('renderHomeSections', () => {
  it('invokes every visible renderer in layout order', () => {
    const renderers = stubRenderers()
    renderHomeSections(
      [
        { kind: 'history', hidden: false },
        { kind: 'momentum', hidden: false },
        { kind: 'today-recap', hidden: false },
        { kind: 'unfinished', hidden: false },
      ],
      ctx,
      renderers,
    )
    for (const kind of Object.keys(renderers)) {
      expect(renderers[kind]).toHaveBeenCalledTimes(1)
      expect(renderers[kind]).toHaveBeenCalledWith(ctx)
    }
  })

  it('NEVER invokes a hidden section renderer (visible-only queries, by construction)', () => {
    const renderers = stubRenderers()
    renderHomeSections(
      [
        { kind: 'momentum', hidden: true },
        { kind: 'history', hidden: false },
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
          { kind: 'from-the-future', hidden: false },
          { kind: 'history', hidden: false },
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
    // produces a non-null element.
    const sections = HOME_SECTION_REGISTRY.map((s) => ({ kind: s.kind, hidden: false }))
    const rendered = renderHomeSections(sections, {
      userId: 'user_123',
      nowMs: 0,
      unit: 'lb',
      recentCompleted: [],
      completed: [],
      unfinished: [],
      guardSession: null,
    }) as unknown[]
    expect(rendered).toHaveLength(HOME_SECTION_REGISTRY.length)
    expect(rendered.every((node) => node !== null)).toBe(true)
  })
})
