import { describe, expect, test, vi } from 'vitest'
import { HistoryDismissableController } from './use-history-dismissable'

const FLAG = '__historyDismissable'

/** In-memory history: an entry list + cursor, with back() applied
 *  synchronously (the browser is async; ordering-sensitive paths are
 *  exercised by driving handlePopstate explicitly, as the hook does). */
class FakeHistory {
  entries: unknown[] = [{ __next: 'tree' }] // stands in for Next's router state
  index = 0
  backCalls = 0

  get state(): unknown {
    return this.entries[this.index]
  }
  pushState(data: unknown): void {
    this.entries = [...this.entries.slice(0, this.index + 1), data]
    this.index += 1
  }
  replaceState(data: unknown): void {
    this.entries = this.entries.map((entry, i) => (i === this.index ? data : entry))
  }
  back(): void {
    this.backCalls += 1
    if (this.index > 0) this.index -= 1
  }
}

function make(history = new FakeHistory()) {
  const onClose = vi.fn()
  const controller = new HistoryDismissableController(history, () => 'https://app.test/current')
  controller.setOnClose(onClose) // as the hook wires it, post-construction
  return { history, onClose, controller }
}

function hasFlag(state: unknown): boolean {
  return typeof state === 'object' && state !== null && FLAG in (state as Record<string, unknown>)
}

describe('HistoryDismissableController', () => {
  test('open pushes ONE same-URL entry, preserving existing state keys', () => {
    const { history, controller } = make()
    controller.setOpen(true)
    expect(history.index).toBe(1)
    expect(hasFlag(history.state)).toBe(true)
    expect((history.state as Record<string, unknown>).__next).toBe('tree') // router state survives
  })

  test('double-open is idempotent (no second entry)', () => {
    const { history, controller } = make()
    controller.setOpen(true)
    controller.setOpen(true)
    expect(history.index).toBe(1)
    expect(history.entries).toHaveLength(2)
  })

  test('programmatic close consumes the entry with exactly one back()', () => {
    const { history, controller, onClose } = make()
    controller.setOpen(true)
    controller.setOpen(false)
    expect(history.backCalls).toBe(1)
    expect(history.index).toBe(0)
    expect(onClose).not.toHaveBeenCalled() // close came from the caller, not from us
  })

  test('system back (popstate) closes the overlay WITHOUT a second back()', () => {
    const { history, controller, onClose } = make()
    controller.setOpen(true)
    history.back() // the user's edge-swipe
    controller.handlePopstate()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(history.backCalls).toBe(1) // only the user's
    // React then flows isOpen=false back down — must not pop a real page.
    controller.setOpen(false)
    expect(history.backCalls).toBe(1)
    expect(history.index).toBe(0)
  })

  test('rapid open → close → open lands on a single live entry', () => {
    const { history, controller } = make()
    controller.setOpen(true)
    controller.setOpen(false)
    controller.setOpen(true)
    expect(history.index).toBe(1)
    expect(hasFlag(history.state)).toBe(true)
  })

  test('dismissForNavigation strips the flag in place — no back(), entry stays for the router to push over', () => {
    const { history, controller } = make()
    controller.setOpen(true)
    controller.dismissForNavigation()
    expect(history.backCalls).toBe(0)
    expect(history.index).toBe(1) // still on the (now inert) duplicate entry
    expect(hasFlag(history.state)).toBe(false)
    // The follow-up isOpen=false from React must not pop either.
    controller.setOpen(false)
    expect(history.backCalls).toBe(0)
  })

  test('destroy after dismissForNavigation is a no-op — the drawer stays open across the route change', () => {
    // The production sequence since the drawer stopped closing eagerly on a
    // cross-route tap: dismissForNavigation (flag stripped in place), the
    // router pushes, and the OLD page's drawer unmounts still "open" when the
    // new page commits. That unmount must not pop anything.
    const { history, controller } = make()
    controller.setOpen(true)
    controller.dismissForNavigation()
    controller.destroy()
    expect(history.backCalls).toBe(0)
    expect(history.index).toBe(1)
    expect(hasFlag(history.state)).toBe(false)
  })

  test('unmount-while-open (destroy) consumes the entry', () => {
    const { history, controller } = make()
    controller.setOpen(true)
    controller.destroy()
    expect(history.backCalls).toBe(1)
    expect(history.index).toBe(0)
  })

  test('destroy after a navigation replaced the top does not eat a real page', () => {
    const { history, controller } = make()
    controller.setOpen(true)
    history.pushState({ __next: 'other-page' }) // router push out from under us
    controller.destroy()
    expect(history.backCalls).toBe(0)
  })

  test('stale flag on the current entry (reload while open) is stripped, not stacked', () => {
    const history = new FakeHistory()
    history.replaceState({ [FLAG]: 999 })
    const { controller } = make(history)
    controller.setOpen(true)
    expect(history.entries).toHaveLength(2)
    expect(hasFlag(history.entries[0])).toBe(false) // base entry cleaned
    expect(hasFlag(history.state)).toBe(true)
  })

  test('two controllers never consume each other', () => {
    const history = new FakeHistory()
    const a = make(history)
    const b = make(history)
    a.controller.setOpen(true)
    // B sees state carrying A's id — not B's entry, and B never pushed,
    // so B must stay inert.
    b.controller.handlePopstate()
    expect(b.onClose).not.toHaveBeenCalled()
    a.controller.setOpen(false)
    expect(history.backCalls).toBe(1)
  })
})
