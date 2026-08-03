import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// BackLink only touches the router inside onClick, so a static server render
// with a stubbed useRouter covers the markup contract; the pop-vs-replace
// branch itself is unit-tested in lib/back-navigation.test.ts (navigateBack).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}))

import { BackLink } from './back-link'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BackLink', () => {
  test('renders a button with the header chevron recipe (visual parity with the old Links)', () => {
    const html = renderToStaticMarkup(<BackLink fallback="/programs" />)
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Back"')
    // The exact classes every chevron header used: ghost icon-sm + -ml-2.
    expect(html).toContain('-ml-2')
    // Lucide's ChevronLeft, decorative, at the shared size.
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('size-5')
    expect(html).toContain('<svg')
  })

  test('supports custom aria-label, className passthrough and children', () => {
    const html = renderToStaticMarkup(
      <BackLink fallback="/settings" aria-label="Back to settings" className="text-primary">
        Settings
      </BackLink>,
    )
    expect(html).toContain('aria-label="Back to settings"')
    expect(html).toContain('text-primary')
    expect(html).toContain('Settings')
  })

  test('never renders an anchor — back has no pushable href', () => {
    const html = renderToStaticMarkup(<BackLink fallback="/" />)
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
  })
})
