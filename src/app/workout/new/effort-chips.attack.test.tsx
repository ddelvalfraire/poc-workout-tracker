// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { EffortChips } from './effort-chips'
import {
  RPE_CHIPS,
  IDLE_COLLAPSE_MS,
  nextRpeValue,
  rpeHalfOf,
  rpeTargetChip,
  rirTargetChip,
  createIdleCollapse,
} from './effort-chip-logic'

/**
 * ADVERSARIAL (#208): exhaustive nextRpeValue state graph (including
 * off-grid legacy values and junk), the idle-collapse clock vs interactions
 * landing at 4999ms — and vs KEYBOARD interactions (the root listens to
 * pointerdown only), target-ring placement edges, and the 320px width-math
 * claim recomputed from the actual rendered classes.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('nextRpeValue full state graph (#208 attack)', () => {
  it('every (current × chip) pair follows select-whole / cycle-half / clear — exhaustively', () => {
    const currents = ['', '6', '7', '8', '9', '10', '6.5', '7.5', '8.5', '9.5']
    for (const current of currents) {
      for (const chip of RPE_CHIPS) {
        const half = rpeHalfOf(chip)
        const expected =
          current === chip
            ? (half ?? '') // selected whole → its half; 10 → clear
            : half !== null && current === half
              ? '' // selected half → clear
              : chip // anything else → select that whole
        expect(nextRpeValue(current, chip), `current=${JSON.stringify(current)} chip=${chip}`).toBe(
          expected,
        )
      }
    }
  })

  it('junk and off-grid currents behave as "not selected": any tap selects the tapped whole', () => {
    for (const junk of ['abc', '5', '5.5', '10.5', '11', ' 8', '8.0', 'NaN']) {
      for (const chip of RPE_CHIPS) {
        expect(nextRpeValue(junk, chip), `current=${JSON.stringify(junk)} chip=${chip}`).toBe(chip)
      }
    }
  })

  it('the graph has no trap states: from any reachable value, 10 is reachable and clear is reachable', () => {
    // clear from any half: tap its whole; clear from 10: tap 10.
    expect(nextRpeValue('6.5', '6')).toBe('')
    expect(nextRpeValue('9.5', '9')).toBe('')
    expect(nextRpeValue('10', '10')).toBe('')
    // 10 from any state in one tap
    for (const current of ['', '6', '8.5', '10.5', 'abc']) {
      expect(nextRpeValue(current, '10')).toBe('10')
    }
  })
})

describe('target-chip placement edges (#208 attack)', () => {
  it('RPE: half-point targets ring the whole chip; out-of-strip and junk ring nothing', () => {
    expect(rpeTargetChip(8.5)).toBe('8')
    expect(rpeTargetChip(6)).toBe('6')
    expect(rpeTargetChip(10)).toBe('10')
    expect(rpeTargetChip(5.5)).toBeNull() // floor 5 < 6
    expect(rpeTargetChip(11)).toBeNull()
    expect(rpeTargetChip(NaN)).toBeNull()
    expect(rpeTargetChip(Infinity)).toBeNull()
    expect(rpeTargetChip(null)).toBeNull()
    // 10.5 floors to 10 — ringable, though the cycle can never LOG 10.5
    // (rpeHalfOf('10') is null). The ring would point at an unreachable value.
    expect(rpeTargetChip(10.5)).toBe('10')
  })

  it('RIR: 5+ absorbs targets ≥ 5; NON-INTEGER RIR targets ring NOTHING (documented gap)', () => {
    expect(rirTargetChip(0)).toBe('0')
    expect(rirTargetChip(5)).toBe('5')
    expect(rirTargetChip(7)).toBe('5')
    expect(rirTargetChip(-1)).toBeNull()
    // A prescribed RIR of 1.5 (half-RIR programming exists in the wild) gets
    // no ring at all — unlike RPE, where 8.5 rings chip 8. Asymmetry, not a
    // crash; flagging as a documented gap.
    expect(rirTargetChip(1.5)).toBeNull()
    expect(rirTargetChip(2.5)).toBeNull()
  })
})

describe('idle-collapse controller at the window edge (#208 attack)', () => {
  it('an arm() landing at 4999ms restarts the full window — no drift, no early fire', () => {
    const onCollapse = vi.fn()
    const idle = createIdleCollapse(onCollapse, IDLE_COLLAPSE_MS)
    idle.arm()
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS - 1) // 4999
    expect(onCollapse).not.toHaveBeenCalled()
    idle.arm() // interaction lands with 1ms left
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS - 1)
    expect(onCollapse).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onCollapse).toHaveBeenCalledTimes(1)
    idle.clear()
  })

  it('clear() after the timer fired is safe; arm() after clear() re-opens the window', () => {
    const onCollapse = vi.fn()
    const idle = createIdleCollapse(onCollapse, IDLE_COLLAPSE_MS)
    idle.arm()
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS)
    expect(onCollapse).toHaveBeenCalledTimes(1)
    idle.clear() // timer already spent — must not throw
    idle.arm()
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS)
    expect(onCollapse).toHaveBeenCalledTimes(2)
    idle.clear()
  })
})

interface RenderArgs {
  rir?: string
  rpe?: string
  targetRir?: number | null
  targetRpe?: number | null
}

function renderChips({ rir = '', rpe = '', targetRir = null, targetRpe = null }: RenderArgs = {}) {
  const onSelectRir = vi.fn()
  const onSelectRpe = vi.fn()
  const onIdleCollapse = vi.fn()
  root = createRoot(container)
  act(() => {
    root!.render(
      <EffortChips
        setLabel="set 1"
        rir={rir}
        rpe={rpe}
        targetLabel={null}
        targetRir={targetRir}
        targetRpe={targetRpe}
        onSelectRir={onSelectRir}
        onSelectRpe={onSelectRpe}
        onIdleCollapse={onIdleCollapse}
      />,
    )
  })
  return { onSelectRir, onSelectRpe, onIdleCollapse }
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function fire(el: HTMLElement, type: string) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  })
}

describe('idle collapse in the component (#208 attack)', () => {
  it('a pointer tap at 4999ms resets the clock (pointerdown path)', () => {
    const { onIdleCollapse } = renderChips()
    const chip = container.querySelector<HTMLButtonElement>('[aria-label="RIR 2"]')!
    advance(IDLE_COLLAPSE_MS - 1)
    fire(chip, 'pointerdown') // bubbles to the root re-arm
    fire(chip, 'click')
    advance(IDLE_COLLAPSE_MS - 1)
    expect(onIdleCollapse).not.toHaveBeenCalled()
    advance(1)
    expect(onIdleCollapse).toHaveBeenCalledTimes(1)
  })

  it('KEYBOARD interaction must also reset the clock (spec: "any interaction inside the row")', () => {
    // Spec claim under attack (PR #237 / component doc): "Any interaction
    // inside the row resets the clock." The re-arm listens to pointerdown on
    // the root — but keyboard activation (Enter on a focused chip) arrives as
    // a bare click with NO pointerdown, so a keyboard user's interaction does
    // not reset the window: the row collapses 5s after mount even while they
    // are mid two-tap cycle.
    const { onIdleCollapse, onSelectRir } = renderChips()
    const chip = container.querySelector<HTMLButtonElement>('[aria-label="RIR 2"]')!
    advance(IDLE_COLLAPSE_MS - 1_000) // t = 4000ms
    fire(chip, 'click') // keyboard activation: click only, no pointer events
    expect(onSelectRir).toHaveBeenCalledWith('2') // the interaction definitely landed
    advance(2_000) // t = 6000ms — clock should have been reset at 4000ms
    expect(onIdleCollapse).not.toHaveBeenCalled()
  })

  it('unmount clears the idle timer', () => {
    const { onIdleCollapse } = renderChips()
    advance(1_000)
    act(() => root!.unmount())
    root = undefined // afterEach skips the already-unmounted root
    advance(IDLE_COLLAPSE_MS * 2)
    expect(onIdleCollapse).not.toHaveBeenCalled()
  })
})

describe('target ring + selection rendering (#208 attack)', () => {
  it('a half-point RPE target (8.5) rings chip 8 with the foreground hairline, not volt', () => {
    renderChips({ targetRpe: 8.5, rpe: '', rir: '' })
    // open the RPE strip via the scale switch
    const toRpe = container.querySelector<HTMLButtonElement>('[aria-label="Switch to RPE for set 1"]')!
    fire(toRpe, 'click')
    const chip8 = container.querySelector<HTMLButtonElement>('[aria-label="RPE 8"]')!
    expect(chip8.className).toContain('ring-foreground/40')
    expect(chip8.className).not.toContain('bg-primary')
    // neighbours carry the plain border ring
    const chip7 = container.querySelector<HTMLButtonElement>('[aria-label="RPE 7"]')!
    expect(chip7.className).toContain('ring-border')
  })

  it('selection beats the target ring on the same chip', () => {
    renderChips({ targetRpe: 8, rpe: '8', rir: '' })
    // rpe !== '' && rir === '' → opens in RPE mode already
    const chip8 = container.querySelector<HTMLButtonElement>(
      '[aria-label="RPE 8 — tap again for 8.5"]',
    )!
    expect(chip8.className).toContain('bg-foreground')
    expect(chip8.className).not.toContain('ring-foreground/40')
  })
})

describe('the 320px fit math (#208 attack): recompute from the rendered classes', () => {
  it("the comment's arithmetic holds for the classes actually rendered", () => {
    renderChips()
    const wrapper = container.firstElementChild as HTMLElement
    const strip = container.querySelector<HTMLElement>('[role="group"]')!
    const chips = Array.from(strip.querySelectorAll('button'))

    // The claim (effort-chips.tsx comment): pl-11 (44) + 6 × min-w-8 (192)
    // + 5 × gap-1 (20) + pr-11 (44, wrapper) = 300 ≤ 320.
    expect(wrapper.className).toContain('pr-11')
    expect(strip.className).toContain('pl-11')
    expect(strip.className).toContain('gap-1')
    expect(chips).toHaveLength(6) // RIR mode: 0–5+
    for (const chip of chips) {
      expect(chip.className).toContain('min-w-8')
      expect(chip.className).toContain('px-1')
    }

    // Tailwind spacing scale: 1 unit = 4px.
    const PX = 4
    const pl11 = 11 * PX // 44
    const pr11 = 11 * PX // 44
    const minW8 = 8 * PX // 32
    const gap1 = 1 * PX // 4
    const total = pl11 + chips.length * minW8 + (chips.length - 1) * gap1 + pr11
    expect(total).toBe(300)
    expect(total).toBeLessThanOrEqual(320)

    // RPE mode claim: 5 chips = 264px.
    const rpeTotal = pl11 + 5 * minW8 + 4 * gap1 + pr11
    expect(rpeTotal).toBe(264)
  })
})
