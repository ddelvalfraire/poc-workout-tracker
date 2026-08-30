// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SessionConflictDialog, type SessionSummary } from './session-conflict-dialog'

/**
 * Copy contract of the conflict sheet. The set line is the reason these
 * exist: it used to be a template literal with a `setCount === 1 ? '' : 's'`
 * tail, which has no correct translation in a language with more than two
 * plural forms. Both branches are asserted separately.
 *
 * jsdom has no <dialog> implementation; the stubs below mirror the open-state
 * semantics the component's mount effect relies on, and are RESTORED after —
 * a leaked stub would let later tests pass against non-native behavior.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

let container: HTMLDivElement
let root: Root
const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

function render(session: Partial<SessionSummary> = {}): string {
  act(() => {
    root.render(
      <SessionConflictDialog
        session={{
          key: 'new',
          name: 'Push A',
          setCount: 3,
          completedSetCount: 1,
          ...session,
        }}
        onClose={() => {}}
        onProceed={() => {}}
      />,
    )
  })
  return container.innerHTML
}

describe('SessionConflictDialog copy', () => {
  test('renders the live badge, the actions and the dialog name', () => {
    const html = render()

    expect(html).toContain('Workout in progress')
    expect(html).toContain('Continue workout')
    expect(html).toContain('Discard &amp; start new')
    expect(html).toContain('Cancel')
    expect(html).toContain('Close')
  })

  test('reads the singular set form when one set is planned', () => {
    const html = render({ setCount: 1, completedSetCount: 0 })

    expect(html).toContain('0 of 1 set done')
    expect(html).not.toContain('sets done')
  })

  test('reads the plural set form when several sets are planned', () => {
    const html = render({ setCount: 3, completedSetCount: 1 })

    expect(html).toContain('1 of 3 sets done')
  })

  test('falls back to the untitled-session name', () => {
    expect(render({ name: null })).toContain('Unnamed session')
  })

  test('resolves every key it references', () => {
    expect(render()).not.toMatch(/SessionConflictDialog\.[a-zA-Z.]+/)
  })
})
