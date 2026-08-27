// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { withIntl } from '../../../vitest.intl'

/**
 * GUARD 1's contract, in the order it fires: the cascade decides whether
 * there is a dialog at all, the dialog itemises the CASCADE rather than the
 * un-complete, and an undo stands behind both paths.
 *
 * The gate is the load-bearing part. A modal that fires on every un-complete
 * is a modal nobody reads, and the habituation it trains is what makes the
 * one that matters useless.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/app/workout/actions', () => ({
  previewUncompleteAction: vi.fn(),
  uncompleteWorkoutAction: vi.fn(),
  recompleteWorkoutAction: vi.fn(),
}))

import { UncompleteSession } from './uncomplete-session'
import {
  previewUncompleteAction,
  recompleteWorkoutAction,
  uncompleteWorkoutAction,
} from '@/app/workout/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const COMPLETED_AT = '2026-08-14T17:04:00.000Z'

// jsdom implements neither the top layer nor matchMedia; the dialog and
// SessionToast both reach for them on mount.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true
}
HTMLDialogElement.prototype.close = function close() {
  this.open = false
}
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

describe('UncompleteSession', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.mocked(uncompleteWorkoutAction).mockResolvedValue({ completedAt: COMPLETED_AT })
    vi.mocked(recompleteWorkoutAction).mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(withIntl(<UncompleteSession workoutId="w1" />)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  function press(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      /mark not finished/i.test(b.textContent ?? ''),
    )
    expect(button).toBeTruthy()
    return button as HTMLButtonElement
  }

  function dialog(): HTMLDialogElement | null {
    return document.body.querySelector('dialog')
  }

  function buttonLabelled(scope: ParentNode, label: string): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    )
    expect(found, `no button labelled "${label}"`).toBeTruthy()
    return found as HTMLButtonElement
  }

  it('shows NO dialog when un-completing moves nothing', async () => {
    // Arrange — the dry run comes back empty
    vi.mocked(previewUncompleteAction).mockResolvedValue({
      weekRollback: null,
      blockReopens: false,
    })

    // Act
    await act(async () => press().click())

    // Assert — it just happens, and the undo is the whole guard on this path
    expect(dialog()).toBeNull()
    expect(uncompleteWorkoutAction).toHaveBeenCalledWith('w1')
    expect(container.textContent).toContain('Session marked not finished')
  })

  it('interrupts with the cascade itemised, never the un-complete itself', async () => {
    vi.mocked(previewUncompleteAction).mockResolvedValue({
      weekRollback: { from: 4, to: 3 },
      blockReopens: false,
    })

    await act(async () => press().click())

    const open = dialog()
    expect(open).toBeTruthy()
    // One line per thing that moves — countable, not prose.
    expect(open!.querySelectorAll('li')).toHaveLength(2)
    expect(open!.textContent).toContain('goes back to week 3')
    expect(open!.textContent).toContain('targets are worked out again')
    // Outcomes, not Yes/No — and nothing is written until it is confirmed.
    expect(open!.textContent).toContain('Keep it completed')
    expect(open!.textContent).toContain('Un-complete')
    expect(uncompleteWorkoutAction).not.toHaveBeenCalled()
  })

  it('never asks the user to type anything to confirm', async () => {
    vi.mocked(previewUncompleteAction).mockResolvedValue({
      weekRollback: { from: 4, to: 3 },
      blockReopens: true,
    })

    await act(async () => press().click())

    expect(dialog()!.querySelector('input,textarea')).toBeNull()
  })

  it('offers an undo that restores the ORIGINAL stamp, not now()', async () => {
    vi.mocked(previewUncompleteAction).mockResolvedValue({
      weekRollback: { from: 4, to: 3 },
      blockReopens: false,
    })
    await act(async () => press().click())

    // Act — confirm, then walk it back
    await act(async () => buttonLabelled(dialog()!, 'Un-complete').click())
    expect(container.textContent).toContain('block back to week 3')
    await act(async () => buttonLabelled(container, 'Undo').click())

    // Assert — the instant that was cleared goes back verbatim. Re-stamping
    // with now() would quietly move the session to today.
    expect(recompleteWorkoutAction).toHaveBeenCalledWith('w1', COMPLETED_AT)
  })
})
