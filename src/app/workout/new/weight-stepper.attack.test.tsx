// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  WeightStepper,
  createHoldRepeater,
  holdStepMultiplier,
  stepWeightValueBy,
  HOLD_DELAY_MS,
  HOLD_INTERVAL_MS,
  HOLD_ACCEL_AFTER,
  HOLD_ACCEL_FACTOR,
} from './weight-stepper'

/**
 * ADVERSARIAL (#216): attacks on the hold-to-autorepeat chain, the
 * acceleration boundary, the 0 floor mid-hold, the click-swallow guard, and
 * multitouch. Spec claims under attack (PR #238 + component doc):
 * - "first repeat at 400ms, then ~150ms, stepping 5× after 8 repeats"
 * - "repeats read the freshest value/handler through refs so a 150ms tick
 *   never steps from a stale prop"
 * - "the chain crossing 0 must stop/clamp, not oscillate"
 * - "keyboard activation arrives as a bare click and must still step"
 * - "pointerup/pointercancel/pointerleave clears the chain"
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no matchMedia; the per-step value dip probes reduced motion.
window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

let container: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  // Pure-function tests never render — only unmount when a root exists.
  if (root) {
    const r = root
    act(() => r.unmount())
    root = undefined
  }
  container.remove()
  vi.useRealTimers()
})

interface RenderProps {
  weight?: string
  ghostWeight?: string | undefined
}

function renderStepper({ weight = '60', ghostWeight = undefined }: RenderProps = {}) {
  const onWeightChange = vi.fn()
  root = createRoot(container)
  const render = (w: string) =>
    act(() => {
      root!.render(
        <WeightStepper
          setIndex={0}
          inputId="weight-input-attack"
          weight={w}
          ghostWeight={ghostWeight}
          unit="kg"
          loggingType="weight_reps"
          bar={20}
          plates={[20, 10, 5, 2.5, 1.25]}
          onWeightChange={onWeightChange}
          onOpenPlateSheet={() => {}}
        />,
      )
    })
  render(weight)
  const plus = container.querySelector<HTMLButtonElement>(
    '[aria-label="Increase set 1 weight by 2.5 kg"]',
  )
  const minus = container.querySelector<HTMLButtonElement>(
    '[aria-label="Decrease set 1 weight by 2.5 kg"]',
  )
  if (!plus || !minus) throw new Error('stepper segments not rendered')
  return { plus, minus, onWeightChange, render }
}

/** jsdom has no PointerEvent constructor; React routes by event type. */
function fire(el: HTMLElement, type: string) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('acceleration boundary (#216 attack): 5× applies to the 9th repeat, not the 8th', () => {
  it('holdStepMultiplier: repeats 1–8 (index 0–7) are 1×; the 9th (index 8) is 5×', () => {
    for (let i = 0; i < HOLD_ACCEL_AFTER; i++) expect(holdStepMultiplier(i)).toBe(1)
    expect(holdStepMultiplier(HOLD_ACCEL_AFTER)).toBe(HOLD_ACCEL_FACTOR)
  })

  it('repeat engine cadence: multipliers flip exactly at the boundary tick', () => {
    const fired: number[] = []
    const engine = createHoldRepeater((m) => fired.push(m))
    engine.start()
    // through the 8th repeat: 400 + 7×150
    vi.advanceTimersByTime(HOLD_DELAY_MS + (HOLD_ACCEL_AFTER - 1) * HOLD_INTERVAL_MS)
    expect(fired).toEqual(Array(HOLD_ACCEL_AFTER).fill(1))
    // the 9th repeat is the first accelerated one
    vi.advanceTimersByTime(HOLD_INTERVAL_MS)
    expect(fired[fired.length - 1]).toBe(HOLD_ACCEL_FACTOR)
    engine.stop()
  })

  it('through the component: the first accelerated repeat jumps 12.5 kg from the chained value', () => {
    const { plus, onWeightChange } = renderStepper({ weight: '60' })
    fire(plus, 'pointerdown') // immediate step: 62.5
    // 8 repeats at 1×: 65, 67.5, ... 82.5
    advance(HOLD_DELAY_MS + (HOLD_ACCEL_AFTER - 1) * HOLD_INTERVAL_MS)
    expect(onWeightChange).toHaveBeenCalledTimes(1 + HOLD_ACCEL_AFTER)
    expect(onWeightChange).toHaveBeenLastCalledWith('82.5')
    // 9th repeat: 5 × 2.5 = +12.5
    advance(HOLD_INTERVAL_MS)
    expect(onWeightChange).toHaveBeenLastCalledWith('95')
    fire(plus, 'pointerup')
  })
})

describe('stale-prop race (#216 attack): a weight prop update mid-hold must win', () => {
  it('a tick after the parent pushes a new weight steps from the NEW value', () => {
    const { plus, onWeightChange, render } = renderStepper({ weight: '60' })
    fire(plus, 'pointerdown') // 62.5
    expect(onWeightChange).toHaveBeenLastCalledWith('62.5')
    // The user (or a sync) lands a different weight mid-hold, before the
    // first repeat: the 400ms tick must step from 100, not from 62.5.
    render('100')
    advance(HOLD_DELAY_MS)
    expect(onWeightChange).toHaveBeenLastCalledWith('102.5')
    fire(plus, 'pointerup')
  })
})

