// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The whole point of this file: vitest.setup.ts mocks next-intl globally and
// binds useTranslations to the full catalog with no provider, so every other
// test in the suite is blind to a missing NextIntlClientProvider. Unmocking
// is what makes this boundary's real constraint observable.
vi.unmock('next-intl')

import GlobalError from './global-error'

describe('GlobalError without a provider', () => {
  it('renders — it replaces the root layout, so no translator context exists', () => {
    // Regression: this component used useTranslations. In production that
    // threw for want of context, so the branded crash screen became Next's
    // bare error page AND the digest was lost — the one string support can
    // act on. It must not depend on anything the root layout provides.
    const html = renderToStaticMarkup(
      <GlobalError error={Object.assign(new Error('boom'), { digest: 'abc123' })} reset={() => {}} />,
    )

    expect(html).toContain('Something went wrong')
    expect(html).toContain('abc123')
  })

  it('keeps the wording it had before the i18n pass', () => {
    // The extraction reworded both of these; asserted verbatim so a future
    // pass cannot quietly edit copy on a screen nobody looks at until it
    // matters.
    const html = renderToStaticMarkup(
      <GlobalError error={new Error('boom')} reset={() => {}} />,
    )

    expect(html).toContain('Your saved workouts are safe — reload to continue.')
    expect(html).toContain('Reload app')
  })
})
