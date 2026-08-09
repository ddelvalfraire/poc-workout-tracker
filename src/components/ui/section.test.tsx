import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { Section } from './section'

describe('Section', () => {
  test('renders the settings-zone shape: section + condensed-caps header', () => {
    const html = renderToStaticMarkup(
      <Section title="Training">
        <p>content</p>
      </Section>,
    )
    expect(html).toContain('<section')
    expect(html).toContain('aria-label="Training"')
    // The shipped caps-header recipe, verbatim.
    expect(html).toContain(
      'font-display text-base uppercase leading-none tracking-wide text-muted-foreground',
    )
    expect(html).toContain('>Training</h2>')
    expect(html).toContain('mt-8')
    expect(html).toContain('<p>content</p>')
  })

  test('omits the header (and aria-label) without a title', () => {
    const html = renderToStaticMarkup(
      <Section>
        <p>content</p>
      </Section>,
    )
    expect(html).not.toContain('<h2')
    expect(html).not.toContain('aria-label')
  })

  test('merges className', () => {
    const html = renderToStaticMarkup(
      <Section title="Data" className="mt-6">
        <p>content</p>
      </Section>,
    )
    // tailwind-merge: the caller's margin wins over the default mt-8.
    expect(html).toContain('mt-6')
    expect(html).not.toContain('mt-8')
  })
})
