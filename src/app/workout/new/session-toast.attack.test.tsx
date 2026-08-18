// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { SessionToast } from './session-toast'

/**
 * ADVERSARIAL (#210): attacks on the SessionToast countdown machinery —
 * leak-guard vs reduced-motion interplay, resetKey bumps mid-exit, focus
 * pause at the drain's end, double-fire of onExpire, and unmount-during-exit
 * timer hygiene.
 *
 * jsdom never runs CSS animations, so the drain's animationend must be
 * dispatched by hand; the leak guard (durationMs + 1s grace) is the only
 * dismissal path that runs on real (fake) timers here — which makes it
 * directly testable.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DURATION_MS = 8_000
const LEAK_GUARD_AT_MS = DURATION_MS + 1_000 // + LEAK_GUARD_GRACE_MS

let reducedMotion = false
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  reducedMotion = false
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

interface RenderArgs {
  open: boolean
  resetKey?: number
  onExpire: () => void
}

function renderToast({ open, resetKey = 0, onExpire }: RenderArgs) {
  root = createRoot(container)
  const render = (args: RenderArgs) =>
    act(() => {
      root.render(
        <SessionToast
          open={args.open}
          countdown={{ durationMs: DURATION_MS, resetKey: args.resetKey ?? 0, onExpire: args.onExpire }}
        >
          <button type="button">Undo</button>
        </SessionToast>,
      )
    })
  render({ open, resetKey, onExpire })
  return { render }
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function drainEl(): HTMLElement | null {
  return container.querySelector('.toast-drain')
}

/** jsdom has no window.AnimationEvent, so React registers the WEBKIT-prefixed
 *  name for onAnimationEnd (verified empirically: plain 'animationend' never
 *  reaches the handler here; 'webkitAnimationEnd' does). Real browsers get
 *  the unprefixed event — this is test plumbing, not app behavior. */
function fireAnimationEnd(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }))
  })
}

