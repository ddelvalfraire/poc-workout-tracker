// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StreakChip } from './streak-chip'

/**
 * The chip's week count is computed in an effect (weeks are the USER'S
 * calendar weeks), so a static render always returns null — these mount for
 * real. What they pin is the ICU plural on the screen-reader line: English
 * has two forms, Polish three and Arabic six, so the `weeks === 1 ? … : …`
 * this replaced could never have been translated correctly. Both branches are
 * asserted separately; one assertion would pass against a message that
 * hard-codes a single form.
 */

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Completions on every scheduled weekday for the last `weeks` weeks. */
function completionsFor(weeks: number): number[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  return Array.from({ length: weeks * 7 }, (_, i) => now - i * day)
}

function render(weeks: number): string {
  act(() => {
    root.render(
      <StreakChip
        completedAtTimes={completionsFor(weeks)}
        scheduledWeekdays={[0, 1, 2, 3, 4, 5, 6]}
        allowedMissesPerWeek={0}
      />,
    )
  })
  return container.innerHTML
}

describe('StreakChip copy', () => {
  test('reads the singular week form at a one-week streak', () => {
    const html = render(1)

    expect(html).toContain('1 wk')
    expect(html).toContain('week training streak')
    expect(html).not.toContain('weeks training streak')
  })

  test('reads the plural week form at a multi-week streak', () => {
    const html = render(3)

    expect(html).toContain('3 wk')
    expect(html).toContain('weeks training streak')
  })

  test('resolves every key it references', () => {
    expect(render(2)).not.toMatch(/StreakChip\.[a-zA-Z.]+/)
  })
})
