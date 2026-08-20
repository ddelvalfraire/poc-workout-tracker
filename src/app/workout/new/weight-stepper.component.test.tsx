// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { WeightStepper } from './weight-stepper'

/**
 * The tap contract, interactively (jsdom): pointerdown steps immediately and
 * the trailing click must be swallowed — including the implicit-pointer-
 * capture case where a hold wobbles off the hit box (pointerleave fires, yet
 * the synthesized click still lands on the button). Keyboard activation
 * arrives as a bare click with no pointer sequence and must step exactly
 * once. One user gesture = one step, always.
 */

// React 19 requires the explicit act-environment opt-in outside test renderers.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no matchMedia; the per-step value dip probes reduced motion.
window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderStepper() {
  const onWeightChange = vi.fn()
  root = createRoot(container)
  act(() => {
    root.render(
      withIntl(
      <WeightStepper
        setIndex={0}
        inputId="weight-input-test"
        weight="60"
        ghostWeight={undefined}
        unit="kg"
        loggingType="weight_reps"
        bar={20}
        plates={[20, 10, 5, 2.5, 1.25]}
        onWeightChange={onWeightChange}
        onOpenPlateSheet={() => {}}
      />,
      ),
    )
  })
  const plus = container.querySelector<HTMLButtonElement>(
    '[aria-label="Increase set 1 weight by 2.5 kg"]',
  )
  if (!plus) throw new Error('plus segment not rendered')
  return { plus, onWeightChange }
}

/** jsdom has no PointerEvent constructor; React routes by event type, so a
 *  bubbling MouseEvent under the pointer type name reaches onPointerDown & co. */
function fire(el: HTMLElement, type: string) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  })
}

describe('WeightStepper one-gesture-one-step contract', () => {
  it('pointerdown + pointerup + click = exactly one step', () => {
    // Arrange
    const { plus, onWeightChange } = renderStepper()

    // Act — a clean tap: down steps, up stops the hold, the trailing click
    // must be swallowed by the guard
    fire(plus, 'pointerdown')
    fire(plus, 'pointerup')
    fire(plus, 'click')

    // Assert
    expect(onWeightChange).toHaveBeenCalledTimes(1)
    expect(onWeightChange).toHaveBeenCalledWith('62.5')
  })

  it('pointerdown + pointerleave + click = exactly one step (wobbly touch tap)', () => {
    const { plus, onWeightChange } = renderStepper()

    // Act — the finger wobbles off the hit box (pointerleave), but implicit
    // pointer capture still delivers the synthesized click to this button:
    // the guard must survive the leave and swallow it
    fire(plus, 'pointerdown')
    fire(plus, 'pointerleave')
    fire(plus, 'click')

    expect(onWeightChange).toHaveBeenCalledTimes(1)
    expect(onWeightChange).toHaveBeenCalledWith('62.5')
  })

  it('keyboard activation (bare click, no pointer sequence) = exactly one step', () => {
    const { plus, onWeightChange } = renderStepper()

    // Act — Enter/Space on a button arrives as a click with no pointer
    // events before it; the guard must NOT be armed and the step must land
    act(() => {
      plus.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })
    fire(plus, 'click')

    expect(onWeightChange).toHaveBeenCalledTimes(1)
    expect(onWeightChange).toHaveBeenCalledWith('62.5')
  })

  it('consecutive keyboard activations keep stepping (guard never wedges shut)', () => {
    const { plus, onWeightChange } = renderStepper()

    fire(plus, 'click')
    fire(plus, 'click')

    expect(onWeightChange).toHaveBeenCalledTimes(2)
  })
})