describe('leak guard (#210 attack): lost animationend', () => {
  it('fires onExpire exactly once at durationMs + 1s grace when animationend never arrives', () => {
    const onExpire = vi.fn()
    renderToast({ open: true, onExpire })
    advance(LEAK_GUARD_AT_MS - 1)
    expect(onExpire).not.toHaveBeenCalled()
    advance(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    // one-shot: nothing further even if the owner ignores the call
    advance(60_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire after the drain animationend already dismissed and the owner closed', () => {
    const onExpire = vi.fn()
    const harness = renderToast({ open: true, onExpire })
    // real-browser path: drain completes at ~durationMs
    advance(DURATION_MS)
    fireAnimationEnd(drainEl()!)
    expect(onExpire).toHaveBeenCalledTimes(1)
    // the owner clears state → open false → leak guard must be disarmed
    harness.render({ open: false, resetKey: 0, onExpire })
    advance(60_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('fires onExpire ONCE per resetKey even when the owner ignores the animationend call', () => {
    // The drain's animationend and the leak guard are redundant delivery
    // paths for the SAME expiry: whichever lands first wins, the other is
    // swallowed (expiredRef gate, reset per resetKey) — the owner never
    // sees a double-fire even if it ignores the first call.
    const onExpire = vi.fn()
    renderToast({ open: true, onExpire })
    advance(DURATION_MS)
    fireAnimationEnd(drainEl()!)
    expect(onExpire).toHaveBeenCalledTimes(1)
    advance(1_000) // guard deadline: durationMs + grace — must be swallowed
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it("the drain's animationend must NOT unmount the strip (only the strip's own exit may)", () => {
    const onExpire = vi.fn()
    renderToast({ open: true, onExpire })
    fireAnimationEnd(drainEl()!)
    // onExpire fired, but with `open` still true the strip must still render
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.session-toast')).not.toBeNull()
  })
})

describe('reduced motion (#210 attack): interval path must own dismissal alone', () => {
  it('fires onExpire exactly once — the leak guard must NOT also run and double-fire', () => {
    reducedMotion = true
    const onExpire = vi.fn()
    renderToast({ open: true, onExpire })
    // no drain hairline in reduced motion
    expect(drainEl()).toBeNull()
    // ticking suffix seeds at 8s
    expect(container.textContent).toContain('· 8s')
    advance(1_000)
    expect(container.textContent).toContain('· 7s')
    advance(DURATION_MS - 1_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
    // even with the owner ignoring the call: no leak-guard second fire, ever
    advance(120_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})

describe('resetKey bump (#210 attack): restart semantics', () => {
  it('a bump mid-window restarts the whole window (guard fires durationMs+grace after the bump)', () => {
    const onExpire = vi.fn()
    const harness = renderToast({ open: true, resetKey: 0, onExpire })
    advance(5_000)
    harness.render({ open: true, resetKey: 1, onExpire })
    // old deadline (9s from t0) passes without firing
    advance(8_900) // t = 13.9s; new deadline is t = 5s + 9s = 14s
    expect(onExpire).not.toHaveBeenCalled()
    advance(100)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('a push while the previous toast is EXITING re-enters cleanly: content back, no backstop unmount, fresh window', () => {
    const onExpire = vi.fn()
    const harness = renderToast({ open: true, resetKey: 0, onExpire })
    // undo window spent → owner closes → exit phase begins
    harness.render({ open: false, resetKey: 0, onExpire })
    expect(container.querySelector('.session-toast')).not.toBeNull() // exit still playing
    advance(100) // partway through the 150ms exit / 240ms backstop
    // a NEW removal lands: open again with a bumped resetKey
    harness.render({ open: true, resetKey: 1, onExpire })
    expect(container.querySelector('.session-toast')).not.toBeNull()
    // the exit backstop (240ms) must have been disarmed — the strip may not vanish
    advance(500)
    expect(container.querySelector('.session-toast')).not.toBeNull()
    // and the exit class must not linger on the re-opened strip
    expect(container.querySelector('.toast-exit')).toBeNull()
    expect(container.querySelector('.toast-exit-quick')).toBeNull()
    // the new window runs to its own guard deadline (re-open at t=100ms)
    advance(LEAK_GUARD_AT_MS - 500 - 1)
    expect(onExpire).not.toHaveBeenCalled()
    advance(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})

describe('focus pause (#210 attack): focus-within at the window edge', () => {
  it('a guard deadline reached while focus sits inside re-arms instead of dismissing', () => {
    const onExpire = vi.fn()
    renderToast({ open: true, onExpire })
    const undoBtn = container.querySelector<HTMLButtonElement>('button')!
    act(() => {
      undoBtn.focus()
    })
    expect(document.activeElement).toBe(undoBtn)
    // jsdom sanity: the guard's own selector must see the focus
    expect(container.querySelector('.session-toast')!.matches(':focus-within')).toBe(true)
    // the guard deadline passes while focused: must NOT dismiss…
    advance(LEAK_GUARD_AT_MS)
    expect(onExpire).not.toHaveBeenCalled()
    // …and must have RE-ARMED (a live timer still pending) rather than
    // simply dropping the dismissal on the floor.
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    // The post-release dismissal (focus leaves → next deadline fires) cannot
    // be asserted here: jsdom's selector engine caches :focus-within, so the
    // strip keeps matching even after activeElement provably moved to an
    // outside button (verified during authoring: activeElement === outside,
    // undoBtn.matches(':focus') === false, strip.matches(':focus-within')
    // === true). The unfocused-deadline path itself is covered by the
    // "fires exactly once" test above.
  })
})

describe('exit hygiene (#210 attack): unmount during exiting leaks nothing', () => {
  it('unmounting mid-exit clears every pending timer', () => {
    const onExpire = vi.fn()
    const harness = renderToast({ open: true, onExpire })
    advance(2_000)
    harness.render({ open: false, resetKey: 0, onExpire })
    advance(50) // inside the exit window, backstop armed
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    advance(60_000)
    expect(onExpire).not.toHaveBeenCalled()
    root = createRoot(container) // keep afterEach's unmount valid
  })

  it('the exit backstop unmounts even when the exit animationend is lost', () => {
    const onExpire = vi.fn()
    const harness = renderToast({ open: true, onExpire })
    harness.render({ open: false, resetKey: 0, onExpire })
    expect(container.querySelector('.session-toast')).not.toBeNull()
    advance(240) // EXIT_BACKSTOP_MS
    expect(container.querySelector('.session-toast')).toBeNull()
    // and the countdown timers died with the close
    advance(60_000)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('exit renders WITHOUT the drain (the window is spent) but keeps the cached children', () => {
    const onExpire = vi.fn()
    const harness = renderToast({ open: true, onExpire })
    expect(drainEl()).not.toBeNull()
    harness.render({ open: false, resetKey: 0, onExpire })
    expect(drainEl()).toBeNull()
    // stale-cached content still on screen for the exit frames
    expect(container.textContent).toContain('Undo')
  })
})
