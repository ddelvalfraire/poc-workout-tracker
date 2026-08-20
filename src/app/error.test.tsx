// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ErrorBoundary from './error'
import GlobalError from './global-error'

/**
 * Both crash screens are the last thing a user sees before giving up, so
 * their copy has to survive translation intact — including the support
 * reference, which used to be the literal "Error ref:" beside a
 * `{error.digest}` expression. It is ONE message with a `{digest}` argument
 * now; a dropped argument would ship the raw pattern to the one screen nobody
 * is watching.
 *
 * The two namespaces stay separate despite sharing a headline: GlobalError
 * replaces the whole document and its copy already diverges ("Reload app" vs
 * "Reload"), so one shared key could never serve both.
 */

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function crash(digest?: string): Error & { digest?: string } {
  return Object.assign(new Error('boom'), digest === undefined ? {} : { digest })
}

function render(node: ReactElement): string {
  act(() => {
    root.render(node)
  })
  return container.innerHTML
}

describe('ErrorBoundary copy', () => {
  test('says what happened and offers both ways out', () => {
    const html = render(<ErrorBoundary error={crash()} reset={() => {}} />)

    expect(html).toContain('Something went wrong')
    expect(html).toContain('Your saved workouts are safe')
    expect(html).toContain('Try again')
    expect(html).toContain('Reload')
  })

  test('keeps the digest inside the support-reference sentence', () => {
    const html = render(<ErrorBoundary error={crash('abc123')} reset={() => {}} />)

    expect(html).toContain('Error ref: abc123')
    expect(html).not.toContain('{digest}')
  })

  test('omits the reference line when there is no digest', () => {
    expect(render(<ErrorBoundary error={crash()} reset={() => {}} />)).not.toContain('Error ref:')
  })

  test('resolves every key it references', () => {
    const html = render(<ErrorBoundary error={crash('abc123')} reset={() => {}} />)

    expect(html).not.toMatch(/ErrorBoundary\.[a-zA-Z.]+/)
  })
})

describe('GlobalError copy', () => {
  test('offers its own reload wording and the support reference', () => {
    const html = render(<GlobalError error={crash('abc123')} reset={() => {}} />)

    expect(html).toContain('Something went wrong')
    expect(html).toContain('reload to continue')
    expect(html).toContain('Reload app')
    expect(html).toContain('Error ref: abc123')
  })

  test('resolves every key it references', () => {
    const html = render(<GlobalError error={crash('abc123')} reset={() => {}} />)

    expect(html).not.toMatch(/GlobalError\.[a-zA-Z.]+/)
  })
})