describe('floor behavior mid-hold (#216 attack): clamp, never oscillate', () => {
  it('a − hold crossing 0 clamps at 0 and stops emitting (no oscillation, no phantom steps)', () => {
    const { minus, onWeightChange } = renderStepper({ weight: '5' })
    fire(minus, 'pointerdown') // 2.5
    advance(HOLD_DELAY_MS) // 0
    expect(onWeightChange).toHaveBeenCalledTimes(2)
    expect(onWeightChange).toHaveBeenLastCalledWith('0')
    // chain keeps ticking while held — but every further step must be a no-op
    advance(HOLD_INTERVAL_MS * 20)
    expect(onWeightChange).toHaveBeenCalledTimes(2)
    fire(minus, 'pointerup')
  })

  it('an accelerated 5× step that would cross 0 clamps to exactly 0 (chained, not one big jump)', () => {
    // 5 chained −2.5 steps from 7.5: 5, 2.5, 0, 0, 0 → "0"
    expect(stepWeightValueBy('7.5', undefined, -1, 'kg', 5)).toBe('0')
  })

  it('non-numeric text passes through as null at any multiplier', () => {
    expect(stepWeightValueBy('abc', undefined, 1, 'kg', 5)).toBeNull()
    expect(stepWeightValueBy('abc', undefined, -1, 'kg', 1)).toBeNull()
  })

  it('ghost seeding chains like taps: empty field + ghost 60, 2 steps = 65', () => {
    expect(stepWeightValueBy('', '60', 1, 'kg', 2)).toBe('65')
  })
})

describe('click-swallow guard residue (#216 attack)', () => {
  it('pointercancel WITHOUT a trailing click must not eat the next keyboard activation', () => {
    // A touch that turns into a scroll: pointerdown steps (guard armed),
    // pointercancel fires, and — unlike a tap — NO click follows. The guard
    // stays armed. The next keyboard activation (a bare click) is then
    // swallowed, so the second user gesture produces zero steps.
    // Spec claim under attack: "keyboard activation arrives as a bare click
    // and must still step" / "one user gesture = one step, always".
    const { plus, onWeightChange } = renderStepper({ weight: '60' })

    fire(plus, 'pointerdown') // gesture 1: steps to 62.5, arms the guard
    fire(plus, 'pointercancel') // scroll took the pointer; no click will come
    expect(onWeightChange).toHaveBeenCalledTimes(1)

    fire(plus, 'click') // gesture 2: keyboard Enter — MUST step
    expect(onWeightChange).toHaveBeenCalledTimes(2)
    expect(onWeightChange).toHaveBeenLastCalledWith('65')
  })
})

describe('multitouch (#216 attack): second finger on the other half mid-hold', () => {
  it("a second finger neither steps nor kills finger 1's still-held chain", () => {
    // Spec claim under attack: "the chain keeps firing while the finger stays
    // down". With one shared hold engine and unguarded pointerdown, finger 2
    // used to REPLACE the chain — and either finger's lift then killed it.
    // The fix: while a chain is live, a new pointerdown is ignored outright
    // (no step, no chain replacement), and only the owning segment's
    // up/leave/cancel may stop the chain.
    const { plus, minus, onWeightChange } = renderStepper({ weight: '60' })

    fire(plus, 'pointerdown') // finger 1 holds +: 62.5
    fire(minus, 'pointerdown') // finger 2 lands on −: IGNORED
    expect(onWeightChange).toHaveBeenCalledTimes(1)
    expect(onWeightChange).toHaveBeenLastCalledWith('62.5')

    fire(minus, 'pointerup') // finger 2 lifts — must not touch finger 1's chain
    advance(HOLD_DELAY_MS + HOLD_INTERVAL_MS * 2)

    // finger 1's + hold kept repeating: 65, 67.5, 70
    expect(onWeightChange).toHaveBeenCalledTimes(4)
    expect(onWeightChange).toHaveBeenLastCalledWith('70')

    fire(plus, 'pointerup') // the OWNER lifts — chain dies
    const settled = onWeightChange.mock.calls.length
    advance(HOLD_INTERVAL_MS * 10)
    expect(onWeightChange).toHaveBeenCalledTimes(settled)
  })

  it("finger 2's synthesized click after its ignored pointerdown is swallowed too", () => {
    const { plus, minus, onWeightChange } = renderStepper({ weight: '60' })

    fire(plus, 'pointerdown') // 62.5
    fire(minus, 'pointerdown') // ignored, but arms the swallow guard
    fire(minus, 'pointerup')
    fire(minus, 'click') // the tap's synthesized click: no phantom − step
    expect(onWeightChange).toHaveBeenCalledTimes(1)
    fire(plus, 'pointerup')
  })
})

describe('keyboard native key repeat (#216 probe)', () => {
  it('held Enter (repeated bare clicks) steps once per repeat — OS-rate autorepeat, outside the 400/150ms schedule', () => {
    // Browsers fire a click per repeated Enter keydown on a button. Each is a
    // bare click (no pointer sequence), so each steps. This documents that a
    // held Enter autorepeats at the OS key-repeat rate with NO acceleration
    // and NO 400ms arming delay — behavior, not a hard spec breach.
    const { plus, onWeightChange } = renderStepper({ weight: '60' })
    fire(plus, 'click')
    fire(plus, 'click')
    fire(plus, 'click')
    expect(onWeightChange).toHaveBeenCalledTimes(3)
    expect(onWeightChange).toHaveBeenLastCalledWith('67.5')
  })
})

describe('unmount mid-hold (#216 attack): the pending chain dies with the rail', () => {
  it('no timers keep firing after the rail unmounts mid-hold', () => {
    const { plus, onWeightChange } = renderStepper({ weight: '60' })
    fire(plus, 'pointerdown')
    expect(onWeightChange).toHaveBeenCalledTimes(1)
    act(() => root!.unmount())
    root = undefined // afterEach skips the already-unmounted root
    advance(HOLD_DELAY_MS + HOLD_INTERVAL_MS * 10)
    expect(onWeightChange).toHaveBeenCalledTimes(1)
  })
})
