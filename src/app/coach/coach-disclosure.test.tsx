// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CoachDisclosure, acknowledgeCoachDisclosure } from './coach-disclosure'

/**
 * Interactive contract of the disclosure interstitial: appears when not
 * acknowledged, "Got it" persists the per-device flag AND closes, and a
 * browser that refuses the localStorage write still gets to close (session
 * dismissal) — the failure mode review flagged as an unrecoverable trap.
 *
 * jsdom has no <dialog> implementation; the show/close stubs below mirror
 * the open-state semantics the component relies on.
 */

const store = new Map<string, string>()
let container: HTMLDivElement
let root: Root
// Prototype stubs must be RESTORED, not just installed — a leaked stub lets
// later jsdom tests pass against non-native dialog behavior.
const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
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
  vi.unstubAllGlobals()
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

function render() {
  act(() => {
    root.render(<CoachDisclosure />)
  })
}

describe('CoachDisclosure', () => {
  it('shows the dialog when never acknowledged', () => {
    render()
    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.textContent).toContain('Coach is an AI')
  })

  it('renders nothing when already acknowledged on this device', () => {
    store.set('coach-ai-disclosure-ack', '1')
    render()
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('"Got it" persists the flag and closes the dialog', () => {
    render()
    const button = container.querySelector('button')
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(store.get('coach-ai-disclosure-ack')).toBe('1')
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('still closes when localStorage refuses the write — no trap', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    render()
    const button = container.querySelector('button')
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Not persisted (next visit re-shows — protective), but THIS session is
    // dismissed rather than looping the dialog forever.
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('ack helper never throws on broken storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => acknowledgeCoachDisclosure()).not.toThrow()
  })
})
