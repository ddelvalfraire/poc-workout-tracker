// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UpNextAnchor } from './up-next-anchor'

/**
 * The eyebrow used to be built by concatenation — anchor word, a middot, the
 * literal "Week", the number. Every one of those pieces moves in translation
 * (German fronts the week, and the separator is not universal), so it is ONE
 * message now. These pin both the pre-schedule fallback and the resolved
 * anchor, since only the browser knows the user's calendar day.
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

function render(weekdays: number[]): string {
  act(() => {
    root.render(<UpNextAnchor weekdays={weekdays} week={4} />)
  })
  return container.innerHTML
}

describe('UpNextAnchor copy', () => {
  test('falls back to the pre-schedule anchor when no weekday is scheduled', () => {
    expect(render([])).toContain('Up next · Week 4')
  })

  test('keeps the week number attached to whichever anchor resolves', () => {
    expect(render([0, 1, 2, 3, 4, 5, 6])).toMatch(/ · Week 4/)
  })

  test('resolves every key it references', () => {
    expect(render([])).not.toMatch(/UpNextAnchor\.[a-zA-Z.]+/)
  })
})
