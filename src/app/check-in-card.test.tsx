// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CheckInCard } from './check-in-card'

/**
 * The card's second line wraps a derived detail phrase mid-sentence. It used
 * to be literal text either side of a `{checkInCardDetail(...)}` expression,
 * which strands the sentence: a translator gets two fragments and no way to
 * move the detail. It is ONE message with a `{detail}` argument now, and a
 * dropped argument would render the raw `{detail}` pattern — asserted here.
 *
 * Visibility is decided in an effect against sessionStorage, so these mount
 * for real rather than rendering statically.
 */

let container: HTMLDivElement
let root: Root
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function render(daysSinceLast: number | null): string {
  act(() => {
    root.render(<CheckInCard daysSinceLast={daysSinceLast} />)
  })
  return container.innerHTML
}

describe('CheckInCard copy', () => {
  test('names the nudge and both of its controls', () => {
    const html = render(9)

    expect(html).toContain('Body check-in due')
    expect(html).toContain('Check in')
    expect(html).toContain('Not today')
  })

  test('keeps the detail inside the sentence rather than beside it', () => {
    const html = render(9)

    expect(html).toContain('Weight, tape, or a progress photo — ')
    expect(html).not.toContain('{detail}')
  })

  test('renders the never-checked-in variant of the detail too', () => {
    const html = render(null)

    expect(html).toContain('Weight, tape, or a progress photo — ')
    expect(html).not.toContain('{detail}')
  })

  test('resolves every key it references', () => {
    expect(render(9)).not.toMatch(/CheckInCard\.[a-zA-Z.]+/)
  })
})
