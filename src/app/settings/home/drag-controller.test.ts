import { describe, expect, it, vi } from 'vitest'
import { resolveHomeLayout, type ResolvedHomeSection } from '@/lib/home/layout'
import { createDragController } from './drag-controller'

/**
 * The drag persistence contract, tested against the SAME controller the
 * editor wires to DndGrid (dnd-kit sensors need a real DOM, so the lifecycle
 * logic is extracted and exercised directly — the planDrawerOpen pattern).
 * The editor's deps are simulated faithfully: getSections reads a mutable
 * "state", setSections writes it, persist is a spy standing in for the
 * optimistic setHomeLayoutAction path with its rollbackTo target — the
 * failure rollback itself (and its writeSeq guard) is the editor's ONE
 * persist function, shared with every non-drag interaction.
 */

function harness() {
  let state: readonly ResolvedHomeSection[] = resolveHomeLayout(null)
  const setSections = vi.fn((next: readonly ResolvedHomeSection[]) => {
    state = next
  })
  const persist = vi.fn()
  const controller = createDragController({
    getSections: () => state,
    setSections,
    persist,
  })
  return { controller, setSections, persist, kinds: () => state.map((s) => s.kind) }
}

describe('createDragController', () => {
  it('preview reorders state live WITHOUT persisting (no action call per move)', () => {
    const { controller, persist, kinds } = harness()
    controller.onDragStart()
    controller.onDragPreview('momentum', 'unfinished')
    expect(kinds()).toEqual(['today-recap', 'unfinished', 'momentum', 'history'])
    controller.onDragPreview('momentum', 'history')
    expect(kinds()).toEqual(['today-recap', 'unfinished', 'history', 'momentum'])
    expect(persist).not.toHaveBeenCalled()
  })

  it('commit persists exactly once, with the final previewed order', () => {
    const { controller, persist, kinds } = harness()
    controller.onDragStart()
    controller.onDragPreview('momentum', 'today-recap')
    controller.onDragPreview('momentum', 'unfinished')
    controller.onDragCommit()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0].map((s: ResolvedHomeSection) => s.kind)).toEqual(kinds())
    // A stray second drop event cannot double-write: the snapshot is consumed.
    controller.onDragCommit()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('commit hands persist the pre-DRAG order as rollbackTo — not the pre-move one (a failed write undoes the whole drag)', () => {
    const { controller, persist } = harness()
    const before = ['momentum', 'today-recap', 'unfinished', 'history']
    controller.onDragStart()
    controller.onDragPreview('momentum', 'today-recap')
    controller.onDragPreview('momentum', 'unfinished')
    controller.onDragPreview('momentum', 'history')
    controller.onDragCommit()
    const opts = persist.mock.calls[0][1] as { rollbackTo: readonly ResolvedHomeSection[] }
    expect(opts.rollbackTo.map((s) => s.kind)).toEqual(before)
  })

  it('cancel restores the pre-drag snapshot and never persists', () => {
    const { controller, persist, kinds } = harness()
    controller.onDragStart()
    controller.onDragPreview('history', 'momentum')
    expect(kinds()).toEqual(['history', 'momentum', 'today-recap', 'unfinished'])
    controller.onDragCancel()
    expect(kinds()).toEqual(['momentum', 'today-recap', 'unfinished', 'history'])
    expect(persist).not.toHaveBeenCalled()
  })

  it('a drag that lands where it started is a no-op commit (no write for a wiggle)', () => {
    const { controller, persist, kinds } = harness()
    controller.onDragStart()
    controller.onDragPreview('momentum', 'today-recap')
    controller.onDragPreview('today-recap', 'momentum') // dragged back home
    controller.onDragCommit()
    expect(kinds()).toEqual(['momentum', 'today-recap', 'unfinished', 'history'])
    expect(persist).not.toHaveBeenCalled()
  })

  it('commit and cancel without a start are inert (defensive against event order bugs)', () => {
    const { controller, persist, setSections } = harness()
    controller.onDragCommit()
    controller.onDragCancel()
    expect(persist).not.toHaveBeenCalled()
    expect(setSections).not.toHaveBeenCalled()
  })
})
